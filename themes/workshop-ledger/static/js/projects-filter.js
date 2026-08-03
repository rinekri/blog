(function () {
    var bar = document.getElementById("filterBar");
    if (!bar) return;
    var chips = bar.querySelectorAll(".fchip");
    var groups = document.querySelectorAll(".pgroup");
    var rows = document.querySelectorAll("[data-vis]");
    var stackInput = document.getElementById("stackFilter");
    var activeChip = "all";

    function setRowDisplay(r, display) {
        r.style.display = display;
        var more = r.nextElementSibling;
        if (more && more.classList.contains("prow-more")) more.style.display = display;
    }

    function updateCounts() {
        groups.forEach(function (g) {
            if (g.style.display === "none") return;
            var items = g.querySelectorAll("[data-vis]");
            var visible = 0;
            items.forEach(function (it) { if (it.style.display !== "none") visible++; });
            var countEl = g.querySelector(".pgroup-count");
            if (countEl) countEl.textContent = visible;
            g.style.display = visible === 0 ? "none" : "";
        });
    }

    function rowMatchesChip(r, f) {
        if (f === "all") return true;
        if (f === "public" || f === "confidential") return r.dataset.vis === f;
        if (f === "highlights") return r.classList.contains("pcard");
        return true; // group-specific chips gate via group display below, not per-row
    }

    // Two independent filter axes — the visibility/group chip and the
    // stack-text query — combine with AND, so "Open Source" + "kotlin"
    // narrows to open-source Kotlin projects rather than either alone.
    function applyFilters() {
        var query = stackInput ? stackInput.value.trim().toLowerCase() : "";
        var isGroupFilter = activeChip !== "all" && activeChip !== "public" && activeChip !== "confidential" && activeChip !== "highlights";

        groups.forEach(function (g) {
            g.style.display = (isGroupFilter && g.dataset.group !== activeChip) ? "none" : "";
        });

        rows.forEach(function (r) {
            var chipMatch = rowMatchesChip(r, activeChip);
            var stackMatch = !query || (r.dataset.stack || "").indexOf(query) !== -1;
            setRowDisplay(r, (chipMatch && stackMatch) ? "" : "none");
        });

        updateCounts();
    }

    function selectChip(chip) {
        chips.forEach(function (c) {
            c.classList.remove("active");
            c.setAttribute("aria-pressed", "false");
        });
        chip.classList.add("active");
        chip.setAttribute("aria-pressed", "true");
        activeChip = chip.dataset.f;
        applyFilters();
    }

    chips.forEach(function (chip) {
        chip.addEventListener("click", function () { selectChip(chip); });
    });

    if (stackInput) {
        stackInput.addEventListener("input", applyFilters);
        // ?stack=<tech> pre-fills the filter — the /stack/ specimen wall
        // links here this way so a specimen click actually narrows the
        // list, not just decorates it.
        var presetStack = new URLSearchParams(window.location.search).get("stack");
        if (presetStack) {
            stackInput.value = presetStack;
            applyFilters();
        }
    }

    // ?group=<key> pre-selects that group's chip — same deep-link idea as
    // ?stack= above, for links that should land already narrowed to one
    // group (e.g. the home page's "N commercial projects" stat).
    var presetGroup = new URLSearchParams(window.location.search).get("group");
    if (presetGroup) {
        var matchingChip = bar.querySelector('.fchip[data-f="' + CSS.escape(presetGroup) + '"]');
        if (matchingChip) selectChip(matchingChip);
    }

    // JS-toggled class, not :target — history.replaceState() updates the
    // hash but browsers don't re-evaluate :target from that, only from a
    // real navigation, so a class is the only way this can be dismissed.
    if (window.location.hash.indexOf("#project-") === 0) {
        var highlighted = document.querySelector(window.location.hash);
        if (highlighted) {
            highlighted.classList.add("is-highlighted");
            // Landing via hash auto-focuses the native <summary>, painting
            // the :focus-visible ring on top of the highlight tint.
            // Deferred: the browser's own fragment-focus can land AFTER
            // this script runs, so a synchronous blur() here gets silently
            // overridden a moment later.
            setTimeout(function () {
                highlighted.blur();
            }, 0);
            var dismissHighlight = function (e) {
                if (highlighted.contains(e.target)) return;
                highlighted.classList.remove("is-highlighted");
                history.replaceState(null, "", window.location.pathname + window.location.search);
                document.removeEventListener("click", dismissHighlight);
            };
            document.addEventListener("click", dismissHighlight);
        }
    }
})();
