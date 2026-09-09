# Abstimmungstool

Ein schlankes, eigenständiges Tool für anonyme Gruppen-Abstimmungen mit beliebig
vielen Optionen (z.B. "Wohin gehen wir am Mittwoch?" mit 20 Restaurant-Vorschlägen).
Kein Nutzer-Konto nötig - weder zum Anlegen noch zum Abstimmen.

## Funktionen

* **Abstimmung anlegen:** Titel, optionale Beschreibung, 2-20 Optionen, optionales
  automatisches Schließungsdatum. Das Anlegen kann per gemeinsamem Zugangscode
  (`CREATE_PIN`) geschützt werden - das Abstimmen selbst bleibt für jeden mit einem
  Link offen.
* **Anonyme Stimmabgabe (Standard):** Identifikation über ein zufälliges
  Browser-Cookie (`voter_token`), kein Konto. Die eigene Stimme kann geändert
  werden, solange die Abstimmung offen ist.
* **Verifizierte Stimmabgabe (optional, pro Abstimmung einzeln aktivierbar):**
  Statt des Cookies wird eine über `rsvp-app` verifizierte E-Mail als Identität
  genutzt - siehe "Verifizierte Abstimmungen" unten. Verhindert Mehrfachabstimmen
  auch über verschiedene Geräte/Browser hinweg, nicht nur im selben Browser.
* **Live-Ergebnis:** Stimmenanzahl und Prozentanteil pro Option, in Echtzeit.
* **Verwaltungs-Link:** Beim Erstellen bekommt man einen privaten Link
  (`/[pollId]/verwalten?token=...`), um die Abstimmung vorzeitig zu schließen oder
  unwiderruflich zu löschen - Besitz des Tokens ist die einzige Berechtigung dafür.

## Verifizierte Abstimmungen (Mehrfachabstimmen bei Einbindung ausschließen)

Beim Anlegen kann eine Abstimmung mit "Nur über rsvp-app abstimmbar" markiert werden
(`Poll.requireRsvpVerification`). Für eine so markierte Abstimmung gilt:

* Stimmen werden nicht mehr per Cookie, sondern per **verifizierter E-Mail**
  unterschieden (`Vote.verifiedEmail` statt `Vote.voterToken`) - dieselbe Person
  kann dadurch nicht mit einem zweiten Gerät oder einem gelöschten Cookie erneut
  abstimmen.
* Die E-Mail kommt aus einem **signierten Token**, den `rsvp-app` ausstellt (siehe
  "Token-Format" unten) und der als `?verify=...`-Parameter an den Abstimmungs-Link
  angehängt wird.
* **Fail-closed, kein anonymer Fallback:** Fehlt ein gültiger Token (kein Token,
  falsch signiert, abgelaufen, oder für eine andere Abstimmung ausgestellt), kann
  auf dieser Abstimmung schlicht nicht abgestimmt werden - auch nicht anonym. Sonst
  wäre die "eine Stimme pro Person"-Garantie wertlos.
* Alle **anderen** (nicht so markierten) Abstimmungen sind davon komplett
  unberührt und funktionieren weiterhin rein anonym per Cookie wie zuvor.

### Token-Format (Vertrag zwischen rsvp-app und diesem Tool)

```
<base64url(JSON-Payload)>.<base64url(HMAC-SHA256(payloadPart, RSVP_VERIFICATION_SECRET))>
```

Payload (JSON): `{ "email": "gast@example.com", "pollId": "<Poll.id dieses Tools>", "exp": <Unix-Timestamp Sekunden> }`

* `RSVP_VERIFICATION_SECRET` muss auf beiden Seiten identisch sein (gemeinsames
  HMAC-Secret, z.B. `openssl rand -hex 32`) - niemals das Secret selbst übertragen,
  nur damit signierte Tokens.
* `pollId` bindet den Token an GENAU diese eine Abstimmung - ein für Abstimmung A
  ausgestellter Token gilt nicht für Abstimmung B.
* `exp` sollte kurz sein (einige Minuten), damit ein versehentlich weitergeleiteter
  Link nicht dauerhaft gültig bleibt.
* Prüf-Implementierung: `app/lib/rsvp-verification.ts` (`verifyRsvpToken`). Zum
  lokalen Testen ohne rsvp-app: `signRsvpTokenForTesting()` in derselben Datei -
  bewusst nicht produktiv verlinkt, nur für Entwicklung/Tests.

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

## Geplante Erweiterung (teilweise umgesetzt)

Dieses Tool ist so angelegt, dass es *optional* von anderen Tools (z.B. `rsvp-app`)
eingebunden werden kann und dabei dessen Nutzer-Verifizierung übernimmt. Wichtig
dabei bleibt: Diese Anbindung ist ein **AddOn**, keine Voraussetzung - das Tool
funktioniert immer auch komplett eigenständig (ohne rsvp-app), und umgekehrt darf
rsvp-app durch eine fehlende oder ungültige Verifizierung niemals blockiert werden.

* ✅ **Token-ANNAHME (diese Seite):** umgesetzt, siehe "Verifizierte Abstimmungen"
  oben. Per Playwright getestet: gültiger Token akzeptiert, gefälschter/abgelaufener/
  für eine andere Abstimmung ausgestellter Token abgelehnt, dieselbe E-Mail über
  zwei verschiedene Browser-Sessions zählt korrekt nur als eine Stimme.
* ⬜ **Token-AUSSTELLUNG (rsvp-app-Seite):** noch nicht umgesetzt. rsvp-app müsste
  beim Klick auf einen Abstimmungs-Link für eine eingeloggte, verifizierte
  `GuestUser` einen Token nach obigem Format signieren (mit demselben
  `RSVP_VERIFICATION_SECRET`) und als `?verify=...` anhängen.
* ⬜ **Einbettung/Link von rsvp-app aus:** noch kein Feld an `Event`/`EventSeries`
  für einen Abstimmungs-Link, keine grafische Einbettung (iframe).

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
