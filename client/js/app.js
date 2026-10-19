import { $, $$, esc, skeleton, toast, watchLabel, avatarHtml, closeModal } from './ui.js';
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
  renderAccount,
  renderAuthComplete,
  renderFinishSignUp,
} from './views/account.js';
import { renderBallot, renderBallotPrint } from './views/ballot.js';
import { renderVote } from './views/vote.js';
import { session, plan } from './api.js';
import { initMotion, routeProgress, afterRender } from './motion.js';
import { renderScoring } from './views/scoring.js';
import { renderMethodology, renderTerms, renderPrivacy } from './views/pages.js';

const routes = [
  [/^\/$/, renderHome, '/'],
  [/^\/quiz$/, renderQuiz, '/'],
  [/^\/results\/([\w-]+)$/, renderResults, '/account'],
  [/^\/candidates$/, renderGuide, '/candidates'],
  [/^\/candidates\/([\w-]+)$/, renderRace, '/candidates'],
  [/^\/candidate\/([\w-]+)$/, renderCandidate, '/candidates'],
  [/^\/issues$/, renderIssues, '/issues'],
  [/^\/scoring$/, renderScoring, '/scoring'],
  [/^\/where-to-vote$/, renderVote, null],
  [/^\/my-ballot$/, renderBallot, '/my-ballot'],
  [/^\/my-ballot\/print$/, renderBallotPrint, '/my-ballot'],
  [/^\/account$/, renderAccount, '/account'],
  [/^\/my-results$/, renderAccount, '/account'],
  [/^\/sign-in$/, renderSignIn, '/account'],
  [/^\/sign-up$/, renderSignUp, '/account'],
  [/^\/forgot-password$/, renderForgot, '/account'],
  [/^\/reset-password$/, renderReset, '/account'],
  [/^\/auth\/complete$/, renderAuthComplete, '/account'],
  [/^\/finish-sign-up$/, renderFinishSignUp, '/account'],
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
  updateAccountLink();
  $$('.nav a, #nav-avatar').forEach((a) => a.removeAttribute('aria-current'));
  if (match && match[2]) $(`.nav a[href="${match[2]}"]`)?.setAttribute('aria-current', 'page');
  if (match && match[2] === '/account') $('#nav-avatar')?.setAttribute('aria-current', 'page');

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
  }
}

// Top right: the profile photo (or initials) links to the account page; signed-out visitors see Sign in.
export function updateAccountLink() {
  const link = $('#nav-avatar');
  if (!link) return;
  if (session.token && session.user) {
    link.href = '/account';
    link.classList.add('signed-in');
    link.setAttribute('aria-label', `My account, ${session.user.first_name || ''}`.trim());
    link.title = 'My account';
    link.innerHTML = avatarHtml(session.user, 'sm');
  } else {
    link.href = '/sign-in';
    link.classList.remove('signed-in');
    link.removeAttribute('aria-label');
    link.title = '';
    link.textContent = 'Sign in';
  }
}

// Watch stars and "Choose for my ballot" buttons anywhere on the page.
document.addEventListener(
  'click',
  (e) => {
    const watch = e.target.closest('[data-watch]');
    if (watch) {
      e.preventDefault();
      e.stopPropagation();
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

window.addEventListener('popstate', route);
initMotion();
route();
