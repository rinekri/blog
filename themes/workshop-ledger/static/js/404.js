// 404 page: "Notarized" — the record sits idle reading "404" until Space or
// a tap starts the clock (Chrome-dino convention). Once running, dip a
// stamp from the ink pad and press it onto each digit slot before the fuse
// burns out. Level 1 is always "404" — every case after that is a fresh
// docket, seeded from the broken URL AND today's date, with one more digit,
// a shorter fuse, and past level 3 a mix of slot behaviors instead of just
// smaller/faster targets: a smudged digit fades and has to be memorized, a
// double-signature slot needs two presses, and past level 5 a decoy blot
// wastes a press if you don't look before you land. Endless: it only ends
// when the clock or the ink runs out.
//
// Every hit is graded by how close to the slot's center it landed (Perfect/
// Good/Hit), the ink pad has real capacity — 4 presses per dip, fading
// visibly, a dry press is a guaranteed miss — and a flawless level, a clean
// run of flawless levels, and score milestones all pay their own bonuses on
// top of the streak/golden-digit/Double-Stamp-wager stack already there.
//
// A loss and a win are both short scripted sequences, not instant state
// swaps — hit-stop, a slow-mo/desaturate ramp and a held beat on loss;
// a freeze, a score count-up and an ink burst on a win — because an
// instant transition reads as a UI update, not a verdict or a reward.
//
// No borrowed game genre: the gesture reuses theme.js's press-and-hold-to-
// commit shape, and each impression is fingerprint.js's seeded mark for
// this exact broken URL — so every dead link notarizes its own record.
import { hashSeed, mulberry32 } from "./prng.js";

