/**
 * static/js/pages/login.js
 * Handles the login page form submission with Firebase Authentication.
 */

import { signIn, onAuthChange } from "../modules/firebase-auth.js";

const form    = document.getElementById("login-form");
const btn     = document.getElementById("login-btn");
const msgBox  = document.getElementById("auth-message");

/** Redirect if already signed in */
onAuthChange((user) => {
  if (user) window.location.href = "/dashboard";
});

/** Show a styled message */
function showMessage(text, isError = true) {
  msgBox.textContent = text;
  msgBox.className   = `auth-message ${isError ? "auth-message--error" : "auth-message--success"}`;
  msgBox.hidden      = false;
}

/** Toggle loading state */
function setLoading(loading) {
  btn.disabled = loading;
  btn.querySelector(".btn-label").textContent  = loading ? "Signing in…" : "Sign in";
  btn.querySelector(".btn-spinner").hidden      = !loading;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  msgBox.hidden = true;

  const email    = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;

  if (!email || !password) {
    showMessage("Please fill in all fields.");
    return;
  }

  setLoading(true);
  try {
    await signIn(email, password);
    showMessage("Signed in! Redirecting…", false);
    setTimeout(() => { window.location.href = "/dashboard"; }, 800);
  } catch (err) {
    showMessage(err.message);
  } finally {
    setLoading(false);
  }
});

/** Toggle password visibility */
document.querySelectorAll(".input-eye").forEach((btn) => {
  btn.addEventListener("click", () => {
    const input = document.getElementById(btn.dataset.target);
    input.type  = input.type === "password" ? "text" : "password";
    btn.setAttribute("aria-label", input.type === "password" ? "Show password" : "Hide password");
  });
});

