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
* **Wer darf abstimmen? (pro Abstimmung, `Poll.voterIdentity`)** - siehe
  "Identität der Abstimmenden" unten:
  * **Offen für alle (Standard, `COOKIE`):** Identifikation über ein zufälliges
    Browser-Cookie (`voter_token`), kein Konto. Die eigene Auswahl kann jederzeit
    geändert werden, solange die Abstimmung offen ist.
  * **Persönliche Stimmlinks (`LINK`):** Pro Person ein eigener Link, Beteiligungsübersicht,
    optional geheime Wahl - siehe "Persönliche Stimmlinks" unten.
  * **Mit bestätigter E-Mail-Adresse (`EMAIL`):** Adresse eingeben, per Link bestätigen,
    abstimmen; optional nur bestimmte Adressen/Domains - siehe "Abstimmen mit bestätigter
    E-Mail-Adresse" unten. Nur wählbar, wenn `SMTP_HOST` gesetzt ist.
  * **Nur mit Konto (`ACCOUNT`):** Eine Stimme pro Konto dieses Tools, geräteübergreifend -
    siehe "Abstimmen mit Konto" unten.
  * **Nur über rsvp-app (`RSVP`):** Statt des Cookies wird eine über `rsvp-app`
    verifizierte E-Mail als Identität genutzt - siehe "Verifizierte Abstimmungen"
    unten. Verhindert Mehrfachabstimmen auch über verschiedene Geräte/Browser hinweg.
  * Lässt sich mit der Mehrfachauswahl kombinieren.
* **Hürden ohne starke Identität (optional, pro Abstimmung)** - siehe "Hürden" unten:
  Pflicht-Namensfeld im Cookie-Modus, Höchstzahl an Teilnehmenden, Zugangscode. Neue
  Cookie-Identitäten werden außerdem pro IP und Abstimmung gedrosselt.
* **Terminabstimmungen** (`Poll.optionKind`: Freitext, Tage oder Termine mit Uhrzeit):
  Kalender-Eingabe statt Freitext, Optionen chronologisch sortiert. Jede Option trägt dann
  `startsAt`, das Label wird daraus formatiert ("Mi., 07.10.2026, 19:00 Uhr",
  `app/lib/date-options.ts`) - Ergebnis, CSV, Mail und rsvp-app zeigen einfach das Label.
  Eingabe und Anzeige in der Zeitzone des Servers (`TZ`), wie das Schließdatum. Die Art steht
  nach dem Anlegen fest.
* **Optionen von Teilnehmenden** (`Poll.allowVoterOptions`, optional): Wer abstimmen darf,
  kann Optionen vorschlagen (gedrosselt: 10 pro IP, Abstimmung und Stunde; wer vorschlägt,
  wird nicht gespeichert). Mit `voterOptionsNeedApproval` (beim Anlegen vorausgewählt)
  erscheinen Vorschläge erst nach Freigabe auf der Verwaltungsseite. Offene Vorschläge
  (`PollOption.approved = false`) zählen nirgends als Option - weder beim Abstimmen noch in
  Ergebnis, Export oder beim Bearbeiten.
* **Grenzen bei Mehrfachauswahl** (`Poll.minChoices`/`maxChoices`, optional): "wähle 1 bis
  3". Ohne JavaScript kann die Seite das nicht erzwingen - `castVote` prüft und lehnt mit
  Hinweis ab. Gelöschte Optionen machen ein Minimum nie unerfüllbar (`choiceLimits` in
  `app/lib/results.ts`).
* **Sichtbarkeit des Ergebnisses** (`Poll.resultsVisibility`): immer live (Standard), erst
  nach der eigenen Stimme, erst nach dem Ende oder nie öffentlich (nur Verwaltung). Solange
  es verborgen ist, zeigt die Seite nur die Zahl der Teilnehmenden. Bei "nur Verwaltung"
  geht das Ergebnis auch nicht an rsvp-app (dort stünde es öffentlich).
* **Live-Ergebnis:** Stimmenanzahl und Prozentanteil pro Option, in Echtzeit. Der
  Prozentwert bezieht sich auf die Anzahl abstimmender PERSONEN, nicht auf die
  Summe aller Options-Stimmen - bei Mehrfachauswahl kann die Summe der Prozentwerte
  daher über 100% liegen, das ist beabsichtigt (siehe `app/[pollId]/poll-results.tsx`).
