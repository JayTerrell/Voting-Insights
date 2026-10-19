// My Ballot: a mock ballot in official ballot order.
//
// Two ideas, kept separate:
//   My Picks   the candidates the voter chose, by filling in an oval here or with
//              "Choose for my ballot" on the candidate pages.
//   Watchlist  offices the voter starred to follow. A watched office with a pick
//              is "decided"; one without a pick is "undecided".
//
// Saved in this browser, and to the account when signed in. Nothing here is ever
// recommended for the voter.

import {
  $,
  $$,
  esc,
  setTitle,
  GROUPS,
  raceTitle,
  countyLabel,
  countyPicker,
  watchButton,
  miniCard,
  partyTag,
  formatDate,
  openModal,
  closeModal,
  accountGate,
  candidatePhoto,
} from '../ui.js';
import { loadGuide, loadFormOptions, ballotCounty, plan, session, resultCache } from '../api.js';
import { racesForCounty } from '../shared/scoring.js';
import { renderRace } from './guide.js';
import { navigate } from '../app.js';

const TABS = ['all', 'watch', 'picks'];

// The voter's most recent quiz result for this county, if one is saved on this device.
function latestMatches(county) {
  const mine = Object.values(resultCache.all())
    .filter((r) => r.owner && r.results && r.results.county === county)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (!mine) return null;
  const byCandidate = {};
  for (const race of mine.results.races) for (const c of race.candidates) byCandidate[c.id] = c;
  return byCandidate;
}

// Counts for the summary line and the tabs.
function tally(races, p) {
  const watched = races.filter((r) => p.starred_races.includes(r.id));
  return {
    picks: races.filter((r) => p.picks[r.id]),
    watched,
    decided: watched.filter((r) => p.picks[r.id]),
    undecided: watched.filter((r) => !p.picks[r.id]),
  };
}

function voteFor(race) {
  return race.candidates.length > 1 ? 'Vote for none or one' : 'Unopposed. Vote for none or one';
}

// Visitors without an account see the ballot read only: no ovals to fill,
// no watchlist, no printing.
const EMPTY_PLAN = { starred_races: [], starred_candidates: [], picks: {} };
const isGuest = () => !session.token;
const currentPlan = () => (isGuest() ? EMPTY_PLAN : plan.get());

function raceBlock(race, p, matches) {
  const guest = isGuest();
  const chosen = p.picks[race.id];
  const watched = p.starred_races.includes(race.id);
  const options = race.candidates
    .map((c) => {
      const id = `pick-${race.id}-${c.id}`;
      return `<div class="ballot-opt ${chosen === c.id ? 'chosen' : ''}" data-race="${esc(race.id)}" data-cand="${esc(c.id)}">
        <label class="oval-label" for="${esc(id)}">
          <input type="radio" id="${esc(id)}" name="pick-${esc(race.id)}" value="${esc(c.id)}" ${chosen === c.id ? 'checked' : ''} ${guest ? 'disabled' : ''}>
          <span class="oval" aria-hidden="true"></span><span class="sr-only">Choose ${esc(c.name)}</span>
        </label>
        ${miniCard(c, { match: matches && race.candidates.length > 1 ? matches[c.id] : null })}
      </div>`;
    })
    .join('');
  const status = watched ? `<span class="tag ${chosen ? 'tag-navy' : 'tag-red'}">${chosen ? 'Decided' : 'Undecided'}</span>` : '';
  return `<fieldset class="ballot-race ${guest ? 'read-only' : ''}" id="race-${esc(race.id)}">
    <legend class="sr-only">${esc(raceTitle(race))}</legend>
    <div class="ballot-race-head">
      <div><h3>${esc(raceTitle(race))}</h3><p class="vote-for">${voteFor(race)} ${status}</p></div>
      ${guest ? '' : watchButton(race.id, raceTitle(race))}
    </div>
    <div class="ballot-opts">${options}</div>
    <div class="ballot-race-foot">
      <a href="/candidates/${esc(race.id)}" data-compare="${esc(race.id)}">${race.candidates.length > 1 ? 'Compare candidates' : 'Read profile'}</a>
      ${chosen ? `<button type="button" class="linkish" data-clear="${esc(race.id)}">Clear choice</button>` : ''}
    </div>
  </fieldset>`;
}

