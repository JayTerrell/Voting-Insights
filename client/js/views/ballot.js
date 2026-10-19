// My Ballot: a mock ballot in official ballot order. Voters mark a choice in each
// race, star the races and candidates they care about most, and print either a
// shortlist or every choice. Choices are saved in this browser, and to the
// account when signed in. Nothing here is ever recommended for the voter.

import {
  $,
  $$,
  esc,
  setTitle,
  GROUPS,
  raceTitle,
  countyLabel,
  countyPicker,
  starButton,
  miniCard,
  partyTag,
  formatDate,
} from '../ui.js';
import { loadGuide, loadFormOptions, ballotCounty, plan, session, resultCache } from '../api.js';
import { racesForCounty } from '../shared/scoring.js';

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

function onShortlist(race, p) {
  return p.starred_races.includes(race.id) || race.candidates.some((c) => p.starred_candidates.includes(c.id));
}

function voteFor(race) {
  return race.candidates.length > 1 ? 'Vote for none or one' : 'Unopposed. Vote for none or one';
}

function raceBlock(race, p, matches) {
  const chosen = p.picks[race.id];
  const options = race.candidates
    .map((c) => {
      const id = `pick-${race.id}-${c.id}`;
      return `<div class="ballot-opt ${chosen === c.id ? 'chosen' : ''}" data-race="${esc(race.id)}" data-cand="${esc(c.id)}">
        <label class="oval-label" for="${esc(id)}">
          <input type="radio" id="${esc(id)}" name="pick-${esc(race.id)}" value="${esc(c.id)}" ${chosen === c.id ? 'checked' : ''}>
          <span class="oval" aria-hidden="true"></span><span class="sr-only">Choose ${esc(c.name)}</span>
        </label>
        ${miniCard(c, { match: matches && race.candidates.length > 1 ? matches[c.id] : null })}
      </div>`;
    })
    .join('');
  return `<fieldset class="ballot-race" id="race-${esc(race.id)}">
    <legend class="sr-only">${esc(raceTitle(race))}</legend>
    <div class="ballot-race-head">
      <div><h3>${esc(raceTitle(race))}</h3><p class="vote-for">${voteFor(race)}</p></div>
      ${starButton('race', race.id, raceTitle(race))}
    </div>
    <div class="ballot-opts">${options}</div>
    <div class="ballot-race-foot">
      <a href="/candidates/${esc(race.id)}">${race.candidates.length > 1 ? 'Compare candidates' : 'Read profile'}</a>
      ${chosen ? `<button type="button" class="linkish" data-clear="${esc(race.id)}">Clear choice</button>` : ''}
    </div>
  </fieldset>`;
}

