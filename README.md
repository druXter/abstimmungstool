# Abstimmungstool

Ein schlankes, eigenständiges Tool für anonyme Gruppen-Abstimmungen mit beliebig
vielen Optionen (z.B. "Wohin gehen wir am Mittwoch?" mit 25 Restaurant-Vorschlägen).
**Zum Abstimmen braucht niemand ein Konto** - ein Konto braucht nur, wer Abstimmungen
anlegt und verwaltet (siehe "Konten" unten).

## Funktionen

* **Abstimmung anlegen (mit Konto):** Titel, optionale Beschreibung, 2-25 Optionen,
  optionales automatisches Schließungsdatum. Das Abstimmen selbst bleibt für jeden mit
  einem Link offen.
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
* **Verwalten mit Konto:** Unter "Meine Abstimmungen" (`/meine-abstimmungen`) stehen
  eigene und mit einem geteilte Abstimmungen. Bearbeiten (Titel/Beschreibung/Optionen/
  Einstellungen), vorzeitig Schließen, Löschen und Teilen - siehe "Konten".
* **Gemeinsam moderieren:** Eine Abstimmung lässt sich mit anderen Konten teilen; diese
  können sie bearbeiten und schließen.

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
* **Nur Zusagende können abstimmen, Absagen werden direkt blockiert:** Der Token
  trägt neben der E-Mail auch den aktuellen RSVP-Status (`attending`), frisch bei
  jedem Linkklick aus rsvp-app ermittelt - hat die Person für den verknüpften Termin
  abgesagt, wird das ebenfalls wie ein fehlender Token behandelt (kein Abstimmen).
  Sagt sie später wieder zu, schaltet sich das von selbst wieder frei, sobald sie den
  Link erneut aufruft.
* **Eine bereits abgegebene Stimme verschwindet bei nachträglicher Absage:** Zusätzlich
  zum Klick-Token schickt rsvp-app bei JEDER Zu-/Absage-Änderung aktiv einen
  signierten Webhook (`POST /api/rsvp-webhook`, siehe unten) - so verschwindet eine
  bereits gezählte Stimme auch dann, wenn die Person die Abstimmung selbst nie wieder
  aufruft.
* Alle **anderen** (nicht so markierten) Abstimmungen sind davon komplett
  unberührt und funktionieren weiterhin rein anonym per Cookie wie zuvor.

### Token-Format (Vertrag zwischen rsvp-app und diesem Tool)

```
<base64url(JSON-Payload)>.<base64url(HMAC-SHA256(payloadPart, RSVP_VERIFICATION_SECRET))>
```

Zwei Varianten teilen sich dieses Format (siehe `app/lib/rsvp-verification.ts`):

* **Klick-Token** (`?verify=...` am Abstimmungs-Link): `{ "email": "gast@example.com", "pollId": "<Poll.id dieses Tools>", "attending": true, "exp": <Unix-Timestamp Sekunden> }`
* **Webhook-Nachricht** (`POST /api/rsvp-webhook`, Body = der Token selbst, `text/plain`): zusätzlich `"eventId": "<Event.id in rsvp-app>"` - daraus lernt dieses Tool beiläufig `Poll.rsvpEventId`, um beim Schließen zu wissen, wohin das Ergebnis gemeldet werden soll (siehe "Ergebnis-Meldung" unten).

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

## Konten

Jedes Tool der Suite (rsvp-app, dieses Tool, künftig weitere) hat **eigene, lokale
Konten** und ist damit vollständig allein nutzbar. Optional lassen sich Tools verbinden,
sodass man dasselbe Konto in mehreren nutzen kann - siehe "Konten-Verbund" unten.

### Rollen

| Rolle | Darf |
| --- | --- |
| **ADMIN** | alles: alle Abstimmungen (auch Alt-Abstimmungen ohne Konto) ansehen/verwalten, Konten anlegen/löschen, Rollen vergeben |
| **CREATOR** | eigene Abstimmungen anlegen und verwalten, mit anderen teilen, Moderator-Konten einladen |
| **MODERATOR** | legt nichts selbst an, bearbeitet und schließt nur ihm freigegebene Abstimmungen |

