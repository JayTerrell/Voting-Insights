// Where to Vote: a county's early voting and Election Day locations on a map and
// in a list, with today's hours, an Open now label, distance from the voter, and
// buttons that hand directions to Apple Maps or Google Maps.
//
// Locations come from each county's official election website and are checked
// every 8 hours during early voting. The voter's location never leaves their
// device. While a voter types an address, Stadia Maps suggests full matching
// addresses (limited to Texas); the chosen address is sent to our server only
// to look up an assigned polling place.

import { $, $$, esc, setTitle, countyLabel, skeleton } from '../ui.js';
import { loadGuide, loadFormOptions, ballotCounty, session, partnerRef } from '../api.js';

const TZ = 'America/Chicago';
const EARLY_START = '2026-10-19';
const EARLY_END = '2026-10-30';
const ELECTION_DAY = '2026-11-03';
const SUGGEST_URL = 'https://api.stadiamaps.com/geocoding/v1/autocomplete';
const TEXAS = { min_lat: 25.8, max_lat: 36.6, min_lon: -106.7, max_lon: -93.5 };
const STADIA = 'https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png';
const ATTRIBUTION =
  '&copy; <a href="https://stadiamaps.com/" target="_blank" rel="noopener">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

// ---------- Time in Central Time ----------

function nowCentral() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value])
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

const clock = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'p.m.' : 'a.m.';
  const h12 = h % 12 || 12;
  return m ? `${h12}:${String(m).padStart(2, '0')} ${suffix}` : `${h12} ${suffix}`;
};

const dayLabel = (iso) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });

function ago(iso) {
  if (!iso) return 'recently';
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins} ${mins === 1 ? 'minute' : 'minutes'} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  return `${Math.round(hours / 24)} days ago`;
}

// The hours a site is open on a date, or null when it is closed that day.
function hoursOn(site, data, mode, date) {
  if (mode === 'election') {
    return date === ELECTION_DAY
      ? { open: data.election_day?.open || '07:00', close: data.election_day?.close || '19:00' }
      : null;
  }
  const schedule = site.schedule || data.early_voting?.schedule || [];
  return schedule.find((d) => d.date === date) || null;
}

function status(site, data, mode) {
  const now = nowCentral();
  const today = hoursOn(site, data, mode, now.date);
  if (!today)
    return { open: false, label: mode === 'early' && now.date < EARLY_START ? 'Opens Oct. 19' : 'Closed today', today: null };
  if (now.time < today.open) return { open: false, label: `Opens at ${clock(today.open)}`, today };
  if (now.time >= today.close) return { open: false, label: 'Closed for today', today };
  return { open: true, label: `Open now until ${clock(today.close)}`, today };
}

// ---------- Distance and map links ----------

function miles(a, b) {
  const R = 3958.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// The Census geocoder answers in capitals ("8100 GAYLORD PKWY, FRISCO, TX, 75034").
const titleCase = (text) =>
  text
    .toLowerCase()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase())
    .replace(/\bTx\b/, 'TX');

const fullAddress = (s) => [s.address, s.city, 'TX', s.zip].filter(Boolean).join(', ');

