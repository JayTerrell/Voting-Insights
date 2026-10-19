# Polling place data: November 3, 2026 Texas general election

This is how polling place data is compiled for a nonpartisan voter guide. Accuracy matters more than anything: voters will drive to these addresses. Use only official county sources (the county elections office or elections administrator website, county clerk or tax assessor elections pages, or official county PDFs and ArcGIS maps linked from those pages). Never use news articles, party websites, or third-party aggregators as the source of a location. Never circumvent a paywall, login, or bot check. Never put any personal information in request headers or URLs; use a generic User-Agent such as `Mozilla/5.0 (compatible; VotersHubPollingCheck/1.0)`.

For each county, write `data/polling/<slug>.json` where slug is the county name in lowercase with spaces as hyphens (for example `fort-bend.json`, `el-paso.json`, `tom-green.json`).

## What to find

1. **Early voting** for the November 3, 2026 general election (early voting runs Monday, October 19 through Friday, October 30, 2026): every early voting location with its address and its hours for each day. Counties often list a main schedule (for example Mon to Sat 7 a.m. to 7 p.m., Sun 12 to 6 p.m.) and sometimes different hours for specific sites or days.
2. **Election Day** (Tuesday, November 3, 2026, 7 a.m. to 7 p.m. statewide): every Election Day polling location with its address. If the county has not published Election Day locations yet, say so in `notes` and leave the list empty.
3. **Model:** whether the county uses countywide polling (vote centers: any registered voter may vote at any Election Day location in the county) or precinct polling (each voter must use their precinct's location on Election Day). For precinct counties, record the precinct number(s) served by each Election Day location when the county lists them.
4. **Links:** the county page(s) you used, the county's own "find my polling place" lookup if it has one, and a live wait-time page if the county publishes one.

Use tools to handle large lists: download PDFs with curl and convert them with `pdftotext -layout`, or read ArcGIS/JSON endpoints that the county's own map loads. Write any parsing scripts in a temporary folder outside the repository. Do not geocode by hand; `scripts/geocode-polling.py` adds coordinates.

## Output format

```json
{
  "county": "Fort Bend",
  "model": "countywide",
  "checked_at": "2026-10-19T15:00:00Z",
  "sources": [{ "title": "Fort Bend County Elections: Early Voting Locations", "url": "https://..." }],
  "lookup_url": "https://... or null",
  "wait_times_url": "https://... or null",
  "early_voting": {
    "schedule": [{ "date": "2026-10-19", "open": "07:00", "close": "19:00" }],
    "sites": [
      {
        "name": "Missouri City Community Center",
        "address": "1522 Texas Parkway",
        "city": "Missouri City",
        "zip": "77489",
        "room": "Gym (optional)",
        "schedule": null,
        "notes": ""
      }
    ]
  },
  "election_day": {
    "open": "07:00",
    "close": "19:00",
    "sites": [{ "name": "...", "address": "...", "city": "...", "zip": "...", "room": "", "precincts": ["1001"], "notes": "" }]
  },
  "notes": "Anything a voter should know, in one or two plain sentences. No em or en dashes."
}
```

- `schedule` at the early voting level is the county's default hours for every early voting day from 2026-10-19 to 2026-10-30, one entry per date, 24-hour times in Central Time. Leave out dates when no voting happens.
- A site's own `schedule` is `null` when it follows the default; otherwise list that site's full schedule in the same format.
- `precincts` is only for precinct counties; omit it otherwise.
- `checked_at` is the time you read the county source, in UTC.
- Use the exact names and addresses the county publishes. Do not guess ZIP codes; leave `zip` empty if it is not given.

Validate each file with `python3 -c "import json;json.load(open('PATH'))"` and check that it has no em or en dashes. Do not edit any other repository files.

## Keeping it current

During early voting the data is checked every 8 hours:

```bash
python3 -I scripts/polling-check.py          # fetches every county source and lists the ones that changed
# re-extract only the changed counties, following this spec
python3 -I scripts/geocode-polling.py        # adds coordinates for any new addresses
npm run build && npm test
```

`polling-check.py` keeps a fingerprint of each county source page in `data/polling/_sources.json`. Counties whose sources did not change get a new `checked_at` time; changed counties are listed for re-extraction. The Where to Vote page shows each county's `checked_at` as "Checked against county election websites N hours ago."
