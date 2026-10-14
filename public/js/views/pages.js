import { esc, setTitle, formatDate } from '../ui.js';
import { loadGuide, loadFormOptions } from '../api.js';
import { BASIS_WEIGHT, BASIS_LABEL, PRIOR_WEIGHT, LIMITED_DATA_THRESHOLD, IMPORTANCE } from '../scoring.js';

async function contactLine() {
  const opts = await loadFormOptions().catch(() => ({}));
  return opts.contact_email
    ? `<a href="mailto:${esc(opts.contact_email)}">${esc(opts.contact_email)}</a>`
    : 'the contact address listed on this page once it is published';
}

export async function renderMethodology(view, _p, current) {
  setTitle('Methodology and Sources');
  const guide = await loadGuide();
  if (!current()) return;
  const cands = guide.races.flatMap((r) => r.candidates);
  const stances = cands.reduce((n, c) => n + Object.keys(c.stances).length, 0);
  const sources = cands.reduce((n, c) => n + c.sources.length, 0);
  const withAny = cands.filter((c) => Object.keys(c.stances).length).length;

  view.innerHTML = `<div class="prose">
    <span class="eyebrow">Methodology</span>
    <h1>How this guide is researched and scored</h1>
    <p class="lede">This page explains where the information comes from, how the quiz calculates a match, and what the numbers cannot tell you.</p>

    <h2>The ballot</h2>
    <p>The list of races and candidates comes from the ${esc(guide.election.roster_source.title)}. Candidates are shown in the order they appear on that report, which follows the ballot order set by Texas law. Some races, such as congressional, legislative, commissioner, and justice of the peace districts, appear only on the ballots of voters who live in those districts.</p>

    <h2>The research</h2>
    <p>For each candidate we looked for campaign websites, official voting records and rulings, public statements and interviews, voter guide questionnaires (including the League of Women Voters and newspaper questionnaires), and reporting by established news organizations. Each claim on a candidate page links to the source it came from.</p>
    <ul>
      <li>We describe positions in neutral language and use the candidate's own framing for their priorities.</li>
      <li>We never assign a position based on party membership. If no documented position exists, the guide says "No documented position."</li>
      <li>Judicial candidates are bound by the Texas Code of Judicial Conduct, which limits what they may say about issues that could come before them. For these races the guide focuses on experience, qualifications, stated judicial philosophy, and record.</li>
    </ul>
    <p>The guide currently holds ${stances} documented positions for ${withAny} of ${cands.length} candidates, drawn from ${sources} sources. Research was last compiled ${esc(formatDate(guide.generated_at, false))}.</p>

    <h2>The questions</h2>
    <p>The ${guide.questions.length} quiz statements were written before reading any candidate's platform, so no campaign set the agenda. Each one is tied to the offices that actually have power over that issue. Agreeing with a statement points toward one side on some questions and the other side on others, and each statement includes a short note with the main argument on each side.</p>

    <h2>How a match is calculated</h2>
    <p>Answers and candidate positions use the same five-point scale, from Strongly disagree (-2) to Strongly agree (+2). For each question where both you and a candidate have a position:</p>
    <p class="formula">agreement = 1 - |your answer - candidate position| / 4</p>
    <p>So identical answers score 1, and opposite extremes score 0. Each question is then weighted by how important you said it is, and by the kind of evidence behind the candidate's position:</p>
    <table class="ballot"><thead><tr><th>Your importance rating</th><th class="num">Weight</th></tr></thead><tbody>
      ${IMPORTANCE.map((i) => `<tr><td>${esc(i.label)}</td><td class="num">${i.value}</td></tr>`).join('')}
    </tbody></table>
    <br>
    <table class="ballot"><thead><tr><th>Evidence behind the position</th><th class="num">Weight</th></tr></thead><tbody>
      ${Object.entries(BASIS_WEIGHT).map(([k, v]) => `<tr><td>${esc(BASIS_LABEL[k])}</td><td class="num">${v}</td></tr>`).join('')}
    </tbody></table>
    <p style="margin-top:16px">The match percentage is the weighted average of agreement, combined with a neutral 50 percent starting point worth ${PRIOR_WEIGHT} questions of evidence:</p>
    <p class="formula">match = (sum of weight x agreement + 0.5 x ${PRIOR_WEIGHT}) / (sum of weights + ${PRIOR_WEIGHT})</p>
    <p>The neutral starting point keeps a candidate with only one documented position from showing 0 or 100 percent on a single answer. As more positions are documented, it matters less. A match based on fewer than ${LIMITED_DATA_THRESHOLD} questions is labeled "limited data." Only the questions tied to each office count for that race, so every candidate in a race is measured on the same set of issues.</p>

    <h2>Party platform alignment</h2>
    <p>Party percentages use the same formula, comparing your answers on all questions with the official written platform of each party on the ballot:</p>
    <ul>${guide.parties
      .map((p) => `<li><a href="${esc(p.platform_url)}" target="_blank" rel="noopener">${esc(p.platform_title || p.name)}</a> (${esc(p.platform_year || '')}). ${esc(p.summary || '')}</li>`)
      .join('')}</ul>
    <p>Each party's percentage is calculated separately, so they do not add up to 100. Platforms are adopted by party conventions and individual candidates may disagree with parts of them. Independent candidates do not share a platform, so there is no independent party score. Independent candidates are still compared race by race on their own documented positions.</p>

    <h2>Limits</h2>
    <ul>
      <li>A match measures agreement on the selected questions only. It does not measure experience, competence, character, or effectiveness.</li>
      <li>Candidates with long public records have more documented positions than first-time candidates.</li>
      <li>Positions can change. Check the date on each source.</li>
      <li>This guide may contain errors. Please verify important details with the original source and report corrections to ${await contactLine()}.</li>
    </ul>
  </div>`;
}

