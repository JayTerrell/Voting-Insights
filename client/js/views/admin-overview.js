// Admin Overview: site-wide visitors, sign-ups, quizzes, and engagement for any
// date range, grouped by day, week, or month, with a comparison to the period
// before. Data comes from /api/admin/overview.

import { $, $$, esc, toast, PARTY_CLASS } from '../ui.js';
import { api, session } from '../api.js';

const TZ = 'America/Chicago';
const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const shift = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

const PRESETS = [
  ['today', 'Today'],
  ['7', 'Last 7 days'],
  ['30', 'Last 30 days'],
  ['month', 'This month'],
  ['lastmonth', 'Last month'],
  ['all', 'All time'],
];

function presetRange(key) {
  const t = today();
  if (key === 'today') return { from: t, to: t, group: 'day' };
  if (key === '7') return { from: shift(t, -6), to: t, group: 'day' };
  if (key === '30') return { from: shift(t, -29), to: t, group: 'day' };
  if (key === 'month') return { from: `${t.slice(0, 8)}01`, to: t, group: 'day' };
  if (key === 'lastmonth') {
    const first = `${t.slice(0, 8)}01`;
    const end = shift(first, -1);
    return { from: `${end.slice(0, 8)}01`, to: end, group: 'day' };
  }
  return { from: '2026-10-01', to: t, group: 'week' };
}

const KPIS = [
  ['visitors', 'Visitors', 'Unique per day, summed'],
  ['page_views', 'Page views', ''],
  ['sign_ups', 'Sign-ups', 'New accounts'],
  ['quiz_takers', 'Quiz takers', 'People who finished'],
  ['quizzes_taken', 'Quizzes taken', 'Including retakes'],
  ['quiz_starts', 'Quiz starts', 'Clicked Begin'],
  ['active_ballots', 'Ballots in use', 'Plans changed in range'],
  ['shares', 'Results shared', ''],
  ['polling_lookups', 'Where to Vote searches', ''],
  ['ballots_printed', 'Ballots printed', ''],
];
const SERIES = [
  ['visitors', 'Visitors'],
  ['sign_ups', 'Sign-ups'],
  ['quizzes_taken', 'Quizzes'],
  ['page_views', 'Page views'],
  ['quiz_starts', 'Quiz starts'],
];

const num = (n) => Number(n || 0).toLocaleString('en-US');

function delta(now, prev, label) {
  if (!prev && !now) return '<span class="ov-delta">No change</span>';
  if (!prev) return `<span class="ov-delta up">New this period</span>`;
  const p = Math.round(((now - prev) / prev) * 100);
  if (p === 0) return `<span class="ov-delta">Same as ${esc(label)}</span>`;
  return `<span class="ov-delta ${p > 0 ? 'up' : 'down'}">${p > 0 ? 'Up' : 'Down'} ${Math.abs(p)}% vs ${esc(label)}</span>`;
}

