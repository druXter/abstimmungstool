# Konzept: Sitzungsmodus (Idee L7)

Stand: 2026-10-17 (Abschnitte 6 bis 8 nach einer Probesitzung ergänzt). Idee L7 aus `suite-kit/docs/IDEEN.md`: Mitgliederversammlung, Fachschaftsrat, StuPa. Die Bausteine
der Suite werden verbunden: Tagesordnung (Zeitplan), Anwesenheit über den Check-in (rsvp-app), Abstimmungen nur für
Anwesende (hier), viele kurze Abstimmungen hintereinander, Beschlussfähigkeit live, Rednerliste, Protokoll.

**Grundsatz: Jeder Baustein ist einzeln schaltbar.** Es gibt keinen Schalter „Sitzungsmodus an“, sondern Optionen, die
sich frei kombinieren lassen:

| Baustein | Wo | Schalter |
| --- | --- | --- |
| Kommen und Gehen mit Uhrzeit, Reiter „Anwesenheit“ | rsvp-app | Termin: „Kommen und Gehen protokollieren“ (braucht QR-Einlass) |
| Sitzung mit schnellen Abstimmungen | Abstimmungstool | eine Sitzung anlegen; mit rsvp-app nur, wenn ein Termin sie verlinkt |
| Abstimmen nur für Anwesende | Abstimmungstool | Sitzung: „Nur Anwesende stimmen ab“ (sonst alle Zusagen) |
| Geheim oder namentlich | Abstimmungstool | pro Abstimmung, Vorgabe pro Sitzung |
| Beschlussfähigkeit live | Abstimmungstool | Sitzung: „Beschlussfähig ab N Anwesenden“ (leer = keine Anzeige) |
| Rednerliste | Abstimmungstool | Sitzung: „Rednerliste“ |
| Selbst ein- und auschecken | Abstimmungstool (über rsvp-app) | Sitzung: „Mitglieder checken sich selbst ein und aus“ |
| Andere ein- und auschecken ohne Scan | Abstimmungstool (über rsvp-app) | immer in der Sitzungsleitung, sobald ein Termin mit QR-Einlass verknüpft ist |
| Tafel für Beamer und Gäste | Abstimmungstool | Sitzung: Tafel-Link erzeugen (sonst keine Tafel) |
| Tagesordnung und Live-Steuerung | Zeitplan, eingebettet hier | Sitzung: Links aus dem Zeitplan; Zeitplan: `LIVE_EMBED_ORIGINS` |
| Protokoll (Anwesenheit, Beschlüsse, Tagesordnung) | Zeitplan, rsvp-app, hier | je eigene Exporte; Zusammenführung im Zeitplan-Rückblick optional |

## 1. Anwesenheit (rsvp-app, umgesetzt)

`Event.trackPresence`: Auschecken heißt „geht“. `Rsvp.leftAt`/`RsvpPerson.leftAt` halten fest, seit wann jemand weg
ist, `hasAttended` bleibt („war da“). Jeder Wechsel landet in `PresenceEntry` (Name, Zeitpunkt, IN/OUT). Ein erneuter
Scan checkt Gegangene wieder ein, „Letzte Änderung zurücknehmen“ korrigiert Fehlscans. Reiter „Anwesenheit“ mit
Aufenthalten pro Person, Verlauf, Druck und CSV. Details: `rsvp-app/app/lib/checkin.ts`.

## 2. Sitzung im Abstimmungstool

Neues Modell `Assembly` („Sitzung“), daneben `Poll`, `LiveSession`, `Survey`. Eine Sitzung bündelt Abstimmungen
(`Poll.assemblyId`, Identität `ASSEMBLY`) und kennt ihre Mitglieder (`AssemblyMember`).

### Mitglieder: nur über rsvp-app

Ein Termin in rsvp-app verlinkt die Sitzung (`Event.assemblyUrl` = `<Abstimmungstool>/sitzung/<id>`). Gäste mit einer
Zusage, die zählt, sehen auf ihrer Seite „🗳️ Zur Sitzung“. rsvp-app leitet über `/api/assembly-link/<eventId>` mit
einem frisch signierten Nachweis weiter auf `/sitzung/<id>/beitreten?verify=…`. Das Abstimmungstool legt das Mitglied
an bzw. aktualisiert es und setzt ein eigenes Cookie (`assembly_<id>`, zufälliges Token, in der Datenbank nur der
Hash). Ein Beitritt von einem zweiten Gerät meldet das erste ab (ein Token pro Mitglied).

