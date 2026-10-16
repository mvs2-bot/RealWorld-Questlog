# The Real World – Quest Log

**100 Quests. 100 Level. 1 Spieler. Unendlich XP.**

Das Questlog aus dem Buch „The Real World – Offline Edition“ als Webseite: Der Gamemaster legt
für jeden ein Konto an, man wählt die Grundregeln (Starthilfe, Hardcore Mode) und hakt Quests ab. Mit jeder Quest
steigt man ein Level auf, nach jeder Phase wird ein Titel freigeschaltet.

Die Seite in diesem Repo ist nur eine „leere Hülle“: Die Quest-Texte und alle Spielstände liegen
in Supabase (Projekt `realworld-questlog`) und werden erst nach dem Login geladen.

## Aufbau

```
index.html               Startseite mit Login, Spielstart und Questlog
gamemaster.html          Gamemaster-Bereich: Konten anlegen, ansehen, ändern, löschen
shared/style.css         gemeinsames Aussehen beider Seiten
shared/config.js         Supabase-URL + Publishable Key (dürfen öffentlich sein)
shared/questlog.js       Konten, Spielstand laden/speichern, Offline-Zwischenspeicher
sw.js, manifest.json     App zum Installieren + Offline-Modus
supabase/schema.sql      Tabellen, Zugriffsregeln, Rollen und Spielregeln für die Datenbank
supabase/functions/      Edge Function "gamemaster" für die Kontenverwaltung
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
7. Unter Authentication → Sign In / Providers „Allow new users to sign up“ ausschalten.
8. Unter Edge Functions → „Deploy a new function“ → „Via Editor“ die Funktion `gamemaster` mit dem Inhalt von
   `supabase/functions/gamemaster/index.ts` anlegen und in ihren Einstellungen „Verify JWT“ ausschalten
   (die Funktion prüft die Anmeldung selbst).
9. Den ersten Gamemaster unter Authentication → Users → „Add user“ anlegen (Auto Confirm) und im SQL Editor
   freischalten: `update public.profiles set role = 'gamemaster' where id = (select id from auth.users where email = '…');`
   Alle weiteren Konten legt der Gamemaster danach auf `gamemaster.html` an.

## Rollen

- **Gamemaster**: spielt mit und sieht zusätzlich den 🛡️-Knopf zum Gamemaster-Bereich.
- **Spieler:in**: normales Mitglied. Der Gamemaster-Bereich ist gesperrt, sowohl auf der Seite als auch in der
  Edge Function, die jede Anfrage selbst gegen die Rolle in der Datenbank prüft.
- Die Rolle kann sich niemand selbst geben; das verhindert ein Trigger in der Datenbank.
- Passwörter speichert Supabase nur als Hash. Der Gamemaster kann sie nicht sehen, aber neu setzen.

## Spielregeln in der Datenbank

Die Regeln aus dem Buch prüft die Datenbank selbst, nicht nur die Webseite:

- Starthilfe und Hardcore Mode werden vor Spielbeginn festgelegt und sind danach fest.
- Mit Starthilfe dürfen schon erledigte Quests nur beim Spielstart markiert werden.
- Im Hardcore Mode geht Quest n erst, wenn 1 bis n-1 abgeschlossen sind.
- Level 100 geht immer erst, wenn alle Level 1 bis 99 abgeschlossen sind.

## Wichtig

- Niemals den `secret`/`service_role` Key in dieses Repo legen.
- Die Quest-Texte (© Stefan Kölbl) gehören nicht in dieses öffentliche Repo, sie liegen nur in Supabase.
