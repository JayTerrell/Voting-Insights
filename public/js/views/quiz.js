import { $, $$, esc, setTitle, skeleton } from '../ui.js';
import { api, loadGuide, loadFormOptions, session, progress, resultCache, ballotCounty } from '../api.js';
import { SCALE, IMPORTANCE } from '../scoring.js';
import { navigate } from '../app.js';

const OFFICE_LABEL = {
  us_senate: 'U.S. Senate',
  us_house: 'U.S. House',
  governor: 'Governor',
  lt_governor: 'Lieutenant Governor',
  attorney_general: 'Attorney General',
  comptroller: 'Comptroller',
  land_commissioner: 'Land Commissioner',
  agriculture_commissioner: 'Agriculture Commissioner',
  railroad_commissioner: 'Railroad Commissioner',
  state_senate: 'Texas Senate',
  state_house: 'Texas House',
  county_judge: 'County Judge',
  county_commissioner: 'County Commissioner',
  district_attorney: 'District Attorney',
  judicial: 'Judicial races',
};

export async function renderQuiz(view, _params, current) {
  setTitle('Issue Quiz');
  const [guide, options] = await Promise.all([loadGuide(), loadFormOptions()]);
  if (!current()) return;

  const saved = progress.get();
  if (session.token && saved && saved.started) return runQuestions(view, guide, saved);
  renderRegistration(view, guide, options);
}

function renderRegistration(view, guide, options) {
  const u = session.user || {};
  const countyOpts = options.counties
    .map((c) => `<option ${c === (u.county || ballotCounty.get(guide)) ? 'selected' : ''}>${esc(c)}</option>`)
    .join('');
  const ageOpts = options.age_ranges.map((a) => `<option ${a === u.age_range ? 'selected' : ''}>${esc(a)}</option>`).join('');

  view.innerHTML = `
  <div class="quiz-shell">
    <span class="eyebrow">Issue Alignment Quiz</span>
    <h1>Before you begin</h1>
    <p class="lede">We save each set of results to your email address so you can find them later under My Results, and we email you a copy when you finish. You can retake the quiz any time and every attempt is kept with its date and time.</p>
    <form class="panel" id="reg" novalidate>
      <div class="form-grid">
        <div><label for="fn">First name</label><input id="fn" name="first_name" type="text" autocomplete="given-name" maxlength="60" required value="${esc(u.first_name || '')}"></div>
        <div><label for="ln">Last name</label><input id="ln" name="last_name" type="text" autocomplete="family-name" maxlength="60" required value="${esc(u.last_name || '')}"></div>
        <div class="full"><label for="em">Email address</label><input id="em" name="email" type="email" autocomplete="email" maxlength="254" required value="${esc(u.email || '')}">
          <p class="form-note">One account per email address. If this email has been used before, we will send a code to confirm it is yours.</p></div>
        <div><label for="co">County where you vote</label><select id="co" name="county" required>${countyOpts}</select>
          <p class="form-note">Your results cover the races on this county's ballot.</p></div>
        <div><label for="ag">Age range</label><select id="ag" name="age_range" required><option value="">Choose one</option>${ageOpts}</select></div>
        <div class="full">
          <label class="check"><input type="checkbox" name="agree_terms" required> <span>I agree to the <a href="/terms" target="_blank">Terms of Use</a> and <a href="/privacy" target="_blank">Privacy Policy</a>.</span></label>
          <label class="check"><input type="checkbox" name="marketing_ok"> <span>Email me when this guide is updated for future elections. (Optional)</span></label>
        </div>
      </div>
      <p class="form-error" id="reg-err" role="alert" hidden></p>
      <div class="btn-row" style="margin-top:18px"><button class="btn btn-red" type="submit">Begin the quiz</button>
      <span class="small muted">${guide.questions.length} questions, about 6 minutes</span></div>
    </form>
  </div>`;

  const form = $('#reg', view);
  const err = $('#reg-err', view);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    const fd = new FormData(form);
    const profile = {
      first_name: fd.get('first_name'),
      last_name: fd.get('last_name'),
      email: fd.get('email'),
      county: fd.get('county'),
      age_range: fd.get('age_range'),
      agree_terms: fd.get('agree_terms') === 'on',
      marketing_ok: fd.get('marketing_ok') === 'on',
    };
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      // A token from a different account would not match; drop it when the email changes.
      if (session.user && session.user.email !== String(profile.email).trim().toLowerCase()) session.clear();
      const res = await api.register(profile);
      if (res.verify) return renderCode(view, guide, profile);
      session.set(res.token, res.user);
      start(view, guide);
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      btn.disabled = false;
    }
  });
}

