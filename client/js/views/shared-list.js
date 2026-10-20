// Shared ballot picks and office watchlists.
//
// openListShare: from My Ballot, the voter creates a link to their picks or
//   their watchlist for the county shown. The link holds a copy taken when they
//   share, so later changes stay private until they update it.
// renderSharedList: what anyone with the link sees, the complete list, then an
//   invitation to build their own ballot.

import {
  $,
  esc,
  setTitle,
  toast,
  openModal,
  GROUPS,
  raceTitle,
  countyLabel,
  miniCard,
  candidatePhoto,
  formatDate,
} from '../ui.js';
import { api, loadGuide, plan, session, partnerRef, track } from '../api.js';
import { navigate } from '../app.js';

const KIND = {
  ballot: {
    tab: 'My picks',
    title: 'ballot picks',
    eyebrow: 'Shared ballot picks',
    noun: (n) => (n === 1 ? 'pick' : 'picks'),
    empty: 'You have not picked any candidates on this ballot yet. Fill in an oval on any race, then come back to share.',
    text: 'Here are my picks for the November 3 Texas ballot. See my full list and build your own on VotersHub:',
  },
  watchlist: {
    tab: 'My watchlist',
    title: 'office watchlist',
    eyebrow: 'Shared watchlist',
    noun: (n) => (n === 1 ? 'office' : 'offices'),
    empty: 'Your watchlist has no offices on this ballot yet. Tap the star next to any office, then come back to share.',
    text: 'These are the offices I am watching on the November 3 Texas ballot. See my full list and build your own on VotersHub:',
  },
};

const enc = encodeURIComponent;
const imageUrl = (s, format) => `/api/lists/${enc(s.share_id)}/${format}.png?v=${enc(s.version)}`;
// The version changes with the list, so networks fetch a fresh preview after an update.
const linkFor = (s) => `${location.origin}/${s.kind}/${enc(s.share_id)}?v=${enc(s.version)}`;

// The same list the server will build: the county's races in ballot order.
function localItems(guide, kind, county) {
  const p = plan.get();
  const ballot = guide.ballots[county] || [];
  if (kind === 'ballot') return ballot.filter((id) => p.picks[id]).map((id) => ({ race: id, pick: p.picks[id] }));
  return ballot.filter((id) => p.starred_races.includes(id)).map((id) => ({ race: id }));
}

const possessive = (name) => {
  const n = (name || 'Your').trim();
  return /s$/i.test(n) ? `${n}'` : `${n}'s`;
};

// ---------- Sharing, from My Ballot ----------