Pro Abstimmung gibt es zwei Stufen (`app/lib/permissions.ts`, `getPollLevel` - die eine
zentrale Prüfung für jede Seite und jede Server Action):

* **owner** (Ersteller:in oder Admin): bearbeiten, schließen, **löschen, teilen**.
* **moderator** (per Freigabe): bearbeiten und schließen, **nicht** löschen oder weiter teilen.

Geteilt wird per E-Mail-Adresse mit einem **bestehenden** Konto (`PollAccess`); wer noch
keins hat, wird zuerst unter `/nutzer` eingeladen oder meldet sich einmal über ein
verbundenes Tool an.

### Erstes Konto und weitere Konten

Es gibt keine öffentliche Registrierung. Das allererste Konto entsteht auf dem Server:

```bash
node create-user.js deine-email@domain.de ADMIN                 # lokal
docker compose run --rm abstimmungstool node create-user.js deine-email@domain.de ADMIN
```

Das Passwort wird verdeckt abgefragt (mind. 10 Zeichen). Weitere Konten lädt man unter
`/nutzer` ein: Die Person bekommt einen Einmal-Link (7 Tage gültig) und legt ihr Passwort
**selbst** fest - kein Admin vergibt je ein Passwort für jemand anderen. Ohne `SMTP_HOST`
zeigt die Seite den Link dem Einladenden einmalig zum Weitergeben an. Nur Admins vergeben
die Rollen CREATOR/ADMIN; alle anderen laden ausschließlich Moderatoren ein.
Admin-Konten lassen sich in der Oberfläche bewusst weder ändern noch löschen (Schutz vor
Aussperren) und haben keinen Passwort-Reset per Mail - das geht nur per `create-user.js`.

### Alt-Abstimmungen (vor Einführung der Konten)

Abstimmungen ohne Besitzer (`Poll.ownerId = null`) bleiben mit dem alten Verwaltungs-Link
(`/[pollId]/verwalten?token=...`) erreichbar. Ein eingeloggtes Konto kann sie auf der
Verwaltungsseite **übernehmen** ("Meinem Konto zuordnen"); dabei wird der Token erneuert,
sodass jeder früher weitergegebene Link wertlos wird. Bei Abstimmungen **mit** Besitzer wird
der `creatorToken` bewusst ignoriert - sonst würde ein weiter gültiger Geheim-Link jede
Rechteverwaltung (z.B. entzogene Freigaben) aushebeln.

### Sicherheit

* **Passwörter:** scrypt (`node:crypto`, N=2^15, r=8, p=3) mit eingebetteten Parametern
  (später erhöhbar, alte Hashes werden beim nächsten Login aktualisiert). Mind. 10 Zeichen,
  keine Zeichenklassen-Regeln, Abgleich gegen naheliegende Fälle.
* **Passwort-Raten:** Drosselung pro IP **und** pro Ziel-E-Mail (`app/lib/throttle.ts`).
  10 Fehlversuche pro E-Mail bzw. 20 pro IP in 15 Minuten, danach Sperre bis zum Ende des
  Zeitfensters - bewusst **keine** dauerhafte Kontosperre, sonst könnte jeder fremde Konten
  lahmlegen. Fehlermeldung und Antwortzeit sind für bekannte und unbekannte Adressen
  gleich. Passwort-Reset-Anfragen sind ebenfalls gedrosselt (Mail-Flut) und antworten
  immer neutral. Gespeichert werden nur SHA-256-Hashes von IP/E-Mail.
* **`TRUST_PROXY_HOPS`** muss zur Umgebung passen (siehe `.env.example`): Nur so ist die
  IP für die Drosselung nicht durch einen selbst mitgeschickten `X-Forwarded-For`-Wert
  fälschbar.
