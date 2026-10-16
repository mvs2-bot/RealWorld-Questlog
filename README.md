# The Real World – Quest Log

**100 Quests. 100 Level. 1 Spieler. Unendlich XP.**

Das Questlog aus dem Buch „The Real World – Offline Edition“ als Webseite: Der Gamemaster legt
für jeden ein Konto an, man wählt die Grundregeln (Starthilfe, Hardcore Mode) und hakt Quests ab. Mit jeder Quest
steigt man ein Level auf, nach jeder Phase wird ein Titel freigeschaltet.

Die Seite in diesem Repo ist nur eine „leere Hülle“: Die Quest-Texte und alle Spielstände liegen
in Supabase (Projekt `realworld-questlog`) und werden erst nach dem Login geladen.

## Aufbau

```
index.html               Login, Spielstart, Start-Dashboard, Questlog und Kontobereich
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

## Start-Dashboard und Kontobereich

Nach dem Einloggen gibt es drei Bereiche: **🏠 Start**, **📜 Questlog** und **👤 Konto**.

- **Start**: eigenes Level mit Titel-Fortschritt und nächster Quest (direkt abhakbar), die Mitspieler,
  ein Scoreboard (Level, Titel, zuletzt abgeschlossene Quest), die letzten Quest-Abschlüsse der Gruppe,
  Gruppen-Zahlen (Quests gesamt, diese Woche, Wochen-Champion) und ein Hinweis, wenn jemand Geburtstag hat.
- **Questlog**: alle 100 Quests mit Emoji wie im Buch. Bei abgeschlossenen Quests lassen sich das
  Abschlussdatum (nicht in der Zukunft, nicht vor Spielbeginn) und ein Kommentar nachträglich ändern.
- **Konto**: Profilbild hochladen (wird wie bei TravelBase quadratisch auf 400 px verkleinert), Spielername,
  Geburtsdatum (das Alter rechnet die Seite selbst aus), Passwort ändern und drei Schalter:
  - *Für Mitspieler sichtbar*: aus = man fehlt bei allen anderen in Dashboard, Scoreboard und Aktivität,
    auch bei Gamemastern. Die Kontenverwaltung auf `gamemaster.html` listet weiterhin alle Konten.
  - *Profilbild für Mitspieler sichtbar*: aus = die anderen sehen nur die Initialen.
  - *Questlog für Mitspieler freigeben*: an = Mitspieler können einen auf der Startseite anklicken und das
    Questlog ansehen (nur lesen, ohne die privaten Notizen).
- Die Daten der anderen liefern die Datenbank-Funktionen `get_mitspieler` und `get_aktivitaet`; Geburtsdatum,
  E-Mail und Notizen anderer Spieler verlassen die Datenbank nicht. Profilbilder liegen im privaten
  Storage-Bucket `avatars`, wer welches Bild sehen darf, prüft Supabase selbst.

## Rollen

- **Gamemaster**: spielt mit und sieht zusätzlich den 🛡️-Knopf zum Gamemaster-Bereich.
- **Spieler:in**: normales Mitglied. Der Gamemaster-Bereich ist gesperrt, sowohl auf der Seite als auch in der
  Edge Function, die jede Anfrage selbst gegen die Rolle in der Datenbank prüft.
- Die Rolle kann sich niemand selbst geben; das verhindert ein Trigger in der Datenbank.
- Passwörter speichert Supabase nur als Hash. Der Gamemaster kann sie nicht sehen, aber neu setzen.
- Gamemaster können jedes Questlog öffnen (über die Startseite oder „📜 Questlog öffnen“ im Gamemaster-Bereich),
  auch nicht freigegebene und ausgeblendete, und dort Quests abschließen, wieder öffnen sowie Datum und Kommentar
  ändern. Die Spielregeln gelten auch für sie. Die privaten Notizen sehen auch Gamemaster nicht.

## Spielregeln in der Datenbank

Die Regeln aus dem Buch prüft die Datenbank selbst, nicht nur die Webseite:

- Starthilfe und Hardcore Mode werden vor Spielbeginn festgelegt und sind danach fest.
- Mit Starthilfe dürfen schon erledigte Quests nur beim Spielstart markiert werden.
- Im Hardcore Mode geht Quest n erst, wenn 1 bis n-1 abgeschlossen sind.
- Level 100 geht immer erst, wenn alle Level 1 bis 99 abgeschlossen sind.

## Wichtig

- Niemals den `secret`/`service_role` Key in dieses Repo legen.
- Die Quest-Texte (© Stefan Kölbl) gehören nicht in dieses öffentliche Repo, sie liegen nur in Supabase.