export async function openListShare(guide, county) {
  const modal = openModal({ title: 'Share your ballot', wide: true });
  modal.body.innerHTML = '<p class="muted">Loading...</p>';
  let mine;
  try {
    mine = await api.lists.mine();
  } catch (ex) {
    modal.body.innerHTML = `<p class="form-error">${esc(ex.message)}</p>`;
    return;
  }
  const races = new Map(guide.races.map((r) => [r.id, r]));
  const counts = {
    ballot: localItems(guide, 'ballot', county).length,
    watchlist: localItems(guide, 'watchlist', county).length,
  };
  let kind = counts.ballot || !counts.watchlist ? 'ballot' : 'watchlist';

  modal.body.innerHTML = `<div class="ls">
    <p class="small muted" style="margin-top:0">Share the candidates you picked or the offices you are watching on the ${esc(countyLabel(county))} ballot. Your post shows up to 5, and your link shows the complete list.</p>
    <div class="seg" role="tablist" aria-label="What to share">
      ${Object.keys(KIND)
        .map((k) => `<button type="button" role="tab" data-kind="${k}">${KIND[k].tab} (${counts[k]})</button>`)
        .join('')}
    </div>
    <div id="ls-body"></div>
  </div>`;
  const root = $('.ls', modal.body);
  const body = $('#ls-body', root);

  const draw = () => {
    root.querySelectorAll('[data-kind]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.kind === kind)));
    const k = KIND[kind];
    const items = localItems(guide, kind, county);
    const shared = mine[kind];
    if (!items.length) {
      body.innerHTML = `<div class="panel empty-state ls-empty"><p>${esc(k.empty)}</p>${
        shared
          ? `<p class="small muted">Your earlier link still shows ${shared.items.length} ${k.noun(shared.items.length)}. <button type="button" class="linkish" id="ls-stop">Stop sharing it</button></p>`
          : ''
      }</div>`;
      return bindStop();
    }
    const current = shared && shared.county === county && JSON.stringify(shared.items) === JSON.stringify(items);
    if (!current) {
      const names = items.slice(0, 5).map((i) => {
        const race = races.get(i.race);
        const c = i.pick && race?.candidates.find((x) => x.id === i.pick);
        return c
          ? `<li><b>${esc(c.name)}</b> <span class="muted">${esc(raceTitle(race))}</span></li>`
          : `<li><b>${esc(race ? raceTitle(race) : i.race)}</b></li>`;
      });
      body.innerHTML = `<div class="ls-confirm">
        <ol class="ls-peek">${names.join('')}${items.length > 5 ? `<li class="muted">and ${items.length - 5} more</li>` : ''}</ol>
        <p class="small">Anyone with your link will see your first name, your county, and ${items.length === 1 ? 'this' : `these ${items.length}`} ${k.noun(items.length)}. They never see your last name, email, or quiz answers. You can stop sharing at any time.</p>
        ${shared ? `<p class="small callout">Your link shows the ${esc(k.noun(2))} you shared on ${esc(formatDate(shared.updated_at, false))}. Update it to share what you have now.</p>` : ''}
        <p class="form-error" role="alert" hidden></p>
        <div class="btn-row"><button type="button" class="btn btn-red" id="ls-create">${shared ? 'Update my link' : 'Create my link'}</button>${
          shared ? '<button type="button" class="btn btn-ghost" id="ls-keep">Keep the earlier version</button>' : ''
        }</div>
      </div>`;
      $('#ls-create', body).addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        btn.classList.add('is-loading');
        try {
          // Save the ballot first: the server builds the list from the saved copy.
          await api.savePlan(plan.get());
          mine[kind] = await api.lists.save(kind, county);
          draw();
        } catch (ex) {
          const err = body.querySelector('.form-error');
          err.textContent = ex.message;
          err.hidden = false;
          btn.disabled = false;
          btn.classList.remove('is-loading');
        }
      });
      $('#ls-keep', body)?.addEventListener('click', () => drawShare(shared, false));
      return;
    }
    drawShare(shared, true);
  };

  const drawShare = (s, current) => {
    const k = KIND[kind];
    const url = linkFor(s);
    body.innerHTML = `<div class="share-panel-grid ls-share">
      <figure class="share-image"><img src="${imageUrl(s, 'card')}" alt="Preview of your share image" width="1200" height="630"></figure>
      <div>
        <p class="small muted" style="margin-top:0">${current ? 'Your link is ready.' : 'Sharing your earlier version.'} It shows ${s.items.length} ${k.noun(s.items.length)} on the ${esc(countyLabel(s.county))} ballot, updated ${esc(formatDate(s.updated_at, false))}.</p>
        <p class="ls-url"><a href="${esc(url)}" target="_blank" rel="noopener">${esc(url.replace(/^https?:\/\//, '').replace(/\?.*$/, ''))}</a></p>
        <div class="share-row">
          <button class="btn btn-small" id="ls-native" hidden>Share</button>
          <a class="btn btn-ghost btn-small" target="_blank" rel="noopener" href="https://twitter.com/intent/tweet?text=${enc(k.text)}&url=${enc(url)}">X</a>
          <a class="btn btn-ghost btn-small" target="_blank" rel="noopener" href="https://www.facebook.com/sharer/sharer.php?u=${enc(url)}">Facebook</a>
          <a class="btn btn-ghost btn-small" target="_blank" rel="noopener" href="https://www.threads.net/intent/post?text=${enc(`${k.text} ${url}`)}">Threads</a>
          <button class="btn btn-ghost btn-small" id="ls-instagram">Instagram Story</button>
          <a class="btn btn-ghost btn-small" target="_blank" rel="noopener" href="https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}">LinkedIn</a>
          <a class="btn btn-ghost btn-small" href="mailto:?subject=${enc(`My ${k.title} for the 2026 Texas ballot`)}&body=${enc(`${k.text}\n\n${url}`)}">Email</a>
          <button class="btn btn-ghost btn-small" id="ls-copy">Copy link</button>
        </div>
        <p class="small muted share-downloads">Download the image: <a href="${imageUrl(s, 'card')}&download=1">post (wide)</a> or <a href="${imageUrl(s, 'story')}&download=1">story (tall)</a></p>
        <p class="small muted">Change your ballot later and your link keeps this version until you share again. <button type="button" class="linkish" id="ls-stop">Stop sharing</button></p>
      </div>
    </div>`;
    body.querySelector('.share-row').addEventListener('click', (e) => {
      if (!e.target.closest('a, button')) return;
      track('share');
      partnerRef.event('share');
    });
    const file = async (format) => {
      const res = await fetch(imageUrl(s, format));
      if (!res.ok) throw new Error('We could not make your image. Please try again.');
      return new File([await res.blob()], `votershub-${s.kind}-${format}.png`, { type: 'image/png' });
    };
    $('#ls-instagram', body).addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.classList.add('is-loading');
      try {
        const f = await file('story');
        if (navigator.canShare?.({ files: [f] })) {
          await navigator.share({ files: [f] }).catch(() => {});
        } else {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(f);
          a.download = f.name;
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 4000);
          toast('Story image saved. In Instagram, add a story with this image and a link sticker with your link.');
        }
      } catch (ex) {
        toast(ex.message);
      } finally {
        btn.classList.remove('is-loading');
      }
    });
    const native = $('#ls-native', body);
    if (navigator.share) {
      native.hidden = false;
      native.addEventListener('click', async () => {
        try {
          const f = await file('card');
          const payload = { title: `My ${k.title}`, text: k.text, url };
          await navigator.share(navigator.canShare?.({ ...payload, files: [f] }) ? { ...payload, files: [f] } : payload);
        } catch {
          // The person closed the share sheet.
        }
      });
    }
    $('#ls-copy', body).addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(url);
        toast('Link copied');
      } catch {
        prompt('Copy this link:', url);
      }
    });
    bindStop();
  };

  const bindStop = () =>
    $('#ls-stop', body)?.addEventListener('click', async () => {
      if (!confirm('Stop sharing? Your link will stop working for everyone, including posts you already shared.')) return;
      try {
        await api.lists.stop(kind);
        mine[kind] = null;
        toast('Your link no longer works.');
        draw();
      } catch (ex) {
        toast(ex.message);
      }
    });

  root.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-kind]');
    if (!tab || tab.dataset.kind === kind) return;
    kind = tab.dataset.kind;
    draw();
  });
  draw();
}

