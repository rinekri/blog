// Mobile nav disclosure: hamburger toggle + slide-down panel, used once
// .site-nav no longer fits the header row. Panel transitions via
// max-height, so a naive show/hide would leave links keyboard-focusable
// while invisible — toggling `hidden` in a two-phase sequence avoids that.
(function () {
    "use strict";

    var toggle = document.getElementById("nav-toggle");
    var panel = document.getElementById("site-nav-panel");
    if (!toggle || !panel) return;

    var BREAKPOINT = 800;
    var TRANSITION_MS = 250;
    var closeTimer = null;

    function prefersReducedMotion() {
        return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    }

    function isOpen() {
        return toggle.getAttribute("aria-expanded") === "true";
    }

    function open() {
        if (closeTimer) {
            clearTimeout(closeTimer);
            closeTimer = null;
        }
        panel.removeAttribute("hidden");
        requestAnimationFrame(function () {
            panel.classList.add("is-open");
        });
        toggle.setAttribute("aria-expanded", "true");
        document.body.classList.add("nav-open");
        if (!prefersReducedMotion()) {
            var firstLink = panel.querySelector("a");
            if (firstLink) firstLink.focus();
        }
    }

    function close(returnFocus) {
        panel.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
        document.body.classList.remove("nav-open");
        closeTimer = setTimeout(function () {
            panel.setAttribute("hidden", "");
            closeTimer = null;
        }, TRANSITION_MS);
        if (returnFocus) toggle.focus();
    }

    toggle.addEventListener("click", function () {
        if (isOpen()) {
            close(false);
        } else {
            open();
        }
    });

    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && isOpen()) close(true);
    });

    document.addEventListener("pointerdown", function (e) {
        if (!isOpen()) return;
        if (panel.contains(e.target) || toggle.contains(e.target)) return;
        close(false);
    });

    panel.addEventListener("click", function (e) {
        if (e.target.tagName === "A" && isOpen()) close(false);
    });

    window.addEventListener("resize", function () {
        if (isOpen() && window.innerWidth > BREAKPOINT) close(false);
    });
})();
