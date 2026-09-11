/**
 * MobiSense - Video Feed & Synced Issue Detection Controller
 * Clean Civic-Tech Architecture
 */

(function () {
  'use strict';

  // --- Auth guard: same rule as every other Command Center page. ---
  if (!localStorage.getItem('mobisense_token')) {
    window.location.href = 'login.html';
    return;
  }

  // --- Embedded Fallback Datasets (Ensures offline/local file:// zero-config operation) ---
  const DATA_FALLBACKS = {
    pothole: [
      { id: "video_issue_001", type: "pothole", confidence: 0.892, frame_number: 30, timestamp_in_video: 1.0 },
      { id: "video_issue_002", type: "pothole", confidence: 0.764, frame_number: 75, timestamp_in_video: 2.5 },
      { id: "video_issue_003", type: "pothole", confidence: 0.941, frame_number: 120, timestamp_in_video: 4.0 },
      { id: "video_issue_004", type: "pothole", confidence: 0.815, frame_number: 195, timestamp_in_video: 6.5 },
      { id: "video_issue_005", type: "pothole", confidence: 0.688, frame_number: 270, timestamp_in_video: 9.0 },
      { id: "video_issue_006", type: "pothole", confidence: 0.913, frame_number: 345, timestamp_in_video: 11.5 },
      { id: "video_issue_007", type: "pothole", confidence: 0.854, frame_number: 420, timestamp_in_video: 14.0 },
      { id: "video_issue_008", type: "pothole", confidence: 0.792, frame_number: 510, timestamp_in_video: 17.0 },
      { id: "video_issue_009", type: "pothole", confidence: 0.957, frame_number: 585, timestamp_in_video: 19.5 },
      { id: "video_issue_010", type: "pothole", confidence: 0.723, frame_number: 660, timestamp_in_video: 22.0 }
    ],
    traffic: [
      { id: "traffic_issue_001", type: "heavy_traffic", vehicle_count: 8, traffic_level: "Moderate Traffic", confidence: 0.88, frame_number: 45, timestamp_in_video: 1.5 },
      { id: "traffic_issue_002", type: "heavy_traffic", vehicle_count: 14, traffic_level: "Heavy Congestion", confidence: 0.94, frame_number: 105, timestamp_in_video: 3.5 },
      { id: "traffic_issue_003", type: "heavy_traffic", vehicle_count: 22, traffic_level: "Severe Bottleneck", confidence: 0.96, frame_number: 180, timestamp_in_video: 6.0 },
      { id: "traffic_issue_004", type: "heavy_traffic", vehicle_count: 17, traffic_level: "Heavy Congestion", confidence: 0.91, frame_number: 255, timestamp_in_video: 8.5 },
      { id: "traffic_issue_005", type: "heavy_traffic", vehicle_count: 11, traffic_level: "Moderate Traffic", confidence: 0.85, frame_number: 360, timestamp_in_video: 12.0 },
      { id: "traffic_issue_006", type: "heavy_traffic", vehicle_count: 25, traffic_level: "Gridlock Alert", confidence: 0.98, frame_number: 480, timestamp_in_video: 16.0 },
      { id: "traffic_issue_007", type: "heavy_traffic", vehicle_count: 19, traffic_level: "Heavy Congestion", confidence: 0.93, frame_number: 600, timestamp_in_video: 20.0 }
    ],
    garbage: [
      { id: "garbage_issue_001", type: "garbage", item_count: 3, severity: "low", confidence: 0.82, frame_number: 30, timestamp_in_video: 1.0 },
      { id: "garbage_issue_002", type: "garbage", item_count: 9, severity: "medium", confidence: 0.89, frame_number: 120, timestamp_in_video: 4.0 },
      { id: "garbage_issue_003", type: "garbage", item_count: 18, severity: "high", confidence: 0.95, frame_number: 210, timestamp_in_video: 7.0 },
      { id: "garbage_issue_004", type: "garbage", item_count: 6, severity: "low", confidence: 0.78, frame_number: 315, timestamp_in_video: 10.5 },
      { id: "garbage_issue_005", type: "garbage", item_count: 14, severity: "high", confidence: 0.92, frame_number: 420, timestamp_in_video: 14.0 },
      { id: "garbage_issue_006", type: "garbage", item_count: 8, severity: "medium", confidence: 0.86, frame_number: 540, timestamp_in_video: 18.0 },
      { id: "garbage_issue_007", type: "garbage", item_count: 21, severity: "high", confidence: 0.97, frame_number: 660, timestamp_in_video: 22.0 }
    ]
  };

  // --- Backend wiring config ---------------------------------------------
  // Real ingestion: as the "camera → detections" story plays out, each
  // detection that becomes active gets POSTed to the real dedup engine
  // (backend/main.py -> sp_ingest_detection) with a simulated GPS fix, so
  // "7 observations -> 2 incidents" is something the backend actually
  // computed, not just asserted by the UI.
  const INGEST_CONFIG = {
    API_URL: 'http://localhost:8000/detections',
    VEHICLE_ID: 'MOBI-VAN-01', // the single reporting vehicle for this demo feed
    // A short fixed route through Bengaluru (matches dashboard.js's default
    // map center) that the "vehicle" is assumed to be driving during
    // playback. Real lat/lng = interpolated point along this route +
    // small random jitter, to emulate GPS drift between passes.
    ROUTE: [
      { lat: 12.9716, lng: 77.5946 },
      { lat: 12.9750, lng: 77.6010 },
      { lat: 12.9800, lng: 77.6080 },
      { lat: 12.9770, lng: 77.6150 },
      { lat: 12.9700, lng: 77.6120 },
      { lat: 12.9650, lng: 77.6040 },
      { lat: 12.9680, lng: 77.5970 }
    ],
    JITTER_METERS: 25 // simulated GPS drift, meters
  };

  // Type keys the backend/database actually know about (see
  // database/01_schema.sql issue_types). The feed's internal category
  // keys ('traffic') don't always match 1:1.
  const TYPE_KEY_MAP = {
    pothole: 'pothole',
    garbage: 'garbage',
    traffic: 'heavy_traffic',
    heavy_traffic: 'heavy_traffic'
  };

  // Detections already sent to the backend this session, so scrubbing
  // back and forth over the same moment doesn't re-POST duplicates.
  const ingestedIds = new Set();

  // --- Configuration ---
  const FEED_CONFIG = {
    pothole: {
      key: 'pothole',
      title: 'Potholes',
      jsonFile: 'video_detections.json',
      videoCandidates: ['pothole_video.mp4', 'pothole_vedio.mp4', 'pothole.mp4'],
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
      typeClass: 'type-pothole'
    },
    traffic: {
      key: 'traffic',
      title: 'Heavy Traffic',
      jsonFile: 'video_detections_traffic.json',
      videoCandidates: ['traffic_video.mp4', 'traffic.mp4', 'traffic_vedio.mp4'],
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.5 2.8C2.1 11 2 11.5 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></svg>`,
      typeClass: 'type-heavy_traffic'
    },
    garbage: {
      key: 'garbage',
      title: 'Garbage Dumps',
      jsonFile: 'video_detections_garbage.json',
      videoCandidates: ['garbage_video.mp4', 'garbage.mp4', 'garbage_vedio.mp4'],
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`,
      typeClass: 'type-garbage'
    }
  };

  // --- Application State ---
  const state = {
    activeCategory: 'pothole',
    detections: [],
    filteredDetections: [],
    searchQuery: '',
    filterPriority: 'all', // 'all' | 'high'
    activeIssueId: null,
    videoDuration: 25.0,
    isPlaying: false,
    usingSimulation: false,
    simTime: 0,
    simSpeed: 1,
    simInterval: null,
    isCustomVideoLoaded: false
  };

  // --- Cached DOM References ---
  let DOM = {};

  // --- Initializer ---
  document.addEventListener('DOMContentLoaded', () => {
    cacheDom();
    bindEvents();
    switchCategory('pothole');
  });

  function cacheDom() {
    DOM = {
      videoEl: document.getElementById('main-video'),
      simCanvas: document.getElementById('simulation-canvas'),
      feedTabs: document.querySelectorAll('.feed-tab'),
      feedContainer: document.getElementById('incident-feed'),
      feedCountLabel: document.getElementById('feed-count-label'),
      currentTimestampText: document.getElementById('current-timestamp-text'),
      playPauseBtn: document.getElementById('play-pause-btn'),
      playPauseText: document.getElementById('play-pause-text'),
      prevIssueBtn: document.getElementById('prev-issue-btn'),
      nextIssueBtn: document.getElementById('next-issue-btn'),
      speedSelect: document.getElementById('playback-speed'),
      timelineTrack: document.getElementById('timeline-track'),
      timelineFill: document.getElementById('timeline-fill'),
      timelineSeeker: document.getElementById('timeline-seeker'),
      timelineMarkersContainer: document.getElementById('timeline-markers-container'),
      searchInput: document.getElementById('search-input'),
      clearSearchBtn: document.getElementById('clear-search-btn'),
      totalCountMetric: document.getElementById('metric-total-count'),
      activeCountMetric: document.getElementById('metric-active-count'),
      customStatMetric: document.getElementById('metric-custom-stat'),
      customStatLabel: document.getElementById('metric-custom-label'),
      badgePothole: document.getElementById('badge-count-pothole'),
      badgeTraffic: document.getElementById('badge-count-traffic'),
      badgeGarbage: document.getElementById('badge-count-garbage'),
      loadVideoBtn: document.getElementById('load-video-btn'),
      videoFileInput: document.getElementById('video-file-input'),
      videoSourceLabel: document.getElementById('video-source-label'),
      activeCategoryText: document.getElementById('active-category-text'),
      tabFilterBtns: document.querySelectorAll('.tab-btn[data-priority]')
    };
  }

  function bindEvents() {
    // Feed Category Switcher Tabs
    DOM.feedTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const cat = tab.getAttribute('data-category');
        if (cat && cat !== state.activeCategory) {
          switchCategory(cat);
        }
      });
    });

    // Native Video Element Events
    if (DOM.videoEl) {
      DOM.videoEl.addEventListener('timeupdate', onTimeUpdate);
      DOM.videoEl.addEventListener('loadedmetadata', () => {
        state.videoDuration = DOM.videoEl.duration || 25.0;
        state.usingSimulation = false;
        if (DOM.simCanvas) DOM.simCanvas.style.display = 'none';
        DOM.videoEl.style.display = 'block';
        updateTimelineMarkers();
        updateTimeDisplays(DOM.videoEl.currentTime);
      });
      DOM.videoEl.addEventListener('play', () => {
        state.isPlaying = true;
        updatePlayButtonState();
      });
      DOM.videoEl.addEventListener('pause', () => {
        state.isPlaying = false;
        updatePlayButtonState();
      });
      DOM.videoEl.addEventListener('ended', () => {
        state.isPlaying = false;
        updatePlayButtonState();
      });
      DOM.videoEl.addEventListener('error', () => {
        // Fallback gracefully to clean simulation if local mp4 not found
        if (!state.isCustomVideoLoaded) {
          activateSimulation();
        }
      });
    }

    // Play/Pause Controller
    if (DOM.playPauseBtn) {
      DOM.playPauseBtn.addEventListener('click', togglePlayPause);
    }

    // Playback Speed Selector
    if (DOM.speedSelect) {
      DOM.speedSelect.addEventListener('change', (e) => {
        const rate = parseFloat(e.target.value) || 1.0;
        state.simSpeed = rate;
        if (DOM.videoEl && !state.usingSimulation) {
          DOM.videoEl.playbackRate = rate;
        }
      });
    }

    // Prev / Next Detection Buttons
    if (DOM.prevIssueBtn) {
      DOM.prevIssueBtn.addEventListener('click', jumpToPrevIssue);
    }
    if (DOM.nextIssueBtn) {
      DOM.nextIssueBtn.addEventListener('click', jumpToNextIssue);
    }

    // Timeline Scrubber Click
    if (DOM.timelineTrack) {
      DOM.timelineTrack.addEventListener('click', (e) => {
        const rect = DOM.timelineTrack.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const pct = Math.max(0, Math.min(1, clickX / rect.width));
        const targetTime = pct * state.videoDuration;
        seekToTime(targetTime);
      });
    }

    // Search Input
    if (DOM.searchInput) {
      DOM.searchInput.addEventListener('input', (e) => {
        state.searchQuery = (e.target.value || '').trim().toLowerCase();
        if (DOM.clearSearchBtn) {
          DOM.clearSearchBtn.classList.toggle('is-visible', state.searchQuery.length > 0);
        }
        applyFilterAndRender();
      });
    }

    if (DOM.clearSearchBtn) {
      DOM.clearSearchBtn.addEventListener('click', () => {
        DOM.searchInput.value = '';
        state.searchQuery = '';
        DOM.clearSearchBtn.classList.remove('is-visible');
        applyFilterAndRender();
      });
    }

    // Priority Filter Tabs (All / High Priority)
    DOM.tabFilterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        DOM.tabFilterBtns.forEach(b => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        state.filterPriority = btn.getAttribute('data-priority') || 'all';
        applyFilterAndRender();
      });
    });

    // Direct Native File Picker "Load Video" Button
    if (DOM.loadVideoBtn && DOM.videoFileInput) {
      DOM.loadVideoBtn.addEventListener('click', () => {
        DOM.videoFileInput.click();
      });

      DOM.videoFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          loadCustomVideoFile(file);
        }
      });
    }
  }

  // ==========================================================================
  // Category Switcher
  // ==========================================================================
  async function switchCategory(categoryKey) {
    if (!FEED_CONFIG[categoryKey]) return;
    state.activeCategory = categoryKey;
    state.activeIssueId = null;

    // Update Tab UI
    DOM.feedTabs.forEach(tab => {
      const isMatch = tab.getAttribute('data-category') === categoryKey;
      tab.classList.toggle('is-active', isMatch);
    });

    const config = FEED_CONFIG[categoryKey];
    if (DOM.activeCategoryText) {
      DOM.activeCategoryText.textContent = `${config.title} Feed Synced`;
    }

    // Load Data
    await loadDetectionData(categoryKey);

    // If user hasn't loaded a custom file, try candidate video
    if (!state.isCustomVideoLoaded) {
      tryLoadVideoForCategory(categoryKey);
    }

    // Render Timeline & Cards
    updateTimelineMarkers();
    applyFilterAndRender();
    updateCategoryMetrics();
  }

  // ==========================================================================
  // Data Fetching with Resilient Fallbacks
  // ==========================================================================
  async function loadDetectionData(categoryKey) {
    const config = FEED_CONFIG[categoryKey];
    let loadedData = null;

    try {
      const resp = await fetch(config.jsonFile, { cache: 'no-store' });
      if (resp.ok) {
        const json = await resp.json();
        if (Array.isArray(json)) {
          loadedData = json;
        } else if (json && Array.isArray(json.detections)) {
          loadedData = json.detections;
        }
      }
    } catch (err) {
      console.warn(`Could not load ${config.jsonFile} via fetch (file:// mode). Using bundled fallback data.`);
    }

    if (!loadedData || loadedData.length === 0) {
      loadedData = DATA_FALLBACKS[categoryKey] || [];
    }

    // Sort by timestamp_in_video
    loadedData.sort((a, b) => (parseFloat(a.timestamp_in_video) || 0) - (parseFloat(b.timestamp_in_video) || 0));

    state.detections = loadedData;

    // Estimate video duration from detections
    if (loadedData.length > 0) {
      const maxTs = Math.max(...loadedData.map(d => parseFloat(d.timestamp_in_video) || 0));
      if (!DOM.videoEl || !DOM.videoEl.duration || isNaN(DOM.videoEl.duration)) {
        state.videoDuration = Math.max(25.0, Math.ceil(maxTs + 4));
      }
    }

    updateFeedBadges();
  }

  function updateFeedBadges() {
    if (DOM.badgePothole) DOM.badgePothole.textContent = DATA_FALLBACKS.pothole.length;
    if (DOM.badgeTraffic) DOM.badgeTraffic.textContent = DATA_FALLBACKS.traffic.length;
    if (DOM.badgeGarbage) DOM.badgeGarbage.textContent = DATA_FALLBACKS.garbage.length;
    
    const activeBadge = document.getElementById(`badge-count-${state.activeCategory}`);
    if (activeBadge) activeBadge.textContent = state.detections.length;
  }

  // ==========================================================================
  // Video Management & Direct File Picker
  // ==========================================================================
  function tryLoadVideoForCategory(categoryKey) {
    const config = FEED_CONFIG[categoryKey];
    if (!DOM.videoEl) return;

    pauseVideo();
    DOM.videoEl.currentTime = 0;
    state.simTime = 0;

    const candidateSrc = config.videoCandidates[0];
    DOM.videoEl.src = candidateSrc;
    DOM.videoEl.load();

    if (DOM.videoSourceLabel) {
      DOM.videoSourceLabel.textContent = `Default Feed Video (${config.title})`;
    }

    DOM.videoEl.onloadeddata = () => {
      state.usingSimulation = false;
      if (DOM.simCanvas) DOM.simCanvas.style.display = 'none';
      DOM.videoEl.style.display = 'block';
    };
  }

  function detectCategoryFromFilename(filename) {
    const name = (filename || '').toLowerCase();
    if (name.includes('pothole')) return 'pothole';
    if (name.includes('garbage') || name.includes('trash') || name.includes('waste') || name.includes('dump')) return 'garbage';
    if (name.includes('traffic') || name.includes('congestion') || name.includes('jam')) return 'traffic';
    return null; // couldn't tell from the name — leave the current tab as-is
  }

  function loadCustomVideoFile(file) {
    if (!DOM.videoEl || !file) return;

    // Figure out which detection category this video actually belongs to
    // BEFORE touching anything else, and set the "custom video" flag first
    // so switchCategory() below won't try to overwrite our video source
    // with its own default sample clip for that category.
    const detectedCategory = detectCategoryFromFilename(file.name);
    state.isCustomVideoLoaded = true;

    const url = URL.createObjectURL(file);
    DOM.videoEl.src = url;
    DOM.videoEl.style.display = 'block';
    if (DOM.simCanvas) DOM.simCanvas.style.display = 'none';
    state.usingSimulation = false;

    if (DOM.videoSourceLabel) {
      DOM.videoSourceLabel.textContent = detectedCategory
        ? `Loaded: ${file.name} (auto-detected: ${FEED_CONFIG[detectedCategory].title})`
        : `Loaded: ${file.name}`;
      DOM.videoSourceLabel.style.color = '#15803d';
    }

    // Switch to the matching tab so the right detection list/telemetry
    // shows up. If we couldn't tell from the filename, at least make the
    // currently-active tab's data reload against this new video.
    switchCategory(detectedCategory || state.activeCategory);

    DOM.videoEl.play().catch(() => {});
  }

  // Clean Simulation Render (Zero top-corner text collisions)
  function activateSimulation() {
    state.usingSimulation = true;
    if (DOM.videoEl) DOM.videoEl.style.display = 'none';
    if (!DOM.simCanvas) return;

    DOM.simCanvas.style.display = 'block';
    startSimulationRender();
  }

  function startSimulationRender() {
    const canvas = DOM.simCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = canvas.parentElement.clientWidth || 700;
    canvas.height = canvas.parentElement.clientHeight || 420;

    function render() {
      ctx.fillStyle = '#0b1120';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Road Perspective Simulation
      const horizonY = canvas.height * 0.42;
      ctx.fillStyle = '#1e293b';
      ctx.beginPath();
      ctx.moveTo(canvas.width * 0.35, horizonY);
      ctx.lineTo(canvas.width * 0.65, horizonY);
      ctx.lineTo(canvas.width * 0.95, canvas.height);
      ctx.lineTo(canvas.width * 0.05, canvas.height);
      ctx.closePath();
      ctx.fill();

      // Lane Markings
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 4;
      ctx.setLineDash([20, 20]);
      ctx.lineDashOffset = -(state.simTime * 60) % 40;
      ctx.beginPath();
      ctx.moveTo(canvas.width * 0.5, horizonY);
      ctx.lineTo(canvas.width * 0.5, canvas.height);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw detection bounding box only when active
      const activeDetection = getActiveDetectionForTime(state.simTime);
      if (activeDetection) {
        const color = state.activeCategory === 'pothole' ? '#d97706' : (state.activeCategory === 'traffic' ? '#2563eb' : '#7c3aed');
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        const boxW = 150;
        const boxH = 90;
        const boxX = canvas.width * 0.5 - boxW / 2;
        const boxY = canvas.height * 0.65;
        
        ctx.strokeRect(boxX, boxY, boxW, boxH);
        ctx.fillStyle = color;
        ctx.fillRect(boxX, boxY - 24, boxW, 24);
        
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 11.5px Inter, sans-serif';
        const label = activeDetection.confidence ? `${(activeDetection.confidence * 100).toFixed(0)}% Conf` : (activeDetection.traffic_level || activeDetection.severity || 'Detected');
        ctx.fillText(`AI: ${formatIssueType(activeDetection.type)} [${label}]`, boxX + 6, boxY - 7);
      }

      if (state.isPlaying && state.usingSimulation) {
        requestAnimationFrame(render);
      }
    }

    render();
  }

  // ==========================================================================
  // Playback & Seeking
  // ==========================================================================
  function togglePlayPause() {
    if (state.isPlaying) {
      pauseVideo();
    } else {
      playVideo();
    }
  }

  function playVideo() {
    state.isPlaying = true;
    updatePlayButtonState();

    if (state.usingSimulation) {
      clearInterval(state.simInterval);
      state.simInterval = setInterval(() => {
        state.simTime += 0.1 * state.simSpeed;
        if (state.simTime >= state.videoDuration) {
          state.simTime = 0;
        }
        onTimeUpdate();
      }, 100);
      startSimulationRender();
    } else if (DOM.videoEl) {
      DOM.videoEl.play().catch(err => {
        activateSimulation();
        playVideo();
      });
    }
  }

  function pauseVideo() {
    state.isPlaying = false;
    updatePlayButtonState();

    if (state.usingSimulation) {
      clearInterval(state.simInterval);
      state.simInterval = null;
    } else if (DOM.videoEl) {
      DOM.videoEl.pause();
    }
  }

  function updatePlayButtonState() {
    if (!DOM.playPauseBtn) return;
    if (state.isPlaying) {
      DOM.playPauseBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
        <span id="play-pause-text">Pause</span>
      `;
    } else {
      DOM.playPauseBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        <span id="play-pause-text">Play Video</span>
      `;
    }
  }

  function seekToTime(timestamp) {
    const clampedTime = Math.max(0, Math.min(state.videoDuration, timestamp));
    
    if (state.usingSimulation) {
      state.simTime = clampedTime;
      onTimeUpdate();
      startSimulationRender();
    } else if (DOM.videoEl) {
      DOM.videoEl.currentTime = clampedTime;
      onTimeUpdate();
    }
  }

  function jumpToPrevIssue() {
    const curr = getCurrentTime();
    const prevList = state.detections.filter(d => (parseFloat(d.timestamp_in_video) || 0) < curr - 0.2);
    if (prevList.length > 0) {
      const target = prevList[prevList.length - 1];
      seekToTime(parseFloat(target.timestamp_in_video));
    } else if (state.detections.length > 0) {
      seekToTime(parseFloat(state.detections[0].timestamp_in_video));
    }
  }

  function jumpToNextIssue() {
    const curr = getCurrentTime();
    const nextList = state.detections.filter(d => (parseFloat(d.timestamp_in_video) || 0) > curr + 0.2);
    if (nextList.length > 0) {
      const target = nextList[0];
      seekToTime(parseFloat(target.timestamp_in_video));
    } else if (state.detections.length > 0) {
      seekToTime(parseFloat(state.detections[state.detections.length - 1].timestamp_in_video));
    }
  }

  function getCurrentTime() {
    return state.usingSimulation ? state.simTime : (DOM.videoEl ? DOM.videoEl.currentTime : 0);
  }

  // ==========================================================================
  // Real-Time Synchronization & Highlighting
  // ==========================================================================
  function onTimeUpdate() {
    const currentTime = getCurrentTime();
    const duration = state.videoDuration || 25.0;

    // Update Progress Scrubber
    const pct = Math.max(0, Math.min(100, (currentTime / duration) * 100));
    if (DOM.timelineFill) DOM.timelineFill.style.width = `${pct}%`;
    if (DOM.timelineSeeker) DOM.timelineSeeker.style.left = `${pct}%`;

    // Update Time Display
    updateTimeDisplays(currentTime);

    // Match Active Detection Item
    const activeDetection = getActiveDetectionForTime(currentTime);
    const newActiveId = activeDetection ? activeDetection.id : null;

    if (newActiveId !== state.activeIssueId) {
      state.activeIssueId = newActiveId;
      highlightActiveCard(newActiveId);
      updateTimelineMarkerHighlights(newActiveId);
      if (activeDetection) {
        ingestDetectionIfNeeded(activeDetection);
      }
    }
  }

  // ==========================================================================
  // Real ingestion wiring — POST /detections (item 6 from the Phase 1 audit)
  // ==========================================================================

  /**
   * Interpolates a lat/lng along INGEST_CONFIG.ROUTE for how far through
   * the clip we are (0 = start, 1 = end), then adds small random jitter to
   * simulate GPS drift — so the same real-world spot, detected on two
   * different passes, doesn't land on the exact same coordinate (which is
   * realistic, and is *why* the dedup radius needs to be wide enough to
   * still catch it as the same issue).
   */
  function routePositionForFraction(frac) {
    const route = INGEST_CONFIG.ROUTE;
    const clamped = Math.max(0, Math.min(1, frac || 0));
    const segCount = route.length - 1;
    const segFloat = clamped * segCount;
    const segIndex = Math.min(segCount - 1, Math.floor(segFloat));
    const segFrac = segFloat - segIndex;

    const a = route[segIndex];
    const b = route[segIndex + 1];
    const lat = a.lat + (b.lat - a.lat) * segFrac;
    const lng = a.lng + (b.lng - a.lng) * segFrac;

    // ~1 degree latitude ≈ 111,320m; longitude shrinks by cos(latitude).
    const jitterM = INGEST_CONFIG.JITTER_METERS;
    const jitterLat = ((Math.random() - 0.5) * 2 * jitterM) / 111320;
    const jitterLng = ((Math.random() - 0.5) * 2 * jitterM) / (111320 * Math.cos(lat * Math.PI / 180));

    return { lat: lat + jitterLat, lng: lng + jitterLng };
  }

  function severityFromConfidence(confidence) {
    const c = parseFloat(confidence);
    if (isNaN(c)) return null;
    if (c >= 0.85) return 'high';
    if (c >= 0.7) return 'moderate';
    return 'low';
  }

  function normalizedTrafficLevel(rawLevel) {
    const s = (rawLevel || '').toLowerCase();
    if (s.includes('gridlock') || s.includes('severe')) return 'severe';
    if (s.includes('heavy')) return 'heavy';
    return 'moderate';
  }

  function buildIngestPayload(issue) {
    const typeKey = TYPE_KEY_MAP[issue.type] || issue.type;
    const frac = state.videoDuration > 0
      ? (parseFloat(issue.timestamp_in_video) || 0) / state.videoDuration
      : 0;
    const pos = routePositionForFraction(frac);

    const payload = {
      type_key: typeKey,
      lat: Number(pos.lat.toFixed(7)),
      lng: Number(pos.lng.toFixed(7)),
      detected_at: new Date().toISOString(), // wall-clock ingestion time
      source_image: issue.id,
      vehicle_id: INGEST_CONFIG.VEHICLE_ID,
      confidence: issue.confidence !== undefined ? parseFloat(issue.confidence) : null
    };

    if (typeKey === 'heavy_traffic') {
      payload.vehicle_count = issue.vehicle_count || null;
      payload.traffic_level = normalizedTrafficLevel(issue.traffic_level);
    } else if (typeKey === 'garbage') {
      payload.item_count = issue.item_count || null;
      payload.severity = issue.severity || severityFromConfidence(issue.confidence);
    } else {
      // pothole (and anything else without its own severity field) — derive
      // a severity from confidence so the never-downgrade rule has
      // something real to compare merges against.
      payload.severity = severityFromConfidence(issue.confidence);
    }

    return payload;
  }

  async function ingestDetectionIfNeeded(issue) {
    if (!issue || !issue.id || ingestedIds.has(issue.id)) return;
    ingestedIds.add(issue.id); // mark immediately so a fast re-trigger can't double-send

    const payload = buildIngestPayload(issue);

    try {
      const res = await fetch(INGEST_CONFIG.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await res.json();
      showIngestStatus(`✓ ${issue.id} → ${result.issue_code}${result.merged_into_existing ? ' (merged)' : ' (new)'}`, false);
    } catch (err) {
      // Backend not running / unreachable — don't break the demo, the feed
      // still plays fine as a pure video experience without it.
      console.warn('[MobiSense] Could not ingest detection to backend:', err);
      showIngestStatus(`⚠ ${issue.id} not sent (backend unreachable)`, true);
    }
  }

  // Small, self-contained status pill — created on first use so no HTML
  // changes are required. Shows the last ingest result near the video
  // source label.
  let ingestStatusEl = null;
  function showIngestStatus(text, isError) {
    if (!ingestStatusEl) {
      ingestStatusEl = document.createElement('div');
      ingestStatusEl.id = 'ingest-status-pill';
      ingestStatusEl.style.cssText = 'margin-top:6px;font-size:12px;font-family:inherit;transition:opacity .2s;';
      if (DOM.videoSourceLabel && DOM.videoSourceLabel.parentElement) {
        DOM.videoSourceLabel.parentElement.appendChild(ingestStatusEl);
      }
    }
    ingestStatusEl.textContent = text;
    ingestStatusEl.style.color = isError ? '#b91c1c' : '#15803d';
    ingestStatusEl.style.opacity = '1';
    clearTimeout(showIngestStatus._t);
    showIngestStatus._t = setTimeout(() => {
      if (ingestStatusEl) ingestStatusEl.style.opacity = '0.4';
    }, 4000);
  }

  function getActiveDetectionForTime(currentTime) {
    if (!state.detections || state.detections.length === 0) return null;

    // Tolerance window: Active if currentTime is within [timestamp - 0.5s, timestamp + 1.5s]
    const active = state.detections.find(d => {
      const ts = parseFloat(d.timestamp_in_video) || 0;
      return currentTime >= (ts - 0.5) && currentTime <= (ts + 1.5);
    });

    if (active) return active;

    const closestPreceding = state.detections.slice().reverse().find(d => {
      const ts = parseFloat(d.timestamp_in_video) || 0;
      return (currentTime >= ts) && (currentTime - ts <= 1.2);
    });

    return closestPreceding || null;
  }

  function updateTimeDisplays(currentTime) {
    const formattedCurrent = formatReadableTime(currentTime);
    const formattedDuration = formatReadableTime(state.videoDuration);
    if (DOM.currentTimestampText) {
      DOM.currentTimestampText.textContent = `${formattedCurrent} / ${formattedDuration}`;
    }
  }

  function highlightActiveCard(activeId) {
    const allCards = document.querySelectorAll('.issue-card');
    allCards.forEach(card => {
      const isMatch = card.getAttribute('data-id') === activeId;
      card.classList.toggle('is-synced-active', isMatch);

      const activeTag = card.querySelector('.active-now-tag');
      if (activeTag) {
        activeTag.style.display = isMatch ? 'inline-flex' : 'none';
      }

      if (isMatch) {
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });

    if (DOM.activeCountMetric) {
      DOM.activeCountMetric.textContent = activeId ? '1 Active' : '0 Active';
    }
  }

  function updateTimelineMarkerHighlights(activeId) {
    const dots = document.querySelectorAll('.timeline-marker-dot');
    dots.forEach(dot => {
      const isMatch = dot.getAttribute('data-id') === activeId;
      dot.classList.toggle('is-active', isMatch);
    });
  }

  // ==========================================================================
  // Timeline Markers Generation
  // ==========================================================================
  function updateTimelineMarkers() {
    if (!DOM.timelineMarkersContainer) return;
    DOM.timelineMarkersContainer.innerHTML = '';

    const duration = state.videoDuration || 25.0;

    state.detections.forEach(issue => {
      const ts = parseFloat(issue.timestamp_in_video) || 0;
      const pct = Math.max(0, Math.min(100, (ts / duration) * 100));

      const dot = document.createElement('div');
      dot.className = `timeline-marker-dot type-${issue.type}`;
      dot.style.left = `${pct}%`;
      dot.setAttribute('data-id', issue.id);
      dot.setAttribute('title', `${formatIssueType(issue.type)} at ${formatReadableTime(ts)}`);

      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        seekToTime(ts);
      });

      DOM.timelineMarkersContainer.appendChild(dot);
    });
  }

  // ==========================================================================
  // Feed List Rendering & Simplified Card Generation
  // ==========================================================================
  function applyFilterAndRender() {
    let list = state.detections.slice();

    if (state.filterPriority === 'high') {
      list = list.filter(item => {
        if (item.confidence && item.confidence >= 0.85) return true;
        if (item.severity && (item.severity.toLowerCase() === 'high' || item.severity.toLowerCase() === 'critical')) return true;
        if (item.vehicle_count && item.vehicle_count >= 15) return true;
        return false;
      });
    }

    if (state.searchQuery) {
      const q = state.searchQuery;
      list = list.filter(item => {
        const idMatch = (item.id || '').toLowerCase().includes(q);
        const typeMatch = (item.type || '').toLowerCase().includes(q);
        const tsMatch = String(item.timestamp_in_video).includes(q);
        const trafficMatch = (item.traffic_level || '').toLowerCase().includes(q);
        const severityMatch = (item.severity || '').toLowerCase().includes(q);
        return idMatch || typeMatch || tsMatch || trafficMatch || severityMatch;
      });
    }

    state.filteredDetections = list;
    renderCards(list);
  }

  function renderCards(issues) {
    if (!DOM.feedContainer) return;

    if (DOM.feedCountLabel) {
      DOM.feedCountLabel.innerHTML = `Showing <strong>${issues.length}</strong> of ${state.detections.length} detections`;
    }

    if (issues.length === 0) {
      DOM.feedContainer.innerHTML = `
        <div class="empty-state-card">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <div class="empty-state-title">No matching detections found</div>
          <div class="empty-state-desc">Try clearing your search query or selecting "All Detections"</div>
        </div>
      `;
      return;
    }

    DOM.feedContainer.innerHTML = '';

    issues.forEach(issue => {
      const card = createIssueCardElement(issue);
      DOM.feedContainer.appendChild(card);
    });

    if (state.activeIssueId) {
      highlightActiveCard(state.activeIssueId);
    }
  }

  /**
   * Simplified, human-readable card creation (No raw frame numbers, clear plain language)
   */
  function createIssueCardElement(issue) {
    const card = document.createElement('div');
    const typeKey = issue.type || 'pothole';
    const ts = parseFloat(issue.timestamp_in_video) || 0;
    const isCurrentActive = state.activeIssueId === issue.id;

    card.className = `issue-card type-${typeKey} ${isCurrentActive ? 'is-synced-active' : ''}`;
    card.setAttribute('data-id', issue.id);

    // Build plain-language metric text
    let metricBodyHtml = '';

    if (typeKey === 'pothole' || (issue.confidence !== undefined && !issue.vehicle_count && !issue.item_count)) {
      const conf = issue.confidence !== undefined ? parseFloat(issue.confidence) : 0.85;
      const confPct = Math.round(conf * 100);
      metricBodyHtml = `
        <div class="card-body-simple">
          <span class="plain-metric">Confidence: <strong>${confPct}%</strong></span>
        </div>
      `;
    } else if (typeKey.includes('traffic') || issue.vehicle_count !== undefined) {
      const count = issue.vehicle_count || 0;
      const level = issue.traffic_level || 'Moderate';
      metricBodyHtml = `
        <div class="card-body-simple">
          <span class="plain-metric">Vehicle Count: <strong>${count} vehicles</strong></span>
          <span style="color: var(--border-subtle);">·</span>
          <span class="plain-metric">Traffic Level: <strong>${escapeHtml(level)}</strong></span>
        </div>
      `;
    } else if (typeKey.includes('garbage') || issue.item_count !== undefined) {
      const count = issue.item_count || 0;
      const sev = formatSeverity(issue.severity);
      metricBodyHtml = `
        <div class="card-body-simple">
          <span class="plain-metric">Item Count: <strong>${count} items</strong></span>
          <span style="color: var(--border-subtle);">·</span>
          <span class="plain-metric">Severity: <strong>${escapeHtml(sev)}</strong></span>
        </div>
      `;
    }

    card.innerHTML = `
      <div class="card-header-row">
        <div class="card-title-group">
          <span class="type-pill type-${typeKey}">
            ${getTypeIcon(typeKey)}
            ${formatIssueType(typeKey)}
          </span>
          <span class="issue-id-label">${escapeHtml(issue.id)}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 6px;">
          <span class="active-now-tag" style="display: ${isCurrentActive ? 'inline-flex' : 'none'};">
            <span class="dot"></span> Active
          </span>
          <span class="video-time-tag">
            at ${formatReadableTime(ts)}
          </span>
        </div>
      </div>

      ${metricBodyHtml}

      <div class="card-action-hint">
        <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        <span>Click card to seek video</span>
      </div>
    `;

    card.addEventListener('click', () => {
      seekToTime(ts);
    });

    return card;
  }

  // ==========================================================================
  // Metrics & Stats
  // ==========================================================================
  function updateCategoryMetrics() {
    if (DOM.totalCountMetric) {
      DOM.totalCountMetric.textContent = state.detections.length;
    }

    if (DOM.customStatMetric && DOM.customStatLabel) {
      if (state.activeCategory === 'pothole') {
        DOM.customStatLabel.textContent = 'Avg Confidence';
        const sum = state.detections.reduce((acc, curr) => acc + (parseFloat(curr.confidence) || 0), 0);
        const avg = state.detections.length > 0 ? Math.round(sum / state.detections.length * 100) + '%' : 'N/A';
        DOM.customStatMetric.textContent = avg;
      } else if (state.activeCategory === 'traffic') {
        DOM.customStatLabel.textContent = 'Peak Vehicles';
        const maxVeh = Math.max(...state.detections.map(d => parseInt(d.vehicle_count) || 0), 0);
        DOM.customStatMetric.textContent = `${maxVeh} max`;
      } else if (state.activeCategory === 'garbage') {
        DOM.customStatLabel.textContent = 'High Severity';
        const highCount = state.detections.filter(d => (d.severity || '').toLowerCase() === 'high').length;
        DOM.customStatMetric.textContent = `${highCount} sites`;
      }
    }
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================
  function formatReadableTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const paddedSecs = String(secs).padStart(2, '0');
    return `${mins}:${paddedSecs}`;
  }

  function formatSeverity(sev) {
    if (!sev) return 'Medium';
    const s = String(sev).toLowerCase();
    if (s.includes('high') || s.includes('crit')) return 'High';
    if (s.includes('low')) return 'Low';
    return 'Medium';
  }

  function formatIssueType(type) {
    if (!type) return 'Unknown';
    if (type === 'pothole') return 'Pothole';
    if (type === 'heavy_traffic' || type === 'traffic') return 'Heavy Traffic';
    if (type === 'garbage' || type === 'garbage_dump') return 'Garbage Dump';
    return String(type)
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  function getTypeIcon(type) {
    const key = (type || '').toLowerCase();
    if (key.includes('pothole')) return FEED_CONFIG.pothole.icon;
    if (key.includes('traffic')) return FEED_CONFIG.traffic.icon;
    if (key.includes('garb') || key.includes('waste')) return FEED_CONFIG.garbage.icon;
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  window.MobiSenseFeed = {
    switchCategory,
    seekToTime,
    playVideo,
    pauseVideo
  };

})();
