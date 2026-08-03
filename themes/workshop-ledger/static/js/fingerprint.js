// Per-post generative "fingerprint": a small flow-field of quadratic-curve
// strokes, seeded deterministically from the post slug so the same post
// always draws the same mark. Draws once — no animation loop.
import { hashSeed, mulberry32 } from "./prng.js";

(function () {
    function readColor(name, fallback) {
        var value = getComputedStyle(document.documentElement).getPropertyValue(name);
        return value ? value.trim() : fallback;
    }

    function drawFingerprint(canvas) {
        var seed = canvas.getAttribute("data-seed") || "signature";
        var rand = mulberry32(hashSeed(seed));

        var ratio = window.devicePixelRatio || 1;
        var rect = canvas.getBoundingClientRect();
        var w = rect.width || canvas.width || 128;
        var h = rect.height || canvas.height || 88;

        canvas.width = w * ratio;
        canvas.height = h * ratio;

        var ctx = canvas.getContext("2d");
        ctx.scale(ratio, ratio);
        ctx.clearRect(0, 0, w, h);

        // Optional data-tint="<token>" reads --<token> instead of --moss,
        // letting callers recolor the mark without a new drawing path.
        var tint = canvas.getAttribute("data-tint");
        var moss = readColor(tint ? "--" + tint : "--moss", "#2f5942");
        var ink = readColor("--ink-soft", "#47564c");
        // Stroke count scales with canvas area so small marks stay legible.
        // Optional data-weight="<0-1>" further thins sparser entries so
        // density reads as a content signal.
        var weightAttr = canvas.getAttribute("data-weight");
        var weight = weightAttr !== null ? Math.max(0.4, Math.min(1, parseFloat(weightAttr))) : 1;
        var strokeCount = Math.max(10, Math.min(50, Math.floor(((w * h) / 900) * weight)));
        var margin = Math.min(w, h) * 0.12;

        for (var i = 0; i < strokeCount; i++) {
            var x0 = margin + rand() * (w - margin * 2);
            var y0 = margin + rand() * (h - margin * 2);
            var x1 = margin + rand() * (w - margin * 2);
            var y1 = margin + rand() * (h - margin * 2);
            var cx = margin + rand() * (w - margin * 2);
            var cy = margin + rand() * (h - margin * 2);

            ctx.beginPath();
            ctx.moveTo(x0, y0);
            ctx.quadraticCurveTo(cx, cy, x1, y1);
            ctx.strokeStyle = i % 2 === 0 ? moss : ink;
            ctx.globalAlpha = 0.35 + rand() * 0.45;
            ctx.lineWidth = 1 + rand() * 1.4;
            ctx.lineCap = "round";
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
    }

    // Full-width duotone hero banner (templates/page.html's .post-hero).
    // Same seed/PRNG as drawFingerprint but its own density/geometry —
    // drawFingerprint's area-based count would read sparse stretched across
    // a banner; strokes here lean wide/shallow instead of square.
    function drawHero(canvas) {
        var seed = canvas.getAttribute("data-seed") || "signature";
        var rand = mulberry32(hashSeed(seed));

        var ratio = window.devicePixelRatio || 1;
        var rect = canvas.getBoundingClientRect();
        var w = rect.width || canvas.width || 1200;
        var h = rect.height || canvas.height || 200;

        canvas.width = w * ratio;
        canvas.height = h * ratio;

        var ctx = canvas.getContext("2d");
        ctx.scale(ratio, ratio);
        ctx.clearRect(0, 0, w, h);

        var moss = readColor("--moss", "#2f5942");
        var spark = readColor("--spark", "#b8721a");
        var ink = readColor("--ink-faint", "#5c6a61");
        var strokeCount = Math.max(60, Math.min(160, Math.floor((w * h) / 1400)));
        var margin = Math.min(w, h) * 0.1;

        for (var i = 0; i < strokeCount; i++) {
            var x0 = rand() * w;
            var y0 = margin + rand() * (h - margin * 2);
            var x1 = x0 + (rand() - 0.5) * w * 0.4;
            var y1 = margin + rand() * (h - margin * 2);
            var cx = (x0 + x1) / 2 + (rand() - 0.5) * 80;
            var cy = (y0 + y1) / 2 + (rand() - 0.5) * 60;

            ctx.beginPath();
            ctx.moveTo(x0, y0);
            ctx.quadraticCurveTo(cx, cy, x1, y1);
            ctx.strokeStyle = i % 3 === 0 ? spark : (i % 3 === 1 ? moss : ink);
            ctx.globalAlpha = 0.18 + rand() * 0.3;
            ctx.lineWidth = 1 + rand() * 1.8;
            ctx.lineCap = "round";
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
    }

    // Composite "core-strip" for /archive/'s year plates: each post's own
    // fingerprint strung into one band, segments bleeding into neighbors so
    // marks fuse rather than reading as discrete tiles.
    function drawStrip(canvas) {
        var slugs = (canvas.getAttribute("data-strip") || "").split(",").filter(Boolean);
        if (!slugs.length) return;

        var ratio = window.devicePixelRatio || 1;
        var rect = canvas.getBoundingClientRect();
        var w = rect.width || canvas.width || 300;
        var h = rect.height || canvas.height || 56;

        canvas.width = w * ratio;
        canvas.height = h * ratio;

        var ctx = canvas.getContext("2d");
        ctx.scale(ratio, ratio);
        ctx.clearRect(0, 0, w, h);

        var moss = readColor("--moss", "#2f5942");
        var ink = readColor("--ink-soft", "#47564c");
        var segW = w / slugs.length;
        var bleed = segW * 0.08;
        var margin = h * 0.12;

        slugs.forEach(function (slug) {
            var rand = mulberry32(hashSeed(slug));
            var strokeCount = Math.max(4, Math.floor(segW / 10));

            for (var s = 0; s < strokeCount; s++) {
                var x0 = -bleed + rand() * (segW + bleed * 2);
                var y0 = margin + rand() * (h - margin * 2);
                var x1 = -bleed + rand() * (segW + bleed * 2);
                var y1 = margin + rand() * (h - margin * 2);
                var cx = -bleed + rand() * (segW + bleed * 2);
                var cy = margin + rand() * (h - margin * 2);

                ctx.beginPath();
                ctx.moveTo(x0, y0);
                ctx.quadraticCurveTo(cx, cy, x1, y1);
                ctx.strokeStyle = s % 2 === 0 ? moss : ink;
                ctx.globalAlpha = 0.35 + rand() * 0.45;
                ctx.lineWidth = 1 + rand() * 1.4;
                ctx.lineCap = "round";
                ctx.stroke();
            }

            ctx.translate(segW, 0);
        });
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.globalAlpha = 1;
    }

    function redrawAll() {
        document.querySelectorAll("canvas[data-seed]:not([data-hero])").forEach(drawFingerprint);
        document.querySelectorAll("canvas[data-hero]").forEach(drawHero);
        document.querySelectorAll("canvas[data-strip]").forEach(drawStrip);
    }

    // Exposed so theme.js can force a redraw after a theme commit — colors
    // come from CSS vars that change value but fire no repaint event.
    window.__redrawFingerprints = redrawAll;
    // Exposed for one-off targeted redraws instead of the blanket sweep.
    window.__drawFingerprint = drawFingerprint;
    document.addEventListener("themechange", redrawAll);

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", redrawAll);
    } else {
        redrawAll();
    }

    // Post titles swap in a web font (Newsreader) after first paint — the
    // reflow can change a card's box after its fingerprint canvas already
    // sized/drew itself, leaving stale, mis-scaled strokes.
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(redrawAll);
    }

    // Auto (system) mode has no explicit commit step, so pick up the
    // system flip directly.
    if (window.matchMedia) {
        window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () {
            if (!document.documentElement.getAttribute("data-theme")) {
                redrawAll();
            }
        });
    }
})();
