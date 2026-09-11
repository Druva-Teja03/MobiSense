/**
 * MobiSense — Application Shell Controller
 * Shared across every authenticated page (Command Center, Live Map,
 * AI Feed, Incidents, Fleet, Analytics): auth guard, sidebar collapse,
 * and logout. Page-specific logic stays in that page's own script.
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'mobisense_nav_collapsed';

  window.MobiSenseShell = {
    /**
     * Call at the top of any protected page. Redirects to login.html
     * if there's no saved token and returns null; otherwise returns
     * { token, user }.
     */
    requireAuth() {
      const token = localStorage.getItem('mobisense_token');
      if (!token) {
        window.location.href = 'login.html';
        return null;
      }
      const user = JSON.parse(localStorage.getItem('mobisense_user') || '{}');
      return { token, user };
    },

    logout() {
      localStorage.removeItem('mobisense_token');
      localStorage.removeItem('mobisense_user');
      window.location.href = 'login.html';
    },

    /** Wires the collapse button + restores the saved collapse state. */
    initNav() {
      const shell = document.querySelector('.app-shell');
      const collapseBtn = document.getElementById('nav-collapse-btn');
      if (!shell) return;

      if (localStorage.getItem(STORAGE_KEY) === '1') {
        shell.classList.add('is-nav-collapsed');
      }

      if (collapseBtn) {
        collapseBtn.addEventListener('click', () => {
          const collapsed = shell.classList.toggle('is-nav-collapsed');
          localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
        });
      }

      // Any element with data-shell-logout (e.g. a nav footer button,
      // or a page that has no profile-dropdown logout of its own).
      document.querySelectorAll('[data-shell-logout]').forEach((el) => {
        el.addEventListener('click', () => window.MobiSenseShell.logout());
      });
    }
  };

  // Backward-compat: dashboard.js/login.html expect window.MobiSense.logout
  // to exist. Only set it if a page hasn't already defined its own.
  window.MobiSense = window.MobiSense || {};
  if (!window.MobiSense.logout) {
    window.MobiSense.logout = window.MobiSenseShell.logout;
  }

  document.addEventListener('DOMContentLoaded', () => {
    window.MobiSenseShell.initNav();
  });
})();
