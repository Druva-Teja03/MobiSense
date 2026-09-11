/**
 * MobiSense — Fleet Intelligence Controller
 * Only reports metrics the current schema can actually prove (see the
 * on-page notice). No fabricated vehicle/GPS-tracking data.
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
    HOTSPOTS_URL: 'http://localhost:8000/analytics/hotspots',
    HEADERS: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${AUTH_TOKEN}` }
  };

  function formatIssueType(type) {
    const map = { pothole: 'Pothole', garbage: 'Garbage Dump', heavy_traffic: 'Heavy Traffic', accident: 'Road Accident', illegal_parking: 'Illegal Parking' };
    return map[type] || (type || 'Unknown').replace(/_/g, ' ');
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
      console.error('Fleet Intelligence: fetch failed', err);
      document.getElementById('fleet-category-body').innerHTML =
        '<tr><td colspan="4" class="ic-empty">Could not reach the backend API.</td></tr>';
    }
    loadHotspots();
  }

  async function loadHotspots() {
    const tbody = document.getElementById('fleet-hotspot-body');
    if (!tbody) return;
    try {
      const res = await fetch(CONFIG.HOTSPOTS_URL, { headers: CONFIG.HEADERS });
      if (res.status === 401) { logout(); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = await res.json();
      renderHotspots(rows);
    } catch (err) {
      console.error('Fleet Intelligence: hotspots fetch failed', err);
      tbody.innerHTML = '<tr><td colspan="6" class="ic-empty">Could not reach the backend API.</td></tr>';
    }
  }

  function renderHotspots(rows) {
    const tbody = document.getElementById('fleet-hotspot-body');
    if (!rows || !rows.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="ic-empty">No recurring hotspots yet — every location has only been reported once so far.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(r => `
      <tr class="ic-row">
        <td>${formatIssueType(r.type)}</td>
        <td>${Number(r.avg_lat).toFixed(4)}, ${Number(r.avg_lng).toFixed(4)}</td>
        <td><span class="fleet-hotspot-count">${r.occurrence_count}&times;</span></td>
        <td>${r.resolved_count} resolved / ${r.active_count} active</td>
        <td>${formatDate(r.first_seen_at)}</td>
        <td>${formatDate(r.last_seen_at)}</td>
      </tr>`).join('');
  }

  function formatDate(isoStr) {
    if (!isoStr) return '—';
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return isoStr;
      return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch (e) {
      return isoStr;
    }
  }

  function render(issues) {
    const totalIncidents = issues.length;
    const totalObservations = issues.reduce((s, i) => s + Number(i.detection_count || 1), 0);

    // The 06_dedup_upgrade.sql migration adds `confirming_vehicle_count`
    // (COUNT(DISTINCT vehicle_id)) to v_dashboard_issues. If it's present
    // on the response, real per-vehicle confirmation is live; if not, this
    // backend hasn't run that migration yet and we fall back to the old
    // "2+ AI observations" proxy rather than claiming something false.
    const hasVehicleData = issues.length > 0 && issues[0].confirming_vehicle_count !== undefined;
    const verified = hasVehicleData
      ? issues.filter(i => Number(i.confirming_vehicle_count || 0) >= 2).length
      : issues.filter(i => Number(i.detection_count || 1) >= 2).length;
    const reduction = totalObservations > 0
      ? Math.round(((totalObservations - totalIncidents) / totalObservations) * 100)
      : 0;

    document.getElementById('fleet-observations').textContent = totalObservations;
    document.getElementById('fleet-incidents').textContent = totalIncidents;
    document.getElementById('fleet-verified').textContent = verified;
    document.getElementById('fleet-reduction').textContent = `${reduction}%`;

    const noticeText = document.getElementById('fleet-notice-text');
    const noticeBox = document.getElementById('fleet-notice');
    if (noticeText) {
      if (hasVehicleData) {
        noticeText.innerHTML = 'Per-vehicle attribution is live — <strong>Multi-Vehicle Confirmed</strong> counts incidents seen by <code>COUNT(DISTINCT vehicle_id)</code> ≥ 2 reporting vehicles, not just repeated AI frames from one pass.';
        if (noticeBox) noticeBox.classList.add('fleet-notice-ok');
      } else {
        noticeText.innerHTML = 'Per-vehicle attribution needs the <code>vehicle_id</code> column from <code>database/06_dedup_upgrade.sql</code> — that migration hasn\'t run against this backend yet. Showing the AI-observation proxy instead.';
      }
    }

    const byCategory = {};
    issues.forEach(i => {
      const key = i.type || 'unknown';
      if (!byCategory[key]) byCategory[key] = { incidents: 0, observations: 0 };
      byCategory[key].incidents += 1;
      byCategory[key].observations += Number(i.detection_count || 1);
    });

    const rows = Object.entries(byCategory).sort((a, b) => b[1].observations - a[1].observations);
    const tbody = document.getElementById('fleet-category-body');
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="ic-empty">No incidents yet.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(([type, stats]) => `
      <tr class="ic-row">
        <td>${formatIssueType(type)}</td>
        <td>${stats.incidents}</td>
        <td>${stats.observations}</td>
        <td>${(stats.observations / stats.incidents).toFixed(1)}</td>
      </tr>`).join('');
  }

  document.addEventListener('DOMContentLoaded', load);
})();