* **Verwalten mit Konto:** Unter "Meine Abstimmungen" (`/meine-abstimmungen`) stehen
  eigene und mit einem geteilte Abstimmungen. Bearbeiten (Titel/Beschreibung/Optionen/
  Einstellungen), vorzeitig Schließen, Löschen und Teilen - siehe "Konten".
* **Gemeinsam moderieren:** Eine Abstimmung lässt sich mit anderen Konten teilen; diese
  können sie bearbeiten und schließen.
* **Komfort auf der Verwaltungsseite:** CSV-Export, QR-Code zum Abstimmungslink,
  Duplizieren als Vorlage für wiederkehrende Runden, Ergebnis-Mail beim Schließen und eine
  optionale Mindestbeteiligung (Quorum) - siehe "Verwaltung & Komfort" unten.

## Identität der Abstimmenden

Pro Abstimmung legt `Poll.voterIdentity` fest, woran eine Stimme einer Person zugeordnet
wird. Die Auflösung passiert an genau einer Stelle (`resolveVoter` in
`app/lib/voter-identity.ts`), die Abstimmungsseite und `castVote` gehen beide darüber.

| Modus | Identität | Stand |
| --- | --- | --- |
| `COOKIE` | zufälliges Browser-Cookie (Standard) | umgesetzt |
| `RSVP` | von rsvp-app bestätigte E-Mail, nur Zusagende | umgesetzt |
| `LINK` | persönlicher Stimmlink, optional geheime Wahl | umgesetzt |
| `EMAIL` | per Mail bestätigte Adresse, optional Adress-/Domainliste | umgesetzt (braucht `SMTP_HOST`) |
| `ACCOUNT` | Konto dieses Tools (auch per Verbund angelegt) | umgesetzt |

* Jede Stimme speichert `identityKind`, einen `voterKey` mit der Art als Präfix
  (`cookie:…`, `rsvp:…` - Schlüssel verschiedener Arten können so nie kollidieren) und
  ggf. einen `voterName` für die namentliche Anzeige. Eindeutig ist
  `(pollId, voterKey, optionId)`.
* **Fail-closed:** Fehlt die geforderte Identität, kann nicht abgestimmt werden - es
  gibt nie einen Rückfall auf das Cookie.
* **Der Modus ist gesperrt, sobald jemand abgestimmt hat** (Bearbeiten-Seite und
  `updatePoll`) - sonst stünden Stimmen verschiedener Arten nebeneinander, und die
  bisherigen könnte niemand mehr ändern.

## Hürden (Zugangscode, Höchstzahl, Name, Drosselung)

Ergänzungen, die mit jedem Modus (bzw. im Cookie-Modus) funktionieren, aber **keine
Identität ersetzen** - die Oberfläche sagt das jeweils beim Einstellen:

* **Zugangscode** (`Poll.accessCode`, `app/lib/access-code.ts`): Ohne Code zeigt die
  Abstimmungsseite nichts - weder Titel noch Optionen noch Ergebnis -, und `castVote` lehnt
  ab. Wer ihn eingibt, bekommt ein Cookie `poll_access_<pollId>` (nur für den Pfad dieser
  Abstimmung, 30 Tage) mit einem Hash aus Abstimmung und Code; ein geänderter Code macht alte
  Cookies wertlos. Groß-/Kleinschreibung zählt nicht. Eingaben sind pro IP und Abstimmung
  gedrosselt (10 in 15 Minuten). Der Code liegt im Klartext in der Datenbank, weil die
  Verwaltungsseite ihn zum Weitergeben anzeigt (dort auch ein Link mit `?code=`, der das Feld
  nur vorausfüllt). **Verhindert keine Mehrfachabstimmung** - alle kennen denselben Code.
* **Höchstzahl an Teilnehmenden** (`Poll.maxVoters`): Neue Personen werden abgewiesen, sobald
  so viele verschiedene `voterKey`s abgestimmt haben; wer drin ist, kann weiter ändern. Die
  Prüfung läuft in derselben Transaktion wie das Speichern der Stimme.
* **Pflicht-Namensfeld** (`Poll.requireVoterName`, nur Modus `COOKIE`): Der Name landet in
  `Vote.voterName` und wird nicht geprüft. Zusammen mit `showVoterNames` sieht die Gruppe, wer
  wofür gestimmt hat (soziale Kontrolle).
