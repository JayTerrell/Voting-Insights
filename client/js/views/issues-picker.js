// "Your issues and the offices that control them": a window that shows the
// voter's top issues (from the quiz, or chosen by hand) and the offices on their
// ballot that shape those issues. The voter can change the issues, check or
// uncheck offices, and save; checked offices go on their watchlist.

import { esc, openModal, closeModal, toast, raceTitle } from '../ui.js';
import { plan } from '../api.js';
import { racesForCounty } from '../shared/scoring.js';
import { ISSUE_AREAS, OFFICE_NAMES, officeGroup, rankOffices } from '../shared/issue-offices.js';

export const MAX_ISSUES = 5;
const SUGGEST = 8; // offices checked for the voter the first time
const MANY = 1; // offices with more races than this need the voter to pick a district

// Offices on this county's ballot, grouped by office, with the races for each.
function ballotOffices(guide, county) {
  const byKey = new Map();
  for (const race of racesForCounty(guide, county)) {
    const key = officeGroup(race.office_key);
    if (!OFFICE_NAMES[key]) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(race);
  }
  return byKey;
}

/**
 * Opens the window.
 * @param {object} o
 * @param {object} o.guide
 * @param {string} o.county
 * @param {string[]} o.ranking issue areas in the order the quiz ranked them (may be empty)
 * @param {boolean} o.firstTime true right after the quiz: suggested offices start checked
 */
