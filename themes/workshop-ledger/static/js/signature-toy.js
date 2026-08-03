// /about/'s "type your name" fingerprint toy — redraws a canvas via
// fingerprint.js's exposed window.__drawFingerprint as you type.
//
// "Save your signature" composites a fresh higher-resolution mark (not
// a scaled copy, which would blur) with the typed text into one PNG,
// reusing drawFingerprint. navigator.share() layers on top when
// supported; otherwise a plain download.
(function () {
    var input = document.getElementById("signature-toy-input");
    var canvas = document.querySelector(".signature-toy__canvas");
    if (!input || !canvas) return;

    function currentSeed() {
        return input.value.trim() || "signature";
    }

    input.addEventListener("input", function () {
        canvas.setAttribute("data-seed", currentSeed());
        if (window.__drawFingerprint) window.__drawFingerprint(canvas);
    });

    var saveBtn = document.getElementById("signature-toy-save");
    if (!saveBtn) return;
    var status = document.getElementById("signature-toy-save-status");

    function readColor(name, fallback) {
        var value = getComputedStyle(document.documentElement).getPropertyValue(name);
        return value ? value.trim() : fallback;
    }

    function buildCard(seed) {
        var w = 480,
            h = 270;
        var ratio = window.devicePixelRatio || 1;
        var card = document.createElement("canvas");
        card.width = w * ratio;
        card.height = h * ratio;
        var ctx = card.getContext("2d");
        ctx.scale(ratio, ratio);

        ctx.fillStyle = readColor("--paper", "#eef1ee");
        ctx.fillRect(0, 0, w, h);

        // A detached canvas has no layout box, so drawFingerprint's
        // getBoundingClientRect() fallback (canvas.width/height) is what
        // actually sizes it — set those attributes before calling it.
        var mark = document.createElement("canvas");
        mark.width = 340;
        mark.height = 150;
        mark.setAttribute("data-seed", seed);
        if (window.__drawFingerprint) window.__drawFingerprint(mark);
        ctx.drawImage(mark, (w - 340) / 2, 40, 340, 150);

        ctx.textAlign = "center";
        ctx.fillStyle = readColor("--ink", "#17211b");
        ctx.font = "600 22px ui-monospace, SFMono-Regular, Menlo, monospace";
        ctx.fillText(seed, w / 2, 220);

        ctx.fillStyle = readColor("--ink-faint", "#5c6a61");
        ctx.font = "13px ui-monospace, SFMono-Regular, Menlo, monospace";
        ctx.fillText(window.location.hostname, w / 2, 244);

        return card;
    }

    function announce(text) {
        if (status) status.textContent = text;
    }

    function downloadBlob(blob, filename) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () {
            URL.revokeObjectURL(url);
        }, 1000);
        announce("Saved.");
    }

    saveBtn.addEventListener("click", function () {
        var seed = currentSeed();
        var filename = "signature-" + seed.replace(/[^a-z0-9]+/gi, "-").toLowerCase() + ".png";
        buildCard(seed).toBlob(function (blob) {
            if (!blob) return;
            var file =
                typeof File === "function"
                    ? new File([blob], filename, { type: "image/png" })
                    : null;
            if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
                navigator
                    .share({ files: [file], title: "My signature — " + window.location.hostname })
                    .then(function () {
                        announce("Shared.");
                    })
                    .catch(function () {});
                return;
            }
            downloadBlob(blob, filename);
        }, "image/png");
    });
})();