* **Drosselung neuer Cookie-Identitäten** (`newVoterRule` in `app/lib/throttle.ts`): höchstens
  30 **erste** Stimmabgaben pro IP und Abstimmung und Stunde - großzügig, weil sich viele
  Menschen hinter einem NAT eine Adresse teilen. Das Ändern der eigenen Auswahl zählt nicht.
  Ohne erkennbare IP (kein Proxy-Header) wird nicht gedrosselt, sonst teilten sich alle einen
  Zähler; wer den Proxy umgehen kann, könnte den Header ohnehin selbst setzen.

Abgewiesene Stimmen (Höchstzahl, Drosselung) melden sich per Hinweis auf der Seite
(`?hinweis=…`, feste Texte in `app/[pollId]/page.tsx`).

## Persönliche Stimmlinks (Modus `LINK`)

* **Ausstellen** auf der Verwaltungsseite (Owner, Admin, Moderator:innen mit Freigabe): eine
  Namensliste - eine Person pro Zeile, optional mit E-Mail (`Anna`, `Ben <ben@…>`,
  `Cem; cem@…`) - oder nur eine Anzahl (`Link 1`, `Link 2`, …). Höchstens 200 auf einmal,
  500 pro Abstimmung. Jeder Link ist `/[pollId]?k=<token>`.
* **Nur der SHA-256-Hash** des Tokens liegt in der Datenbank (`VoterLink.tokenHash`, wie
  Sitzungen und Einladungen). Deshalb zeigt die Seite frisch ausgestellte Links **nur einmal**
  an (Ergebnis der Server Action per `useActionState`, nirgends gespeichert) - danach geht nur
  noch **neu ausstellen**: neuer Token, der alte wird ungültig, die Stimme bleibt.
* **Verteilen** per Kopieren (einzeln oder alle als Text), QR-Code (im Browser erzeugt, der
  Link geht an keinen weiteren Dienst) oder - bei gesetztem `SMTP_HOST` - direkt per Mail an
  die eingetragenen Adressen.
* **Widerrufen** entfernt den Link samt seiner Stimme. Nach dem Ende der Abstimmung nicht mehr
  für Links mit Stimme (das Ergebnis soll sich nicht nachträglich ändern).
* **Beteiligung:** "7 von 12 haben abgestimmt" und wer fehlt (`VoterLink.hasVoted`).
* Normalfall: `voterKey = link:<VoterLink.id>`, `voterName` = Name aus der Liste - die
  Verwaltung sieht, wer was gewählt hat.
* **Geheime Wahl** (`Poll.secretBallot`, "nur Teilnahme speichern"): Die Stimme hängt an
  `link:` + SHA-256("ballot" + Token) - eine andere Ableitung als `tokenHash`, aus der
  Datenbank also nicht berechenbar. Am Link steht nur `hasVoted` (ein Boolean ohne
  Zeitpunkt), die Stimme bekommt keine zeitlich sortierbare cuid und keinen echten
  Zeitstempel (`createdAt` = 1970), damit sie sich nicht über Zeitpunkte zuordnen lässt.
  Folgen: Nach einer Neuausstellung kann eine schon abgegebene Stimme nicht mehr geändert
  werden (sie zählt aber, ein zweites Abstimmen ist gesperrt), und Links mit Stimme lassen
  sich nicht widerrufen. **Ehrliche Grenzen:** Wer die Links verteilt, kennt die Tokens und
  könnte damit nachsehen, wie eine Person gestimmt hat. Und wer Datenbank **und**
  Server-/Proxy-Logs (Zeitpunkte der Aufrufe mit `?k=`) hat, könnte Zeitpunkte abgleichen.
* Gesperrt wie der Modus selbst, sobald abgestimmt wurde.

## Abstimmen mit bestätigter E-Mail-Adresse (Modus `EMAIL`)

* Nur wählbar mit Mailversand (`SMTP_HOST`), sonst käme nie ein Link an.
* **Ablauf** (`app/lib/email-voters.ts`): Adresse auf der Abstimmungsseite eingeben
  (`normalizeEmail`) → Einmal-Link per Mail (24 Stunden gültig, in der Datenbank nur als
  SHA-256-Hash, `EmailVoter.tokenHash`) → auf `/[pollId]/bestaetigen` **per Knopfdruck**
  bestätigen → der Browser bekommt ein Cookie `poll_email_<pollId>` (nur für den Pfad dieser
  Abstimmung, 30 Tage, in der Datenbank als Hash in `sessionHash`).
