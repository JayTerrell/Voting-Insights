// Share images for quiz results: a 1200 x 630 card for link previews (X,
// Facebook, Threads, LinkedIn) and a 1080 x 1920 story for Instagram. Each is
// drawn as SVG and rendered to PNG with resvg, using the site's own fonts.
//
// An image shows only what a shared link shows: the first name, party platform
// percentages, and, when the owner turns it on, their top three issue areas.

import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const FONT_DIR = fileURLToPath(new URL('../assets/fonts/', import.meta.url));
const FONT_FILES = [
  'LibreCaslonText-Regular.ttf',
  'LibreCaslonText-Bold.ttf',
  'PublicSans-Regular.ttf',
  'PublicSans-SemiBold.ttf',
  'PublicSans-Bold.ttf',
  'PublicSans-ExtraBold.ttf',
].map((f) => FONT_DIR + f);

const C = {
  navy: '#13294b',
  navy2: '#1f3a66',
  red: '#9e1b32',
  paper: '#f7f4ec',
  card: '#fffdf8',
  ink: '#1b1f24',
  muted: '#5b6270',
  rule: '#d9d1bf',
  track: '#ebe5d6',
};
const PARTY = { Republican: '#9e1b32', Democratic: '#1f4e8c', Libertarian: '#b08a1e', Green: '#2e6b3f' };
const SERIF = "'Libre Caslon Text'";
const SANS = "'Public Sans'";

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

// A five-pointed star centered at (cx, cy).
function star(cx, cy, r, fill, extra = '') {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 ? r * 0.382 : r;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${(cx + rad * Math.cos(a)).toFixed(1)},${(cy + rad * Math.sin(a)).toFixed(1)}`);
  }
  return `<polygon points="${pts.join(' ')}" fill="${fill}" ${extra}/>`;
}

// Long first names drop to their first part (Mary Ann, Jean-Luc), then are cut,
// so the title always fits.
function possessive(name) {
  let n = (name || 'My').trim();
  if (n.length > 14) n = n.split(/[\s-]+/)[0];
  const short = n.length > 14 ? n.slice(0, 14) : n;
  return /s$/i.test(short) ? `${short}'` : `${short}'s`;
}

function flagStripe(width) {
  return `<rect x="0" y="0" width="${width}" height="14" fill="${C.navy}"/>
    <rect x="0" y="14" width="${width}" height="5" fill="${C.card}"/>
    <rect x="0" y="19" width="${width}" height="9" fill="${C.red}"/>`;
}

// One row per party: name, a filled track, and the percentage in a column to the right.
function bars({ parties, x, y, width, rowH, labelSize, pctSize, barH }) {
  return parties
    .map((p, i) => {
      const top = y + i * rowH;
      const color = PARTY[p.name] || C.navy;
      const lead = p.score === parties[0].score;
      const fill = Math.max(4, (width * p.score) / 100);
      return `<g>
        <text x="${x}" y="${top + labelSize}" font-family="${SANS}" font-weight="${lead ? 700 : 600}" font-size="${labelSize}" fill="${C.ink}">${esc(p.name)}</text>
        ${lead ? `<text x="${x + width}" y="${top + labelSize}" text-anchor="end" font-family="${SANS}" font-weight="700" font-size="${Math.round(labelSize * 0.62)}" letter-spacing="2" fill="${C.red}">CLOSEST MATCH</text>` : ''}
        <rect x="${x}" y="${top + labelSize + 12}" width="${width}" height="${barH}" fill="${C.track}"/>
        <rect x="${x}" y="${top + labelSize + 12}" width="${fill.toFixed(1)}" height="${barH}" fill="${color}"/>
        <text x="${x + width + pctSize * 3.3}" y="${top + labelSize + 12 + barH / 2 + pctSize * 0.36}" text-anchor="end" font-family="${SANS}" font-weight="800" font-size="${pctSize}" fill="${lead ? color : C.ink}">${p.score}%</text>
      </g>`;
    })
    .join('');
}

function issueList({ issues, x, y, size, gap, color = C.card, numColor = C.red }) {
  return issues
    .map(
      (name, i) => `<g>
        <text x="${x}" y="${y + i * gap}" font-family="${SERIF}" font-weight="700" font-size="${size}" fill="${numColor}">${i + 1}</text>
        <text x="${x + size * 1.1}" y="${y + i * gap}" font-family="${SERIF}" font-size="${size}" fill="${color}">${esc(name)}</text>
      </g>`
    )
    .join('');
}

function cardSvg(p) {
  const W = 1200;
  const H = 630;
  const hasIssues = p.issues.length > 0;
  const trackW = hasIssues ? 500 : 690;
  const parties = p.parties.slice(0, 4);
  const best = parties[0];
  // A tie at the top names both parties rather than picking one.
  const tied = best ? parties.filter((x) => x.score === best.score) : [];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" fill="${C.paper}"/>
    ${star(1080, 300, 330, C.navy, 'opacity="0.035"')}
    ${flagStripe(W)}
    <text x="64" y="86" font-family="${SANS}" font-weight="700" font-size="17" letter-spacing="3.4" fill="${C.red}">VOTERSHUB  ·  TEXAS GENERAL ELECTION 2026</text>
    <text x="64" y="148" font-family="${SERIF}" font-size="52" fill="${C.navy}">${esc(possessive(p.first_name))} ballot alignment</text>
    <text x="64" y="186" font-family="${SANS}" font-size="20" fill="${C.muted}">Agreement with each party's official Texas platform</text>
    ${
      parties.length
        ? bars({ parties, x: 64, y: 216, width: trackW, rowH: 74, labelSize: 22, pctSize: 30, barH: 24 })
        : `<text x="64" y="300" font-family="${SERIF}" font-size="30" fill="${C.ink}">Not enough answers to compare with party platforms.</text>`
    }
    ${
      hasIssues
        ? `<rect x="700" y="216" width="436" height="290" fill="${C.navy}"/>
      ${star(1100, 252, 14, C.red)}
      <text x="736" y="262" font-family="${SANS}" font-weight="700" font-size="16" letter-spacing="3" fill="#c9d3e6">TOP ISSUES</text>
      <rect x="736" y="280" width="48" height="3" fill="${C.red}"/>
      ${issueList({ issues: p.issues, x: 736, y: 340, size: 28, gap: 58 })}`
        : best
          ? `<text x="1136" y="300" text-anchor="end" font-family="${SANS}" font-weight="700" font-size="16" letter-spacing="3" fill="${C.muted}">${tied.length > 1 ? 'TIED FOR CLOSEST' : 'CLOSEST PLATFORM'}</text>
      ${
        tied.length > 1
          ? tied
              .slice(0, 2)
              .map(
                (t, i) =>
                  `<text x="1136" y="${348 + i * 44}" text-anchor="end" font-family="${SERIF}" font-size="38" fill="${PARTY[t.name] || C.navy}">${esc(t.name)}</text>`
              )
              .join('')
          : `<text x="1136" y="370" text-anchor="end" font-family="${SERIF}" font-size="58" fill="${PARTY[best.name] || C.navy}">${esc(best.name)}</text>`
      }
      <text x="1136" y="${tied.length > 1 ? 478 : 452}" text-anchor="end" font-family="${SANS}" font-weight="800" font-size="76" fill="${C.navy}">${best.score}%</text>`
          : ''
    }
    <rect x="0" y="546" width="${W}" height="84" fill="${C.navy}"/>
    ${star(96, 588, 22, C.card)}
    <text x="134" y="597" font-family="${SERIF}" font-size="28" fill="${C.card}">VotersHub</text>
    <text x="1136" y="596" text-anchor="end" font-family="${SANS}" font-weight="600" font-size="22" fill="${C.card}">See your own alignment at <tspan font-weight="800">votershub.info</tspan></text>
  </svg>`;
}

