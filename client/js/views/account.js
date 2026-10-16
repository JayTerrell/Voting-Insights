// Accounts: sign up, sign in, password reset, and the account page with saved
// results. Browsing the guide never needs an account; the quiz does.

import { $, esc, setTitle, formatDate, skeleton, toast, countyLabel } from '../ui.js';
import { api, session, resultCache, loadGuide, loadFormOptions, ballotCounty, startSession, plan } from '../api.js';
import { navigate } from '../app.js';

const MIN_PASSWORD = 8;

// Only same-site paths are accepted as a destination after signing in.
export function nextPath(fallback = '/account') {
  const next = new URLSearchParams(location.search).get('next') || '';
  return /^\/[\w\-/]*$/.test(next) && !next.startsWith('//') ? next : fallback;
}

const withNext = (path, next) => (next && next !== '/account' ? `${path}?next=${encodeURIComponent(next)}` : path);

function showError(el, message) {
  el.textContent = message;
  el.hidden = false;
}

async function submitting(form, work) {
  const btn = form.querySelector('button[type=submit]');
  const err = form.querySelector('.form-error');
  err.hidden = true;
  btn.disabled = true;
  try {
    await work(err);
  } catch (ex) {
    showError(err, ex.message);
  } finally {
    btn.disabled = false;
  }
}

// ---------- Google and Apple ----------

// Brand marks as the providers' guidelines require them on sign-in buttons.
const GOOGLE_MARK = `<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.8c4.3-4 6.9-9.9 6.9-17.2z"/><path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s.9 7.4 2.7 10.7l7.8-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.8c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.2-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>`;
const APPLE_MARK = `<svg viewBox="0 0 384 512" aria-hidden="true"><path fill="currentColor" d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/></svg>`;

export function providerButtons(providers, next) {
  if (!providers || !providers.length) return '';
  const q = `?next=${encodeURIComponent(next || '/account')}`;
  const btn = {
    google: `<a class="btn-provider" href="/api/auth/google/start${q}">${GOOGLE_MARK}<span>Continue with Google</span></a>`,
    apple: `<a class="btn-provider" href="/api/auth/apple/start${q}">${APPLE_MARK}<span>Continue with Apple</span></a>`,
  };
  return `<div class="provider-row">${providers.map((p) => btn[p] || '').join('')}</div>
    <p class="or-rule"><span>or use your email</span></p>`;
}

const AUTH_ERRORS = {
  cancelled: 'Sign-in was cancelled. You can try again or use your email and password.',
  failed: 'We could not finish signing you in. Please try again, or use your email and password.',
  unavailable: 'That sign-in option is not available right now. Please use your email and password.',
};

// ---------- Sign up ----------

export function signUpForm(guide, options, { next = '/account', intro = '' } = {}) {
  const preferred = ballotCounty.get(guide);
  const countyOpts = options.counties
    .map((c) => `<option value="${esc(c)}" ${c === preferred ? 'selected' : ''}>${esc(countyLabel(c))}</option>`)
    .join('');
  const ageOpts = options.age_ranges.map((a) => `<option>${esc(a)}</option>`).join('');
  return `
    ${intro}
    <form class="panel" id="signup" novalidate>
      ${providerButtons(options.auth_providers, next)}
      <div class="form-grid">
        <div><label for="fn">First name</label><input id="fn" name="first_name" type="text" autocomplete="given-name" maxlength="60" required></div>
        <div><label for="ln">Last name</label><input id="ln" name="last_name" type="text" autocomplete="family-name" maxlength="60" required></div>
        <div class="full"><label for="em">Email address</label><input id="em" name="email" type="email" autocomplete="email" maxlength="254" required></div>
        <div class="full"><label for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="new-password" minlength="${MIN_PASSWORD}" maxlength="200" required>
          <p class="form-note">At least ${MIN_PASSWORD} characters. A short phrase is easier to remember and harder to guess.</p></div>
        <div><label for="co">County where you vote</label><select id="co" name="county" required>${countyOpts}</select>
          <p class="form-note">Your quiz results and ballot cover this county's races.</p></div>
        <div><label for="ag">Age range</label><select id="ag" name="age_range" required><option value="">Choose one</option>${ageOpts}</select></div>
        <div class="full">
          <label class="check"><input type="checkbox" name="agree_terms" required> <span>I agree to the <a href="/terms" target="_blank">Terms of Use</a> and <a href="/privacy" target="_blank">Privacy Policy</a>.</span></label>
          <label class="check"><input type="checkbox" name="marketing_ok"> <span>Email me when this guide is updated for future elections. (Optional)</span></label>
        </div>
      </div>
      <p class="form-error" role="alert" hidden></p>
      <div class="btn-row" style="margin-top:18px"><button class="btn btn-red" type="submit">Create my account</button>
        <span class="small">Already have an account? <a href="${esc(withNext('/sign-in', next))}">Sign in</a></span></div>
    </form>`;
}

