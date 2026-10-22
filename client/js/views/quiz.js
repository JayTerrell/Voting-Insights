import { $, $$, esc, setTitle, skeleton, countyLabel, sidesBlock } from '../ui.js';
import { api, loadGuide, loadFormOptions, session, progress, resultCache, ballotCounty, track } from '../api.js';
import { signUpForm, bindSignUp, signInForm, bindSignIn } from './account.js';
import { choices, IMPORTANCE } from '../shared/scoring.js';
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

  if (!session.token) return renderGate(view, guide, options);
  const saved = progress.get();
  if (saved && saved.started) return runQuestions(view, guide, saved);
  renderStart(view, guide);
}

// Taking the quiz needs a free account, so results are saved privately to it.
function renderGate(view, guide, options) {
  view.innerHTML = `
  <div class="quiz-shell">
    <span class="eyebrow">Issue Alignment Quiz</span>
    <h1>Create a free account to take the quiz</h1>
    <p class="lede">Your results are saved privately to your account with the date and time of each attempt, and we email you a copy. Retake the quiz any time. Browsing candidates and races never requires an account.</p>
    <div class="gate-grid">
      <div>${signUpForm(guide, options, { next: '/quiz' })}</div>
      <div><h2 class="h4">Already have an account?</h2>${signInForm('/quiz')}</div>
    </div>
  </div>`;
  bindSignUp(view, () => renderStart(view, guide));
  bindSignIn(view, () => renderQuiz(view, [], () => true));
}

function renderStart(view, guide) {
  const u = session.user || {};
  const county = guide.ballots && Object.hasOwn(guide.ballots, u.county) ? u.county : ballotCounty.get(guide);
  view.innerHTML = `
  <div class="quiz-shell">
    <span class="eyebrow">Issue Alignment Quiz</span>
    <h1>${esc(u.first_name ? `Ready when you are, ${u.first_name}` : 'Ready when you are')}</h1>
    <p class="lede">For each question, choose which of two views is closer to yours and say how much it matters to you. We compare your answers with the documented positions of every candidate on the ${esc(countyLabel(county))} ballot and with each party's official platform.</p>
    <div class="panel">
      <p style="margin-top:0">Your results are saved to your account (${esc(u.email || '')}) and a copy is emailed to you. Voting somewhere else? <a href="/settings">Change your county</a> first.</p>
      <div class="btn-row"><button class="btn btn-red" id="begin">Begin the quiz</button>
      <span class="small muted">${guide.questions.length} questions, about 6 minutes</span></div>
    </div>
  </div>`;
  $('#begin', view).addEventListener('click', () => {
    track('quiz_start');
    start(view, guide);
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
          <legend class="q-statement">${esc(q.prompt)}</legend>
          ${sidesBlock(q)}
          <p class="ab-ask">Which view is closer to yours?</p>
          <div class="scale ab-scale">
            ${choices(q)
              .map(
                (s) =>
                  `<label class="${s.side ? `side-${s.side}` : 'side-mid'}"><input type="radio" name="pos" value="${s.value}" ${a.value === s.value ? 'checked' : ''}><span>${esc(s.label)}</span></label>`
              )
              .join('')}
          </div>
          <details class="context"><summary>Background on this issue</summary><p>${esc(q.context)}</p></details>
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
      <p class="lede">You answered ${answered} of ${total} questions${skipped.length ? ` and skipped ${skipped.length}` : ''}. When you submit, your results are saved to your account and a copy is emailed to ${esc(session.user?.email || 'you')}.</p>
      ${
        skipped.length
          ? `<div class="panel"><h2 class="h4" style="font-size:1.1rem">Skipped questions</h2><ul>${skipped
              .map((q) => `<li><button class="linkish" data-goto="${qs.indexOf(q)}">${esc(q.prompt)}</button></li>`)
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
          // Keep the answers on this device so they survive signing back in.
          session.set(null, null);
          e2.innerHTML = `${esc(ex.message)} <a href="/sign-in?next=/quiz">Sign in</a> and your answers will still be here.`;
        }
      }
    });
  }

  renderQ();
}
