# The Real World – Quest Log

**100 Quests. 100 Level. 1 Spieler. Unendlich XP.**

Das Questlog aus dem Buch „The Real World – Offline Edition“ als Webseite: Jeder legt sich ein
Konto an, wählt die Grundregeln (Starthilfe, Hardcore Mode) und hakt Quests ab. Mit jeder Quest
steigt man ein Level auf, nach jeder Phase wird ein Titel freigeschaltet.

Die Seite in diesem Repo ist nur eine „leere Hülle“: Die Quest-Texte und alle Spielstände liegen
in Supabase (Projekt `realworld-questlog`) und werden erst nach dem Login geladen.

## Aufbau

```
index.html               Startseite mit Login/Registrierung, Spielstart und Questlog
shared/config.js         Supabase-URL + Publishable Key (dürfen öffentlich sein)
shared/questlog.js       Konten, Spielstand laden/speichern, Offline-Zwischenspeicher
sw.js, manifest.json     App zum Installieren + Offline-Modus
supabase/schema.sql      Tabellen, Zugriffsregeln und Spielregeln für die Datenbank
.github/workflows/       Keepalive, damit das kostenlose Supabase-Projekt nicht pausiert
```

## Einrichtung

1. In Supabase das Projekt `realworld-questlog` anlegen.
2. Im SQL Editor `supabase/schema.sql` ausführen.
3. Danach das Seed-Skript mit den 6 Phasen und 100 Quests ausführen (liegt **nicht** in diesem Repo).
4. Unter Project Settings → API Keys die Project URL und den Publishable Key in `shared/config.js` eintragen.
5. Unter Authentication → URL Configuration die Adresse der Webseite als Site URL bzw. Redirect URL eintragen,
   damit Bestätigungs- und Passwort-Links zurück auf die Seite führen.
6. In den Repo-Einstellungen GitHub Pages aktivieren (Branch `main`, Ordner `/`).

## Spielregeln in der Datenbank

Die Regeln aus dem Buch prüft die Datenbank selbst, nicht nur die Webseite:

- Starthilfe und Hardcore Mode werden vor Spielbeginn festgelegt und sind danach fest.
- Mit Starthilfe dürfen schon erledigte Quests nur beim Spielstart markiert werden.
- Im Hardcore Mode geht Quest n erst, wenn 1 bis n-1 abgeschlossen sind.
- Level 100 geht immer erst, wenn alle Level 1 bis 99 abgeschlossen sind.

## Wichtig

- Niemals den `secret`/`service_role` Key in dieses Repo legen.
- Die Quest-Texte (© Stefan Kölbl) gehören nicht in dieses öffentliche Repo, sie liegen nur in Supabase.