Das Mitglied heißt so, wie es in rsvp-app angemeldet ist (für Rednerliste und namentliche Abstimmungen); erkannt wird
es an einem Pseudonym `sub` = HMAC(Secret, Sitzung, Rsvp-ID). Keine E-Mail, keine Rsvp-ID.

### Anwesenheit: bei jeder Stimme frisch aus rsvp-app

Das Abstimmungstool fragt rsvp-app (`POST /api/assembly/roster`, signiert), wer gerade da ist: Antwort ist die Liste
der Pseudonyme der Anwesenden, die Zahl der Zusagen und ob der Termin QR-Einlass hat (ebenfalls signiert). Kurz
zwischengespeichert (5 Sekunden), bei jeder Stimmabgabe geprüft. **Fail closed:** Ist rsvp-app nicht erreichbar,
gilt niemand als anwesend - die Seite sagt das. Wer geht, kann danach nicht mehr abstimmen; abgegebene Stimmen
bleiben (sie wurden als Anwesende abgegeben).

Ohne „Nur Anwesende stimmen ab“ dürfen alle Mitglieder abstimmen (wer beigetreten ist, hatte eine Zusage).

### Verknüpfung absichern

Die Sitzung merkt sich den Termin (`Assembly.rsvpEventId`), sobald rsvp-app sie zum ersten Mal meldet - beim
Speichern des Links (`POST /api/rsvp-assembly`, Nachricht `assembly-link`) oder spätestens beim ersten Beitritt.
Danach nimmt sie nur noch Nachweise dieses Termins an; ein anderer Termin bekommt „schon mit einem anderen Termin
verknüpft“. Die Verwaltung sieht den Termin und kann die Verknüpfung lösen (Mitglieder werden dabei entfernt).
rsvp-app beantwortet die Anwesenheit nur für einen Termin, der genau diese Sitzung verlinkt.

### Nachrichten (gleiches Format und Secret wie die übrige Kopplung, immer mit `typ`)

| typ | Richtung | Payload | gültig |
| --- | --- | --- | --- |
| `assembly-access` | rsvp-app → Browser → `/sitzung/<id>/beitreten?verify=` | `assemblyId, eventId, sub, name, exp` | ≤ 15 min |
| `assembly-link` | rsvp-app → `POST /api/rsvp-assembly` | `assemblyId, eventId, eventTitle, exp` | ≤ 5 min |
| `assembly-roster` | Abstimmungstool → `POST <rsvp-app>/api/assembly/roster` | `assemblyId, eventId, exp` | ≤ 5 min |
| `assembly-roster-result` | Antwort darauf | `assemblyId, eventId, checkin, members, present: sub[], exp` | ≤ 5 min |
| `assembly-decisions` | rsvp-app → `POST /api/assembly/decisions` | `assemblyId, eventId, exp` | ≤ 5 min |
| `assembly-attendance` | Abstimmungstool → `POST <rsvp-app>/api/assembly/attendance` | `assemblyId, eventId, exp` | ≤ 5 min |
| `assembly-attendance-result` | Antwort darauf | `assemblyId, eventId, checkin, trackPresence, people: [{ sub, name, present, left }], exp` | ≤ 5 min |
| `assembly-presence` | Abstimmungstool → `POST <rsvp-app>/api/assembly/presence` | `assemblyId, eventId, sub, present, exp` (Antwort 200/404/409, unsigniert) | ≤ 5 min |
| `assembly-decisions-result` | Antwort darauf | `assemblyId, eventId, decisions: [{ title, secret, openedAt, closedAt, voters, present, quorumMet, options: [{ label, votes, names? }] }], exp` | ≤ 5 min |

### Abstimmen

- **Geheim** (Vorgabe): Die Stimme hängt an einem Schlüssel aus Cookie-Token und Abstimmung, den die Datenbank nie
  sieht (wie die geheime Wahl mit Stimmlinks). Gespeichert wird getrennt nur, *dass* das Mitglied abgestimmt hat
  (`AssemblyBallot`). Wer nach der Stimme von einem anderen Gerät beitritt, kann die Stimme nicht mehr ändern und
  auch nicht noch einmal abstimmen.
- **Namentlich:** Schlüssel ist das Mitglied, die Verwaltung sieht, wer wie gestimmt hat (Protokoll).
- Ergebnis standardmäßig erst nach dem Schließen sichtbar; beim Schließen hält die Abstimmung fest, wie viele
  anwesend waren und ob die Sitzung beschlussfähig war (`Poll.assemblyPresent`, `Poll.assemblyQuorumMet`).

### Wenig Klicks