* Der bloße Aufruf des Links bestätigt bewusst nichts: Mail-Scanner (z.B. Outlook SafeLinks)
  öffnen Links vorab und würden einen Einmal-Link sonst verbrauchen.
* `voterKey = email:<Adresse>` - dieselbe Adresse auf einem anderen Gerät ist dieselbe
  Person (dort einfach erneut bestätigen). "Andere Adresse verwenden" vergisst die
  Bestätigung in diesem Browser; die Stimme bleibt der alten Adresse zugeordnet.
* **Adress-/Domainliste** (`Poll.allowedEmails`, optional): eine Angabe pro Zeile,
  `@verein.de` für eine ganze Domain, sonst einzelne Adressen. Geprüft beim Anfordern und
  beim Abstimmen - wer nachträglich von der Liste fliegt, kann nicht mehr abstimmen (bereits
  abgegebene Stimmen bleiben).
* **Mailschleuder-Schutz** (`voteEmailRules` in `app/lib/throttle.ts`): höchstens 3 Links pro
  Adresse und Abstimmung und 20 pro IP, jeweils pro Stunde.
* **Grenze:** Wer mehrere Adressen hat, kann mehrfach abstimmen - dagegen hilft nur eine feste
  Adressliste. Nie bestätigte Anfragen löscht der Cleanup-Cron nach Ablauf des Links.

## Abstimmen mit Konto (Modus `ACCOUNT`)

* Abstimmen kann jedes Konto dieses Tools - lokal eingeladen oder beim ersten Verbund-Login
  entstanden (siehe "Konten-Verbund"). Ohne Anmeldung zeigt die Seite einen Hinweis mit
  Link zur Anmeldung, die danach auf die Abstimmung zurückführt.
* `voterKey = account:<User.id>` - nie die E-Mail, die sich ändern lässt. Als Name wird der
  Kontoname gespeichert, sonst die E-Mail (bei jeder Änderung der Auswahl aktualisiert).
* Wer nur abstimmen soll, bekommt ein Konto mit der Rolle **Moderator**: Ohne Freigabe kann
  es nichts verwalten. Eigene **Teilnehmendenkonten** (ohne jede Verwaltungsrolle, auch aus
  rsvp-app) sind für den Suite-Verbund geplant (`TODO.md` D1).
* **Wird ein Konto gelöscht** (von Hand oder per Löschfrist), bleiben seine Stimmen gezählt
  - sonst änderten sich Ergebnisse rückwirkend -, verlieren aber den Namen.

## Verifizierte Abstimmungen (Modus `RSVP`)

Beim Anlegen kann eine Abstimmung auf "Nur über rsvp-app" gestellt werden
(`Poll.voterIdentity = RSVP`). Dann gilt:

* Stimmen werden nicht mehr per Cookie, sondern per **verifizierter E-Mail**
  unterschieden (`voterKey = rsvp:<E-Mail>`) - dieselbe Person kann dadurch nicht mit
  einem zweiten Gerät oder einem gelöschten Cookie erneut abstimmen.
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
* Alle Abstimmungen in anderen Modi ignorieren einen mitgeschickten `?verify=`-Token.

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
* **`TRUST_PROXY_HOPS`** muss zur Umgebung passen (siehe `.env.example`, dort auch, wie man
  es misst): Nur so ist die IP für die Drosselung nicht durch einen selbst mitgeschickten
  `X-Forwarded-For`-Wert fälschbar. Beim Betreiber (Cloudflare → Nginx Proxy Manager) gemessen: `1`.
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
* **Fehlermeldungen:** Beim Login landen sie auf `/anmelden?error=…`, beim Verknüpfen aus
  `/konto` dagegen auf `/konto?error=…` - dort ist man eingeloggt, die Login-Seite würde
  sofort weiterleiten und die Meldung verschlucken. Ist die Sitzung inzwischen weg
  (abgelaufen, anderswo abgemeldet), geht auch ein Verknüpfen-Fehler auf `/anmelden`, weil
  `/konto` sonst selbst zum Login weiterleiten und den Code verlieren würde.

