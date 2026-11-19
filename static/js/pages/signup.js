/**
 * static/js/pages/signup.js
 * Handles the signup page form submission with Firebase Authentication.
 */

import { signUp, onAuthChange } from "../modules/firebase-auth.js";

const form   = document.getElementById("signup-form");
const btn    = document.getElementById("signup-btn");
const msgBox = document.getElementById("auth-message");

/** Redirect if already signed in */
onAuthChange((user) => {
  if (user) window.location.href = "/dashboard";
});

function showMessage(text, isError = true) {
  msgBox.textContent = text;
  msgBox.className   = `auth-message ${isError ? "auth-message--error" : "auth-message--success"}`;
  msgBox.hidden      = false;
}

function setLoading(loading) {
  btn.disabled = loading;
  btn.querySelector(".btn-label").textContent = loading ? "Creating…" : "Create account";
  btn.querySelector(".btn-spinner").hidden     = !loading;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  msgBox.hidden = true;

  const name     = document.getElementById("signup-name").value.trim();
  const email    = document.getElementById("signup-email").value.trim();
  const password = document.getElementById("signup-password").value;

  if (!email || !password) {
    showMessage("Email and password are required.");
    return;
  }
  if (password.length < 6) {
    showMessage("Password must be at least 6 characters.");
    return;
  }

  setLoading(true);
  try {
    await signUp(email, password, name);
    showMessage("Account created! Redirecting to dashboard…", false);
    setTimeout(() => { window.location.href = "/dashboard"; }, 1000);
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
  });
});

