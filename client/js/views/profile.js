// My Profile: the voter's own information at a glance. Party alignment from the
// latest quiz, their top issues and the offices that control them, their
// watchlist and picks, and quiz history. Account details live on /settings.

import { $, esc, setTitle, formatDate, skeleton, countyLabel, avatarHtml, raceTitle, PARTY_CLASS } from '../ui.js';
import { api, session, plan, loadGuide, ballotCounty, resultCache } from '../api.js';
import { racesForCounty } from '../shared/scoring.js';
import { officeGroup, rankOffices } from '../shared/issue-offices.js';
import { openIssuesPicker } from './issues-picker.js';
import { statsHtml, rangeBar, bindRange } from './partner-stats.js';
import { navigate, updateAccountLink } from '../app.js';

export async function renderProfile(view, _params, current) {
  setTitle('My Profile');
  if (!session.token) return navigate('/sign-in?next=/profile', { replace: true });
  view.innerHTML = `<span class="eyebrow">My Profile</span><h1>Your profile</h1>${skeleton('list')}`;

  let list = [];
  try {
    const [mine, me] = await Promise.all([api.myResults(), api.me()]);
    list = mine.results;
    session.set(session.token, me.user);
    updateAccountLink();
  } catch (e) {
    if (e.status === 401) {
      session.clear();
      return navigate('/sign-in?next=/profile', { replace: true });
    }
    list = Object.values(resultCache.all()).map((r) => ({
      share_id: r.share_id,
      created_at: r.created_at,
      answered: r.results.answered,
      parties: r.results.parties,
    }));
  }
  list.sort((a, b) => b.created_at.localeCompare(a.created_at));
  // The latest result, with the owner's issue ranking, feeds the issues section.
  const latest = list[0] ? await api.result(list[0].share_id).catch(() => resultCache.get(list[0].share_id)) : null;
  const guide = await loadGuide();
  if (!current()) return;

  const draw = () => drawProfile(view, guide, list, latest);
  draw();
  const stop = plan.onChange(() => {
    if (!view.querySelector('.profile-page')) return stop();
    draw();
  });
}

function partyBars(parties) {
  const sorted = parties.filter((p) => p.score !== null).sort((a, b) => b.score - a.score);
  if (!sorted.length) return '<p class="muted">Not enough answers to compare with party platforms.</p>';
  return `<div class="bars">${sorted
    .map(
      (p) =>
        `<div class="bar-row ${p.score === sorted[0].score ? 'lead' : ''}"><div class="label">${esc(p.name)}</div><div class="bar ${PARTY_CLASS[p.name] || ''}" aria-hidden="true"><span style="width:${p.score}%"></span></div><div class="pct">${p.score}%</div></div>`
    )
    .join('')}</div>`;
}