function bucketLabel(b, group) {
  if (group === 'month') {
    const [y, m] = b.split('-');
    return new Date(Date.UTC(Number(y), Number(m) - 1, 15)).toLocaleString('en-US', {
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }
  const d = new Date(`${b}T12:00:00Z`);
  const s = d.toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return group === 'week' ? `Week of ${s}` : s;
}

function chart(series, metric, group) {
  if (!series.length) return '<p class="muted">No data in this range.</p>';
  const max = Math.max(...series.map((r) => r[metric]), 1);
  const every = Math.ceil(series.length / 12);
  return `<div class="ov-chart" role="img" aria-label="${esc(metric)} by ${esc(group)}">
    <div class="ov-ymax">${num(max)}</div>
    <div class="ov-bars">${series
      .map(
        (r, i) => `<div class="ov-col" title="${esc(bucketLabel(r.bucket, group))}: ${num(r[metric])}">
          <span class="ov-val">${r[metric] ? num(r[metric]) : ''}</span>
          <span class="ov-bar" style="height:${(r[metric] / max) * 100}%"></span>
          <em>${i % every === 0 ? esc(bucketLabel(r.bucket, group).replace('Week of ', '')) : ''}</em>
        </div>`
      )
      .join('')}</div></div>`;
}

function table(title, rows, cols) {
  if (!rows?.length) return `<div class="ov-card"><h3>${esc(title)}</h3><p class="small muted">No data yet.</p></div>`;
  return `<div class="ov-card"><h3>${esc(title)}</h3><table class="ballot ov-table"><thead><tr><th></th>${cols
    .map(([, l]) => `<th class="num">${esc(l)}</th>`)
    .join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr><td>${esc(r.name)}</td>${cols.map(([k]) => `<td class="num">${num(r[k])}</td>`).join('')}</tr>`)
    .join('')}</tbody></table></div>`;
}

export function renderOverview(body, current) {
  let state = presetRange('7');
  let preset = '7';
  let metric = 'visitors';
  let data = null;
  let excludeAdmins = true;

  body.innerHTML = `<div class="ov">
    <div class="ov-controls">
      <div class="ov-presets">${PRESETS.map(([k, l]) => `<button type="button" class="chip-btn" data-preset="${k}">${l}</button>`).join('')}</div>
      <form class="ov-custom" id="ov-custom">
        <label>From <input type="date" name="from"></label>
        <label>To <input type="date" name="to"></label>
        <div class="seg ov-group" role="group" aria-label="Group by">
          <button type="button" data-group="day">Day</button><button type="button" data-group="week">Week</button><button type="button" data-group="month">Month</button>
        </div>
        <button class="btn btn-small" type="submit">Apply</button>
        <label class="check ov-exclude"><input type="checkbox" id="ov-admins" checked> <span>Exclude admins</span></label>
        <button class="linkish" type="button" id="ov-csv">Download CSV</button>
      </form>
    </div>
    <div id="ov-out"></div>
  </div>`;
  // Listeners live on this wrapper, which is replaced when another tab opens.
  const root = $('.ov', body);
  const out = $('#ov-out', root);
  const form = $('#ov-custom', root);

  function syncControls() {
    $$('[data-preset]', root).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.preset === preset)));
    $$('[data-group]', root).forEach((b) => b.setAttribute('aria-selected', String(b.dataset.group === state.group)));
    form.from.value = state.from;
    form.to.value = state.to;
  }

  async function load() {
    syncControls();
    out.innerHTML = '<span class="sk sk-block"></span><span class="sk sk-block"></span>';
    try {
      data = await api.admin.overview({ ...state, admins: excludeAdmins ? 'exclude' : 'include' });
    } catch (e) {
      if (current()) out.innerHTML = `<p class="form-error">${esc(e.message)}</p>`;
      return;
    }
    if (current()) draw();
  }

  function draw() {
    const d = data;
    const prevLabel = `previous ${d.range.days === 1 ? 'day' : `${d.range.days} days`}`;
    out.innerHTML = `
      <p class="small muted ov-range">${esc(bucketLabel(d.range.from, 'day'))} to ${esc(bucketLabel(d.range.to, 'day'))}, Central Time. Compared with ${esc(bucketLabel(d.previous.from, 'day'))} to ${esc(bucketLabel(d.previous.to, 'day'))}. ${d.exclude_admins ? 'Admin accounts and their visits are left out.' : 'Includes admin accounts and their visits.'}</p>
      <div class="ov-kpis">${KPIS.map(
        ([k, label, sub]) => `<div class="ov-kpi"><span class="label">${esc(label)}</span><b>${num(d.kpis[k])}</b>
          ${k === 'active_ballots' ? `<span class="ov-delta">${esc(sub)}</span>` : delta(d.kpis[k], d.previous_kpis[k], prevLabel)}
          ${sub && k !== 'active_ballots' ? `<span class="ov-sub">${esc(sub)}</span>` : ''}</div>`
      ).join('')}</div>

      <section class="ov-card ov-trend">
        <div class="ov-trend-head"><h3>Trend</h3><div class="ov-metrics">${SERIES.map(
          ([k, l]) => `<button type="button" class="chip-btn" data-metric="${k}" aria-pressed="${k === metric}">${l}</button>`
        ).join('')}</div></div>
        ${chart(d.series, metric, d.range.group)}
      </section>

      <section class="ov-card"><h3>Funnel</h3><div class="ov-funnel">${d.funnel
        .map((f, i) => {
          const w = d.funnel[0].count ? Math.max(2, (f.count / d.funnel[0].count) * 100) : 0;
          return `<div class="ov-step"><div class="ov-step-label"><b>${esc(f.step)}</b><span>${num(f.count)}${
            i && f.rate !== null && f.rate !== undefined ? ` · ${f.rate}% ${i === 3 ? 'of sign-ups' : 'of visitors'}` : ''
          }</span></div><div class="ov-step-bar"><span style="width:${w}%"></span></div></div>`;
        })
        .join('')}</div></section>

      <h2 class="ov-h">Traffic</h2>
      <div class="ov-grid">
        ${table('Top pages', d.traffic.pages, [
          ['visitors', 'Visitors'],
          ['views', 'Views'],
        ])}
        ${table('Where visitors came from', d.traffic.sources, [
          ['visitors', 'Visitors'],
          ['views', 'Views'],
        ])}
        ${table('Devices', d.traffic.devices, [
          ['visitors', 'Visitors'],
          ['views', 'Views'],
        ])}
      </div>

      <h2 class="ov-h">Sign-ups</h2>
      <div class="ov-grid">
        ${table('By county', d.sign_ups.county, [['count', 'Sign-ups']])}
        ${table('By age range', d.sign_ups.age_range, [['count', 'Sign-ups']])}
        ${table('How they signed up', d.sign_ups.method, [['count', 'Sign-ups']])}
        ${table('Came from', d.sign_ups.source, [['count', 'Sign-ups']])}
      </div>

      <h2 class="ov-h">Quiz results in this range</h2>
      ${
        d.quiz.people
          ? `<div class="ov-grid">
          <div class="ov-card"><h3>Average party alignment (${num(d.quiz.people)} people)</h3><div class="bars">${d.quiz.average_alignment
            .map(
              (p) =>
                `<div class="bar-row"><div class="label">${esc(p.name)}</div><div class="bar ${PARTY_CLASS[p.name] || ''}" aria-hidden="true"><span style="width:${p.average}%"></span></div><div class="pct">${p.average}%</div></div>`
            )
            .join('')}</div></div>
          ${table('Closest party match', d.quiz.closest_match, [['count', 'People']])}
          ${table('Most common top issues', d.quiz.top_issues, [['count', 'People']])}
        </div>`
          : '<p class="muted">No quizzes taken in this range.</p>'
      }

      <p class="small muted ov-foot">All time: ${num(d.totals.users)} accounts, ${num(d.totals.quiz_takers)} people have taken the quiz (${num(d.totals.quiz_results)} results), ${num(d.totals.ballots)} saved ballots, ${num(d.totals.partner_links)} live partner links.
      Visitors are counted per day without cookies, so a person who visits on three days counts three times. Visit counts start from the day this tracking went live.</p>`;
  }

  root.addEventListener('click', async (e) => {
    const p = e.target.closest('[data-preset]');
    if (p) {
      preset = p.dataset.preset;
      state = presetRange(preset);
      return load();
    }
    const g = e.target.closest('[data-group]');
    if (g) {
      state = { ...state, group: g.dataset.group };
      return load();
    }
    const m = e.target.closest('[data-metric]');
    if (m && data) {
      metric = m.dataset.metric;
      return draw();
    }
    if (e.target.closest('#ov-csv')) {
      const res = await fetch(
        `/api/admin/overview.csv?${new URLSearchParams({ ...state, admins: excludeAdmins ? 'exclude' : 'include' })}`,
        {
          headers: { Authorization: `Bearer ${session.token}` },
        }
      );
      if (!res.ok) return toast('Could not download the file.');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(await res.blob());
      a.download = `votershub-overview-${state.from}-to-${state.to}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }
  });
  $('#ov-admins', root).addEventListener('change', (e) => {
    excludeAdmins = e.target.checked;
    load();
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!form.from.value || !form.to.value) return toast('Choose both dates.');
    preset = '';
    state = { ...state, from: form.from.value, to: form.to.value };
    load();
  });

  load();
}