function storySvg(p) {
  const W = 1080;
  const H = 1920;
  const parties = p.parties.slice(0, 4);
  const hasIssues = p.issues.length > 0;
  // Rows tighten when the issues panel needs room above the call to action.
  const rowH = hasIssues ? 124 : 170;
  const issuesH = 330;
  const chartTop = 590;
  const issuesTop = chartTop + 70 + parties.length * rowH + 30;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" fill="${C.paper}"/>
    ${star(900, 600, 560, C.navy, 'opacity="0.035"')}
    ${flagStripe(W)}
    ${star(W / 2, 210, 44, C.navy)}
    <text x="${W / 2}" y="320" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="26" letter-spacing="5" fill="${C.red}">TEXAS GENERAL ELECTION 2026</text>
    <text x="${W / 2}" y="418" text-anchor="middle" font-family="${SERIF}" font-size="78" fill="${C.navy}">${esc(possessive(p.first_name))}</text>
    <text x="${W / 2}" y="506" text-anchor="middle" font-family="${SERIF}" font-size="78" fill="${C.navy}">ballot alignment</text>
    <text x="${W / 2}" y="${chartTop}" text-anchor="middle" font-family="${SANS}" font-size="28" fill="${C.muted}">Agreement with each party's official Texas platform</text>
    ${parties.length ? bars({ parties, x: 110, y: chartTop + 50, width: 660, rowH, labelSize: 38, pctSize: 52, barH: 44 }) : ''}
    ${
      hasIssues
        ? `<rect x="110" y="${issuesTop}" width="${W - 220}" height="${issuesH}" fill="${C.navy}"/>
      ${star(W - 170, issuesTop + 66, 22, C.red)}
      <text x="160" y="${issuesTop + 80}" font-family="${SANS}" font-weight="700" font-size="28" letter-spacing="5" fill="#c9d3e6">TOP ISSUES</text>
      <rect x="160" y="${issuesTop + 104}" width="80" height="5" fill="${C.red}"/>
      ${issueList({ issues: p.issues, x: 160, y: issuesTop + 180, size: 44, gap: 66 })}`
        : ''
    }
    <rect x="0" y="${H - 300}" width="${W}" height="300" fill="${C.navy}"/>
    ${star(W / 2, H - 252, 20, C.red)}
    <text x="${W / 2}" y="${H - 168}" text-anchor="middle" font-family="${SERIF}" font-size="56" fill="${C.card}">Where do you stand?</text>
    <text x="${W / 2}" y="${H - 102}" text-anchor="middle" font-family="${SANS}" font-weight="600" font-size="32" fill="#c9d3e6">Take the nonpartisan quiz at <tspan font-weight="800" fill="${C.card}">votershub.info</tspan></text>
  </svg>`;
}

export function shareImage(preview, format = 'card') {
  const svg = format === 'story' ? storySvg(preview) : cardSvg(preview);
  const png = new Resvg(svg, {
    font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: 'Public Sans' },
    fitTo: { mode: 'original' },
  }).render();
  return png.asPng();
}