* **Sessions:** zufälliger Token im Cookie `__Host-session` (HttpOnly, Secure, SameSite=Lax,
  ohne Domain-Attribut - keine andere Subdomain kann es überschreiben), in der Datenbank
  nur als SHA-256-Hash. Neue Session bei jedem Login (Session-Fixation), Passwortwechsel
  beendet alle anderen Sitzungen. Einladungs-/Reset-Links: einmalig, befristet, nur als Hash.
* **Berechtigungen** werden serverseitig in jeder Server Action geprüft, nie nur in der
  Oberfläche. Server Actions prüfen zusätzlich den Origin (CSRF, Next.js-Standard).
* **Header:** `X-Frame-Options`/`frame-ancestors 'none'` (kein Einbetten), `nosniff`,
  `Referrer-Policy`, HSTS (siehe `next.config.ts`).

### Konten-Verbund mit anderen Tools (optional)

Über das gemeinsame Paket [`suite-kit`](https://github.com/druXter/suite-kit) (Protokoll,
Sicherheitsregeln und Format dort im README) kann man sich in diesem Tool mit einem Konto
eines anderen Tools anmelden - und umgekehrt. Es gibt **keinen zentralen Anbieter**: Jedes
Tool ist zugleich Anbieter (stellt Login-Bestätigungen aus) und Empfänger (nimmt sie an).

* **Konfiguration:** `SUITE_SIGNING_KEY` + `SUITE_TRUSTED_APPS` (Anbieter),
  `SUITE_IDPS` (Empfänger), siehe `.env.example`. Ohne sie keine Föderation, kein Button.
* **Kein Passwort-Austausch, kein gemeinsames Secret:** Bestätigungen sind mit Ed25519
  signiert, der öffentliche Schlüssel steht unter `/.well-known/suite-identity`.
* **Identität** ist (Anbieter, Konto-ID) - nie die E-Mail. Es gibt **kein automatisches
  Zusammenführen** über die E-Mail: Gibt es hier schon ein lokales Konto mit derselben
  Adresse, wird der Verbund-Login abgelehnt; man verknüpft bewusst unter `/konto` aus einer
  bestehenden Sitzung heraus.
* **Rollen** gibt der Empfänger, nie der Anbieter, und nur beim ersten Login: Admin des
  anderen Tools wird nur bei `mapAdminRole` hier Admin (sonst Creator), Moderatoren bleiben
  Moderatoren. Danach vergeben nur lokale Admins Rollen.
* **Keine Ketten:** Ein Tool bestätigt nur Konten mit lokalem Passwort, nie rein
  föderierte.
* Der Login-Ablauf läuft über `/api/suite/login` → Anbieter → `/api/suite/authorize` →
  `/api/suite/callback` (`app/api/suite/`).

## Bewusste Grenzen (kein Missverständnis)

* **Kein Schutz vor Mehrfachabstimmung über mehrere Geräte/Browser** - das Cookie-
  basierte `voter_token` verhindert nur, im selben Browser mehrmals abzustimmen.
  Für eine kleine, vertraute Gruppe ist das ein bewusst akzeptierter Kompromiss,
  kein Sicherheitsversprechen für öffentliche Abstimmungen mit Fremden.
* **Kein Rate-Limiting beim Abstimmen** - nur Anmeldung und Passwort-Reset sind
  gedrosselt. Das Anlegen erfordert ein Konto, das Abstimmen selbst bleibt offen; bei
  Erreichbarkeit übers offene Internet ggf. nachrüsten.
* **Datenschutzerklärung ist ein Entwurf** (`app/datenschutz/page.tsx`): Sie beschreibt,
  was das Tool tatsächlich speichert, ersetzt aber keine juristische Prüfung - vor dem
  Einsatz mit Externen prüfen lassen und bei Änderungen der Datenverarbeitung mitpflegen.
  Impressum und Verantwortlicher kommen aus den `IMPRESSUM_*`-Variablen.

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

## Namentliche Ergebnis-Anzeige (optional)

