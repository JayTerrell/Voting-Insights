// Server calls and browser storage. Storage access is wrapped because private
// browsing modes can throw on localStorage.

const KEYS = {
  token: 'vi_token',
  user: 'vi_user',
  results: 'vi_results',
  progress: 'vi_progress',
  county: 'vi_county',
  plan: 'vi_plan',
  partner: 'vi_partner',
};

function getJSON(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}
function setJSON(key, value) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

export const session = {
  get token() {
    return getJSON(KEYS.token, null);
  },
  get user() {
    return getJSON(KEYS.user, null);
  },
  set(token, user) {
    setJSON(KEYS.token, token);
    setJSON(KEYS.user, user);
  },
  clear() {
    setJSON(KEYS.token, null);
    setJSON(KEYS.user, null);
    setJSON(KEYS.results, null);
    setJSON(KEYS.progress, null);
    setJSON(KEYS.plan, null);
  },
};

// Cached result sets, keyed by share id, so results open instantly on return visits.
export const resultCache = {
  all() {
    return getJSON(KEYS.results, {});
  },
  get(id) {
    return this.all()[id] || null;
  },
  put(entry) {
    const all = this.all();
    all[entry.share_id] = entry;
    setJSON(KEYS.results, all);
  },
};

// The county whose ballot the guide pages show. Defaults to the signed-in
// voter's county, then to the first county with a loaded ballot.
export const ballotCounty = {
  get(guide) {
    const served = Object.keys(guide.ballots || {}).sort();
    const isServed = (c) => c && served.includes(c);
    const saved = getJSON(KEYS.county, null);
    if (isServed(saved)) return saved;
    const mine = session.user && session.user.county;
    if (isServed(mine)) return mine;
    return served.includes('Collin') ? 'Collin' : served[0];
  },
  set(county) {
    setJSON(KEYS.county, county);
  },
};

export const progress = {
  get() {
    return getJSON(KEYS.progress, null);
  },
  set(p) {
    setJSON(KEYS.progress, p);
  },
  clear() {
    setJSON(KEYS.progress, null);
  },
};

async function call(method, url, body) {
  const headers = { Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  const token = session.token;
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error('We could not reach the server. Check your connection and try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Something went wrong. Please try again.');
    err.status = res.status;
    throw err;
  }
  return data;
}

let guidePromise;
export function loadGuide() {
  if (!guidePromise) {
    guidePromise = call('GET', '/data/guide.json').then((g) => {
      g.candidateIndex = {};
      for (const race of g.races) for (const c of race.candidates) g.candidateIndex[c.id] = { ...c, race };
      g.questionIndex = Object.fromEntries(g.questions.map((q) => [q.id, q]));
      plan.useGuide(g);
      return g;
    });
    guidePromise.catch(() => {
      guidePromise = null;
    });
  }
  return guidePromise;
}

let optionsPromise;
// The API adds the site's contact address; the static copy works without the server.
export const loadFormOptions = () =>
  (optionsPromise ||= call('GET', '/api/form-options').catch(() => call('GET', '/data/form-options.json')));

export const api = {
  signUp: (profile) => call('POST', '/api/sign-up', profile),
  signIn: (email, password) => call('POST', '/api/sign-in', { email, password }),
  forgotPassword: (email) => call('POST', '/api/password/forgot', { email }),
  resetPassword: (token, password) => call('POST', '/api/password/reset', { token, password }),
  changePassword: (current, next) => call('POST', '/api/password/change', { current_password: current, new_password: next }),
  updateProfile: (profile) => call('PATCH', '/api/me', profile),
  me: () => call('GET', '/api/me'),
  setAvatar: (image) => call('PUT', '/api/me/avatar', { image }),
  removeAvatar: () => call('DELETE', '/api/me/avatar'),
  authPending: (ticket) => call('POST', '/api/auth/pending', { ticket }),
  authComplete: (body) => call('POST', '/api/auth/complete', body),
  getPlan: () => call('GET', '/api/me/plan'),
  savePlan: (plan) => call('PUT', '/api/me/plan', plan),
  submit: (answers) => call('POST', '/api/results', { answers }),
  result: (id) => call('GET', `/api/results/${encodeURIComponent(id)}`),
  emailResult: (id) => call('POST', `/api/results/${encodeURIComponent(id)}/email`),
  setShareIssues: (id, issues) => call('PUT', `/api/results/${encodeURIComponent(id)}/share`, { issues }),
  myResults: () => call('GET', '/api/my-results'),
  signOut: () => call('POST', '/api/sign-out'),
  partnerCheck: (slug) => call('GET', `/api/partner/check?slug=${encodeURIComponent(slug)}`),
  partnerMe: () => call('GET', '/api/partner/me'),
  partnerRequest: (slug, reason, socials) => call('POST', '/api/partner/request', { slug, reason, socials }),
  partnerStats: (q = {}) => call('GET', `/api/partner/stats?${new URLSearchParams(q)}`),
  partnerReferrer: (slug) => call('GET', `/api/partner/referrer?slug=${encodeURIComponent(slug)}`),
  admin: {
    partners: (status) => call('GET', `/api/admin/partners${status ? `?status=${status}` : ''}`),
    decide: (id, approve, note) => call('POST', `/api/admin/partners/${id}/${approve ? 'approve' : 'reject'}`, { note }),
    summary: (q) => call('GET', `/api/admin/partners/summary?${new URLSearchParams(q)}`),
    users: (q) => call('GET', `/api/admin/users?q=${encodeURIComponent(q || '')}`),
    setAdmin: (id, admin) => call('PUT', `/api/admin/users/${id}/admin`, { admin }),
  },
  deleteAccount: (confirm) => call('DELETE', '/api/me', confirm),
};

