// Theme toggle: a plain tap/click commits instantly via ink-splash; a
// drag enters brush-paint mode; reduced motion always swaps instantly.
// All paths funnel into one commit finale: flood canvas, swap data-theme
// underneath it, recolor via CSS transition, then clear canvas.
//
// Press-and-hold into brush mode was tried and reverted — a stationary
// touch hold gave no confidence anything happened, so it kept releasing
// before painting. Drag is the only way in; discoverability comes from
// a one-time pulsing cue instead (see clearCue()).
//
// Storage: localStorage.theme is "light" | "dark" or absent (auto/system
// — see head.html's anti-FOUC read of this same key).
(function () {
    "use strict";

    var STORAGE_KEY = "theme";
    var CUE_SEEN_KEY = "themeCueSeen";
    var COMMIT_MS = 340;
    // Mirrors sass/_tokens.scss — canvas fillStyle/strokeStyle can't read
    // CSS custom properties, so the paper colors are duplicated here
    // (same tradeoff static/js/fingerprint.js already makes for its
    // fallback colors).
    var PAPER = { light: "#eef1ee", dark: "#10141a" };

    var button, canvas, ctx, progressEl;
    var idleTitle = "";
    var brushOn = false; // brush mode is armed (cursor changed, listeners attached)
    var painting = false; // pointer is currently down while brushOn
    var committing = false;
    var coverage = 0;
    var lastPoint = null;

    // Only a real drag (past DRAG_THRESHOLD) enters brush mode; tracked via
    // pointerdown/move/up ahead of the native "click". lastPointerUpTime lets
    // onButtonClick ignore that trailing click — a time window instead of a
    // boolean flag, since a flag could go stale if click never fires.
    var DRAG_THRESHOLD = 6; // px
    var dragStart = null;
    var lastPointerUpTime = -1e9;

    function clamp(min, val, max) {
        return Math.max(min, Math.min(max, val));
    }

    function prefersReducedMotion() {
        return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    }

    function isCoarsePointer() {
        return !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
    }

    // One-time cue inviting the drag-to-paint gesture, shown once per
    // visitor (localStorage flag), skipped under reduced motion (a CSS
    // animation), cleared on first interaction regardless of path.
    function markCueSeen() {
        try {
            localStorage.setItem(CUE_SEEN_KEY, "1");
        } catch (e) {}
    }

    function clearCue() {
        if (button.classList.contains("theme-toggle--cue")) {
            button.classList.remove("theme-toggle--cue");
            markCueSeen();
        }
    }

    function resolvedTheme() {
        var explicit = document.documentElement.getAttribute("data-theme");
        if (explicit === "light" || explicit === "dark") return explicit;
        return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }

    function targetTheme() {
        return resolvedTheme() === "dark" ? "light" : "dark";
    }

    // ---- canvas + progress bar (created on demand, not baked into every page) ----

    function ensureCanvas() {
        if (canvas) return canvas;
        canvas = document.createElement("canvas");
        canvas.id = "theme-canvas";
        canvas.setAttribute("aria-hidden", "true");
        document.body.insertBefore(canvas, document.body.firstChild);
        ctx = canvas.getContext("2d");
        resizeCanvas();
        window.addEventListener("resize", resizeCanvas);
        return canvas;
    }

    function resizeCanvas() {
        if (!canvas) return;
        var ratio = window.devicePixelRatio || 1;
        canvas.width = window.innerWidth * ratio;
        canvas.height = window.innerHeight * ratio;
        canvas.style.width = window.innerWidth + "px";
        canvas.style.height = window.innerHeight + "px";
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    }

    function ensureProgress() {
        if (progressEl) return progressEl;
        progressEl = document.createElement("div");
        progressEl.id = "theme-progress";
        document.body.insertBefore(progressEl, document.body.firstChild);
        return progressEl;
    }

    function setProgress(ratio) {
        if (!progressEl) return;
        progressEl.style.width = clamp(0, ratio, 1) * 100 + "%";
    }

    // ---- utterances iframe theme sync ----

    function updateUtterances(theme) {
        var iframe = document.querySelector(".utterances-frame");
        if (iframe && iframe.contentWindow) {
            iframe.contentWindow.postMessage(
                { type: "set-theme", theme: theme === "dark" ? "github-dark" : "github-light" },
                "https://utteranc.es"
            );
            return;
        }
        // Not loaded yet on this page load — build it with the correct
        // initial theme instead of letting it default to config's value.
        var mount = document.getElementById("utterances-mount");
        if (mount && !mount.dataset.loaded) {
            var script = document.createElement("script");
            script.src = "https://utteranc.es/client.js";
            script.setAttribute("repo", mount.dataset.repo);
            script.setAttribute("issue-term", mount.dataset.issueTerm);
            script.setAttribute("theme", theme === "dark" ? "github-dark" : "github-light");
            script.setAttribute("crossorigin", "anonymous");
            script.async = true;
            mount.dataset.loaded = "true";
            mount.appendChild(script);
        }
    }

    function dispatchThemeChange() {
        document.dispatchEvent(new CustomEvent("themechange"));
    }

    // ---- commit / reset ----

    function commit(theme) {
        committing = true;
        if (ctx && canvas) {
            ctx.globalAlpha = 1;
            ctx.fillStyle = PAPER[theme];
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        requestAnimationFrame(function () {
            document.documentElement.setAttribute("data-theme", theme);
            try {
                localStorage.setItem(STORAGE_KEY, theme);
            } catch (e) {}
            document.documentElement.classList.add("recolor");
            button.setAttribute("aria-pressed", "true");
            dispatchThemeChange();
            updateUtterances(theme);

            setTimeout(function () {
                document.documentElement.classList.remove("recolor");
                if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
                teardownPainting();
            }, COMMIT_MS);
        });
    }

    function resetToAuto() {
        document.documentElement.removeAttribute("data-theme");
        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch (e) {}
        document.documentElement.classList.add("recolor");
        button.setAttribute("aria-pressed", "false");
        dispatchThemeChange();
        updateUtterances(resolvedTheme());
        setTimeout(function () {
            document.documentElement.classList.remove("recolor");
        }, COMMIT_MS);
    }

    function instantSwap() {
        var theme = targetTheme();
        document.documentElement.setAttribute("data-theme", theme);
        try {
            localStorage.setItem(STORAGE_KEY, theme);
        } catch (e) {}
        button.setAttribute("aria-pressed", "true");
        dispatchThemeChange();
        updateUtterances(theme);
    }

    function teardownPainting() {
        document.body.classList.remove("theme-painting");
        setProgress(0);
        coverage = 0;
        lastPoint = null;
        committing = false;
        button.removeAttribute("data-state");
        button.title = idleTitle;
    }

    // ---- brush mode (mouse drag) ----

    function enterBrushMode() {
        ensureCanvas();
        ensureProgress();
        resizeCanvas();
        coverage = 0;
        setProgress(0);
        painting = false;
        brushOn = true;
        document.body.classList.add("brush-mode", "theme-painting");
        button.setAttribute("data-state", "armed");
        button.title = "Drag to paint the theme in — click again or press Escape to cancel.";
        window.addEventListener("pointerdown", onPointerDown);
        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", onPointerUp);
    }

    function exitBrushMode(cancelled) {
        brushOn = false;
        painting = false;
        window.removeEventListener("pointerdown", onPointerDown);
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        document.body.classList.remove("brush-mode");
        if (cancelled) {
            fadeCancel();
        }
    }

    function fadeCancel() {
        if (!canvas) {
            teardownPainting();
            return;
        }
        canvas.style.transition = "opacity 0.3s ease";
        canvas.style.opacity = "0";
        setTimeout(function () {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            canvas.style.transition = "";
            canvas.style.opacity = "1";
            teardownPainting();
        }, 300);
    }

    function onPointerDown(e) {
        if (!brushOn || committing) return;
        painting = true;
        lastPoint = { x: e.clientX, y: e.clientY, t: performance.now() };
    }

    function onPointerMove(e) {
        if (!painting || committing) return;
        var point = { x: e.clientX, y: e.clientY, t: performance.now() };
        if (lastPoint) paintStroke(lastPoint, point);
        lastPoint = point;
    }

    function onPointerUp() {
        painting = false;
        lastPoint = null;
    }

    function paintStroke(from, to) {
        var dx = to.x - from.x;
        var dy = to.y - from.y;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 0.5) return;

        var dt = Math.max(1, to.t - from.t);
        var speed = dist / dt;
        var width = clamp(22, 58 - speed * 0.9, 58);
        var theme = targetTheme();
        var color = PAPER[theme];

        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        // Main stroke.
        ctx.globalAlpha = 1;
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();

        // Thin offset bristle strokes, perpendicular to the stroke direction.
        var nx = -dy / dist;
        var ny = dx / dist;
        var offsets = [-0.42, 0.12, 0.42];
        for (var i = 0; i < offsets.length; i++) {
            var jitter = (Math.random() - 0.5) * 3;
            var ox = nx * width * offsets[i] + jitter;
            var oy = ny * width * offsets[i] + jitter;
            ctx.globalAlpha = 0.35;
            ctx.strokeStyle = color;
            ctx.lineWidth = 3 + Math.random() * 4;
            ctx.beginPath();
            ctx.moveTo(from.x + ox, from.y + oy);
            ctx.lineTo(to.x + ox, to.y + oy);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;

        coverage += (dist * width) / (window.innerWidth * window.innerHeight);
        setProgress(coverage);

        if (coverage >= 0.5 && !committing) {
            painting = false;
            exitBrushMode(false);
            commit(theme);
        }
    }

    // ---- ink-splash fallback (touch / keyboard activation) ----

    function mulberry32(seed) {
        var a = seed | 0;
        return function () {
            a = (a + 0x6d2b79f5) | 0;
            var t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function runSplash(origin) {
        ensureCanvas();
        ensureProgress();
        resizeCanvas();
        coverage = 0;
        setProgress(0);
        committing = false;
        document.body.classList.add("theme-painting");
        button.setAttribute("data-state", "armed");

        var theme = targetTheme();
        var color = PAPER[theme];
        var rand = mulberry32(((origin.x * 1000) ^ (origin.y * 37) ^ Date.now()) | 0);
        var count = 100;
        var splashes = [];
        var maxReach = Math.max(window.innerWidth, window.innerHeight) * 0.85;

        for (var i = 0; i < count; i++) {
            var angle = rand() * Math.PI * 2;
            var dist = 60 + rand() * maxReach;
            splashes.push({
                angle: angle,
                dist: dist,
                delay: rand() * 300,
                bow: (rand() - 0.5) * dist * 0.7,
                width: 12 + rand() * 24
            });
        }

        var start = performance.now();
        var totalDuration = 620;

        function frame(now) {
            var elapsed = now - start;
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            var totalCoverage = 0;
            for (var i = 0; i < splashes.length; i++) {
                var s = splashes[i];
                if (elapsed < s.delay) continue;
                var local = clamp(0, (elapsed - s.delay) / 320, 1);
                var eased = 1 - Math.pow(1 - local, 2);
                var x1 = origin.x + Math.cos(s.angle) * s.dist * eased;
                var y1 = origin.y + Math.sin(s.angle) * s.dist * eased;
                var cx = origin.x + Math.cos(s.angle + Math.PI / 2) * s.bow * eased + (origin.x - x1) * 0.3;
                var cy = origin.y + Math.sin(s.angle + Math.PI / 2) * s.bow * eased + (origin.y - y1) * 0.3;

                ctx.globalAlpha = 0.9;
                ctx.strokeStyle = color;
                ctx.lineCap = "round";
                ctx.lineWidth = s.width * eased + 2;
                ctx.beginPath();
                ctx.moveTo(origin.x, origin.y);
                ctx.quadraticCurveTo(cx, cy, x1, y1);
                ctx.stroke();

                totalCoverage += (s.dist * eased * s.width) / (window.innerWidth * window.innerHeight);
            }
            ctx.globalAlpha = 1;
            setProgress(totalCoverage);

            if (elapsed < totalDuration) {
                requestAnimationFrame(frame);
            } else {
                commit(theme);
            }
        }
        requestAnimationFrame(frame);
    }

    // ---- click-vs-drag detection (mouse and touch) ----
    //
    // One way into brush mode: move past DRAG_THRESHOLD before release.
    // A plain release before that is a normal tap/click and commits
    // instantly via ink-splash.

    function onDragStartMove(e) {
        var dx = e.clientX - dragStart.x;
        var dy = e.clientY - dragStart.y;
        if (Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD) return;

        window.removeEventListener("pointermove", onDragStartMove);
        window.removeEventListener("pointerup", onDragStartUp);
        lastPointerUpTime = performance.now();

        enterBrushMode();
        painting = true;
        lastPoint = dragStart;
        paintStroke(dragStart, { x: e.clientX, y: e.clientY, t: performance.now() });
        lastPoint = { x: e.clientX, y: e.clientY, t: performance.now() };
        dragStart = null;
    }

    function onDragStartUp(e) {
        window.removeEventListener("pointermove", onDragStartMove);
        window.removeEventListener("pointerup", onDragStartUp);
        lastPointerUpTime = performance.now();
        dragStart = null;
        // preventDefault() in onButtonPointerDown (below) stops the
        // synthetic click along with its default focus-on-click behavior
        // in some browsers — restore it explicitly.
        button.focus();
        if (prefersReducedMotion()) {
            instantSwap();
            return;
        }
        runSplash({ x: e.clientX, y: e.clientY });
    }

    function onButtonPointerDown(e) {
        if (brushOn || committing) return;
        // preventDefault() stops touch's synthetic "click" at the source — a
        // timing-window check alone raced runSplash()'s 600ms+ animation: a
        // second splash firing mid-animation could commit back to the theme
        // just left, causing a "swaps then reverts" bug.
        e.preventDefault();
        clearCue();
        dragStart = { x: e.clientX, y: e.clientY, t: performance.now() };
        window.addEventListener("pointermove", onDragStartMove);
        window.addEventListener("pointerup", onDragStartUp);
    }

    // ---- wiring ----

    function onButtonClick(e) {
        if (committing) return;
        clearCue();
        // A mouse click was already resolved (splash or drag-into-brush) by
        // the pointerdown/up handlers above — this is the "click" event
        // that always follows; ignore it instead of double-handling.
        if (performance.now() - lastPointerUpTime < 50) return;

        // Checked first regardless of modifiers — an armed brush must always
        // be cancelable, otherwise a shift-click falls through to
        // resetToAuto() while brushOn/listeners/body.brush-mode stay stuck on.
        if (brushOn) {
            exitBrushMode(true);
            return;
        }
        if (e.shiftKey) {
            resetToAuto();
            return;
        }
        if (prefersReducedMotion()) {
            instantSwap();
            return;
        }

        // Keyboard-triggered clicks (Enter/Space) report detail === 0;
        // touch devices are identified by their primary pointer type.
        var useSplash = e.detail === 0 || isCoarsePointer();
        if (useSplash) {
            var rect = button.getBoundingClientRect();
            runSplash({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
        } else {
            enterBrushMode();
        }
    }

    function onKeyDown(e) {
        if (e.key === "Escape" && brushOn) {
            exitBrushMode(true);
        }
    }

    // Exposed for the ⌘K palette's "theme:paint" command — arms the same
    // brush mode a drag would. No-ops if already armed/committing or under
    // reduced motion.
    window.__armThemeBrush = function () {
        if (!button || brushOn || committing || prefersReducedMotion()) return;
        enterBrushMode();
    };

    function init() {
        button = document.getElementById("theme-toggle");
        if (!button) return;

        idleTitle = button.title;
        button.setAttribute("aria-pressed", document.documentElement.hasAttribute("data-theme") ? "true" : "false");
        button.addEventListener("pointerdown", onButtonPointerDown);
        button.addEventListener("click", onButtonClick);
        document.addEventListener("keydown", onKeyDown);

        var cueSeen = true;
        try {
            cueSeen = !!localStorage.getItem(CUE_SEEN_KEY);
        } catch (e) {}
        if (!cueSeen && !prefersReducedMotion()) {
            button.classList.add("theme-toggle--cue");
        }

        // Match the utterances embed's initial theme to what actually
        // resolved on this load (system or explicit), not config's default.
        updateUtterances(resolvedTheme());
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