Verwaltung `/sitzung/<id>/verwalten`: oben Anwesenheit und Beschlussfähigkeit, darunter „Neue Abstimmung“ mit Titel
und Art (Ja/Nein/Enthaltung oder Wahl mit Optionen, eine pro Zeile), sofort offen; offene Abstimmungen mit Zahl der
Stimmen und „Schließen“, darunter die Ergebnisse. Mitglieder `/sitzung/<id>`: die offenen Abstimmungen direkt mit
Stimmzettel, aktualisiert sich von selbst (die Sitzung zählt bei jeder Änderung `version` hoch).

## 3. Beschlussfähigkeit

`Assembly.quorum`: beschlussfähig ab N Anwesenden. Angezeigt in Verwaltung und Mitgliederansicht („12 anwesend ·
beschlussfähig ab 11“), festgehalten bei jedem Beschluss. Die Zahl der Anwesenden kommt aus rsvp-app; ohne
„Kommen und Gehen“ zählt dort jeder Eingecheckte bis zum Ende.

## 4. Rednerliste

`Assembly.speakerList`. Mitglieder melden sich zu Wort („Wortmeldung“) oder mit einem Antrag zur Geschäftsordnung
(„GO-Antrag“, kommt vor alle Wortmeldungen) und können zurückziehen. Die Sitzungsleitung ruft auf („dran“) und
schließt ab. Nur wer abstimmen dürfte, kann sich melden (mit „Nur Anwesende“ also nur Anwesende).

## 5. Protokoll

- rsvp-app: Anwesenheit (Reiter, CSV) - wer wann kam und ging.
- Abstimmungstool: Beschlüsse der Sitzung als CSV (Zeit, Titel, Ergebnis, anwesend, beschlussfähig, bei namentlich die
  Namen).
- Zeitplan: Rückblick mit Ist-Zeiten und Protokollnotizen je Tagesordnungspunkt (L24). **Zusammenführung:** Gibt der
  Termin in rsvp-app es frei (zwei einzelne Häkchen: Kommen und Gehen, Beschlüsse), fragt der Rückblick beim Öffnen
  rsvp-app (`protocol-request` an `/api/timeline/protocol`, Secret der Zeitplan-Anbindung); rsvp-app holt die Beschlüsse
  hier ab (`assembly-decisions`). Der Rückblick zeigt Kommen, Gehen und Beschlüsse beim Tagesordnungspunkt, der zu der
  Zeit lief (Beschlüsse zum Zeitpunkt des Schließens), den Rest unter „Außerhalb der Punkte“, und nimmt beides in die
  CSV auf. Der Zeitplan speichert davon nichts. Die Termin-id in rsvp-app lässt sich im Zeitplan auch ohne den Zugang
  „nur mit Zusage“ eintragen.

## 6. Sitzungsleitung: ein Tab für Leitung, Protokoll und Beisitz

Nach einer Probesitzung (2026-10-17): Wer leitet oder Protokoll führt, braucht alles an einer Stelle. Die Verwaltung
`/sitzung/<id>/verwalten` ist deshalb als Arbeitsfläche aufgebaut:

- **Links:** die Tagesordnung - mit Link der Live-Steuerung als eingebetteter Zeitplan (Abschnitt 8), sonst die
  Tagesordnung zum Lesen - und darunter die **Anwesenheit**: alle Zusagen aus rsvp-app mit Namen, Suche und Filter
  (alle, da, nicht da), je ein Knopf „Einchecken“, „Geht“ (mit Kommen und Gehen, sonst „Austragen“) bzw. „Kommt
  wieder“. Kein Scan nötig. „📱 beigetreten“ zeigt, wer der Sitzung auf dem Handy beigetreten ist.
- **Rechts:** Neue Abstimmung, offene Abstimmungen mit Schließen, Rednerliste, Ergebnisse mit CSV.
- **Darunter eingeklappt:** die Einrichtung (rsvp-app, Zeitplan, Tafel, Einstellungen, gemeinsam leiten, beenden).

Protokoll und Beisitz bekommen die Sitzung über „Gemeinsam leiten“ freigegeben (alles außer löschen und weiter
teilen). Die Anwesenheitsliste holt die Seite bei jedem Laden frisch aus rsvp-app (`assembly-attendance`) und speichert
sie nicht. Ein- und Auschecken geht als `assembly-presence` mit dem Zielzustand (`present: true/false`, nie
„umschalten“, ein doppelter Klick ändert nichts) und wirkt in rsvp-app wie der Knopf in der Gästeliste: alle
zusagenden Personen der Antwort, mit Eintrag im Verlauf „Kommen und Gehen“. rsvp-app nimmt das nur für einen Termin mit
QR-Einlass an, der genau diese Sitzung verlinkt, und nur für Zusagen, die zählen. Ist rsvp-app nicht erreichbar,
ändert sich nichts und die Seite sagt das.