function drawProfile(view, guide, list, latest) {
  const u = session.user || {};
  const county = u.county || ballotCounty.get(guide);
  const p = plan.get();
  const ranking = latest?.issue_ranking || [];
  const issues = p.issues?.length ? p.issues : [];
  const onBallot = racesForCounty(guide, county);
  const byId = new Map(onBallot.map((r) => [r.id, r]));
  const watchedRaces = p.starred_races.map((id) => byId.get(id)).filter(Boolean);
  const pickCount = Object.keys(p.picks).length;
  const decided = watchedRaces.filter((r) => p.picks[r.id]).length;

  // Watched offices, grouped by the issue reasons that tie them to the voter.
  const reasons = new Map(rankOffices(issues).map((o) => [o.key, o.reasons.map((r) => r.issue)]));
  const officeRows = watchedRaces
    .map((r) => {
      const why = reasons.get(officeGroup(r.office_key)) || [];
      const pick = p.picks[r.id] ? r.candidates.find((c) => c.id === p.picks[r.id]) : null;
      return `<li><div><a href="/candidates/${esc(r.id)}"><b>${esc(raceTitle(r))}</b></a>
          ${why.length ? `<span class="small muted"> ${esc(why.join(', '))}</span>` : ''}</div>
          <span class="tag ${pick ? 'tag-navy' : 'tag-red'}">${pick ? `Picked: ${esc(pick.name)}` : 'Undecided'}</span></li>`;
    })
    .join('');

  view.innerHTML = `<div class="profile-page">
    <div class="profile-hero">
      <div class="profile-photo">${avatarHtml(u, 'lg')}</div>
      <div>
        <span class="eyebrow">My Profile</span>
        <h1>${esc([u.first_name, u.last_name].filter(Boolean).join(' ') || 'Your profile')}</h1>
        <p class="muted" style="margin:0">Voting in ${esc(countyLabel(county))} · <a href="/settings">Account settings</a></p>
      </div>
    </div>

    <div class="account-grid">
      <a class="account-tile" href="/my-ballot?show=watch"><span class="label">Watchlist</span><b>${watchedRaces.length}</b><span>${decided} decided, ${watchedRaces.length - decided} undecided</span></a>
      <a class="account-tile" href="/my-ballot?show=picks"><span class="label">My Picks</span><b>${pickCount}</b><span>${pickCount === 1 ? 'candidate' : 'candidates'} chosen</span></a>
      <a class="account-tile" href="/quiz"><span class="label">Issue Quiz</span><b>${list.length}</b><span>${list.length === 1 ? 'result' : 'results'} saved</span></a>
    </div>

    <div class="profile-grid">
      <section class="panel" aria-labelledby="align-h">
        <div class="section-head"><h2 id="align-h">Party alignment</h2>${list[0] ? `<a href="/results/${esc(list[0].share_id)}">Full results and sharing</a>` : ''}</div>
        ${
          list[0]
            ? `${partyBars(list[0].parties)}<p class="small muted" style="margin:12px 0 0">From your quiz on ${esc(formatDate(list[0].created_at))}. Each percentage is measured separately.</p>`
            : '<p>Take the quiz to see how your views line up with each party platform and every candidate on your ballot.</p><a class="btn btn-red btn-small" href="/quiz">Take the quiz</a>'
        }
      </section>

      <section class="panel" aria-labelledby="iss-h">
        <div class="section-head"><h2 id="iss-h">Your top issues</h2><button type="button" class="linkish" id="edit-issues">${issues.length ? 'Edit' : 'Choose'}</button></div>
        ${
          issues.length
            ? `<ol class="profile-issues">${issues.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>`
            : `<p>${ranking.length ? `From your quiz: <b>${esc(ranking.slice(0, 5).join(', '))}</b>.` : 'Tell us what matters to you and we will show which offices control it.'}</p>
               <button type="button" class="btn btn-small" id="edit-issues-2">${ranking.length ? 'Review issues and offices' : 'Choose my issues'}</button>`
        }
      </section>
    </div>

    <section aria-labelledby="watch-h">
      <div class="section-head"><h2 id="watch-h">Offices you are watching</h2><a href="/my-ballot?show=watch">Open My Ballot</a></div>
      ${
        watchedRaces.length
          ? `<ul class="profile-offices">${officeRows}</ul>`
          : `<div class="panel empty-state"><p>No offices yet. ${issues.length || ranking.length ? 'Pick offices for your issues to start your watchlist.' : 'Choose your issues and we will suggest the offices that control them.'}</p><button type="button" class="btn btn-small" id="edit-issues-3">Find offices for my issues</button></div>`
      }
    </section>

    <section aria-labelledby="partner-stats-h" id="partner-stats" hidden>
      <div class="section-head"><h2 id="partner-stats-h">Your partner link</h2><span class="small" id="partner-link-url"></span></div>
      <div id="partner-stats-body"></div>
    </section>

    <section aria-labelledby="hist-h">
      <div class="section-head"><h2 id="hist-h">Quiz history</h2><a href="/quiz">${list.length ? 'Retake the quiz' : 'Take the quiz'}</a></div>
      ${
        list.length
          ? `<table class="ballot"><thead><tr><th>Taken (Central Time)</th><th class="num">Answered</th><th>Closest party platform</th><th></th></tr></thead><tbody>${list
              .map((r) => {
                const best = [...r.parties].filter((x) => x.score !== null).sort((a, b) => b.score - a.score)[0];
                return `<tr><td>${esc(formatDate(r.created_at))}</td><td class="num">${r.answered}</td><td>${best ? `${esc(best.name)} (${best.score}%)` : ''}</td><td><a href="/results/${esc(r.share_id)}">View</a></td></tr>`;
              })
              .join('')}</tbody></table>`
          : '<p class="muted">You have not taken the quiz yet.</p>'
      }
    </section>
  </div>`;

  drawPartnerStats(view);

  const open = () => openIssuesPicker({ guide, county, ranking });
  ['#edit-issues', '#edit-issues-2', '#edit-issues-3'].forEach((sel) => $(sel, view)?.addEventListener('click', open));
}

// The partner's own link totals, when they have an approved link.
let partnerRange = { from: '', to: '' };
async function drawPartnerStats(view) {
  const section = $('#partner-stats', view);
  if (!section) return;
  let data;
  try {
    data = await api.partnerStats(partnerRange);
  } catch {
    return; // no approved link: the section stays hidden
  }
  if (!section.isConnected) return;
  section.hidden = false;
  $('#partner-link-url', view).innerHTML =
    `<a href="${esc(data.link.url)}" target="_blank" rel="noopener">${esc(data.link.url)}</a>`;
  const r = data.stats.range;
  $('#partner-stats-body', view).innerHTML =
    `${rangeBar('partner-range', partnerRange.from || r.from, partnerRange.to || r.to)}${statsHtml(data.stats)}`;
  bindRange($('#partner-range', view), (next) => {
    partnerRange = next;
    drawPartnerStats(view);
  });
}
