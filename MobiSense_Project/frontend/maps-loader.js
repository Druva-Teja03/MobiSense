/**
 * maps-loader.js — loads the Google Maps JavaScript API once per page.
 *
 * Usage (in dashboard.js / command-center.js):
 *   const gm = await window.MobiMaps.load();
 *   const map = new gm.Map(element, { ... });
 *
 * It resolves with the Google Maps classes the app needs, or REJECTS with a
 * readable Error (missing key, offline, timeout) so the rest of the page
 * (incident feed, stats) keeps working even if the map can't load.
 *
 * Requires maps-config.js to be loaded BEFORE this file.
 */
(function () {
  "use strict";

  const cfg = window.MOBISENSE_MAPS || {};
  const LOAD_TIMEOUT_MS = 12000;
  let loadPromise = null;

  // Google calls this automatically if it rejects the key (wrong key,
  // API not enabled, referrer not allowed, ...).
  window.gm_authFailure = function () {
    console.error(
      "[MobiSense] Google rejected the Maps API key. Check: (1) the key in " +
        "frontend/maps-config.js, (2) 'Maps JavaScript API' is enabled for the " +
        "project, (3) if you added HTTP referrer restrictions, they include " +
        "http://localhost:* — and open the site via http://localhost, not file://",
    );
  };

  function load() {
    if (loadPromise) return loadPromise;

    loadPromise = new Promise((resolve, reject) => {
      if (!cfg.API_KEY || cfg.API_KEY.startsWith("PASTE_")) {
        reject(
          new Error(
            "No Google Maps key yet — paste it into frontend/maps-config.js",
          ),
        );
        return;
      }

      const timer = setTimeout(
        () => reject(new Error("Google Maps took too long to load")),
        LOAD_TIMEOUT_MS,
      );

      // Google runs this once its bootstrap script has loaded.
      window.__mobiMapsReady = async function () {
        try {
          // "loading=async" means each library is imported on demand.
          const [core, maps, marker] = await Promise.all([
            google.maps.importLibrary("core"),
            google.maps.importLibrary("maps"),
            google.maps.importLibrary("marker"),
          ]);
          clearTimeout(timer);
          resolve({
            Map: maps.Map,
            InfoWindow: maps.InfoWindow,
            LatLngBounds: core.LatLngBounds,
            event: core.event,
            AdvancedMarkerElement: marker.AdvancedMarkerElement,
          });
        } catch (err) {
          clearTimeout(timer);
          reject(err);
        }
      };

      const script = document.createElement("script");
      script.async = true;
      script.src =
        "https://maps.googleapis.com/maps/api/js" +
        "?key=" + encodeURIComponent(cfg.API_KEY) +
        "&v=weekly&loading=async&callback=__mobiMapsReady";
      script.onerror = () => {
        clearTimeout(timer);
        reject(new Error("Could not reach maps.googleapis.com (offline?)"));
      };
      document.head.appendChild(script);
    });

    return loadPromise;
  }

  window.MobiMaps = {
    load,
    mapId: cfg.MAP_ID || "DEMO_MAP_ID",
  };
})();
