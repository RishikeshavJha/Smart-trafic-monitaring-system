/**
 * static/js/pages/signup.js
 * Redirects or initiates Google Sign-In.
 */

import { signInWithGoogle, onAuthChange } from "../modules/firebase-auth.js";

const googleBtn = document.getElementById("google-signup-btn") || document.getElementById("google-login-btn");
const msgBox    = document.getElementById("auth-message");

onAuthChange((user) => {
  if (user) {
    window.location.href = "/dashboard";
  }
});

function showMessage(text, isError = true) {
  if (!msgBox) return;
  msgBox.textContent = text;
  msgBox.className   = `auth-message ${isError ? "auth-message--error" : "auth-message--success"}`;
  msgBox.hidden      = false;
}

function setLoading(loading) {
  if (!googleBtn) return;
  googleBtn.disabled = loading;
  const label = googleBtn.querySelector(".btn-label");
  const spinner = googleBtn.querySelector(".btn-spinner");
  if (label) label.textContent = loading ? "Connecting with Google…" : "Sign up with Google";
  if (spinner) spinner.hidden = !loading;
}

if (googleBtn) {
  googleBtn.addEventListener("click", async () => {
    if (msgBox) msgBox.hidden = true;
    setLoading(true);

    try {
      const result = await signInWithGoogle();
      showMessage(`Welcome, ${result.user.displayName || result.user.email}! Redirecting…`, false);
      setTimeout(() => {
        window.location.href = "/dashboard";
      }, 600);
    } catch (err) {
      showMessage(err.message, true);
    } finally {
      setLoading(false);
    }
  });
}
