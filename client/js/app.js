import { $, $$, esc, skeleton, toast, watchLabel, avatarHtml, closeModal, accountGate } from './ui.js';
import { renderHome } from './views/home.js';
import { renderQuiz } from './views/quiz.js';
import { renderResults } from './views/results.js';
import { renderGuide, renderRace, renderCandidate } from './views/guide.js';
import { renderIssues } from './views/issues.js';
import {
  renderSignIn,
  renderSignUp,
  renderForgot,
  renderReset,
  renderSettings,
  renderAuthComplete,
  renderFinishSignUp,
} from './views/account.js';
import { renderBallot, renderBallotPrint } from './views/ballot.js';
import { renderVote } from './views/vote.js';
import { session, plan, api, partnerRef, track, markPartnerArrival } from './api.js';
import { initMotion, routeProgress, afterRender } from './motion.js';
import { renderScoring } from './views/scoring.js';
import { renderMethodology, renderTerms, renderPrivacy, renderRegistered } from './views/pages.js';
import { renderProfile } from './views/profile.js';
import { renderParties } from './views/parties.js';
import { renderAdmin } from './views/admin.js';
import { renderPartnerProgram } from './views/partner-program.js';

const routes = [
  [/^\/$/, renderHome, '/'],
  [/^\/quiz$/, renderQuiz, '/'],
  [/^\/results\/([\w-]+)$/, renderResults, '/profile'],
  [/^\/candidates$/, renderGuide, '/candidates'],
  [/^\/candidates\/([\w-]+)$/, renderRace, '/candidates'],
  [/^\/candidate\/([\w-]+)$/, renderCandidate, '/candidates'],
  [/^\/issues$/, renderIssues, '/issues'],
  [/^\/scoring$/, renderScoring, '/scoring'],
  [/^\/where-to-vote$/, renderVote, '/where-to-vote'],
  [/^\/am-i-registered$/, renderRegistered, '/am-i-registered'],
  [/^\/parties$/, renderParties, '/parties'],
  [/^\/partners$/, renderPartnerProgram, null],
  [/^\/admin$/, renderAdmin, '/admin'],
  [/^\/my-ballot$/, renderBallot, '/my-ballot'],
  [/^\/my-ballot\/print$/, renderBallotPrint, '/my-ballot'],
  [/^\/profile$/, renderProfile, '/profile'],
  [/^\/settings$/, renderSettings, '/settings'],
  // Older links: the account page became Profile and Account Settings.
  [/^\/(account|my-results)$/, () => navigate('/profile', { replace: true }), '/profile'],
  [/^\/sign-in$/, renderSignIn, '/profile'],
  [/^\/sign-up$/, renderSignUp, '/profile'],
  [/^\/forgot-password$/, renderForgot, '/profile'],
  [/^\/reset-password$/, renderReset, '/profile'],
  [/^\/auth\/complete$/, renderAuthComplete, '/profile'],
  [/^\/finish-sign-up$/, renderFinishSignUp, '/profile'],
  [/^\/methodology$/, renderMethodology, null],
  [/^\/terms$/, renderTerms, null],
  [/^\/privacy$/, renderPrivacy, null],
];

let renderToken = 0;

async function route() {
  const view = $('#view');
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const match = routes.find(([re]) => re.test(path));
  const token = ++renderToken;

  closeModal();
  closeMenus();
  updateAccountLink();
  markNav(match ? match[2] : null);

  if (!match) {
    view.innerHTML = `<h1>Page not found</h1><p>The page <code>${esc(path)}</code> does not exist. <a href="/">Return to the home page</a>.</p>`;
    afterRender(view);
    return;
  }
  routeProgress.start();
  view.innerHTML = skeleton();
  const params = path.match(match[0]).slice(1);
  try {
    // Views receive a guard so a slow, stale render cannot overwrite a newer page.
    await match[1](view, params, () => token === renderToken);
  } catch (e) {
    console.error(e);
    if (token === renderToken) {
      view.innerHTML = `<h1>Something went wrong</h1><p>${esc(e.message || 'Please reload the page and try again.')}</p>`;
    }
  }
  if (token === renderToken) {
    afterRender(view);
    routeProgress.done();
    track('pageview');
  }
}