## Bewusste Grenzen (kein Missverständnis)

* **Kein Schutz vor Mehrfachabstimmung über mehrere Geräte/Browser** - das Cookie-
  basierte `voter_token` verhindert nur, im selben Browser mehrmals abzustimmen.
  Für eine kleine, vertraute Gruppe ist das ein bewusst akzeptierter Kompromiss,
  kein Sicherheitsversprechen für öffentliche Abstimmungen mit Fremden.
* **Die Drosselung beim Abstimmen bremst, verhindert aber nichts** - 30 neue
  Cookie-Identitäten pro IP und Stunde lassen sich mit wechselnden IPs umgehen. Wer
  verlässlich "eine Stimme pro Person" braucht, nimmt einen Modus mit echter Identität
  (siehe "Identität der Abstimmenden").
* **Datenschutzerklärung ist ein Entwurf** (`app/datenschutz/page.tsx`): Sie beschreibt,
  was das Tool tatsächlich speichert, ersetzt aber keine juristische Prüfung - vor dem
  Einsatz mit Externen prüfen lassen und bei Änderungen der Datenverarbeitung mitpflegen.
  Impressum und Verantwortlicher kommen aus den `IMPRESSUM_*`-Variablen.

Geplante Erweiterungen (u.a. Schutz vor Mehrfachabstimmung ohne rsvp-app, weitere
Abstimmungsarten, Suite-Verbund für Teilnehmendenkonten) stehen in `TODO.md`.

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
Bearbeiten) zeigt auf der öffentlichen Ergebnisseite zusätzlich zu den aggregierten
Zahlen, wer für welche Option gestimmt hat (`Vote.voterName`, je nach Modus Name oder
E-Mail, siehe `app/[pollId]/poll-results.tsx`). Standardmäßig aus. Im Modus `COOKIE` gibt
es Namen nur mit Pflicht-Namensfeld (siehe "Hürden"), sonst bleibt der Schalter ohne Wirkung.
Der Ersteller/die Erstellerin und alle Konten mit Verwaltungs-Berechtigung (Freigabe) sehen
die Namen auf der Verwaltungsseite immer, unabhängig von diesem Schalter. Das Abstimmformular
weist in allen Modi mit Namen darauf hin, wer sie sieht.

## Verwaltung & Komfort

* **CSV-Export** (`app/[pollId]/verwalten/export/route.ts`): für alle, die die Abstimmung
  verwalten dürfen (bei Alt-Abstimmungen mit `?token=`). Semikolon, UTF-8 mit BOM (öffnet sich
  in einem deutschen Excel direkt). Enthält Zählstand, Teilnehmende, Ergebnis und - nur wenn
  die Stimmen Namen tragen - wer was gewählt hat. Werte, die mit `= + - @` beginnen, bekommen
  ein `'` vorangestellt (Schutz vor CSV-/Formel-Injection über frei eingegebene Namen).
* **QR-Code** zum Abstimmungslink, im Browser erzeugt (`app/ui/qr-code.tsx`, Paket `qrcode`).
* **Duplizieren** (`duplicatePoll`): neue Abstimmung des eingeloggten Kontos mit Titel
  "(Kopie)", Optionen und Einstellungen - ohne Stimmen, Stimmlinks, bestätigte Adressen,
  Freigaben und ohne Schließdatum.
* **Ergebnis-Mail beim Schließen** (`Poll.notifyOwnerOnClose`, bei neuen Abstimmungen
  vorausgewählt, nur mit `SMTP_HOST`): geht an das besitzende Konto, egal ob manuell
  geschlossen oder per Cron. Schließen ist jetzt bedingt (`closedAt IS NULL` im WHERE), sodass
  ein doppelt abgeschicktes Formular oder der gleichzeitige Cron Meldung und Mail nicht
  wiederholen (`app/lib/poll-closed.ts`).
* **Mindestbeteiligung** (`Poll.quorum`): Während der Abstimmung steht "es fehlen noch N",
  danach bei Verfehlen "nicht beschlussfähig" (Seiten, CSV, Mail). Die Auswertung liegt an
  einer Stelle (`app/lib/results.ts`).

## Ergebnis-Meldung an rsvp-app

