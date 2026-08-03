// Site search: ⌘K/Ctrl+K (or the header search button) opens a palette
// over a small hand-rolled JSON corpus (templates/search_data.html,
// fetched lazily on first open) — plain substring matching, no third-party
// search library, matching this site's no-bundler/vanilla-JS convention.
(function () {
    "use strict";

    var trigger = document.getElementById("search-trigger");
    var corpus = null;
    var corpusPromise = null;
    var overlay, input, results, selectedIndex;

    // Hidden palette commands, matched by exact prefix only (not substring
    // like corpus results) so they stay opt-in discoveries. "whoami" has no
    // run() — its excerpt line below IS the payload.
    var COMMANDS = [
        {
            id: "theme-paint",
            title: "theme:paint",
            excerpt: "Arms the theme toggle's drag-to-paint brush mode.",
            run: function () {
                if (window.__armThemeBrush) window.__armThemeBrush();
            }
        },
        {
            id: "whoami",
            title: "whoami",
            excerpt: document.body.dataset.whoami || "",
            run: null
        }
    ];

    function loadCorpus() {
        if (corpusPromise) return corpusPromise;
        corpusPromise = fetch("/search-data/")
            .then(function (r) { return r.text(); })
            .then(function (text) {
                // Served as text/html, not a real .json file, so `zola
                // serve`'s dev livereload script gets appended after the
                // JSON body — a plain r.json() can't parse that. Parse up
                // to the array's closing bracket instead, which works in
                // both dev and production.
                var end = text.lastIndexOf("]");
                var data = JSON.parse(end === -1 ? text : text.slice(0, end + 1));
                corpus = data;
                return data;
            })
            .catch(function () {
                corpus = [];
                return corpus;
            });
        return corpusPromise;
    }

    function ensureOverlay() {
        if (overlay) return;
        overlay = document.createElement("div");
        overlay.className = "search-overlay";
        overlay.setAttribute("role", "dialog");
        overlay.setAttribute("aria-modal", "true");
        overlay.setAttribute("aria-label", "Site search");
        overlay.innerHTML =
            '<div class="search-palette">' +
            '<input type="text" class="search-palette__input" placeholder="Search posts and pages…" aria-label="Search" autocomplete="off">' +
            '<ul class="search-palette__results" role="listbox"></ul>' +
            '<div class="search-palette__hint">↑↓ navigate &middot; ↵ open &middot; esc close</div>' +
            "</div>";
        document.body.appendChild(overlay);
        input = overlay.querySelector(".search-palette__input");
        results = overlay.querySelector(".search-palette__results");

        overlay.addEventListener("click", function (e) {
            if (e.target === overlay) close();
        });
        input.addEventListener("input", function () { renderResults(input.value); });
        input.addEventListener("keydown", onInputKeyDown);
    }

    function score(item, q) {
        var title = item.title.toLowerCase();
        var excerpt = (item.excerpt || "").toLowerCase();
        var s = 0;
        if (title.indexOf(q) !== -1) s += title === q ? 100 : title.indexOf(q) === 0 ? 40 : 20;
        if (excerpt.indexOf(q) !== -1) s += 5;
        return s;
    }

    function runCommand(cmd) {
        close();
        if (cmd.run) cmd.run();
    }

    function renderResults(query) {
        var q = query.trim().toLowerCase();
        results.innerHTML = "";
        selectedIndex = -1;
        if (!q) return;

        var cmdMatches = COMMANDS.filter(function (c) {
            return c.title.indexOf(q) === 0;
        });

        var i = 0;
        cmdMatches.forEach(function (cmd) {
            var idx = i++;
            var li = document.createElement("li");
            li.className = "search-palette__result search-palette__result--command";
            li.setAttribute("role", "option");
            li.dataset.cmd = cmd.id;
            li.innerHTML =
                '<span class="search-palette__result-title">' + escapeHtml(cmd.title) + "</span>" +
                '<span class="search-palette__result-excerpt">' + escapeHtml(cmd.excerpt) + "</span>";
            li.addEventListener("mouseenter", function () { setSelected(idx); });
            li.addEventListener("click", function () { runCommand(cmd); });
            results.appendChild(li);
        });

        if (corpus) {
            corpus
                .map(function (item) { return { item: item, s: score(item, q) }; })
                .filter(function (m) { return m.s > 0; })
                .sort(function (a, b) { return b.s - a.s; })
                .slice(0, 8)
                .forEach(function (m) {
                    var idx = i++;
                    var li = document.createElement("li");
                    li.className = "search-palette__result";
                    li.setAttribute("role", "option");
                    li.dataset.url = m.item.url;
                    li.innerHTML =
                        '<span class="search-palette__result-title">' + escapeHtml(m.item.title) + "</span>" +
                        '<span class="search-palette__result-excerpt">' + escapeHtml(truncate(m.item.excerpt, 110)) + "</span>";
                    li.addEventListener("mouseenter", function () { setSelected(idx); });
                    li.addEventListener("click", function () { navigate(m.item.url); });
                    results.appendChild(li);
                });
        }

        if (i > 0) setSelected(0);
    }

    function truncate(s, n) {
        if (!s) return "";
        return s.length > n ? s.slice(0, n).trim() + "…" : s;
    }

    function escapeHtml(s) {
        var div = document.createElement("div");
        div.textContent = s || "";
        return div.innerHTML;
    }

    function setSelected(i) {
        var items = results.querySelectorAll(".search-palette__result");
        items.forEach(function (el) { el.classList.remove("is-selected"); });
        if (items[i]) {
            items[i].classList.add("is-selected");
            items[i].scrollIntoView({ block: "nearest" });
        }
        selectedIndex = i;
    }

    function navigate(url) {
        window.location.href = url;
    }

    function onInputKeyDown(e) {
        var items = results.querySelectorAll(".search-palette__result");
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setSelected(Math.min(selectedIndex + 1, items.length - 1));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setSelected(Math.max(selectedIndex - 1, 0));
        } else if (e.key === "Enter") {
            var selected = selectedIndex >= 0 ? items[selectedIndex] : null;
            if (!selected) return;
            if (selected.dataset.cmd) {
                var cmd = COMMANDS.filter(function (c) { return c.id === selected.dataset.cmd; })[0];
                if (cmd) runCommand(cmd);
            } else if (selected.dataset.url) {
                navigate(selected.dataset.url);
            }
        } else if (e.key === "Escape") {
            close();
        }
    }

    var lastFocused = null;

    function open() {
        ensureOverlay();
        lastFocused = document.activeElement;
        loadCorpus().then(function () {
            // Covers typing faster than the fetch resolves — corpus arrives
            // after renderResults() already ran with corpus still null, and
            // nothing else re-renders on its own.
            if (input.value) renderResults(input.value);
        });
        overlay.classList.add("is-open");
        document.body.classList.add("search-open");
        input.value = "";
        results.innerHTML = "";
        window.setTimeout(function () { input.focus(); }, 0);
        document.addEventListener("keydown", onGlobalKeyDown);
    }

    function close() {
        if (!overlay) return;
        overlay.classList.remove("is-open");
        document.body.classList.remove("search-open");
        document.removeEventListener("keydown", onGlobalKeyDown);
        if (lastFocused && lastFocused.focus) lastFocused.focus();
    }

    function onGlobalKeyDown(e) {
        if (e.key === "Escape") close();
    }

    document.addEventListener("keydown", function (e) {
        var isMac = /Mac|iPhone|iPad/.test(navigator.platform || "");
        var mod = isMac ? e.metaKey : e.ctrlKey;
        if (mod && e.key.toLowerCase() === "k") {
            e.preventDefault();
            if (overlay && overlay.classList.contains("is-open")) {
                close();
            } else {
                open();
            }
        }
    });

    if (trigger) trigger.addEventListener("click", open);
})();
