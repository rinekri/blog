// Highlights the current-section link in whichever TOC is present — the
// mobile <details> .toc and/or the >=1360px .guide-rail (with a fill-bar
// tracking read position and ancestor-path expand/collapse). Works with
// either or neither present.
(function () {
    function collectLinks(container) {
        if (!container) return [];
        var out = [];
        container.querySelectorAll("a[href^='#']").forEach(function (link) {
            var id = decodeURIComponent(link.getAttribute("href").slice(1));
            var heading = document.getElementById(id);
            if (heading) out.push({ id: id, link: link, heading: heading });
        });
        return out;
    }

    function init() {
        var toc = document.querySelector(".toc");
        var guideRail = document.querySelector(".guide-rail");
        var tocEntries = collectLinks(toc);
        var guideRailEntries = collectLinks(guideRail);
        if (!tocEntries.length && !guideRailEntries.length) return;

        var tocLinkById = {};
        tocEntries.forEach(function (e) {
            tocLinkById[e.id] = e.link;
        });

        var guideRailLinkById = {};
        var guideRailOrder = [];
        guideRailEntries.forEach(function (e) {
            guideRailLinkById[e.id] = e.link;
            guideRailOrder.push(e.id);
        });

        // Every heading either TOC references, in document order — what the
        // observer watches. ownerOf falls back to the nearest guide-rail id
        // at or before a heading not shown there itself.
        var idsInToc = {};
        tocEntries.concat(guideRailEntries).forEach(function (e) {
            idsInToc[e.id] = true;
        });
        var allHeadings = Array.prototype.slice
            .call(
                document.querySelectorAll(
                    ".post-content h1[id], .post-content h2[id], .post-content h3[id], .post-content h4[id], .post-content h5[id], .post-content h6[id]"
                )
            )
            .filter(function (h) {
                return idsInToc[h.id];
            });
        if (!allHeadings.length) return;

        var ownerOf = {};
        var lastGuideRailId = null;
        allHeadings.forEach(function (heading) {
            if (guideRailLinkById[heading.id]) lastGuideRailId = heading.id;
            ownerOf[heading.id] = lastGuideRailId;
        });

        // parentOf/ancestorsOf track a full ancestry chain (up to 4 levels),
        // not just "which h2 am I under" — found by walking up from each
        // group's .guide-rail__children container.
        var parentOf = {};
        var childrenElById = {};
        if (guideRail) {
            guideRail.querySelectorAll(".guide-rail__group").forEach(function (group) {
                var id = group.getAttribute("data-id");
                var kids = group.querySelector(":scope > .guide-rail__children");
                if (kids) {
                    childrenElById[id] = kids;
                    kids.addEventListener("transitionend", function (evt) {
                        // The fill-bar reads node positions via getBoundingClientRect,
                        // which are wrong mid-expand — resync once the height
                        // transition actually settles instead of racing it.
                        if (evt.propertyName === "max-height") updateGuideRail();
                    });
                }
                var parentChildrenEl = group.parentElement.closest(".guide-rail__children");
                var parentGroup = parentChildrenEl ? parentChildrenEl.closest(".guide-rail__group") : null;
                if (parentGroup) parentOf[id] = parentGroup.getAttribute("data-id");
            });
        }

        var ancestorsCache = {};
        function ancestorsOf(id) {
            if (ancestorsCache[id]) return ancestorsCache[id];
            var chain = [];
            var cur = parentOf[id];
            while (cur) {
                chain.push(cur);
                cur = parentOf[cur];
            }
            ancestorsCache[id] = chain;
            return chain;
        }

        var guideRailFill = guideRail ? guideRail.querySelector(".guide-rail__fill") : null;
        var guideRailRule = guideRail ? guideRail.querySelector(".guide-rail__rule") : null;
        var guideRailPosition = guideRail ? guideRail.querySelector(".guide-rail__position") : null;
        var guideRailProgress = guideRail ? guideRail.querySelector(".guide-rail__progress") : null;
        var tocPosition = toc ? toc.querySelector(".toc__position") : null;

        var currentId = null;

        // Position readout and the fingerprint progress mark ride the same
        // section index as the fill bar — no separate scroll listener.
        function updatePosition(ownerIndex) {
            var total = guideRailOrder.length;
            if (!total) return;
            var current = ownerIndex >= 0 ? ownerIndex + 1 : 1;
            var text = current + " / " + total;
            if (guideRailPosition) guideRailPosition.textContent = text;
            if (tocPosition) tocPosition.textContent = text;
            if (guideRailProgress && window.__drawFingerprint) {
                guideRailProgress.dataset.weight = (current / total).toFixed(2);
                window.__drawFingerprint(guideRailProgress);
            }
        }
        updatePosition(-1);

        function updateGuideRail() {
            if (!guideRail) return;
            var ownerId = currentId ? ownerOf[currentId] : null;
            var ownerIndex = ownerId ? guideRailOrder.indexOf(ownerId) : -1;
            updatePosition(ownerIndex);

            guideRailOrder.forEach(function (id, i) {
                var link = guideRailLinkById[id];
                var isCurrent = i === ownerIndex;
                link.classList.toggle("is-current", isCurrent);
                link.classList.toggle("is-past", ownerIndex >= 0 && i < ownerIndex);
                if (isCurrent) {
                    link.setAttribute("aria-current", "true");
                } else {
                    link.removeAttribute("aria-current");
                }
            });

            // Open every ancestor group of the current heading, close the
            // rest — a stack, not a single flat "active h2" flag, since
            // nesting runs 4 deep.
            var openPath = ownerId ? ancestorsOf(ownerId) : [];
            Object.keys(childrenElById).forEach(function (id) {
                childrenElById[id].classList.toggle("is-open", openPath.indexOf(id) !== -1);
            });

            if (guideRailFill && guideRailRule && ownerIndex >= 0) {
                var ruleRect = guideRailRule.getBoundingClientRect();
                var linkRect = guideRailLinkById[guideRailOrder[ownerIndex]].getBoundingClientRect();
                var offset = linkRect.top + linkRect.height / 2 - ruleRect.top;
                var pct = Math.max(0, Math.min(100, (offset / ruleRect.height) * 100));
                guideRailFill.style.height = pct + "%";
            }
        }

        function setCurrent(id) {
            if (id === currentId) return;
            if (currentId && tocLinkById[currentId]) {
                tocLinkById[currentId].classList.remove("is-current");
                tocLinkById[currentId].removeAttribute("aria-current");
            }
            currentId = id;
            if (currentId && tocLinkById[currentId]) {
                tocLinkById[currentId].classList.add("is-current");
                tocLinkById[currentId].setAttribute("aria-current", "true");
            }
            updateGuideRail();
        }

        // Smooth-scroll on guide-rail clicks — native '#id' navigation already
        // works via href, this only swaps the jump for eased scrolling
        // (skipped under reduced-motion) and keeps the URL hash in sync.
        guideRailEntries.forEach(function (e) {
            e.link.addEventListener("click", function (evt) {
                evt.preventDefault();
                var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
                e.heading.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
                history.pushState(null, "", "#" + e.id);
            });
        });

        if (!("IntersectionObserver" in window)) return;

        var observer = new IntersectionObserver(
            function (entries) {
                var visible = entries.filter(function (entry) {
                    return entry.isIntersecting;
                });
                if (visible.length === 0) return;
                visible.sort(function (a, b) {
                    return a.boundingClientRect.top - b.boundingClientRect.top;
                });
                setCurrent(visible[0].target.id);
            },
            { rootMargin: "-45% 0px -50% 0px", threshold: 0 }
        );

        allHeadings.forEach(function (heading) {
            observer.observe(heading);
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
