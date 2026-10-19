#!/usr/bin/env python3
"""Downloads candidate photos found by researchers, checks them, and crops them.

    python3 -I scripts/fetch-photos.py [--retry] [found.json ...]

--retry tries again every photo that failed to download on an earlier run.
--reject <id> marks a photo as unsuitable after review: its file is deleted and
it is never downloaded again, even if a later input lists it.

Each input file has {"photos": [{candidate_id, image_url, source_url, credit, kind}]}.
New entries are merged into data/photos/manifest.json (the permanent record of
where every photo came from). Every manifest entry without a local file is then
downloaded, checked (a real image, at least 120 px, not a banner shape), cropped
to a square with the face area kept, resized to 320 px, and saved as
client/img/candidates/<id>.jpg. Finally data/research/pass6-photos.json is
rewritten so the build attaches each photo, with its credit, to the candidate.

Allowed photo kinds are official government portraits, Wikimedia Commons, and
the candidate's own campaign site. See docs/RESEARCH_SPEC.md.

Requires Pillow (pip install pillow). Run it locally; the output is committed.
"""

import io
import json
import os
import ssl
import sys
import urllib.request
from urllib.parse import urlparse
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / 'data/photos/manifest.json'
OUT_DIR = ROOT / 'client/img/candidates'
SUPPLEMENT = ROOT / 'data/research/pass6-photos.json'
GUIDE = ROOT / 'data/guide.json'

KINDS = {'official', 'commons', 'campaign'}
BLOCKED_DOMAINS = (
    'facebook.com', 'fbcdn.net', 'instagram.com', 'cdninstagram.com', 'twimg.com', 'twitter.com', 'x.com',
    'linkedin.com', 'licdn.com', 'ballotpedia.org', 'branch.vote', 'vote411.org', 'ivoterguide.com',
    'hoodline.com', 'theballotbrief.com', 'goodparty.org', 'gettyimages.com', 'apnews.com', 'reuters.com',
)


def blocked(url):
    host = (urlparse(url).hostname or '').lower()
    return any(host == d or host.endswith('.' + d) for d in BLOCKED_DOMAINS)
SIZE = 320
MAX_BYTES = 20 * 1024 * 1024


def ssl_context():
    ctx = ssl.create_default_context()
    bundle = os.environ.get('SSL_CERT_FILE') or '/root/.ccr/ca-bundle.crt'
    if os.path.exists(bundle):
        ctx.load_verify_locations(bundle)
    return ctx


def download(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (compatible; VotersHubPhotoCheck/1.0)', 'Accept': 'image/*'})
    with urllib.request.urlopen(req, timeout=20, context=ssl_context()) as res:
        ctype = res.headers.get('Content-Type', '')
        if not ctype.startswith('image/'):
            raise ValueError(f'not an image ({ctype})')
        data = res.read(MAX_BYTES + 1)
        if len(data) > MAX_BYTES:
            raise ValueError('file too large')
        return data


def square_crop(img):
    """Square crop that keeps the top of a portrait, where faces usually are."""
    w, h = img.size
    if w == h:
        return img
    if w > h:
        left = (w - h) // 2
        return img.crop((left, 0, left + h, h))
    # Very tall photos are usually full length with the head at the very top.
    top = 0 if h / w > 1.8 else int((h - w) * 0.15)
    return img.crop((0, top, w, top + w))


def process(data):
    img = Image.open(io.BytesIO(data))
    img = ImageOps.exif_transpose(img)
    w, h = img.size
    if min(w, h) < 120:
        raise ValueError(f'too small ({w}x{h})')
    # Tall full-length portraits crop well from the top; wide images are usually banners.
    if w / h > 2.2 or h / w > 3:
        raise ValueError(f'banner shape ({w}x{h})')
    if img.mode in ('RGBA', 'LA', 'P'):
        # Transparent backgrounds become white instead of black.
        img = img.convert('RGBA')
        base = Image.new('RGB', img.size, (255, 255, 255))
        base.paste(img, mask=img.split()[-1])
        img = base
    img = img.convert('RGB')
    img = square_crop(img).resize((SIZE, SIZE), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, 'JPEG', quality=82, optimize=True, progressive=True)
    return buf.getvalue()


def main(args):
    retry = '--retry' in args
    rejects = {args[i + 1] for i, a in enumerate(args[:-1]) if a == '--reject'}
    inputs = [a for i, a in enumerate(args) if a not in ('--retry', '--reject') and (i == 0 or args[i - 1] != '--reject')]
    candidates = {c['id'] for r in json.loads(GUIDE.read_text())['races'] for c in r['candidates']}
    manifest = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {'photos': {}}
    added = 0
    for path in inputs:
        for p in json.loads(Path(path).read_text()).get('photos', []):
            cid = p.get('candidate_id')
            ok = (
                cid in candidates
                and p.get('kind') in KINDS
                and str(p.get('image_url', '')).startswith('https://')
                and str(p.get('source_url', '')).startswith('http')
                and not blocked(p['image_url'])
                and not blocked(p['source_url'])
            )
            if not ok:
                print(f'skip {cid}: not an allowed photo entry')
                continue
            if manifest['photos'].get(cid, {}).get('rejected'):
                continue
            if cid not in manifest['photos']:
                added += 1
            manifest['photos'][cid] = {k: p[k] for k in ('image_url', 'source_url', 'credit', 'kind')}

    for cid in rejects:
        if cid in manifest['photos']:
            manifest['photos'][cid]['rejected'] = True
            (OUT_DIR / f'{cid}.jpg').unlink(missing_ok=True)
            print(f'rejected {cid}')

    if retry:
        for p in manifest['photos'].values():
            p.pop('failed', None)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    saved, failed = 0, []
    for cid, p in sorted(manifest['photos'].items()):
        dest = OUT_DIR / f'{cid}.jpg'
        if dest.exists() or p.get('failed') or p.get('rejected'):
            continue
        try:
            dest.write_bytes(process(download(p['image_url'])))
            saved += 1
        except Exception as e:  # noqa: BLE001 - every failure is reported and skipped
            p['failed'] = str(e)[:120]
            failed.append((cid, p['failed']))

    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(manifest, indent=1, sort_keys=True) + '\n')

    entries = []
    for cid, p in sorted(manifest['photos'].items()):
        if cid in candidates and not p.get('rejected') and (OUT_DIR / f'{cid}.jpg').exists():
            entries.append(
                {
                    'id': cid,
                    'photo': {
                        'url': f'/img/candidates/{cid}.jpg',
                        'credit': p.get('credit') or ('Campaign website' if p['kind'] == 'campaign' else 'Official portrait'),
                        'source_url': p['source_url'],
                    },
                }
            )
    SUPPLEMENT.write_text(json.dumps({'candidates': entries}, indent=1) + '\n')
    print(f'{added} new manifest entries, {saved} photos saved, {len(failed)} failed, {len(entries)} candidates with photos')
    for cid, why in failed:
        print(f'  failed {cid}: {why}')


if __name__ == '__main__':
    main(sys.argv[1:])
