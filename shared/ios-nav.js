/* iOS-Navigationsleiste für installierte Web-Apps (Zurück + Neu laden)
   Auf dem iPhone hat eine zum Home-Bildschirm hinzugefügte Web-App keine Browserleiste und keine
   Zurück-Geste. Dieses Skript blendet dort eine kleine schwebende Leiste mit „Zurück“ und „Neu laden“ ein.

   Angezeigt wird sie NUR, wenn die Seite auf iOS/iPadOS als installierte Web-App läuft
   (navigator.standalone === true). In Safari, auf Android und am Desktop passiert nichts.

   Original liegt im Repo mvs2-bot.github.io unter shared/ios-nav.js. Die anderen Webseiten-Repos haben
   eine identische Kopie; Änderungen bitte dort machen und in alle Seiten kopieren.

   Einbinden (am Ende von <head> oder <body>):
     <script src="shared/ios-nav.js" defer></script>
   Optional über Attribute am Script-Tag:
     data-pos="left" | "right" | "center"   Position unten (Standard: left)
     data-bottom="72"                        Abstand nach unten in px, z. B. wenn die Seite eine eigene Leiste unten hat
   Zum Testen am Android/Desktop: Seite mit ?iosnav=1 aufrufen (wird für die Sitzung gemerkt, ?iosnav=0 schaltet ab).

   Aussehen über die CSS-Variablen der Seite (--card, --border/--line, --text/--ink, --accent/--p1, --card-hover/--hover),
   mit eigenen Ersatzfarben, falls eine Seite sie nicht hat. */
(function () {
    var me = document.currentScript;

    function forced() {
        try {
            var q = new URLSearchParams(location.search).get('iosnav');
            if (q === '1') sessionStorage.setItem('iosnav', '1');
            if (q === '0') sessionStorage.removeItem('iosnav');
            return sessionStorage.getItem('iosnav') === '1';
        } catch (e) { return false; }
    }

    if (window.navigator.standalone !== true && !forced()) return;

    var pos = (me && me.getAttribute('data-pos')) || 'left';
    var bottom = parseInt(me && me.getAttribute('data-bottom'), 10) || 14;

    var css =
        '.iosnav{position:fixed;z-index:9999;display:flex;gap:2px;padding:3px;border-radius:999px;' +
        'bottom:calc(' + bottom + 'px + env(safe-area-inset-bottom,0px));' +
        (pos === 'right' ? 'right:calc(14px + env(safe-area-inset-right,0px));'
            : pos === 'center' ? 'left:50%;transform:translateX(-50%);'
            : 'left:calc(14px + env(safe-area-inset-left,0px));') +
        'background:color-mix(in srgb,var(--card,#fff) 82%,transparent);' +
        '-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);' +
        'border:1px solid var(--border,var(--line,rgba(127,127,127,.3)));' +
        'box-shadow:0 2px 12px rgba(0,0,0,.18);transition:opacity .2s}' +
        '.iosnav button{all:unset;box-sizing:border-box;width:40px;height:40px;border-radius:999px;' +
        'display:grid;place-items:center;cursor:pointer;color:var(--text,var(--ink,#0f172a));' +
        '-webkit-tap-highlight-color:transparent}' +
        '.iosnav button:active{background:var(--card-hover,var(--hover,rgba(127,127,127,.15)));' +
        'color:var(--accent,var(--p1,#2563eb))}' +
        '.iosnav button[disabled]{opacity:.35;pointer-events:none}' +
        '.iosnav svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2.2;' +
        'stroke-linecap:round;stroke-linejoin:round}' +
        '.iosnav.spin .r svg{animation:iosnav-spin .6s linear infinite}' +
        '@keyframes iosnav-spin{to{transform:rotate(360deg)}}' +
        '@media print{.iosnav{display:none}}';

    function build() {
        if (document.querySelector('.iosnav')) return;
        var st = document.createElement('style');
        st.textContent = css;
        document.head.appendChild(st);

        var bar = document.createElement('nav');
        bar.className = 'iosnav';
        bar.setAttribute('aria-label', 'App-Navigation');
        bar.innerHTML =
            '<button type="button" class="b" aria-label="Zurück" title="Zurück">' +
            '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></button>' +
            '<button type="button" class="r" aria-label="Neu laden" title="Neu laden">' +
            '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/></svg></button>';
        document.body.appendChild(bar);

        var back = bar.querySelector('.b');
        // Erste Seite nach dem Start: es gibt nichts, wohin man zurück kann.
        if (history.length <= 1) back.disabled = true;
        back.addEventListener('click', function () { history.back(); });

        bar.querySelector('.r').addEventListener('click', function () {
            bar.classList.add('spin');
            location.reload();
        });

        // Nach Zurück/Vor (auch Anker innerhalb der Seite) den Zurück-Knopf wieder freigeben.
        window.addEventListener('popstate', function () { back.disabled = history.length <= 1; });
        window.addEventListener('hashchange', function () { back.disabled = false; });
        window.addEventListener('pageshow', function () { bar.classList.remove('spin'); });
    }

    if (document.body) build();
    else document.addEventListener('DOMContentLoaded', build);
})();