**Selbst ein- und auschecken** (Schalter, Vorgabe aus): In der Mitgliederansicht, bei Abstimmungen und Rednerliste,
erscheint „Einchecken“ bzw. „Ich gehe (auschecken)“. Das Abstimmungstool schickt dabei immer das Pseudonym des
eigenen Mitglieds, nie eines aus dem Formular. Achtung: Mit dem Schalter kann jede Person mit Zusage auch von
unterwegs abstimmen, „nur Anwesende“ heißt dann „nur, wer sich eingecheckt hat“. Gedacht für Sitzungen ohne Einlass
oder mit Online-Teilnahme.

## 7. Tafel

`/sitzung/<id>/tafel?k=<Schlüssel>` für Beamer, Gästemonitor und Gäste ohne Stimmrecht - ohne Anmeldung, nur mit dem
Link. Der Schlüssel (`Assembly.boardKey`, zufällig) entsteht erst auf Klick, lässt sich neu erzeugen (der alte gilt
sofort nicht mehr) und abschalten. Header: kein Referer, kein Cache, kein Index.

Die Tafel zeigt nur, was auch Mitglieder sehen: Tagesordnung (laufender Punkt und die nächsten), Durchsage aus dem
Zeitplan, Anwesende und Beschlussfähigkeit, laufende Abstimmungen mit der Zahl der Stimmen (kein Zwischenstand, die
Ergebnisse sind erst nach dem Schließen öffentlich), das letzte Ergebnis groß mit Balken - bei namentlichen
Abstimmungen mit Namen je Option -, drei frühere Ergebnisse kurz und die Rednerliste. Sie aktualisiert sich selbst
(wie die Mitgliederansicht) und scrollt auf dem Handy.

## 8. Zeitplan: Tagesordnung und Live-Steuerung

Die Tagesordnung bleibt im Zeitplan-Tool; die Sitzung kennt zwei Links, beide nur auf `ZEITPLAN_BASE_URL`:

- **Gästeansicht oder Tafel-Link** (`<Zeitplan>/<slug>` bzw. `…/<slug>/tafel?k=…`, gespeichert als `<slug>?k=…`): Das
  Abstimmungstool liest daraus den öffentlichen Polling-Endpunkt des Zeitplans (`/api/view/<slug>?k=…`) - dieselben
  Daten, die jede*r mit dem Link sieht, kein Secret, nichts gespeichert, 5 Sekunden zwischengespeichert. Nur Titel,
  Zeitzone, Durchsage und je Punkt Titel, Status, Uhrzeit und Verspätung werden übernommen und geprüft. Ist der Zeitplan
  nicht erreichbar, fehlt die Tagesordnung einfach.
- **Live-Steuerung** (`<Zeitplan>/admin/events/<id>/live`): erscheint in der Sitzungsleitung als iFrame. Der Zeitplan
  erlaubt das nur für Seiten aus seinem `LIVE_EMBED_ORIGINS` (proxy.ts dort, ohne Eintrag wie bisher nicht
  einbettbar) und blendet im iFrame Kopf- und Fußzeile aus. Bedienen kann die Steuerung nur, wer im Zeitplan angemeldet
  ist und das Event steuern darf - das klappt eingebettet, weil alle Tools unter derselben Website laufen (Subdomains,
  Cookies `SameSite=Lax`). Ohne Anmeldung bleibt der Rahmen leer; der Link „Im Zeitplan öffnen“ hilft.

**Bewusst nicht:** eine eigene Steuer-Schnittstelle Abstimmungstool → Zeitplan. Sie bräuchte ein weiteres Secret und
eine zweite Rechteprüfung; der iFrame nutzt die vorhandene Live-Steuerung mit ihren Rechten unverändert.

## Datenschutz

rsvp-app gibt nur Pseudonym und Namen der Zusage weiter, keine E-Mail. Die Anwesenheitsliste mit den Namen aller
Zusagen bekommt nur die Sitzungsleitung angezeigt; das Abstimmungstool speichert sie nicht. Die Tafel zeigt Namen nur
bei namentlichen Abstimmungen (wie die Mitgliederansicht) und in der Rednerliste. Das Abstimmungstool speichert Mitglieder mit
Namen, solange es die Sitzung gibt; geheime Stimmen lassen sich keinem Mitglied zuordnen. Fürs Protokoll gehen Namen
nur bei namentlichen Abstimmungen und nur mit Freigabe des Termins an den Zeitplan, der sie nur anzeigt. Alle drei
Datenschutzerklärungen beschreiben das.