export function bindSignUp(view, onDone) {
  const form = $('#signup', view);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submitting(form, async (err) => {
      const fd = new FormData(form);
      if (String(fd.get('password')).length < MIN_PASSWORD) {
        return showError(err, `Please choose a password of at least ${MIN_PASSWORD} characters.`);
      }
      try {
        const res = await api.signUp({
          first_name: fd.get('first_name'),
          last_name: fd.get('last_name'),
          email: fd.get('email'),
          password: fd.get('password'),
          county: fd.get('county'),
          age_range: fd.get('age_range'),
          agree_terms: fd.get('agree_terms') === 'on',
          marketing_ok: fd.get('marketing_ok') === 'on',
        });
        await startSession(res);
        ballotCounty.set(res.user.county);
        onDone(res);
      } catch (ex) {
        if (ex.status === 409) {
          err.innerHTML = `${esc(ex.message)} <a href="/sign-in">Sign in</a> or <a href="/forgot-password">reset your password</a>.`;
          err.hidden = false;
          return;
        }
        throw ex;
      }
    });
  });
}

export async function renderSignUp(view, _params, current) {
  setTitle('Create an account');
  if (session.token) return navigate(nextPath(), { replace: true });
  const [guide, options] = await Promise.all([loadGuide(), loadFormOptions()]);
  if (!current()) return;
  const next = nextPath();
  view.innerHTML = `<div class="quiz-shell">
    <span class="eyebrow">Free account</span>
    <h1>Create your account</h1>
    <p class="lede">An account lets you take the issue quiz, keep every result with its date and time, star the races you care about, and save your mock ballot on any device. Reading the candidate guide never requires an account.</p>
    ${signUpForm(guide, options, { next })}</div>`;
  bindSignUp(view, () => navigate(next, { replace: true }));
}

// ---------- Sign in ----------

export function signInForm(next = '/account', providers = []) {
  return `<form class="panel" id="signin" novalidate>
      ${providerButtons(providers, next)}
      <label for="si-em">Email address</label>
      <input id="si-em" name="email" type="email" autocomplete="email" maxlength="254" required>
      <label for="si-pw" style="margin-top:12px">Password</label>
      <input id="si-pw" name="password" type="password" autocomplete="current-password" maxlength="200" required>
      <p class="form-error" role="alert" hidden></p>
      <div class="btn-row" style="margin-top:16px"><button class="btn" type="submit">Sign in</button>
        <a href="/forgot-password">Forgot your password?</a></div>
      <p class="small" style="margin:14px 0 0">New here? <a href="${esc(withNext('/sign-up', next))}">Create a free account</a></p>
    </form>`;
}

export function bindSignIn(view, onDone) {
  const form = $('#signin', view);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submitting(form, async (err) => {
      const fd = new FormData(form);
      try {
        const res = await api.signIn(fd.get('email'), fd.get('password'));
        await startSession(res);
        onDone(res);
      } catch (ex) {
        if (ex.message.includes('Forgot your password')) {
          err.innerHTML = `${esc(ex.message)} <a href="/forgot-password">Set a password</a>`;
          err.hidden = false;
          return;
        }
        throw ex;
      }
    });
  });
}