// ---------- Ballot plan: watched offices and picks ----------
// Picks are the candidates the voter chose (filling in an oval or "Choose for my
// ballot"). The watchlist is the offices they starred to follow. Saved in this
// browser for everyone, and to the account when signed in.

const EMPTY_PLAN = () => ({ starred_races: [], starred_candidates: [], picks: {}, issues: null });
const listeners = new Set();
let saveTimer;
let candidateRace = null; // candidate id to race id, set once the guide loads

// Earlier versions starred individual candidates. Each becomes a watched office.
function upgrade(p) {
  if (!candidateRace || !p.starred_candidates?.length) return p;
  const races = p.starred_candidates.map((id) => candidateRace[id]).filter(Boolean);
  return { ...p, starred_races: [...new Set([...p.starred_races, ...races])], starred_candidates: [] };
}

function readPlan() {
  const raw = getJSON(KEYS.plan, null);
  return upgrade(raw && typeof raw === 'object' ? { ...EMPTY_PLAN(), ...raw } : EMPTY_PLAN());
}

function writePlan(p) {
  setJSON(KEYS.plan, p);
  listeners.forEach((fn) => fn(p));
  if (!session.token) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => api.savePlan(p).catch(() => {}), 600);
}

export const plan = {
  get: readPlan,
  useGuide(guide) {
    candidateRace = {};
    for (const r of guide.races) for (const c of r.candidates) candidateRace[c.id] = r.id;
    const raw = getJSON(KEYS.plan, null);
    if (raw?.starred_candidates?.length) writePlan(readPlan());
  },
  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  isWatched: (raceId) => readPlan().starred_races.includes(raceId),
  toggleWatch(raceId) {
    const p = readPlan();
    const on = !p.starred_races.includes(raceId);
    p.starred_races = on ? [...p.starred_races, raceId] : p.starred_races.filter((x) => x !== raceId);
    writePlan(p);
    return on;
  },
  pickFor: (raceId) => readPlan().picks[raceId] || null,
  pick(raceId, candidateId) {
    const p = readPlan();
    if (candidateId) p.picks[raceId] = candidateId;
    else delete p.picks[raceId];
    writePlan(p);
  },
  // Choosing the current pick again removes it.
  togglePick(raceId, candidateId) {
    const on = readPlan().picks[raceId] !== candidateId;
    this.pick(raceId, on ? candidateId : null);
    return on;
  },
  clearPicks() {
    const p = readPlan();
    p.picks = {};
    writePlan(p);
  },
  // Saves the voter's issues and sets the watchlist offices in one change.
  saveIssues(issues, add = [], remove = []) {
    const p = readPlan();
    p.issues = issues;
    p.starred_races = [...new Set([...p.starred_races.filter((id) => !remove.includes(id)), ...add])];
    writePlan(p);
  },
  // After signing in, combine what was saved on this device with the account copy.
  async sync() {
    if (!session.token) return;
    const local = readPlan();
    const { plan: remote } = await api.getPlan();
    const merged = upgrade({
      starred_races: [...new Set([...remote.starred_races, ...local.starred_races])],
      starred_candidates: [...new Set([...(remote.starred_candidates || []), ...local.starred_candidates])],
      picks: { ...remote.picks, ...local.picks },
      issues: local.issues || remote.issues || null,
    });
    setJSON(KEYS.plan, merged);
    listeners.forEach((fn) => fn(merged));
    const changed = JSON.stringify(merged) !== JSON.stringify({ ...EMPTY_PLAN(), ...remote, updated_at: undefined });
    if (changed) await api.savePlan(merged).catch(() => {});
  },
};

// Signs in on this device: stores the session and merges the ballot plan.
export async function startSession(res) {
  if (session.user && session.user.email !== res.user.email) session.clear();
  session.set(res.token, res.user);
  await plan.sync().catch(() => {});
}

// ---------- Partner links ----------
// The first partner link a visitor arrives through is remembered for 30 days
// and credited if they sign up in that time.

const PARTNER_DAYS = 30;

export const partnerRef = {
  get() {
    const r = getJSON(KEYS.partner, null);
    if (!r?.slug || Date.now() - r.at > PARTNER_DAYS * 864e5) return null;
    return r.slug;
  },
  // Keeps the first link; a later one does not replace it while it is still valid.
  capture(slug) {
    if (!/^[a-z0-9-]{3,30}$/.test(slug || '') || this.get()) return;
    setJSON(KEYS.partner, { slug, at: Date.now() });
  },
  // Anonymous activity credited to the link: sharing results, looking up where to vote.
  event(kind) {
    const slug = this.get();
    if (slug)
      fetch('/api/partner/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, kind }),
        keepalive: true,
      }).catch(() => {});
  },
};
