// Hero "signature wall": one composite flow-field canvas from every
// project seed in data/projects.toml. Same FNV hash + mulberry32 PRNG
// as fingerprint.js, shared via static/js/prng.js.
//
// Each seed gets a deterministic cluster centroid + hit-radius. Hovering
// casts a spotlight via a radial-gradient overlay drawn on top of the dim
// base strokes — canvas fades the gradient to transparent automatically,
// so no per-stroke animation state is needed. Cluster geometry is
// computed once per resize/theme-change and cached; draw() only re-runs
// on pointer events, never a continuous loop.
import { hashSeed, mulberry32 } from "./prng.js";

(function () {
    "use strict";

    var section = document.querySelector(".signature-hero");
    if (!section) return;
    var canvas = section.querySelector(".signature-hero__canvas");
    if (!canvas) return;
    var ctx = canvas.getContext("2d");

    function readColor(name, fallback) {
        var value = getComputedStyle(document.documentElement).getPropertyValue(name);
        return value ? value.trim() : fallback;
    }

    function clamp(min, val, max) {
        return Math.max(min, Math.min(max, val));
    }

    function hexToRgb(hex) {
        var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        if (!m) return { r: 0, g: 0, b: 0 };
        return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
    }

    // ---- seed data ----

    var seedsData = [];
    try {
        seedsData = JSON.parse(section.getAttribute("data-seeds") || "[]");
    } catch (e) {
        seedsData = [];
    }

    function prefersReducedMotion() {
        return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    }

    var state = {
        w: 0,
        h: 0,
        hitRadius: 0,
        strokeSpan: 0,
        lightRadius: 0,
        clusters: [],
        hovered: null, // cluster under the pointer right now — drives label/click only
        pointer: null, // {x, y} live cursor position, canvas-local
        pointerActive: false,
        fadeAlpha: 0, // spotlight strength; 1 while hovering, eased to 0 on pointer leave
        fadeRafId: null,
        reducedMotion: prefersReducedMotion(),
        categoryFilter: null // null = show all; else "leadership"/"architecture"/"feature"
    };

    var FADE_MS = 220;

    // ---- label (created on demand, same "ensure" pattern as theme.js) ----

    var label;
    function ensureLabel() {
        if (label) return label;
        label = document.createElement("div");
        label.className = "signature-hero__label";
        label.setAttribute("aria-hidden", "true");
        section.appendChild(label);
        return label;
    }

    function showLabel(cluster) {
        ensureLabel();
        label.textContent = cluster.name;
        label.style.left = cluster.cx + "px";
        label.style.top = cluster.cy + "px";
        label.classList.add("is-visible");
    }

    function hideLabel() {
        if (!label) return;
        label.classList.remove("is-visible");
    }

    // ---- clusters ----

    // Each cluster gets its own mulberry32 instance from its project seed.
    // Called once per resize/theme-change and cached in state.clusters —
    // not recomputed per frame (re-running ~38 clusters' geometry at 60fps
    // was the source of the "laggy" hover).
    function computeClusters() {
        var n = seedsData.length || 1;
        // Partition the canvas into a grid sized to seed count + aspect
        // ratio, one cluster per cell, then jitter within the cell —
        // guarantees even minimum spacing without a rejection/retry loop,
        // staying deterministic for a given seed set + canvas size.
        var aspect = state.w / (state.h || 1);
        var cols = Math.max(1, Math.round(Math.sqrt(n * aspect)));
        var rows = Math.max(1, Math.ceil(n / cols));
        // Usable area mirrors the old edge margins (0.08–0.92 horizontally,
        // 0.12–0.84 vertically) so centroids still stay clear of the canvas
        // edge and strokes don't get clipped.
        var marginX = state.w * 0.08;
        var marginY = state.h * 0.12;
        var usableW = state.w * 0.84;
        var usableH = state.h * 0.72;
        var cellW = usableW / cols;
        var cellH = usableH / rows;

        return seedsData.map(function (item, index) {
            var rand = mulberry32(hashSeed(item.seed || item.name || "signature"));
            var col = index % cols;
            var row = Math.floor(index / cols);
            // Jitter within the middle 60% of the cell (0.2–0.8) so the
            // layout doesn't read as a rigid grid, while never drifting far
            // enough to crowd a neighboring cell's cluster.
            var cx = marginX + cellW * (col + 0.2 + rand() * 0.6);
            var cy = marginY + cellH * (row + 0.2 + rand() * 0.6);

            var strokeCount = 6 + Math.floor(rand() * 6);
            var strokes = [];
            for (var s = 0; s < strokeCount; s++) {
                var x0 = (rand() - 0.5) * state.strokeSpan * 0.7;
                var y0 = (rand() - 0.5) * state.strokeSpan * 0.7;
                var ang = rand() * Math.PI * 2;
                var len = state.strokeSpan * (0.5 + rand() * 1.1);
                var bend = (rand() - 0.5) * 1.4;
                var ex = x0 + Math.cos(ang) * len;
                var ey = y0 + Math.sin(ang) * len;
                var mx = x0 + Math.cos(ang) * len * 0.5 + bend * 18;
                var my = y0 + Math.sin(ang) * len * 0.5 - bend * 18;
                strokes.push({
                    x0: x0,
                    y0: y0,
                    mx: mx,
                    my: my,
                    ex: ex,
                    ey: ey,
                    alphaJitter: rand(),
                    widthJitter: rand()
                });
            }

            return {
                seed: item.seed,
                name: item.name,
                url: item.url,
                category: item.category || "feature",
                cx: cx,
                cy: cy,
                strokes: strokes
            };
        });
    }

    // ---- sizing ----

    function resizeCanvas() {
        var ratio = window.devicePixelRatio || 1;
        var rect = canvas.getBoundingClientRect();
        state.w = rect.width || canvas.clientWidth || 320;
        state.h = rect.height || canvas.clientHeight || 480;

        canvas.width = state.w * ratio;
        canvas.height = state.h * ratio;
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

        var minSide = Math.min(state.w, state.h);
        // Hover/click target radius around each cluster's centroid — kept
        // generous but well under the typical nearest-centroid spacing for
        // ~38 scattered points, so adjacent clusters don't fight for hover.
        state.hitRadius = clamp(56, minSide * 0.1, 130);
        // Visual footprint of a cluster's strokes — sized up from the
        // original mockup-matched value so the field reads as full/dense
        // rather than sparse dots, per redesign feedback.
        state.strokeSpan = clamp(44, minSide * 0.075, 100);
        // Spotlight radius — how far the cursor-following light reaches.
        state.lightRadius = clamp(120, minSide * 0.2, 260);

        state.clusters = computeClusters();
    }

    // ---- drawing ----

    function drawDim(clusters, moss, inkSoft) {
        clusters.forEach(function (cluster) {
            // A category filter fades non-matching clusters to near-nothing
            // instead of hiding them outright — the field stays readable as
            // one whole, with the selected category clearly standing out.
            var catAlpha = (!state.categoryFilter || cluster.category === state.categoryFilter) ? 1 : 0.12;
            cluster.strokes.forEach(function (stroke, i) {
                ctx.beginPath();
                ctx.moveTo(cluster.cx + stroke.x0, cluster.cy + stroke.y0);
                ctx.quadraticCurveTo(
                    cluster.cx + stroke.mx,
                    cluster.cy + stroke.my,
                    cluster.cx + stroke.ex,
                    cluster.cy + stroke.ey
                );
                ctx.strokeStyle = i % 2 === 0 ? moss : inkSoft;
                ctx.globalAlpha = (0.18 + stroke.alphaJitter * 0.32) * catAlpha;
                ctx.lineWidth = 1 + stroke.widthJitter * 1.5;
                ctx.lineCap = "round";
                ctx.stroke();
            });
        });
        ctx.globalAlpha = 1;
    }

    // Two radial gradients (spark/spark-deep) centered on the cursor, opaque
    // at center, transparent past state.lightRadius — canvas clips
    // automatically, so a stroke crossing the edge only shows color inside it.
    function drawSpotlight(clusters, spark, sparkDeep, alphaMult) {
        var px = state.pointer.x;
        var py = state.pointer.y;
        var r = state.lightRadius;

        function makeGradient(hex) {
            var rgb = hexToRgb(hex);
            var g = ctx.createRadialGradient(px, py, 0, px, py, r);
            g.addColorStop(0, "rgba(" + rgb.r + "," + rgb.g + "," + rgb.b + "," + 0.95 * alphaMult + ")");
            g.addColorStop(0.55, "rgba(" + rgb.r + "," + rgb.g + "," + rgb.b + "," + 0.5 * alphaMult + ")");
            g.addColorStop(1, "rgba(" + rgb.r + "," + rgb.g + "," + rgb.b + ",0)");
            return g;
        }

        var sparkGrad = makeGradient(spark);
        var sparkDeepGrad = makeGradient(sparkDeep);
        // Footprint a cluster's strokes can reach from its centroid — used
        // to skip clusters nowhere near the cursor instead of walking their
        // strokes every frame.
        var reach = r + state.strokeSpan * 1.8;

        clusters.forEach(function (cluster) {
            if (state.categoryFilter && cluster.category !== state.categoryFilter) return;
            var dx = cluster.cx - px;
            var dy = cluster.cy - py;
            if (dx * dx + dy * dy > reach * reach) return;

            cluster.strokes.forEach(function (stroke, i) {
                ctx.beginPath();
                ctx.moveTo(cluster.cx + stroke.x0, cluster.cy + stroke.y0);
                ctx.quadraticCurveTo(
                    cluster.cx + stroke.mx,
                    cluster.cy + stroke.my,
                    cluster.cx + stroke.ex,
                    cluster.cy + stroke.ey
                );
                ctx.strokeStyle = i % 2 === 0 ? sparkGrad : sparkDeepGrad;
                ctx.lineWidth = 1.6 + stroke.widthJitter * 2.2;
                ctx.lineCap = "round";
                ctx.stroke();
            });
        });
    }

    function draw() {
        ctx.clearRect(0, 0, state.w, state.h);

        var moss = readColor("--moss", "#2f5942");
        var inkSoft = readColor("--ink-soft", "#47564c");
        var spark = readColor("--spark", "#c17a1f");
        var sparkDeep = readColor("--spark-deep", "#8f5a12");

        drawDim(state.clusters, moss, inkSoft);

        if (state.reducedMotion) {
            // No cursor-follow motion for reduced-motion users — just an
            // instant flat highlight on whichever cluster is hit, same as
            // the pre-spotlight behavior.
            if (state.hovered) {
                state.hovered.strokes.forEach(function (stroke, i) {
                    ctx.beginPath();
                    ctx.moveTo(state.hovered.cx + stroke.x0, state.hovered.cy + stroke.y0);
                    ctx.quadraticCurveTo(
                        state.hovered.cx + stroke.mx,
                        state.hovered.cy + stroke.my,
                        state.hovered.cx + stroke.ex,
                        state.hovered.cy + stroke.ey
                    );
                    ctx.strokeStyle = i % 2 === 0 ? spark : sparkDeep;
                    ctx.globalAlpha = 0.5 + stroke.alphaJitter * 0.45;
                    ctx.lineWidth = 1.3 + stroke.widthJitter * 2;
                    ctx.lineCap = "round";
                    ctx.stroke();
                });
                ctx.globalAlpha = 1;
            }
            return;
        }

        if (state.pointer && state.fadeAlpha > 0) {
            drawSpotlight(state.clusters, spark, sparkDeep, state.fadeAlpha);
        }
    }

    function stopFade() {
        if (state.fadeRafId != null) {
            cancelAnimationFrame(state.fadeRafId);
            state.fadeRafId = null;
        }
    }

    function startFadeOut() {
        stopFade();
        var start = performance.now();
        var from = state.fadeAlpha;
        function step(now) {
            var t = clamp(0, (now - start) / FADE_MS, 1);
            state.fadeAlpha = from * (1 - t);
            draw();
            if (t < 1) {
                state.fadeRafId = requestAnimationFrame(step);
            } else {
                state.fadeRafId = null;
                state.pointer = null;
            }
        }
        state.fadeRafId = requestAnimationFrame(step);
    }

    // ---- hit-testing ----

    function clusterAt(x, y) {
        var closest = null;
        var closestDist = state.hitRadius;
        for (var i = 0; i < state.clusters.length; i++) {
            var c = state.clusters[i];
            if (state.categoryFilter && c.category !== state.categoryFilter) continue;
            var dx = x - c.cx;
            var dy = y - c.cy;
            var dist = Math.sqrt(dx * dx + dy * dy);
            if (dist <= closestDist) {
                closest = c;
                closestDist = dist;
            }
        }
        return closest;
    }

    function eventPoint(e) {
        var rect = canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function onPointerMove(e) {
        if (e.pointerType === "touch") return;
        var p = eventPoint(e);
        stopFade();
        state.pointer = p;
        state.pointerActive = true;
        state.fadeAlpha = 1;

        var hit = clusterAt(p.x, p.y);
        if (hit !== state.hovered) {
            state.hovered = hit;
            if (hit) showLabel(hit);
            else hideLabel();
        }
        draw();
    }

    function onPointerLeave() {
        if (!state.pointerActive) return;
        state.pointerActive = false;
        state.hovered = null;
        hideLabel();
        if (state.reducedMotion) {
            state.fadeAlpha = 0;
            state.pointer = null;
            draw();
        } else {
            startFadeOut();
        }
    }

    function onClick(e) {
        var p = eventPoint(e);
        var hit = clusterAt(p.x, p.y);
        if (!hit) return;
        window.location.href = "/projects/#project-" + hit.seed;
    }

    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("click", onClick);

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

    document.addEventListener("themechange", function () {
        draw();
    });

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

    var catButtons = section.querySelectorAll(".signature-hero__catbtn");
    catButtons.forEach(function (btn) {
        btn.addEventListener("click", function () {
            catButtons.forEach(function (b) { b.classList.remove("is-active"); });
            btn.classList.add("is-active");
            state.categoryFilter = btn.dataset.cat === "all" ? null : btn.dataset.cat;
            hideLabel();
            state.hovered = null;
            draw();
        });
    });

    function init() {
        resizeCanvas();
        draw();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
