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
  if (!session.user?.is_admin) {
    view.innerHTML = '<h1>Admins only</h1><p>This page is for VotersHub admins. <a href="/">Return to the home page</a>.</p>';
    return;
  }
  let tab = new URLSearchParams(location.search).get('tab') || 'overview';
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
  async function drawAdmins(q = '') {
    const { users } = await api.admin.users(q);
    if (!current()) return;
    body.innerHTML = `
      <p>Admins can review partner link requests, see every link's numbers, and make other people admins. Search for an account by name or email.</p>
      <form id="admin-search" class="admin-search"><input type="search" name="q" value="${esc(q)}" placeholder="Name or email" minlength="2" maxlength="80"><button class="btn btn-small" type="submit">Search</button></form>
      <h3>${q ? 'Matching accounts' : 'Current admins'}</h3>
      ${
        users.length
          ? `<table class="ballot"><thead><tr><th>Name</th><th>Email</th><th>Admin</th></tr></thead><tbody>${users
              .map(
                (u) =>
                  `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${
                    u.owner
                      ? '<span class="tag tag-navy">Permanent admin</span>'
                      : `<label class="check"><input type="checkbox" data-admin="${u.id}" ${u.is_admin ? 'checked' : ''}> <span>${u.is_admin ? 'Admin' : 'Not an admin'}</span></label>`
                  }</td></tr>`
              )
              .join('')}</tbody></table>`
          : '<p class="muted">No accounts found.</p>'
      }`;
    $('#admin-search', body).addEventListener('submit', (e) => {
      e.preventDefault();
      drawAdmins(String(new FormData(e.target).get('q') || '').trim());
    });
  }

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
    const box = e.target.closest('[data-admin]');
    if (!box) return;
    const on = box.checked;
    if (
      !confirm(
        on ? 'Make this person an admin? They will see every partner link and can approve requests.' : 'Remove admin access?'
      )
    ) {
      box.checked = !on;
      return;
    }
    try {
      await api.admin.setAdmin(Number(box.dataset.admin), on);
      box.nextElementSibling.textContent = on ? 'Admin' : 'Not an admin';
      toast(on ? 'Admin access granted.' : 'Admin access removed.');
    } catch (ex) {
      box.checked = !on;
      toast(ex.message);
    }
  });

  draw();
}