export async function renderBallot(view, _params, current) {
  setTitle('My Ballot');
  const [guide, options] = await Promise.all([loadGuide(), loadFormOptions()]);
  if (!current()) return;
  const qs = new URLSearchParams(location.search);
  let county = qs.get('county') && guide.ballots[qs.get('county')] ? qs.get('county') : ballotCounty.get(guide);
  let show = qs.get('show') === 'starred' ? 'starred' : 'all';

  // Listeners attach to this wrapper, which is replaced on the next page, so they never pile up.
  view.innerHTML = `<div id="mb-root">
    <span class="eyebrow">My Ballot</span>
    <h1>Your mock ballot</h1>
    <p class="lede">Mark your choice in each race, in the order the races appear on the official ballot. Star the races and candidates that matter most to you to build a shortlist, then print it to take with you. Texas law does not allow phones or other wireless devices to be used within 100 feet of voting stations, so bring a paper copy.</p>
    ${
      session.token
        ? ''
        : '<div class="callout" style="margin-bottom:16px">Your choices are saved in this browser. <a href="/sign-up?next=/my-ballot">Create a free account</a> or <a href="/sign-in?next=/my-ballot">sign in</a> to keep them on every device.</div>'
    }
    <div class="ballot-toolbar">
      <div class="ballot-county">${countyPicker(guide, options.counties, county, 'mb-county')}</div>
      <div class="seg" role="tablist" aria-label="Which races to show">
        <button type="button" role="tab" data-show="all">All races</button>
        <button type="button" role="tab" data-show="starred">My shortlist</button>
      </div>
    </div>
    <div class="ballot-summary" id="mb-summary" aria-live="polite"></div>
    <div id="mb-out"></div></div>`;

  const root = $('#mb-root', view);
  const out = $('#mb-out', root);

  function draw() {
    const p = plan.get();
    const races = racesForCounty(guide, county);
    const matches = latestMatches(county);
    const shown = show === 'starred' ? races.filter((r) => onShortlist(r, p)) : races;
    const picked = races.filter((r) => p.picks[r.id]).length;
    const starred = races.filter((r) => onShortlist(r, p)).length;

    $$('[data-show]', root).forEach((b) => b.setAttribute('aria-selected', String(b.dataset.show === show)));
    $$('[data-show]', root).forEach((b) => {
      b.textContent = b.dataset.show === 'all' ? `All races (${races.length})` : `My shortlist (${starred})`;
    });
    $('#mb-summary', root).innerHTML = `
      <p><b>${picked}</b> of ${races.length} races marked on the ${esc(countyLabel(county))} ballot.${
        matches ? ' Match percentages come from your most recent quiz.' : ''
      }</p>
      <div class="btn-row">
        <a class="btn btn-small" href="/my-ballot/print?show=starred&county=${encodeURIComponent(county)}">Print my shortlist</a>
        <a class="btn btn-small btn-ghost" href="/my-ballot/print?show=all&county=${encodeURIComponent(county)}">Print all my choices</a>
        ${picked ? '<button type="button" class="linkish" id="mb-clear">Clear all choices</button>' : ''}
      </div>`;

    if (!shown.length) {
      out.innerHTML =
        show === 'starred'
          ? `<div class="panel empty-state"><h2>Your shortlist is empty</h2><p>Tap the star next to any race or candidate to add it here. Stars work on this page, on the <a href="/candidates">Candidates</a> pages, and on each candidate profile.</p><button type="button" class="btn btn-small" data-show="all">Show all races</button></div>`
          : '<p class="muted">No races found for this county.</p>';
      return;
    }
    out.innerHTML = GROUPS.map((g) => {
      const list = shown.filter((r) => r.group === g.id);
      if (!list.length) return '';
      return `<section class="ballot-group"><h2 class="ballot-group-title">${esc(g.label)}</h2>${list
        .map((r) => raceBlock(r, p, matches))
        .join('')}</section>`;
    }).join('');

    const q = new URLSearchParams({ county });
    if (show === 'starred') q.set('show', 'starred');
    history.replaceState({}, '', `/my-ballot?${q}`);
  }

  root.addEventListener('change', (e) => {
    if (e.target.id === 'mb-county') {
      county = e.target.value;
      ballotCounty.set(county);
      return draw();
    }
    if (e.target.matches('.ballot-opt input[type=radio]')) {
      const opt = e.target.closest('.ballot-opt');
      plan.pick(opt.dataset.race, opt.dataset.cand);
      refreshRace(opt.dataset.race);
    }
  });

  root.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-show]');
    if (tab) {
      show = tab.dataset.show;
      return draw();
    }
    const clear = e.target.closest('[data-clear]');
    if (clear) {
      plan.pick(clear.dataset.clear, null);
      return refreshRace(clear.dataset.clear);
    }
    if (e.target.closest('#mb-clear')) {
      if (confirm('Clear every choice on your mock ballot? Your starred shortlist stays.')) {
        plan.clearPicks();
        draw();
      }
      return;
    }
    // Tapping anywhere on a candidate row marks it, except on its links and buttons.
    const opt = e.target.closest('.ballot-opt');
    if (opt && !e.target.closest('a, button, label, input')) {
      const radio = opt.querySelector('input[type=radio]');
      if (!radio.checked) {
        radio.checked = true;
        radio.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  });

  // Redraw one race in place so the page does not jump while the voter works down it.
  function refreshRace(raceId) {
    const race = guide.races.find((r) => r.id === raceId);
    const block = $(`#race-${CSS.escape(raceId)}`, root);
    if (!race || !block) return draw();
    block.outerHTML = raceBlock(race, plan.get(), latestMatches(county));
    const races = racesForCounty(guide, county);
    const picked = races.filter((r) => plan.get().picks[r.id]).length;
    const b = $('#mb-summary b', root);
    if (b) b.textContent = String(picked);
  }

  // Starring from this page changes the shortlist count and, on the shortlist tab, the list.
  const stop = plan.onChange(() => {
    if (!root.isConnected) return stop();
    if (show === 'starred') draw();
    else {
      const p = plan.get();
      const starred = racesForCounty(guide, county).filter((r) => onShortlist(r, p)).length;
      const tab = $('[data-show="starred"]', root);
      if (tab) tab.textContent = `My shortlist (${starred})`;
    }
  });

  draw();
}