export async function renderSignIn(view, _params, current) {
  setTitle('Sign in');
  if (session.token) return navigate(nextPath(), { replace: true });
  const options = await loadFormOptions();
  if (!current()) return;
  const next = nextPath();
  const error = AUTH_ERRORS[new URLSearchParams(location.search).get('error')];
  view.innerHTML = `<div class="quiz-shell">
    <span class="eyebrow">Account</span>
    <h1>Sign in</h1>
    <p class="lede">Sign in to take the quiz, see your saved results, and open your starred races and mock ballot.</p>
    ${error ? `<div class="callout" role="alert" style="margin-bottom:16px">${esc(error)}</div>` : ''}
    ${signInForm(next, options.auth_providers)}</div>`;
  bindSignIn(view, () => navigate(next, { replace: true }));
}

// ---------- After Google or Apple ----------

// The server redirects here with a session token in the URL fragment.
export async function renderAuthComplete(view) {
  setTitle('Signing in');
  const params = new URLSearchParams(location.hash.slice(1));
  const token = params.get('token') || '';
  const next = /^\/[\w\-/]*$/.test(params.get('next') || '') ? params.get('next') : '/account';
  history.replaceState({}, '', '/auth/complete');
  if (!token) return navigate('/sign-in?error=failed', { replace: true });
  view.innerHTML = `<h1>Signing you in</h1>${skeleton('list')}`;
  try {
    session.set(token, null);
    const me = await api.me();
    await startSession({ token, user: me.user });
    ballotCounty.set(me.user.county);
    navigate(next, { replace: true });
  } catch {
    session.clear();
    navigate('/sign-in?error=failed', { replace: true });
  }
}

// New Google or Apple users add the details the quiz needs.
export async function renderFinishSignUp(view, _params, current) {
  setTitle('Finish creating your account');
  const params = new URLSearchParams(location.hash.slice(1));
  const ticket = params.get('ticket') || '';
  const next = /^\/[\w\-/]*$/.test(params.get('next') || '') ? params.get('next') : '/account';
  history.replaceState({}, '', '/finish-sign-up');
  const [guide, options] = await Promise.all([loadGuide(), loadFormOptions()]);
  if (!current()) return;
  let pending;
  try {
    pending = await api.authPending(ticket);
  } catch (e) {
    view.innerHTML = `<h1>This sign-up link has expired</h1><p>${esc(e.message)} <a href="/sign-up">Start again</a>.</p>`;
    return;
  }
  const label = pending.provider === 'apple' ? 'Apple' : 'Google';
  const preferred = ballotCounty.get(guide);
  view.innerHTML = `<div class="quiz-shell">
    <span class="eyebrow">Almost done</span>
    <h1>Finish creating your account</h1>
    <p class="lede">You signed in with ${esc(label)}${pending.email ? ` as ${esc(pending.email)}` : ''}. Add a few details so your quiz results and ballot match the races where you vote.</p>
    ${
      pending.email
        ? `<form class="panel" id="finish" novalidate>
      <div class="form-grid">
        <div><label for="fs-fn">First name</label><input id="fs-fn" name="first_name" maxlength="60" autocomplete="given-name" required value="${esc(pending.first_name || '')}"></div>
        <div><label for="fs-ln">Last name</label><input id="fs-ln" name="last_name" maxlength="60" autocomplete="family-name" required value="${esc(pending.last_name || '')}"></div>
        <div><label for="fs-co">County where you vote</label><select id="fs-co" name="county" required>${options.counties
          .map((c) => `<option value="${esc(c)}" ${c === preferred ? 'selected' : ''}>${esc(countyLabel(c))}</option>`)
          .join('')}</select></div>
        <div><label for="fs-ag">Age range</label><select id="fs-ag" name="age_range" required><option value="">Choose one</option>${options.age_ranges
          .map((a) => `<option>${esc(a)}</option>`)
          .join('')}</select></div>
        <div class="full">
          <label class="check"><input type="checkbox" name="agree_terms" required> <span>I agree to the <a href="/terms" target="_blank">Terms of Use</a> and <a href="/privacy" target="_blank">Privacy Policy</a>.</span></label>
          <label class="check"><input type="checkbox" name="marketing_ok"> <span>Email me when this guide is updated for future elections. (Optional)</span></label>
        </div>
      </div>
      <p class="form-error" role="alert" hidden></p>
      <div class="btn-row" style="margin-top:18px"><button class="btn btn-red" type="submit">Create my account</button></div>
    </form>`
        : `<div class="callout">Your ${esc(label)} account did not share a verified email address, which we need to save your results. Please <a href="/sign-up">sign up with your email</a> instead.</div>`
    }</div>`;
  const form = $('#finish', view);
  if (!form) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submitting(form, async () => {
      const fd = new FormData(form);
      const res = await api.authComplete({
        ticket,
        first_name: fd.get('first_name'),
        last_name: fd.get('last_name'),
        county: fd.get('county'),
        age_range: fd.get('age_range'),
        agree_terms: fd.get('agree_terms') === 'on',
        marketing_ok: fd.get('marketing_ok') === 'on',
      });
      await startSession(res);
      ballotCounty.set(res.user.county);
      navigate(next, { replace: true });
    });
  });
}