export async function renderTerms(view, _p, current) {
  setTitle('Terms of Use');
  const contact = await contactLine();
  if (!current()) return;
  view.innerHTML = `<div class="prose">
    <span class="eyebrow">Legal</span>
    <h1>Terms of Use</h1>
    <p class="muted">Effective October 14, 2026</p>
    <p>These terms govern your use of Voting Insights (the "Site"). By using the Site you agree to them. If you do not agree, please do not use the Site.</p>
    <h2>1. Purpose of the Site</h2>
    <p>The Site is an independent, nonpartisan educational resource about candidates on Texas ballots for the November 3, 2026 general election. It is not affiliated with, endorsed by, or paid for by any candidate, campaign, political party, political action committee, or government office. Nothing on the Site is an endorsement of any candidate or party or a recommendation on how to vote.</p>
    <h2>2. Accuracy of information</h2>
    <p>Candidate information is compiled from public sources and summarized by our editors. We work to be accurate and fair, but information may be incomplete, out of date, or wrong, and candidates' positions may change. Quiz results are an automated comparison based on limited data and should be one of many tools you use. Always confirm important details, including your polling place and the races on your ballot, with official election sources.</p>
    <h2>3. Your account and results</h2>
    <p>To save quiz results you provide your name, email address, county, and age range. You agree to provide accurate information and to use only an email address you control. Each email address may have one account. You are responsible for results you choose to share. A shared results link can be viewed by anyone who has it.</p>
    <h2>4. Acceptable use</h2>
    <p>You agree not to misuse the Site, including by submitting automated or bulk requests, attempting to access other people's results or accounts, interfering with the Site's operation, scraping personal information, or using the Site to harass anyone.</p>
    <h2>5. Content and links</h2>
    <p>The Site links to third-party websites, including candidate sites and news articles. We do not control and are not responsible for their content. Candidate names and quoted statements belong to their respective owners and are used for news and educational purposes.</p>
    <h2>6. No warranty</h2>
    <p>The Site is provided "as is" and "as available," without warranties of any kind, express or implied, including warranties of accuracy, fitness for a particular purpose, and non-infringement.</p>
    <h2>7. Limitation of liability</h2>
    <p>To the fullest extent permitted by law, the operators of the Site are not liable for any indirect, incidental, or consequential damages arising from your use of the Site or reliance on its content.</p>
    <h2>8. Changes</h2>
    <p>We may update the Site, its research, and these terms at any time. Material changes to these terms will be posted on this page with a new effective date.</p>
    <h2>9. Governing law</h2>
    <p>These terms are governed by the laws of the State of Texas, without regard to conflict of law principles.</p>
    <h2>10. Contact</h2>
    <p>Questions about these terms and corrections to candidate information can be sent to ${contact}.</p>
  </div>`;
}

export async function renderPrivacy(view, _p, current) {
  setTitle('Privacy Policy');
  const contact = await contactLine();
  if (!current()) return;
  view.innerHTML = `<div class="prose">
    <span class="eyebrow">Legal</span>
    <h1>Privacy Policy</h1>
    <p class="muted">Effective October 14, 2026</p>
    <p>Your views on political issues are personal. This policy explains what we collect, why, and the choices you have.</p>
    <h2>Information we collect</h2>
    <ul>
      <li><b>Information you give us when you start the quiz:</b> first name, last name, email address, county, age range, and whether you want update emails.</li>
      <li><b>Your quiz answers and results,</b> each saved with the date and time you completed the quiz.</li>
      <li><b>Technical information:</b> your IP address is used briefly in server memory to prevent abuse and is not stored with your account. We do not use advertising trackers, analytics cookies, or third-party ad networks.</li>
      <li><b>On your device:</b> the Site stores a sign-in token, your cached results, and any unfinished quiz in your browser's local storage so they load quickly when you return. You can clear this at any time with "Sign out on this device" on the My Results page or through your browser settings.</li>
    </ul>
    <h2>How we use it</h2>
    <ul>
      <li>To save your results and let you find them later under My Results.</li>
      <li>To email you your results and verification codes.</li>
      <li>To produce anonymous, aggregate statistics about quiz participation, such as totals by county or age range. We do not publish information that identifies you.</li>
      <li>If you opted in, to tell you when the guide is updated for future elections. You can opt out at any time.</li>
    </ul>
    <h2>What we do not do</h2>
    <ul>
      <li>We do not sell, rent, or trade your personal information.</li>
      <li>We do not share your information with any candidate, campaign, political party, or political committee.</li>
    </ul>
    <h2>Sharing</h2>
    <p>We use service providers to host the Site and send email, and they process data only to provide those services. We may disclose information if required by law. If you share a results link, anyone with the link can see your first name and match percentages, but never your email address, last name, or individual answers.</p>
    <h2>Viewing your results</h2>
    <p>To protect your privacy, viewing saved results on a new device requires a one-time code sent to your email address.</p>
    <h2>Retention and deletion</h2>
    <p>We keep your account and results until you ask us to delete them, or until we retire the Site. To delete your account and all saved results, or to correct your information, contact ${contact} from the email address on your account.</p>
    <h2>Security</h2>
    <p>Verification codes and sign-in tokens are stored only in hashed form, and the Site uses encrypted connections. No system is perfectly secure, so please use an email address you control.</p>
    <h2>Children</h2>
    <p>The Site is meant for voters and people learning about elections. It is not directed to children under 13, and we do not knowingly collect information from them.</p>
    <h2>Changes</h2>
    <p>We will post any changes to this policy on this page with a new effective date.</p>
    <h2>Contact</h2>
    <p>Privacy questions and requests: ${contact}.</p>
  </div>`;
}
