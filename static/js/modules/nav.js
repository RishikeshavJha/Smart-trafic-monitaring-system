/**
 * static/js/modules/nav.js
 * Mobile navigation controller with accessible focus trap and scroll lock.
 *
 * Requirements:
 *  - Collapses below 900px into full-screen overlay hamburger menu.
 *  - Manages aria-expanded and aria-controls on the trigger button.
 *  - Traps keyboard focus within the open mobile menu (Tab / Shift+Tab).
 *  - Closes on Escape key press and returns focus to the trigger button.
 *  - Locks body scroll when open (overflow: hidden on body).
 */

const FOCUSABLE_SELECTORS = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export function initMobileNav() {
  const toggleBtn = document.querySelector(".nav-toggle");
  const navMenu = document.getElementById("primary-nav-menu");

  if (!toggleBtn || !navMenu) return;

  let isMenuOpen = false;

  function openMenu() {
    isMenuOpen = true;
    toggleBtn.setAttribute("aria-expanded", "true");
    navMenu.classList.add("is-open");
    document.body.classList.add("nav-open");

    // Focus the first focusable element inside the menu
    const focusable = navMenu.querySelectorAll(FOCUSABLE_SELECTORS);
    if (focusable.length > 0) {
      focusable[0].focus();
    }
  }

  function closeMenu() {
    if (!isMenuOpen) return;
    isMenuOpen = false;
    toggleBtn.setAttribute("aria-expanded", "false");
    navMenu.classList.remove("is-open");
    document.body.classList.remove("nav-open");

    // Return focus to the trigger button
    toggleBtn.focus();
  }

  toggleBtn.addEventListener("click", () => {
    if (isMenuOpen) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  // Global keydown listener for Focus Trap and ESC handling
  document.addEventListener("keydown", (e) => {
    if (!isMenuOpen) return;

    if (e.key === "Escape") {
      e.preventDefault();
      closeMenu();
      return;
    }

    if (e.key === "Tab") {
      const focusable = Array.from(navMenu.querySelectorAll(FOCUSABLE_SELECTORS));
      // Include toggleBtn in the trap cycle
      const allFocusable = [toggleBtn, ...focusable];
      const firstEl = allFocusable[0];
      const lastEl = allFocusable[allFocusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        }
      } else {
        if (document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    }
  });

  // Close menu if user clicks outside or on a nav link
  navMenu.addEventListener("click", (e) => {
    if (e.target.closest("a.nav-link") || e.target.closest("a.nav-cta")) {
      closeMenu();
    }
  });

  // Automatically close menu if resized back to desktop (> 900px)
  window.addEventListener("resize", () => {
    if (window.innerWidth >= 900 && isMenuOpen) {
      closeMenu();
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initMobileNav);
} else {
  initMobileNav();
}
