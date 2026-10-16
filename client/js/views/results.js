import { $, esc, setTitle, formatDate, toast, partyTag, PARTY_CLASS, GROUPS, raceTitle, countyLabel } from '../ui.js';
import { api, loadGuide, resultCache, session } from '../api.js';
import { positionLabel, IMPORTANCE } from '../shared/scoring.js';

export async function renderResults(view, [shareId], current) {
  setTitle('Your Results');
  const guide = await loadGuide();
  if (!current()) return;
  const isNew = new URLSearchParams(location.search).get('new') === '1';

  const cached = resultCache.get(shareId);
  if (cached) draw(view, guide, cached, isNew);

  let fresh;
  try {
    fresh = await api.result(shareId);
  } catch (e) {
    if (!cached && current())
      view.innerHTML = `<h1>Results not found</h1><p>${esc(e.message)}</p><p><a href="/quiz">Take the quiz</a></p>`;
    return;
  }
  if (!current()) return;
  if (fresh.owner) resultCache.put(fresh);
  // Redraw only when something visible changed, so the page does not jump.
  if (!cached || cached.owner !== fresh.owner || cached.data_version !== fresh.data_version) draw(view, guide, fresh, isNew);
}

function bar(score, cls = '') {
  const w = score === null ? 0 : score;
  return `<div class="bar ${cls}" aria-hidden="true"><span style="width:${w}%"></span></div>`;
}

