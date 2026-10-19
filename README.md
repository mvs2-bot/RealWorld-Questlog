# The Real World – Quest Log

**100 Quests. 100 Level. 1 Spieler. Unendlich XP.**

Das Questlog aus dem Buch „The Real World – Offline Edition“ als Webseite: Der Gamemaster legt
für jeden ein Konto an, man wählt die Grundregeln (Starthilfe, Hardcore Mode) und hakt Quests ab. Mit jeder Quest
steigt man ein Level auf, nach jeder Phase wird ein Titel freigeschaltet.

Die Seite in diesem Repo ist nur eine „leere Hülle“: Die Quest-Texte und alle Spielstände liegen
in Supabase (Core-Projekt `travelbase`, Tabellen `questlog_*`) und werden erst nach dem Login geladen.

## Aufbau

```
index.html               Login, Spielstart, Start-Dashboard, Questlog und Kontobereich
gamemaster.html          Gamemaster-Bereich: Spieler:innen anlegen, ansehen, ändern, entfernen
shared/style.css         gemeinsames Aussehen beider Seiten
shared/config.js         Supabase-URL + Publishable Key (dürfen öffentlich sein)
shared/questlog.js       Konten, Spielstand laden/speichern, Offline-Zwischenspeicher
sw.js, manifest.json     App zum Installieren + Offline-Modus
supabase/schema.sql      Schema des alten Projekts (nur noch zum Nachschlagen, aktuell: Repo supabase-core)
supabase/functions/      Edge Function "gamemaster" für die Kontenverwaltung
.github/workflows/       Keepalive, damit das kostenlose Supabase-Projekt nicht pausiert
```

## Einrichtung

Das Questlog läuft im gemeinsamen Supabase-Core-Projekt (`travelbase`, zusammen mit TravelBase).
Konten und Profile (Anzeigename, Geburtsdatum, Profilbild) sind dort global, das Questlog nutzt die
Tabellen mit Präfix `questlog_*`. Das Schema liegt als Migration im Repo `supabase-core`
(`supabase/migrations/…_questlog_core.sql`); `supabase/schema.sql` hier ist nur noch der Stand des alten
Projekts `realworld-questlog`.

1. Phasen und Quests in `questlog_phases` und `questlog_quests` einspielen (Seed liegt **nicht** in diesem Repo).
2. Unter Authentication → URL Configuration die Adresse der Webseite als Redirect URL eintragen,
   damit Passwort-Links zurück auf die Seite führen.
3. Unter Edge Functions die Funktion `gamemaster` mit dem Inhalt von `supabase/functions/gamemaster/index.ts`
   anlegen und in ihren Einstellungen „Verify JWT“ ausschalten (die Funktion prüft die Anmeldung selbst).
4. Zugang gibt es über `overall_app_access` (App `questlog`): Rolle `admin` = Gamemaster, `member` = Spieler:in.
   Globale Admins sind automatisch Gamemaster. Weitere Spieler:innen legt der Gamemaster auf `gamemaster.html` an.

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
- Die Daten der anderen liefern die Datenbank-Funktionen `questlog_get_mitspieler` und `questlog_get_aktivitaet`; Geburtsdatum,
  E-Mail und Notizen anderer Spieler verlassen die Datenbank nicht. Profilbilder liegen global (ein Bild für alle Apps) im privaten
  Storage-Bucket `avatars`, wer welches Bild sehen darf, prüft Supabase selbst.

## Rollen

- **Gamemaster**: spielt mit und sieht zusätzlich den 🛡️-Knopf zum Gamemaster-Bereich.
- **Spieler:in**: normales Mitglied. Der Gamemaster-Bereich ist gesperrt, sowohl auf der Seite als auch in der
  Edge Function, die jede Anfrage selbst gegen die Rolle in der Datenbank prüft.
- Die Rolle kann sich niemand selbst geben: App-Zugänge vergeben nur Admins bzw. die Gamemaster-Funktion.
- „Entfernen“ nimmt nur den Questlog-Zugang samt Spielstand weg; das Konto bleibt für die anderen Apps.
  E-Mail und Passwort anderer Konten ändern nur globale Admins, weil sie für alle Apps gelten.
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
