/**
 * static/js/modules/firebase-rtdb.js
 * Firebase Realtime Database helpers for the Smart Traffic Monitoring System.
 *
 * Schema (Realtime Database):
 *   /snapshots/{userId}/latest          – latest traffic snapshot (overwritten every 1 s)
 *   /snapshots/{userId}/history/{pushId} – rolling log of snapshots (last 1000 kept)
 *   /alerts/{userId}/{pushId}            – congestion alert records
 *
 * Exports:
 *   writeLatestSnapshot(snapshot)        – overwrite /snapshots/{uid}/latest
 *   pushSnapshotToHistory(snapshot)      – append to /snapshots/{uid}/history
 *   subscribeLatest(callback)            – live-listener for latest snapshot
 *   writeAlert(alertData)                – push a congestion alert record
 */

import {
  ref,
  set,
  push,
  onValue,
  serverTimestamp,
  limitToLast,
  query,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-database.js";

import { db }   from "./firebase-config.js";
import { auth } from "./firebase-config.js";

/** Returns the current user's uid, or null. */
function uid() {
  return auth.currentUser ? auth.currentUser.uid : null;
}

/**
 * Overwrite the /snapshots/{uid}/latest node with the most recent snapshot.
 * Called every second by the live dashboard listener.
 * @param {object} snapshot – the canonical traffic snapshot from /api/stats
 */
export async function writeLatestSnapshot(snapshot) {
  const userId = uid();
  if (!userId) return;          // not signed in – skip write
  const path = ref(db, `snapshots/${userId}/latest`);
  await set(path, {
    ...snapshot,
    _written_at: serverTimestamp(),
  });
}

/**
 * Append one snapshot to the rolling history log.
 * Meant to be called every 5-10 seconds (not every second) to avoid
 * excessive write volume.
 * @param {object} snapshot
 */
export async function pushSnapshotToHistory(snapshot) {
  const userId = uid();
  if (!userId) return;
  const path = ref(db, `snapshots/${userId}/history`);
  await push(path, {
    ...snapshot,
    _written_at: serverTimestamp(),
  });
}

/**
 * Subscribe to the latest snapshot in real-time.
 * @param {(snapshot: object | null) => void} callback
 * @returns {() => void} unsubscribe function
 */
export function subscribeLatest(callback) {
  const userId = uid();
  if (!userId) {
    callback(null);
    return () => {};
  }
  const path = ref(db, `snapshots/${userId}/latest`);
  const unsubscribe = onValue(path, (snap) => {
    callback(snap.exists() ? snap.val() : null);
  });
  return unsubscribe;
}

/**
 * Push a congestion alert record to Firebase.
 * @param {object} alertData – { zone, level, message, ... }
 */
export async function writeAlert(alertData) {
  const userId = uid();
  if (!userId) return;
  const path = ref(db, `alerts/${userId}`);
  await push(path, {
    ...alertData,
    _written_at: serverTimestamp(),
  });
}