function draw(view, guide, data, isNew) {
  const { results } = data;
  const owner = Boolean(data.owner);
  const url = `${location.origin}/results/${data.share_id}`;
  const parties = [...results.parties].filter((p) => p.score !== null).sort((a, b) => b.score - a.score);
  const best = parties[0];
  const raceById = Object.fromEntries(guide.races.map((r) => [r.id, r]));
  const contested = results.races.filter((r) => !r.uncontested);
  const uncontested = results.races.filter((r) => r.uncontested);
  const shareText = best
    ? `I took the nonpartisan 2026 Texas ballot quiz. My closest party platform match was ${best.name} at ${best.score}%. See how your views line up with the candidates:`
    : 'I took the nonpartisan 2026 Texas ballot quiz. See how your views line up with the candidates:';
  const enc = encodeURIComponent;

  const summaryRows = contested
    .map((r) => {
      const top = r.candidates.find((c) => c.id === r.top);
      const cell = top
        ? `${esc(top.name)} ${partyTag(top.party)}${r.tie ? ' <span class="tag">Close race</span>' : ''}`
        : '<span class="muted">Not enough documented positions</span>';
      return `<tr><td><a href="/candidates/${esc(r.id)}">${esc(raceById[r.id] ? raceTitle(raceById[r.id]) : r.title)}</a></td><td>${cell}</td><td class="num">${top ? top.score + '%' : ''}</td></tr>`;
    })
    .join('');

  const groups = GROUPS.map((g) => {
    const races = contested.filter((r) => r.group === g.id);
    if (!races.length) return '';
    return `<h3 class="group-title">${esc(g.label)}</h3>${races
      .map((r) => {
        const rows = r.candidates
          .map((c) => {
            const val =
              c.score === null
                ? '<span class="muted">No data</span>'
                : `<b>${c.score}%</b>${c.limited ? '<br><span class="small muted">limited data</span>' : ''}`;
            return `<div class="cand-score ${r.top === c.id ? 'top' : ''}">
              <div class="nm"><a href="/candidate/${esc(c.id)}">${esc(c.name)}</a>${partyTag(c.party)}</div>
              ${bar(c.score, PARTY_CLASS[c.party])}
              <div class="val">${val}</div></div>`;
          })
          .join('');
        return `<div class="race-result">
          <div><h3>${esc(raceById[r.id] ? raceTitle(raceById[r.id]) : r.title)}</h3>
            <p class="small muted" style="margin:0">Compared on up to ${r.questions} questions for this office. ${
              r.tie ? 'The top two are within 3 points.' : ''
            }</p>
            <a class="small" href="/candidates/${esc(r.id)}">Compare these candidates</a>
            <span class="small muted"> | </span><a class="small" href="/scoring?race=${esc(r.id)}">Scores and sources</a></div>
          <div>${rows}</div></div>`;
      })
      .join('')}`;
  }).join('');

  const answersBlock =
    owner && data.answers
      ? `<details class="panel" style="margin-top:28px"><summary><b>Your answers</b> (visible only to you)</summary>
        <table class="ballot" style="margin-top:14px"><thead><tr><th>Statement</th><th>Your answer</th><th>Importance</th></tr></thead><tbody>
        ${guide.questions
          .map((q) => {
            const a = data.answers[q.id];
            return `<tr><td>${esc(q.statement)}</td><td>${a ? esc(positionLabel(a.value)) : '<span class="muted">Skipped</span>'}</td><td>${
              a ? esc(IMPORTANCE.find((i) => i.value === a.weight)?.label || '') : ''
            }</td></tr>`;
          })
          .join('')}</tbody></table></details>`
      : '';

  view.innerHTML = `
  ${isNew && owner ? `<div class="callout" role="status" style="margin-bottom:20px">Your results are saved${session.user ? ` to ${esc(session.user.email)}` : ''} and a copy is on its way to your inbox. Find them any time in <a href="/account">your account</a>, and mark your choices on <a href="/my-ballot">My Ballot</a>.</div>` : ''}
  ${data.current_version && data.data_version !== data.current_version ? `<div class="callout" style="margin-bottom:20px">Candidate research has been updated since these results were calculated. <a href="/quiz">Retake the quiz</a> to use the latest information.</div>` : ''}
  <div class="result-head">
    <div>
      <span class="eyebrow">Quiz Results</span>
      <h1 style="margin-bottom:4px">${esc(data.first_name ? `${data.first_name}'s` : 'Your')} ballot alignment</h1>
      <p class="muted" style="margin:0">Taken ${esc(formatDate(data.created_at))} Central Time. ${results.answered} of ${results.total} questions answered.${
        results.county
          ? ` Ballot: ${esc(countyLabel(results.county))}${results.full_ballot ? '' : ' (statewide races only)'}.`
          : ''
      }</p>
    </div>
    <div class="btn-row">
      ${owner ? '<button class="btn btn-ghost btn-small" id="email-me">Email me a copy</button>' : ''}
      <a class="btn btn-small ${owner ? '' : 'btn-red'}" href="/quiz">${owner ? 'Retake the quiz' : 'Take the quiz yourself'}</a>
    </div>
  </div>

  <div class="panel" style="margin-top:20px">
    <div class="share-row">
      <b style="margin-right:6px">Share these results:</b>
      <button class="btn btn-small" id="share-native" hidden>Share</button>
      <button class="btn btn-ghost btn-small" id="copy">Copy link</button>
      <a class="btn btn-ghost btn-small" target="_blank" rel="noopener" href="https://twitter.com/intent/tweet?text=${enc(shareText)}&url=${enc(url)}">X</a>
      <a class="btn btn-ghost btn-small" target="_blank" rel="noopener" href="https://www.facebook.com/sharer/sharer.php?u=${enc(url)}">Facebook</a>
      <a class="btn btn-ghost btn-small" target="_blank" rel="noopener" href="https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}">LinkedIn</a>
      <a class="btn btn-ghost btn-small" target="_blank" rel="noopener" href="https://wa.me/?text=${enc(shareText + ' ' + url)}">WhatsApp</a>
      <a class="btn btn-ghost btn-small" href="mailto:?subject=${enc('My 2026 Texas ballot quiz results')}&body=${enc(shareText + '\n\n' + url)}">Email a friend</a>
    </div>
    <p class="small muted" style="margin:10px 0 0">The shared page shows your first name and match percentages. It never shows your email, last name, or individual answers.</p>
  </div>

  <section aria-labelledby="party-h">
    <div class="section-head"><h2 id="party-h">Party platform alignment</h2></div>
    ${best ? `<p class="lede">Your answers align most closely with the <b>${esc(best.name)}</b> party platform, at ${best.score}%.</p>` : ''}
    <div class="panel"><div class="bars">
      ${parties
        .map(
          (p) =>
            `<div class="bar-row"><div class="label">${esc(p.name)}</div>${bar(p.score, PARTY_CLASS[p.name])}<div class="pct" data-count="${p.score}" data-suffix="%">${p.score}%</div></div>`
        )
        .join('')}
    </div>
    <p class="small muted" style="margin:16px 0 0">Each percentage measures agreement with that party's official Texas platform on the questions both of you addressed, so the numbers do not add up to 100. Independent candidates do not share a written platform, so there is no independent score. Where an independent appears on your ballot, compare them race by race below. <a href="/scoring">See the scoring logic and every score with its source</a></p>
    </div>
  </section>

  ${results.county && !results.full_ballot ? `<div class="callout" style="margin-top:20px">The full ${esc(countyLabel(results.county))} ballot has not been loaded yet, so these results cover statewide races only. Retake the quiz after your county is added to see every race on your ballot.</div>` : ''}
  <section aria-labelledby="sum-h">
    <div class="section-head"><h2 id="sum-h">Closest match in each contested race</h2></div>
    <table class="ballot summary-table"><thead><tr><th>Race</th><th>Closest documented match</th><th class="num">Match</th></tr></thead><tbody>${summaryRows}</tbody></table>
    <p class="small muted" style="margin-top:10px">A match is based only on documented public positions. Many judicial and county candidates have few public issue statements, partly because judicial ethics rules limit what judges may promise. Districts depend on your address, so not every race here is on your ballot.</p>
  </section>

  <section aria-labelledby="full-h">
    <div class="section-head"><h2 id="full-h">Every candidate, race by race</h2></div>
    ${groups}
  </section>

  <section aria-labelledby="unc-h">
    <div class="section-head"><h2 id="unc-h">Uncontested races</h2></div>
    <p>These candidates have no opponent on the November ballot.</p>
    <table class="ballot"><tbody>${uncontested
      .map((r) => {
        const c = r.candidates[0];
        return `<tr><td>${esc(raceById[r.id] ? raceTitle(raceById[r.id]) : r.title)}</td><td><a href="/candidate/${esc(c.id)}">${esc(c.name)}</a> ${partyTag(c.party)}</td></tr>`;
      })
      .join('')}</tbody></table>
  </section>
  ${answersBlock}`;

  const nativeBtn = $('#share-native', view);
  if (navigator.share) {
    nativeBtn.hidden = false;
    nativeBtn.addEventListener('click', () =>
      navigator.share({ title: 'My ballot alignment', text: shareText, url }).catch(() => {})
    );
  }
  $('#copy', view).addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied');
    } catch {
      prompt('Copy this link:', url);
    }
  });
  $('#email-me', view)?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      const r = await api.emailResult(data.share_id);
      toast(`Sent to ${r.to}`);
    } catch (ex) {
      toast(ex.message);
      e.target.disabled = false;
    }
  });
}