function mapLinks(site) {
  const dest = Number.isFinite(site.lat) ? `${site.lat},${site.lng}` : fullAddress(site);
  const apple = `https://maps.apple.com/?daddr=${encodeURIComponent(dest)}&q=${encodeURIComponent(site.name)}`;
  const google = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(Number.isFinite(site.lat) ? dest : `${site.name}, ${fullAddress(site)}`)}`;
  return `<div class="map-links">
    <a class="btn btn-small btn-ghost" href="${esc(apple)}" target="_blank" rel="noopener">Open in Apple Maps</a>
    <a class="btn btn-small btn-ghost" href="${esc(google)}" target="_blank" rel="noopener">Open in Google Maps</a>
  </div>`;
}

// ---------- Leaflet, loaded only on this page ----------

let leafletReady;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  leafletReady ||= new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = '/vendor/leaflet/leaflet.min.css';
    document.head.appendChild(css);
    const js = document.createElement('script');
    js.src = '/vendor/leaflet/leaflet.min.js';
    js.onload = () => resolve(window.L);
    js.onerror = () => reject(new Error('The map could not load.'));
    document.head.appendChild(js);
  });
  return leafletReady;
}

const pollingCache = {};
async function loadCounty(file) {
  pollingCache[file] ||= fetch(`/data/polling/${file}`).then((r) => {
    if (!r.ok) throw new Error('These polling places could not be loaded.');
    return r.json();
  });
  return pollingCache[file];
}

// ---------- Page ----------

export async function renderVote(view, _params, current) {
  setTitle('Where to Vote');
  view.innerHTML = `<span class="eyebrow">Where to Vote</span><h1>Find a place to vote</h1>${skeleton()}`;
  const [guide, options, index] = await Promise.all([
    loadGuide(),
    loadFormOptions(),
    fetch('/data/polling/index.json').then((r) => (r.ok ? r.json() : { counties: [] })),
  ]);
  if (!current()) return;

  const available = new Map(index.counties.map((c) => [c.county, c]));
  const qs = new URLSearchParams(location.search);
  const preferred = qs.get('county') || session.user?.county || ballotCounty.get(guide);
  let county = available.has(preferred)
    ? preferred
    : available.has(ballotCounty.get(guide))
      ? ballotCounty.get(guide)
      : preferred;
  const today = nowCentral().date;
  let mode = qs.get('day') === 'election' || today > EARLY_END ? 'election' : 'early';
  let origin = null; // { lat, lng, label }
  let lookup = null; // Civic API result for a typed address
  let center = null; // middle of the county's locations, to rank address suggestions

  view.innerHTML = `<div id="vote-root">
    <span class="eyebrow">Where to Vote</span>
    <h1>Find a place to vote</h1>
    <p class="lede">Every early voting and Election Day location in your county, with today's hours and directions. Early voting runs Monday, October 19 through Friday, October 30. Election Day is Tuesday, November 3, 7 a.m. to 7 p.m. Bring an <a href="https://www.votetexas.gov/mobile/id-faqs.htm" target="_blank" rel="noopener">acceptable photo ID</a>.</p>
    <div class="vote-controls">
      <div class="vote-county"><label for="vote-county">County</label>
        <select id="vote-county">${options.counties
          .map(
            (c) =>
              `<option value="${esc(c)}" ${c === county ? 'selected' : ''}>${esc(countyLabel(c))}${available.has(c) ? '' : ' (coming soon)'}</option>`
          )
          .join('')}</select></div>
      <div class="seg" role="tablist" aria-label="Which day">
        <button type="button" role="tab" data-mode="early">Early voting</button>
        <button type="button" role="tab" data-mode="election">Election Day</button>
      </div>
    </div>
    <form class="vote-locate" id="vote-locate" novalidate>
      <label for="vote-address" class="sr-only">Your address</label>
      <div class="addr-box">
        <input id="vote-address" type="text" autocomplete="off" maxlength="200" placeholder="Start typing your street address"
          role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="vote-suggest">
        <ul class="addr-suggest" id="vote-suggest" role="listbox" aria-label="Suggested addresses" hidden></ul>
      </div>
      <button type="submit" class="btn btn-small">Find nearest</button>
      <button type="button" class="btn btn-small btn-ghost" id="vote-geo">Use my location</button>
    </form>
    <p class="form-error" id="vote-err" role="alert" hidden></p>
    <div id="vote-body"></div>
  </div>`;

  const root = $('#vote-root', view);
  const body = $('#vote-body', root);
  const err = $('#vote-err', root);
  let map = null;
  let markers = new Map();

  const showError = (msg) => {
    err.textContent = msg;
    err.hidden = !msg;
  };

  async function draw() {
    $$('[data-mode]', root).forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === mode)));
    const q = new URLSearchParams({ county });
    if (mode === 'election') q.set('day', 'election');
    history.replaceState({}, '', `/where-to-vote?${q}`);

    const entry = available.get(county);
    if (!entry) {
      center = null;
      map?.remove();
      map = null;
      body.innerHTML = `<div class="panel empty-state"><h2>${esc(countyLabel(county))} locations are coming soon</h2>
        <p>Until then, find your polling place through the state's lookup at <a href="https://www.votetexas.gov/" target="_blank" rel="noopener">VoteTexas.gov</a> or your county elections office.</p></div>`;
      return;
    }
    const data = await loadCounty(entry.file);
    const pts = [...(data.early_voting?.sites || []), ...(data.election_day?.sites || [])].filter((s) => Number.isFinite(s.lat));
    center = pts.length
      ? { lat: pts.reduce((a, s) => a + s.lat, 0) / pts.length, lon: pts.reduce((a, s) => a + s.lng, 0) / pts.length }
      : null;
    const section = mode === 'election' ? data.election_day : data.early_voting;
    let sites = (section?.sites || []).map((s, i) => ({ ...s, _id: `${mode}-${i}` }));
    if (origin) {
      sites = sites
        .map((s) => ({ ...s, _miles: Number.isFinite(s.lat) ? miles(origin, s) : null }))
        .sort((a, b) => (a._miles ?? 1e9) - (b._miles ?? 1e9));
    }
    const precinct = data.model === 'precinct' && mode === 'election';
    const dates =
      mode === 'early' ? (data.early_voting?.schedule || []).filter((d) => d.date >= EARLY_START && d.date <= EARLY_END) : [];

    body.innerHTML = `
      <p class="freshness"><span class="fresh-dot" aria-hidden="true"></span>Checked against ${esc(countyLabel(county))} election websites ${esc(ago(data.checked_at))}.
        Refreshed every 8 hours during early voting.
        ${data.sources?.length ? `Source: ${data.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>`).join(', ')}.` : ''}
        ${data.wait_times_url ? `<a href="${esc(data.wait_times_url)}" target="_blank" rel="noopener">Live wait times</a>.` : ''}</p>
      ${
        precinct
          ? `<div class="callout">${esc(countyLabel(county))} assigns each voter one Election Day location by precinct. Enter your address above to find yours${
              data.lookup_url
                ? `, or use the <a href="${esc(data.lookup_url)}" target="_blank" rel="noopener">county's lookup</a>`
                : ''
            }. During early voting you may use any location in the county.</div>`
          : mode === 'election'
            ? `<div class="callout">${esc(countyLabel(county))} uses countywide voting: on Election Day you may vote at any location below.</div>`
            : ''
      }
      ${origin?.place ? `<p class="small vote-origin">Distances from <b>${esc(origin.place)}</b>.</p>` : ''}
      ${lookup ? lookupCard(lookup, precinct) : ''}
      ${data.notes ? `<p class="small muted">${esc(data.notes)}</p>` : ''}
      ${
        dates.length
          ? `<details class="vote-schedule"><summary>Early voting hours by day</summary><table class="ballot"><tbody>${dates
              .map((d) => `<tr><td>${esc(dayLabel(d.date))}</td><td>${esc(clock(d.open))} to ${esc(clock(d.close))}</td></tr>`)
              .join(
                ''
              )}</tbody></table><p class="small muted">Some locations keep different hours; each one is listed below.</p></details>`
          : ''
      }
      ${
        sites.length
          ? `<div class="vote-layout">
        <div class="vote-map" id="vote-map" role="region" aria-label="Map of voting locations"></div>
        <ol class="vote-list" id="vote-list">${sites.map((s) => siteItem(s, data)).join('')}</ol>
      </div>`
          : `<div class="panel empty-state"><h2>No ${mode === 'election' ? 'Election Day' : 'early voting'} locations published yet</h2><p>We do not have this list for ${esc(countyLabel(county))} yet. Please use the county election website linked above, or <a href="https://www.votetexas.gov/" target="_blank" rel="noopener">VoteTexas.gov</a>.</p></div>`
      }`;

    if (sites.length) await drawMap(sites, data);
  }

  function siteItem(s, data) {
    const st = status(s, data, mode);
    return `<li class="vote-site" id="site-${esc(s._id)}" data-site="${esc(s._id)}">
      <div class="vote-site-head">
        <h3>${esc(s.name)}</h3>
        ${Number.isFinite(s._miles) ? `<span class="distance">${s._miles < 10 ? s._miles.toFixed(1) : Math.round(s._miles)} mi</span>` : ''}
      </div>
      <p class="vote-address">${esc(fullAddress(s))}${s.room ? `<br><span class="small muted">${esc(s.room)}</span>` : ''}</p>
      <p class="vote-hours"><span class="open-badge ${st.open ? 'is-open' : ''}">${esc(st.label)}</span>${
        st.today ? ` <span class="small muted">Today ${esc(clock(st.today.open))} to ${esc(clock(st.today.close))}</span>` : ''
      }</p>
      ${s.schedule ? `<p class="small muted">This location keeps its own hours.</p>` : ''}
      ${s.precincts?.length ? `<p class="small muted">Precincts: ${esc(s.precincts.join(', '))}</p>` : ''}
      ${s.notes ? `<p class="small">${esc(s.notes)}</p>` : ''}
      ${mapLinks(s)}
    </li>`;
  }

  // Google only has assigned locations for some counties. In countywide
  // counties no assignment is needed, so a miss is not worth mentioning.
  function lookupCard(r, precinct) {
    if (!r.found || (!r.polling_locations.length && !r.early_vote_sites.length)) {
      return precinct
        ? `<div class="callout">We could not look up the Election Day location assigned to that address. Check it with your county's lookup or <a href="https://www.votetexas.gov/" target="_blank" rel="noopener">VoteTexas.gov</a>.</div>`
        : '';
    }
    const list = r.polling_locations.length ? r.polling_locations : r.early_vote_sites;
    return `<div class="panel lookup-card"><h2>Your polling place</h2>
      <p class="small muted">From the Google Civic Information API, which uses official election data. Confirm with your county before you go.</p>
      ${list
        .slice(0, 3)
        .map(
          (p) =>
            `<div class="lookup-place"><b>${esc(p.name)}</b><br>${esc(fullAddress(p))}${p.hours ? `<br><span class="small">${esc(p.hours)}</span>` : ''}${mapLinks(p)}</div>`
        )
        .join('')}</div>`;
  }

  async function drawMap(sites, data) {
    let L;
    try {
      L = await loadLeaflet();
    } catch (e) {
      $('#vote-map', root).innerHTML = `<p class="small muted" style="padding:16px">${esc(e.message)} The list still works.</p>`;
      return;
    }
    const el = $('#vote-map', root);
    if (!el) return;
    map?.remove();
    map = L.map(el, { scrollWheelZoom: false, preferCanvas: true });
    L.tileLayer(STADIA, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map);
    markers = new Map();
    const points = [];
    for (const s of sites) {
      if (!Number.isFinite(s.lat)) continue;
      const open = status(s, data, mode).open;
      const m = L.circleMarker([s.lat, s.lng], {
        radius: 8,
        weight: 2,
        color: '#13294b',
        fillColor: open ? '#13294b' : '#fffdf8',
        fillOpacity: 1,
      }).addTo(map);
      m.bindTooltip(s.name);
      m.on('click', () => focusSite(s._id, false));
      markers.set(s._id, m);
      points.push([s.lat, s.lng]);
    }
    if (origin) {
      L.circleMarker([origin.lat, origin.lng], {
        radius: 9,
        weight: 3,
        color: '#9e1b32',
        fillColor: '#9e1b32',
        fillOpacity: 0.35,
      })
        .addTo(map)
        .bindTooltip(origin.label || 'You');
      points.push([origin.lat, origin.lng]);
    }
    if (points.length) map.fitBounds(points, { padding: [24, 24], maxZoom: 14 });
    else map.setView([31.0, -99.0], 6);
  }

  function focusSite(id, panMap = true) {
    $$('.vote-site.active', root).forEach((li) => li.classList.remove('active'));
    const li = $(`#site-${CSS.escape(id)}`, root);
    li?.classList.add('active');
    if (panMap) {
      const m = markers.get(id);
      if (m && map) map.setView(m.getLatLng(), Math.max(map.getZoom(), 14), { animate: true });
    } else {
      li?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    markers.forEach((m, key) => m.setStyle({ radius: key === id ? 11 : 8, weight: key === id ? 3 : 2 }));
  }

  root.addEventListener('change', (e) => {
    if (e.target.id === 'vote-county') {
      county = e.target.value;
      lookup = null;
      showError('');
      draw();
    }
  });

  root.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-mode]');
    if (tab) {
      mode = tab.dataset.mode;
      draw();
      return;
    }
    const item = e.target.closest('.vote-site');
    if (item && !e.target.closest('a, button')) focusSite(item.dataset.site);
  });

  // ---------- Address suggestions ----------
  // Suggestions come straight from Stadia Maps (the same service as the map),
  // which recognizes this site by its domain. If Stadia cannot be reached the
  // box quietly goes back to a plain text field.

  const input = $('#vote-address', root);
  const list = $('#vote-suggest', root);
  let picked = null; // { label, lat, lng } chosen from the list
  let suggestions = [];
  let active = -1;
  let timer = 0;
  let pending = null;
  let suggestOff = false;

  function closeSuggest() {
    suggestions = [];
    active = -1;
    list.hidden = true;
    list.innerHTML = '';
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }

  function renderSuggest() {
    if (!suggestions.length) return closeSuggest();
    list.innerHTML = suggestions
      .map(
        (s, i) =>
          `<li role="option" id="addr-opt-${i}" data-i="${i}" aria-selected="${i === active}" class="${i === active ? 'active' : ''}">${esc(s.label)}</li>`
      )
      .join('');
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    if (active >= 0) input.setAttribute('aria-activedescendant', `addr-opt-${active}`);
    else input.removeAttribute('aria-activedescendant');
  }

  async function fetchSuggest(text) {
    pending?.abort();
    pending = new AbortController();
    const q = new URLSearchParams({ text, 'boundary.country': 'US', layers: 'address', size: '6' });
    for (const [k, v] of Object.entries(TEXAS)) q.set(`boundary.rect.${k}`, String(v));
    if (center) {
      q.set('focus.point.lat', center.lat.toFixed(4));
      q.set('focus.point.lon', center.lon.toFixed(4));
    }
    try {
      const res = await fetch(`${SUGGEST_URL}?${q}`, { signal: pending.signal, credentials: 'omit' });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) suggestOff = true;
        return closeSuggest();
      }
      const data = await res.json();
      suggestions = (data.features || [])
        .filter((f) => f.geometry?.coordinates?.length === 2 && f.properties?.label)
        .map((f) => ({
          label: f.properties.label.replace(/, USA$|, United States$/, ''),
          lng: f.geometry.coordinates[0],
          lat: f.geometry.coordinates[1],
        }));
      active = -1;
      if (document.activeElement === input) renderSuggest();
    } catch (ex) {
      if (ex.name !== 'AbortError') closeSuggest();
    }
  }

  function choose(i) {
    const s = suggestions[i];
    if (!s) return;
    picked = s;
    input.value = s.label;
    closeSuggest();
    $('#vote-locate', root).requestSubmit();
  }

  input.addEventListener('input', () => {
    picked = null;
    clearTimeout(timer);
    const text = input.value.trim();
    if (suggestOff || text.length < 4 || !/\d/.test(text)) {
      pending?.abort();
      return closeSuggest();
    }
    timer = setTimeout(() => fetchSuggest(text), 250);
  });

  input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = suggestions.length;
      active = e.key === 'ArrowDown' ? (active + 1) % n : (active - 1 + n) % n;
      renderSuggest();
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      choose(active);
    } else if (e.key === 'Escape') {
      closeSuggest();
    }
  });

  input.addEventListener('blur', () => setTimeout(closeSuggest, 150));
  // mousedown, not click, so the choice lands before the input loses focus.
  list.addEventListener('mousedown', (e) => {
    const li = e.target.closest('[data-i]');
    if (!li) return;
    e.preventDefault();
    choose(Number(li.dataset.i));
  });

  $('#vote-locate', root).addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('');
    closeSuggest();
    const address = $('#vote-address', root).value.trim();
    if (address.length < 5) return showError('Please enter a street address, city, and ZIP code.');
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.classList.add('is-loading');
    try {
      const withState = /\btx\b|texas/i.test(address) ? address : `${address}, TX`;
      if (picked && picked.label === address) {
        origin = { lat: picked.lat, lng: picked.lng, label: 'Your address', place: picked.label };
      } else {
        const res = await fetch(`/api/geocode?address=${encodeURIComponent(withState)}`);
        const geo = await res.json();
        if (!res.ok)
          throw new Error(
            geo.error || 'We could not find that address. Pick one of the suggestions, or include the city and ZIP code.'
          );
        origin = { lat: geo.lat, lng: geo.lng, label: 'Your address', place: titleCase(geo.matched || withState) };
      }
      lookup = null;
      partnerRef.event('vote_lookup');
      if (options.polling_lookup) {
        const r = await fetch(`/api/polling/lookup?address=${encodeURIComponent(withState)}`).catch(() => null);
        if (r?.ok) lookup = await r.json();
      }
      await draw();
    } catch (ex) {
      showError(ex.message);
    } finally {
      btn.disabled = false;
      btn.classList.remove('is-loading');
    }
  });

  $('#vote-geo', root).addEventListener('click', (e) => {
    showError('');
    if (!navigator.geolocation) return showError('Your browser does not share location. Enter your address instead.');
    const btn = e.currentTarget;
    btn.classList.add('is-loading');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        btn.classList.remove('is-loading');
        origin = { lat: pos.coords.latitude, lng: pos.coords.longitude, label: 'You are here', place: 'your current location' };
        await draw();
      },
      () => {
        btn.classList.remove('is-loading');
        showError('We could not get your location. You can enter your address instead.');
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  });

  await draw();
}
