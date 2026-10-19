#!/usr/bin/env python3
"""Adds map coordinates to polling places using the U.S. Census Bureau geocoder.

    python3 -I scripts/geocode-polling.py [county-file.json ...]

With no arguments, every file in data/polling/ is processed. Results are cached
in data/polling/_geocache.json (keyed by the normalized address) so reruns and
the 8-hour refresh only look up new addresses. Addresses the Census geocoder
cannot match keep lat/lng of null; the site still lists them and its Open in
Maps buttons search by address instead.

The Census geocoder is free and needs no key: https://geocoding.geo.census.gov
"""

import csv
import io
import json
import os
import re
import ssl
import sys
import time
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIR = ROOT / 'data/polling'
CACHE = DIR / '_geocache.json'
BATCH_URL = 'https://geocoding.geo.census.gov/geocoder/locations/addressbatch'
ONE_URL = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress'
UA = 'Mozilla/5.0 (compatible; VotersHubGeocoder/1.0)'


def ssl_context():
    ctx = ssl.create_default_context()
    bundle = os.environ.get('SSL_CERT_FILE') or '/root/.ccr/ca-bundle.crt'
    if os.path.exists(bundle):
        ctx.load_verify_locations(bundle)
    return ctx


def key(site):
    parts = [site.get('address', ''), site.get('city', ''), 'TX', site.get('zip', '')]
    return re.sub(r'\s+', ' ', ', '.join(p.strip() for p in parts if p)).lower()


def batch(rows):
    """rows: list of (id, street, city, zip). Returns {id: (lat, lng)}."""
    buf = io.StringIO()
    w = csv.writer(buf)
    for rid, street, city, zipc in rows:
        w.writerow([rid, street, city, 'TX', zipc])
    boundary = uuid.uuid4().hex
    body = (
        f'--{boundary}\r\nContent-Disposition: form-data; name="benchmark"\r\n\r\nPublic_AR_Current\r\n'
        f'--{boundary}\r\nContent-Disposition: form-data; name="addressFile"; filename="a.csv"\r\n'
        f'Content-Type: text/csv\r\n\r\n{buf.getvalue()}\r\n--{boundary}--\r\n'
    ).encode()
    req = urllib.request.Request(
        BATCH_URL, data=body, headers={'Content-Type': f'multipart/form-data; boundary={boundary}', 'User-Agent': UA}
    )
    with urllib.request.urlopen(req, timeout=300, context=ssl_context()) as res:
        text = res.read().decode('utf-8', 'replace')
    out = {}
    for rec in csv.reader(io.StringIO(text)):
        if len(rec) >= 6 and rec[2] == 'Match' and rec[5]:
            lng, lat = rec[5].split(',')
            out[rec[0]] = (round(float(lat), 6), round(float(lng), 6))
    return out


def one(address):
    q = urllib.parse.urlencode({'address': address, 'benchmark': 'Public_AR_Current', 'format': 'json'})
    req = urllib.request.Request(f'{ONE_URL}?{q}', headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=30, context=ssl_context()) as res:
        matches = json.load(res).get('result', {}).get('addressMatches', [])
    if not matches:
        return None
    c = matches[0]['coordinates']
    return (round(c['y'], 6), round(c['x'], 6))


def all_sites(data):
    for section in ('early_voting', 'election_day'):
        for site in (data.get(section) or {}).get('sites', []):
            yield site


def main(args):
    files = [Path(a) for a in args] or sorted(p for p in DIR.glob('*.json') if not p.name.startswith('_'))
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    datasets = {f: json.loads(f.read_text()) for f in files}

    todo = {}
    for data in datasets.values():
        for site in all_sites(data):
            k = key(site)
            if site.get('address') and k not in cache:
                todo[k] = (site.get('address', ''), site.get('city', ''), site.get('zip', ''))

    print(f'{len(todo)} new addresses to geocode')
    keys = list(todo)
    for i in range(0, len(keys), 2000):
        chunk = keys[i : i + 2000]
        try:
            found = batch([(str(n), *todo[k]) for n, k in enumerate(chunk)])
        except Exception as e:  # noqa: BLE001 - fall back to one at a time
            print(f'  batch failed ({e}); trying addresses one at a time')
            found = {}
        for n, k in enumerate(chunk):
            if str(n) in found:
                cache[k] = list(found[str(n)])
    # One-line lookups catch some addresses the batch service misses.
    for k in keys:
        if k in cache:
            continue
        try:
            hit = one(k)
        except Exception:  # noqa: BLE001
            hit = None
        cache[k] = list(hit) if hit else None
        time.sleep(0.2)

    CACHE.write_text(json.dumps(cache, indent=0, sort_keys=True) + '\n')

    for f, data in datasets.items():
        located = missing = 0
        for site in all_sites(data):
            hit = cache.get(key(site))
            site['lat'], site['lng'] = (hit[0], hit[1]) if hit else (None, None)
            located += bool(hit)
            missing += not hit
        f.write_text(json.dumps(data, indent=1, ensure_ascii=False) + '\n')
        print(f'{data.get("county")}: {located} located, {missing} not found')


if __name__ == '__main__':
    main(sys.argv[1:])
