// Get a Partner Link: what partner links are, what partners see, and how to ask for one.

import { esc, setTitle } from '../ui.js';
import { session } from '../api.js';

export function renderPartnerProgram(view) {
  setTitle('Get a Partner Link');
  const cta = session.token
    ? '<a class="btn btn-red" href="/settings#partner-h">Request my partner link</a>'
    : '<a class="btn btn-red" href="/sign-up?next=/settings">Create a free account to request one</a> <a class="btn btn-ghost" href="/sign-in?next=/settings">Sign in</a>';
  view.innerHTML = `<div class="prose partner-program">
    <span class="eyebrow">Partner links</span>
    <h1>Share VotersHub with your community</h1>
    <p class="lede">Churches, schools, clubs, newsletters, and neighbors can get their own link, such as <b>votershub.info/go/your-group</b>, and see how many people it brings to the guide.</p>
    <div class="btn-row">${cta}</div>

    <h2>How it works</h2>
    <ol>
      <li><b>Choose your link.</b> Pick an ending of 3 to 30 lowercase letters, numbers, or hyphens. We check that it is available as you type.</li>
      <li><b>We review it.</b> You get an email when we receive your request and another when it is approved, usually within a day.</li>
      <li><b>Share it anywhere.</b> Anyone who opens your link lands on VotersHub. If they create an account within 30 days, they count toward your link.</li>
      <li><b>See your totals.</b> Your profile shows visits, sign-ups, quizzes taken, and engagement, by date.</li>
    </ol>

    <h2>What you see, and what you never see</h2>
    <ul>
      <li>You see totals: visits, sign-ups, quizzes taken, ballots started, and, once at least 10 people have taken the quiz through your link, their combined party alignment and most common top issues.</li>
      <li>You never see who anyone is, their answers, or their contact details. Any group smaller than 10 people is combined so no one can be singled out.</li>
      <li>People who join through your link are told so when they sign up.</li>
    </ul>
    <p class="small muted">VotersHub is nonpartisan. Partner links are for sharing the guide, not for campaigning, and links that name a candidate or party may not be approved. Read our <a href="/privacy">Privacy Policy</a>.</p>
    ${session.token ? '' : `<p class="small">${esc('Already have an account?')} <a href="/sign-in?next=/settings">Sign in</a> and open Account Settings.</p>`}
  </div>`;
}