`Poll.showVoterNames` (Checkbox "Abstimmende namentlich anzeigen" beim Anlegen/
Bearbeiten, nur mit `requireRsvpVerification` sinnvoll) zeigt auf der öffentlichen
Ergebnisseite zusätzlich zu den aggregierten Zahlen die E-Mails der Personen, die für
welche Option gestimmt haben (`app/[pollId]/poll-results.tsx`). Standardmäßig aus.
Der Ersteller/die Erstellerin und alle Konten mit Verwaltungs-Berechtigung (Freigabe) sehen
diese E-Mails auf der Verwaltungsseite immer, unabhängig von diesem Schalter.

## Ergebnis-Meldung an rsvp-app

Schließt sich eine Abstimmung mit gesetztem `Poll.rsvpEventId` (gelernt aus dem
rsvp-webhook, siehe "Token-Format" oben), wird das Ergebnis aktiv an rsvp-app
gemeldet (`app/lib/rsvp-notify.ts`, `notifyRsvpAppOfResult`) - sowohl beim manuellen
Schließen (`closePoll`) als auch beim automatischen Schließen-Cronjob (siehe unten).
Gewinner = alle Optionen mit der höchsten Stimmenzahl (kann mehrere bei Gleichstand
sein, oder keine bei 0 Stimmen). Best-effort mit 5s-Timeout - ein nicht erreichbares
rsvp-app verhindert nie das Schließen der Abstimmung selbst.

## Automatisches Schließen (Cronjob / Uptime Kuma)

Damit eine Abstimmung mit gesetztem `closesAt` auch dann geschlossen wird (und damit
die Ergebnis-Meldung oben auslöst), wenn niemand manuell "Schließen" klickt, muss der
folgende Endpoint regelmäßig (z.B. alle 15 Minuten) über einen Dienst wie Uptime Kuma
aufgerufen werden - gleiches Muster wie rsvp-apps `/api/cron/reminders`:

`GET https://vote.deine-domain.de/api/cron/close-expired-polls?secret=DeinSehrGeheimesPasswort123`

## Automatische Löschung (Löschfristen)

Gleiche Fristen wie in rsvp-app (Speicherbegrenzung, Art. 5 Abs. 1 lit. e DSGVO; siehe auch
die Datenschutzerklärung, Punkt 11). Ein weiterer Cronjob-Endpoint, den Uptime Kuma
**einmal täglich** aufrufen muss - ohne diesen Monitor wird nichts gelöscht:

`GET https://vote.deine-domain.de/api/cron/cleanup?secret=DeinSehrGeheimesPasswort123`

* **Abstimmungen** samt Optionen, Stimmen und Freigaben: 18 Monate nachdem sie zu Ende
  gingen (Schließzeitpunkt; sonst das automatische Schließdatum; eine nie geschlossene
  Abstimmung ohne Frist zählt ab Anlage).
* **Konten:** 2 Jahre ohne Anmeldung (`User.lastLoginAt`, wird bei jedem Login gesetzt, auch
  über ein verbundenes Tool). **Admin-Konten sind ausgenommen**, ebenso Konten, denen noch
  eine Abstimmung gehört.
* Außerdem abgelaufene Sitzungen, Einladungs-/Reset-Links und veraltete Drossel-Zähler.

## Setup

```bash
npm install
cp .env.example .env   # Werte eintragen, siehe Kommentare in der Datei
npx prisma generate
npx prisma db push
node create-user.js deine-email@domain.de ADMIN   # erstes Konto, siehe "Konten"
npm run dev             # Port 3600, siehe package.json
```

Es gibt keinen `migrations`-Ordner - wie bei rsvp-app ausschließlich per
`npx prisma db push` synchronisiert.

## Deployment

Docker Compose, gleiches Prinzip wie rsvp-app:

```bash
docker compose up -d --build
```

Beim Bauen holt `npm` das gemeinsame Paket `suite-kit` direkt von GitHub - das Dockerfile
installiert dafür `git`. `./data` wird für die SQLite-Datenbank gemountet. Port 3006 ist in
`docker-compose.yml` voreingestellt (3000-3005 sind auf diesem Server bereits von
anderen Diensten belegt) - bei Bedarf anpassen.