// ---------- The shared page ----------

export async function renderSharedList(view, [kind, id], current) {
  let data;
  let guide;
  try {
    [data, guide] = await Promise.all([api.lists.get(id), loadGuide()]);
  } catch (ex) {
    if (!current()) return;
    setTitle('Shared list');
    view.innerHTML = `<div class="prose"><span class="eyebrow">Shared list</span><h1>This list is not available</h1>
      <p>${esc(ex.message || 'The link may be mistyped, or the person who shared it stopped sharing.')}</p>
      <div class="btn-row"><a class="btn" href="/my-ballot">Build your own ballot</a><a class="btn btn-ghost" href="/candidates">Browse the candidates</a></div></div>`;
    return;
  }
  if (!current()) return;
  if (data.kind !== kind) return navigate(`/${data.kind}/${enc(id)}`, { replace: true });

  const k = KIND[kind];
  const name = data.first_name || 'Someone';
  const n = data.items.length;
  setTitle(`${possessive(name)} ${k.title}`);
  const races = new Map(guide.races.map((r) => [r.id, r]));

  const row = (item) => {
    const race = races.get(item.race);
    const title = race ? raceTitle(race) : item.title;
    if (kind === 'ballot') {
      const c = race?.candidates.find((x) => x.id === item.pick.id) || { ...item.pick, photo: null };
      return `<li class="sl-row">
        <div class="sl-office">${esc(title)}</div>
        <div class="sl-pick">${miniCard(c)}</div>
        <a class="sl-link small" href="/candidates/${esc(item.race)}">${item.candidates > 1 ? 'Compare candidates' : 'Read profile'}</a>
      </li>`;
    }
    const cands = race?.candidates || [];
    return `<li class="sl-row sl-watch">
      <div><div class="sl-office">${esc(title)}</div><div class="small muted">${cands.length} ${cands.length === 1 ? 'candidate' : 'candidates'}</div></div>
      <div class="sl-faces" aria-hidden="true">${cands
        .slice(0, 4)
        .map((c) => candidatePhoto(c, 'sm'))
        .join('')}</div>
      <a class="sl-link small" href="/candidates/${esc(item.race)}">See the candidates</a>
    </li>`;
  };

  const groups = GROUPS.map((g) => ({ ...g, items: data.items.filter((i) => i.group === g.id) })).filter((g) => g.items.length);
  const buildHref = session.token ? '/my-ballot' : '/sign-up?next=/my-ballot';

  view.innerHTML = `<div class="share-preview shared-list">
    <span class="eyebrow">${k.eyebrow}</span>
    <h1>${esc(possessive(name))} ${k.title}</h1>
    <p class="muted">${esc(countyLabel(data.county))} ballot, November 3, 2026. ${n} ${k.noun(n)}, shared ${esc(formatDate(data.updated_at, false))}.</p>
    ${
      data.owner
        ? `<p class="callout small">This is your shared ${kind === 'ballot' ? 'list of picks' : 'watchlist'}. Changes you make on <a href="/my-ballot">My Ballot</a> show here after you share again.</p>`
        : ''
    }
    <div class="sl-groups">${groups
      .map(
        (g) => `<section class="sl-group"><h2>${esc(g.label)}</h2><ol class="sl-list">${g.items.map(row).join('')}</ol></section>`
      )
      .join('')}</div>
    <p class="small muted sl-note">${
      kind === 'ballot' ? `These picks were made by ${esc(name)}.` : `${esc(name)} chose these offices to follow.`
    } VotersHub is nonpartisan and does not endorse candidates. Every voter's ballot depends on their address.</p>
    <section class="share-cta">
      <span class="share-cta-star" aria-hidden="true"></span>
      <h2>Make your own ballot</h2>
      <p>See every race on your county's ballot, compare the candidates side by side, pick your choices, and keep a watchlist of the offices that matter to you. Then share it.</p>
      <div class="btn-row"><a class="btn btn-red btn-large" href="${buildHref}">Build my ballot</a><a class="btn btn-ghost-light" href="${session.token ? '/quiz' : '/sign-up?next=/quiz'}">Take the issue quiz</a></div>
      ${session.token ? '' : '<p class="small">A free account saves your ballot privately. We never sell your information.</p>'}
    </section>
  </div>`;
}
