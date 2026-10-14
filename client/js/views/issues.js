import { $, esc, setTitle, partyTag, cites, GROUPS, raceTitle, countyPicker, ballotNote } from '../ui.js';
import { loadGuide, loadFormOptions, ballotCounty } from '../api.js';
import { positionLabel, BASIS_LABEL, racesForCounty } from '../shared/scoring.js';

function highlight(text, term) {
  const safe = esc(text);
  if (!term) return safe;
  const re = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return safe.replace(re, '<mark>$1</mark>');
}

function snippet(text, term, radius = 140) {
  const i = text.toLowerCase().indexOf(term.toLowerCase());
  if (i < 0 || text.length <= radius * 2) return text;
  const start = Math.max(0, i - radius);
  const end = Math.min(text.length, i + term.length + radius);
  return (start ? '...' : '') + text.slice(start, end) + (end < text.length ? '...' : '');
}

export async function renderIssues(view, _params, current) {
  setTitle('Compare by Issue');
  const [guide, options] = await Promise.all([loadGuide(), loadFormOptions()]);
  if (!current()) return;
  const params = new URLSearchParams(location.search);
  let county = params.get('county') || ballotCounty.get(guide);
  const onBallot = () => racesForCounty(guide, county);
  let selected = params.get('issue') || '';
  let term = params.get('q') || '';
  let showEmpty = false;

  const cats = [...new Set(guide.questions.map((q) => q.category))];
  const topicCounts = {};
  for (const r of guide.races)
    for (const c of r.candidates)
      for (const n of c.issue_notes) {
        const k = n.topic.trim();
        topicCounts[k] = (topicCounts[k] || 0) + 1;
      }
  const topics = Object.keys(topicCounts)
    .filter((t) => topicCounts[t] >= 2)
    .sort((a, b) => a.localeCompare(b));

  view.innerHTML = `
    <span class="eyebrow">Compare by Issue</span>
    <h1>Where every candidate stands on an issue</h1>
    <p class="lede">Pick an issue from the list to see each candidate's documented position, or type any word, such as water, tariffs, or bail, to search everything we have recorded about every candidate.</p>
    <div class="filters">
      <div>
        <label for="issue">Choose an issue</label>
        <select id="issue">
          <option value="">Select an issue</option>
          ${cats
            .map(
              (cat) =>
                `<optgroup label="${esc(cat)}">${guide.questions
                  .filter((q) => q.category === cat)
                  .map(
                    (q) => `<option value="q:${q.id}" ${selected === 'q:' + q.id ? 'selected' : ''}>${esc(q.statement)}</option>`
                  )
                  .join('')}</optgroup>`
            )
            .join('')}
          ${
            topics.length
              ? `<optgroup label="Other topics candidates discuss">${topics
                  .map((t) => `<option value="t:${esc(t)}" ${selected === 't:' + t ? 'selected' : ''}>${esc(t)}</option>`)
                  .join('')}</optgroup>`
              : ''
          }
        </select>
      </div>
      <div>
        <label for="term">Or search a word</label>
        <input id="term" type="search" placeholder="For example: water" value="${esc(term)}">
      </div>
    </div>
    <div class="filters" style="grid-template-columns:1fr"><div style="max-width:420px">${countyPicker(guide, options.counties, county)}</div></div>
    <div id="ballot-note"></div>
    <div id="issue-out" aria-live="polite"></div>`;

  const out = $('#issue-out', view);

  function syncUrl() {
    const p = new URLSearchParams();
    if (selected) p.set('issue', selected);
    if (term) p.set('q', term);
    p.set('county', county);
    history.replaceState({}, '', `/issues${p.toString() ? '?' + p : ''}`);
  }

  function drawQuestion(qid) {
    const q = guide.questionIndex[qid];
    const partyRows = guide.parties
      .map((p) => {
        const s = p.stances[qid];
        const src = s ? s.sources.map((id) => p.sources.find((x) => x.id === id)).filter(Boolean) : [];
        return `<tr><td>${esc(p.short)}</td><td>${
          s
            ? `<span class="pos">${esc(positionLabel(s.position))}</span>${esc(s.summary)} ${src
                .map((x) => `<a class="small" href="${esc(x.url)}" target="_blank" rel="noopener">[source]</a>`)
                .join(' ')}`
            : '<span class="pos-none">Platform does not address this</span>'
        }</td></tr>`;
      })
      .join('');

    let documentedTotal = 0;
    const groups = GROUPS.map((g) => {
      const races = onBallot()
        .filter((r) => r.group === g.id)
        .map((r) => {
          const applies = q.offices.includes(r.office_type);
          const rows = r.candidates.filter((c) => c.stances[qid] || (showEmpty && applies));
          if (!rows.length) return '';
          documentedTotal += rows.filter((c) => c.stances[qid]).length;
          return `<div class="issue-group"><h3><a href="/candidates/${esc(r.id)}">${esc(raceTitle(r))}</a></h3>${rows
            .map((c) => {
              const s = c.stances[qid];
              return `<div class="hit"><div><a href="/candidate/${esc(c.id)}"><b>${esc(c.name)}</b></a><br>${partyTag(c.party)}</div><div>${
                s
                  ? `<span class="pos">${esc(positionLabel(s.position))}</span>${esc(s.summary)}${cites(s.sources, c, 'src-' + c.id)}<span class="basis">${esc(BASIS_LABEL[s.basis] || s.basis)}</span>`
                  : '<span class="pos-none">No documented position</span>'
              }</div></div>`;
            })
            .join('')}</div>`;
        })
        .join('');
      return races ? `<h2 class="group-title">${esc(g.label)}</h2>${races}` : '';
    }).join('');

    out.innerHTML = `
      <div class="panel">
        <span class="eyebrow">${esc(q.category)}</span>
        <h2 style="margin-bottom:8px">${esc(q.statement)}</h2>
        <p style="margin:0">${esc(q.context)}</p>
      </div>
      <div class="section-head"><h2>What the party platforms say</h2></div>
      <table class="ballot"><tbody>${partyRows}</tbody></table>
      <div class="section-head"><h2>Candidates with a documented position</h2>
        <label class="check small" style="margin:0"><input type="checkbox" id="show-empty" ${showEmpty ? 'checked' : ''}> <span>Also list candidates for these offices with no documented position</span></label></div>
      ${groups || '<p class="muted">No candidate has a documented position on this question yet.</p>'}
      <p class="small muted" style="margin-top:16px">${documentedTotal} documented positions shown.</p>`;
    $('#show-empty', out).addEventListener('change', (e) => {
      showEmpty = e.target.checked;
      drawQuestion(qid);
    });
  }

  function drawTopic(topic) {
    const hits = [];
    for (const r of onBallot())
      for (const c of r.candidates) for (const n of c.issue_notes) if (n.topic.trim() === topic) hits.push({ r, c, n });
    out.innerHTML = `<div class="section-head"><h2>${esc(topic)}</h2><span class="small muted">${hits.length} statements</span></div>
      ${hits
        .map(
          ({
            r,
            c,
            n,
          }) => `<div class="hit"><div><a href="/candidate/${esc(c.id)}"><b>${esc(c.name)}</b></a><br>${partyTag(c.party)}<br><span class="small muted">${esc(raceTitle(r))}</span></div>
          <div>${esc(n.summary)}${cites(n.sources, c, 'src-' + c.id)}</div></div>`
        )
        .join('')}`;
  }

  function drawSearch(t) {
    const needle = t.toLowerCase();
    const matchingQs = guide.questions.filter((q) =>
      (q.statement + ' ' + q.context + ' ' + q.category).toLowerCase().includes(needle)
    );
    const results = [];
    for (const r of onBallot())
      for (const c of r.candidates) {
        const found = [];
        const consider = (label, text, sources) => {
          if (text && text.toLowerCase().includes(needle)) found.push({ label, text, sources });
        };
        consider('Background', c.background, []);
        consider('Current role', c.current_role, []);
        c.priorities.forEach((i) => consider('Priority', i.text, i.sources));
        c.promises.forEach((i) => consider('Promise', i.text, i.sources));
        c.record.forEach((i) => consider('Record', i.text, i.sources));
        c.notes.forEach((i) => consider('Note', i.text, i.sources));
        c.issue_notes.forEach((i) => consider(i.topic, i.topic + ': ' + i.summary, i.sources));
        for (const [qid, s] of Object.entries(c.stances)) {
          const q = guide.questionIndex[qid];
          if ((s.summary + ' ' + q.statement).toLowerCase().includes(needle)) {
            found.push({
              label: `${q.category}: ${positionLabel(s.position)}`,
              text: s.summary || q.statement,
              sources: s.sources,
            });
          }
        }
        if (found.length) results.push({ r, c, found });
      }

    out.innerHTML = `
      ${
        matchingQs.length
          ? `<div class="callout" style="margin-bottom:16px">Related quiz questions: ${matchingQs
              .map((q) => `<button class="linkish" data-q="${q.id}">${esc(q.statement)}</button>`)
              .join('; ')}</div>`
          : ''
      }
      <div class="section-head"><h2>Results for "${esc(t)}"</h2><span class="small muted">${results.length} candidates</span></div>
      ${
        results.length
          ? results
              .map(
                ({
                  r,
                  c,
                  found,
                }) => `<div class="issue-group"><h3><a href="/candidate/${esc(c.id)}">${esc(c.name)}</a> ${partyTag(c.party)} <span class="small muted" style="font-family:var(--sans)">${esc(raceTitle(r))}</span></h3>
                ${found
                  .slice(0, 6)
                  .map(
                    (f) =>
                      `<div class="hit"><div class="small muted">${esc(f.label)}</div><div>${highlight(snippet(f.text, t), t)}${cites(f.sources, c, 'src-' + c.id)}</div></div>`
                  )
                  .join('')}
                ${found.length > 6 ? `<p class="small"><a href="/candidate/${esc(c.id)}">${found.length - 6} more matches in the full profile</a></p>` : ''}</div>`
              )
              .join('')
          : '<p class="muted">No candidate statements mention that word. Try a broader term.</p>'
      }`;
    out.querySelectorAll('[data-q]').forEach((b) =>
      b.addEventListener('click', () => {
        selected = 'q:' + b.dataset.q;
        term = '';
        $('#issue', view).value = selected;
        $('#term', view).value = '';
        draw();
      })
    );
  }

  function draw() {
    syncUrl();
    $('#ballot-note', view).innerHTML = ballotNote(guide, county);
    if (term.trim().length >= 2) return drawSearch(term.trim());
    if (selected.startsWith('q:')) return drawQuestion(selected.slice(2));
    if (selected.startsWith('t:')) return drawTopic(selected.slice(2));
    out.innerHTML = `<div class="section-head"><h2>Browse by category</h2></div>
      <table class="ballot"><thead><tr><th>Issue</th><th class="num">Candidates with a documented position</th></tr></thead><tbody>
      ${guide.questions
        .map((q) => {
          const n = onBallot().reduce((acc, r) => acc + r.candidates.filter((c) => c.stances[q.id]).length, 0);
          return `<tr><td><span class="small muted">${esc(q.category)}</span><br><button class="linkish" data-q="${q.id}" style="text-align:left">${esc(q.statement)}</button></td><td class="num">${n}</td></tr>`;
        })
        .join('')}</tbody></table>`;
    out.querySelectorAll('[data-q]').forEach((b) =>
      b.addEventListener('click', () => {
        selected = 'q:' + b.dataset.q;
        $('#issue', view).value = selected;
        draw();
        out.scrollIntoView({ block: 'start' });
      })
    );
  }

  $('#ballot-county', view).addEventListener('change', (e) => {
    county = e.target.value;
    ballotCounty.set(county);
    draw();
  });
  $('#issue', view).addEventListener('change', (e) => {
    selected = e.target.value;
    term = '';
    $('#term', view).value = '';
    draw();
  });
  let timer;
  $('#term', view).addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      term = e.target.value;
      if (term) {
        selected = '';
        $('#issue', view).value = '';
      }
      draw();
    }, 180);
  });
  draw();
}
