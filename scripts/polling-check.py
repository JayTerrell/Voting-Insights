#!/usr/bin/env python3
"""Checks every county's official polling place sources for changes.

    python3 -I scripts/polling-check.py

For each data/polling/<county>.json, every source URL is fetched and its text
fingerprinted (whitespace and obvious page clocks removed, so cosmetic changes
do not count). Fingerprints are kept in data/polling/_sources.json.

- Sources that did not change: the county's checked_at is set to now.
- Sources that changed, or could not be read: listed as CHANGED or ERROR, and
  checked_at is left alone until the county is re-extracted (docs/POLLING_SPEC.md).

The script prints a JSON summary on the last line for automation.
"""

import hashlib
import json
import os
import re
import ssl
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIR = ROOT / 'data/polling'
STORE = DIR / '_sources.json'
UA = 'Mozilla/5.0 (compatible; VotersHubPollingCheck/1.0)'

NOISE = [
    re.compile(rb'<script\b.*?</script>', re.S | re.I),
    re.compile(rb'<style\b.*?</style>', re.S | re.I),
    re.compile(rb'(?:nonce|csrf|token|__VIEWSTATE|__EVENTVALIDATION)["\']?\s*[:=]\s*["\'][^"\']*["\']', re.I),
    re.compile(rb'\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?\b', re.I),  # page clocks
    re.compile(rb'\s+'),
]


def ssl_context():
    ctx = ssl.create_default_context()
    bundle = os.environ.get('SSL_CERT_FILE') or '/root/.ccr/ca-bundle.crt'
    if os.path.exists(bundle):
        ctx.load_verify_locations(bundle)
    return ctx


def fingerprint(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=30, context=ssl_context()) as res:
        body = res.read(30 * 1024 * 1024)
    if not body.startswith(b'%PDF'):
        for pattern in NOISE:
            body = pattern.sub(b' ', body)
    return hashlib.sha256(body).hexdigest()


def main():
    store = json.loads(STORE.read_text()) if STORE.exists() else {}
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')
    summary = {'unchanged': [], 'changed': [], 'error': []}

    for path in sorted(p for p in DIR.glob('*.json') if not p.name.startswith('_')):
        data = json.loads(path.read_text())
        county = data.get('county', path.stem)
        urls = [s['url'] for s in data.get('sources', []) if s.get('url', '').startswith('http')]
        changed = errored = False
        for url in urls:
            try:
                fp = fingerprint(url)
            except Exception as e:  # noqa: BLE001 - reported, never fatal
                print(f'ERROR   {county}: {url} ({str(e)[:80]})')
                errored = True
                continue
            if url in store and store[url] != fp:
                changed = True
                print(f'CHANGED {county}: {url}')
            store[url] = fp
        if changed:
            summary['changed'].append(county)
        elif errored:
            summary['error'].append(county)
        else:
            summary['unchanged'].append(county)
            data['checked_at'] = now
            path.write_text(json.dumps(data, indent=1, ensure_ascii=False) + '\n')

    STORE.write_text(json.dumps(store, indent=1, sort_keys=True) + '\n')
    print(f'{len(summary["unchanged"])} unchanged, {len(summary["changed"])} changed, {len(summary["error"])} could not be read')
    print(json.dumps(summary))
    return 0


if __name__ == '__main__':
    sys.exit(main())
