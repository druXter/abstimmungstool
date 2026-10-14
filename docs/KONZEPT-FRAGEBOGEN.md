# Fragebogen – Konzept

Umsetzung von Idee L8 aus `suite-kit/docs/IDEEN.md` (2026-10-14). Anlass: ein Feedback-Fragebogen, der sich per iFrame
in andere Apps einbetten lässt – zuerst die Campus-App (`campus-koblenz.app`, dort heute Nextcloud Forms), später
weitere Apps unter `*.ramonroeser.de`.

## Abgrenzung

Eine Abstimmung (`Poll`) hat genau eine Frage und einen Gewinner; Quorum, Termin festlegen, Ergebnis an rsvp-app und
`Vote` (eindeutig über `pollId, voterKey, optionId`, ohne Text) bauen darauf auf. Ein Fragebogen hat mehrere Fragen
verschiedener Art und keinen Gewinner. Deshalb ein **eigenes Modell** neben `Poll` und `LiveSession`, nach dem Vorbild
der Live-Runden (eigene Actions, eigener Editor, gleiche Verwaltung mit Reitern).

## Datenmodell

| Modell | Inhalt |
| --- | --- |
| `Survey` | Titel, Beschreibung, Danke-Text, wer antworten darf (`SurveyIdentity`), Schließdatum/geschlossen, Besitz |
| `SurveyAccess` | gemeinsam verwalten (wie `LiveAccess`) |
| `SurveyQuestion` | Position, Text, Hinweis, Art (`SurveyQuestionKind`), Pflicht; Skala: von/bis und Beschriftung der Enden; Freitext: mehrzeilig |
| `SurveyOption` | Antwortmöglichkeiten bei Einfach-/Mehrfachauswahl |
| `SurveyResponse` | eine ausgefüllte Runde; `voterKey` nur im Modus `COOKIE` (eindeutig pro Fragebogen), sonst leer |
| `SurveyAnswer` | Antwort auf eine Frage: gewählte Option (eine Zeile je Option), Text oder Zahl |

Fragearten: **Einfachauswahl** (Radiobuttons), **Mehrfachauswahl** (Checkboxen, optional höchstens n), **Freitext**
(einzeilig bis 300 Zeichen, mehrzeilig bis 2000), **lineare Skala** (von 0 oder 1 bis 2–10, Beschriftung links/rechts)
und **Raster** (wie in Nextcloud Forms, ergänzt 2026-10-14): Zeilen (Aussagen) mal Spalten (Antwortmöglichkeiten), je
Zeile eine oder mehrere Spalten. Zeilen und Spalten sind beide `SurveyOption` (`isRow`), eine Antwort trägt Zeile
(`rowId`) und Spalte (`optionId`). Pflicht heißt beim Raster: jede Zeile beantworten.

**Ergänzt 2026-10-14 für den UEQ-S:** *Skalen-Raster* (`SCALE_GRID`) - mehrere Zeilen mit derselben linearen Skala,
als Gegensatzpaar (linker/rechter Begriff, `SurveyOption.labelRight`) oder als Aussage; je Zeile ein Wert (`rowId`,
`number`). Ersetzt acht einzelne Skalen-Fragen durch einen Block, der wie der Papierbogen aussieht, und liefert in der
Auswertung Mittelwerte je Item und Skala, zentriert auf die Skalenmitte (bei 1-7: -3…+3 wie in der UEQ-Auswertung), im
CSV eine Spalte je Item. *Überschrift/Text* (`INFO`) gliedert den Fragebogen ohne Frage zu sein. *Titel ausblenden*
(`hideTitle`) lässt eine Frage an den Block davor anschließen - so ergeben die beiden UEQ-S-Skalen (pragmatisch,
hedonisch) unter einer gemeinsamen Anleitung einen Block, werden aber getrennt ausgewertet.

**Ausweich-Antwort (ergänzt 2026-10-14):** Ein Skalen-Raster kann je Zeile eine Antwort neben der Skala anbieten
(z.B. "nicht genutzt"). Vorher ging das nur als Raster mit einer Spalte "nicht genutzt" - dann gab es keine
Mittelwerte. Jetzt zählt die Ausweich-Antwort als beantwortet, aber nicht im Mittelwert, und wird getrennt gezählt.

**Nummern (überarbeitet 2026-10-14):** Zuerst zählten nur sichtbare Fragentitel. Das wirkte durcheinander: Die
UEQ-Überschrift sieht aus wie ein Fragentitel, hatte aber keine Nummer. Jetzt gilt eine Überschrift, auf die direkt
Fragen mit ausgeblendetem Titel folgen, als deren Titel und trägt die Nummer - die Gruppe zählt als eine Frage. Andere
Text-Blöcke (z.B. "Teil 2") bleiben ohne Nummer. Nummern lassen sich pro Fragebogen abschalten. Der Editor warnt, wenn
eine Frage ohne Titel an eine andere Frage anschließt (sähe sonst wie deren Teil aus).

**Raster am Handy:** Eine Tabelle mit fünf Spalten ist auf 360 px nicht bedienbar (winzige Ziele, waagrechtes
Scrollen, Spaltenköpfe außer Sicht). Deshalb wird unter `sm` jede Zeile ein Block – Aussage als Überschrift, Spalten als
umbrechende Knöpfe mit ihrem Namen (rund bei einer Antwort, eckig mit ✓ bei mehreren). Ab `sm` eine Tabelle mit
Spaltenköpfen und echten Radiobuttons/Checkboxen. Beide Ansichten nutzen dieselben Felder (nur CSS), damit nichts
doppelt abgeschickt wird und es ohne JavaScript geht. Jede Zeile ist eine eigene Gruppe (`radiogroup` bzw. `group`),
benannt nach der Aussage.

