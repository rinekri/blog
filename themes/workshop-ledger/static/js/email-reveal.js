// /resume/'s contact email: never present in initial page source (not
// even obfuscated), only reversed fragments here joined on click. Defeats
// mass HTML scrapers and non-interactive headless fetches, not a targeted
// human reader — that's out of scope.
(function () {
    "use strict";

    var btn = document.getElementById("email-unmask");
    if (!btn) return;

    var maskEl = btn.querySelector(".resume-unmask__mask");
    var captionEl = btn.querySelector(".resume-unmask__caption");
    var liveEl = document.getElementById("email-unmask-live");
    var revealed = false;

    function prefersReducedMotion() {
        return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    }

    // Reversed fragments joined only here — never a contiguous, greppable
    // substring anywhere in this file (a plain-text comment here would
    // defeat the point same as leaving it in the HTML).
    function address() {
        var frags = ["ir", "ken", "ir", "@", "liamg", "moc."];
        return frags
            .map(function (f) {
                return f.split("").reverse().join("");
            })
            .join("");
    }

    var SCRAMBLE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

    function randomChar() {
        return SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
    }

    function swapToLink(email) {
        var a = document.createElement("a");
        a.className = "resume-byline__contact";
        a.href = "mailto:" + email;
        a.textContent = email;
        btn.replaceWith(a);
        a.focus();
        if (liveEl) liveEl.textContent = "Email revealed: " + email;
    }

    function reveal(instant) {
        if (revealed) return;
        revealed = true;
        var email = address();

        // Print snapshots synchronously right after "beforeprint" fires,
        // before the animated scramble below would finish — always take
        // the instant path.
        if (instant || prefersReducedMotion()) {
            swapToLink(email);
            return;
        }

        btn.classList.add("is-unmasking");
        captionEl.textContent = "unmasking…";

        var frames = 10;
        var frameDelay = 40;
        var perCharStagger = 15;

        for (var i = 0; i < email.length; i++) {
            (function (index) {
                for (var f = 0; f < frames; f++) {
                    setTimeout(function () {
                        var chars = maskEl.textContent.split("");
                        chars[index] = f === frames - 1 ? email[index] : randomChar();
                        maskEl.textContent = chars.join("");
                    }, index * perCharStagger + f * frameDelay);
                }
            })(i);
        }

        var totalDelay = email.length * perCharStagger + frames * frameDelay + 120;
        setTimeout(function () {
            swapToLink(email);
        }, totalDelay);
    }

    btn.addEventListener("click", function () {
        reveal(false);
    });

    // Explicit printing already proves real interaction, not scraper
    // behavior — printed output should carry the real clickable address.
    window.addEventListener("beforeprint", function () {
        reveal(true);
    });
})();
