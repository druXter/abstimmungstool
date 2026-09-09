# Abstimmungstool

Ein schlankes, eigenständiges Tool für anonyme Gruppen-Abstimmungen mit beliebig
vielen Optionen (z.B. "Wohin gehen wir am Mittwoch?" mit 20 Restaurant-Vorschlägen).
Kein Nutzer-Konto nötig - weder zum Anlegen noch zum Abstimmen.

## Funktionen (Stand: Grundgerüst / Phase 1)

* **Abstimmung anlegen:** Titel, optionale Beschreibung, 2-20 Optionen, optionales
  automatisches Schließungsdatum. Das Anlegen kann per gemeinsamem Zugangscode
  (`CREATE_PIN`) geschützt werden - das Abstimmen selbst bleibt für jeden mit einem
  Link offen.
* **Anonyme Stimmabgabe:** Identifikation ausschließlich über ein zufälliges
  Browser-Cookie (`voter_token`), kein Konto. Die eigene Stimme kann geändert
  werden, solange die Abstimmung offen ist.
* **Live-Ergebnis:** Stimmenanzahl und Prozentanteil pro Option, in Echtzeit.
* **Verwaltungs-Link:** Beim Erstellen bekommt man einen privaten Link
  (`/[pollId]/verwalten?token=...`), um die Abstimmung vorzeitig zu schließen oder
  unwiderruflich zu löschen - Besitz des Tokens ist die einzige Berechtigung dafür.

## Bewusste Grenzen (kein Missverständnis)

* **Kein Schutz vor Mehrfachabstimmung über mehrere Geräte/Browser** - das Cookie-
  basierte `voter_token` verhindert nur, im selben Browser mehrmals abzustimmen.
  Für eine kleine, vertraute Gruppe ist das ein bewusst akzeptierter Kompromiss,
  kein Sicherheitsversprechen für öffentliche Abstimmungen mit Fremden.
* **Kein Rate-Limiting** gegen automatisiertes Anlegen/Abstimmen ist bisher
  eingebaut - bei Bedarf (z.B. bei Erreichbarkeit übers offene Internet) nachrüsten.
* **Datenschutzerklärung fehlt noch** - nur ein Impressum ist vorhanden (siehe
  `app/impressum/page.tsx`, gleiches Platzhalter-Prinzip wie in rsvp-app). Vor
  echtem Live-Betrieb mit Externen sollte das ergänzt werden.

## Geplante Erweiterung (noch NICHT umgesetzt)

Dieses Tool ist so angelegt, dass es später *optional* von anderen Tools (z.B.
`rsvp-app`) eingebunden werden kann und dabei dessen Nutzer-Verifizierung
übernimmt (signierter, zweckgebundener Token statt echtem Login/SSO) - siehe die
Absprache dazu. Wichtig dabei: Diese Anbindung ist ein **AddOn**, keine
Voraussetzung - das Tool muss immer auch komplett eigenständig (ohne rsvp-app)
funktionieren, und umgekehrt darf rsvp-app durch eine fehlende oder ungültige
Verifizierung niemals blockiert werden. Weder die Token-Ausstellung (rsvp-app-
Seite) noch die Token-Annahme (diese Seite) sind aktuell implementiert.

## Setup

```bash
npm install
cp .env.example .env   # Werte eintragen, siehe Kommentare in der Datei
npx prisma generate
npx prisma db push
npm run dev             # Port 3600, siehe package.json
```

Es gibt keinen `migrations`-Ordner - wie bei rsvp-app ausschließlich per
`npx prisma db push` synchronisiert.

## Deployment

Docker Compose, gleiches Prinzip wie rsvp-app:

```bash
docker compose up -d --build
```

`./data` wird für die SQLite-Datenbank gemountet. Port 3006 ist in
`docker-compose.yml` voreingestellt (3000-3005 sind auf diesem Server bereits von
anderen Diensten belegt) - bei Bedarf anpassen.
