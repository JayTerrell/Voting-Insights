// Get a Partner Link: what partner links are, what partners see, and the
// request window (link ending, who it is for, and where it will be shared).

import { $, esc, setTitle, toast, openModal, closeModal } from '../ui.js';
import { api, session } from '../api.js';

const DEFAULT_SITES = ['Instagram', 'Threads', 'LinkedIn', 'X'];
const PLACEHOLDER = {
  Instagram: 'instagram.com/yourname',
  Threads: 'threads.net/@yourname',
  LinkedIn: 'linkedin.com/in/yourname',
  X: 'x.com/yourname',
};

export async function renderPartnerProgram(view, _params, current) {
  setTitle('Get a Partner Link');
  let link = null;
  if (session.token) {
    try {
      ({ link } = await api.partnerMe());
    } catch {
      link = null;
    }
  }
  if (!current()) return;

  const action = !session.token
    ? '<a class="btn btn-red" href="/sign-up?next=/partners">Create a free account to request a link</a> <a class="btn btn-ghost" href="/sign-in?next=/partners">Sign in</a>'
    : link?.status === 'approved'
      ? `<div class="panel partner-status"><p style="margin-top:0">Your partner link is live:</p><p class="partner-url"><b>${esc(link.url)}</b> <button type="button" class="btn btn-ghost btn-small" id="pp-copy">Copy</button></p><p class="small" style="margin:0">See its numbers on <a href="/profile#partner-stats">your profile</a>.</p></div>`
      : link?.status === 'pending'
        ? `<div class="panel partner-status"><p style="margin:0"><span class="tag">Under review</span> You asked for <b>${esc(link.url)}</b>. We will email you when it is approved, usually within a day.</p></div>`
        : `${link?.status === 'rejected' ? `<p class="callout small">Your request for ${esc(link.slug)} was not approved.${link.note ? ` Note: ${esc(link.note)}` : ''} You can request a different link.</p>` : ''}<button type="button" class="btn btn-red" id="pp-request">Request my partner link</button>`;

  view.innerHTML = `<div class="prose partner-program">
    <span class="eyebrow">Partner links</span>
    <h1>Share VotersHub with your community</h1>
    <p class="lede">Churches, schools, clubs, newsletters, and neighbors can get their own link, such as <b>votershub.info/go/your-group</b>, and see how many people it brings to the guide.</p>
    <div class="partner-action">${action}</div>

    <h2>How it works</h2>
    <ol>
      <li><b>Request your link.</b> Choose an ending of 3 to 30 lowercase letters, numbers, or hyphens, tell us who you will share it with, and add the pages where you will post it.</li>
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
  </div>`;

  $('#pp-copy', view)?.addEventListener('click', () =>
    navigator.clipboard.writeText(link.url).then(
      () => toast('Link copied'),
      () => prompt('Copy your link:', link.url)
    )
  );
  $('#pp-request', view)?.addEventListener('click', () => openRequest(() => renderPartnerProgram(view, _params, current)));
}

function siteRow(site, fixed) {
  return `<div class="social-row" data-social>
    ${
      fixed
        ? `<span class="social-name">${esc(site)}</span><input type="hidden" name="site" value="${esc(site)}">`
        : `<input type="text" name="site" class="social-site" maxlength="40" placeholder="Site name" aria-label="Site name">`
    }
    <input type="url" name="url" class="social-url" maxlength="300" inputmode="url" autocomplete="off" placeholder="${esc(PLACEHOLDER[site] || 'Link to your page')}" aria-label="${esc(site || 'Site')} link">
    ${fixed ? '' : '<button type="button" class="social-remove" data-remove aria-label="Remove this site"><span aria-hidden="true"></span></button>'}
  </div>`;
}

function openRequest(onDone) {
  const base = `${location.host}/go/`;
  const modal = openModal({ title: 'Request your partner link', wide: true });
  modal.body.innerHTML = `<form id="pp-form" class="pp-form" novalidate>
    <label for="pp-slug">Your link</label>
    <div class="slug-field"><span class="slug-base">${esc(base)}</span><input id="pp-slug" name="slug" type="text" maxlength="30" autocomplete="off" spellcheck="false" placeholder="your-group" required></div>
    <p class="form-note" id="pp-check">3 to 30 lowercase letters, numbers, or hyphens.</p>

    <label for="pp-reason">Who will you share it with?</label>
    <textarea id="pp-reason" name="reason" maxlength="300" rows="2" placeholder="For example: the young adults group at my church, about 200 people" required></textarea>

    <fieldset class="pp-socials">
      <legend>Where will you share it?</legend>
      <p class="form-note" style="margin-top:0">Add at least one page so we can see who you are. Leave the others blank.</p>
      <div id="pp-rows">${DEFAULT_SITES.map((s) => siteRow(s, true)).join('')}</div>
      <button type="button" class="linkish pp-add" id="pp-add"><span aria-hidden="true">+</span> Add another site</button>
    </fieldset>

    <p class="form-error" role="alert" hidden></p>
    <div class="picker-actions">
      <button type="button" class="btn btn-ghost" data-close>Cancel</button>
      <button type="submit" class="btn btn-red">Submit request</button>
    </div>
  </form>`;

  const form = $('#pp-form', modal.body);
  const slug = $('#pp-slug', form);
  const note = $('#pp-check', form);
  const err = form.querySelector('.form-error');
  let timer = 0;

  slug.addEventListener('input', () => {
    // Type freely; the link is shown the way it will be saved.
    const clean = slug.value
      .toLowerCase()
      .replace(/[\s_]+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
    if (clean !== slug.value) slug.value = clean;
    clearTimeout(timer);
    note.className = 'form-note';
    if (clean.length < 3) {
      note.textContent = '3 to 30 lowercase letters, numbers, or hyphens.';
      return;
    }
    note.textContent = 'Checking...';
    timer = setTimeout(async () => {
      const r = await api.partnerCheck(clean).catch(() => null);
      if (!r || slug.value !== clean) return;
      note.textContent = r.available ? `${base}${r.slug} is available.` : r.reason;
      note.className = `form-note ${r.available ? 'ok' : 'bad'}`;
    }, 300);
  });

  $('#pp-add', form).addEventListener('click', () => {
    const rows = $('#pp-rows', form);
    if (rows.children.length >= 10) return toast('You can add up to 10 sites.');
    rows.insertAdjacentHTML('beforeend', siteRow('', false));
    rows.lastElementChild.querySelector('.social-site').focus();
  });
  form.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-remove]');
    if (rm) rm.closest('[data-social]').remove();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    const socials = [...form.querySelectorAll('[data-social]')]
      .map((row) => ({ site: row.querySelector('[name=site]').value.trim(), url: row.querySelector('[name=url]').value.trim() }))
      .filter((s) => s.url);
    const reason = form.reason.value.trim();
    const show = (msg) => {
      err.textContent = msg;
      err.hidden = false;
    };
    if (slug.value.length < 3) return show('Choose your link ending.');
    if (reason.length < 3) return show('Tell us briefly who you will share your link with.');
    if (!socials.length) return show('Add at least one page where you will share your link.');
    if (socials.some((s) => !s.site)) return show('Please name each site you added.');
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.classList.add('is-loading');
    try {
      await api.partnerRequest(slug.value, reason, socials);
      closeModal();
      toast('Request sent. Check your email for confirmation.');
      onDone();
    } catch (ex) {
      show(ex.message);
    } finally {
      btn.disabled = false;
      btn.classList.remove('is-loading');
    }
  });
  setTimeout(() => slug.focus(), 50);
}