// ---------- Printable lists ----------

export async function renderBallotPrint(view, _params, current) {
  const guide = await loadGuide();
  if (!current()) return;
  const qs = new URLSearchParams(location.search);
  const county = qs.get('county') && guide.ballots[qs.get('county')] ? qs.get('county') : ballotCounty.get(guide);
  const starredOnly = qs.get('show') === 'starred';
  setTitle(starredOnly ? 'My Shortlist' : 'My Ballot Choices');
  const p = plan.get();
  const races = racesForCounty(guide, county).filter((r) => !starredOnly || onShortlist(r, p));
  const byId = Object.fromEntries(guide.races.flatMap((r) => r.candidates.map((c) => [c.id, c])));

  const rows = races
    .map((r) => {
      const choice = p.picks[r.id] ? byId[p.picks[r.id]] : null;
      const others = starredOnly
        ? `<ul class="print-cands">${r.candidates
            .map(
              (c) =>
                `<li>${p.starred_candidates.includes(c.id) ? '<span class="print-star" title="Starred">&#9733;</span> ' : ''}${esc(c.name)} (${esc(c.party)})</li>`
            )
            .join('')}</ul>`
        : '';
      return `<tr>
        <td><b>${esc(raceTitle(r))}</b>${p.starred_races.includes(r.id) ? ' <span class="print-star" title="Starred">&#9733;</span>' : ''}${others}</td>
        <td>${choice ? `<span class="print-choice">${esc(choice.name)}</span> ${partyTag(choice.party)}` : '<span class="muted">No choice marked</span>'}</td>
      </tr>`;
    })
    .join('');

  view.innerHTML = `
    <div class="print-sheet">
      <div class="print-actions">
        <a href="/my-ballot?county=${encodeURIComponent(county)}${starredOnly ? '&show=starred' : ''}">Back to My Ballot</a>
        <button type="button" class="btn btn-small" id="do-print">Print this page</button>
      </div>
      <div class="print-head">
        <span class="eyebrow">VotersHub &middot; Texas General Election, November 3, 2026</span>
        <h1>${starredOnly ? 'My shortlist' : 'My ballot choices'}</h1>
        <p>${esc(countyLabel(county))}${session.user ? `, prepared for ${esc(session.user.first_name)}` : ''}. Printed ${esc(formatDate(new Date().toISOString(), false))}.</p>
      </div>
      ${
        races.length
          ? `<table class="ballot print-table"><thead><tr><th>Office</th><th>My choice</th></tr></thead><tbody>${rows}</tbody></table>`
          : `<p>${starredOnly ? 'Your shortlist is empty. Star races or candidates on My Ballot first.' : 'No races found.'}</p>`
      }
      <p class="small print-foot">Personal notes for use while voting. This list was made by the voter and is not an endorsement by VotersHub. Your actual ballot depends on your address, so some districts listed here may not appear on yours. Phones and other wireless devices may not be used within 100 feet of voting stations in Texas. Early voting runs October 19 to October 30. Election Day is Tuesday, November 3, 7 a.m. to 7 p.m.</p>
    </div>`;
  $('#do-print', view).addEventListener('click', () => window.print());
}
