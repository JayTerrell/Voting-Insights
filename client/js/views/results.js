import { $, esc, setTitle, formatDate, toast, partyTag, PARTY_CLASS, GROUPS, raceTitle, countyLabel } from '../ui.js';
import { api, loadGuide, resultCache, session, partnerRef } from '../api.js';
import { positionLabel, IMPORTANCE } from '../shared/scoring.js';
import { openIssuesPicker } from './issues-picker.js';

export async function renderResults(view, [shareId], current) {
  setTitle('Your Results');
  const guide = await loadGuide();
  if (!current()) return;
  const isNew = new URLSearchParams(location.search).get('new') === '1';

  const cached = resultCache.get(shareId);
  if (cached?.owner) draw(view, guide, cached, isNew);

  let fresh;
  try {
    fresh = await api.result(shareId);
  } catch (e) {
    if (!cached && current())
      view.innerHTML = `<h1>Results not found</h1><p>${esc(e.message)}</p><p><a href="/quiz">Take the quiz</a></p>`;
    return;
  }
  if (!current()) return;
  if (!fresh.owner) {
    return drawPreview(view, fresh);
  }
  resultCache.put(fresh);
  // Right after the quiz: offer the voter's top issues and the offices that control them.
  if (isNew && fresh.issue_ranking?.length && !offered.has(shareId)) {
    offered.add(shareId);
    history.replaceState({}, '', location.pathname);
    openIssuesPicker({
      guide,
      county: fresh.results.county || session.user?.county,
      ranking: fresh.issue_ranking,
      firstTime: true,
    });
  }
  // Redraw only when something visible changed, so the page does not jump.
  if (!cached?.owner || cached.data_version !== fresh.data_version || cached.share_issues !== fresh.share_issues)
    draw(view, guide, fresh, isNew);
}

function bar(score, cls = '') {
  const w = score === null ? 0 : score;
  return `<div class="bar ${cls}" aria-hidden="true"><span style="width:${w}%"></span></div>`;
}

const offered = new Set();
const PARTY_BAR = (name) => PARTY_CLASS[name] || '';
// Social networks save a link's preview the first time it is posted. The share
// link carries a version, so a new design or a change to the top issues setting
// gives a fresh link that networks fetch again. Bump IMAGE_REV when the image changes.
const IMAGE_REV = 2;
const shareLink = (data) =>
  `${location.origin}/results/${encodeURIComponent(data.share_id)}?v=${IMAGE_REV}${data.share_issues ? 'i' : ''}`;
const imageUrl = (id, format, v) => `/api/share/${encodeURIComponent(id)}/${format}.png?v=${v ? 2 : 1}`;

function partyBars(parties) {
  return `<div class="bars">${parties
    .map(
      (p) =>
        `<div class="bar-row ${p.score === parties[0].score ? 'lead' : ''}"><div class="label">${esc(p.name)}${p.score === parties[0].score ? ' <span class="tag tag-red">Closest</span>' : ''}</div>${bar(p.score, PARTY_BAR(p.name))}<div class="pct" data-count="${p.score}" data-suffix="%">${p.score}%</div></div>`
    )
    .join('')}</div>`;
}

function issuesBlock(issues) {
  return issues.length
    ? `<div class="top-issues"><span class="eyebrow">Top issues</span><ol>${issues.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></div>`
    : '';
}

// What anyone else sees at a shared link: the same summary as the share image,
// then an invitation to take the quiz. Race-by-race matches stay private.
function drawPreview(view, data) {
  const p = data.preview;
  const name = p.first_name || 'Someone';
  setTitle(`${name}'s ballot alignment`);
  const quizHref = session.token ? '/quiz' : '/sign-up?next=/quiz';
  view.innerHTML = `<div class="share-preview">
    <span class="eyebrow">Shared quiz result</span>
    <h1>${esc(name)}'s ballot alignment</h1>
    <p class="muted">Agreement with each party's official Texas platform, from the VotersHub issue quiz.</p>
    <div class="share-preview-grid ${p.issues.length ? '' : 'no-issues'}">
      <div class="panel">${p.parties.length ? partyBars(p.parties) : '<p class="muted">Not enough answers to compare with party platforms.</p>'}
        <p class="small muted" style="margin:14px 0 0">Each percentage is measured separately, so they do not add up to 100.</p></div>
      ${issuesBlock(p.issues)}
    </div>
    <section class="share-cta">
      <span class="share-cta-star" aria-hidden="true"></span>
      <h2>Where do you stand?</h2>
      <p>Answer ${esc(String(p.total || 31))} short questions and see how every candidate on your ballot lines up with your views, race by race. Free, nonpartisan, and every score links to its source.</p>
      <div class="btn-row"><a class="btn btn-red btn-large" href="${quizHref}">Take the quiz yourself</a><a class="btn btn-ghost-light" href="/candidates">Browse the candidates</a></div>
      ${session.token ? '' : '<p class="small">A free account saves your results privately. We never sell your information.</p>'}
    </section>
    ${session.token ? '' : `<p class="small muted" style="text-align:center;margin-top:18px">Is this yours? <a href="/sign-in?next=${encodeURIComponent(location.pathname)}">Sign in</a> to see your full results.</p>`}
  </div>`;
}

function shareText() {
  return "Here's how my views line up with each party's Texas platform. Take the nonpartisan VotersHub quiz and see where you stand:";
}

