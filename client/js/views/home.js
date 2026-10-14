import { $, esc, setTitle, starRule, GROUPS, countyPicker, countyLabel } from '../ui.js';
import { loadGuide, loadFormOptions, session, resultCache, ballotCounty } from '../api.js';
import { racesForCounty } from '../shared/scoring.js';

export async function renderHome(view, _params, current) {
  setTitle('');
  const [guide, options] = await Promise.all([loadGuide(), loadFormOptions()]);
  if (!current()) return;
  let county = ballotCounty.get(guide);
  const loaded = Object.keys(guide.ballots || {}).sort();

  const cands = guide.races.flatMap((r) => r.candidates);
  const stanceCount = cands.reduce((n, c) => n + Object.keys(c.stances).length, 0);
  const sourceCount = cands.reduce((n, c) => n + c.sources.length, 0);
  const user = session.user;
  const cached = Object.values(resultCache.all()).sort((a, b) => b.created_at.localeCompare(a.created_at));

  function glance() {
    const onBallot = racesForCounty(guide, county);
    const rows = GROUPS.map((g) => {
      const races = onBallot.filter((r) => r.group === g.id);
      if (!races.length) return '';
      const c = races.reduce((n, r) => n + r.candidates.length, 0);
      const open = races.filter((r) => r.candidates.length > 1).length;
      return `<tr><td><a href="/candidates?county=${encodeURIComponent(county)}&group=${g.id}">${esc(g.label)}</a></td><td class="num">${races.length}</td><td class="num">${open}</td><td class="num">${c}</td></tr>`;
    }).join('');
    const total = onBallot.reduce((n, r) => n + r.candidates.length, 0);
    const contestedN = onBallot.filter((r) => r.candidates.length > 1).length;
    return `<table class="ballot">
      <thead><tr><th>Level</th><th class="num">Races</th><th class="num">Contested</th><th class="num">Candidates</th></tr></thead>
      <tbody>${rows}<tr><td><b>Total</b></td><td class="num"><b>${onBallot.length}</b></td><td class="num"><b>${contestedN}</b></td><td class="num"><b>${total}</b></td></tr></tbody>
    </table>
    ${guide.ballots && Object.hasOwn(guide.ballots, county) ? '' : `<p class="small" style="margin-top:10px">The full ${esc(countyLabel(county))} ballot has not been loaded yet, so only statewide races are counted.</p>`}`;
  }

  view.innerHTML = `
  <section class="hero">
    <div>
      <span class="eyebrow">Issue Alignment Quiz</span>
      <h1>See which candidates on your ballot share your views.</h1>
      <p class="lede">Answer ${guide.questions.length} questions on the issues these offices actually handle. We compare your answers with each candidate's documented public record and show how closely you align, race by race, with links to every source.</p>
      <div class="btn-row">
        <a class="btn btn-red" href="/quiz">Start the quiz</a>
        <a class="btn btn-ghost" href="/candidates">Read the candidate guide</a>
      </div>
      ${
        user && cached.length
          ? `<p class="small" style="margin-top:14px">Welcome back, ${esc(user.first_name)}. <a href="/results/${esc(cached[0].share_id)}">Open your most recent results</a> or see <a href="/my-results">all of your results</a>.</p>`
          : `<p class="small muted" style="margin-top:14px">Takes about 6 minutes. You can skip any question and retake the quiz as often as you like.</p>`
      }
    </div>
    <aside class="dates" aria-labelledby="dates-h">
      <h2 id="dates-h">Key dates and information</h2>
      <dl>
        <dt>Early voting</dt><dd>Monday, October 19 to Friday, October 30, 2026</dd>
        <dt>Last day to apply for a mail ballot</dt><dd>Received by Friday, October 23, 2026</dd>
        <dt>Election Day</dt><dd>Tuesday, November 3, 2026, 7 a.m. to 7 p.m.</dd>
        <dt>Bring</dt><dd>An acceptable photo ID. <a href="https://www.votetexas.gov/mobile/id-faqs.htm" rel="noopener" target="_blank">See the ID list</a></dd>
        <dt>Polling places and sample ballots</dt><dd><a href="https://www.votetexas.gov/" rel="noopener" target="_blank">VoteTexas.gov</a> or your county elections office${loaded.includes('Collin') ? ` (<a href="https://www.collincountytx.gov/Elections" rel="noopener" target="_blank">Collin County Elections</a>)` : ''}</dd>
      </dl>
    </aside>
  </section>

  ${starRule()}

  <section aria-labelledby="how-h">
    <div class="section-head"><h2 id="how-h">How the quiz works</h2><a href="/methodology">Full methodology</a></div>
    <ol class="steps">
      <li><div><b>Tell us a little about yourself.</b> Your name, email, county, and age range let us save your results so you can return to them, and let us email you a copy. We never sell your information.</div></li>
      <li><div><b>Answer each statement and say how much it matters to you.</b> Every question includes a short, balanced background note. Questions marked as more important count more in your results.</div></li>
      <li><div><b>We compare your answers with documented positions only.</b> A candidate is scored only on questions where we found a vote, statement, questionnaire answer, or credible report. We never assume a position from a party label.</div></li>
      <li><div><b>Review your matches and read the evidence.</b> Results show a percentage for every candidate in every race and your alignment with each party's official platform. Each position links to its source.</div></li>
    </ol>
  </section>

  <section aria-labelledby="ballot-h">
    <div class="section-head"><h2 id="ballot-h">Your ballot at a glance</h2><a href="/candidates">Browse all races</a></div>
    <div style="max-width:420px;margin-bottom:14px">${countyPicker(guide, options.counties, county, 'home-county')}</div>
    <div id="glance">${glance()}</div>
    <p class="small muted" style="margin-top:10px">Full ballots are loaded for: ${esc(loaded.map(countyLabel).join(', '))}. This guide documents ${stanceCount} issue positions from ${sourceCount} cited sources across ${cands.length} candidates. Districts for Congress, the Texas Senate, the Texas House, commissioners, and justices of the peace depend on your address, so check your sample ballot to see which races appear on yours.</p>
  </section>

  <section aria-labelledby="neutral-h">
    <div class="section-head"><h2 id="neutral-h">Our commitment to neutrality</h2></div>
    <div class="panel">
      <p>Every candidate is held to the same evidence standard. Candidates appear in the order listed on the official ballot. Questions are written so that agreeing sometimes points toward one party and sometimes toward another, and each comes with the main argument on both sides.</p>
      <p style="margin:0">Where we could not find a documented position, we say so. Missing information is shown as missing and never filled in with a guess. If you see an error, the <a href="/privacy">contact address in our Privacy Policy</a> reaches the editors.</p>
    </div>
  </section>`;
  $('#home-county', view).addEventListener('change', (e) => {
    county = e.target.value;
    ballotCounty.set(county);
    $('#glance', view).innerHTML = glance();
  });
}
