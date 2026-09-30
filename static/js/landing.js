/**
 * static/js/landing.js
 * Landing page interactive controller (ES Module).
 *
 * Responsibilities:
 *  - Dynamically updates the simulated density gauge on the hero SVG visual.
 *  - Implements staggered IntersectionObserver reveal on scroll for features and timeline cards.
 *  - Accessible FAQ Accordion component with ARIA disclosure and keyboard navigation (Enter, Space, ArrowUp, ArrowDown, Home, End).
 *  - Gracefully falls back: if IntersectionObserver is unsupported or
 *    prefers-reduced-motion is active, content is shown immediately without delay.
 */

export function initLandingHero() {
  const countEl = document.getElementById("sim-count-value");
  const levelEl = document.getElementById("sim-density-level");

  if (countEl && levelEl) {
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let intervalId = null;

    function tickTelemetry() {
      if (motionQuery.matches) return;

      // Simulate fluctuating count between 6 and 14 vehicles
      const baseCount = 8;
      const jitter = Math.floor(Math.random() * 7);
      const count = baseCount + jitter;

      countEl.textContent = `${count}`;

      if (count <= 5) {
        levelEl.textContent = "LOW";
        levelEl.style.color = "var(--signal-green)";
      } else if (count <= 15) {
        levelEl.textContent = "MED";
        levelEl.style.color = "var(--signal-amber)";
      } else {
        levelEl.textContent = "HIGH";
        levelEl.style.color = "var(--signal-red)";
      }
    }

    function start() {
      if (!intervalId && !motionQuery.matches) {
        intervalId = setInterval(tickTelemetry, 3000);
        tickTelemetry();
      }
    }

    function stop() {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    }

    motionQuery.addEventListener("change", (e) => {
      if (e.matches) {
        stop();
        countEl.textContent = "9";
        levelEl.textContent = "MED";
        levelEl.style.color = "var(--signal-amber)";
      } else {
        start();
      }
    });

    start();
  }
}

export function initScrollReveal() {
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

  // If reduced motion is requested or IntersectionObserver is missing, abort and show all
  if (motionQuery.matches || !("IntersectionObserver" in window)) {
    return;
  }

  const revealElements = document.querySelectorAll(".reveal-item");
  if (!revealElements.length) return;

  // Mark container to activate initial hidden state
  document.documentElement.classList.add("js-reveal");

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    {
      threshold: 0.15,
      rootMargin: "0px 0px -40px 0px",
    }
  );

  revealElements.forEach((el, index) => {
    const staggerDelay = (index % 3) * 100;
    el.style.transitionDelay = `${staggerDelay}ms`;
    observer.observe(el);
  });
}

export function initFaqAccordion() {
  const triggers = Array.from(document.querySelectorAll(".faq-trigger"));
  if (!triggers.length) return;

  function toggleItem(trigger) {
    const isExpanded = trigger.getAttribute("aria-expanded") === "true";
    const panelId = trigger.getAttribute("aria-controls");
    const panel = document.getElementById(panelId);

    // Close other panels (optional single-open accordion behavior)
    triggers.forEach((otherTrigger) => {
      if (otherTrigger !== trigger) {
        otherTrigger.setAttribute("aria-expanded", "false");
        const otherPanel = document.getElementById(otherTrigger.getAttribute("aria-controls"));
        if (otherPanel) {
          otherPanel.classList.remove("is-open");
        }
      }
    });

    if (isExpanded) {
      trigger.setAttribute("aria-expanded", "false");
      if (panel) panel.classList.remove("is-open");
    } else {
      trigger.setAttribute("aria-expanded", "true");
      if (panel) panel.classList.add("is-open");
    }
  }

  triggers.forEach((trigger, index) => {
    trigger.addEventListener("click", () => toggleItem(trigger));

    // Keyboard navigation: ArrowUp, ArrowDown, Home, End
    trigger.addEventListener("keydown", (e) => {
      let targetIndex = -1;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        targetIndex = (index + 1) % triggers.length;
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        targetIndex = (index - 1 + triggers.length) % triggers.length;
      } else if (e.key === "Home") {
        e.preventDefault();
        targetIndex = 0;
      } else if (e.key === "End") {
        e.preventDefault();
        targetIndex = triggers.length - 1;
      }

      if (targetIndex >= 0) {
        triggers[targetIndex].focus();
      }
    });
  });
}

export function initLandingPage() {
  initLandingHero();
  initScrollReveal();
  initFaqAccordion();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initLandingPage);
} else {
  initLandingPage();
}