Schließt sich eine Abstimmung mit gesetztem `Poll.rsvpEventId` (gelernt aus dem
rsvp-webhook, siehe "Token-Format" oben), wird das Ergebnis aktiv an rsvp-app
gemeldet (`app/lib/rsvp-notify.ts`, `notifyRsvpAppOfResult`) - sowohl beim manuellen
Schließen (`closePoll`) als auch beim automatischen Schließen-Cronjob (siehe unten).
Gewinner = alle Optionen mit der höchsten Stimmenzahl (kann mehrere bei Gleichstand
sein, oder keine bei 0 Stimmen). Best-effort mit 5s-Timeout - ein nicht erreichbares
rsvp-app verhindert nie das Schließen der Abstimmung selbst. Ist die Mindestbeteiligung
verfehlt oder ist das Ergebnis auf "nur Verwaltung" gestellt, unterbleibt die Meldung. Zum Quorum: rsvp-app kennt "nicht beschlussfähig" noch nicht und
würde eine leere Gewinnerliste als "keine Stimme abgegeben" anzeigen (Folgepunkt in
`TODO.md`).

## Automatisches Schließen (Cronjob / Uptime Kuma)

Damit eine Abstimmung mit gesetztem `closesAt` auch dann geschlossen wird (und damit
die Ergebnis-Meldung oben auslöst), wenn niemand manuell "Schließen" klickt, muss der
folgende Endpoint regelmäßig (z.B. alle 15 Minuten) über einen Dienst wie Uptime Kuma
aufgerufen werden - gleiches Muster wie rsvp-apps `/api/cron/reminders`:

`GET https://vote.deine-domain.de/api/cron/close-expired-polls?secret=DeinSehrGeheimesPasswort123`

## Als App installieren (PWA)

Das Tool ist eine Progressive Web App: Im Browser (Chrome/Edge/Android: "Installieren" bzw. Button "Als App installieren"
auf der Startseite; iPhone/iPad: Safari → Teilen → "Zum Home-Bildschirm") lässt es sich mit eigenem Symbol und ohne
Browserleiste starten. Das Abstimmen selbst braucht das nicht - jeder Abstimmungslink funktioniert weiter im Browser.

* **Manifest** (`app/manifest.ts`): Name, Farben, Icons (auch maskierbar für Android), Shortcuts zu "Meine Abstimmungen" und
  "Neue Abstimmung". Icons: `app/icon.svg`, `app/favicon.ico`, `app/apple-icon.png`, `public/icons/`.
* **Service Worker** (`public/sw.js`) ist bewusst minimal: Er macht die App installierbar und zeigt ohne Verbindung eine
  Offline-Seite (`public/offline.html`). **Es wird nichts Persönliches zwischengespeichert** - Navigationen gehen immer ans
  Netz, Server Actions, `/api/*` und fremde Herkunft fasst er nicht an; im Cache liegt nur die statische Offline-Seite. So
  bleibt nach dem Abmelden auf einem geteilten Gerät nichts lesbar zurück. Ändert sich `offline.html`, `VERSION` in `sw.js`
  erhöhen.
* `sw.js` wird nie zwischengespeichert (Header in `next.config.ts`), damit Änderungen sofort ankommen - das gilt auch für
  Cloudflare/Proxys davor. Registriert wird der Worker nur in der Produktion (`app/ui/pwa-register.tsx`).
* Es gibt bewusst **keine Push-Benachrichtigungen** und kein Offline-Abstimmen.

## Automatische Löschung (Löschfristen)

Gleiche Fristen wie in rsvp-app (Speicherbegrenzung, Art. 5 Abs. 1 lit. e DSGVO; siehe auch
die Datenschutzerklärung, Punkt 11). Ein weiterer Cronjob-Endpoint, den Uptime Kuma
**einmal täglich** aufrufen muss - ohne diesen Monitor wird nichts gelöscht:

`GET https://vote.deine-domain.de/api/cron/cleanup?secret=DeinSehrGeheimesPasswort123`

* **Abstimmungen** samt Optionen, Stimmen, Stimmlinks, bestätigten Adressen und Freigaben: 18 Monate nachdem sie zu Ende
  gingen (Schließzeitpunkt; sonst das automatische Schließdatum; eine nie geschlossene
  Abstimmung ohne Frist zählt ab Anlage).
