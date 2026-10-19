// Totals for one partner link: traffic, conversion, engagement, audience, and
// the combined quiz results. Used on the partner's profile and on the Admin page.
// Audience and quiz totals arrive only when at least min_group people are in
// them; the server leaves them out otherwise.

import { esc, PARTY_CLASS } from '../ui.js';

const num = (n) => (n === null || n === undefined ? '' : Number(n).toLocaleString('en-US'));
const rate = (n) => (n === null || n === undefined ? 'n/a' : `${n}%`);

function bucketTable(title, b, label) {
  if (!b) return '';
  const rows = b.rows
    .map((r) => `<tr><td>${esc(label ? label(r.name) : r.name)}</td><td class="num">${num(r.count)}</td></tr>`)
    .join('');
  return `<div class="ps-block"><h4>${esc(title)}</h4>
    ${rows ? `<table class="ballot ps-table"><tbody>${rows}</tbody></table>` : ''}
    ${b.hidden ? `<p class="small muted">${num(b.hidden)} more in groups under 10, combined for privacy.</p>` : ''}</div>`;
}

function trafficChart(daily) {
  if (!daily.length) return '<p class="small muted">No visits in this period yet.</p>';
  const max = Math.max(...daily.map((d) => d.visits), 1);
  return `<div class="ps-chart" role="img" aria-label="Visits by day">${daily
    .map(
      (d) =>
        `<div class="ps-bar" title="${esc(d.day)}: ${d.visits} visits, ${d.unique_visitors} unique"><span style="height:${Math.max(4, (d.visits / max) * 100)}%"></span><em>${esc(d.day.slice(5))}</em></div>`
    )
    .join('')}</div>`;
}

export function rangeBar(id, from, to) {
  return `<form class="ps-range" id="${esc(id)}">
    <label>From <input type="date" name="from" value="${esc(from || '')}"></label>
    <label>To <input type="date" name="to" value="${esc(to || '')}"></label>
    <button class="btn btn-small" type="submit">Update</button>
    <button class="linkish" type="button" data-range="7">Last 7 days</button>
    <button class="linkish" type="button" data-range="30">Last 30 days</button>
    <button class="linkish" type="button" data-range="all">All time</button>
  </form>`;
}

// Wires a range form; onChange receives { from, to } as YYYY-MM-DD strings (or empty for all time).
export function bindRange(form, onChange) {
  const day = (d) => d.toISOString().slice(0, 10);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    onChange({ from: fd.get('from') || '', to: fd.get('to') || '' });
  });
  form.addEventListener('click', (e) => {
    const b = e.target.closest('[data-range]');
    if (!b) return;
    const to = new Date();
    const from = new Date(to.getTime() - (Number(b.dataset.range) - 1) * 864e5);
    const r = b.dataset.range === 'all' ? { from: '', to: '' } : { from: day(from), to: day(to) };
    form.from.value = r.from;
    form.to.value = r.to;
    onChange(r);
  });
}

export function statsHtml(s) {
  const t = s.traffic;
  const c = s.conversion;
  const e = s.engagement;
  const floor = s.min_group;
  return `<div class="ps">
    <div class="account-grid ps-kpis">
      <div class="account-tile"><span class="label">Visits</span><b>${num(t.visits)}</b><span>${num(t.unique_visitors)} daily unique visitors</span></div>
      <div class="account-tile"><span class="label">Sign-ups</span><b>${num(c.sign_ups)}</b><span>${rate(c.sign_up_rate)} of unique visitors</span></div>
      <div class="account-tile"><span class="label">Quizzes taken</span><b>${num(c.quiz_completions)}</b><span>${rate(c.quiz_rate)} of sign-ups</span></div>
    </div>
    <div class="ps-block"><h4>Visits by day</h4>${trafficChart(t.daily)}</div>
    <div class="ps-block"><h4>Engagement</h4>
      <table class="ballot ps-table"><tbody>
        <tr><td>Ballots started</td><td class="num">${num(e.ballots_started)}</td></tr>
        <tr><td>Offices watched</td><td class="num">${num(e.offices_watched)}</td></tr>
        <tr><td>Candidates picked</td><td class="num">${num(e.candidates_picked)}</td></tr>
        <tr><td>Results shared</td><td class="num">${num(e.results_shared)}</td></tr>
        <tr><td>Where to Vote lookups</td><td class="num">${num(e.polling_lookups)}</td></tr>
      </tbody></table></div>
    ${
      s.audience
        ? `<div class="ps-two">${bucketTable('Sign-ups by county', s.audience.county, (n) => (/county$/i.test(n) ? n : `${n} County`))}${bucketTable('Sign-ups by age range', s.audience.age_range)}</div>`
        : `<p class="callout small">Audience breakdowns appear once at least ${floor} people have signed up through this link in the selected dates.</p>`
    }
    ${
      s.quiz
        ? `<div class="ps-block"><h4>Combined quiz results (${num(s.quiz.takers)} people)</h4>
          <div class="bars">${s.quiz.average_alignment
            .map(
              (p) =>
                `<div class="bar-row"><div class="label">${esc(p.name)}</div><div class="bar ${PARTY_CLASS[p.name] || ''}" aria-hidden="true"><span style="width:${p.average}%"></span></div><div class="pct">${p.average}%</div></div>`
            )
            .join('')}</div>
          <p class="small muted">Average agreement with each party platform across everyone who took the quiz.</p></div>
          <div class="ps-two">${bucketTable('Closest party match', s.quiz.closest_match)}${bucketTable('Most common top issues', s.quiz.top_issues)}</div>`
        : `<p class="callout small">Combined quiz results appear once at least ${floor} people who joined through this link have taken the quiz.</p>`
    }
    <p class="small muted">Totals only. No one's answers, name, or email is ever shown to partners. Unique visitors are counted per day without cookies or stored addresses.</p>
  </div>`;
}
