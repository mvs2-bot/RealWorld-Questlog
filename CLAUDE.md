# CLAUDE.md – RealWorld-Questlog

Webseite/PWA „The Real World – Quest Log“ (100 Quests, 100 Level, Titel je Phase) unter `/RealWorld-Questlog/` auf GitHub Pages.
Kein Build, kein npm: reines HTML/CSS/JS, supabase-js per CDN. Sprache in UI, Kommentaren und Commits: Deutsch.
Die Seite ist eine „leere Hülle“: Quest-Texte und Spielstände liegen nur in Supabase und kommen erst nach dem Login.

## Arbeitsweise (Token-Effizienz)
- Nicht das ganze Repo einlesen. `index.html` (~1000 Zeilen) per `grep -n` anspringen (Funktionen ab Zeile ~346).
- Vor dem PR selbst prüfen: JS-Syntax (`node --check shared/*.js`, Inline-Skripte grob), IDs/Referenzen, Design-Tokens, `sw.js`-Version.
- Bei Änderung an Architektur, Dateistruktur oder Schema diese Datei im selben PR anpassen (max. 150 Zeilen).
- Repo-übergreifende Änderungen (App + DB + Dashboard) gehören in EINEN Thread, je Repo ein PR, Schnittstellen abgleichen.
- Keine Secrets: nur Project-URL + Publishable Key (in `shared/config.js`). Niemals `service_role`/secret Key.
- Quest-Texte (© Stefan Kölbl) gehören NICHT ins öffentliche Repo, auch nicht als Seed oder Testdaten.

## Dateien
| Datei | Inhalt |
| --- | --- |
| `index.html` | Gesamte App: Markup, SVG-Sprite (`#i-…`), zwei Inline-Skripte (Theme-Vorab im `<head>`, App-Logik am Ende) |
| `shared/questlog.js` | Datenschicht `window.RQ`: Client, Sitzung, Spielstand laden/speichern, Offline-Cache, Gamemaster-Aufrufe |
| `shared/config.js` | `window.RQ_CONFIG = { url, key }` (öffentlich, Core-Projekt) |
| `shared/style.css` | gesamtes CSS inkl. Design-Tokens (hell + `[data-theme="dark"]`) |
| `shared/overall-account.js` | **Kopie** aus `supabase-core/shared/` (Profil/Passwort-Modul). Nur im Original ändern, dann hierher kopieren. |
| `shared/ios-nav.js` | **Kopie** aus `mvs2-bot.github.io/shared/` (iOS-Leiste Zurück/Neu laden). Nur im Original ändern. |
| `gamemaster.html` | nur Weiterleitung auf `/admin.html?from=questlog#app-questlog` (Dashboard) |
| `sw.js` | Service Worker: eigene Dateien network-first (4 s), CDN cache-first, Supabase nie gecacht |
| `manifest.json`, `icons/` | PWA (Theme-Farbe `#f2f2f7`) |
| `.github/workflows/supabase-keepalive.yml` | alle 3 Tage RPC `questlog_get_public_stats`, damit Supabase nicht pausiert |
| `README.md` | fachliche Doku (Bereiche, Rollen, Spielregeln) |

Skript-Reihenfolge in `index.html`: supabase-js → `config.js` → `questlog.js` → `overall-account.js` → `style.css`, `ios-nav.js` mit `defer`.

## Service Worker
- Cache-Name `realworld-questlog-vNN` (Konstante `V`). **Bei jeder Änderung an gecachten Dateien hochzählen.**
- Neue Datei, die offline gebraucht wird → in `CORE` aufnehmen. Externe Bibliotheken → `EXTRA`.

## App-Aufbau (index.html)
- Hash-Routing: `#start` (Dashboard), `#questlog`, `#questlog/<konto-id>` (fremdes Questlog, nur lesen bzw. Gamemaster), `#profil`/`#konto`.
  Navigation oben (Desktop) und schwebende untere Leiste (Mobil), beide über `data-tab`.
- Vor Spielbeginn: Setup (Starthilfe, Hardcore Mode), danach fest. Render-Funktionen: `renderSetup`, `renderGame`,
  `renderHero`, `renderPhases`, `questRow`, `questEdit`, `renderProfile`; Fehlstart: `bootFail` (Neu-laden-Knopf).
