/**
 * static/js/modules/firebase-auth.js
 * Firebase Authentication – Google Sign-In, logout, and auth-state observer.
 *
 * Exports:
 *   signInWithGoogle()                    → Promise<UserCredential>
 *   signOut()                             → Promise<void>
 *   onAuthChange(callback)                → unsubscribe function
 *   getCurrentUser()                      → User | null
 */

import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

import { auth } from "./firebase-config.js";

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

/** Map Firebase auth error codes to friendly messages. */
function friendlyError(code) {
  const map = {
    "auth/popup-closed-by-user":   "Sign-in was cancelled.",
    "auth/popup-blocked":          "Sign-in popup was blocked by your browser. Please allow popups.",
    "auth/cancelled-popup-request": "Sign-in request was replaced by another popup.",
    "auth/network-request-failed": "Network error. Please check your connection.",
    "auth/operation-not-allowed":  "Google sign-in is not enabled in Firebase Console.",
    "auth/unauthorized-domain":    "This domain is not authorized in Firebase Console.",
  };
  return map[code] || "Authentication failed. Please try again.";
}

/**
 * Sign in or sign up with Google popup.
 * @returns {Promise<import("firebase/auth").UserCredential>}
 */
export async function signInWithGoogle() {
  try {
    return await signInWithPopup(auth, googleProvider);
  } catch (err) {
    throw new Error(friendlyError(err.code) || err.message);
  }
}

/**
 * Sign out the currently authenticated user.
 * @returns {Promise<void>}
 */
export async function signOut() {
  return firebaseSignOut(auth);
}

/**
 * Subscribe to auth-state changes.
 * @param {(user: import("firebase/auth").User | null) => void} callback
 * @returns {() => void} unsubscribe
 */
export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

/**
 * Returns the currently signed-in Firebase User, or null.
 * @returns {import("firebase/auth").User | null}
 */
export function getCurrentUser() {
  return auth.currentUser;
}
