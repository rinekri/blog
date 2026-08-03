// Per-post share: navigator.share() when available (mobile browsers, most
// desktop Safari/Edge), copy-link fallback everywhere else — one button,
// not a row of platform icons.
(function () {
    var button = document.querySelector(".post-share");
    if (!button) return;

    var idleLabel = button.textContent;

    function flashLabel(text) {
        button.textContent = text;
        setTimeout(function () {
            button.textContent = idleLabel;
        }, 2000);
    }

    button.addEventListener("click", function () {
        var title = button.getAttribute("data-share-title") || document.title;
        var url = button.getAttribute("data-share-url") || window.location.href;

        if (navigator.share) {
            navigator.share({ title: title, url: url }).catch(function () {});
            return;
        }

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard
                .writeText(url)
                .then(function () {
                    flashLabel("Copied!");
                })
                .catch(function () {});
        }
    });
})();