// Top right: signed-in visitors get their photo (or initials), which opens a
// small menu; signed-out visitors see Sign in.
export function updateAccountLink() {
  const box = $('#acct');
  if (!box) return;
  if (session.token && session.user) {
    const u = session.user;
    box.innerHTML = `<button type="button" class="avatar-link signed-in" id="nav-avatar" data-menu="acct-panel" aria-expanded="false" aria-controls="acct-panel" aria-label="${esc(`Account menu for ${u.first_name || 'you'}`)}" title="Your account">${avatarHtml(u, 'sm')}</button>
      <div class="nav-panel acct-panel" id="acct-panel" hidden>
        <div class="acct-head">${avatarHtml(u, 'sm')}<div><b>${esc([u.first_name, u.last_name].filter(Boolean).join(' '))}</b><span>${esc(u.email || '')}</span></div></div>
        <a href="/profile" data-nav="/profile">My Profile</a>
        <a href="/my-ballot" data-nav="/my-ballot">My Ballot</a>
        <a href="/settings" data-nav="/settings">Account Settings</a>
        ${u.is_admin ? '<a href="/admin" data-nav="/admin">Admin</a>' : ''}
        <button type="button" data-signout>Sign out</button>
      </div>`;
  } else {
    box.innerHTML = '<a class="avatar-link" id="nav-avatar" href="/sign-in">Sign in</a>';
  }
}

// ---------- Menus: Explore, the account menu, and the phone menu ----------

const EXPLORE = ['/candidates', '/issues', '/parties', '/scoring'];

function markNav(section) {
  $$('[data-nav]').forEach((a) => {
    if (a.dataset.nav === section) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  $('.nav-trigger')?.classList.toggle('is-current', EXPLORE.includes(section));
  $('#nav-avatar')?.classList.toggle('is-current', section === '/profile' || section === '/settings');
}

function closeMenus(except = null) {
  $$('[data-menu]').forEach((btn) => {
    if (btn === except) return;
    btn.setAttribute('aria-expanded', 'false');
    const panel = document.getElementById(btn.dataset.menu);
    if (panel) panel.hidden = true;
  });
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-menu]');
  if (btn) {
    const panel = document.getElementById(btn.dataset.menu);
    const open = btn.getAttribute('aria-expanded') !== 'true';
    closeMenus(btn);
    btn.setAttribute('aria-expanded', String(open));
    if (panel) panel.hidden = !open;
    if (open) panel?.querySelector('a, button')?.focus({ preventScroll: true });
    return;
  }
  if (e.target.closest('[data-signout]')) {
    closeMenus();
    api.signOut().catch(() => {});
    session.clear();
    updateAccountLink();
    toast('You are signed out.');
    navigate('/', { replace: true });
    return;
  }
  if (!e.target.closest('.nav-panel, .mobile-menu')) closeMenus();
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const open = $('[data-menu][aria-expanded="true"]');
  if (open) {
    closeMenus();
    open.focus();
  }
});

// Watch stars and "Choose for my ballot" buttons anywhere on the page.
document.addEventListener(
  'click',
  (e) => {
    const watch = e.target.closest('[data-watch]');
    if (watch) {
      e.preventDefault();
      e.stopPropagation();
      if (!session.token) return void accountGate('add offices to your watchlist');
      const on = plan.toggleWatch(watch.dataset.watch);
      $$(`[data-watch="${CSS.escape(watch.dataset.watch)}"]`).forEach((b) => {
        b.setAttribute('aria-pressed', String(on));
        b.title = on ? 'On your watchlist' : 'Watch this office';
        b.setAttribute('aria-label', watchLabel(on, b.dataset.label || ''));
      });
      toast(on ? 'Office added to your watchlist on My Ballot.' : 'Office removed from your watchlist.');
      return;
    }
    const pick = e.target.closest('[data-pick-race]');
    if (pick) {
      e.preventDefault();
      if (!session.token) return void accountGate('choose candidates for your ballot');
      const { pickRace, pickCand } = pick.dataset;
      const on = plan.togglePick(pickRace, pickCand);
      syncPickButtons(pickRace);
      toast(on ? 'Added to My Picks on My Ballot.' : 'Removed from My Picks.');
    }
  },
  true
);

export function syncPickButtons(raceId) {
  const chosen = plan.pickFor(raceId);
  $$(`[data-pick-race="${CSS.escape(raceId)}"]`).forEach((b) => {
    const on = b.dataset.pickCand === chosen;
    b.setAttribute('aria-pressed', String(on));
    b.textContent = on ? 'Your pick' : 'Choose for my ballot';
  });
}

export function navigate(href, { replace = false } = {}) {
  if (replace) history.replaceState({}, '', href);
  else history.pushState({}, '', href);
  // Jump, not glide: smooth scrolling is for in-page movement only.
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  route();
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('a');
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  if (a.target === '_blank' || a.hasAttribute('download')) return;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (url.pathname === location.pathname && url.hash) return;
  e.preventDefault();
  navigate(url.pathname + url.search + url.hash);
});

// A visit through a partner link arrives as /?ref=<slug>: remember it, then tidy the address.
{
  const qs = new URLSearchParams(location.search);
  if (qs.has('ref')) {
    partnerRef.capture(qs.get('ref'));
    markPartnerArrival();
    qs.delete('ref');
    history.replaceState({}, '', `${location.pathname}${qs.size ? `?${qs}` : ''}${location.hash}`);
  }
}

window.addEventListener('popstate', route);
initMotion();
route();
