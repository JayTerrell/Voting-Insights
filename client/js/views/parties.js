// The Parties: what each party on Texas ballots says it stands for, in the same
// structure for every party. Overview and values come from each party's own
// platform (data/party-profiles.json); positions on the quiz statements come
// from the guide, with sources.

import { esc, setTitle, PARTY_CLASS } from '../ui.js';
import { loadGuide } from '../api.js';
import { positionLabel } from '../shared/scoring.js';
import { ISSUE_AREAS } from '../shared/issue-offices.js';

let profilesPromise = null;
const loadProfiles = () =>
  (profilesPromise ||= fetch('/data/party-profiles.json')
    .then((r) => (r.ok ? r.json() : { parties: {} }))
    .catch(() => ({ parties: {} })));

export async function renderParties(view, _params, current) {
  setTitle('The Parties');
  const [guide, profiles] = await Promise.all([loadGuide(), loadProfiles()]);
  if (!current()) return;
  const parties = guide.parties;

  view.innerHTML = `<div class="parties-page">
    <span class="eyebrow">Explore</span>
    <h1>The parties</h1>
    <p class="lede">Four parties have candidates on Texas ballots this November. Here is what each one says it stands for, in its own platform, laid out the same way for every party so you can compare them side by side.</p>

    <nav class="party-jump" aria-label="Jump to a party">${parties
      .map((p) => `<a href="#party-${esc(p.id)}" class="party-chip ${esc(PARTY_CLASS[p.short] || '')}">${esc(p.short)}</a>`)
      .join('')}<a href="#party-independent" class="party-chip">Independents</a></nav>

    <section class="panel ideology" aria-labelledby="ideo-h">
      <h2 id="ideo-h">Party or ideology: what is the difference?</h2>
      <div class="ideology-grid">
        <div><h3>Liberal and conservative are ideologies</h3>
          <p>They describe a person's general views about government and society. In broad terms, conservatives tend to favor limited government, lower taxes, free markets, and traditional social values. Liberals tend to favor a more active role for government in the economy and social programs, and expanded civil rights protections.</p></div>
        <div><h3>Democratic and Republican are parties</h3>
          <p>Parties are organizations. They recruit candidates, hold primaries, and adopt written platforms at their conventions. Today most conservatives vote Republican and most liberals vote Democratic, but the two ideas are not the same thing.</p></div>
      </div>
      <ul class="ideology-notes">
        <li>Some voters and candidates sit in the party you might not expect, such as conservative Democrats or moderate Republicans, especially in local races.</li>
        <li>Many people fit neither label. Libertarians want less government on both economic and personal issues. Greens focus on ecology, social justice, and grassroots democracy.</li>
        <li>Parties change over time. For example, many Southern Democrats were conservative until a long political realignment from the 1960s to the 1990s.</li>
        <li>Texas has no party registration. You choose a party for the year by voting in its primary, and in November you may vote for any candidate in any race.</li>
      </ul>
      <p class="small muted" style="margin:10px 0 0">Platforms are written by party conventions. Individual candidates may disagree with parts of their party's platform, which is why VotersHub scores candidates on their own records, not their party label.</p>
    </section>

    <p class="small muted">Parties appear in the order Texas lists them on the general election ballot, which is set by each party's vote for governor in the last election for governor.</p>

    ${parties.map((p) => partySection(p, profiles.parties?.[p.id], guide)).join('')}

    <section class="party-section" id="party-independent" aria-labelledby="ph-independent">
      <div class="party-head"><h2 id="ph-independent">Independent candidates</h2></div>
      <p>Independent candidates run without a party nomination and do not share a written platform, so there is no independent party score. VotersHub compares each independent on their own documented positions, race by race.</p>
    </section>
  </div>`;
}

function partySection(p, prof, guide) {
  const cls = PARTY_CLASS[p.short] || '';
  const src = (ids) =>
    (ids || [])
      .map((id) => p.sources.find((s) => s.id === id))
      .filter(Boolean)
      .map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.publisher || s.title)}</a>`)
      .join(', ');
  const overview = prof?.overview?.length ? prof.overview : [p.summary];
  const byArea = new Map(ISSUE_AREAS.map((a) => [a, []]));
  for (const q of guide.questions) {
    const st = p.stances[q.id];
    if (st && byArea.has(q.category)) byArea.get(q.category).push({ q, st });
  }

  return `<section class="party-section ${cls}" id="party-${esc(p.id)}" aria-labelledby="ph-${esc(p.id)}">
    <div class="party-head">
      <h2 id="ph-${esc(p.id)}">${esc(p.name)}</h2>
      <p class="small muted">Platform: <a href="${esc(p.platform_url)}" target="_blank" rel="noopener">${esc(p.platform_title)}</a></p>
    </div>
    ${overview.map((t) => `<p>${esc(t)}</p>`).join('')}

    ${
      prof?.values?.length
        ? `<h3 class="party-sub">Core values, in the party's words</h3>
      <ul class="party-values">${prof.values
        .map(
          (v) =>
            `<li><b>${esc(v.value)}</b><span>${esc(v.text)}</span>${
              v.quote ? `<q>${esc(v.quote)}</q>${v.where ? `<span class="small muted"> ${esc(v.where)}</span>` : ''}` : ''
            }</li>`
        )
        .join('')}</ul>`
        : ''
    }

    <h3 class="party-sub">Where the platform stands, by issue</h3>
    <div class="party-areas">${ISSUE_AREAS.map((area) => {
      const text = prof?.areas?.[area];
      const stances = byArea.get(area);
      if (!text && !stances.length) return '';
      return `<details class="party-area">
        <summary><span>${esc(area)}</span>${stances.length ? `<span class="small muted">${stances.length} quiz ${stances.length === 1 ? 'statement' : 'statements'}</span>` : ''}</summary>
        ${text ? `<p>${esc(text)}</p>` : ''}
        ${
          stances.length
            ? `<ul class="party-stances">${stances
                .map(
                  ({ q, st }) => `<li><p class="stance-q">${esc(q.statement)}</p>
                  <p><span class="pos">${esc(positionLabel(st.position))}</span> ${esc(st.summary || '')} ${src(st.sources) ? `<span class="small muted">Source: ${src(st.sources)}</span>` : ''}</p></li>`
                )
                .join('')}</ul>`
            : ''
        }
      </details>`;
    }).join('')}</div>
  </section>`;
}