export function openIssuesPicker({ guide, county, ranking = [], firstTime = false }) {
  const saved = plan.get();
  let issues = (saved.issues?.length ? saved.issues : ranking).slice(0, MAX_ISSUES);
  const offices = ballotOffices(guide, county);
  const watched = new Set(saved.starred_races);
  // Per office: which races the voter wants. Starts from the watchlist.
  const choice = new Map();
  for (const [key, races] of offices) {
    const ids = races.filter((r) => watched.has(r.id)).map((r) => r.id);
    if (ids.length) choice.set(key, ids);
  }
  let suggested = firstTime;

  const modal = openModal({ title: 'Your issues and the offices that control them', wide: true });
  modal.body.classList.add('issues-picker');

  function rows() {
    const ranked = rankOffices(issues).filter((o) => offices.has(o.key));
    if (suggested) {
      // First time: check the top offices that have one clear race on this ballot.
      ranked
        .filter((o) => offices.get(o.key).length <= MANY)
        .slice(0, SUGGEST)
        .forEach((o) => {
          if (!choice.has(o.key))
            choice.set(
              o.key,
              offices.get(o.key).map((r) => r.id)
            );
        });
      suggested = false;
    }
    if (!ranked.length) {
      return '<p class="muted">Choose at least one issue to see the offices that shape it.</p>';
    }
    return ranked
      .map((o) => {
        const races = offices.get(o.key);
        const picked = choice.get(o.key) || [];
        const on = picked.length > 0;
        const multi = races.length > 1;
        const value = !on ? '' : picked.length === races.length ? 'all' : picked[0];
        return `<li class="office-row ${on ? 'on' : ''}">
          <label class="office-check"><input type="checkbox" data-office="${esc(o.key)}" ${on ? 'checked' : ''}>
            <span class="office-name">${esc(OFFICE_NAMES[o.key])}${multi ? ` <span class="small muted">(${races.length} races on your ballot)</span>` : ''}</span></label>
          <div class="office-tags">${o.reasons.map((r) => `<span class="office-tag">${esc(r.issue)}</span>`).join('')}</div>
          <details class="office-why"><summary>Why this office</summary><ul>${o.reasons
            .map((r) => `<li><b>${esc(r.issue)}:</b> ${esc(r.why)}</li>`)
            .join('')}</ul></details>
          ${
            multi
              ? `<label class="office-district"><span class="small">Which one is yours?</span>
              <select data-district="${esc(o.key)}">
                <option value="" ${value === '' ? 'selected' : ''}>Choose your district</option>
                ${races.map((r) => `<option value="${esc(r.id)}" ${value === r.id ? 'selected' : ''}>${esc(raceTitle(r))}</option>`).join('')}
                <option value="all" ${value === 'all' ? 'selected' : ''}>Not sure: watch all ${races.length}</option>
              </select></label>`
              : ''
          }
        </li>`;
      })
      .join('');
  }

  function draw() {
    const chosen = issues
      .map(
        (x, i) =>
          `<button type="button" class="issue-chip on" data-issue="${esc(x)}" aria-pressed="true"><span class="issue-rank">${i + 1}</span>${esc(x)}<span class="chip-x" aria-hidden="true"></span><span class="sr-only">Remove</span></button>`
      )
      .join('');
    const others = ISSUE_AREAS.filter((x) => !issues.includes(x))
      .map(
        (x) =>
          `<button type="button" class="issue-chip" data-issue="${esc(x)}" aria-pressed="false" ${issues.length >= MAX_ISSUES ? 'disabled' : ''}>+ ${esc(x)}</button>`
      )
      .join('');
    modal.body.innerHTML = `
      <p style="margin-top:0">${
        ranking.length
          ? `Based on what you marked as important and how strongly you answered, these are your top ${MAX_ISSUES} issues. Change them any time.`
          : `Choose up to ${MAX_ISSUES} issues that matter most to you, most important first.`
      }</p>
      <div class="issue-chips chosen" aria-label="Your issues">${chosen || '<span class="muted small">No issues chosen yet.</span>'}</div>
      <details class="more-issues" ${issues.length ? '' : 'open'}><summary>${issues.length >= MAX_ISSUES ? `Swap an issue (remove one first, up to ${MAX_ISSUES})` : 'Add an issue'}</summary>
        <div class="issue-chips">${others}</div></details>
      <h3 class="picker-h">Offices that control them</h3>
      <p class="small muted" style="margin-top:0">Checked offices go on your watchlist on My Ballot. Uncheck any you do not want, or check others.</p>
      <ul class="office-list">${rows()}</ul>
      <div class="picker-actions">
        <button type="button" class="btn btn-ghost" data-close>Not now</button>
        <button type="button" class="btn" id="picker-save">Save to my watchlist</button>
      </div>`;
  }

  modal.body.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-issue]');
    if (chip) {
      const x = chip.dataset.issue;
      issues = issues.includes(x) ? issues.filter((y) => y !== x) : [...issues, x].slice(0, MAX_ISSUES);
      const open = modal.body.querySelector('.more-issues')?.open;
      draw();
      if (open) modal.body.querySelector('.more-issues').open = true;
      return;
    }
    if (e.target.closest('#picker-save')) {
      const keep = new Set([...choice.values()].flat());
      const inPicker = new Set([...offices.values()].flat().map((r) => r.id));
      const remove = [...inPicker].filter((id) => watched.has(id) && !keep.has(id));
      plan.saveIssues(issues, [...keep], remove);
      closeModal();
      toast(
        keep.size
          ? `Saved. ${keep.size} ${keep.size === 1 ? 'office is' : 'offices are'} on your watchlist.`
          : 'Your issues are saved.'
      );
    }
  });

  modal.body.addEventListener('change', (e) => {
    const box = e.target.closest('[data-office]');
    if (box) {
      const key = box.dataset.office;
      const races = offices.get(key);
      if (box.checked) choice.set(key, races.length === 1 ? [races[0].id] : races.length <= MANY ? races.map((r) => r.id) : []);
      else choice.delete(key);
      // A multi-district office needs a district before it counts.
      if (box.checked && !choice.get(key).length) {
        choice.delete(key);
        const sel = modal.body.querySelector(`[data-district="${CSS.escape(key)}"]`);
        sel?.focus();
        toast('Choose your district, or "Not sure" to watch them all.');
        box.checked = false;
      }
      box.closest('.office-row').classList.toggle('on', choice.has(key));
      return;
    }
    const sel = e.target.closest('[data-district]');
    if (sel) {
      const key = sel.dataset.district;
      const races = offices.get(key);
      if (!sel.value) choice.delete(key);
      else choice.set(key, sel.value === 'all' ? races.map((r) => r.id) : [sel.value]);
      const row = sel.closest('.office-row');
      row.querySelector('[data-office]').checked = choice.has(key);
      row.classList.toggle('on', choice.has(key));
    }
  });

  draw();
  return modal;
}