* **Konten:** 2 Jahre ohne Anmeldung (`User.lastLoginAt`, wird bei jedem Login gesetzt, auch
  über ein verbundenes Tool). **Admin-Konten sind ausgenommen**, ebenso Konten, denen noch
  eine Abstimmung gehört.
* Außerdem abgelaufene Sitzungen, Einladungs-/Reset-Links, veraltete Drossel-Zähler und nie
  bestätigte E-Mail-Anfragen (Modus `EMAIL`) nach Ablauf ihres Links.

## Setup

```bash
npm install
cp .env.example .env   # Werte eintragen, siehe Kommentare in der Datei
npx prisma generate
node scripts/migrate-db.js   # Datenumzüge, siehe unten - auf einer neuen Datenbank ohne Wirkung
npx prisma db push
node create-user.js deine-email@domain.de ADMIN   # erstes Konto, siehe "Konten"
npm run dev             # Port 3600, siehe package.json
```

Es gibt keinen `migrations`-Ordner - wie bei rsvp-app ausschließlich per
`npx prisma db push` synchronisiert. Was `db push` nicht verlustfrei kann (Spalten mit
Daten ersetzen), erledigt vorher `scripts/migrate-db.js`: Jeder Umzug prüft selbst, ob er
nötig ist, legt vor einer Änderung eine Sicherung der Datenbankdatei daneben
(`<datei>.vor-umzug-<zeit>`) und läuft in einer Transaktion. Das Skript läuft deshalb vor
**jedem** `db push` - im Container automatisch beim Start (siehe `Dockerfile`). Schlägt es
fehl, startet der Container nicht; dann **nicht** mit `db push --accept-data-loss`
weitermachen, sondern den Fehler ansehen.

* Umzug 1 (2026-09-30): `Vote.voterToken`/`verifiedEmail` → `identityKind`/`voterKey`/
  `voterName`, `Poll.requireRsvpVerification` → `Poll.voterIdentity` (siehe "Identität
  der Abstimmenden").

## Tests

End-to-End-Tests mit Playwright (`tests/e2e/`):

```bash
npx playwright install chromium   # einmalig
npm run test:e2e
```

Abgedeckt sind der Konten-Verbund (`suite.spec.ts`), die Stimmabgabe samt
Identitätsmodi (`voting.spec.ts`; rsvp-app spielen die Tests dort selbst, indem sie
Klick-Tokens und Webhooks mit einem Test-Secret signieren), die Hürden
(`hurdles.spec.ts`), die persönlichen Stimmlinks (`links.spec.ts`), die
E-Mail-Bestätigung samt Mailversand (`email.spec.ts`) und Export, Duplizieren, Ergebnis-Mail,
Auto-Schließen und Quorum (`comfort.spec.ts`). Mails fängt ein kleiner
Test-Mailserver ab (`tests/e2e/mail-server.ts`, Port 2525, ohne TLS/Anmeldung), der jede Mail
nach `.e2e/mails.jsonl` schreibt.

Der Lauf baut die App frisch (`next build`) und startet sie auf `127.0.0.1:3601` mit einer
eigenen Datenbank (`prisma/test.db`, wird bei jedem Lauf neu angelegt) - nie gegen die
Entwicklungs- oder Produktivdatenbank. Werte aus einer lokalen `.env`, die den Lauf
beeinflussen könnten (Mailversand, Verbund, rsvp-app), setzt `playwright.config.ts` leer.
Die anderen Tools der Suite spielen kleine Test-Doppel (`tests/e2e/suite-server.ts`, Ports
2628/2629 auf `localhost`).

## Deployment

Docker Compose, gleiches Prinzip wie rsvp-app:

```bash
docker compose up -d --build
```

Beim Bauen holt `npm` das gemeinsame Paket `suite-kit` direkt von GitHub - das Dockerfile
installiert dafür `git`. `./data` wird für die SQLite-Datenbank gemountet. Beim Start
läuft zuerst `scripts/migrate-db.js` (Sicherung landet ebenfalls in `./data`), dann
`prisma db push`. Vor einem Update mit Datenumzug trotzdem selbst eine Sicherung ziehen. Port 3006 ist in
`docker-compose.yml` voreingestellt (3000-3005 sind auf diesem Server bereits von
anderen Diensten belegt) - bei Bedarf anpassen.
