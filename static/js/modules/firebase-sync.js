/**
 * static/js/modules/firebase-sync.js
 * Hooks into the live traffic snapshot stream and syncs data to Firebase
 * Realtime Database.  Also manages the auth state indicator in the navbar.
 *
 * Usage: import this module from the dashboard page – it self-initialises.
 *
 * Behaviour:
 *   • Every 1 s   → overwrites /snapshots/{uid}/latest
 *   • Every 10 s  → appends to  /snapshots/{uid}/history
 *   • On congestion alert → pushes to /alerts/{uid}
 */

import { onAuthChange, signOut, getCurrentUser } from "./firebase-auth.js";
import { writeLatestSnapshot, pushSnapshotToHistory, writeAlert } from "./firebase-rtdb.js";
import { liveManager } from "./live.js";   // existing SSE manager

// ── Throttle helper ────────────────────────────────────────────────────────
let _historyTimer = 0;
const HISTORY_INTERVAL_MS = 10_000; // push to history every 10 s

// Track last alert count to detect new alerts
let _lastAlertCount = 0;

// ── Auth State UI ──────────────────────────────────────────────────────────
function injectAuthUI(user) {
  const navActions = document.querySelector(".nav-actions");
  if (!navActions) return;

  // Remove existing auth pill if re-rendering
  const existing = navActions.querySelector("#firebase-auth-pill");
  if (existing) existing.remove();

  const pill = document.createElement("div");
  pill.id = "firebase-auth-pill";
  pill.style.cssText = "display:flex;align-items:center;gap:0.5rem;";

  const navLoginItem = document.getElementById("nav-login-item");

  if (user) {
    const initials = (user.displayName || user.email || "?")
      .split(" ")
      .map(w => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();

    pill.innerHTML = `
      <span class="nav-user-pill" title="${user.email}">
        <span class="nav-user-avatar">${initials}</span>
        <span class="user-name-label" style="max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${user.displayName || user.email}</span>
      </span>
      <button id="logout-btn" class="btn btn--ghost" style="font-size:0.8rem;padding:0.3rem 0.7rem;" aria-label="Sign out">Logout</button>
    `;

    navActions.prepend(pill);
    document.getElementById("logout-btn").addEventListener("click", async () => {
      await signOut();
      window.location.href = "/";
    });

    if (navLoginItem) {
      navLoginItem.innerHTML = `<a href="#" class="nav-link" id="mobile-logout-link">Logout (${user.displayName || user.email})</a>`;
      document.getElementById("mobile-logout-link")?.addEventListener("click", async (e) => {
        e.preventDefault();
        await signOut();
        window.location.href = "/";
      });
    }

    injectSyncBadge(true);
  } else {
    pill.innerHTML = `
      <a href="/login" class="btn btn--ghost" style="font-size:0.85rem;padding:0.3rem 0.8rem;">Login</a>
      <a href="/signup" class="btn btn--primary" style="font-size:0.85rem;padding:0.3rem 0.8rem;">Sign Up</a>
    `;
    navActions.prepend(pill);

    if (navLoginItem) {
      navLoginItem.innerHTML = `<a href="/login" class="nav-link">Login</a>`;
    }

    injectSyncBadge(false);
  }
}

/** Inject a small "Firebase syncing" badge below the navbar connection pill. */
function injectSyncBadge(isOnline) {
  let badge = document.getElementById("firebase-sync-badge");
  if (!badge) {
    badge = document.createElement("span");
    badge.id = "firebase-sync-badge";
    const pill = document.querySelector("[data-connection-status]");
    if (pill && pill.parentNode) {
      pill.parentNode.insertBefore(badge, pill.nextSibling);
    }
  }
  badge.className = `firebase-sync-badge${isOnline ? "" : " offline"}`;
  badge.innerHTML = isOnline
    ? `<span class="sync-dot"></span> Firebase sync`
    : `<span class="sync-dot"></span> Not syncing`;
  badge.title = isOnline
    ? "Real-time data is being saved to Firebase Realtime Database"
    : "Sign in to enable Firebase real-time sync";
}

// ── Main sync logic ────────────────────────────────────────────────────────
function startSync(user) {
  if (!user || !liveManager) return;

  liveManager.onSnapshot(async (snapshot) => {
    if (!snapshot) return;

    // 1. Always overwrite the latest node
    writeLatestSnapshot(snapshot).catch(() => {});

    // 2. Push to rolling history every 10 s
    const now = Date.now();
    if (now - _historyTimer >= HISTORY_INTERVAL_MS) {
      _historyTimer = now;
      pushSnapshotToHistory(snapshot).catch(() => {});
    }

    // 3. Push alert when a new congestion alert appears
    const alertCount = snapshot.active_alerts ?? 0;
    if (alertCount > _lastAlertCount) {
      const zones = snapshot.zones || {};
      const highZones = Object.entries(zones)
        .filter(([, z]) => z.level === "High")
        .map(([name]) => name);
      writeAlert({
        active_alerts: alertCount,
        high_zones: highZones,
        ts: snapshot.ts,
        source: snapshot.source,
      }).catch(() => {});
    }
    _lastAlertCount = alertCount;
  });
}

// ── Bootstrap ─────────────────────────────────────────────────────────────
onAuthChange((user) => {
  injectAuthUI(user);
  if (user) {
    startSync(user);
  }
});