// The comparison opens over the ballot so the voter keeps their place.
async function openCompare(raceId) {
  const modal = openModal({ title: 'Compare candidates', wide: true });
  modal.body.classList.add('modal-race');
  const title = document.title;
  await renderRace(modal.body, [raceId], modal.isOpen);
  document.title = title;
}

export async function renderBallot(view, _params, current) {
  setTitle('My Ballot');
  const [guide, options] = await Promise.all([loadGuide(), loadFormOptions()]);
  if (!current()) return;
  const qs = new URLSearchParams(location.search);
  let county = qs.get('county') && guide.ballots[qs.get('county')] ? qs.get('county') : ballotCounty.get(guide);
  // Old links used show=starred for the shortlist; that is now the watchlist.
  const requested = qs.get('show') === 'starred' ? 'watch' : qs.get('show');
  let show = TABS.includes(requested) ? requested : 'all';

  // Listeners attach to this wrapper, which is replaced on the next page, so they never pile up.
  view.innerHTML = `<div id="mb-root">
    <span class="eyebrow">My Ballot</span>
    <h1>Your mock ballot</h1>
    <p class="lede">Fill in an oval to pick a candidate, in the order the races appear on the official ballot. Star an office to add it to your watchlist while you decide. Then print your picks to take with you: Texas law does not allow phones or other wireless devices to be used within 100 feet of voting stations.</p>
    ${
      isGuest()
        ? `<div class="panel guest-gate"><h2>You are viewing a read-only ballot</h2>
        <p>Browse every race on your county's ballot below. To pick candidates, keep a watchlist, and print your ballot, create a free account.</p>
        <div class="btn-row"><a class="btn" href="/sign-up?next=/my-ballot">Create a free account</a><a class="btn btn-ghost" href="/sign-in?next=/my-ballot">Sign in</a></div></div>`
        : ''
    }
    <div class="ballot-toolbar">
      <div class="ballot-county">${countyPicker(guide, options.counties, county, 'mb-county')}</div>
      <div class="seg" role="tablist" aria-label="Which races to show" ${isGuest() ? 'hidden' : ''}>
        <button type="button" role="tab" data-show="all"></button>
        <button type="button" role="tab" data-show="watch"></button>
        <button type="button" role="tab" data-show="picks"></button>
      </div>
    </div>
    <div class="ballot-summary" id="mb-summary" aria-live="polite"></div>
    <div id="mb-out"></div></div>`;

  const root = $('#mb-root', view);
  const out = $('#mb-out', root);
  const races = () => racesForCounty(guide, county);

  function drawSummary() {
    if (isGuest()) {
      $('#mb-summary', root).innerHTML = '';
      return;
    }
    const p = plan.get();
    const all = races();
    const t = tally(all, p);
    const labels = {
      all: `All races (${all.length})`,
      watch: `Watchlist (${t.watched.length})`,
      picks: `My Picks (${t.picks.length})`,
    };
    $$('.seg [data-show]', root).forEach((b) => {
      b.textContent = labels[b.dataset.show];
      b.setAttribute('aria-selected', String(b.dataset.show === show));
    });
    const undecidedLinks = t.undecided
      .map((r) => `<a href="#race-${esc(r.id)}" data-goto="${esc(r.id)}">${esc(raceTitle(r))}</a>`)
      .join(', ');
    $('#mb-summary', root).innerHTML = `
      <p class="summary-line"><b>${t.picks.length}</b> ${t.picks.length === 1 ? 'pick' : 'picks'} on the ${esc(countyLabel(county))} ballot
        <span class="sep" aria-hidden="true">&middot;</span> Watchlist: <b>${t.decided.length}</b> decided, <b class="${t.undecided.length ? 'undecided' : ''}">${t.undecided.length}</b> undecided</p>
      ${t.undecided.length ? `<p class="small undecided-list">Still undecided: ${undecidedLinks}</p>` : ''}
      <div class="btn-row">
        <button type="button" class="btn btn-small" id="mb-print">Print my ballot</button>
        ${t.picks.length ? '<button type="button" class="linkish" id="mb-clear">Clear all picks</button>' : ''}
        ${latestMatches(county) ? '<span class="small muted">Match percentages come from your most recent quiz.</span>' : ''}
      </div>`;
  }

  function draw() {
    if (isGuest()) show = 'all';
    const p = currentPlan();
    const all = races();
    const t = tally(all, p);
    const shown = show === 'watch' ? t.watched : show === 'picks' ? t.picks : all;
    drawSummary();
    const matches = latestMatches(county);

    if (!shown.length) {
      out.innerHTML =
        show === 'watch'
          ? `<div class="panel empty-state"><h2>Your watchlist is empty</h2><p>Tap the star next to any office to watch it here while you decide. Stars work on this page and on the <a href="/candidates">Candidates</a> pages.</p><button type="button" class="btn btn-small" data-show="all">Show all races</button></div>`
          : show === 'picks'
            ? `<div class="panel empty-state"><h2>No picks yet</h2><p>Fill in an oval on any race, or use "Choose for my ballot" on a candidate's page.</p><button type="button" class="btn btn-small" data-show="all">Show all races</button></div>`
            : '<p class="muted">No races found for this county.</p>';
    } else {
      out.innerHTML = GROUPS.map((g) => {
        const list = shown.filter((r) => r.group === g.id);
        if (!list.length) return '';
        return `<section class="ballot-group"><h2 class="ballot-group-title">${esc(g.label)}</h2>${list
          .map((r) => raceBlock(r, p, matches))
          .join('')}</section>`;
      }).join('');
    }
    const q = new URLSearchParams({ county });
    if (show !== 'all') q.set('show', show);
    history.replaceState({}, '', `/my-ballot?${q}`);
  }

  function goPrint() {
    navigate(`/my-ballot/print?county=${encodeURIComponent(county)}`);
  }

  // Undecided watched offices print as blank lines; warn first so the voter can decide.
  function confirmPrint() {
    const t = tally(races(), plan.get());
    if (!t.undecided.length) return goPrint();
    const n = t.undecided.length;
    const modal = openModal({ title: 'Some watched offices have no pick' });
    modal.body.innerHTML = `
      <p style="margin-top:0">${n} ${n === 1 ? 'office on your watchlist has' : 'offices on your watchlist have'} no pick yet. ${n === 1 ? 'It' : 'They'} will print as a blank line with the candidates listed, so you can decide later.</p>
      <ul class="undecided-modal">${t.undecided
        .map((r) => `<li><button type="button" class="linkish" data-decide="${esc(r.id)}">${esc(raceTitle(r))}</button></li>`)
        .join('')}</ul>
      <div class="btn-row" style="justify-content:flex-end;margin-top:16px">
        <button type="button" class="btn btn-ghost" data-close>Go back and decide</button>
        <button type="button" class="btn" id="print-anyway">Print anyway</button>
      </div>`;
    modal.body.querySelector('#print-anyway').addEventListener('click', () => {
      closeModal();
      goPrint();
    });
    modal.body.addEventListener('click', (e) => {
      const b = e.target.closest('[data-decide]');
      if (!b) return;
      closeModal();
      goTo(b.dataset.decide);
    });
  }

  function goTo(raceId) {
    let block = $(`#race-${CSS.escape(raceId)}`, root);
    if (!block) {
      show = 'watch';
      draw();
      block = $(`#race-${CSS.escape(raceId)}`, root);
    }
    if (!block) return;
    block.scrollIntoView({ behavior: 'smooth', block: 'center' });
    block.classList.remove('flash');
    void block.offsetWidth;
    block.classList.add('flash');
  }

  root.addEventListener('change', (e) => {
    if (e.target.id === 'mb-county') {
      county = e.target.value;
      ballotCounty.set(county);
      return draw();
    }
    if (e.target.matches('.ballot-opt input[type=radio]')) {
      if (isGuest()) return;
      // The plan listener below redraws the race and the summary.
      const opt = e.target.closest('.ballot-opt');
      plan.pick(opt.dataset.race, opt.dataset.cand);
    }
  });

  root.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-show]');
    if (tab) {
      show = tab.dataset.show;
      return draw();
    }
    const compare = e.target.closest('[data-compare]');
    if (compare && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
      e.preventDefault();
      return openCompare(compare.dataset.compare);
    }
    const go = e.target.closest('[data-goto]');
    if (go) {
      e.preventDefault();
      return goTo(go.dataset.goto);
    }
    const clear = e.target.closest('[data-clear]');
    if (clear) {
      return plan.pick(clear.dataset.clear, null);
    }
    if (e.target.closest('#mb-print')) return confirmPrint();
    if (e.target.closest('#mb-clear')) {
      if (confirm('Clear every pick on your mock ballot? Your watchlist stays.')) {
        plan.clearPicks();
        draw();
      }
      return;
    }
    // Tapping anywhere on a candidate row picks it, except on its links and buttons.
    const opt = e.target.closest('.ballot-opt');
    if (opt && isGuest() && !e.target.closest('a, button')) return void accountGate('choose candidates for your ballot');
    if (opt && !e.target.closest('a, button, label, input')) {
      const radio = opt.querySelector('input[type=radio]');
      if (!radio.checked) {
        radio.checked = true;
        radio.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  });

  // Any change to picks or the watchlist, here or in the compare window, redraws
  // only the races that changed so the page does not jump.
  const stop = plan.onChange(() => {
    if (!root.isConnected) return stop();
    if (show === 'all') {
      const p = currentPlan();
      const matches = latestMatches(county);
      for (const race of races()) {
        const block = $(`#race-${CSS.escape(race.id)}`, root);
        if (!block) continue;
        const fresh = raceBlock(race, p, matches);
        if (block.outerHTML !== fresh) block.outerHTML = fresh;
      }
      drawSummary();
    } else draw();
  });

  draw();
}