## Wer antworten darf

| Modus | Verhalten | Einbettung |
| --- | --- | --- |
| `ANONYMOUS` (Standard) | jede Abgabe ist eine neue Antwort, nichts im Browser gespeichert; gedrosselt pro IP und Fragebogen | überall |
| `COOKIE` | eine Antwort pro Gerät (Cookie `voter_token` wie bei Abstimmungen), änderbar bis zum Ende | nur direkt oder unter derselben Domain (`*.ramonroeser.de`) |

Hintergrund: In einem iFrame einer *anderen* Website (Campus-App) ist `voter_token` ein Drittanbieter-Cookie, das
Browser nicht mitschicken bzw. blockieren. Die eingebettete Seite prüft im Modus `COOKIE` deshalb im Browser, ob sie
ein Cookie setzen kann, und bietet sonst an, den Fragebogen in einem neuen Tab zu öffnen. Weitere Modi (persönliche
Links, rsvp-app, Konto) lassen sich später über `resolveVoter` anschließen – das ist der zweite Teil von L8.

## Einbetten

* `/fragebogen/<id>` – normale Seite mit Kopfzeile, `/fragebogen/<id>/einbetten` – ohne Kopf- und Fußzeile, mit
  transparentem Hintergrund, meldet ihre Höhe per `postMessage` (`{ type: 'abstimmungstool:hoehe', id, height }`) an
  die einbettende Seite.
* **Nur diese Route** darf in fremden Seiten erscheinen. `proxy.ts` setzt dort zur Laufzeit
  `frame-ancestors 'self' <EMBED_ALLOWED_ORIGINS>`; die allgemeine Regel in `next.config.ts` (`frame-ancestors 'none'`,
  `X-Frame-Options: DENY`) nimmt die Route aus. Laufzeit statt Build, weil die `.env` nicht im Docker-Image liegt.
  Ohne `EMBED_ALLOWED_ORIGINS` nur `'self'`.
* Die einbettende App braucht `frame-src` mit der Adresse des Tools in ihrer eigenen CSP.
* Die Verwaltung zeigt den fertigen iFrame-Schnipsel samt Skript für die Höhe.

## Verwaltung

Wie Live-Runden (`docs/KONZEPT-OBERFLAECHE.md`): Eintrag in „Abstimmungen“ mit eigener Themenmarke (indigo), Kopf
mit „Fragebogen öffnen ↗“ und „Jetzt schließen“/„Wieder öffnen“, Reiter **Übersicht** (Kennzahlen, Link, QR-Code,
Einbetten, Auswertung je Frage, CSV) und **Bearbeiten** (Grunddaten jederzeit; Fragen nur, solange es keine Antworten
gibt – sonst passten Antworten nicht mehr zu den Fragen. „Alle Antworten löschen“ gibt die Fragen wieder frei).

Auswertung: Auswahl als Anteil der Antwortenden der Frage, Skala als Verteilung mit Durchschnitt und Median,
Freitext als Liste. Ergebnisse sieht nur die Verwaltung.

## Schutz vor Manipulation (2026-10-14)

Vor dem Einsatz in der Campus-App (viele Informatik-Erstis) geprüft und gehärtet - Details und Tests im README
("Schutz vor Manipulation"). Anonyme Fragebögen lassen sich nie ganz gegen Mehrfach-Abgaben schützen; Ziel ist, es
Skripten schwer zu machen und Angriffe sichtbar und aufräumbar zu machen:

| Angriff | Gegenmaßnahme |
| --- | --- |
| Formular per Skript tausendfach abschicken | Einmal-Token (signiert, einmal verwendbar, Mindest-Ausfüllzeit), Lockfeld |
| Drosselung mit wechselnden IPv6-Adressen umgehen | zusätzliche Zählung je /64-Netz (zweistufig, damit ein Hörsaal im gemeinsamen /64 nicht gemeinsam gesperrt wird) |
| Grenze trifft echte Teilnehmende (volles Uni-WLAN) | Grenze je Fragebogen einstellbar (Standard 200/h), abgelehnte Abgaben werden gezählt und gemeldet |
| `X-Forwarded-For` fälschen | nur der letzte Eintrag zählt (vom Tunnel gesetzt), Container nur auf localhost |
| Riesige Anfragen | 512 KB Grenze vor der Verarbeitung |
| Fremde Options-IDs, Werte außerhalb der Skala, überlange Texte | serverseitig verworfen bzw. gekürzt |
| XSS, CSV-Injection über Freitexte | Ausgabe nur als Text, Formeln im CSV entschärft |
| Fremde Fragebögen über manipulierte Formularfelder ändern (IDOR) | Berechtigung je Aktion am Fragebogen selbst |
| Fragebogen auf fremden Seiten einbetten (Clickjacking) | `frame-ancestors` nur für erlaubte Seiten, Verwaltung nie einbettbar |
| Trotzdem durchgekommene Spam-Welle | Übersicht: identische Abgaben gruppiert, einzeln oder gruppenweise löschbar |

## Später

* Weitere Identitäten (L8 Teil 2): rsvp-app schickt nach dem Event den Link an Eingecheckte, Identität `RSVP`.
* Weitere Fragearten (Dropdown, Datum), bedingte Fragen, Fragen nachträglich ändern trotz Antworten.
