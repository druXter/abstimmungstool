# Abstimmungstool

Ein schlankes, eigenständiges Tool für anonyme Gruppen-Abstimmungen mit beliebig
vielen Optionen (z.B. "Wohin gehen wir am Mittwoch?" mit 25 Restaurant-Vorschlägen).
Kein Nutzer-Konto nötig - weder zum Anlegen noch zum Abstimmen.

## Funktionen

* **Abstimmung anlegen:** Titel, optionale Beschreibung, 2-25 Optionen, optionales
  automatisches Schließungsdatum. Das Anlegen kann per gemeinsamem Zugangscode
  (`CREATE_PIN`) geschützt werden - das Abstimmen selbst bleibt für jeden mit einem
  Link offen.
* **Einzel- oder Mehrfachauswahl (pro Abstimmung einzeln gewählt):** Standardmäßig
  eine Option pro Stimme (Radiobuttons); mit `allowMultipleChoices` können mehrere
  Optionen gleichzeitig gewählt werden (Checkboxen) - z.B. "welche Restaurants
  wären für dich alle okay?". Ändert nichts an der Identitätslogik, siehe unten.
* **Anonyme Stimmabgabe (Standard):** Identifikation über ein zufälliges
  Browser-Cookie (`voter_token`), kein Konto. Die eigene Auswahl kann jederzeit
  geändert werden, solange die Abstimmung offen ist.
* **Verifizierte Stimmabgabe (optional, pro Abstimmung einzeln aktivierbar):**
  Statt des Cookies wird eine über `rsvp-app` verifizierte E-Mail als Identität
  genutzt - siehe "Verifizierte Abstimmungen" unten. Verhindert Mehrfachabstimmen
  auch über verschiedene Geräte/Browser hinweg, nicht nur im selben Browser. Lässt
  sich mit der Mehrfachauswahl kombinieren.
* **Live-Ergebnis:** Stimmenanzahl und Prozentanteil pro Option, in Echtzeit. Der
  Prozentwert bezieht sich auf die Anzahl abstimmender PERSONEN, nicht auf die
  Summe aller Options-Stimmen - bei Mehrfachauswahl kann die Summe der Prozentwerte
  daher über 100% liegen, das ist beabsichtigt (siehe `app/[pollId]/poll-results.tsx`).
* **Verwaltungs-Link:** Beim Erstellen bekommt man einen privaten Link
  (`/[pollId]/verwalten?token=...`), um die Abstimmung nachträglich zu bearbeiten
  (Titel/Beschreibung/Optionen/Einstellungen), vorzeitig zu schließen oder
  unwiderruflich zu löschen - Besitz des Tokens ist die einzige Berechtigung dafür,
  es gibt bewusst kein Konto-System dafür (siehe "Bearbeiten ohne Konto" unten).
* **Verwaltungs-Link per Mail (optional):** Beim Anlegen kann eine E-Mail-Adresse
  angegeben werden, an die der Verwaltungs-Link zusätzlich geschickt wird (siehe
  `app/lib/mail.ts`) - reines Backup, falls man den auf dem Bildschirm angezeigten
  Link nicht selbst sichert. Ohne konfiguriertes `SMTP_HOST` bleibt das Feld einfach
  wirkungslos, kein Pflichtfeld.

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

## Bearbeiten ohne Konto

Eine Abstimmung lässt sich über `/[pollId]/verwalten/bearbeiten?token=...` (Link auf
der Verwaltungsseite) nachträglich anpassen: Titel, Beschreibung, automatisches
Schließungsdatum, beide Schalter (Mehrfachauswahl, RSVP-Verifizierung) sowie die
Optionen selbst - bestehende Optionen können umbenannt werden, neue hinzugefügt
werden (bis `MAX_OPTIONS`), und Optionen OHNE bereits abgegebene Stimmen gelöscht
werden. Optionen MIT Stimmen können umbenannt, aber nicht gelöscht werden (die
Löschung wird serverseitig stillschweigend ignoriert) - das verhindert, versehentlich
bereits abgegebene Stimmen zu verwaisen.

Bewusst **kein** Konto-System dafür, obwohl das naheliegend erscheinen könnte (siehe
z.B. rsvp-app) - der `creatorToken` ist bereits exakt die Berechtigung, die ein
Konto auch bräuchte, nur ohne Login/Passwort/Session-Infrastruktur. Ein echtes
Konto-System würde genau die Komplexität zurückbringen, die dieses Tool bewusst
vermeidet. Die einzige reale Schwäche des Ansatzes - man kann den Verwaltungs-Link
verlieren - wird durch die optionale Mail-Zustellung beim Anlegen abgefedert (siehe
oben), nicht durch ein Konto-System ersetzt.

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

## Verknüpfung mit rsvp-app (umgesetzt)

Dieses Tool ist so angelegt, dass es *optional* von `rsvp-app` (separates Projekt,
eigenes Repo/Deployment) eingebunden werden kann und dabei dessen Nutzer-
Verifizierung übernimmt. Diese Anbindung ist ein **AddOn**, keine Voraussetzung -
beide Tools funktionieren immer auch komplett eigenständig voneinander, und eine
fehlende oder ungültige Verifizierung blockiert rsvp-app nie.

* **Token-ANNAHME (diese Seite):** siehe "Verifizierte Abstimmungen" oben -
  `verifyRsvpToken()` in `app/lib/rsvp-verification.ts`.
* **Token-AUSSTELLUNG (rsvp-app-Seite):** `Event.pollUrl`/`pollLabel` verlinken von
  der Event-Seite auf `/api/poll-link/[eventId]` in rsvp-app, das für einen
  eingeloggten, verifizierten `GuestUser` frisch bei jedem Klick einen Token
  signiert (`app/lib/poll-verification.ts` dort) und als `?verify=...` anhängt.
* Per Playwright über **beide echt laufenden Anwendungen gleichzeitig** verifiziert:
  ein anonymer rsvp-app-Besucher landet ohne Token und kann auf einer entsprechend
  markierten Abstimmung nicht abstimmen; ein eingeloggter, verifizierter rsvp-app-
  Nutzer landet mit Token, kann abstimmen, und ein erneuter Aufruf über rsvp-app
  ändert seine Auswahl statt eine zweite Identität anzulegen.
* Beide Seiten brauchen dasselbe gemeinsame Secret (hier `RSVP_VERIFICATION_SECRET`,
  in rsvp-app `POLL_VERIFICATION_SECRET`) - siehe "Token-Format" oben für den Vertrag.

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