// ---------- Password reset ----------

export function renderForgot(view) {
  setTitle('Reset your password');
  view.innerHTML = `<div class="quiz-shell">
    <span class="eyebrow">Account</span>
    <h1>Reset your password</h1>
    <p class="lede">Enter the email address on your account and we will send a link to choose a new password. The link expires in one hour. If you took the quiz before accounts had passwords, use this to set your first password.</p>
    <form class="panel" id="forgot" novalidate>
      <label for="fg-em">Email address</label>
      <input id="fg-em" name="email" type="email" autocomplete="email" maxlength="254" required>
      <p class="form-error" role="alert" hidden></p>
      <div class="btn-row" style="margin-top:16px"><button class="btn" type="submit">Email me a reset link</button><a href="/sign-in">Back to sign in</a></div>
    </form></div>`;
  const form = $('#forgot', view);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submitting(form, async () => {
      await api.forgotPassword(new FormData(form).get('email'));
      form.outerHTML = `<div class="callout" role="status">If an account uses that address, a reset link is on its way. Check your inbox and spam folder. The link expires in one hour.</div>`;
    });
  });
}

export function renderReset(view) {
  setTitle('Choose a new password');
  // The token arrives in the URL fragment so it never reaches server logs.
  const token = new URLSearchParams(location.hash.slice(1)).get('token') || '';
  history.replaceState({}, '', '/reset-password');
  if (!token) {
    view.innerHTML = `<h1>This reset link is incomplete</h1><p>Open the link from your email again, or <a href="/forgot-password">request a new one</a>.</p>`;
    return;
  }
  view.innerHTML = `<div class="quiz-shell">
    <span class="eyebrow">Account</span>
    <h1>Choose a new password</h1>
    <form class="panel" id="reset" novalidate>
      <label for="rs-pw">New password</label>
      <input id="rs-pw" name="password" type="password" autocomplete="new-password" minlength="${MIN_PASSWORD}" maxlength="200" required>
      <p class="form-note">At least ${MIN_PASSWORD} characters. Saving it signs you out on every other device.</p>
      <p class="form-error" role="alert" hidden></p>
      <div class="btn-row" style="margin-top:16px"><button class="btn" type="submit">Save my new password</button></div>
    </form></div>`;
  const form = $('#reset', view);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submitting(form, async (err) => {
      const password = String(new FormData(form).get('password'));
      if (password.length < MIN_PASSWORD)
        return showError(err, `Please choose a password of at least ${MIN_PASSWORD} characters.`);
      const res = await api.resetPassword(token, password);
      await startSession(res);
      toast('Your new password is saved.');
      navigate('/account', { replace: true });
    });
  });
}

// ---------- Account page ----------

export async function renderAccount(view, _params, current) {
  setTitle('My Account');
  if (!session.token) return navigate('/sign-in?next=/account', { replace: true });
  view.innerHTML = `<span class="eyebrow">My Account</span><h1>Your account</h1>${skeleton('list')}`;
  let data;
  try {
    const [results, me] = await Promise.all([api.myResults(), api.me()]);
    data = { ...results, providers: me.providers };
    session.set(session.token, me.user);
  } catch (e) {
    if (e.status === 401) {
      session.clear();
      return navigate('/sign-in?next=/account', { replace: true });
    }
    // Offline or server trouble: fall back to results cached on this device.
    const cached = Object.values(resultCache.all());
    if (!cached.length) throw e;
    data = {
      offline: true,
      results: cached.map((r) => ({
        share_id: r.share_id,
        created_at: r.created_at,
        answered: r.results.answered,
        parties: r.results.parties,
      })),
    };
  }
  const [guide, options] = await Promise.all([loadGuide(), loadFormOptions()]);
  if (!current()) return;
  drawAccount(view, data, guide, options);
}