- Zustand: `game` (eigener Stand), `cur` (gerade angezeigtes Questlog, `cur.other` = fremd), `dash` (Dashboard-Daten).
- Gamemaster-Knopf nur bei `game.profile.role === 'gamemaster'` (Anzeige; Schutz macht DB/Edge Function).

## localStorage
- `overall-theme` (`dark`/`light`, app-übergreifend; Altlast `rq_theme_v2` wird noch gelesen).
- `rq_layout_v1` (auf-/zugeklappte bzw. verschobene Dashboard-Karten).
- `rq_cache_v1_<…>` Offline-Spielstand pro Benutzer, wird beim Abmelden gelöscht.

## Supabase-Anbindung
- Gemeinsames Core-Projekt (Name `travelbase`, auch für Dashboard und andere Apps). supabase-js `2.45.4` von jsDelivr.
- **Schema liegt ausschließlich im Repo `supabase-core`** (Präfix `questlog_`, Basis `…_questlog_core.sql`).
  Schemaänderung = dort neue Migration + Test, eigener PR; im PR nennen, welche Migration live eingespielt werden muss.
- Tabellen: `questlog_phases`, `questlog_quests`, `questlog_players`, `questlog_quest_progress`, `overall_profiles`.
- RPCs: `overall_app_role`, `questlog_get_owner`, `questlog_get_mitspieler`, `questlog_get_aktivitaet`, `questlog_get_public_stats`.
- Edge Function `gamemaster` (`supabase-core/supabase/functions/gamemaster/`), Aufruf `sb.functions.invoke('gamemaster', …)`,
  `verify_jwt = false`, prüft Rolle selbst.
- Zugang: `overall_app_access` mit App `questlog` (Admin = Gamemaster); globale Admins sind automatisch Gamemaster.
- Spielregeln (Hardcore-Reihenfolge, Level 100 zuletzt, Starthilfe nur beim Start) prüft die **Datenbank**, die UI spiegelt sie nur.
- Datenschutz: Geburtsdatum, E-Mail und private Notizen anderer verlassen die DB nicht (nur über die RPCs oben).
  Profilbilder global im privaten Bucket `avatars`.

## Bezug zum Dashboard (mvs2-bot.github.io)
- Kachel in `shared/projects.js` (`app: 'questlog'`, `kpi: true` → RPC `overall_tile_kpis`, Migration in supabase-core).
- Spielerverwaltung in `admin.html` (Bereich `questlog`, Funktion `questlogAdmin`), Link `/RealWorld-Questlog/#questlog/<id>`.
- Kontoeinstellungen (Profil, Passwort) über das gemeinsame Konto-Modul bzw. `/konto.html`.
- Änderungen an Rollen-Texten, Kachel oder KPI immer mit dem Dashboard-Repo abstimmen.

## Design (Apple-Designsprache, wie Dashboard)
- Tokens in `shared/style.css` `:root`, gleiche Namen wie `mvs2-bot.github.io/shared/tokens.css`:
  Flächen `--bg #f2f2f7`, `--card`, `--well`, `--hover`, `--line`, `--sep`; Text `--ink`, `--text`, `--mute`.
- Eigener Akzent **Indigo**: `--p1 #5147d6`, `--p1-soft`, `--p1-line`, `--on-p1`. XP/Punkte Orange: `--xp`, `--xp-ink`, `--xp-soft`.
- Status `--ok`, `--danger` (+ `-soft`); Ränge `--gold`, `--silver`, `--bronze`. `--radius 18px`, `--radius-s 12px`, `--shadow`, `--pop`, `--font` (SF).
- Dark Mode über `:root[data-theme="dark"]` (AMOLED-Schwarz). Neue Farben nur als Variable in beiden Blöcken.
- Typo 12–20 px (Basis 14), weiße Karten `.box` auf Grau, Linien-Symbole aus dem SVG-Sprite (`.ic`, `<use href="#i-…">`);
  Quest-Emojis wie im Buch sind erlaubt.
