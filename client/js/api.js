// Server calls and browser storage. Storage access is wrapped because private
// browsing modes can throw on localStorage.

const KEYS = { token: 'vi_token', user: 'vi_user', results: 'vi_results', progress: 'vi_progress', county: 'vi_county' };

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
    const saved = getJSON(KEYS.county, null);
    if (saved) return saved;
    const mine = session.user && session.user.county;
    if (mine) return mine;
    return Object.keys(guide.ballots || {})[0] || 'Collin';
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
    guidePromise = call('GET', '/api/guide').then((g) => {
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
export const loadFormOptions = () => (optionsPromise ||= call('GET', '/api/form-options'));

export const api = {
  register: (profile) => call('POST', '/api/register', profile),
  lookup: (email) => call('POST', '/api/lookup', { email }),
  submit: (answers) => call('POST', '/api/results', { answers }),
  result: (id) => call('GET', `/api/results/${encodeURIComponent(id)}`),
  emailResult: (id) => call('POST', `/api/results/${encodeURIComponent(id)}/email`),
  myResults: () => call('GET', '/api/my-results'),
  signOut: () => call('POST', '/api/sign-out'),
  deleteAccount: () => call('DELETE', '/api/me'),
};
