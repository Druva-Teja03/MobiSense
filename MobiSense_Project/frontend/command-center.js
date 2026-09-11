/**
 * MobiSense — Command Center Controller
 * Every number on this page is derived from the same /issues payload
 * dashboard.js already uses — no fabricated demo data.
 */
(function () {
  'use strict';

  const AUTH_TOKEN = localStorage.getItem('mobisense_token');
  if (!AUTH_TOKEN) {
    window.location.href = 'login.html';
    return;
  }
  const CURRENT_USER = JSON.parse(localStorage.getItem('mobisense_user') || '{}');

  function logout() {
    localStorage.removeItem('mobisense_token');
    localStorage.removeItem('mobisense_user');
    window.location.href = 'login.html';
  }

  const CONFIG = {
    API_URL: 'http://localhost:8000/issues',
    HEADERS: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${AUTH_TOKEN}`
    },
    DEFAULT_CENTER: [12.9716, 77.5946],
    DEFAULT_ZOOM: 11
  };

  const SEVERITY_RANK = { major: 4, high: 3, heavy: 3, moderate: 2, medium: 2, low: 1 };
  const CATEGORY_COLOR = {
    pothole: '#b45309',
    garbage: '#7c3aed',
    heavy_traffic: '#2563eb',
    accident: '#b91c1c',
    illegal_parking: '#0f766e',
    default: '#64748b'
  };

  const state = { issues: [], map: null, markersLayer: null };

  const DOM = {
    liveBadge: document.getElementById('cc-live-badge'),
    liveText: document.getElementById('cc-live-text'),
    syncLabel: document.getElementById('cc-sync-label'),
    statActive: document.getElementById('stat-active'),
    statCritical: document.getElementById('stat-critical'),
    statVerified: document.getElementById('stat-verified'),
    statResolved: document.getElementById('stat-resolved'),
    statObservations: document.getElementById('stat-observations'),
    priorityList: document.getElementById('cc-priority-list'),
    activityList: document.getElementById('cc-activity-list'),
    statusApi: document.getElementById('status-api'),
    statusSync: document.getElementById('status-sync'),
    profileMenuWrapper: document.getElementById('profile-menu-wrapper'),
    profileAvatarBtn: document.getElementById('profile-avatar-btn'),
    profileAvatarInitial: document.getElementById('profile-avatar-initial'),
    profileAvatarInitialLg: document.getElementById('profile-avatar-initial-lg'),
    profileDropdown: document.getElementById('profile-dropdown'),
    profileName: document.getElementById('profile-name'),
    profileRole: document.getElementById('profile-role'),
    profileEmail: document.getElementById('profile-email'),
    profileJobTitle: document.getElementById('profile-job-title'),
    profileGovtId: document.getElementById('profile-govt-id'),
    profileJoined: document.getElementById('profile-joined'),
    logoutBtn: document.getElementById('logout-btn')
  };

  function getInitial(name) { return (name || '?').trim().charAt(0).toUpperCase() || '?'; }

  function toggleProfileDropdown(forceOpen) {
    if (!DOM.profileDropdown || !DOM.profileAvatarBtn) return;
    const isOpen = !DOM.profileDropdown.hidden;
    const nextOpen = forceOpen !== undefined ? forceOpen : !isOpen;
    DOM.profileDropdown.hidden = !nextOpen;
    DOM.profileAvatarBtn.setAttribute('aria-expanded', String(nextOpen));
  }

  async function loadProfile() {
    const initial = getInitial(CURRENT_USER.full_name);
    if (DOM.profileAvatarInitial) DOM.profileAvatarInitial.textContent = initial;
    if (DOM.profileAvatarInitialLg) DOM.profileAvatarInitialLg.textContent = initial;
    if (DOM.profileName) DOM.profileName.textContent = CURRENT_USER.full_name || 'Account';
    if (DOM.profileRole) DOM.profileRole.textContent = CURRENT_USER.role || '—';
    try {
      const res = await fetch(`${CONFIG.API_URL.replace('/issues', '')}/users/me`, { headers: CONFIG.HEADERS });
      if (res.status === 401) { logout(); return; }
      if (!res.ok) return;
      const profile = await res.json();
      if (DOM.profileName) DOM.profileName.textContent = profile.full_name || '—';
      if (DOM.profileRole) DOM.profileRole.textContent = profile.role || '—';
      if (DOM.profileEmail) DOM.profileEmail.textContent = profile.email || '—';
      if (DOM.profileJobTitle) DOM.profileJobTitle.textContent = profile.job_title || '—';
      if (DOM.profileGovtId) DOM.profileGovtId.textContent = profile.govt_id_number || '—';
      if (DOM.profileJoined && profile.created_at) {
        DOM.profileJoined.textContent = new Date(profile.created_at).toLocaleDateString();
      }
    } catch (err) { /* header still shows login-time values */ }
  }

  function formatIssueType(type) {
    const map = {
      pothole: 'Pothole', garbage: 'Garbage Dump', heavy_traffic: 'Heavy Traffic',
      accident: 'Road Accident', illegal_parking: 'Illegal Parking'
    };
    return map[type] || (type || 'Unknown').replace(/_/g, ' ');
  }

  function severityOf(issue) {
    const raw = (issue.severity || issue.traffic_level || '').toLowerCase();
    return raw || (issue.type === 'accident' ? 'high' : 'low');
  }

  function isCritical(issue) {
    const sev = severityOf(issue);
    return issue.type === 'accident' || sev === 'major' || sev === 'high' || sev === 'heavy';
  }

  function formatRelativeTime(isoStr) {
    if (!isoStr) return '—';
    const then = new Date(isoStr).getTime();
    const diffMin = Math.round((Date.now() - then) / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.round(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    return new Date(isoStr).toLocaleDateString();
  }

  async function fetchIssues() {
    try {
      const res = await fetch(CONFIG.API_URL, { headers: CONFIG.HEADERS });
      if (res.status === 401) { logout(); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      state.issues = Array.isArray(data) ? data : (data.issues || []);
      if (DOM.statusApi) {
        DOM.statusApi.textContent = 'Online';
        DOM.statusApi.classList.add('cc-status-pill-ok');
        DOM.statusApi.classList.remove('cc-status-pill-error');
      }
      if (DOM.liveText) DOM.liveText.textContent = `${state.issues.length} tracked incidents`;
      const now = new Date();
      if (DOM.syncLabel) DOM.syncLabel.textContent = `Last sync: ${now.toLocaleTimeString()}`;
      if (DOM.statusSync) DOM.statusSync.textContent = now.toLocaleTimeString();
      render();
    } catch (err) {
      console.error('Command Center: could not reach API', err);
      if (DOM.statusApi) {
        DOM.statusApi.textContent = 'Offline';
        DOM.statusApi.classList.add('cc-status-pill-error');
        DOM.statusApi.classList.remove('cc-status-pill-ok');
      }
      if (DOM.liveText) DOM.liveText.textContent = 'Could not reach backend';
    }
  }

  function render() {
    renderStats();
    renderMap();
    renderPriorityList();
    renderActivity();
  }

  function renderStats() {
    const issues = state.issues;
    const resolved = issues.filter(i => (i.status || '').toLowerCase() === 'resolved');
    const active = issues.filter(i => (i.status || '').toLowerCase() !== 'resolved');
    const critical = active.filter(isCritical);
    const verified = issues.filter(i => Number(i.detection_count || 1) >= 2);
    const observations = issues.reduce((sum, i) => sum + Number(i.detection_count || 1), 0);

    if (DOM.statActive) DOM.statActive.textContent = active.length;
    if (DOM.statCritical) DOM.statCritical.textContent = critical.length;
    if (DOM.statVerified) DOM.statVerified.textContent = verified.length;
    if (DOM.statResolved) DOM.statResolved.textContent = resolved.length;
    if (DOM.statObservations) DOM.statObservations.textContent = observations;
  }

  function renderPriorityList() {
    if (!DOM.priorityList) return;
    const active = state.issues.filter(i => (i.status || '').toLowerCase() !== 'resolved');
    const sorted = active.slice().sort((a, b) => {
      const rankA = SEVERITY_RANK[severityOf(a)] || 0;
      const rankB = SEVERITY_RANK[severityOf(b)] || 0;
      if (rankB !== rankA) return rankB - rankA;
      return Number(b.detection_count || 1) - Number(a.detection_count || 1);
    }).slice(0, 8);

    if (!sorted.length) {
      DOM.priorityList.innerHTML = '<p class="cc-empty">No active incidents — all clear.</p>';
      return;
    }

    DOM.priorityList.innerHTML = sorted.map(issue => {
      const color = CATEGORY_COLOR[issue.type] || CATEGORY_COLOR.default;
      const sev = severityOf(issue).toUpperCase();
      return `
        <div class="cc-priority-item" data-id="${issue.id}">
          <span class="cc-priority-dot" style="background:${color}"></span>
          <div class="cc-priority-body">
            <div class="cc-priority-title">#${issue.id} — ${formatIssueType(issue.type)}</div>
            <div class="cc-priority-meta">${Number(issue.detection_count || 1)} AI observations · ${formatRelativeTime(issue.timestamp)}</div>
          </div>
          <span class="cc-priority-severity" style="background:${color}22;color:${color}">${sev}</span>
        </div>`;
    }).join('');

    DOM.priorityList.querySelectorAll('.cc-priority-item').forEach(el => {
      el.addEventListener('click', () => {
        window.location.href = `dashboard.html?focus=${encodeURIComponent(el.dataset.id)}`;
      });
    });
  }

  function renderActivity() {
    if (!DOM.activityList) return;
    const sorted = state.issues.slice().sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 8);
    if (!sorted.length) {
      DOM.activityList.innerHTML = '<p class="cc-empty">No recent activity.</p>';
      return;
    }
    DOM.activityList.innerHTML = sorted.map(issue => {
      const resolved = (issue.status || '').toLowerCase() === 'resolved';
      const verb = resolved ? 'resolved' : (Number(issue.detection_count || 1) > 1 ? 're-detected' : 'detected');
      const color = CATEGORY_COLOR[issue.type] || CATEGORY_COLOR.default;
      return `
        <div class="cc-activity-item">
          <span class="cc-activity-dot" style="background:${color}"></span>
          <span>#${issue.id} ${formatIssueType(issue.type)} ${verb}</span>
          <span class="cc-activity-time">${formatRelativeTime(issue.timestamp)}</span>
        </div>`;
    }).join('');
  }

  function renderMap() {
    if (!state.map || typeof L === 'undefined') return;
    if (state.markersLayer) state.markersLayer.clearLayers();
    else state.markersLayer = L.layerGroup().addTo(state.map);

    state.issues.forEach(issue => {
      if (!issue.lat || !issue.lng) return;
      const color = CATEGORY_COLOR[issue.type] || CATEGORY_COLOR.default;
      const resolved = (issue.status || '').toLowerCase() === 'resolved';
      const marker = L.circleMarker([issue.lat, issue.lng], {
        radius: 6,
        color: color,
        fillColor: color,
        fillOpacity: resolved ? 0.25 : 0.85,
        weight: resolved ? 1 : 2
      });
      marker.on('click', () => { window.location.href = `dashboard.html?focus=${encodeURIComponent(issue.id)}`; });
      marker.addTo(state.markersLayer);
    });
  }

  function initMap() {
    const el = document.getElementById('cc-mini-map');
    if (!el || typeof L === 'undefined') return;
    state.map = L.map(el, { zoomControl: false, attributionControl: false })
      .setView(CONFIG.DEFAULT_CENTER, CONFIG.DEFAULT_ZOOM);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(state.map);
    L.control.zoom({ position: 'bottomright' }).addTo(state.map);
  }

  document.addEventListener('DOMContentLoaded', () => {
    loadProfile();
    if (DOM.profileAvatarBtn) {
      DOM.profileAvatarBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleProfileDropdown(); });
    }
    document.addEventListener('click', (e) => {
      if (DOM.profileMenuWrapper && !DOM.profileMenuWrapper.contains(e.target)) toggleProfileDropdown(false);
    });
    if (DOM.logoutBtn) DOM.logoutBtn.addEventListener('click', logout);

    initMap();
    fetchIssues();
    setInterval(fetchIssues, 30000);
  });
})();
