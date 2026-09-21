/**
 * maps-config.js — the ONE file where your Google Maps key lives.
 *
 * Every page (dashboard.html, command-center.html) loads this file first,
 * then maps-loader.js reads the values below. You never paste the key
 * anywhere else.
 *
 * NOTE: a browser-side Maps key is visible to anyone who opens DevTools.
 * That is normal for Google Maps — the protection is restricting the key in
 * Google Cloud Console (see the guide), not hiding it.
 */
window.MOBISENSE_MAPS = {
  // 1) Paste your Google Maps Demo Key between the quotes:
  API_KEY: "AIzaSyD0tlL09mRFExI4eGStJa449phXs-sMxwY",

  // 2) Advanced Markers (the custom pins) need a Map ID.
  //    "DEMO_MAP_ID" is Google's built-in ID for development/testing.
  //    For production, create your own in Cloud Console -> Map Management.
  MAP_ID: "DEMO_MAP_ID",
};
