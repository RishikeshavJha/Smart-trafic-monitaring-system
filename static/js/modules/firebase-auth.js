/**
 * static/js/modules/firebase-auth.js
 * Firebase Authentication – login, signup, logout, and auth-state observer.
 *
 * Exports:
 *   signUp(email, password, displayName)  → Promise<UserCredential>
 *   signIn(email, password)               → Promise<UserCredential>
 *   signOut()                             → Promise<void>
 *   onAuthChange(callback)                → unsubscribe function
 *   getCurrentUser()                      → User | null
 */

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

import { auth } from "./firebase-config.js";

/** Map Firebase auth error codes to friendly messages. */
function friendlyError(code) {
  const map = {
    "auth/email-already-in-use":    "An account with this email already exists.",
    "auth/invalid-email":           "Please enter a valid email address.",
    "auth/weak-password":           "Password must be at least 6 characters.",
    "auth/user-not-found":          "No account found with this email.",
    "auth/wrong-password":          "Incorrect password. Please try again.",
    "auth/too-many-requests":       "Too many attempts. Please wait a moment.",
    "auth/network-request-failed":  "Network error. Check your connection.",
    "auth/invalid-credential":      "Invalid credentials. Please try again.",
  };
  return map[code] || "Authentication failed. Please try again.";
}

/**
 * Register a new user with email + password.
 * @param {string} email
 * @param {string} password
 * @param {string} [displayName]
 * @returns {Promise<import("firebase/auth").UserCredential>}
 */
export async function signUp(email, password, displayName = "") {
  try {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    if (displayName.trim()) {
      await updateProfile(credential.user, { displayName: displayName.trim() });
    }
    return credential;
  } catch (err) {
    throw new Error(friendlyError(err.code));
  }
}

/**
 * Sign in an existing user with email + password.
 * @param {string} email
 * @param {string} password
 * @returns {Promise<import("firebase/auth").UserCredential>}
 */
export async function signIn(email, password) {
  try {
    return await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    throw new Error(friendlyError(err.code));
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

