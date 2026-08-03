// /about/'s generative "portrait": four concentric rings, one per page
// section, innermost to outermost matching the page's top-to-bottom order.
// Strokes are polar (angle + radius around center) rather than
// fingerprint.js's scattered x/y field. Same FNV hash + mulberry32 PRNG as
// fingerprint.js/signature.js, seeded per-ring off
// hashSeed(canvas's data-seed + ":" + sectionKey).
//
// Rings start dim and light one at a time as their <section
// data-portrait-ring="..."> scrolls into view (IntersectionObserver), then
// stay lit — draw() only re-runs on that event or a theme change, never a
// timer/rAF loop.
import { hashSeed, mulberry32 } from "./prng.js";

(function () {
    "use strict";

    var canvas = document.querySelector(".portrait-canvas");
    if (!canvas) return;
    var ctx = canvas.getContext("2d");

    function readColor(name, fallback) {
        var value = getComputedStyle(document.documentElement).getPropertyValue(name);
        return value ? value.trim() : fallback;
    }

    function prefersReducedMotion() {
        return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    }

    var BASE_SEED = canvas.dataset.seed || "portrait";
    // Innermost to outermost, matching the page's section order top to bottom.
    var SECTION_KEYS = ["career", "infrastructure", "off-the-clock", "purpose"];

    var state = {
        w: 0,
        h: 0,
        cx: 0,
        cy: 0,
        innerHole: 0,
        ringGap: 0,
        rings: [],
        reducedMotion: prefersReducedMotion(),
        lit: {} // sectionKey -> true, once its ring has been triggered
    };

    // ---- geometry ----

    function buildRing(key, index) {
        var rand = mulberry32(hashSeed(BASE_SEED + ":" + key));
        var radius = state.innerHole + state.ringGap * (index + 1);
        var strokeCount = 20 + Math.floor(rand() * 14);
        var strokes = [];
        for (var i = 0; i < strokeCount; i++) {
            var angleStart = rand() * Math.PI * 2;
            strokes.push({
                angleStart: angleStart,
                arcLen: 0.08 + rand() * 0.22,
                radiusJitter: (rand() - 0.5) * state.ringGap * 0.4,
                lineWidth: 1 + rand() * 1.8,
                alphaJitter: rand()
            });
        }
        return {
            key: key,
            radius: radius,
            strokes: strokes,
            lit: state.reducedMotion || !!state.lit[key]
        };
    }

    function resizeCanvas() {
        var ratio = window.devicePixelRatio || 1;
        var rect = canvas.getBoundingClientRect();
        state.w = rect.width || canvas.clientWidth || 320;
        state.h = rect.height || canvas.clientHeight || 320;

        canvas.width = state.w * ratio;
        canvas.height = state.h * ratio;
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

        state.cx = state.w / 2;
        state.cy = state.h / 2;

        var margin = Math.min(state.w, state.h) * 0.06;
        var maxRadius = Math.min(state.w, state.h) / 2 - margin;
        // Reserve a center hole for the real photo (.portrait-photo in
        // sass/_about.scss) — rings pack into the band outside it.
        state.innerHole = maxRadius * 0.52;
        state.ringGap = (maxRadius - state.innerHole) / SECTION_KEYS.length;

        state.rings = SECTION_KEYS.map(buildRing);
    }

    // ---- drawing ----

    function draw() {
        ctx.clearRect(0, 0, state.w, state.h);

        var moss = readColor("--moss", "#2f5942");
        var inkFaint = readColor("--ink-faint", "#5c6a61");
        var spark = readColor("--spark", "#b8721a");
        var sparkDeep = readColor("--spark-deep", "#8a5613");

        state.rings.forEach(function (ring) {
            var colorA = ring.lit ? spark : moss;
            var colorB = ring.lit ? sparkDeep : inkFaint;
            var alphaBase = ring.lit ? 0.55 : 0.28;
            var alphaSpan = ring.lit ? 0.4 : 0.42;

            ring.strokes.forEach(function (stroke, i) {
                ctx.beginPath();
                ctx.arc(
                    state.cx,
                    state.cy,
                    ring.radius + stroke.radiusJitter,
                    stroke.angleStart,
                    stroke.angleStart + stroke.arcLen
                );
                ctx.strokeStyle = i % 2 === 0 ? colorA : colorB;
                ctx.globalAlpha = alphaBase + stroke.alphaJitter * alphaSpan;
                ctx.lineWidth = stroke.lineWidth;
                ctx.lineCap = "round";
                ctx.stroke();
            });
        });

        ctx.globalAlpha = 1;
    }

    // ---- scroll-triggered lighting ----

    function lightRing(key) {
        if (state.lit[key]) return;
        state.lit[key] = true;
        state.rings.forEach(function (ring) {
            if (ring.key === key) ring.lit = true;
        });
        draw();
    }

    function initObserver() {
        var sections = document.querySelectorAll("[data-portrait-ring]");
        if (!sections.length) return;

        if (state.reducedMotion || !("IntersectionObserver" in window)) {
            // Reduced motion (or no IO support): everything is already lit
            // in buildRing() above — no scroll-triggered lighting at all.
            return;
        }

        var observer = new IntersectionObserver(
            function (entries) {
                entries.forEach(function (entry) {
                    if (!entry.isIntersecting) return;
                    var key = entry.target.getAttribute("data-portrait-ring");
                    if (key) lightRing(key);
                    observer.unobserve(entry.target);
                });
            },
            { threshold: 0.4 }
        );

        sections.forEach(function (section) {
            observer.observe(section);
        });
    }

    // ---- resize / theme-change wiring ----

    var resizeTimer = null;
    function onResize() {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () {
            resizeCanvas();
            draw();
        }, 120);
    }
    window.addEventListener("resize", onResize);

    document.addEventListener("themechange", draw);

    if (window.matchMedia) {
        window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () {
            if (!document.documentElement.getAttribute("data-theme")) {
                draw();
            }
        });
        window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", function () {
            state.reducedMotion = prefersReducedMotion();
        });
    }

    function init() {
        resizeCanvas();
        draw();
        initObserver();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
