// Admin: partner link requests, every link's numbers, and who else is an admin.
// The server checks admin access on every call; this page only hides itself
// from people who are not admins.

import { $, $$, esc, setTitle, toast, formatDate, skeleton, openModal, closeModal } from '../ui.js';
import { api, session } from '../api.js';
import { navigate } from '../app.js';
import { statsHtml, rangeBar, bindRange } from './partner-stats.js';
import { renderOverview } from './admin-overview.js';

const TABS = [
  ['overview', 'Overview'],
  ['requests', 'Requests'],
  ['links', 'Partner links'],
  ['admins', 'Admins'],
];

export async function renderAdmin(view, _params, current) {
  setTitle('Admin');
  if (!session.token) return navigate('/sign-in?next=/admin', { replace: true });
  let tab = new URLSearchParams(location.search).get('tab') || 'overview';
  // The server decides: access may have been granted or changed since this
  // browser last loaded the account.
  let myRole = null;
  const loadRole = async () => {
    try {
      myRole = (await api.admin.me()).role;
    } catch {
      myRole = null;
    }
  };
  await loadRole();
  if (!current()) return;
  if (!myRole) {
    view.innerHTML = '<h1>Admins only</h1><p>This page is for VotersHub admins. <a href="/">Return to the home page</a>.</p>';
    return;
  }
  let range = { from: '', to: '' };

  view.innerHTML = `<div class="admin-page">
    <span class="eyebrow">Admin</span>
    <h1>Admin</h1>
    <div class="seg admin-tabs" role="tablist">${TABS.map(([k, l]) => `<button type="button" role="tab" data-tab="${k}">${l}</button>`).join('')}</div>
    <div id="admin-body"></div>
  </div>`;
  const body = $('#admin-body', view);

  async function draw() {
    $$('[data-tab]', view).forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    history.replaceState({}, '', `/admin?tab=${tab}`);
    body.innerHTML = skeleton('list');
    try {
      if (tab === 'overview') renderOverview(body, current);
      else if (tab === 'requests') await drawRequests();
      else if (tab === 'links') await drawLinks();
      else await drawAdmins();
    } catch (e) {
      if (!current()) return;
      body.innerHTML = `<p class="form-error">${esc(e.message)}</p>`;
    }
  }

  // ---------- Requests ----------
  async function drawRequests() {
    const [{ links: pending }, { links: all }] = await Promise.all([api.admin.partners('pending'), api.admin.partners()]);
    if (!current()) return;
    const decided = all.filter((l) => l.status !== 'pending').slice(0, 30);
    body.innerHTML = `
      <section><div class="section-head"><h2>Waiting for review (${pending.length})</h2></div>
        ${
          pending.length
            ? `<div class="admin-cards">${pending
                .map(
                  (l) => `<article class="panel admin-card" data-id="${l.id}">
                  <p class="admin-slug">${esc(l.url.replace(/^https?:\/\//, ''))}</p>
                  <p><b>${esc(l.owner.name)}</b> <span class="muted">${esc(l.owner.email)}</span></p>
                  <p class="small">Who they will share it with: ${esc(l.reason)}</p>
                  ${
                    l.socials?.length
                      ? `<ul class="admin-socials">${l.socials
                          .map(
                            (s) =>
                              `<li><b>${esc(s.site)}:</b> <a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer nofollow">${esc(s.url.replace(/^https?:\/\/(www\.)?/, ''))}</a></li>`
                          )
                          .join('')}</ul>`
                      : ''
                  }
                  <p class="small muted">Requested ${esc(formatDate(l.created_at))}</p>
                  <div class="btn-row"><button class="btn btn-small" data-approve="${l.id}">Approve</button><button class="btn btn-ghost btn-small" data-reject="${l.id}">Reject</button></div>
                </article>`
                )
                .join('')}</div>`
            : '<p class="muted">No requests waiting. New requests also arrive by email.</p>'
        }
      </section>
      <section><div class="section-head"><h2>Recent decisions</h2></div>
        ${
          decided.length
            ? `<table class="ballot"><thead><tr><th>Link</th><th>Partner</th><th>Status</th><th>Decided</th></tr></thead><tbody>${decided
                .map(
                  (l) =>
                    `<tr><td>${esc(l.slug)}</td><td>${esc(l.owner.name)}<br><span class="small muted">${esc(l.owner.email)}</span></td><td><span class="tag ${l.status === 'approved' ? 'tag-navy' : 'tag-red'}">${esc(l.status)}</span></td><td class="small">${l.decided_at ? esc(formatDate(l.decided_at)) : ''}</td></tr>`
                )
                .join('')}</tbody></table>`
            : '<p class="muted">Nothing decided yet.</p>'
        }
      </section>`;
  }

  async function decide(id, approve) {
    let note = '';
    if (!approve) {
      const modal = openModal({ title: 'Reject this request' });
      note = await new Promise((resolve) => {
        modal.body.innerHTML = `<label for="rej-note">Optional note to the requester</label>
          <textarea id="rej-note" maxlength="300" rows="3" placeholder="For example: please choose a link that names your group"></textarea>
          <div class="btn-row" style="justify-content:flex-end;margin-top:14px"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-red" id="rej-go">Reject and email them</button></div>`;
        modal.body.querySelector('#rej-go').addEventListener('click', () => resolve(modal.body.querySelector('#rej-note').value));
        modal.body.querySelector('[data-close]').addEventListener('click', () => resolve(null));
      });
      closeModal();
      if (note === null) return;
    }
    try {
      const { link } = await api.admin.decide(id, approve, note);
      toast(
        approve ? `Approved. ${link.owner.name} has been emailed their link.` : `Rejected. ${link.owner.name} has been emailed.`
      );
      draw();
    } catch (e) {
      toast(e.message);
    }
  }

  // ---------- Partner links ----------
  async function drawLinks() {
    const { range: r, links } = await api.admin.summary(range);
    if (!current()) return;
    const csv = `/api/admin/partners.csv?${new URLSearchParams(range)}`;
    body.innerHTML = `
      ${rangeBar('admin-range', range.from || r.from, range.to || r.to)}
      ${
        links.length
          ? `<div class="table-scroll"><table class="ballot admin-links"><thead><tr><th>Link</th><th>Partner</th><th class="num">Visits</th><th class="num">Unique</th><th class="num">Sign-ups</th><th class="num">Rate</th><th class="num">Quizzes</th><th></th></tr></thead><tbody>${links
              .map(
                (l) =>
                  `<tr><td><b>${esc(l.slug)}</b></td><td>${esc(l.owner.name)}</td><td class="num">${l.visits}</td><td class="num">${l.unique_visitors}</td><td class="num">${l.sign_ups}</td><td class="num">${l.sign_up_rate === null ? '' : `${l.sign_up_rate}%`}</td><td class="num">${l.quiz_completions}</td><td><button class="linkish" data-detail="${l.id}">Details</button></td></tr>`
              )
              .join('')}</tbody></table></div>
            <p class="small"><button class="linkish" id="admin-csv">Download these totals as CSV</button></p>`
          : '<p class="muted">No approved partner links yet.</p>'
      }
      <div id="link-detail"></div>`;
    bindRange($('#admin-range', body), (next) => {
      range = next;
      drawLinks();
    });
    $('#admin-csv', body)?.addEventListener('click', () => download(csv, 'partner-links.csv'));
  }

  async function showDetail(id) {
    const out = $('#link-detail', body);
    out.innerHTML = skeleton('list');
    try {
      const { link, stats } = await api.partnerStats({ id, ...range });
      out.innerHTML = `<section class="panel"><div class="section-head"><h2>${esc(link.slug)}</h2><a href="${esc(link.url)}" target="_blank" rel="noopener">${esc(link.url)}</a></div>${statsHtml(stats)}</section>`;
      out.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      out.innerHTML = `<p class="form-error">${esc(e.message)}</p>`;
    }
  }

  // The CSV needs the sign-in token, which is sent in a header, never in the URL.
  async function download(url, name) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${session.token}` } });
    if (!res.ok) return toast('Could not download the file.');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await res.blob());
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  // ---------- Admins ----------
  // ---------- Admins ----------
  const ROLE_LABEL = { master: 'Master (full access)', write: 'Read and write', read: 'Read only' };
  const canManage = () => myRole === 'master' || myRole === 'write';

  function roleCell(u) {
    if (u.role === 'master') return '<span class="tag tag-navy">Master · full access</span>';
    if (!canManage()) return u.role ? esc(ROLE_LABEL[u.role]) : '<span class="muted">Not an admin</span>';
    return `<select data-role="${u.id}" data-current="${u.role || ''}" data-self="${u.email === session.user?.email}" aria-label="Admin role for ${esc(u.name)}">
      ${u.role ? '' : '<option value="" selected>Not an admin</option>'}
      <option value="read" ${u.role === 'read' ? 'selected' : ''}>Read only</option>
      <option value="write" ${u.role === 'write' ? 'selected' : ''}>Read and write</option>
      ${u.role ? '<option value="remove">Remove admin access</option>' : ''}
    </select>`;
  }

  function adminTable(list) {
    return `<table class="ballot admin-table"><thead><tr><th>Name</th><th>Email</th><th>Access</th></tr></thead><tbody>${list
      .map(
        (u) =>
          `<tr><td>${esc(u.name)}${u.email === session.user?.email ? ' <span class="small muted">(you)</span>' : ''}</td><td class="small">${esc(u.email)}</td><td>${roleCell(u)}</td></tr>`
      )
      .join('')}</tbody></table>`;
  }

  async function drawAdmins(q = '') {
    const [{ users: admins }, search] = await Promise.all([api.admin.users(''), q ? api.admin.users(q) : Promise.resolve(null)]);
    if (!current()) return;
    body.innerHTML = `
      <div class="panel role-legend">
        <p style="margin-top:0"><b>Your access: ${esc(ROLE_LABEL[myRole] || myRole)}.</b></p>
        <ul>
          <li><b>Read only:</b> sees the Overview and partner links, and approves or rejects partner link requests.</li>
          <li><b>Read and write:</b> everything above, plus adding admins, changing their access, and removing them.</li>
          <li><b>Master:</b> full access to everything, always. It cannot be changed or removed here.</li>
        </ul>
      </div>
      <h3>Admins (${admins.length})</h3>
      ${adminTable(admins)}
      ${
        canManage()
          ? `<h3 style="margin-top:28px">Add an admin</h3>
        <p class="small muted" style="margin-top:0">Search for someone with a VotersHub account, then choose their access.</p>
        <form id="admin-search" class="admin-search"><input type="search" name="q" value="${esc(q)}" placeholder="Name or email" minlength="2" maxlength="80"><button class="btn btn-small" type="submit">Search</button></form>
        ${search ? (search.users.length ? adminTable(search.users) : '<p class="muted">No accounts found.</p>') : ''}`
          : '<p class="small muted">Only admins with read and write access can add or change admins.</p>'
      }`;
    $('#admin-search', body)?.addEventListener('submit', (e) => {
      e.preventDefault();
      drawAdmins(String(new FormData(e.target).get('q') || '').trim());
    });
    lastQuery = q;
  }
  let lastQuery = '';

  view.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) {
      tab = t.dataset.tab;
      return draw();
    }
    const a = e.target.closest('[data-approve]');
    if (a) return decide(Number(a.dataset.approve), true);
    const r = e.target.closest('[data-reject]');
    if (r) return decide(Number(r.dataset.reject), false);
    const d = e.target.closest('[data-detail]');
    if (d) return showDetail(Number(d.dataset.detail));
  });
  view.addEventListener('change', async (e) => {
    const sel = e.target.closest('[data-role]');
    if (!sel) return;
    const was = sel.dataset.current || null;
    const role = sel.value === 'remove' ? null : sel.value || null;
    if (role === was) return;
    const self = sel.dataset.self === 'true';
    const lowering = (was === 'write' && role !== 'write') || (was && !role);
    const msg =
      self && lowering
        ? 'Lower your own access? You will need the master admin or another read-and-write admin to restore it.'
        : !role
          ? "Remove this person's admin access?"
          : was
            ? `Change this admin to ${ROLE_LABEL[role]}?`
            : `Make this person an admin with ${ROLE_LABEL[role]} access?`;
    if (!confirm(msg)) {
      sel.value = was || '';
      return;
    }
    try {
      await api.admin.setRole(Number(sel.dataset.role), role);
      toast(role ? `Access set to ${ROLE_LABEL[role]}.` : 'Admin access removed.');
      if (self) {
        await loadRole();
        if (!myRole) return navigate('/profile', { replace: true });
      }
      drawAdmins(lastQuery);
    } catch (ex) {
      sel.value = was || '';
      toast(ex.message);
    }
  });

  draw();
}