function renderCode(view, guide, profile) {
  view.innerHTML = `
  <div class="quiz-shell">
    <span class="eyebrow">Confirm your email</span>
    <h1>Check your inbox</h1>
    <p class="lede">${esc(profile.email)} already has saved results. We sent a 6-digit code to that address so we know it is you. The code expires in 15 minutes.</p>
    <form class="panel" id="code-form" novalidate>
      <label for="code">Verification code</label>
      <input id="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" style="max-width:220px;font-size:1.4rem;letter-spacing:0.3em">
      <p class="form-error" id="code-err" role="alert" hidden></p>
      <div class="btn-row" style="margin-top:16px"><button class="btn" type="submit">Confirm and continue</button><button class="linkish" type="button" id="back">Use a different email</button></div>
    </form>
  </div>`;
  $('#code', view).focus();
  $('#back', view).addEventListener('click', () => navigate('/quiz', { replace: true }));
  $('#code-form', view).addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#code-err', view);
    err.hidden = true;
    try {
      const res = await api.verify(profile.email, $('#code', view).value, profile);
      session.set(res.token, res.user);
      start(view, guide);
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
  });
}

function start(view, guide) {
  // Keep answers from an unfinished attempt on this device, if any.
  const prior = progress.get();
  const state = { started: true, index: 0, answers: (prior && prior.answers) || {} };
  progress.set(state);
  runQuestions(view, guide, state);
}

