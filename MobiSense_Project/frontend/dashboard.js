/**
 * MobiSense - Municipal Incident Management Dashboard
 * Smart India Hackathon Internals
 * Clean Civic-Tech Interface Controller
 */

(function () {
  "use strict";

  // --- Auth guard: no token, no dashboard. ------------------------
  const AUTH_TOKEN = localStorage.getItem("mobisense_token");
  if (!AUTH_TOKEN) {
    window.location.href = "login.html";
    return;
  }
  const CURRENT_USER = JSON.parse(
    localStorage.getItem("mobisense_user") || "{}",
  );

  function logout() {
    localStorage.removeItem("mobisense_token");
    localStorage.removeItem("mobisense_user");
    window.location.href = "login.html";
  }
  window.MobiSense = window.MobiSense || {};
  window.MobiSense.logout = logout;

  // --- Configuration ---
  const CONFIG = {
    // Point this at your local FastAPI backend (see backend/main.py).
    API_URL: "http://localhost:8000/issues",
    HEADERS: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AUTH_TOKEN}`,
    },
    AUTO_REFRESH_INTERVAL_MS: 30000,
    DEFAULT_CENTER: [12.9716, 77.5946], // Bengaluru (Bangalore), Karnataka coordinates
    DEFAULT_ZOOM: 12,
  };

  // --- State ---
  const state = {
    issues: [],
    filterStatus: "all", // 'all' | 'unresolved' | 'resolved'
    filterType: "all", // 'all' | 'pothole' | 'heavy_traffic' | 'garbage'
    searchQuery: "",
    selectedIssueId: null,
    isFetching: false,
    map: null,
    gm: null, // Google Maps classes (Map, InfoWindow, ...) once loaded
    markers: [], // AdvancedMarkerElement instances currently on the map
    infoWindow: null, // ONE shared InfoWindow, re-used for every popup
    popupIssueId: null, // issue whose popup is open (survives marker rebuilds)
    heatOverlay: null, // deck.gl overlay that draws the heatmap
    heatmapOn: false,
    autoRefreshTimer: null,
    lastUpdated: null,
  };

  // Severity -> heat weight (0-1). Unknown/low severities still show up
  // faintly so the map isn't misleadingly empty, but critical issues
  // (accidents, heavy traffic, high-severity garbage/potholes) dominate
  // the gradient the way a real triage view should.
  const SEVERITY_WEIGHT = {
    critical: 1.0,
    severe: 1.0,
    major: 1.0,
    high: 0.85,
    heavy: 0.85,
    moderate: 0.55,
    medium: 0.55,
    low: 0.3,
  };

  function heatWeightOf(issue) {
    const typeKey = (issue.type || "").toLowerCase();
    if (typeKey.includes("accident")) return 1.0; // accidents always weigh max regardless of severity field
    const sev = String(
      issue.severity || issue.traffic_level || "",
    ).toLowerCase();
    return SEVERITY_WEIGHT[sev] !== undefined ? SEVERITY_WEIGHT[sev] : 0.4;
  }

  // --- SVG Icons Definition ---
  const ICONS = {
    pothole: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    parking: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 17V7h4a3 3 0 0 1 0 6H9"/></svg>`,
    garbage: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`,
    traffic: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.5 2.8C2.1 11 2 11.5 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></svg>`,
    accident: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/></svg>`,
    default: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    spinner: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`,
  };

  // --- DOM Elements Cache ---
  const DOM = {
    headerLiveSummary: document.getElementById("header-live-summary"),
    syncTimeLabel: document.getElementById("sync-time-label"),
    refreshBtn: document.getElementById("refresh-btn"),
    feedContainer: document.getElementById("incident-feed"),
    feedCountLabel: document.getElementById("feed-count-label"),
    tabBtns: document.querySelectorAll(".tab-btn"),
    typeBoxes: document.querySelectorAll(".stats-type-box"),
    resolutionRatePill: document.getElementById("resolution-rate-pill"),
    countPotholes: document.getElementById("count-potholes"),
    countTraffic: document.getElementById("count-traffic"),
    countGarbage: document.getElementById("count-garbage"),
    countAccidents: document.getElementById("count-accidents"),
    searchInput: document.getElementById("search-input"),
    clearSearchBtn: document.getElementById("clear-search-btn"),
    toastContainer: document.getElementById("toast-container"),
    fitBoundsBtn: document.getElementById("fit-bounds-btn"),
    heatmapToggleBtn: document.getElementById("heatmap-toggle-btn"),
    mapCenterCoords: document.getElementById("map-center-coords"),
    logoutBtn: document.getElementById("logout-btn"),
    profileMenuWrapper: document.getElementById("profile-menu-wrapper"),
    profileAvatarBtn: document.getElementById("profile-avatar-btn"),
    profileAvatarInitial: document.getElementById("profile-avatar-initial"),
    profileAvatarInitialLg: document.getElementById(
      "profile-avatar-initial-lg",
    ),
    profileDropdown: document.getElementById("profile-dropdown"),
    profileName: document.getElementById("profile-name"),
    profileRole: document.getElementById("profile-role"),
    profileEmail: document.getElementById("profile-email"),
    profileJobTitle: document.getElementById("profile-job-title"),
    profileGovtId: document.getElementById("profile-govt-id"),
    profileJoined: document.getElementById("profile-joined"),
  };

  // --- Profile avatar + dropdown ---
  function getInitial(name) {
    return (name || "?").trim().charAt(0).toUpperCase() || "?";
  }

  function toggleProfileDropdown(forceOpen) {
    if (!DOM.profileDropdown || !DOM.profileAvatarBtn) return;
    const isOpen = !DOM.profileDropdown.hidden;
    const nextOpen = forceOpen !== undefined ? forceOpen : !isOpen;
    DOM.profileDropdown.hidden = !nextOpen;
    DOM.profileAvatarBtn.setAttribute("aria-expanded", String(nextOpen));
  }

  async function loadProfile() {
    // Show what we already know instantly (from login/signup response),
    // then fill in the rest once /users/me responds.
    const initial = getInitial(CURRENT_USER.full_name);
    if (DOM.profileAvatarInitial)
      DOM.profileAvatarInitial.textContent = initial;
    if (DOM.profileAvatarInitialLg)
      DOM.profileAvatarInitialLg.textContent = initial;
    if (DOM.profileName)
      DOM.profileName.textContent = CURRENT_USER.full_name || "Account";
    if (DOM.profileRole) DOM.profileRole.textContent = CURRENT_USER.role || "—";

    try {
      const res = await fetch(
        `${CONFIG.API_URL.replace("/issues", "")}/users/me`,
        {
          headers: CONFIG.HEADERS,
        },
      );
      if (res.status === 401) {
        logout();
        return;
      }
      if (!res.ok) return;
      const profile = await res.json();

      if (DOM.profileName)
        DOM.profileName.textContent = profile.full_name || "—";
      if (DOM.profileRole) DOM.profileRole.textContent = profile.role || "—";
      if (DOM.profileEmail) DOM.profileEmail.textContent = profile.email || "—";
      if (DOM.profileJobTitle)
        DOM.profileJobTitle.textContent = profile.job_title || "—";
      if (DOM.profileGovtId)
        DOM.profileGovtId.textContent = profile.govt_id_number || "—";
      if (DOM.profileJoined && profile.created_at) {
        DOM.profileJoined.textContent = new Date(
          profile.created_at,
        ).toLocaleDateString();
      }
      const initialFromServer = getInitial(profile.full_name);
      if (DOM.profileAvatarInitial)
        DOM.profileAvatarInitial.textContent = initialFromServer;
      if (DOM.profileAvatarInitialLg)
        DOM.profileAvatarInitialLg.textContent = initialFromServer;
    } catch (err) {
      // Silent fail is fine here — the header still shows what we had
      // from login, just without the extra fields.
    }
  }

  // --- Initialization ---
  document.addEventListener("DOMContentLoaded", () => {
    loadProfile();
    if (DOM.profileAvatarBtn) {
      DOM.profileAvatarBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleProfileDropdown();
      });
    }
    document.addEventListener("click", (e) => {
      if (
        DOM.profileMenuWrapper &&
        !DOM.profileMenuWrapper.contains(e.target)
      ) {
        toggleProfileDropdown(false);
      }
    });
    if (DOM.logoutBtn) {
      DOM.logoutBtn.addEventListener("click", logout);
    }
    bindEvents();
    fetchIssues();
    startAutoRefresh();

    // Google Maps loads asynchronously. The feed/stats don't wait for it;
    // once the map is ready we draw whatever issues have arrived by then.
    initMap().then(() => {
      if (!state.map) return; // key missing / offline: feed still works
      if (state.selectedIssueId) selectIssue(state.selectedIssueId, true);
      else updateMapMarkers();
    });
  });

  // ==========================================================================
  // Map Initialization & Management (Google Maps)
  // ==========================================================================
  async function initMap() {
    const mapEl = document.getElementById("map-container");
    if (!mapEl) return;

    try {
      state.gm = await window.MobiMaps.load();
    } catch (err) {
      console.warn("Google Maps not available:", err.message);
      mapEl.innerHTML = `
        <div style="height: 100%; display: flex; align-items: center; justify-content: center; background: #e2e8f0; color: #475569; font-weight: 500; text-align: center; padding: 16px;">
          Map unavailable · ${escapeHtml(err.message)}
        </div>
      `;
      return;
    }

    const { Map, InfoWindow } = state.gm;

    state.map = new Map(mapEl, {
      center: { lat: CONFIG.DEFAULT_CENTER[0], lng: CONFIG.DEFAULT_CENTER[1] },
      zoom: CONFIG.DEFAULT_ZOOM,
      mapId: window.MobiMaps.mapId, // required for Advanced Markers
      zoomControl: true,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false, // top-right is taken by our own map buttons
      clickableIcons: false, // don't open Google's own POI popups
    });

    state.infoWindow = new InfoWindow();

    // Clicking empty map closes the popup (same as Leaflet did).
    state.map.addListener("click", () => {
      state.infoWindow.close();
      state.popupIssueId = null;
    });

    // Coordinate display listener
    state.map.addListener("center_changed", () => {
      const center = state.map.getCenter();
      if (DOM.mapCenterCoords && center) {
        DOM.mapCenterCoords.textContent = `${center.lat().toFixed(4)}°N, ${center.lng().toFixed(4)}°E`;
      }
    });
  }

  // Google's fitBounds() has no maxZoom option (Leaflet's did), so we
  // clamp the zoom ourselves once the map has settled.
  function fitToBounds(bounds, padding, maxZoom) {
    state.map.fitBounds(bounds, padding);
    if (maxZoom) {
      state.gm.event.addListenerOnce(state.map, "idle", () => {
        if (state.map.getZoom() > maxZoom) state.map.setZoom(maxZoom);
      });
    }
  }

  function openIssuePopup(marker, contentEl) {
    state.infoWindow.setContent(contentEl);
    state.infoWindow.open({ anchor: marker, map: state.map });
  }

  // Render Map Markers based on current issues
  function updateMapMarkers() {
    if (!state.map || !state.gm) return;
    const { AdvancedMarkerElement, LatLngBounds } = state.gm;

    // Remove the previous markers (map = null takes a marker off the map).
    // The popup is closed here and re-opened below if it belongs to a marker
    // that still exists — otherwise a 30s auto-refresh would kill it.
    state.infoWindow.close();
    state.markers.forEach((m) => (m.map = null));
    state.markers = [];

    const bounds = new LatLngBounds();
    let hasValidPoints = false;

    const filtered = getFilteredIssues();

    filtered.forEach((issue) => {
      // Prefer the running centroid (v_dashboard_issues.centroid_lat/lng) so
      // an issue merged from several slightly-offset GPS fixes plots as ONE
      // marker at its average position, not frozen at the first detection.
      const lat = parseFloat(issue.centroid_lat ?? issue.lat);
      const lng = parseFloat(issue.centroid_lng ?? issue.lng);

      if (isNaN(lat) || isNaN(lng)) return;

      const isResolved =
        issue.status && issue.status.toLowerCase() === "resolved";
      const isSelected = state.selectedIssueId === issue.id;

      // Determine icon & styling
      const typeKey = (issue.type || "").toLowerCase();
      let iconSvg = ICONS.pothole;
      let pinTypeClass = "type-pothole";
      if (typeKey.includes("accident")) {
        iconSvg = ICONS.accident;
        pinTypeClass = "type-accident";
      } else if (typeKey.includes("park")) {
        iconSvg = ICONS.parking;
        pinTypeClass = "type-parking";
      } else if (
        typeKey.includes("garb") ||
        typeKey.includes("trash") ||
        typeKey.includes("waste")
      ) {
        iconSvg = ICONS.garbage;
        pinTypeClass = "type-garbage";
      } else if (typeKey.includes("traffic")) {
        iconSvg = ICONS.traffic;
        pinTypeClass = "type-traffic";
      }
      if (isResolved) iconSvg = ICONS.check;

      const iconHtml = `
        <div class="custom-map-pin ${isResolved ? "resolved" : "unresolved"} ${pinTypeClass} ${isSelected ? "is-active" : ""} ${!isResolved && pinTypeClass === "type-accident" ? "pin-critical-pulse" : ""}" data-id="${issue.id}">
          ${iconSvg}
        </div>
      `;

      // Advanced Markers anchor the BOTTOM-centre of their content on the
      // coordinate. translateY(50%) moves the round 30px pin so its CENTRE
      // sits on the coordinate (same as Leaflet's iconAnchor [15, 15]).
      // The wrapper carries the shift so .is-active can still use transform.
      const pinWrap = document.createElement("div");
      pinWrap.style.transform = "translateY(50%)";
      pinWrap.innerHTML = iconHtml.trim();

      const marker = new AdvancedMarkerElement({
        map: state.map,
        position: { lat, lng },
        content: pinWrap,
        title: formatIssueType(issue.type),
        gmpClickable: true,
        zIndex: isSelected ? 999 : 1,
      });

      // Popup Content
      let telemetryPopupHtml = "";
      if (issue.vehicle_count !== undefined || issue.traffic_level) {
        telemetryPopupHtml = `
          <div style="font-size: 11px; color: #1d4ed8; font-weight: 600; margin-bottom: 6px; background: #eff6ff; padding: 2px 6px; border-radius: 4px; border: 1px solid #dbeafe;">
            ${issue.vehicle_count !== undefined ? `${issue.vehicle_count} vehicles` : ""}${issue.vehicle_count !== undefined && issue.traffic_level ? " · " : ""}${escapeHtml(issue.traffic_level || "")}
          </div>
        `;
      } else if (issue.item_count !== undefined || issue.severity) {
        telemetryPopupHtml = `
          <div style="font-size: 11px; color: #6d28d9; font-weight: 600; margin-bottom: 6px; background: #f5f3ff; padding: 2px 6px; border-radius: 4px; border: 1px solid #ddd6fe;">
            ${formatGarbageTelemetry(issue.item_count, issue.severity)}
          </div>
        `;
      }

      const popupHtml = `
        <div style="font-family: 'Inter', sans-serif;">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 4px;">
            <strong style="text-transform: capitalize; color: #1f2937; font-size: 13px;">${escapeHtml(formatIssueType(issue.type))}</strong>
            <span style="font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 9999px; background: ${isResolved ? "#dcfce7" : "#fef3c7"}; color: ${isResolved ? "#15803d" : "#b45309"};">${isResolved ? "Resolved" : "Unresolved"}</span>
          </div>
          ${telemetryPopupHtml}
          <div style="font-size: 11px; color: #64748b; margin-bottom: 4px;">
            ${lat.toFixed(5)}, ${lng.toFixed(5)}
          </div>
          <div style="font-size: 11px; color: #64748b; margin-bottom: 8px;">
            ${formatTime(issue.timestamp)}
          </div>
          ${
            !isResolved
              ? `
            <button onclick="window.MobiSense.resolveIssue('${issue.id}')" style="width: 100%; padding: 5px 8px; background: #3d5a4c; color: #fff; font-size: 11px; font-weight: 600; border-radius: 4px; border: none; cursor: pointer;">
              Mark as Resolved
            </button>
          `
              : ""
          }
        </div>
      `;

      const popupEl = document.createElement("div");
      popupEl.innerHTML = popupHtml;

      marker.addEventListener("gmp-click", () => {
        state.popupIssueId = String(issue.id);
        openIssuePopup(marker, popupEl);
        selectIssue(issue.id, false);
      });

      // selectIssue() above rebuilds every marker, so re-open the popup on
      // the freshly created marker for the issue the user clicked.
      if (state.popupIssueId === String(issue.id)) {
        openIssuePopup(marker, popupEl);
      }

      state.markers.push(marker);
      bounds.extend({ lat, lng });
      hasValidPoints = true;
    });

    if (hasValidPoints && !state.selectedIssueId) {
      fitToBounds(bounds, 40, 16);
    }

    updateHeatmap();
  }

  // ==========================================================================
  // Severity Heatmap Layer (toggle button, top-right map overlay)
  // ==========================================================================
  function updateHeatmap() {
    if (!state.map) return;

    // Google REMOVED its own HeatmapLayer in Maps JS v3.65 (May 2026).
    // Google's recommended replacement is deck.gl, drawn as an overlay
    // on top of the Google map (script tag is in dashboard.html).
    if (typeof deck === "undefined" || !deck.GoogleMapsOverlay) {
      if (state.heatmapOn) console.warn("deck.gl not loaded — heatmap unavailable.");
      return;
    }

    // Heatmap always reflects UNRESOLVED issues only — a resolved pothole
    // shouldn't still glow red on a "where's the danger right now" view.
    const points = getFilteredIssues()
      .filter((issue) => (issue.status || "").toLowerCase() !== "resolved")
      .map((issue) => {
        const lat = parseFloat(issue.centroid_lat ?? issue.lat);
        const lng = parseFloat(issue.centroid_lng ?? issue.lng);
        if (isNaN(lat) || isNaN(lng)) return null;
        return { position: [lng, lat], weight: heatWeightOf(issue) }; // deck.gl wants [lng, lat]
      })
      .filter(Boolean);

    if (!state.heatOverlay) {
      state.heatOverlay = new deck.GoogleMapsOverlay({ layers: [] });
      state.heatOverlay.setMap(state.map);
    }

    state.heatOverlay.setProps({
      layers:
        state.heatmapOn && points.length
          ? [
              new deck.HeatmapLayer({
                id: "severity-heatmap",
                data: points,
                getPosition: (d) => d.position,
                getWeight: (d) => d.weight,
                aggregation: "SUM",
                radiusPixels: 50,
                intensity: 1,
                threshold: 0.05,
                // same green -> amber -> red scale the Leaflet heatmap used
                colorRange: [
                  [34, 197, 94, 60],
                  [34, 197, 94, 140],
                  [245, 158, 11, 180],
                  [239, 68, 68, 210],
                  [185, 28, 28, 235],
                  [153, 27, 27, 255],
                ],
              }),
            ]
          : [],
    });
  }

  function toggleHeatmap() {
    state.heatmapOn = !state.heatmapOn;
    if (DOM.heatmapToggleBtn) {
      DOM.heatmapToggleBtn.classList.toggle("is-active", state.heatmapOn);
    }
    // Markers stay visible under the heat layer; only the heat overlay
    // itself toggles, so users can still click through to resolve issues.
    updateHeatmap();
  }

  // ==========================================================================
  // API Fetch & PATCH Operations
  // ==========================================================================
  async function fetchIssues() {
    if (state.isFetching) return;
    state.isFetching = true;

    if (DOM.refreshBtn) {
      DOM.refreshBtn.classList.add("is-refreshing");
    }

    try {
      const response = await fetch(CONFIG.API_URL, {
        method: "GET",
        headers: CONFIG.HEADERS,
      });

      if (response.status === 401) {
        logout(); // session expired or invalid — send back to login
        return;
      }
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }

      const data = await response.json();

      if (Array.isArray(data)) {
        state.issues = data;
      } else if (data && Array.isArray(data.issues)) {
        state.issues = data.issues;
      } else {
        console.warn("Unexpected API payload structure:", data);
      }

      state.lastUpdated = new Date();
      updateSyncTimeDisplay();
      renderDashboard();

      // Deep-link support: Command Center / Incidents / Fleet pages link
      // here as dashboard.html?focus=<id> to jump straight to an incident.
      if (!state.hasAppliedFocusParam) {
        state.hasAppliedFocusParam = true;
        const focusId = new URLSearchParams(window.location.search).get(
          "focus",
        );
        if (focusId) selectIssue(focusId, true);
      }
    } catch (error) {
      console.error("Error fetching MobiSense issues:", error);
      showToast(
        "Could not sync with live API. Retaining current data.",
        "error",
      );
    } finally {
      state.isFetching = false;
      if (DOM.refreshBtn) {
        DOM.refreshBtn.classList.remove("is-refreshing");
      }
    }
  }

  async function resolveIssue(issueId) {
    if (!issueId) return;

    // Find issue locally
    const issue = state.issues.find((i) => String(i.id) === String(issueId));
    if (!issue) return;

    // Optimistic UI state
    const originalStatus = issue.status;
    issue.status = "resolved";
    renderDashboard();

    // Visual button loading state if rendered
    const cardBtn = document.querySelector(
      `.btn-resolve[data-id="${issueId}"]`,
    );
    if (cardBtn) {
      cardBtn.classList.add("is-loading");
      cardBtn.innerHTML = `${ICONS.spinner} Updating...`;
    }

    try {
      // Execute PATCH call to API endpoint
      const patchUrl = `${CONFIG.API_URL}/${issueId}`;
      const response = await fetch(patchUrl, {
        method: "PATCH",
        headers: CONFIG.HEADERS,
        body: JSON.stringify({ status: "resolved" }),
      });

      if (!response.ok && response.status !== 404 && response.status !== 405) {
        // Try fallback query or alternate structure if needed
        console.warn("PATCH request returned non-200 status:", response.status);
      }

      showToast(`Incident #${issueId} marked as resolved`, "success");

      // Refresh data from API to ensure full sync
      await fetchIssues();
    } catch (error) {
      console.warn(
        "Network issue during PATCH, keeping optimistic update:",
        error,
      );
      showToast(`Incident #${issueId} status updated locally`, "success");
      renderDashboard();
    }
  }

  // ==========================================================================
  // Filtering & Data Selectors
  // ==========================================================================
  function getFilteredIssues() {
    return state.issues.filter((issue) => {
      const isResolved =
        issue.status && issue.status.toLowerCase() === "resolved";

      // Status filter
      if (state.filterStatus === "unresolved" && isResolved) return false;
      if (state.filterStatus === "resolved" && !isResolved) return false;

      // Type filter
      if (state.filterType !== "all") {
        const typeStr = (issue.type || "").toLowerCase();
        if (state.filterType === "pothole" && !typeStr.includes("pothole"))
          return false;
        if (state.filterType === "illegal_parking" && !typeStr.includes("park"))
          return false;
        if (
          state.filterType === "garbage" &&
          !typeStr.includes("garb") &&
          !typeStr.includes("trash") &&
          !typeStr.includes("waste")
        )
          return false;
        if (
          (state.filterType === "heavy_traffic" ||
            state.filterType === "traffic") &&
          !typeStr.includes("traffic")
        )
          return false;
        if (state.filterType === "accident" && !typeStr.includes("accident"))
          return false;
      }

      // Search Query filter (matches type, id, lat, lng, vehicle_count, traffic_level, item_count, severity)
      if (state.searchQuery.trim()) {
        const query = state.searchQuery.toLowerCase().trim();
        const matchesType = (issue.type || "").toLowerCase().includes(query);
        const matchesId = String(issue.id || "")
          .toLowerCase()
          .includes(query);
        const matchesLat = String(issue.lat || "").includes(query);
        const matchesLng = String(issue.lng || "").includes(query);
        const matchesVehicles =
          issue.vehicle_count !== undefined &&
          String(issue.vehicle_count).includes(query);
        const matchesTrafficLevel =
          issue.traffic_level &&
          String(issue.traffic_level).toLowerCase().includes(query);
        const matchesItemCount =
          issue.item_count !== undefined &&
          String(issue.item_count).includes(query);
        const matchesSeverity =
          issue.severity &&
          String(issue.severity).toLowerCase().includes(query);

        if (
          !matchesType &&
          !matchesId &&
          !matchesLat &&
          !matchesLng &&
          !matchesVehicles &&
          !matchesTrafficLevel &&
          !matchesItemCount &&
          !matchesSeverity
        ) {
          return false;
        }
      }

      return true;
    });
  }

  // ==========================================================================
  // Rendering Views & UI Components
  // ==========================================================================
  function renderDashboard() {
    renderStats();
    renderFeed();
    updateMapMarkers();
  }

  // Render Stats & Summary Bar
  function renderStats() {
    const total = state.issues.length;
    const resolved = state.issues.filter(
      (i) => (i.status || "").toLowerCase() === "resolved",
    ).length;
    const unresolved = total - resolved;

    // Header summary badge
    if (DOM.headerLiveSummary) {
      DOM.headerLiveSummary.innerHTML = `
        <span class="pulse-indicator">
          <span class="pulse-ring"></span>
          <span class="pulse-dot"></span>
        </span>
        <span class="summary-stats-text">
          <strong>${total}</strong> issues detected · <strong>${resolved}</strong> resolved
        </span>
      `;
    }

    // Tab badges
    const tabAllBadge = document.getElementById("badge-tab-all");
    const tabUnresolvedBadge = document.getElementById("badge-tab-unresolved");
    const tabResolvedBadge = document.getElementById("badge-tab-resolved");

    if (tabAllBadge) tabAllBadge.textContent = total;
    if (tabUnresolvedBadge) tabUnresolvedBadge.textContent = unresolved;
    if (tabResolvedBadge) tabResolvedBadge.textContent = resolved;

    // Type counts
    let potholes = 0;
    let traffic = 0;
    let garbage = 0;
    let accidents = 0;

    state.issues.forEach((i) => {
      const t = (i.type || "").toLowerCase();
      if (t.includes("accident")) accidents++;
      else if (t.includes("pothole")) potholes++;
      else if (t.includes("traffic")) traffic++;
      else if (t.includes("garb") || t.includes("trash") || t.includes("waste"))
        garbage++;
    });

    if (DOM.countPotholes) DOM.countPotholes.textContent = potholes;
    if (DOM.countTraffic) DOM.countTraffic.textContent = traffic;
    if (DOM.countGarbage) DOM.countGarbage.textContent = garbage;
    if (DOM.countAccidents) DOM.countAccidents.textContent = accidents;

    // Resolution rate
    const ratePercent = total > 0 ? Math.round((resolved / total) * 100) : 0;
    if (DOM.resolutionRatePill) {
      DOM.resolutionRatePill.textContent = `${ratePercent}% Resolved`;
    }
  }

  // Render Incident Feed Cards
  function renderFeed() {
    if (!DOM.feedContainer) return;

    const filtered = getFilteredIssues();

    if (DOM.feedCountLabel) {
      DOM.feedCountLabel.innerHTML = `Showing <strong>${filtered.length}</strong> of <strong>${state.issues.length}</strong> incidents`;
    }

    if (filtered.length === 0) {
      DOM.feedContainer.innerHTML = `
        <div class="empty-state-card">
          ${ICONS.default}
          <div class="empty-state-title">No incidents match criteria</div>
          <div class="empty-state-desc">Try clearing the search query or switching the status filter tab.</div>
        </div>
      `;
      return;
    }

    let html = "";

    filtered.forEach((issue) => {
      const isResolved = (issue.status || "").toLowerCase() === "resolved";
      const isSelected = state.selectedIssueId === issue.id;
      const typeKey = (issue.type || "pothole").toLowerCase();

      let typeClass = "type-pothole";
      let typeIcon = ICONS.pothole;
      if (typeKey.includes("accident")) {
        typeClass = "type-accident";
        typeIcon = ICONS.accident;
      } else if (typeKey.includes("park")) {
        typeClass = "type-illegal_parking";
        typeIcon = ICONS.parking;
      } else if (
        typeKey.includes("garb") ||
        typeKey.includes("trash") ||
        typeKey.includes("waste")
      ) {
        typeClass = "type-garbage";
        typeIcon = ICONS.garbage;
      } else if (typeKey.includes("traffic")) {
        typeClass = "type-heavy_traffic";
        typeIcon = ICONS.traffic;
      }

      const formattedType = formatIssueType(issue.type);
      const lat = parseFloat(issue.lat) || 0;
      const lng = parseFloat(issue.lng) || 0;
      const coordsText = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

      html += `
        <div class="issue-card ${isResolved ? "is-resolved" : ""} ${isSelected ? "is-selected" : ""}" 
             data-id="${issue.id}" 
             id="card-${issue.id}">
          
          <div class="card-header-row">
            <div class="card-title-group">
              <span class="type-pill ${typeClass}">
                ${typeIcon}
                ${escapeHtml(formattedType)}
              </span>
              <span class="issue-id-label">#${escapeHtml(issue.id || "N/A")}</span>
            </div>
            
            <span class="status-badge ${isResolved ? "resolved" : "unresolved"}">
              ${isResolved ? "Resolved" : "Unresolved"}
            </span>
          </div>

          <div class="card-details-grid">
            ${
              issue.vehicle_count !== undefined || issue.traffic_level
                ? `
              <div class="card-detail-item">
                <div class="detail-label-wrap">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.5 2.8C2.1 11 2 11.5 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></svg>
                  <span>Telemetry</span>
                </div>
                <span class="traffic-metric-badge">
                  ${issue.vehicle_count !== undefined ? `${issue.vehicle_count} vehicles detected` : ""}${issue.vehicle_count !== undefined && issue.traffic_level ? " · " : ""}${issue.traffic_level ? escapeHtml(issue.traffic_level) : ""}
                </span>
              </div>
            `
                : ""
            }

            ${
              issue.item_count !== undefined || issue.severity
                ? `
              <div class="card-detail-item">
                <div class="detail-label-wrap">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                  <span>Telemetry</span>
                </div>
                <span class="garbage-metric-badge">
                  ${formatGarbageTelemetry(issue.item_count, issue.severity)}
                </span>
              </div>
            `
                : ""
            }

            <div class="card-detail-item">
              <div class="detail-label-wrap">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                <span>Coordinates</span>
              </div>
              <div class="coords-tag">
                <span>${coordsText}</span>
                <button class="copy-coord-btn" title="Copy coordinates" onclick="event.stopPropagation(); window.MobiSense.copyCoordinates('${coordsText}')">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                </button>
              </div>
            </div>

            <div class="card-detail-item">
              <div class="detail-label-wrap">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                <span>Timestamp</span>
              </div>
              <span class="detail-value time-val" title="${escapeHtml(issue.timestamp || "")}">
                ${formatRelativeTime(issue.timestamp)}
              </span>
            </div>
          </div>

          <div class="card-actions-row">
            <button class="btn-view-map" onclick="event.stopPropagation(); window.MobiSense.focusOnMap('${issue.id}', ${lat}, ${lng})">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              View on Map
            </button>

            ${
              !isResolved
                ? `
              <button class="btn-resolve" data-id="${issue.id}" onclick="event.stopPropagation(); window.MobiSense.resolveIssue('${issue.id}')">
                ${ICONS.check}
                Mark as Resolved
              </button>
            `
                : `
              <span class="resolved-indicator-tag">
                ${ICONS.check}
                Completed
              </span>
            `
            }
          </div>

        </div>
      `;
    });

    DOM.feedContainer.innerHTML = html;

    // Attach card click handlers for cross-highlighting
    DOM.feedContainer.querySelectorAll(".issue-card").forEach((card) => {
      card.addEventListener("click", () => {
        const id = card.getAttribute("data-id");
        selectIssue(id, true);
      });
    });
  }

  // ==========================================================================
  // Interactions & State Transitions
  // ==========================================================================
  function selectIssue(id, zoomMap = true) {
    state.selectedIssueId = id;
    // Picked from the list (not by clicking a pin): no map popup.
    if (zoomMap) state.popupIssueId = null;

    // Highlight card in feed
    document.querySelectorAll(".issue-card").forEach((card) => {
      if (card.getAttribute("data-id") === String(id)) {
        card.classList.add("is-selected");
        card.scrollIntoView({ behavior: "smooth", block: "nearest" });
      } else {
        card.classList.remove("is-selected");
      }
    });

    // Highlight map marker & center
    const issue = state.issues.find((i) => String(i.id) === String(id));
    if (issue && state.map && zoomMap) {
      const lat = parseFloat(issue.lat);
      const lng = parseFloat(issue.lng);
      if (!isNaN(lat) && !isNaN(lng)) {
        state.map.panTo({ lat, lng });
        state.map.setZoom(16);
      }
    }

    updateMapMarkers();
  }

  function focusOnMap(id, lat, lng) {
    selectIssue(id, true);
    if (state.map && !isNaN(lat) && !isNaN(lng)) {
      state.map.panTo({ lat, lng });
      state.map.setZoom(17);
    }
  }

  function fitAllBounds() {
    if (!state.map || !state.gm) return;
    const filtered = getFilteredIssues();
    const bounds = new state.gm.LatLngBounds();
    let hasPoints = false;

    filtered.forEach((i) => {
      const lat = parseFloat(i.lat);
      const lng = parseFloat(i.lng);
      if (!isNaN(lat) && !isNaN(lng)) {
        bounds.extend({ lat, lng });
        hasPoints = true;
      }
    });

    if (hasPoints) {
      fitToBounds(bounds, 50);
    } else {
      state.map.setCenter({
        lat: CONFIG.DEFAULT_CENTER[0],
        lng: CONFIG.DEFAULT_CENTER[1],
      });
      state.map.setZoom(CONFIG.DEFAULT_ZOOM);
    }
  }

  function copyCoordinates(text) {
    if (navigator.clipboard) {
      navigator.clipboard
        .writeText(text)
        .then(() => {
          showToast(`Copied ${text} to clipboard`, "success");
        })
        .catch(() => {
          fallbackCopyText(text);
        });
    } else {
      fallbackCopyText(text);
    }
  }

  function fallbackCopyText(text) {
    const input = document.createElement("textarea");
    input.value = text;
    document.body.appendChild(input);
    input.select();
    document.execCommand("copy");
    document.body.removeChild(input);
    showToast(`Copied ${text} to clipboard`, "success");
  }

  // ==========================================================================
  // Event Listeners Binding
  // ==========================================================================
  function bindEvents() {
    // Manual refresh button
    if (DOM.refreshBtn) {
      DOM.refreshBtn.addEventListener("click", () => {
        fetchIssues();
      });
    }

    // Status filter tabs
    DOM.tabBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        DOM.tabBtns.forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        state.filterStatus = btn.getAttribute("data-status") || "all";
        renderFeed();
        updateMapMarkers();
      });
    });

    // Category type filter boxes
    DOM.typeBoxes.forEach((box) => {
      box.addEventListener("click", () => {
        const targetType = box.getAttribute("data-type");
        if (state.filterType === targetType) {
          state.filterType = "all";
          DOM.typeBoxes.forEach((b) => b.classList.remove("is-selected"));
        } else {
          state.filterType = targetType;
          DOM.typeBoxes.forEach((b) => b.classList.remove("is-selected"));
          box.classList.add("is-selected");
        }
        renderFeed();
        updateMapMarkers();
      });
    });

    // Search input
    if (DOM.searchInput) {
      DOM.searchInput.addEventListener("input", (e) => {
        state.searchQuery = e.target.value;
        if (DOM.clearSearchBtn) {
          DOM.clearSearchBtn.classList.toggle(
            "is-visible",
            Boolean(state.searchQuery),
          );
        }
        renderFeed();
        updateMapMarkers();
      });
    }

    // Clear search
    if (DOM.clearSearchBtn) {
      DOM.clearSearchBtn.addEventListener("click", () => {
        DOM.searchInput.value = "";
        state.searchQuery = "";
        DOM.clearSearchBtn.classList.remove("is-visible");
        renderFeed();
        updateMapMarkers();
      });
    }

    // Fit bounds button
    if (DOM.fitBoundsBtn) {
      DOM.fitBoundsBtn.addEventListener("click", fitAllBounds);
    }

    // Severity heatmap toggle
    if (DOM.heatmapToggleBtn) {
      DOM.heatmapToggleBtn.addEventListener("click", toggleHeatmap);
    }
  }

  // Auto-refresh interval
  function startAutoRefresh() {
    if (state.autoRefreshTimer) clearInterval(state.autoRefreshTimer);
    state.autoRefreshTimer = setInterval(() => {
      fetchIssues();
    }, CONFIG.AUTO_REFRESH_INTERVAL_MS);
  }

  // ==========================================================================
  // Helper Utilities
  // ==========================================================================
  function formatIssueType(type) {
    if (!type) return "Road Incident";
    return String(type)
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function formatGarbageTelemetry(itemCount, severity) {
    const parts = [];
    if (itemCount !== undefined && itemCount !== null && itemCount !== "") {
      const count = Number(itemCount);
      if (!isNaN(count)) {
        parts.push(`${count} item${count === 1 ? "" : "s"} detected`);
      } else {
        parts.push(`${itemCount} items detected`);
      }
    }
    if (severity) {
      const sevStr = String(severity).trim();
      const capitalized =
        sevStr.charAt(0).toUpperCase() + sevStr.slice(1).toLowerCase();
      parts.push(`${capitalized} severity`);
    }
    return parts.map(escapeHtml).join(" · ");
  }

  function formatTime(isoStr) {
    if (!isoStr) return "Recent";
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return isoStr;
      return d.toLocaleString("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
      });
    } catch (e) {
      return isoStr;
    }
  }

  function formatRelativeTime(isoStr) {
    if (!isoStr) return "Just now";
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return isoStr;
      const diffMs = Date.now() - d.getTime();
      const diffMins = Math.floor(diffMs / 60000);

      if (diffMins < 1) return "Just now";
      if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? "s" : ""} ago`;
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24)
        return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
      const diffDays = Math.floor(diffHours / 24);
      return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
    } catch (e) {
      return "Recent";
    }
  }

  function updateSyncTimeDisplay() {
    if (!DOM.syncTimeLabel) return;
    const now = new Date();
    DOM.syncTimeLabel.textContent = `Synced ${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function showToast(message, type = "success") {
    if (!DOM.toastContainer) return;

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    const icon = type === "success" ? ICONS.check : ICONS.default;

    toast.innerHTML = `
      ${icon}
      <span>${escapeHtml(message)}</span>
    `;

    DOM.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(10px)";
      toast.style.transition = "all 0.2s ease";
      setTimeout(() => toast.remove(), 200);
    }, 3200);
  }

  // Expose global controller for inline onclick attributes
  window.MobiSense = {
    resolveIssue,
    focusOnMap,
    copyCoordinates,
    refresh: fetchIssues,
  };
})();
