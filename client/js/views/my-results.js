import { $, esc, setTitle, formatDate, skeleton } from '../ui.js';
import { api, session, resultCache } from '../api.js';
import { navigate } from '../app.js';

export async function renderMyResults(view, _params, current) {
  setTitle('My Results');
  if (session.token) {
    view.innerHTML = `<span class="eyebrow">My Results</span><h1>Your saved results</h1>${skeleton('list')}`;
    try {
      const data = await api.myResults();
      if (!current()) return;
      return drawList(view, data);
    } catch (e) {
      if (e.status !== 401) {
        // Offline or server trouble: fall back to results cached on this device.
        const cached = Object.values(resultCache.all());
        if (cached.length) return drawList(view, { user: session.user, results: cached.map(summaryFromCache), offline: true });
        throw e;
      }
      session.clear();
    }
  }
  drawEmailForm(view);
}

function summaryFromCache(r) {
  return { share_id: r.share_id, created_at: r.created_at, answered: r.results.answered, parties: r.results.parties };
}

function drawEmailForm(view, presetEmail = '') {
  view.innerHTML = `
    <div class="quiz-shell">
      <span class="eyebrow">My Results</span>
      <h1>Find your saved results</h1>
      <p class="lede">Enter the email address you used when you took the quiz. To protect your privacy, we will send a 6-digit code to that address before showing your results.</p>
      <form class="panel" id="lookup" novalidate>
        <label for="em">Email address</label>
        <input id="em" type="email" autocomplete="email" required value="${esc(presetEmail)}">
        <p class="form-error" id="err" role="alert" hidden></p>
        <div class="btn-row" style="margin-top:16px"><button class="btn" type="submit">Send my code</button><a href="/quiz">Take the quiz instead</a></div>
      </form>
    </div>`;
  $('#lookup', view).addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#em', view).value.trim();
    const err = $('#err', view);
    err.hidden = true;
    try {
      await api.lookup(email);
      drawCodeForm(view, email);
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
  });
}

function drawCodeForm(view, email) {
  view.innerHTML = `
    <div class="quiz-shell">
      <span class="eyebrow">My Results</span>
      <h1>Enter your code</h1>
      <p class="lede">If ${esc(email)} has saved results, a 6-digit code is on its way. It expires in 15 minutes. Check your spam folder if it does not arrive within a minute.</p>
      <form class="panel" id="verify" novalidate>
        <label for="code">Verification code</label>
        <input id="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" style="max-width:220px;font-size:1.4rem;letter-spacing:0.3em">
        <p class="form-error" id="err" role="alert" hidden></p>
        <div class="btn-row" style="margin-top:16px"><button class="btn" type="submit">View my results</button><button class="linkish" type="button" id="again">Use a different email</button></div>
      </form>
    </div>`;
  $('#code', view).focus();
  $('#again', view).addEventListener('click', () => drawEmailForm(view, email));
  $('#verify', view).addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#err', view);
    err.hidden = true;
    try {
      const res = await api.verify(email, $('#code', view).value);
      session.set(res.token, res.user);
      const data = await api.myResults();
      drawList(view, data);
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
  });
}

function drawList(view, data) {
  const rows = data.results
    .map((r) => {
      const best = [...r.parties].filter((p) => p.score !== null).sort((a, b) => b.score - a.score)[0];
      return `<tr>
        <td>${esc(formatDate(r.created_at))}</td>
        <td class="num">${r.answered}</td>
        <td>${best ? `${esc(best.name)} (${best.score}%)` : ''}</td>
        <td><a href="/results/${esc(r.share_id)}">View results</a></td></tr>`;
    })
    .join('');
  view.innerHTML = `
    <span class="eyebrow">My Results</span>
    <h1>${esc(data.user?.first_name || 'Your')}${data.user?.first_name ? "'s" : ''} saved results</h1>
    <p class="lede">Every time you take the quiz, the result is saved here with its date and time${data.user?.email ? ` under ${esc(data.user.email)}` : ''}.</p>
    ${data.offline ? '<div class="callout" style="margin-bottom:16px">We could not reach the server, so this list shows results saved on this device.</div>' : ''}
    ${
      data.results.length
        ? `<table class="ballot"><thead><tr><th>Taken (Central Time)</th><th class="num">Questions answered</th><th>Closest party platform</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
        : '<p>You have not completed the quiz yet.</p>'
    }
    <div class="btn-row" style="margin-top:20px">
      <a class="btn btn-red" href="/quiz">${data.results.length ? 'Retake the quiz' : 'Take the quiz'}</a>
      <button class="btn btn-ghost" id="signout">Sign out on this device</button>
    </div>
    <details class="panel" style="margin-top:32px">
      <summary><b>Delete my account and data</b></summary>
      <p style="margin-top:12px">This permanently deletes your name, email, county, age range, and every saved result. Shared links to your results will stop working. This cannot be undone.</p>
      <button class="btn btn-red btn-small" id="delete">Delete everything</button>
      <p class="form-error" id="del-err" role="alert" hidden></p>
    </details>`;
  $('#signout', view).addEventListener('click', async () => {
    await api.signOut().catch(() => {});
    session.clear();
    navigate('/my-results', { replace: true });
  });
  $('#delete', view).addEventListener('click', async () => {
    if (!confirm('Delete your account and all saved results permanently?')) return;
    try {
      await api.deleteAccount();
      session.clear();
      view.innerHTML =
        '<h1>Your data has been deleted</h1><p>Your account and all saved results have been removed. <a href="/">Return to the home page</a>.</p>';
    } catch (ex) {
      const err = $('#del-err', view);
      err.textContent = ex.message;
      err.hidden = false;
    }
  });
}
