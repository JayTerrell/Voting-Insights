import { $, $$, esc, skeleton } from './ui.js';
import { renderHome } from './views/home.js';
import { renderQuiz } from './views/quiz.js';
import { renderResults } from './views/results.js';
import { renderGuide, renderRace, renderCandidate } from './views/guide.js';
import { renderIssues } from './views/issues.js';
import { renderMyResults } from './views/my-results.js';
import { renderScoring } from './views/scoring.js';
import { renderMethodology, renderTerms, renderPrivacy } from './views/pages.js';

const routes = [
  [/^\/$/, renderHome, '/'],
  [/^\/quiz$/, renderQuiz, '/'],
  [/^\/results\/([\w-]+)$/, renderResults, '/my-results'],
  [/^\/candidates$/, renderGuide, '/candidates'],
  [/^\/candidates\/([\w-]+)$/, renderRace, '/candidates'],
  [/^\/candidate\/([\w-]+)$/, renderCandidate, '/candidates'],
  [/^\/issues$/, renderIssues, '/issues'],
  [/^\/scoring$/, renderScoring, '/scoring'],
  [/^\/my-results$/, renderMyResults, '/my-results'],
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

  $$('.nav a').forEach((a) => a.removeAttribute('aria-current'));
  if (match && match[2]) $(`.nav a[href="${match[2]}"]`)?.setAttribute('aria-current', 'page');

  if (!match) {
    view.innerHTML = `<h1>Page not found</h1><p>The page <code>${esc(path)}</code> does not exist. <a href="/">Return to the home page</a>.</p>`;
    return;
  }
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
}

export function navigate(href, { replace = false } = {}) {
  if (replace) history.replaceState({}, '', href);
  else history.pushState({}, '', href);
  window.scrollTo(0, 0);
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
route();