function sharePanel(data, url) {
  const enc = encodeURIComponent;
  const text = shareText();
  const issues = data.top_issues || [];
  return `<div class="panel share-panel" id="share-panel">
    <div class="share-panel-grid">
      <figure class="share-image"><img id="share-img" src="${imageUrl(data.share_id, 'card', data.share_issues)}" alt="Preview of your share image" width="1200" height="630"></figure>
      <div>
        <h2 class="share-title">Share your alignment</h2>
        <p class="small muted">Your post shows this image: your first name and party percentages${issues.length ? ', plus your top issues if you choose' : ''}. People who open your link see the same summary and an invitation to take the quiz. They never see your answers, your race-by-race matches, or your last name or email.</p>
        ${
          issues.length
            ? `<label class="check share-issues"><input type="checkbox" id="share-issues" ${data.share_issues ? 'checked' : ''}> <span>Include my top 3 issues: <b>${issues.map(esc).join(', ')}</b></span></label>`
            : ''
        }
        <div class="share-row">
          <button class="btn btn-small" id="share-native" hidden>Share</button>
          <a class="btn btn-ghost btn-small" target="_blank" rel="noopener" href="https://twitter.com/intent/tweet?text=${enc(text)}&url=${enc(url)}">X</a>
          <a class="btn btn-ghost btn-small" target="_blank" rel="noopener" href="https://www.facebook.com/sharer/sharer.php?u=${enc(url)}">Facebook</a>
          <a class="btn btn-ghost btn-small" target="_blank" rel="noopener" href="https://www.threads.net/intent/post?text=${enc(`${text} ${url}`)}">Threads</a>
          <button class="btn btn-ghost btn-small" id="share-instagram">Instagram Story</button>
          <a class="btn btn-ghost btn-small" target="_blank" rel="noopener" href="https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}">LinkedIn</a>
          <a class="btn btn-ghost btn-small" href="mailto:?subject=${enc('Where do you stand? The 2026 Texas ballot quiz')}&body=${enc(`${text}\n\n${url}`)}">Email</a>
          <button class="btn btn-ghost btn-small" id="copy">Copy link</button>
        </div>
        <p class="small muted share-downloads">Download the image: <a id="dl-card" href="${imageUrl(data.share_id, 'card', data.share_issues)}&download=1">post (wide)</a> or <a id="dl-story" href="${imageUrl(data.share_id, 'story', data.share_issues)}&download=1">story (tall)</a></p>
      </div>
    </div>
  </div>`;
}

function bindShare(view, data, url) {
  const text = shareText();
  // A share by someone who arrived through a partner link counts toward that link.
  $('#share-panel', view).addEventListener('click', (e) => {
    if (e.target.closest('.share-row a, .share-row button')) partnerRef.event('share');
  });
  let withIssues = Boolean(data.share_issues);
  $('#share-issues', view)?.addEventListener('change', async (e) => {
    const want = e.target.checked;
    e.target.disabled = true;
    try {
      await api.setShareIssues(data.share_id, want);
      withIssues = want;
      data.share_issues = want;
      resultCache.put(data);
      // The share buttons need the new link, so the panel is drawn again.
      const panel = $('#share-panel', view);
      panel.outerHTML = sharePanel(data, shareLink(data));
      bindShare(view, data, shareLink(data));
      toast(want ? 'Your top issues will show when you share.' : 'Your top issues are hidden from your share.');
    } catch (ex) {
      e.target.checked = !want;
      toast(ex.message);
    } finally {
      e.target.disabled = false;
    }
  });

  const storyFile = async () => {
    const res = await fetch(imageUrl(data.share_id, 'story', withIssues));
    if (!res.ok) throw new Error('We could not make your image. Please try again.');
    return new File([await res.blob()], 'votershub-story.png', { type: 'image/png' });
  };

  // Phones can hand the image straight to Instagram (choose Stories); elsewhere
  // the story image downloads so it can be posted from the Instagram app.
  $('#share-instagram', view).addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.classList.add('is-loading');
    try {
      const file = await storyFile();
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] }).catch(() => {});
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(file);
        a.download = file.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        toast('Story image saved. In Instagram, add a story and choose this image. Add a link sticker with your results link.');
      }
    } catch (ex) {
      toast(ex.message);
    } finally {
      btn.classList.remove('is-loading');
    }
  });

  const nativeBtn = $('#share-native', view);
  if (navigator.share) {
    nativeBtn.hidden = false;
    nativeBtn.addEventListener('click', async () => {
      try {
        const res = await fetch(imageUrl(data.share_id, 'card', withIssues));
        const file = new File([await res.blob()], 'votershub.png', { type: 'image/png' });
        const payload = { title: 'My ballot alignment', text, url };
        await navigator.share(navigator.canShare?.({ ...payload, files: [file] }) ? { ...payload, files: [file] } : payload);
      } catch {
        // The person closed the share sheet.
      }
    });
  }
  $('#copy', view).addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied');
    } catch {
      prompt('Copy this link:', url);
    }
  });
}

function draw(view, guide, data, isNew) {
  const { results } = data;
  const owner = Boolean(data.owner);
  const url = shareLink(data);
  const parties = [...results.parties].filter((p) => p.score !== null).sort((a, b) => b.score - a.score);
  const best = parties[0];
  const raceById = Object.fromEntries(guide.races.map((r) => [r.id, r]));
  const contested = results.races.filter((r) => !r.uncontested);
  const uncontested = results.races.filter((r) => r.uncontested);

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
            <span class="small muted"> | </span><a class="small" href="/scoring">How scores work</a></div>
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
  ${isNew && owner ? `<div class="callout" role="status" style="margin-bottom:20px">Your results are saved${session.user ? ` to ${esc(session.user.email)}` : ''} and a copy is on its way to your inbox. Find them any time on <a href="/profile">your profile</a>, and mark your choices on <a href="/my-ballot">My Ballot</a>.</div>` : ''}
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

  ${sharePanel(data, url)}

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

  bindShare(view, data, url);
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