function resultRows(results) {
  return results
    .map((r) => {
      const best = [...r.parties].filter((p) => p.score !== null).sort((a, b) => b.score - a.score)[0];
      return `<tr><td>${esc(formatDate(r.created_at))}</td><td class="num">${r.answered}</td>
        <td>${best ? `${esc(best.name)} (${best.score}%)` : ''}</td><td><a href="/results/${esc(r.share_id)}">View results</a></td></tr>`;
    })
    .join('');
}

function drawAccount(view, data, guide, options) {
  const u = session.user || {};
  const providers = data.providers || [];
  const hasPassword = u.has_password !== false;
  const p = plan.get();
  const starredCount = p.starred_races.length + p.starred_candidates.length;
  const pickCount = Object.keys(p.picks).length;
  const countyOpts = options.counties
    .map((c) => `<option value="${esc(c)}" ${c === u.county ? 'selected' : ''}>${esc(countyLabel(c))}</option>`)
    .join('');
  const ageOpts = options.age_ranges.map((a) => `<option ${a === u.age_range ? 'selected' : ''}>${esc(a)}</option>`).join('');

  view.innerHTML = `
    <span class="eyebrow">My Account</span>
    <h1>${esc(u.first_name ? `Welcome, ${u.first_name}` : 'Your account')}</h1>
    <p class="lede">Signed in as ${esc(u.email || '')}. Your ballot: ${esc(countyLabel(u.county || ballotCounty.get(guide)))}.</p>
    ${data.offline ? '<div class="callout" style="margin-bottom:16px">We could not reach the server, so this page shows results saved on this device.</div>' : ''}

    <div class="account-grid">
      <a class="account-tile" href="/my-ballot"><span class="label">My Ballot</span><b>${pickCount}</b><span>choices marked</span></a>
      <a class="account-tile" href="/my-ballot?show=starred"><span class="label">My Shortlist</span><b>${starredCount}</b><span>races and candidates starred</span></a>
      <a class="account-tile" href="/quiz"><span class="label">Issue Quiz</span><b>${data.results.length}</b><span>${data.results.length === 1 ? 'result' : 'results'} saved</span></a>
    </div>

    <section aria-labelledby="hist-h">
      <div class="section-head"><h2 id="hist-h">Your quiz results</h2><a href="/quiz">${data.results.length ? 'Retake the quiz' : 'Take the quiz'}</a></div>
      ${
        data.results.length
          ? `<table class="ballot"><thead><tr><th>Taken (Central Time)</th><th class="num">Questions answered</th><th>Closest party platform</th><th></th></tr></thead><tbody>${resultRows(data.results)}</tbody></table>`
          : '<p>You have not completed the quiz yet.</p>'
      }
    </section>

    <section aria-labelledby="prof-h">
      <div class="section-head"><h2 id="prof-h">Profile</h2></div>
      <form class="panel" id="profile" novalidate>
        <div class="form-grid">
          <div><label for="pf-fn">First name</label><input id="pf-fn" name="first_name" maxlength="60" autocomplete="given-name" value="${esc(u.first_name || '')}"></div>
          <div><label for="pf-ln">Last name</label><input id="pf-ln" name="last_name" maxlength="60" autocomplete="family-name" value="${esc(u.last_name || '')}"></div>
          <div><label for="pf-co">County where you vote</label><select id="pf-co" name="county">${countyOpts}</select></div>
          <div><label for="pf-ag">Age range</label><select id="pf-ag" name="age_range">${ageOpts}</select></div>
          <div class="full"><label class="check"><input type="checkbox" name="marketing_ok" ${u.marketing_ok ? 'checked' : ''}> <span>Email me when this guide is updated for future elections.</span></label></div>
        </div>
        <p class="form-error" role="alert" hidden></p>
        <div class="btn-row" style="margin-top:14px"><button class="btn btn-small" type="submit">Save profile</button></div>
      </form>
    </section>

    <section aria-labelledby="pw-h">
      <div class="section-head"><h2 id="pw-h">Password and sign out</h2></div>
      <form class="panel" id="chpw" novalidate>
        ${
          providers.length
            ? `<p style="margin-top:0">Linked sign-in: ${providers.map((p) => (p === 'apple' ? 'Apple' : 'Google')).join(' and ')}.</p>`
            : ''
        }
        <div class="form-grid">
          ${
            hasPassword
              ? `<div><label for="cp-cur">Current password</label><input id="cp-cur" name="current" type="password" autocomplete="current-password" maxlength="200"></div>`
              : ''
          }
          <div><label for="cp-new">${hasPassword ? 'New password' : 'Add a password (optional)'}</label><input id="cp-new" name="next" type="password" autocomplete="new-password" minlength="${MIN_PASSWORD}" maxlength="200"></div>
        </div>
        <p class="form-note">${hasPassword ? 'Changing your password signs you out on every other device.' : 'A password lets you sign in with your email address as well.'}</p>
        <p class="form-error" role="alert" hidden></p>
        <div class="btn-row" style="margin-top:14px"><button class="btn btn-small" type="submit">${hasPassword ? 'Change password' : 'Save password'}</button>
          <button class="btn btn-ghost btn-small" type="button" id="signout">Sign out on this device</button></div>
      </form>
    </section>

    <details class="panel" style="margin-top:32px">
      <summary><b>Delete my account and data</b></summary>
      <p style="margin-top:12px">This permanently deletes your name, email, county, age range, every saved result, your starred races, and your mock ballot. Shared links to your results will stop working. This cannot be undone.</p>
      <form id="del" novalidate>
        ${
          hasPassword
            ? `<label for="del-pw">Enter your password to confirm</label>
        <input id="del-pw" name="password" type="password" autocomplete="current-password" maxlength="200" style="max-width:320px">`
            : `<label for="del-pw">Type your email address to confirm</label>
        <input id="del-pw" name="confirm_email" type="email" autocomplete="off" maxlength="254" style="max-width:320px">`
        }
        <p class="form-error" role="alert" hidden></p>
        <div class="btn-row" style="margin-top:12px"><button class="btn btn-red btn-small" type="submit">Delete everything</button></div>
      </form>
    </details>`;

  const profile = $('#profile', view);
  profile.addEventListener('submit', (e) => {
    e.preventDefault();
    submitting(profile, async () => {
      const fd = new FormData(profile);
      const res = await api.updateProfile({
        first_name: fd.get('first_name'),
        last_name: fd.get('last_name'),
        county: fd.get('county'),
        age_range: fd.get('age_range'),
        marketing_ok: fd.get('marketing_ok') === 'on',
      });
      session.set(session.token, res.user);
      ballotCounty.set(res.user.county);
      toast('Profile saved.');
    });
  });

  const chpw = $('#chpw', view);
  chpw.addEventListener('submit', (e) => {
    e.preventDefault();
    submitting(chpw, async (err) => {
      const fd = new FormData(chpw);
      if (String(fd.get('next')).length < MIN_PASSWORD) {
        return showError(err, `Please choose a new password of at least ${MIN_PASSWORD} characters.`);
      }
      const res = await api.changePassword(fd.get('current') || '', fd.get('next'));
      session.set(res.token, res.user);
      chpw.reset();
      toast('Password changed.');
    });
  });

  $('#signout', view).addEventListener('click', async () => {
    await api.signOut().catch(() => {});
    session.clear();
    navigate('/', { replace: true });
  });

  const del = $('#del', view);
  del.addEventListener('submit', (e) => {
    e.preventDefault();
    submitting(del, async () => {
      if (!confirm('Delete your account and all saved data permanently?')) return;
      const fd = new FormData(del);
      await api.deleteAccount({ password: fd.get('password') || '', confirm_email: fd.get('confirm_email') || '' });
      session.clear();
      view.innerHTML =
        '<h1>Your data has been deleted</h1><p>Your account, saved results, starred races, and mock ballot have been removed. <a href="/">Return to the home page</a>.</p>';
    });
  });
}
