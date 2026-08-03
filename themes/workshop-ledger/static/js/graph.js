// Project graph: a node per project, an edge between any two sharing 2+
// stack technologies. Layout is a Fruchterman-Reingold-style force
// simulation run once for a fixed iteration count, not a continuous loop.
// Low-connectivity projects are split into a separate "lone pieces" strip
// instead of the main simulation, so sparse connectivity reads as
// isolation rather than random placement.
//
// Not built: a continuous physics loop, resize-stable persistence of
// dragged positions, a mobile list-view fallback, or keyboard/screen-
// reader navigation of the canvas itself (the legend and technology chips
// are real focusable <button>s, but the graph stays mouse/touch-only —
// .project-graph__note's link to /projects/ is the accessible complete
// list).
(function () {
    "use strict";

    var container = document.querySelector(".project-graph");
    if (!container) return;
    var canvas = container.querySelector(".project-graph__canvas");
    var legendEl = document.querySelector(".project-graph__legend");
    var techsEl = document.querySelector(".project-graph__techs");
    var hintEl = container.querySelector(".project-graph__hint");
    var defaultHint = hintEl ? hintEl.textContent : "";

    var nodes = [];
    try {
        nodes = JSON.parse(container.getAttribute("data-nodes") || "[]");
    } catch (e) {
        nodes = [];
    }
    if (nodes.length === 0) return;
    nodes.forEach(function (n, i) { n._i = i; });

    function readColor(name, fallback) {
        var value = getComputedStyle(document.documentElement).getPropertyValue(name);
        return value ? value.trim() : fallback;
    }

    function clamp(min, val, max) {
        return Math.max(min, Math.min(max, val));
    }

    function prefersReducedMotion() {
        return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    }

    function sharedStackCount(a, b) {
        var setB = {};
        b.stack.forEach(function (t) { setB[t.toLowerCase()] = true; });
        var count = 0;
        a.stack.forEach(function (t) { if (setB[t.toLowerCase()]) count++; });
        return count;
    }

    function nodeHasTech(n, tech) {
        return (n.stack || []).some(function (t) { return t.toLowerCase() === tech; });
    }

    // ---- build edges + adjacency ----
    var edges = [];
    for (var i = 0; i < nodes.length; i++) {
        for (var j = i + 1; j < nodes.length; j++) {
            var shared = sharedStackCount(nodes[i], nodes[j]);
            if (shared >= 2) edges.push({ a: i, b: j, weight: shared });
        }
    }

    var degree = nodes.map(function () { return 0; });
    var adjacency = nodes.map(function () { return []; });
    edges.forEach(function (e) {
        degree[e.a]++; degree[e.b]++;
        adjacency[e.a].push(e.b);
        adjacency[e.b].push(e.a);
    });

    // ---- connected components (union-find) — decides the core/solo split ----
    var parent = nodes.map(function (_, idx) { return idx; });
    function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
    function union(a, b) { var ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; }
    edges.forEach(function (e) { union(e.a, e.b); });

    var componentRoot = nodes.map(function (_, idx) { return find(idx); });
    var componentSize = {};
    componentRoot.forEach(function (root) { componentSize[root] = (componentSize[root] || 0) + 1; });
    var mainRoot = null, mainSize = 0;
    Object.keys(componentSize).forEach(function (root) {
        if (componentSize[root] > mainSize) { mainSize = componentSize[root]; mainRoot = parseInt(root, 10); }
    });
    // Only split with a dominant cluster (>=4 members) and at least one
    // project outside it — otherwise fall back to a single free-form layout.
    var doSplit = mainRoot !== null && mainSize >= 4 && mainSize < nodes.length;
    var isMainNode = nodes.map(function (_, idx) { return !doSplit || componentRoot[idx] === mainRoot; });
    var mainIdx = [], soloIdx = [];
    nodes.forEach(function (n, idx) { (isMainNode[idx] ? mainIdx : soloIdx).push(idx); });
    var coreEdges = edges.filter(function (e) { return isMainNode[e.a]; });

    // ---- sizing ----
    var ctx = canvas.getContext("2d");
    var w = 0, h = 0;
    var rects = { core: null, solo: null, gap: 0 };

    function resizeCanvas() {
        var ratio = window.devicePixelRatio || 1;
        var rect = canvas.getBoundingClientRect();
        w = rect.width || 800;
        h = rect.height || 560;
        canvas.width = w * ratio;
        canvas.height = h * ratio;
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    }

    function computeRects() {
        if (soloIdx.length === 0) {
            return { core: { x: 0, y: 0, w: w, h: h }, solo: null, gap: 0, stacked: false };
        }
        // Side-by-side crushes both halves below ~700px (confirmed unusable
        // at 375px) — stack solo beneath the core instead, each full width.
        if (w < 700) {
            var soloH = clamp(140, h * 0.32, 220);
            var stackGap = 20;
            var coreH = Math.max(180, h - soloH - stackGap);
            return {
                core: { x: 0, y: 0, w: w, h: coreH },
                solo: { x: 0, y: coreH + stackGap, w: w, h: soloH },
                gap: stackGap,
                stacked: true
            };
        }
        var soloWidth = clamp(150, w * 0.24, 230);
        var gap = 26;
        var coreW = Math.max(200, w - soloWidth - gap);
        return {
            core: { x: 0, y: 0, w: coreW, h: h },
            solo: { x: coreW + gap, y: 0, w: soloWidth, h: h },
            gap: gap,
            stacked: false
        };
    }

    // ---- Fruchterman-Reingold layout, fixed iteration count, confined to a rect ----
    function layoutForce(rect, idxList, edgeList) {
        var count = idxList.length;
        if (count === 0) return;
        var area = rect.w * rect.h;
        var k = Math.sqrt(area / count) * 0.9;

        // Only seed the circular start on first layout — a resize re-runs
        // this function, and reusing prior positions avoids the graph
        // jumping on every viewport change.
        idxList.forEach(function (idx, pos) {
            if (typeof nodes[idx].x === "number") return;
            var angle = (pos / count) * Math.PI * 2;
            var radius = Math.min(rect.w, rect.h) * 0.35;
            nodes[idx].x = rect.x + rect.w / 2 + Math.cos(angle) * radius + (Math.random() - 0.5) * 20;
            nodes[idx].y = rect.y + rect.h / 2 + Math.sin(angle) * radius + (Math.random() - 0.5) * 20;
        });

        var iterations = 220;
        var temp = Math.max(rect.w, rect.h) * 0.06;

        for (var iter = 0; iter < iterations; iter++) {
            var disp = {};
            idxList.forEach(function (idx) { disp[idx] = { x: 0, y: 0 }; });

            for (var a = 0; a < count; a++) {
                for (var b = a + 1; b < count; b++) {
                    var ii = idxList[a], jj = idxList[b];
                    var dx = nodes[ii].x - nodes[jj].x;
                    var dy = nodes[ii].y - nodes[jj].y;
                    var dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
                    var force = (k * k) / dist;
                    var fx = (dx / dist) * force;
                    var fy = (dy / dist) * force;
                    disp[ii].x += fx; disp[ii].y += fy;
                    disp[jj].x -= fx; disp[jj].y -= fy;
                }
            }

            edgeList.forEach(function (e) {
                var na = nodes[e.a], nb = nodes[e.b];
                var dx = na.x - nb.x;
                var dy = na.y - nb.y;
                var dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
                var force = ((dist * dist) / k) * (1 + e.weight * 0.15);
                var fx = (dx / dist) * force;
                var fy = (dy / dist) * force;
                disp[e.a].x -= fx; disp[e.a].y -= fy;
                disp[e.b].x += fx; disp[e.b].y += fy;
            });

            idxList.forEach(function (idx) {
                var d = disp[idx];
                var dist = Math.max(1, Math.sqrt(d.x * d.x + d.y * d.y));
                var n = nodes[idx];
                n.x += (d.x / dist) * Math.min(dist, temp);
                n.y += (d.y / dist) * Math.min(dist, temp);
                n.x = Math.max(rect.x + 20, Math.min(rect.x + rect.w - 20, n.x));
                n.y = Math.max(rect.y + 20, Math.min(rect.y + rect.h - 20, n.y));
            });

            temp *= 0.97;
        }
    }

    // Solo nodes use a plain reading-order grid, not force simulation
    // (avoids a repulsion pass flinging a 2-node component apart). Same-
    // component nodes stay adjacent so short edges don't cross the strip.
    function layoutSolo(rect, idxList) {
        if (idxList.length === 0) return;
        var order = idxList.slice().sort(function (a, b) {
            if (componentRoot[a] !== componentRoot[b]) return componentRoot[a] - componentRoot[b];
            return nodes[a].name.localeCompare(nodes[b].name);
        });

        var padTop = 72; // room for the "lone pieces" caption, plus breathing room before the first row
        var padSide = 16;
        var rowH = 24;
        var usableH = Math.max(rowH, rect.h - padTop - 16);
        var rowsPerCol = Math.max(1, Math.floor(usableH / rowH));
        var cols = Math.max(1, Math.ceil(order.length / rowsPerCol));
        var colW = (rect.w - padSide * 2) / cols;

        order.forEach(function (idx, pos) {
            var col = Math.floor(pos / rowsPerCol);
            var row = pos % rowsPerCol;
            // Dot sits near the column's left edge — centering wasted space
            // and clipped longer project names against the canvas edge.
            nodes[idx].x = rect.x + padSide + colW * col + 6;
            nodes[idx].y = rect.y + padTop + row * rowH;
            // With 2+ columns, a label's real limit is its own column's
            // right edge, not the canvas edge — draw() falls back to canvas
            // edge when unset.
            nodes[idx]._labelMaxWidth = cols > 1 ? (colW - 6 - 10) : null;
        });
    }

    // Greedy label placement: tries a fixed set of candidate spots per
    // node (top to bottom, earlier nodes claim first) and picks the first
    // one that doesn't collide with an already-placed label's box.
    function layoutMainLabels(idxList, rect) {
        if (idxList.length === 0) return;
        var mono = readColor("--font-mono", "monospace");
        ctx.font = "13px " + mono;
        var placed = [];
        // Labels can sit up to ~26px off their node — a node pinned near the
        // rect edge would otherwise push its label past the boundary and
        // into the divider/solo strip. Keep every candidate's box inside rect.
        var minY = rect.y + 9, maxY = rect.y + rect.h - 4;
        var minX = rect.x + 6, maxX = rect.x + rect.w - 6;
        var order = idxList.slice().sort(function (a, b) { return nodes[a].y - nodes[b].y; });
        order.forEach(function (idx) {
            var n = nodes[idx];
            var radius = clamp(3.5, 3.5 + degree[idx] * 0.45, 7.5);
            var textW = ctx.measureText(n.name).width;
            var xRight = Math.min(n.x + radius + 5, maxX - textW);
            var xLeft = Math.max(minX, n.x - radius - 5 - textW);
            // Dense clusters exhaust 4 same-side candidates fast — trying
            // both sides of the node at each vertical offset, over more
            // tiers, gives the greedy placer real room to dodge a crowded
            // neighborhood instead of settling on a touching/overlapping spot.
            var candidates = [];
            [-radius - 5, radius + 12, radius + 26, -radius - 19, radius + 40, -radius - 33].forEach(function (dy) {
                var y = clamp(minY, n.y + dy, maxY);
                candidates.push({ x: xRight, y: y });
                candidates.push({ x: xLeft, y: y });
            });
            // A small pad between boxes so adjacent labels never visually
            // touch even when the greedy placer has to accept a collision.
            var pad = 3;
            var chosen = candidates[0];
            for (var t = 0; t < candidates.length; t++) {
                var c = candidates[t];
                var cx0 = c.x - pad, cx1 = c.x + textW + pad;
                var y0 = c.y - 10 - pad, y1 = c.y + 3 + pad;
                var collides = placed.some(function (r) {
                    return !(cx1 < r.x0 || cx0 > r.x1 || y1 < r.y0 || y0 > r.y1);
                });
                chosen = c;
                if (!collides) break;
            }
            n._labelX = chosen.x;
            n._labelY = chosen.y;
            n._labelW = textW;
            placed.push({ x0: chosen.x - pad, x1: chosen.x + textW + pad, y0: chosen.y - 10 - pad, y1: chosen.y + 3 + pad });
        });
    }

    function runLayout() {
        rects = computeRects();
        layoutForce(rects.core, mainIdx, coreEdges);
        layoutSolo(rects.solo, soloIdx);
        layoutMainLabels(mainIdx, rects.core);
    }

    // ---- filters (category legend + technology chips), fade not hide ----
    var categoryFilter = null;
    var techFilter = null;

    function passesFilter(n) {
        var passCat = !categoryFilter || n.category === categoryFilter;
        var passTech = !techFilter || nodeHasTech(n, techFilter);
        return passCat && passTech;
    }

    // ---- drawing ----
    var hovered = null;

    function nodeFactor(n) {
        var pass = passesFilter(n);
        if (!hovered) return pass ? 1 : 0.15;
        if (n === hovered) return 1;
        if (adjacency[hovered._i].indexOf(n._i) !== -1) return pass ? 0.95 : 0.4;
        return pass ? 0.22 : 0.06;
    }

    function draw() {
        ctx.clearRect(0, 0, w, h);

        var line = readColor("--line", "#cbd3cb");
        var ink = readColor("--ink", "#17211b");
        var inkFaint = readColor("--ink-faint", "#5c6a61");
        var moss = readColor("--moss", "#2f5942");
        var spark = readColor("--spark", "#b8721a");
        var card = readColor("--card", "#161b21");
        var mono = readColor("--font-mono", "monospace");
        var catColors = {
            leadership: readColor("--cat-leadership", spark),
            architecture: readColor("--cat-architecture", moss),
            feature: readColor("--cat-feature", inkFaint)
        };

        if (soloIdx.length > 0 && rects.solo) {
            ctx.beginPath();
            if (rects.stacked) {
                var dividerY = rects.solo.y - rects.gap / 2;
                ctx.moveTo(8, dividerY);
                ctx.lineTo(w - 8, dividerY);
            } else {
                var dividerX = rects.solo.x - rects.gap / 2;
                ctx.moveTo(dividerX, 8);
                ctx.lineTo(dividerX, h - 8);
            }
            ctx.strokeStyle = line;
            ctx.globalAlpha = 0.7;
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.globalAlpha = 1;

            ctx.fillStyle = inkFaint;
            ctx.font = "600 12px " + mono;
            ctx.fillText("lone pieces", rects.solo.x + 16, rects.solo.y + 20);
            ctx.font = "12px " + mono;
            // Bold text reaches higher (taller caps) than the line below —
            // needs a bigger baseline gap than a same-size normal-weight pair.
            ctx.fillText("< 2 shared techs", rects.solo.x + 16, rects.solo.y + 40);
        }

        // ---- edges ----
        // Only main-cluster edges are drawn — an edge between two solo
        // projects would draw a stray line across the solo strip's flat list.
        ctx.lineCap = "round";
        coreEdges.forEach(function (e) {
            var a = nodes[e.a], b = nodes[e.b];
            var incident = hovered && (e.a === hovered._i || e.b === hovered._i);
            var strokeColor = line, width = 1, alpha;
            if (incident) {
                strokeColor = moss;
                width = 1.6;
                alpha = 0.85 * Math.min(passesFilter(a) ? 1 : 0.5, passesFilter(b) ? 1 : 0.5);
            } else {
                var baseAlpha = Math.min(0.5, 0.14 + e.weight * 0.07);
                var dimForHover = hovered ? 0.15 : 1;
                var dimForFilter = (passesFilter(a) && passesFilter(b)) ? 1 : 0.12;
                alpha = baseAlpha * dimForHover * dimForFilter;
            }
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = strokeColor;
            ctx.globalAlpha = alpha;
            ctx.lineWidth = width;
            ctx.stroke();
        });
        ctx.globalAlpha = 1;

        // ---- nodes + always-visible labels ----
        nodes.forEach(function (n) {
            var factor = nodeFactor(n);
            var color = catColors[n.category] || catColors.feature;
            var baseRadius = clamp(3.5, 3.5 + degree[n._i] * 0.45, 7.5);
            var radius = n === hovered ? baseRadius + 2.5 : baseRadius;
            var isNeighbor = hovered && adjacency[hovered._i].indexOf(n._i) !== -1;

            ctx.beginPath();
            ctx.arc(n.x, n.y, radius, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.globalAlpha = factor;
            ctx.fill();
            if (n === hovered) {
                ctx.lineWidth = 1.5;
                ctx.strokeStyle = spark;
                ctx.globalAlpha = 1;
                ctx.stroke();
            }

            // Labels used to get knocked down to ~0.65-0.85 alpha even at
            // rest (nothing hovered, no filter active) — stacking that on
            // top of inkFaint (already at the WCAG AA floor per the site's
            // own contrast audit) read as barely-there, worst in light
            // theme. Dimming is only earned when something else is hovered
            // or this node is filtered out; otherwise render at full ink.
            var emphasized = n === hovered || isNeighbor;
            var deemphasized = (hovered && !emphasized) || !passesFilter(n);
            var labelAlpha = n === hovered ? 1 : (isNeighbor ? Math.max(factor, 0.95) : (deemphasized ? factor : 1));
            if (labelAlpha > 0.05) {
                ctx.font = (emphasized ? "600 " : "") + (n === hovered ? 14 : 13) + "px " + mono;
                ctx.fillStyle = deemphasized ? inkFaint : ink;
                // Main-cluster label Y is precomputed by layoutMainLabels()
                // (a real collision check). Solo strip labels stay centered
                // on their dot.
                var labelY;
                if (isMainNode[n._i]) {
                    labelY = typeof n._labelY === "number" ? n._labelY : (n.y - radius - 5);
                } else {
                    labelY = n.y + 3;
                }
                var labelX = isMainNode[n._i] && typeof n._labelX === "number" ? n._labelX : n.x + radius + 5;
                var displayName = n.name;
                if (!isMainNode[n._i]) {
                    // Longest project names can still run past the edge (or
                    // next column) — truncate with an ellipsis rather than
                    // clip/overlap.
                    var maxWidth = typeof n._labelMaxWidth === "number" ? n._labelMaxWidth : (w - labelX - 8);
                    if (ctx.measureText(displayName).width > maxWidth) {
                        var lo = 0, hi = displayName.length;
                        while (lo < hi) {
                            var mid = Math.ceil((lo + hi) / 2);
                            if (ctx.measureText(displayName.slice(0, mid) + "…").width <= maxWidth) lo = mid; else hi = mid - 1;
                        }
                        displayName = displayName.slice(0, lo) + "…";
                    }
                }
                if (isMainNode[n._i]) {
                    // The core cluster's edges run under every label — a
                    // solid halo keeps text readable instead of dissolving
                    // into whatever lines happen to cross behind it.
                    var haloW = typeof n._labelW === "number" ? n._labelW : ctx.measureText(displayName).width;
                    ctx.globalAlpha = Math.min(0.92, labelAlpha + 0.1);
                    ctx.fillStyle = card;
                    ctx.fillRect(labelX - 3, labelY - 11, haloW + 6, 15);
                    ctx.fillStyle = deemphasized ? inkFaint : ink;
                }
                ctx.globalAlpha = labelAlpha;
                ctx.fillText(displayName, labelX, labelY);
            }
        });
        ctx.globalAlpha = 1;

        // ---- empty-filter state ----
        // A filter combo matching nothing fades the canvas with no
        // explanation otherwise — reads as broken rather than "no matches."
        if (nodes.every(function (n) { return !passesFilter(n); })) {
            ctx.fillStyle = inkFaint;
            ctx.font = "13px " + mono;
            ctx.textAlign = "center";
            ctx.globalAlpha = 1;
            ctx.fillText("No projects match this filter combination.", w / 2, h / 2);
            ctx.textAlign = "left";
        }
    }

    // ---- one-shot entrance tween (converges to the computed layout, terminates) ----
    function animateEntrance() {
        if (prefersReducedMotion()) { draw(); return; }
        var cx = w / 2, cy = h / 2;
        nodes.forEach(function (n) { n._tx = n.x; n._ty = n.y; n.x = cx; n.y = cy; });
        var start = null;
        var duration = 650;
        function step(ts) {
            if (start === null) start = ts;
            var t = Math.min(1, (ts - start) / duration);
            var eased = 1 - Math.pow(1 - t, 3);
            nodes.forEach(function (n) {
                n.x = cx + (n._tx - cx) * eased;
                n.y = cy + (n._ty - cy) * eased;
            });
            draw();
            if (t < 1) requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
    }

    // ---- interaction: drag to nudge, click/tap to navigate, hover to trace ----
    // Touch has no hover, so first tap previews (fade/highlight like hover),
    // second tap on the same node navigates. Mouse/pen click straight through.
    var dragging = null;
    var dragMoved = false;
    var downPointerType = "mouse";

    function nodeAt(x, y) {
        for (var idx = nodes.length - 1; idx >= 0; idx--) {
            var n = nodes[idx];
            var dx = x - n.x, dy = y - n.y;
            if (dx * dx + dy * dy <= 13 * 13) return n;
        }
        return null;
    }

    function eventPoint(e) {
        var rect = canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function setHovered(n) {
        hovered = n;
        if (!hintEl) return;
        hintEl.textContent = n ? ("tap again to open " + n.name) : defaultHint;
    }

    canvas.addEventListener("pointerdown", function (e) {
        downPointerType = e.pointerType || "mouse";
        var p = eventPoint(e);
        var hit = nodeAt(p.x, p.y);
        if (hit) {
            dragging = hit;
            dragMoved = false;
        } else if (downPointerType === "touch" && hovered) {
            setHovered(null);
            draw();
        }
    });

    canvas.addEventListener("pointermove", function (e) {
        var p = eventPoint(e);
        if (dragging) {
            dragging.x = Math.max(10, Math.min(w - 10, p.x));
            dragging.y = Math.max(10, Math.min(h - 10, p.y));
            dragMoved = true;
            draw();
            return;
        }
        var hit = nodeAt(p.x, p.y);
        if (hit !== hovered) {
            setHovered(hit);
            canvas.style.cursor = hovered ? "pointer" : "default";
            draw();
        }
    });

    window.addEventListener("pointerup", function () {
        if (dragging && !dragMoved) {
            if (downPointerType === "touch") {
                if (hovered === dragging) {
                    window.location.href = dragging.url;
                } else {
                    setHovered(dragging);
                    draw();
                }
            } else {
                window.location.href = dragging.url;
            }
        }
        dragging = null;
    });

    canvas.addEventListener("pointerleave", function () {
        if (!dragging) { setHovered(null); draw(); }
    });

    // ---- category legend (reuses /projects/'s .dot--* colors) ----
    if (legendEl) {
        var catButtons = legendEl.querySelectorAll(".fchip");
        catButtons.forEach(function (btn) {
            btn.addEventListener("click", function () {
                catButtons.forEach(function (b) {
                    b.classList.remove("active");
                    b.setAttribute("aria-pressed", "false");
                });
                btn.classList.add("active");
                btn.setAttribute("aria-pressed", "true");
                categoryFilter = btn.dataset.cat === "all" ? null : btn.dataset.cat;
                hovered = null;
                draw();
            });
        });
    }

    // ---- technology chip list, built from data-nodes (no extra template plumbing) ----
    function buildTechChips() {
        if (!techsEl) return;
        var counts = {};
        nodes.forEach(function (n) {
            var seen = {};
            (n.stack || []).forEach(function (t) {
                var key = t.toLowerCase();
                if (seen[key]) return;
                seen[key] = true;
                if (!counts[key]) counts[key] = { label: t, count: 0 };
                counts[key].count++;
            });
        });
        // Only techs that actually recur (2+ projects) can ever light up an
        // edge — a 1-project tech has nothing to "trace", so it's left out.
        var list = Object.keys(counts).map(function (k) { return counts[k]; })
            .filter(function (t) { return t.count >= 2; })
            .sort(function (a, b) { return b.count - a.count || a.label.localeCompare(b.label); });

        if (list.length === 0) { techsEl.hidden = true; return; }

        var label = document.createElement("span");
        label.className = "project-graph__techs-label";
        label.textContent = "Trace a technology:";
        techsEl.appendChild(label);

        list.forEach(function (t) {
            var btn = document.createElement("button");
            btn.type = "button";
            btn.className = "fchip";
            btn.dataset.tech = t.label.toLowerCase();
            btn.setAttribute("aria-pressed", "false");
            btn.appendChild(document.createTextNode(t.label + " "));
            var countEl = document.createElement("span");
            countEl.className = "n";
            countEl.textContent = t.count;
            btn.appendChild(countEl);
            btn.addEventListener("click", function () {
                var wasActive = btn.classList.contains("active");
                techsEl.querySelectorAll(".fchip").forEach(function (b) {
                    b.classList.remove("active");
                    b.setAttribute("aria-pressed", "false");
                });
                if (wasActive) {
                    techFilter = null;
                } else {
                    btn.classList.add("active");
                    btn.setAttribute("aria-pressed", "true");
                    techFilter = btn.dataset.tech;
                }
                hovered = null;
                draw();
            });
            techsEl.appendChild(btn);
        });
    }

    // ---- resize (debounced) ----
    var resizeTimer = null;
    window.addEventListener("resize", function () {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () {
            // Mobile browsers fire resize on every scroll (URL bar show/hide) —
            // only re-run the simulation when the canvas actually changed shape.
            var prevW = w, prevH = h;
            resizeCanvas();
            if (Math.abs(w - prevW) < 40 && Math.abs(h - prevH) < 40) { draw(); return; }
            runLayout();
            draw();
        }, 150);
    });

    document.addEventListener("themechange", draw);

    function init() {
        resizeCanvas();
        runLayout();
        buildTechChips();
        animateEntrance();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