(function () {
    "use strict";

    var canvas = document.querySelector(".not-found__canvas");
    if (!canvas) return;
    var ctx = canvas.getContext("2d");
    var captionEl = document.querySelector('[data-field="caption"]');
    var muteBtn = document.querySelector(".not-found__mute");
    var copyBtn = document.querySelector(".not-found__copy");

    function readColor(name, fallback) {
        var v = getComputedStyle(document.documentElement).getPropertyValue(name);
        return v ? v.trim() : fallback;
    }

    function prefersReducedMotion() {
        return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    }

    function setCaption(text) {
        if (captionEl) captionEl.textContent = text;
    }

    function todayStr() {
        var d = new Date();
        var mm = String(d.getMonth() + 1).padStart(2, "0");
        var dd = String(d.getDate()).padStart(2, "0");
        return d.getFullYear() + "-" + mm + "-" + dd;
    }

    var dateStr = todayStr();
    var seedBase = hashSeed("404:" + location.pathname + ":" + dateStr);
    var noPulse = prefersReducedMotion();

    var BEST_KEY = "notFoundBestScore:" + dateStr;
    function readBest() {
        try {
            return parseInt(localStorage.getItem(BEST_KEY), 10) || 0;
        } catch (e) {
            return 0;
        }
    }
    function writeBest(v) {
        try {
            localStorage.setItem(BEST_KEY, String(v));
        } catch (e) {}
    }
    var best = readBest();

    var MUTE_KEY = "notFoundMuted";
    function readMuted() {
        try {
            return localStorage.getItem(MUTE_KEY) === "1";
        } catch (e) {
            return false;
        }
    }
    function writeMuted(v) {
        try {
            localStorage.setItem(MUTE_KEY, v ? "1" : "0");
        } catch (e) {}
    }
    var muted = readMuted();

    // ---- audio: two synthesized tones, no files, no libraries. Only ever
    // fires after Space/tap-to-start plus a real stamp press — a repeated,
    // deliberate gesture, the same bar browsers use to allow AudioContext
    // without a warning.
    var audioCtx = null;
    function ensureAudio() {
        if (audioCtx) return audioCtx;
        try {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            audioCtx = null;
        }
        return audioCtx;
    }
    function playTone(kind) {
        if (muted) return;
        var ac = ensureAudio();
        if (!ac) return;
        var now = ac.currentTime;
        if (kind === "hit" || kind === "win") {
            var freqs = kind === "win" ? [523.25, 659.25, 783.99, 1046.5] : [523.25, 659.25, 783.99];
            for (var i = 0; i < freqs.length; i++) {
                var osc = ac.createOscillator();
                var gain = ac.createGain();
                osc.type = "triangle";
                osc.frequency.value = freqs[i];
                var t0 = now + i * 0.05;
                gain.gain.setValueAtTime(0, t0);
                gain.gain.linearRampToValueAtTime(0.16, t0 + 0.005);
                gain.gain.linearRampToValueAtTime(0.08, t0 + 0.045);
                gain.gain.linearRampToValueAtTime(0, t0 + 0.145);
                osc.connect(gain).connect(ac.destination);
                osc.start(t0);
                osc.stop(t0 + 0.16);
            }
        } else {
            var dur = kind === "loss" ? 0.32 : 0.15;
            var o = ac.createOscillator();
            var g = ac.createGain();
            o.type = kind === "loss" ? "square" : "sine";
            o.frequency.setValueAtTime(200, now);
            o.frequency.exponentialRampToValueAtTime(80, now + dur);
            g.gain.setValueAtTime(0.2, now);
            g.gain.exponentialRampToValueAtTime(0.001, now + dur);
            o.connect(g).connect(ac.destination);
            o.start(now);
            o.stop(now + dur + 0.02);
        }
    }

    function vibrate(pattern) {
        if (navigator.vibrate) {
            try {
                navigator.vibrate(pattern);
            } catch (e) {}
        }
    }

    // ---- scoring: points scale with level, a consecutive-hit streak
    // multiplies them, precision (below) multiplies again, a miss both
    // burns an attempt AND costs points outright, and finishing a level
    // with fuse to spare pays a time bonus.
    var HIT_BASE = 100;
    var MISS_PENALTY = 25;
    function pointsForHit(lvl, streakAtHit) {
        var base = HIT_BASE + (lvl - 1) * 20;
        var mult = 1 + Math.min(streakAtHit - 1, 9) * 0.1;
        return Math.round(base * mult);
    }

    // Perfect/Good/Hit — graded by distance from the slot's center
    // (Chebyshev-normalized since slots are rects, not circles), not just
    // inside-vs-outside. The Perfect radius widens slightly per stamp tier.
    function precisionTier(px, py, t) {
        var halfW = t.w / 2,
            halfH = t.h / 2;
        var cx = t.x + halfW,
            cy = t.y + halfH;
        var norm = Math.max(Math.abs(px - cx) / halfW, Math.abs(py - cy) / halfH);
        var perfectR = 0.3 * (1 + 0.1 * stampTier);
        if (norm <= perfectR) return { tier: "perfect", mult: 3, label: " ✦" };
        if (norm <= 0.7) return { tier: "good", mult: 1.5, label: "" };
        return { tier: "hit", mult: 1, label: "" };
    }

    // ---- difficulty curve: more digits, less time, tighter slots, and
    // past level 3 a mix of slot behaviors — each capped so the game
    // degrades to "hard but playable", not impossible. Seeded by URL +
    // today's date, so the docket is different each day.
    function digitsForLevel(level) {
        if (level === 1) return ["4", "0", "4"];
        var count = Math.min(6, 3 + Math.floor((level - 1) / 2));
        var rand = mulberry32(hashSeed("404:" + location.pathname + ":" + dateStr + ":digits:" + level));
        var out = [];
        for (var i = 0; i < count; i++) out.push(String(Math.floor(rand() * 10)));
        return out;
    }
    // Slot types are decided once per level from the same digit list, so
    // both buildTargets() (actual layout) and attemptsForLevel() (the ink/
    // attempts budget) see identical results without sharing mutable state.
    function layoutForLevel(lvl) {
        var digits = digitsForLevel(lvl);
        var rand = mulberry32(hashSeed("404:" + location.pathname + ":" + dateStr + ":layout:" + lvl));
        var slots = digits.map(function (d) {
            var type = "normal";
            if (lvl >= 4 && rand() < 0.15) type = "double";
            else if (lvl >= 3 && rand() < 0.3) type = "smudge";
            return { digit: d, type: type, pressesNeeded: type === "double" ? 2 : 1 };
        });
        if (lvl >= 5 && rand() < 0.5) {
            var decoyDigit = String(Math.floor(rand() * 10));
            var pos = Math.floor(rand() * (slots.length + 1));
            slots.splice(pos, 0, { digit: decoyDigit, type: "decoy", pressesNeeded: 1 });
        }
        return slots;
    }
    function timeLimitForLevel(level) {
        return Math.max(3.5, 9 - (level - 1) * 0.6);
    }
    function attemptsForLevel(level) {
        var slots = layoutForLevel(level);
        var required = 0,
            decoys = 0;
        for (var i = 0; i < slots.length; i++) {
            if (slots[i].type === "decoy") decoys++;
            else required += slots[i].pressesNeeded;
        }
        return required + 2 + decoys;
    }

    var W = 0,
        H = 0,
        ratio = 1;
    var pad = { x: 0, y: 0, w: 78, h: 46 };
    var record = { x: 0, y: 0, w: 0, h: 76 };
    var targets = []; // [{x,y,w,h,digit,type,pressesNeeded,doneCount}]
    var stampRest = { x: 0, y: 0 };
    var stamp = { x: 0, y: 0, size: 1 };
    var trail = []; // stamp-drag trail: {x,y,alpha}

    var holding = false,
        pressure = 0;
    var filled = [];
    var level = 1;
    var attemptsLeft = 0;
    var roundTimeLeft = 0;
    // "idle" | "play" | "paused" | "winning" | "losing" | "lost"
    var gameState = "idle";
    var lossReason = ""; // "ink" | "time"
    var missFlash = 0;
    var roundPulse = 0;
    var suppressNextClick = false;
    var score = 0;
    var streak = 0;
    var popups = []; // floating +/- feedback: {text, x, y, vy, alpha, color, big}
    var raf = null,
        lastT = null;

    // Ink meter — "Fading Impression": a dip loads a fixed number of
    // presses; each commit drains one regardless of hit/miss; a press with
    // none left is a guaranteed miss, rendered visibly pale. Resets every
    // level, same as attempts/fuse.
    var INK_MAX = 4;
    var inkCharges = 0;

    // Precision/mastery state.
    var stampTier = 0; // 0-2, +10% Perfect radius per tier
    var consecutivePerfect = 0;
    var levelElapsed = 0; // drives the smudge-digit fade
    var levelPointsEarned = 0;
    var levelMissed = false;
    var flawlessLevelStreak = 0;
    var MILESTONES = [1000, 2500, 5000, 10000, 20000];
    var milestoneIdx = 0;

    // Overtime: an optional bonus digit offered when all required slots
    // are filled with real fuse still left. Reuses "play" state entirely.
    var overtimePending = false;
    var overtimeOffered = false;
    var overtimeMissedBonus = false;
    var overtimeScoreBefore = 0;
    var OVERTIME_MIN_TIME = 2.5;

    // Juice state.
    var shakeMag = 0; // 0..1 trauma, decays every frame
    var freezeT = 0; // hit-stop: while > 0, loop() does nothing else but count down
    var desatT = 0; // 0..1 desaturation during the losing sequence
    var lossT = 0; // elapsed time since the losing sequence began
    var lostStampT = 0; // elapsed time since "lost" became final — drives the VOID stamp's punch-in
    var winT = 0; // elapsed time since the winning sequence began
    var winFromScore = 0; // score at the moment the winning stamp landed, count-up starts here
    var displayScore = 0; // the number actually shown while it counts up
    var winBurst = []; // {x,y,vx,vy,alpha,color}

    // Double Stamp gamble: armed after each level, resolves on the next
    // level's first digit or on any miss while it's live. Once per run,
    // starting at level 5+, it's the bigger "double or nothing" version
    // (wagerBig) instead of the small per-digit one.
    var wagerActive = false,
        wagerBig = false,
        wagerWindow = 0,
        wagerTarget = -1;
    var bigWagerUsed = false;
    var goldenIndex = -1; // one bonus slot per level, seeded (never a decoy/double slot)

    var PRESS_SECONDS = 0.55;
    var LOSS_RAMP = 0.35; // slow-mo/desaturate ramp duration
    var LOSS_HOLD = 0.6; // frozen hold before reveal
    var WIN_FREEZE = 0.4; // still beat before the count-up starts
    var WIN_COUNT = 0.65; // score count-up duration
    var WIN_PAUSE = 0.35; // beat after the count-up before the next level

    function sizeCanvas() {
        var rect = canvas.getBoundingClientRect();
        W = rect.width || 560;
        H = rect.height || 300;
        ratio = window.devicePixelRatio || 1;
        canvas.width = W * ratio;
        canvas.height = H * ratio;
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

        pad.x = 28;
        pad.y = H - pad.h - 26;
        record.x = pad.x + pad.w + 44;
        record.y = H * 0.34 - record.h / 2;
        record.w = W - record.x - 28;
        stampRest.x = pad.x + pad.w / 2;
        stampRest.y = pad.y + pad.h / 2;
        stamp.x = stampRest.x;
        stamp.y = stampRest.y;
    }

    function buildTargets() {
        var slots = layoutForLevel(level);
        var count = slots.length;
        var byFormula = Math.max(26, 64 - (level - 1) * 2);
        var byLayout = (record.w / count) * 0.82;
        var slotW = Math.min(byFormula, byLayout);
        targets = slots.map(function (s, i) {
            var cx = record.x + (record.w * (i + 0.5)) / count;
            return {
                x: cx - slotW / 2,
                y: record.y,
                w: slotW,
                h: record.h,
                digit: s.digit,
                type: s.type,
                pressesNeeded: s.pressesNeeded,
                doneCount: 0
            };
        });
        filled = targets.map(function () {
            return null;
        });

        // Golden only ever lands on an ordinary single-press slot — keeps
        // its meaning ("one digit worth double") from tangling with decoys
        // or the two-press double-slots.
        var grand = mulberry32(hashSeed("404:" + location.pathname + ":" + dateStr + ":golden:" + level));
        var eligible = [];
        for (var gi = 0; gi < targets.length; gi++) {
            if (targets[gi].type === "normal" || targets[gi].type === "smudge") eligible.push(gi);
        }
        goldenIndex = eligible.length ? eligible[Math.floor(grand() * eligible.length)] : -1;
        levelElapsed = 0;
    }

    function requiredCount() {
        var n = 0;
        for (var i = 0; i < targets.length; i++) {
            if (targets[i].type !== "decoy" && targets[i].type !== "overtime") n++;
        }
        return n;
    }
    function filledCount() {
        var n = 0;
        for (var i = 0; i < filled.length; i++) if (filled[i]) n++;
        return n;
    }

    function inRect(px, py, r) {
        return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
    }

    // An impression has to actually read as its digit, not just as "some
    // ink happened here" — so it's a stipple of dots sampled straight off
    // the real glyph's rendered pixels (same offscreen-canvas-as-point-
    // cloud trick as the fingerprint mark, applied to a letterform instead
    // of a free field). Dots sit exactly at the sampled pixel, unlike a
    // stroke with a random direction/length, which just reads as noise —
    // computed once per fill, not resampled every frame.
    function buildDigitDots(w, h, digitChar, seedStr) {
        var off = document.createElement("canvas");
        off.width = Math.max(1, Math.ceil(w));
        off.height = Math.max(1, Math.ceil(h));
        var octx = off.getContext("2d");
        octx.fillStyle = "#000";
        var fontPx = Math.min(h * 0.92, w * 0.85);
        octx.font = "800 " + fontPx + "px " + readColor("--font-mono", "monospace");
        octx.textAlign = "center";
        octx.textBaseline = "middle";
        octx.fillText(digitChar, off.width / 2, off.height / 2 + off.height * 0.04);

        var data = octx.getImageData(0, 0, off.width, off.height).data;
        var pts = [];
        var step = 1.6;
        for (var y = 0; y < off.height; y += step) {
            for (var x = 0; x < off.width; x += step) {
                var xi = Math.floor(x),
                    yi = Math.floor(y);
                if (data[(yi * off.width + xi) * 4 + 3] > 120) {
                    pts.push({ x: x - off.width / 2, y: y - off.height / 2 });
                }
            }
        }

        var rand = mulberry32(hashSeed(seedStr));
        for (var i = pts.length - 1; i > 0; i--) {
            var j = Math.floor(rand() * (i + 1));
            var tmp = pts[i];
            pts[i] = pts[j];
            pts[j] = tmp;
        }
        // Capped well under the codebase's established real-time draw-call
        // ceiling (~150-200 objects/frame) even at 6 digits filled at once.
        var cap = Math.min(pts.length, 110);
        var dots = [];
        for (var k = 0; k < cap; k++) {
            var p = pts[k];
            dots.push({
                x: p.x + (rand() - 0.5) * 0.8,
                y: p.y + (rand() - 0.5) * 0.8,
                moss: rand() < 0.6,
                radius: 0.7 + rand() * 0.6,
                alpha: 0.7 + rand() * 0.3
            });
        }
        return dots;
    }

    function drawDots(cx, cy, dots) {
        var moss = readColor("--moss", "#2f5942");
        var spark = readColor("--spark", "#b8721a");
        ctx.save();
        for (var i = 0; i < dots.length; i++) {
            var d = dots[i];
            ctx.globalAlpha = d.alpha;
            ctx.fillStyle = d.moss ? moss : spark;
            ctx.beginPath();
            ctx.arc(cx + d.x, cy + d.y, d.radius, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    // A plain heart, not an ink motif — attempts-left needed the single
    // most universally understood "lives remaining" shape, not another
    // seeded mark competing for the same visual language.
    function drawHeart(cx, cy, size, filled, color) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(size, size);
        ctx.beginPath();
        ctx.moveTo(0, 0.32);
        ctx.bezierCurveTo(0, 0.08, -0.28, -0.12, -0.5, 0.08);
        ctx.bezierCurveTo(-0.78, 0.32, -0.5, 0.62, 0, 1);
        ctx.bezierCurveTo(0.5, 0.62, 0.78, 0.32, 0.5, 0.08);
        ctx.bezierCurveTo(0.28, -0.12, 0, 0.08, 0, 0.32);
        ctx.closePath();
        if (filled) {
            ctx.fillStyle = color;
            ctx.fill();
        } else {
            ctx.strokeStyle = color;
            ctx.lineWidth = 0.08;
            ctx.stroke();
        }
        ctx.restore();
    }

    function spawnPopup(text, x, y, color, big) {
        popups.push({ text: text, x: x, y: y, vy: -34, alpha: 1, color: color, big: !!big });
    }

    function maybeComboCallout() {
        if (streak > 0 && streak % 5 === 0) {
            var text = streak >= 15 ? "on a roll" : streak >= 10 ? "clean run" : "nice streak";
            spawnPopup(text, W / 2, H * 0.22, readColor("--spark-deep", "#8a5613"), true);
        }
    }

    function milestoneThreshold(i) {
        if (i < MILESTONES.length) return MILESTONES[i];
        return MILESTONES[MILESTONES.length - 1] * Math.pow(2, i - MILESTONES.length + 1);
    }
    function checkMilestones() {
        while (score >= milestoneThreshold(milestoneIdx)) {
            score += 200;
            spawnPopup("milestone +200", stamp.x, stamp.y - 46, readColor("--spark-deep", "#8a5613"));
            shakeMag = Math.max(shakeMag, 0.4);
            milestoneIdx += 1;
        }
    }

    function spawnWinBurst(cx, cy) {
        winBurst = [];
        var count = noPulse ? 0 : 22;
        for (var i = 0; i < count; i++) {
            var ang = Math.random() * Math.PI * 2;
            var spd = 40 + Math.random() * 90;
            winBurst.push({
                x: cx,
                y: cy,
                vx: Math.cos(ang) * spd,
                vy: Math.sin(ang) * spd - 30,
                alpha: 1,
                moss: Math.random() < 0.5
            });
        }
    }

    function targetAt(px, py) {
        for (var i = 0; i < targets.length; i++) {
            if (!filled[i] && inRect(px, py, targets[i])) return i;
        }
        return -1;
    }

    function flashCanvas(kind) {
        canvas.classList.add("flash-" + kind);
        setTimeout(function () {
            canvas.classList.remove("flash-" + kind);
        }, 350);
    }

    function render() {
        var card = readColor("--card", "#f6f8f5");
        var line = readColor("--line", "#cbd3cb");
        var ink = readColor("--ink-faint", "#5c6a61");
        var moss = readColor("--moss", "#2f5942");
        var mossDeep = readColor("--moss-deep", "#1b3527");
        var spark = readColor("--spark", "#b8721a");
        var sparkDeep = readColor("--spark-deep", "#8a5613");
        var danger = readColor("--danger", "#8a3b2f");

        ctx.clearRect(0, 0, W, H);

        var jx = 0,
            jy = 0;
        if (shakeMag > 0.001) {
            jx = (Math.random() - 0.5) * 2 * shakeMag * 14;
            jy = (Math.random() - 0.5) * 2 * shakeMag * 14;
        }
        ctx.save();
        ctx.translate(jx, jy);
        ctx.filter =
            gameState === "losing" || gameState === "lost"
                ? "saturate(" + Math.round((1 - desatT) * 100) + "%)"
                : "none";

        ctx.fillStyle = card;
        ctx.fillRect(0, 0, W, H);

        // Fuse bar — the round's clock, burning down. Not shown before the
        // run actually starts; nothing is ticking yet.
        if (gameState !== "idle") {
            var limit = timeLimitForLevel(level);
            var frac = Math.max(0, Math.min(1, roundTimeLeft / limit));
            ctx.fillStyle = line;
            ctx.fillRect(8, 8, W - 16, 4);
            ctx.fillStyle = frac < 0.25 ? danger : spark;
            ctx.fillRect(8, 8, (W - 16) * frac, 4);
        }

        // Score/level — a persistent readout on the canvas itself, not just
        // the small caption line below it, so it's visible mid-play without
        // looking away from the action.
        if (gameState !== "idle") {
            ctx.font = "700 12px " + readColor("--font-mono", "monospace");
            ctx.textAlign = "left";
            ctx.textBaseline = "top";
            ctx.fillStyle = ink;
            ctx.fillText("score " + score, 10, 16);
            ctx.font = "700 10px " + readColor("--font-mono", "monospace");
            ctx.fillStyle = readColor("--ink-faint", "#5c6a61");
            ctx.fillText("lvl " + level, 10, 32);
        }

        // Attempts left, as hearts — this is what "why did I lose" was
        // missing: a miss cost a heart, and now that's visible before it
        // runs out, not just a number in the caption underneath.
        if (gameState !== "idle") {
            var maxAttempts = attemptsForLevel(level);
            var heartSize = Math.min(9, Math.max(5, (W - 20) / maxAttempts / 1.6));
            var gap = heartSize * 1.6;
            var heartsRightX = W - 10;
            for (var hi = 0; hi < maxAttempts; hi++) {
                var hx = heartsRightX - (maxAttempts - 1 - hi) * gap;
                drawHeart(hx, 10, heartSize, hi < attemptsLeft, danger);
            }
        }

        // Combo badge — the streak multiplier's own visible home, not just
        // baked into the caption's arithmetic.
        if (streak > 1) {
            var mult = 1 + Math.min(streak - 1, 9) * 0.1;
            ctx.font = "700 11px " + readColor("--font-mono", "monospace");
            ctx.textAlign = "right";
            ctx.textBaseline = "top";
            ctx.fillStyle = spark;
            ctx.fillText("×" + mult.toFixed(1), W - 10, 26);
        }

        // Ink pad — fades toward empty once the dip is out of charges, so
        // the pad itself reads "dry", not just the stamp face.
        var padDry = inkCharges <= 0;
        ctx.globalAlpha = padDry ? 0.35 : 1;
        ctx.fillStyle = mossDeep;
        ctx.beginPath();
        ctx.roundRect(pad.x, pad.y, pad.w, pad.h, 4);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = padDry ? danger : line;
        ctx.lineWidth = 1;
        ctx.stroke();

        // Ink gauge — one dot per charge, filled vs. hollow, sitting right
        // above the pad so "you're out, go dip" reads before you even pick
        // the stamp up.
        var gaugeY = pad.y - 10;
        var gaugeSpacing = 10;
        var gaugeStartX = pad.x + pad.w / 2 - ((INK_MAX - 1) * gaugeSpacing) / 2;
        for (var gi = 0; gi < INK_MAX; gi++) {
            ctx.beginPath();
            ctx.arc(gaugeStartX + gi * gaugeSpacing, gaugeY, 2.5, 0, Math.PI * 2);
            if (gi < inkCharges) {
                ctx.fillStyle = moss;
                ctx.fill();
            } else {
                ctx.strokeStyle = readColor("--ink-faint", "#5c6a61");
                ctx.lineWidth = 1;
                ctx.stroke();
            }
        }

        // Ruled line.
        ctx.strokeStyle = line;
        ctx.beginPath();
        ctx.moveTo(record.x, record.y + record.h);
        ctx.lineTo(record.x + record.w, record.y + record.h);
        ctx.stroke();

        // Digit slots — ghost numeral until filled, then the seeded
        // impression takes its place. Smudge slots fade from view over the
        // level's first ~1.2s; double-signature slots show a small
        // underline; the golden slot reads spark; the wagered slot pulses.
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        for (var i = 0; i < targets.length; i++) {
            var t = targets[i];
            var cx = t.x + t.w / 2;
            var cy = t.y + t.h / 2;
            var fontPxLocal = Math.max(11, Math.min(22, t.w * 0.5));
            ctx.font = "700 " + fontPxLocal + "px " + readColor("--font-mono", "monospace");
            if (filled[i]) {
                ctx.save();
                if (roundPulse > 0) {
                    ctx.shadowColor = spark;
                    ctx.shadowBlur = 10 * roundPulse;
                }
                drawDots(cx, cy, filled[i].dots);
                ctx.restore();
            } else {
                var golden = i === goldenIndex;
                var ghostAlpha = 0.35;
                if (t.type === "smudge") {
                    var fadeFrac = Math.min(1, levelElapsed / 1.2);
                    ghostAlpha = 0.42 - fadeFrac * 0.34;
                } else if (t.type === "double" && t.doneCount === 1) {
                    ghostAlpha = 0.62;
                } else if (t.type === "overtime") {
                    ghostAlpha = 0.65; // legible immediately -- no time to squint at a bonus target
                }
                // The overtime slot otherwise looks like a stray, unexplained
                // digit — a dashed frame plus its payout make it read as a
                // target on sight instead of needing the caption explained.
                if (t.type === "overtime") {
                    ctx.save();
                    ctx.setLineDash([3, 3]);
                    ctx.strokeStyle = spark;
                    ctx.lineWidth = 1.5;
                    ctx.globalAlpha = 0.7 + 0.3 * Math.sin(performance.now() / 160);
                    ctx.beginPath();
                    ctx.roundRect(t.x, t.y, t.w, t.h, 4);
                    ctx.stroke();
                    ctx.restore();
                    ctx.globalAlpha = 0.85;
                    ctx.fillStyle = spark;
                    ctx.font = "700 10px " + readColor("--font-mono", "monospace");
                    ctx.fillText("+150", cx, t.y - 8);
                    ctx.globalAlpha = 1;
                    ctx.font = "700 " + fontPxLocal + "px " + readColor("--font-mono", "monospace");
                }
                ctx.globalAlpha = Math.max(0.03, ghostAlpha);
                ctx.fillStyle = golden ? spark : ink;
                ctx.fillText(t.digit, cx, cy);
                ctx.globalAlpha = 1;
                if (t.type === "double") {
                    ctx.strokeStyle = ink;
                    ctx.globalAlpha = 0.4;
                    ctx.beginPath();
                    ctx.moveTo(cx - t.w * 0.28, cy + t.h * 0.3);
                    ctx.lineTo(cx + t.w * 0.28, cy + t.h * 0.3);
                    ctx.stroke();
                    ctx.globalAlpha = 1;
                }
                if (wagerActive && i === wagerTarget) {
                    ctx.beginPath();
                    ctx.arc(cx, cy, Math.max(t.w, t.h) * 0.62, 0, Math.PI * 2);
                    ctx.strokeStyle = wagerBig ? danger : spark;
                    ctx.lineWidth = wagerBig ? 2.2 : 1.5;
                    ctx.globalAlpha = 0.55 + 0.35 * Math.sin(performance.now() / 140);
                    ctx.stroke();
                    ctx.globalAlpha = 1;
                }
            }
        }

        // A missed press flashes the still-open (non-decoy) slots' outline red.
        if (missFlash > 0) {
            ctx.globalAlpha = missFlash;
            ctx.strokeStyle = danger;
            ctx.lineWidth = 2;
            for (var j = 0; j < targets.length; j++) {
                if (filled[j]) continue;
                var tg = targets[j];
                ctx.strokeRect(tg.x, tg.y, tg.w, tg.h);
            }
            ctx.globalAlpha = 1;
        }

        // Pressure ring — fills as the hold approaches commit. Tints faint
        // when the pad is dry, hinting the coming miss without saying so.
        if (gameState === "play" && holding && pressure > 0) {
            ctx.beginPath();
            ctx.arc(stamp.x, stamp.y - 28, 11, -Math.PI / 2, -Math.PI / 2 + pressure * Math.PI * 2);
            ctx.strokeStyle = inkCharges > 0 ? spark : ink;
            ctx.lineWidth = 3;
            ctx.lineCap = "round";
            ctx.stroke();
        }

        // Stamp trail — a few fading dots along a fast drag path.
        for (var tr = 0; tr < trail.length; tr++) {
            var tp = trail[tr];
            ctx.globalAlpha = Math.max(0, tp.alpha);
            ctx.fillStyle = moss;
            ctx.beginPath();
            ctx.arc(tp.x, tp.y, 2, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;

        // The stamp block: a face whose ink tint fades with remaining
        // charge, a handle knob, and a tier mark once upgraded.
        ctx.save();
        ctx.translate(stamp.x, stamp.y);
        ctx.scale(stamp.size, stamp.size);
        ctx.fillStyle = card;
        ctx.beginPath();
        ctx.roundRect(-17, -10, 34, 20, 4);
        ctx.fill();
        var inkFrac = Math.max(0, Math.min(1, inkCharges / INK_MAX));
        if (inkFrac > 0) {
            ctx.globalAlpha = inkFrac;
            ctx.fillStyle = moss;
            ctx.fill();
            ctx.globalAlpha = 1;
        }
        ctx.strokeStyle = stampTier >= 1 ? sparkDeep : mossDeep;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, -18, 6, 0, Math.PI * 2);
        ctx.fillStyle = mossDeep;
        ctx.fill();
        if (stampTier >= 2) {
            ctx.font = "700 8px " + readColor("--font-mono", "monospace");
            ctx.textAlign = "center";
            ctx.fillStyle = spark;
            ctx.fillText("★", 0, -30);
        }
        ctx.restore();

        // Win burst — the actual celebration, not a shadow glow.
        for (var wb = 0; wb < winBurst.length; wb++) {
            var b = winBurst[wb];
            ctx.globalAlpha = Math.max(0, b.alpha);
            ctx.fillStyle = b.moss ? moss : spark;
            ctx.beginPath();
            ctx.arc(b.x, b.y, 2, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;

        // Floating score feedback — the tangible half of the penalty system.
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        for (var p = 0; p < popups.length; p++) {
            var pu = popups[p];
            ctx.font = (pu.big ? "700 15px " : "700 12px ") + readColor("--font-mono", "monospace");
            ctx.globalAlpha = Math.max(0, pu.alpha);
            ctx.fillStyle = pu.color;
            ctx.fillText(pu.text, pu.x, pu.y);
        }
        ctx.globalAlpha = 1;

        ctx.filter = "none";
        ctx.restore();

        // The one thing this file was missing: an unmistakable "you failed"
        // moment. Everything before this (desaturate, shake, the held
        // frozen beat) was atmosphere — none of it actually SAID it. A
        // stamp reusing the game's own motif does, punching in with a
        // quick overshoot rather than just appearing. Drawn outside the
        // desaturation filter on purpose — it's the one vivid thing left
        // once everything else has drained of color.
        if (gameState === "lost") {
            var stampProg = noPulse ? 1 : Math.min(1, lostStampT / 0.25);
            var stampEase = 1 - Math.pow(1 - stampProg, 3);
            var stampScale = 1.5 - stampEase * 0.5;
            var stampAlpha = noPulse ? 1 : Math.min(1, lostStampT / 0.15);
            ctx.save();
            ctx.translate(W / 2, H / 2);
            ctx.rotate(-0.16);
            ctx.scale(stampScale, stampScale);
            ctx.font = "800 " + Math.min(52, W * 0.1) + "px " + readColor("--font-mono", "monospace");
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.strokeStyle = danger;
            ctx.lineWidth = 2.5;
            ctx.globalAlpha = stampAlpha * 0.9;
            ctx.strokeText("VOID", 0, 0);
            ctx.lineWidth = 1;
            ctx.globalAlpha = stampAlpha * 0.45;
            ctx.strokeText("VOID", 1.5, 1.5);
            ctx.globalAlpha = stampAlpha * 0.65;
            ctx.lineWidth = 2;
            ctx.strokeRect(-95, -26, 190, 52);
            ctx.restore();
            ctx.globalAlpha = 1;
        }

        // Pause dim — drawn outside the shake/filter transform, stays flat.
        if (gameState === "paused") {
            ctx.fillStyle = "rgba(15, 18, 15, 0.4)";
            ctx.fillRect(0, 0, W, H);
        }

        updateCaption();
    }

    function updateCaption() {
        if (gameState === "idle") {
            var bestBit = best > 0 ? " · best " + best : "";
            setCaption("space / tap to play · case " + dateStr + bestBit);
            return;
        }
        if (gameState === "paused") {
            setCaption("case suspended — space / esc to resume");
            return;
        }
        if (gameState === "losing") {
            setCaption("—");
            return;
        }
        if (gameState === "winning") {
            setCaption("score " + displayScore + " · level " + level + " filed");
            return;
        }
        if (gameState === "lost") {
            var reason = lossReason === "time" ? "time's up" : "out of ink";
            setCaption(
                reason + " · score " + score + " · best " + best + " · reached level " + level +
                    " — tap to try again"
            );
            return;
        }
        var secs = Math.ceil(roundTimeLeft) + "s";
        var scorePart = "score " + score + " · ";
        var wagerBit = wagerActive
            ? "  ·  " + (wagerBig ? "double or nothing" : "double stamp") + ": land digit 1 in " +
              Math.ceil(wagerWindow) + "s"
            : "";
        if (overtimePending) {
            setCaption(scorePart + "overtime — one more, " + secs + " left" + wagerBit);
        } else if (holding) {
            setCaption(
                scorePart + "ink " + inkCharges + "/" + INK_MAX + " — " + attemptsLeft + " left · " + secs + wagerBit
            );
        } else {
            var bestPart = best > 0 ? " · best " + best : "";
            setCaption(
                scorePart + "level " + level + " · " + filledCount() + "/" + requiredCount() + " filed · " +
                    attemptsLeft + " left · " + secs + bestPart + wagerBit
            );
        }
    }

    function startLevel(n) {
        level = n;
        buildTargets(); // also resets levelElapsed
        attemptsLeft = attemptsForLevel(level);
        roundTimeLeft = timeLimitForLevel(level);
        pressure = 0;
        inkCharges = 0; // fresh pad every level, same reset scope as attempts/fuse
        levelPointsEarned = 0;
        levelMissed = false;
        overtimePending = false;
        overtimeOffered = false;
        overtimeMissedBonus = false;
    }

    // Starts the losing sequence — hit-stop, then a slow-mo/desaturate
    // ramp, then a held frozen beat, THEN the final reveal (finalizeLoss).
    function loseRound(reason) {
        gameState = "losing";
        lossReason = reason;
        lossT = 0;
        desatT = 0;
        if (holding) suppressNextClick = true;
        holding = false;
        canvas.classList.remove("is-holding");
        shakeMag = 1;
        freezeT = 0.13;
        playTone("loss");
        vibrate([100, 50, 100, 50, 150]);
        flashCanvas("loss");
    }

    function finalizeLoss() {
        gameState = "lost";
        lostStampT = 0;
        if (score > best) {
            best = score;
            writeBest(best);
        }
    }

    // Starts the winning sequence — freeze, then a score count-up, then an
    // ink burst, then a pause, THEN the next docket (finalizeWin).
    function beginWinSequence(fromScore) {
        gameState = "winning";
        winT = 0;
        winFromScore = fromScore;
        displayScore = fromScore;
        spawnWinBurst(record.x + record.w / 2, record.y + record.h / 2);
        shakeMag = Math.max(shakeMag, 0.35);
        freezeT = 0.13;
        playTone("win");
        vibrate([30, 30, 60]);
        flashCanvas("win");
    }

    function finalizeWin() {
        startLevel(level + 1); // endless — the next docket starts right after
        gameState = "play";
        wagerActive = true;
        wagerTarget = 0;
        if (!bigWagerUsed && level >= 5) {
            wagerBig = true;
            wagerWindow = 1.2;
        } else {
            wagerBig = false;
            wagerWindow = 2;
        }
    }

    // A flawless level (+25%, voided by any miss), a clean run of flawless
    // levels (escalating on top of that), and a time bonus — all paid here,
    // right before the win sequence's count-up animates through them.
    function proceedToWin(scoreBeforeThisPress) {
        var spark = readColor("--spark", "#b8721a");
        var sparkDeep = readColor("--spark-deep", "#8a5613");
        if (!levelMissed) {
            var flawlessBonus = Math.round(levelPointsEarned * 0.25);
            if (flawlessBonus > 0) {
                score += flawlessBonus;
                spawnPopup("+" + flawlessBonus + " flawless", record.x + record.w / 2, record.y - 30, spark);
            }
            flawlessLevelStreak += 1;
            if (flawlessLevelStreak >= 2) {
                var cleanRunBonus = flawlessLevelStreak * 30;
                score += cleanRunBonus;
                spawnPopup(
                    "+" + cleanRunBonus + " clean run",
                    record.x + record.w / 2,
                    record.y - 44,
                    sparkDeep
                );
            }
        } else {
            flawlessLevelStreak = 0;
        }
        if (!overtimeMissedBonus) {
            var timeBonus = Math.round(roundTimeLeft * 15);
            if (timeBonus > 0) {
                score += timeBonus;
                spawnPopup("+" + timeBonus + " time", record.x + record.w / 2, record.y - 12, spark);
            }
        }
        checkMilestones();
        beginWinSequence(scoreBeforeThisPress);
    }

    // Offers one optional bonus digit if the required slots finished with
    // real fuse to spare — reuses "play" state, just with one extra target.
    function considerOvertimeThenWin(scoreBeforeThisPress) {
        if (!overtimeOffered && roundTimeLeft > OVERTIME_MIN_TIME) {
            overtimeOffered = true;
            overtimePending = true;
            overtimeScoreBefore = scoreBeforeThisPress;
            var otW = 40,
                otH = 32;
            var rand = mulberry32(hashSeed("404:" + location.pathname + ":" + dateStr + ":overtime:" + level));
            targets.push({
                x: record.x + record.w / 2 - otW / 2,
                y: record.y + record.h + 16,
                w: otW,
                h: otH,
                digit: String(Math.floor(rand() * 10)),
                type: "overtime",
                pressesNeeded: 1,
                doneCount: 0
            });
            filled.push(null);
            spawnPopup("overtime!", record.x + record.w / 2, record.y + record.h + 10, readColor("--spark", "#b8721a"));
            return;
        }
        proceedToWin(scoreBeforeThisPress);
    }

    function commitPress() {
        var scoreBefore = score;
        var spark = readColor("--spark", "#b8721a");
        var danger = readColor("--danger", "#8a3b2f");
        var gold = readColor("--spark-deep", "#8a5613");
        var idx = targetAt(stamp.x, stamp.y);
        var hasInk = inkCharges > 0;
        var outcome = "miss"; // "hit" | "partial" | "miss" | "decoy" | "dry"
        var hitIdx = -1;

        if (idx === -1) {
            outcome = "miss";
        } else if (targets[idx].type === "decoy") {
            outcome = "decoy";
        } else if (!hasInk) {
            outcome = "dry";
        } else {
            var target = targets[idx];
            target.doneCount = (target.doneCount || 0) + 1;
            if (target.doneCount < target.pressesNeeded) {
                outcome = "partial";
            } else {
                outcome = "hit";
                hitIdx = idx;
            }
        }
        if (hasInk) inkCharges -= 1; // any resolved commit spends the charge

        if (outcome === "hit") {
            var t = targets[hitIdx];
            var tierInfo = precisionTier(stamp.x, stamp.y, t);
            var seedStr = "404:" + location.pathname + ":" + dateStr + ":" + level + ":" + hitIdx;
            filled[hitIdx] = { dots: buildDigitDots(t.w, t.h, t.digit, seedStr) };
            streak += 1;

            if (tierInfo.tier === "perfect") {
                consecutivePerfect += 1;
                if (consecutivePerfect >= 10 && stampTier < 2) {
                    stampTier += 1;
                    consecutivePerfect = 0;
                    spawnPopup("stamp upgraded", stamp.x, stamp.y - 46, gold);
                }
            } else {
                consecutivePerfect = 0;
            }

            var points = Math.round(pointsForHit(level, streak) * tierInfo.mult);
            var golden = hitIdx === goldenIndex;
            var smallWagerHit = wagerActive && !wagerBig && hitIdx === wagerTarget;
            if (golden) points *= 2;
            if (smallWagerHit) points *= 2;
            score += points;
            levelPointsEarned += points;

            var label = "+" + points + tierInfo.label + (golden ? " ★" : "") + (smallWagerHit ? " ×2!" : "");
            spawnPopup(label, stamp.x, stamp.y - 30, smallWagerHit || golden ? gold : spark);
            playTone("hit");
            vibrate(35);
            shakeMag = Math.max(shakeMag, 0.3);
            maybeComboCallout();
            checkMilestones();
            if (smallWagerHit) wagerActive = false;
        } else if (outcome === "partial") {
            streak += 1;
            spawnPopup("again", stamp.x, stamp.y - 30, spark);
            playTone("hit");
            vibrate(20);
            shakeMag = Math.max(shakeMag, 0.18);
        } else {
            missFlash = 1;
            streak = 0;
            consecutivePerfect = 0;
            levelMissed = true;
            var penalty = MISS_PENALTY;
            var smallWagerMiss = wagerActive && !wagerBig;
            if (smallWagerMiss) {
                penalty += MISS_PENALTY;
                wagerActive = false;
            }
            score = Math.max(0, score - penalty);
            var tag = smallWagerMiss ? " wager" : outcome === "decoy" ? " decoy" : outcome === "dry" ? " dry" : "";
            spawnPopup("-" + penalty + tag, stamp.x, stamp.y - 30, danger);
            playTone("miss");
            vibrate(15);
            shakeMag = Math.max(shakeMag, 0.3);
        }

        // Big wager resolves independent of the normal/small-wager path —
        // exactly one press ever gets to be "the" attempt at it.
        if (wagerActive && wagerBig && outcome !== "partial") {
            if (outcome === "hit" && hitIdx === wagerTarget) {
                score = score * 2;
                spawnPopup("DOUBLED!", record.x + record.w / 2, record.y - 26, gold, true);
                playTone("win");
                vibrate([40, 30, 40, 30, 80]);
            } else {
                score = 0;
                spawnPopup("BUST", record.x + record.w / 2, record.y - 26, danger, true);
                playTone("loss");
                vibrate([120, 60, 120]);
            }
            wagerActive = false;
            bigWagerUsed = true;
        }

        attemptsLeft -= 1;
        pressure = 0;
        if (!noPulse) stamp.size = 1.35;
        freezeT = 0.06;

        if (overtimePending) {
            var otIdx = targets.length - 1;
            if (outcome === "hit" && hitIdx === otIdx) {
                score += 150;
                spawnPopup("+150 overtime", targets[otIdx].x + targets[otIdx].w / 2, targets[otIdx].y - 10, gold);
                overtimePending = false;
                proceedToWin(overtimeScoreBefore);
            } else if (outcome !== "partial") {
                overtimeMissedBonus = true;
                overtimePending = false;
                proceedToWin(overtimeScoreBefore);
            }
            return;
        }

        if (filledCount() === requiredCount()) {
            considerOvertimeThenWin(scoreBefore);
        } else if (attemptsLeft <= 0) {
            loseRound("ink");
        }
    }

    function resetRun() {
        startLevel(1);
        gameState = "play";
        missFlash = 0;
        roundPulse = 0;
        score = 0;
        streak = 0;
        popups = [];
        winBurst = [];
        trail = [];
        shakeMag = 0;
        freezeT = 0;
        wagerActive = false;
        wagerBig = false;
        wagerWindow = 0;
        bigWagerUsed = false;
        stampTier = 0;
        consecutivePerfect = 0;
        flawlessLevelStreak = 0;
        milestoneIdx = 0;
    }

    function startRun() {
        resetRun();
        startLoop();
        render();
    }

    // Attract screen: the record already reads "404", nothing is ticking,
    // and no drag does anything until the run actually starts — this is the
    // Chrome-dino-style "here's the scene, press to begin" beat.
    function showIdle() {
        level = 1;
        buildTargets();
        filled = targets.map(function (t, i) {
            return { dots: buildDigitDots(t.w, t.h, t.digit, "404:idle:" + location.pathname + ":" + i) };
        });
        gameState = "idle";
        holding = false;
        pressure = 0;
        missFlash = 0;
        roundPulse = 0;
        popups = [];
        winBurst = [];
        trail = [];
        shakeMag = 0;
        freezeT = 0;
        wagerActive = false;
        inkCharges = 0;
        canvas.classList.remove("is-holding");
        render();
    }

    function startLoop() {
        if (raf) return;
        lastT = null;
        raf = requestAnimationFrame(loop);
    }

    function loop(now) {
        if (document.hidden) {
            lastT = null;
            raf = requestAnimationFrame(loop);
            return;
        }
        if (lastT == null) lastT = now;
        var dt = Math.min(0.05, (now - lastT) / 1000);
        lastT = now;

        // Hit-stop: a literal freeze-frame. Nothing else in this function
        // runs until it expires — that's what makes a landed stamp read as
        // an impact instead of a number silently changing.
        if (freezeT > 0) {
            freezeT -= dt;
            render();
            raf = requestAnimationFrame(loop);
            return;
        }

        if (gameState !== "paused") {
            if (!holding) {
                stamp.x += (stampRest.x - stamp.x) * Math.min(1, dt * 10);
                stamp.y += (stampRest.y - stamp.y) * Math.min(1, dt * 10);
            }
            stamp.size += (1 - stamp.size) * Math.min(1, dt * 10);
        }
        missFlash = Math.max(0, missFlash - dt * 2.5);
        roundPulse = Math.max(0, roundPulse - dt * 1.5);
        shakeMag = noPulse ? 0 : shakeMag * Math.pow(0.85, dt * 60);

        for (var pi = popups.length - 1; pi >= 0; pi--) {
            var pu = popups[pi];
            pu.y += pu.vy * dt;
            pu.alpha -= dt * 1.1;
            if (pu.alpha <= 0) popups.splice(pi, 1);
        }
        for (var bi = winBurst.length - 1; bi >= 0; bi--) {
            var b = winBurst[bi];
            b.x += b.vx * dt;
            b.y += b.vy * dt;
            b.vy += 60 * dt;
            b.alpha -= dt * 2;
            if (b.alpha <= 0) winBurst.splice(bi, 1);
        }
        for (var ti = trail.length - 1; ti >= 0; ti--) {
            trail[ti].alpha -= dt * 2.5;
            if (trail[ti].alpha <= 0) trail.splice(ti, 1);
        }

        if (gameState === "play") {
            levelElapsed += dt;
            if (wagerActive) {
                wagerWindow -= dt;
                if (wagerWindow <= 0) wagerActive = false;
            }
            roundTimeLeft -= dt;
            if (roundTimeLeft <= 0) {
                roundTimeLeft = 0;
                if (overtimePending) {
                    overtimePending = false;
                    overtimeMissedBonus = true;
                    proceedToWin(overtimeScoreBefore);
                } else {
                    loseRound("time");
                }
            } else if (
                holding &&
                (inRect(stamp.x, stamp.y, record) ||
                    (overtimePending && inRect(stamp.x, stamp.y, targets[targets.length - 1])))
            ) {
                // The overtime slot sits below the ruled line, outside
                // `record`'s own box — without this it can never accumulate
                // pressure at all, so it could never actually be pressed.
                pressure += dt / PRESS_SECONDS;
                if (pressure >= 1) commitPress();
            } else if (holding) {
                pressure = Math.max(0, pressure - dt * 2);
            }
        } else if (gameState === "losing") {
            lossT += dt;
            desatT = Math.max(0, Math.min(1, lossT / LOSS_RAMP));
            if (lossT >= LOSS_RAMP + LOSS_HOLD) finalizeLoss();
        } else if (gameState === "winning") {
            winT += dt;
            if (winT < WIN_FREEZE) {
                displayScore = winFromScore;
            } else if (winT < WIN_FREEZE + WIN_COUNT) {
                var p2 = (winT - WIN_FREEZE) / WIN_COUNT;
                var eased = 1 - Math.pow(1 - p2, 2);
                displayScore = Math.round(winFromScore + (score - winFromScore) * eased);
            } else {
                displayScore = score;
                if (winT >= WIN_FREEZE + WIN_COUNT + WIN_PAUSE) finalizeWin();
            }
        } else if (gameState === "lost") {
            lostStampT += dt;
        }

        render();

        // The clock only stops ticking once the run is over — otherwise
        // this loop never settles, which is the point of "endless". The
        // VOID stamp's own punch-in (lostStampT) has to be included here
        // too, or the loop can freeze on a frame before it's finished
        // animating in — an early "everything else already settled" frame
        // would stop rendering before the stamp ever became visible.
        if (
            gameState === "lost" &&
            !holding &&
            Math.abs(stamp.size - 1) < 0.01 &&
            missFlash <= 0 &&
            popups.length === 0 &&
            shakeMag < 0.01 &&
            lostStampT >= 0.3
        ) {
            raf = null;
            return;
        }
        raf = requestAnimationFrame(loop);
    }

    function pointerPos(e) {
        var rect = canvas.getBoundingClientRect();
        return {
            x: Math.max(0, Math.min(W, e.clientX - rect.left)),
            y: Math.max(0, Math.min(H, e.clientY - rect.top))
        };
    }

    canvas.addEventListener("pointerdown", function (e) {
        e.preventDefault();
        if (gameState === "idle") {
            startRun();
            return;
        }
        if (gameState !== "play") return; // "lost" restarts via the click handler below
        var p = pointerPos(e);
        holding = true;
        stamp.x = p.x;
        stamp.y = p.y;
        if (inRect(stamp.x, stamp.y, pad)) inkCharges = INK_MAX;
        canvas.classList.add("is-holding");
        startLoop();
        render();
    });

    window.addEventListener("pointermove", function (e) {
        if (!holding) return;
        var p = pointerPos(e);
        var dx = p.x - stamp.x,
            dy = p.y - stamp.y;
        if (Math.sqrt(dx * dx + dy * dy) > 10) {
            trail.push({ x: stamp.x, y: stamp.y, alpha: 0.5 });
            if (trail.length > 14) trail.shift();
        }
        stamp.x = p.x;
        stamp.y = p.y;
        if (inRect(stamp.x, stamp.y, pad)) inkCharges = INK_MAX;
    });

    window.addEventListener("pointerup", function () {
        if (!holding) return;
        holding = false;
        canvas.classList.remove("is-holding");
        if (pressure < 1) pressure = 0;
        startLoop();
    });

    // The release that follows a run-ending hold fires a native click right
    // after pointerup — that click must not immediately restart the run it
    // just ended. loseRound() arms this exactly once.
    canvas.addEventListener("click", function () {
        if (suppressNextClick) {
            suppressNextClick = false;
            return;
        }
        if (gameState === "lost") {
            startRun();
        }
    });

    // Space/Up starts the run from idle (Chrome-dino convention). Space or
    // Esc pauses/resumes mid-run. Stamping itself stays pointer-only.
    document.addEventListener("keydown", function (e) {
        var isSpace = e.code === "Space" || e.key === " ";
        var isUp = e.code === "ArrowUp" || e.key === "ArrowUp";
        var isEsc = e.code === "Escape" || e.key === "Escape";

        if (gameState === "idle" && (isSpace || isUp)) {
            e.preventDefault();
            startRun();
        } else if (gameState === "play" && (isSpace || isEsc)) {
            e.preventDefault();
            holding = false;
            pressure = 0;
            canvas.classList.remove("is-holding");
            gameState = "paused";
            render();
        } else if (gameState === "paused" && (isSpace || isEsc)) {
            e.preventDefault();
            gameState = "play";
            startLoop();
            render();
        }
    });

    function updateMuteBtn() {
        if (!muteBtn) return;
        muteBtn.textContent = muted ? "sound: off" : "sound: on";
        muteBtn.setAttribute("aria-pressed", muted ? "true" : "false");
    }
    updateMuteBtn();
    if (muteBtn) {
        muteBtn.addEventListener("click", function () {
            muted = !muted;
            writeMuted(muted);
            updateMuteBtn();
        });
    }

    if (copyBtn) {
        var copyBtnDefaultText = copyBtn.textContent;
        copyBtn.addEventListener("click", function () {
            var text =
                "Case No. " + seedBase + " (" + dateStr + ") — " + location.pathname +
                " — level " + level + ", streak ×" + streak + ", score " + score +
                (gameState === "lost" ? " — closed" : "");
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(function () {
                    copyBtn.textContent = "copied!";
                    setTimeout(function () {
                        copyBtn.textContent = copyBtnDefaultText;
                    }, 2000);
                });
            }
        });
    }

    function resetAll() {
        sizeCanvas();
        holding = false;
        canvas.classList.remove("is-holding");
        if (gameState === "idle") {
            showIdle();
            return;
        }
        resetRun();
        render();
    }

    var resizeTimer = null;
    window.addEventListener("resize", function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(resetAll, 150);
    });

    sizeCanvas();
    showIdle(); // nothing runs until Space/tap — no loop, no ticking clock
})();