// ---------- Printable ballot ----------
// Every pick, plus each watched office that has no pick yet as a blank line
// with its candidates listed.

export async function renderBallotPrint(view, _params, current) {
  if (isGuest()) return navigate(`/sign-in?next=${encodeURIComponent('/my-ballot')}`, { replace: true });
  const guide = await loadGuide();
  if (!current()) return;
  setTitle('My Ballot');
  const qs = new URLSearchParams(location.search);
  const county = qs.get('county') && guide.ballots[qs.get('county')] ? qs.get('county') : ballotCounty.get(guide);
  const p = plan.get();
  const races = racesForCounty(guide, county).filter((r) => p.picks[r.id] || p.starred_races.includes(r.id));
  const byId = Object.fromEntries(guide.races.flatMap((r) => r.candidates.map((c) => [c.id, c])));
  const undecided = races.filter((r) => !p.picks[r.id]).length;

  const rows = races
    .map((r) => {
      const choice = p.picks[r.id] ? byId[p.picks[r.id]] : null;
      if (choice) {
        return `<tr><td><b>${esc(raceTitle(r))}</b></td>
          <td><div class="print-pick">${candidatePhoto(choice).replace('loading="lazy"', 'loading="eager"')}<div><span class="print-choice">${esc(choice.name)}</span> ${partyTag(choice.party)}</div></div></td></tr>`;
      }
      return `<tr class="print-undecided"><td><b>${esc(raceTitle(r))}</b><ul class="print-cands">${r.candidates
        .map((c) => `<li>${esc(c.name)} (${esc(c.party)})</li>`)
        .join('')}</ul></td>
        <td><span class="print-blank" aria-hidden="true"></span><span class="small muted">Undecided</span></td></tr>`;
    })
    .join('');

  view.innerHTML = `
    <div class="print-sheet">
      <div class="print-actions">
        <a href="/my-ballot?county=${encodeURIComponent(county)}">Back to My Ballot</a>
        <button type="button" class="btn btn-small" id="do-print">Print this page</button>
      </div>
      <div class="print-head">
        <span class="eyebrow">VotersHub &middot; Texas General Election, November 3, 2026</span>
        <h1>My ballot</h1>
        <p>${esc(countyLabel(county))}${session.user ? `, prepared for ${esc(session.user.first_name)}` : ''}. Printed ${esc(formatDate(new Date().toISOString(), false))}.${
          undecided ? ` ${undecided} watched ${undecided === 1 ? 'office is' : 'offices are'} still undecided.` : ''
        }</p>
      </div>
      ${
        races.length
          ? `<table class="ballot print-table"><thead><tr><th>Office</th><th>My pick</th></tr></thead><tbody>${rows}</tbody></table>`
          : '<p>You have not picked any candidates or watched any offices yet. Go back to My Ballot to start.</p>'
      }
      <p class="small print-foot">Personal notes for use while voting. This list was made by the voter and is not an endorsement by VotersHub. Your actual ballot depends on your address, so some districts listed here may not appear on yours. Phones and other wireless devices may not be used within 100 feet of voting stations in Texas. Early voting runs October 19 to October 30. Election Day is Tuesday, November 3, 7 a.m. to 7 p.m.</p>
    </div>`;
  $('#do-print', view).addEventListener('click', () => window.print());
}
