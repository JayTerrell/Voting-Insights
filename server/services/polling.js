// Address lookups for the Where to Vote page.
//
// geocode(): turns a typed address into map coordinates with the free U.S.
//   Census Bureau geocoder, so the page can sort locations by distance.
// lookup(): asks the Google Civic Information API for the polling places
//   assigned to an address. This matters in precinct counties, where each
//   voter has one Election Day location.
//
// Addresses are never stored or logged.

import { config } from '../config.js';

// Network calls go through this object so tests can stand in for the services.
export const pollingHttp = { fetch: (...args) => fetch(...args) };

const TIMEOUT_MS = 8000;

async function getJson(url) {
  const res = await pollingHttp.fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: 'application/json' } });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

export async function geocode(address) {
  const url = new URL('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress');
  url.search = new URLSearchParams({ address, benchmark: 'Public_AR_Current', format: 'json' });
  const { ok, body } = await getJson(url);
  const match = ok ? body?.result?.addressMatches?.[0] : null;
  if (!match) return null;
  return { lat: match.coordinates.y, lng: match.coordinates.x, matched: match.matchedAddress };
}

export const civicConfigured = () => Boolean(config.civicApiKey);

const place = (p) => {
  const a = p.address || {};
  return {
    name: a.locationName || p.name || '',
    address: [a.line1, a.line2, a.line3].filter(Boolean).join(', '),
    city: a.city || '',
    zip: a.zip || '',
    hours: p.pollingHours || '',
    notes: p.notes || '',
    lat: typeof p.latitude === 'number' ? p.latitude : null,
    lng: typeof p.longitude === 'number' ? p.longitude : null,
  };
};

export async function lookup(address) {
  const url = new URL('https://www.googleapis.com/civicinfo/v2/voterinfo');
  url.search = new URLSearchParams({ key: config.civicApiKey, address });
  const { ok, status, body } = await getJson(url);
  if (!ok) {
    // Google answers 400 when it has no data for the address or election.
    if (status === 400 || status === 404) return { found: false };
    throw new Error(`Civic API returned ${status}`);
  }
  return {
    found: true,
    election: body.election ? { name: body.election.name, date: body.election.electionDay } : null,
    polling_locations: (body.pollingLocations || []).map(place),
    early_vote_sites: (body.earlyVoteSites || []).map(place),
  };
}