function runQuestions(view, guide, state) {
  const qs = guide.questions;
  const total = qs.length;

  function save() {
    progress.set(state);
  }

  function renderQ() {
    if (state.index >= total) return renderReview();
    const q = qs[state.index];
    const a = state.answers[q.id] || {};
    const pct = Math.round((state.index / total) * 100);
    const applies = q.offices.map((o) => OFFICE_LABEL[o] || o).join(', ');
    view.innerHTML = `
    <div class="quiz-shell">
      <div class="progress-meta"><span>Question ${state.index + 1} of ${total}</span><span>${esc(q.category)}</span></div>
      <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="Quiz progress"><span style="width:${pct}%"></span></div>
      <form id="qform">
        <fieldset>
          <legend class="q-statement">${esc(q.statement)}</legend>
          <details class="context"><summary>Background on this issue</summary><p>${esc(q.context)}</p></details>
          <div class="scale">
            ${SCALE.map(
              (s) =>
                `<label><input type="radio" name="pos" value="${s.value}" ${a.value === s.value ? 'checked' : ''}><span>${esc(s.label)}</span></label>`
            ).join('')}
          </div>
        </fieldset>
        <fieldset class="importance">
          <legend>How important is this issue to you?</legend>
          <div class="opts">
            ${IMPORTANCE.map(
              (i) =>
                `<label><input type="radio" name="imp" value="${i.value}" ${(a.weight ?? 1) === i.value ? 'checked' : ''}>${esc(i.label)}</label>`
            ).join('')}
          </div>
        </fieldset>
        <p class="applies">Used to compare candidates for: ${esc(applies)}. Also used for party platform alignment.</p>
        <div class="quiz-nav">
          <button type="button" class="btn btn-ghost" id="prev" ${state.index === 0 ? 'disabled' : ''}>Previous</button>
          <div class="btn-row">
            <button type="button" class="linkish" id="skip">Skip this question</button>
            <button type="submit" class="btn" id="next" ${a.value === undefined ? 'disabled' : ''}>${state.index === total - 1 ? 'Finish' : 'Next question'}</button>
          </div>
        </div>
      </form>
    </div>`;

    const form = $('#qform', view);
    const next = $('#next', view);
    form.addEventListener('change', () => {
      const pos = form.querySelector('input[name=pos]:checked');
      next.disabled = !pos;
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const pos = form.querySelector('input[name=pos]:checked');
      const imp = form.querySelector('input[name=imp]:checked');
      if (!pos) return;
      state.answers[q.id] = { value: Number(pos.value), weight: Number(imp ? imp.value : 1) };
      state.index += 1;
      save();
      renderQ();
      window.scrollTo(0, 0);
    });
    $('#skip', view).addEventListener('click', () => {
      delete state.answers[q.id];
      state.index += 1;
      save();
      renderQ();
      window.scrollTo(0, 0);
    });
    $('#prev', view).addEventListener('click', () => {
      state.index = Math.max(0, state.index - 1);
      save();
      renderQ();
    });
    form.querySelector('input[name=pos]:checked, input[name=pos]')?.focus({ preventScroll: true });
  }

  function renderReview() {
    const answered = Object.keys(state.answers).length;
    const skipped = qs.filter((q) => !state.answers[q.id]);
    view.innerHTML = `
    <div class="quiz-shell">
      <div class="progress" aria-hidden="true"><span style="width:100%"></span></div>
      <span class="eyebrow">Almost done</span>
      <h1>Ready to see your results</h1>
      <p class="lede">You answered ${answered} of ${total} questions${skipped.length ? ` and skipped ${skipped.length}` : ''}. When you submit, your results are saved to ${esc(session.user?.email || 'your email')} and a copy is emailed to you.</p>
      ${
        skipped.length
          ? `<div class="panel"><h2 class="h4" style="font-size:1.1rem">Skipped questions</h2><ul>${skipped
              .map((q) => `<li><button class="linkish" data-goto="${qs.indexOf(q)}">${esc(q.statement)}</button></li>`)
              .join('')}</ul></div>`
          : ''
      }
      <p class="form-error" id="sub-err" role="alert" hidden></p>
      <div class="quiz-nav">
        <button class="btn btn-ghost" id="back">Review answers</button>
        <button class="btn btn-red" id="submit" ${answered < 5 ? 'disabled' : ''}>See my results</button>
      </div>
      ${answered < 5 ? '<p class="small muted">Answer at least five questions to see meaningful results.</p>' : ''}
    </div>`;
    $$('[data-goto]', view).forEach((b) =>
      b.addEventListener('click', () => {
        state.index = Number(b.dataset.goto);
        save();
        renderQ();
      })
    );
    $('#back', view).addEventListener('click', () => {
      state.index = total - 1;
      save();
      renderQ();
    });
    $('#submit', view).addEventListener('click', async () => {
      const err = $('#sub-err', view);
      err.hidden = true;
      view.querySelector('#submit').disabled = true;
      const keep = view.innerHTML;
      view.innerHTML = `<div class="quiz-shell"><span class="eyebrow">Calculating</span><h1>Comparing your answers with every candidate</h1>${skeleton()}</div>`;
      try {
        const res = await api.submit(state.answers);
        resultCache.put({ ...res, first_name: session.user?.first_name, owner: true });
        progress.clear();
        navigate(`/results/${res.share_id}?new=1`, { replace: true });
      } catch (ex) {
        view.innerHTML = keep;
        const e2 = $('#sub-err', view);
        e2.textContent = ex.message;
        e2.hidden = false;
        if (ex.status === 401) {
          session.clear();
          e2.innerHTML = `${esc(ex.message)} <a href="/quiz">Start again</a>`;
        }
      }
    });
  }

  renderQ();
}
