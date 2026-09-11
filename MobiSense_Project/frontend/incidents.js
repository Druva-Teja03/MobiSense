/**
 * MobiSense — Incident Center Controller
 */
(function () {
  'use strict';

  const AUTH_TOKEN = localStorage.getItem('mobisense_token');
  if (!AUTH_TOKEN) { window.location.href = 'login.html'; return; }

  function logout() {
    localStorage.removeItem('mobisense_token');
    localStorage.removeItem('mobisense_user');
    window.location.href = 'login.html';
  }

  const CONFIG = {
    API_URL: 'http://localhost:8000/issues',
    HEADERS: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${AUTH_TOKEN}` }
  };

  const CATEGORY_COLOR = {
    pothole: '#b45309', garbage: '#7c3aed', heavy_traffic: '#2563eb',
    accident: '#b91c1c', illegal_parking: '#0f766e', default: '#64748b'
  };

  const state = { issues: [], filterStatus: 'all', filterType: 'all', search: '', expandedId: null };

  const DOM = {
    tbody: document.getElementById('ic-table-body'),
    countPill: document.getElementById('ic-count-pill'),
    statusTabs: document.getElementById('ic-status-tabs'),
    categoryChips: document.getElementById('ic-category-chips'),
    search: document.getElementById('ic-search')
  };

  function formatIssueType(type) {
    const map = { pothole: 'Pothole', garbage: 'Garbage Dump', heavy_traffic: 'Heavy Traffic', accident: 'Road Accident', illegal_parking: 'Illegal Parking' };
    return map[type] || (type || 'Unknown').replace(/_/g, ' ');
  }

  function severityOf(issue) {
    return (issue.severity || issue.traffic_level || (issue.type === 'accident' ? 'high' : 'low') || '').toLowerCase();
  }

  function formatTime(isoStr) {
    if (!isoStr) return '—';
    const d = new Date(isoStr);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  async function fetchIssues() {
    try {
      const res = await fetch(CONFIG.API_URL, { headers: CONFIG.HEADERS });
      if (res.status === 401) { logout(); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      state.issues = Array.isArray(data) ? data : (data.issues || []);
      render();
    } catch (err) {
      console.error('Incident Center: fetch failed', err);
      DOM.tbody.innerHTML = `<tr><td colspan="8" class="ic-empty">Could not reach the backend API.</td></tr>`;
    }
  }

  async function resolveIssue(id) {
    const issue = state.issues.find(i => String(i.id) === String(id));
    if (!issue) return;
    issue.status = 'resolved';
    render();
    try {
      await fetch(`${CONFIG.API_URL}/${id}`, {
        method: 'PATCH', headers: CONFIG.HEADERS, body: JSON.stringify({ status: 'resolved' })
      });
    } catch (err) {
      console.warn('Resolve PATCH failed, keeping optimistic update:', err);
    }
    fetchIssues();
  }

  function getFiltered() {
    return state.issues.filter(issue => {
      const resolved = (issue.status || '').toLowerCase() === 'resolved';
      if (state.filterStatus === 'unresolved' && resolved) return false;
      if (state.filterStatus === 'resolved' && !resolved) return false;
      if (state.filterType !== 'all' && issue.type !== state.filterType) return false;
      if (state.search) {
        const q = state.search.toLowerCase();
        const hay = `${issue.id} ${issue.type} ${issue.lat} ${issue.lng} ${issue.severity || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function render() {
    const filtered = getFiltered();
    DOM.countPill.textContent = `${filtered.length} incident${filtered.length === 1 ? '' : 's'}`;

    if (!filtered.length) {
      DOM.tbody.innerHTML = `<tr><td colspan="8" class="ic-empty">No incidents match these filters.</td></tr>`;
      return;
    }

    const sorted = filtered.slice().sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    DOM.tbody.innerHTML = sorted.map(issue => {
      const color = CATEGORY_COLOR[issue.type] || CATEGORY_COLOR.default;
      const sev = severityOf(issue);
      const status = (issue.status || 'unresolved').toLowerCase();
      const isExpanded = state.expandedId === String(issue.id);
      const row = `
        <tr class="ic-row${isExpanded ? ' is-expanded' : ''}" data-id="${issue.id}">
          <td><svg class="ic-expand-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></td>
          <td><strong>#${escapeHtml(issue.id)}</strong></td>
          <td><span class="ic-category-pill" style="background:${color}22;color:${color}">${formatIssueType(issue.type)}</span></td>
          <td><span class="ic-severity-pill" style="background:${color}18;color:${color}">${sev.toUpperCase()}</span></td>
          <td>${Number(issue.detection_count || 1)} detections</td>
          <td>${formatTime(issue.timestamp)}</td>
          <td>${formatTime(issue.timestamp)}</td>
          <td><span class="ic-status-pill ${status}">${status.replace('_', ' ')}</span></td>
        </tr>`;

      if (!isExpanded) return row;

      const detail = `
        <tr class="ic-detail-row">
          <td colspan="8">
            <div class="ic-detail-grid">
              <div class="ic-detail-field"><span>Location</span><span>${Number(issue.lat).toFixed(5)}°N, ${Number(issue.lng).toFixed(5)}°E</span></div>
              <div class="ic-detail-field"><span>AI Observations</span><span>${Number(issue.detection_count || 1)}</span></div>
              <div class="ic-detail-field"><span>Last Detected</span><span>${formatTime(issue.timestamp)}</span></div>
              <div class="ic-detail-field"><span>Status</span><span>${status.replace('_', ' ')}</span></div>
              ${issue.vehicle_count != null ? `<div class="ic-detail-field"><span>Vehicles in Frame</span><span>${issue.vehicle_count}</span></div>` : ''}
              ${issue.item_count != null ? `<div class="ic-detail-field"><span>Item Count (last)</span><span>${issue.item_count}</span></div>` : ''}
            </div>
            <div class="ic-detail-actions">
              <button class="ic-btn" data-action="locate" data-id="${issue.id}">Locate on map</button>
              ${status !== 'resolved' ? `<button class="ic-btn ic-btn-primary" data-action="resolve" data-id="${issue.id}">Mark resolved</button>` : ''}
            </div>
          </td>
        </tr>`;
      return row + detail;
    }).join('');

    DOM.tbody.querySelectorAll('.ic-row').forEach(tr => {
      tr.addEventListener('click', (e) => {
        if (e.target.closest('[data-action]')) return;
        const id = tr.dataset.id;
        state.expandedId = state.expandedId === id ? null : id;
        render();
      });
    });

    DOM.tbody.querySelectorAll('[data-action="resolve"]').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); resolveIssue(btn.dataset.id); });
    });
    DOM.tbody.querySelectorAll('[data-action="locate"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        window.location.href = `dashboard.html?focus=${encodeURIComponent(btn.dataset.id)}`;
      });
    });
  }

  DOM.statusTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.ic-tab');
    if (!btn) return;
    DOM.statusTabs.querySelectorAll('.ic-tab').forEach(b => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    state.filterStatus = btn.dataset.status;
    render();
  });

  DOM.categoryChips.addEventListener('click', (e) => {
    const btn = e.target.closest('.ic-chip');
    if (!btn) return;
    DOM.categoryChips.querySelectorAll('.ic-chip').forEach(b => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    state.filterType = btn.dataset.type;
    render();
  });

  DOM.search.addEventListener('input', (e) => { state.search = e.target.value.trim(); render(); });

  document.addEventListener('DOMContentLoaded', fetchIssues);
})();
