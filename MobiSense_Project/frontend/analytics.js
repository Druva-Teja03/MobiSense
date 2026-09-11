/**
 * MobiSense — Analytics Controller
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
    SLA_URL: 'http://localhost:8000/analytics/sla',
    HEADERS: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${AUTH_TOKEN}` }
  };

  const CATEGORY_COLOR = { pothole: '#b45309', garbage: '#7c3aed', heavy_traffic: '#2563eb', accident: '#b91c1c', illegal_parking: '#0f766e', default: '#64748b' };
  const SEVERITY_COLOR = { major: '#b91c1c', high: '#b91c1c', heavy: '#b91c1c', moderate: '#d97706', medium: '#d97706', low: '#16a34a' };

  function formatIssueType(type) {
    const map = { pothole: 'Pothole', garbage: 'Garbage Dump', heavy_traffic: 'Heavy Traffic', accident: 'Road Accident', illegal_parking: 'Illegal Parking' };
    return map[type] || (type || 'Unknown').replace(/_/g, ' ');
  }

  function severityOf(issue) {
    return (issue.severity || issue.traffic_level || (issue.type === 'accident' ? 'high' : 'low') || '').toLowerCase();
  }

  async function load() {
    try {
      const res = await fetch(CONFIG.API_URL, { headers: CONFIG.HEADERS });
      if (res.status === 401) { logout(); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const issues = Array.isArray(data) ? data : (data.issues || []);
      render(issues);
    } catch (err) {
      console.error('Analytics: fetch failed', err);
      document.getElementById('an-category-bars').innerHTML = '<p class="cc-empty">Could not reach the backend API.</p>';
      document.getElementById('an-severity-bars').innerHTML = '';
    }
    loadSla();
  }

  async function loadSla() {
    const tbody = document.getElementById('an-sla-body');
    if (!tbody) return;
    try {
      const res = await fetch(CONFIG.SLA_URL, { headers: CONFIG.HEADERS });
      if (res.status === 401) { logout(); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = await res.json();
      renderSla(rows);
    } catch (err) {
      console.error('Analytics: SLA fetch failed', err);
      tbody.innerHTML = '<tr><td colspan="5" class="cc-empty">Could not reach the backend API.</td></tr>';
    }
  }

  function renderSla(rows) {
    const tbody = document.getElementById('an-sla-body');
    if (!rows || !rows.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="cc-empty">No incidents yet.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(r => {
      const avgHours = r.avg_resolution_hours;
      const avgLabel = avgHours === null || avgHours === undefined
        ? '—'
        : (avgHours < 1 ? '<1h' : avgHours >= 24 ? `${(avgHours / 24).toFixed(1)}d` : `${avgHours}h`);
      const overdue = Number(r.overdue_count || 0);
      const badgeClass = overdue > 0 ? '' : 'is-clear';
      const badgeLabel = overdue > 0 ? `${overdue} overdue` : 'On track';
      return `
        <tr>
          <td>${r.display_name || formatIssueType(r.type)}</td>
          <td>${r.open_issues}</td>
          <td>${r.resolved_issues}</td>
          <td>${avgLabel}</td>
          <td><span class="an-sla-overdue-badge ${badgeClass}">${badgeLabel}</span></td>
        </tr>`;
    }).join('');
  }

  function renderBars(containerId, entries, colorMap) {
    const container = document.getElementById(containerId);
    if (!entries.length) { container.innerHTML = '<p class="cc-empty">No data yet.</p>'; return; }
    const max = Math.max(...entries.map(e => e.value));
    container.innerHTML = entries.map(e => {
      const color = colorMap[e.key] || colorMap.default || '#64748b';
      const pct = max > 0 ? Math.round((e.value / max) * 100) : 0;
      return `
        <div class="an-bar-row">
          <div class="an-bar-label-row"><span>${e.label}</span><span>${e.value}</span></div>
          <div class="an-bar-track"><div class="an-bar-fill" style="width:${pct}%;background:${color}"></div></div>
        </div>`;
    }).join('');
  }

  function render(issues) {
    const totalObservations = issues.reduce((s, i) => s + Number(i.detection_count || 1), 0);
    const totalIncidents = issues.length;
    const consolidated = totalObservations - totalIncidents;
    const pct = totalObservations > 0 ? Math.round((consolidated / totalObservations) * 100) : 0;

    document.getElementById('an-raw').textContent = totalObservations;
    document.getElementById('an-unique').textContent = totalIncidents;
    document.getElementById('an-pct').textContent = `${pct}%`;
    document.getElementById('an-consolidated').textContent = consolidated;

    const byCategory = {};
    issues.forEach(i => { byCategory[i.type || 'unknown'] = (byCategory[i.type || 'unknown'] || 0) + 1; });
    renderBars('an-category-bars',
      Object.entries(byCategory).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ key: k, label: formatIssueType(k), value: v })),
      CATEGORY_COLOR);

    const bySeverity = {};
    issues.forEach(i => { const s = severityOf(i); bySeverity[s] = (bySeverity[s] || 0) + 1; });
    const sevOrder = ['major', 'high', 'heavy', 'moderate', 'medium', 'low'];
    renderBars('an-severity-bars',
      Object.entries(bySeverity)
        .sort((a, b) => sevOrder.indexOf(a[0]) - sevOrder.indexOf(b[0]))
        .map(([k, v]) => ({ key: k, label: k.charAt(0).toUpperCase() + k.slice(1), value: v })),
      SEVERITY_COLOR);

    const resolved = issues.filter(i => (i.status || '').toLowerCase() === 'resolved').length;
    const unresolved = totalIncidents - resolved;
    const bar = document.getElementById('an-status-bar');
    const legend = document.getElementById('an-status-legend');
    if (totalIncidents === 0) {
      bar.innerHTML = '';
      legend.innerHTML = '<span class="cc-empty">No incidents yet.</span>';
    } else {
      const resolvedPct = Math.round((resolved / totalIncidents) * 100);
      bar.innerHTML = `
        <div style="width:${resolvedPct}%;background:var(--status-resolved-dot)"></div>
        <div style="width:${100 - resolvedPct}%;background:var(--status-unresolved-dot)"></div>`;
      legend.innerHTML = `
        <span class="an-status-legend-item"><span class="an-status-legend-dot" style="background:var(--status-resolved-dot)"></span>Resolved (${resolved})</span>
        <span class="an-status-legend-item"><span class="an-status-legend-dot" style="background:var(--status-unresolved-dot)"></span>Unresolved (${unresolved})</span>`;
    }
  }

  document.addEventListener('DOMContentLoaded', load);
})();
