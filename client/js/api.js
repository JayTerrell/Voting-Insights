// Server calls and browser storage. Storage access is wrapped because private
// browsing modes can throw on localStorage.

const KEYS = {
  token: 'vi_token',
  user: 'vi_user',
  results: 'vi_results',
  progress: 'vi_progress',
  county: 'vi_county',
  plan: 'vi_plan',
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
  getPlan: () => call('GET', '/api/me/plan'),
  savePlan: (plan) => call('PUT', '/api/me/plan', plan),
  submit: (answers) => call('POST', '/api/results', { answers }),
  result: (id) => call('GET', `/api/results/${encodeURIComponent(id)}`),
  emailResult: (id) => call('POST', `/api/results/${encodeURIComponent(id)}/email`),
  myResults: () => call('GET', '/api/my-results'),
  signOut: () => call('POST', '/api/sign-out'),
  deleteAccount: (password) => call('DELETE', '/api/me', { password }),
};

// ---------- Ballot plan: starred races and candidates, and mock ballot choices ----------
// Saved in this browser for everyone, and to the account when signed in, so the
// list follows the voter to another device.

const EMPTY_PLAN = () => ({ starred_races: [], starred_candidates: [], picks: {} });
const listeners = new Set();
let saveTimer;

function readPlan() {
  const p = getJSON(KEYS.plan, null);
  return p && typeof p === 'object' ? { ...EMPTY_PLAN(), ...p } : EMPTY_PLAN();
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
  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  isStarred(kind, id) {
    const p = readPlan();
    return (kind === 'race' ? p.starred_races : p.starred_candidates).includes(id);
  },
  toggleStar(kind, id) {
    const p = readPlan();
    const key = kind === 'race' ? 'starred_races' : 'starred_candidates';
    p[key] = p[key].includes(id) ? p[key].filter((x) => x !== id) : [...p[key], id];
    writePlan(p);
    return p[key].includes(id);
  },
  pick(raceId, candidateId) {
    const p = readPlan();
    if (candidateId) p.picks[raceId] = candidateId;
    else delete p.picks[raceId];
    writePlan(p);
  },
  clearPicks() {
    const p = readPlan();
    p.picks = {};
    writePlan(p);
  },
  // After signing in, combine what was saved on this device with the account copy.
  async sync() {
    if (!session.token) return;
    const local = readPlan();
    const { plan: remote } = await api.getPlan();
    const merged = {
      starred_races: [...new Set([...remote.starred_races, ...local.starred_races])],
      starred_candidates: [...new Set([...remote.starred_candidates, ...local.starred_candidates])],
      picks: { ...remote.picks, ...local.picks },
    };
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
