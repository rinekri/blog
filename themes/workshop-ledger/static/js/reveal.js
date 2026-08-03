// Generic scroll-reveal for any [data-reveal] element (page.html's post
// header and post footer). Fades content in once it enters the viewport.
(function () {
    var targets = document.querySelectorAll("[data-reveal]");
    if (!targets.length) return;

    var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
        targets.forEach(function (el) { el.classList.add("is-revealed"); });
        return;
    }

    if (!("IntersectionObserver" in window)) {
        targets.forEach(function (el) { el.classList.add("is-revealed"); });
        return;
    }

    var observer = new IntersectionObserver(
        function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) {
                    entry.target.classList.add("is-revealed");
                    observer.unobserve(entry.target);
                }
            });
        },
        // Fires when the element's top edge comes within 80px of the
        // viewport bottom, not an area-ratio threshold — the ratio shifts
        // with element height, wrong for .post-footer once the utterances
        // iframe loads in.
        { rootMargin: "0px 0px -80px 0px", threshold: 0 }
    );

    targets.forEach(function (el) { observer.observe(el); });
})();
