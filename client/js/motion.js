// Motion layer: page transitions, a route progress bar, a frosted masthead that
// compacts on scroll, a reading progress bar, scroll-triggered reveals with a
// stagger, count-up numbers, and photos that fade in when loaded.
//
// Everything here is decoration. Content is fully visible without JavaScript,
// and visitors who ask their system for reduced motion get none of it.

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- Route progress bar ----------

let barTimer;
export const routeProgress = {
  start() {
    const bar = document.getElementById('route-bar');
    if (!bar) return;
    clearTimeout(barTimer);
    bar.classList.remove('done');
    bar.classList.add('active');
  },
  done() {
    const bar = document.getElementById('route-bar');
    if (!bar) return;
    bar.classList.add('done');
    barTimer = setTimeout(() => bar.classList.remove('active', 'done'), 420);
  },
};

// ---------- Page entrance ----------

export function pageEnter(view) {
  view.classList.remove('page-enter');
  if (reduced()) return;
  void view.offsetWidth; // restart the animation on every navigation
  view.classList.add('page-enter');
}

// ---------- Scroll-triggered reveals ----------

// Blocks that slide up into view as the visitor scrolls to them.
const REVEAL = [
  'section',
  '.panel',
  '.race-row',
  '.ballot-race',
  '.cand-card',
  '.race-result',
  '.account-tile',
  '.steps > li',
  'table.ballot',
  '.table-scroll',
  '.callout',
  '.group-title',
  '.ballot-group-title',
].join(',');

let observer;
function getObserver() {
  if (observer) return observer;
  observer = new IntersectionObserver(
    (entries) => {
      // Items that arrive together enter one after another.
      const arriving = entries.filter((e) => e.isIntersecting);
      arriving.forEach((entry, i) => {
        const el = entry.target;
        el.style.transitionDelay = `${Math.min(i * 55, 330)}ms`;
        el.classList.add('in');
        observer.unobserve(el);
        el.addEventListener('transitionend', () => (el.style.transitionDelay = ''), { once: true });
        countUpWithin(el);
      });
    },
    { rootMargin: '0px 0px -6% 0px', threshold: 0 }
  );
  return observer;
}

export function reveal(root) {
  if (reduced() || !('IntersectionObserver' in window)) return countUpWithin(root, true);
  const fold = window.innerHeight;
  const io = getObserver();
  root.querySelectorAll(REVEAL).forEach((el) => {
    // Never hide a block inside another block that is already animating.
    if (el.closest('.reveal') || el.classList.contains('reveal')) return;
    // Anything already on screen stays put; the page entrance covers it. Very
    // tall blocks and content inside collapsed sections are never hidden.
    const box = el.getBoundingClientRect();
    if (box.top < fold || box.height > fold * 1.2 || el.closest('details:not([open])')) return;
    el.classList.add('reveal');
    io.observe(el);
  });
  countUpWithin(root);
}

// Numbers marked data-count="72" count up from zero the first time they show.
function countUpWithin(root, instant = false) {
  root.querySelectorAll('[data-count]:not([data-counted])').forEach((el) => {
    if (!instant && el.closest('.reveal:not(.in)')) return;
    el.dataset.counted = '1';
    const target = Number(el.dataset.count);
    const suffix = el.dataset.suffix || '';
    if (instant || reduced() || !Number.isFinite(target)) return;
    const start = performance.now();
    const duration = 700;
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = `${Math.round(target * eased)}${suffix}`;
      if (t < 1) requestAnimationFrame(step);
    };
    el.textContent = `0${suffix}`;
    requestAnimationFrame(step);
  });
}

// ---------- Scroll: frosted masthead and reading progress ----------

function onScroll() {
  const y = window.scrollY;
  // Compacting the masthead shortens the page above the fold, which moves the
  // scroll position. Separate on and off points (a wider gap than the height
  // change) stop it from flipping back and forth, which looked like shaking.
  const compact = document.body.classList.contains('scrolled') ? y > 8 : y > 140;
  document.body.classList.toggle('scrolled', compact);
  document.body.classList.toggle('far', y > window.innerHeight * 1.5);
  const bar = document.getElementById('read-progress');
  if (!bar) return;
  const total = document.documentElement.scrollHeight - window.innerHeight;
  // Only long pages get a reading bar.
  const show = total > window.innerHeight * 1.5;
  bar.style.transform = `scaleX(${show && total > 0 ? Math.min(1, y / total) : 0})`;
}

let ticking = false;
function scheduleScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    ticking = false;
    onScroll();
  });
}

// ---------- Photos fade in when they finish loading ----------

function markLoaded(img) {
  img.classList.add('loaded');
}

// Sticky page menus sit just under the masthead, whose height changes as it compacts.
function trackMastheadHeight() {
  const masthead = document.querySelector('.masthead');
  if (!masthead || !('ResizeObserver' in window)) return;
  new ResizeObserver(([entry]) => {
    document.documentElement.style.setProperty(
      '--masthead-h',
      `${Math.round(entry.borderBoxSize?.[0]?.blockSize ?? masthead.offsetHeight)}px`
    );
  }).observe(masthead);
}

export function initMotion() {
  trackMastheadHeight();
  document.getElementById('to-top')?.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' });
    document.getElementById('main')?.focus({ preventScroll: true });
  });
  window.addEventListener('scroll', scheduleScroll, { passive: true });
  window.addEventListener('resize', scheduleScroll, { passive: true });
  document.addEventListener(
    'load',
    (e) => {
      if (e.target.tagName === 'IMG' && e.target.classList.contains('cand-photo')) markLoaded(e.target);
    },
    true
  );
  document.addEventListener(
    'error',
    (e) => {
      if (e.target.tagName === 'IMG' && e.target.classList.contains('cand-photo')) markLoaded(e.target);
    },
    true
  );
  onScroll();
}

// Photos served from cache can finish before the load listener sees them.
export function settleImages(root) {
  root.querySelectorAll('img.cand-photo').forEach((img) => {
    if (img.complete) markLoaded(img);
  });
}

// After any page renders: animate it in, reveal what is below the fold, and update the scroll state.
export function afterRender(view) {
  pageEnter(view);
  settleImages(view);
  reveal(view);
  onScroll();
}
