// app/datenschutz/page.tsx
import Link from 'next/link'

// ENTWURF: Beschreibt, was dieses Tool tatsächlich speichert und verarbeitet (Stand der
// Konten-/Föderations-Funktionen). Er ersetzt keine Rechtsberatung - vor dem Einsatz mit
// Externen bitte einmal juristisch/durch die Datenschutzbeauftragten prüfen lassen und
// bei jeder Änderung der Datenverarbeitung (neue Felder, neue Verbindungen zu anderen
// Tools der Suite, Speicherfristen) mitpflegen.
//
// Liest Verantwortlichen- und Infrastruktur-Angaben zur Laufzeit aus der (nicht
// versionierten) .env, analog zu app/impressum/page.tsx - force-dynamic verhindert, dass
// Next die Platzhalter beim Docker-Build dauerhaft in die statische HTML einbrennt.
export const dynamic = 'force-dynamic'

export default function DatenschutzPage() {
  const name = process.env.IMPRESSUM_NAME || '[Dein Vorname] [Dein Nachname]'
  const street = process.env.IMPRESSUM_STREET || '[Deine Straße und Hausnummer]'
  const zip = process.env.IMPRESSUM_ZIP || '[PLZ]'
  const city = process.env.IMPRESSUM_CITY || '[Ort]'
  const email = process.env.IMPRESSUM_EMAIL || '[Deine E-Mail-Adresse]'
  const phone = process.env.IMPRESSUM_PHONE || '[Deine Telefonnummer - Optional]'
  const smtpHost = process.env.SMTP_HOST || '[E-Mail-Server noch nicht konfiguriert]'

  return (
    <main className="bg-gray-50 py-8 px-4">
      <div className="max-w-3xl mx-auto bg-white p-8 rounded-lg shadow text-gray-800 space-y-6">
        <h1 className="text-3xl font-bold border-b pb-4">Datenschutzerklärung</h1>

        <div>
          <h2 className="font-bold text-lg">1. Verantwortlicher</h2>
          <p className="mt-2">
            Verantwortlicher im Sinne der Datenschutz-Grundverordnung (DSGVO) für die Datenverarbeitung auf dieser
            Website ist:
          </p>
          <p className="mt-2">
            {name}<br />
            {street}<br />
            {zip} {city}<br />
            E-Mail: {email}<br />
            Telefon: {phone}
          </p>
          <p className="mt-2 text-sm text-gray-600">
            Weitere Angaben findest du im <Link href="/impressum" className="underline">Impressum</Link>.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">2. Worum es geht</h2>
          <p className="mt-2">
            Mit dieser Anwendung lassen sich Abstimmungen in einer Gruppe durchführen (z.B. &quot;Wohin gehen wir am
            Mittwoch?&quot;). <strong>Zum Abstimmen brauchst du kein Konto.</strong> Ein Konto brauchen nur Personen, die
            Abstimmungen anlegen oder verwalten. Wir verarbeiten nur, was dafür nötig ist (Art. 6 Abs. 1 lit. b und f
            DSGVO - Durchführung der Abstimmung bzw. Betrieb und Sicherheit der Anwendung), und nur dann, wenn die
            jeweilige Funktion genutzt wird.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">3. Abstimmen (ohne Konto)</h2>
          <p className="mt-2">
            Beim Abstimmen speichern wir deine Auswahl und einen Zeitstempel. Damit du deine Auswahl später ändern
            kannst und nicht mehrfach im selben Browser abstimmst, legen wir in deinem Browser eine zufällige Kennung
            ab (Cookie <code>voter_token</code>, ein Jahr gültig). Sie enthält weder deinen Namen noch deine
            E-Mail-Adresse und ist nicht mit dir als Person verknüpft. Löschst du das Cookie, verlierst du den Bezug zu
            deiner bisherigen Stimme.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">4. Abstimmungen mit bestätigter Identität (optional)</h2>
          <p className="mt-2">
            Ersteller:innen können eine Abstimmung so einstellen, dass nur Personen abstimmen können, die über die
            Anwendung <em>rsvp-app</em> als zugesagt bestätigt sind (&quot;eine Stimme pro Person&quot;). Dann
            speichern wir statt der zufälligen Kennung die <strong>von rsvp-app bestätigte E-Mail-Adresse</strong>
            zusammen mit deiner Stimme. Hast du deine Zusage später zurückgezogen, meldet rsvp-app das, und deine
            Stimme wird entfernt.
          </p>
          <p className="mt-2">
            Die E-Mail-Adressen sehen die Ersteller:in und Personen mit Verwaltungs-Freigabe auf der Verwaltungsseite.
            Nur wenn die Ersteller:in die Option &quot;Abstimmende namentlich anzeigen&quot; aktiviert, sind sie auch
            auf der öffentlichen Ergebnisseite sichtbar. Die Abstimmungsseite weist dich darauf hin.
          </p>
          <p className="mt-2">
            Schließt sich eine solche Abstimmung, melden wir das Ergebnis (Titel der Abstimmung, Gewinner-Optionen,
            Stimmenzahl) an rsvp-app zurück. Personenbezogene Daten sind darin nicht enthalten.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">5. Konto (Anlegen und Verwalten von Abstimmungen)</h2>
          <p className="mt-2">Für ein Konto speichern wir:</p>
          <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
            <li>E-Mail-Adresse, optional einen Namen, deine Rolle und den Zeitpunkt der Anlage,</li>
            <li>
              dein Passwort ausschließlich als <strong>Hash</strong> (scrypt) - niemals im Klartext. Konten, die nur über
              ein anderes Tool angemeldet werden (Punkt 6), haben gar kein Passwort bei uns,
            </li>
            <li>
              deine Anmelde-Sitzungen (nur ein Hash des Sitzungs-Tokens und das Ablaufdatum, 30 Tage) sowie
              Einmal-Links für Einladung und Passwort-Reset (ebenfalls nur als Hash, befristet),
            </li>
            <li>die Zuordnung deiner Abstimmungen zu deinem Konto und Freigaben, die du erteilt hast oder erhalten hast.</li>
          </ul>
          <p className="mt-2">
            Konten werden nicht öffentlich registriert, sondern von einer berechtigten Person eingeladen oder entstehen
            durch die Anmeldung mit einem Konto eines anderen Tools (Punkt 6).
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">6. Anmeldung mit dem Konto eines anderen Tools (optional)</h2>
          <p className="mt-2">
            Ist dies vom Betreiber eingerichtet, kannst du dich hier mit einem Konto eines verbundenen Tools anmelden
            (z.B. rsvp-app), und umgekehrt kann man sich dort mit einem Konto von hier anmelden. Das geschieht{' '}
            <strong>nur, wenn du es aktiv anstößt</strong>, und nur zwischen Tools, die der Betreiber ausdrücklich
            freigegeben hat.
          </p>
          <p className="mt-2">
            Dabei übermittelt das Tool, bei dem du angemeldet bist, an das andere Tool eine kurz gültige (etwa eine
            Minute), digital signierte Bestätigung mit <strong>deiner Konto-Kennung, E-Mail-Adresse, ggf. deinem
            Namen und deiner Rolle</strong>. Dein Passwort und deine Sitzung werden nie übermittelt. Das empfangende
            Tool legt beim ersten Mal ein Konto (ohne Passwort) für dich an und merkt sich die Verknüpfung; du kannst
            sie unter &quot;Konto&quot; jederzeit wieder entfernen.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">7. Schutz vor Missbrauch (Login-Drosselung)</h2>
          <p className="mt-2">
            Um das Erraten von Passwörtern und das massenhafte Auslösen von Mails zu verhindern, zählen wir
            fehlgeschlagene Anmeldeversuche und Passwort-Reset-Anfragen. Dazu wird deine{' '}
            <strong>IP-Adresse</strong> ausgelesen und zusammen mit der eingegebenen E-Mail-Adresse{' '}
            <strong>nur als nicht umkehrbarer Hash</strong> für ein kurzes Zeitfenster (15 Minuten bzw. 1 Stunde)
            gespeichert; veraltete Zähler werden nach spätestens 24 Stunden entfernt. Rechtsgrundlage ist unser
            berechtigtes Interesse an der Sicherheit der Anwendung (Art. 6 Abs. 1 lit. f DSGVO).
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">8. E-Mails</h2>
          <p className="mt-2">
            Wir verschicken E-Mails nur für Kontofunktionen: die Einladung zu einem neuen Konto und den auf Wunsch
            angeforderten Passwort-Reset. Werbung oder Newsletter gibt es nicht.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">9. Cookies</h2>
          <p className="mt-2">
            Wir setzen ausschließlich technisch notwendige Cookies ein (Art. 6 Abs. 1 lit. b/f DSGVO, § 25 Abs. 2 Nr. 2
            TTDSG) - eine Einwilligung ist dafür nicht erforderlich. Es gibt keine Tracking-, Analyse- oder
            Marketing-Cookies.
          </p>
          <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
            <li><code>voter_token</code> - zufällige Kennung für deine Stimme (1 Jahr)</li>
            <li><code>__Host-session</code> - Anmeldung an deinem Konto (30 Tage)</li>
            <li><code>__Host-suite-state</code> - nur während der Anmeldung über ein anderes Tool (10 Minuten)</li>
            <li><code>invite_link</code> - nur kurz (2 Minuten), wenn ein Konto einen Einladungslink zum Weitergeben angezeigt bekommt</li>
          </ul>
        </div>

        <div>
          <h2 className="font-bold text-lg">10. Empfänger und Auftragsverarbeiter</h2>
          <p className="mt-2">
            <strong>E-Mail-Versand:</strong> Einladungs- und Passwort-Reset-Mails versenden wir über den
            E-Mail-Server <code>{smtpHost}</code>. Mit dem Betreiber dieses Servers besteht, soweit es sich um einen
            externen Anbieter handelt, ein Vertrag zur Auftragsverarbeitung nach Art. 28 DSGVO.
          </p>
          <p className="mt-2">
            <strong>Verbundene Tools:</strong> Die in Punkt 4 und 6 beschriebene Übermittlung erfolgt nur an Tools, die
            der Betreiber selbst betreibt und freigegeben hat.
          </p>
          <p className="mt-2">
            <strong>Hosting:</strong> Diese Anwendung wird auf einem vom Verantwortlichen selbst betriebenen und
            administrierten Server gehostet. Es findet keine Weitergabe der Daten an einen externen Hosting-Anbieter
            statt.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">11. Speicherdauer</h2>
          <p className="mt-2">
            Abstimmungen samt Optionen, Stimmen und Freigaben werden spätestens{' '}
            <strong>18 Monate, nachdem sie zu Ende gegangen sind</strong>, automatisch vollständig gelöscht
            (maßgeblich ist der Zeitpunkt des Schließens; eine nie geschlossene Abstimmung ohne Frist zählt ab ihrer
            Anlage). Die Ersteller:in kann sie jederzeit früher selbst löschen.
          </p>
          <p className="mt-2">
            Ein Konto wird automatisch gelöscht, wenn du dich <strong>2 Jahre</strong> lang nicht mehr angemeldet
            hast und dir keine Abstimmung mehr gehört - inklusive Sitzungen, Verknüpfungen zu anderen Tools und
            Freigaben. Administrator-Konten sind von dieser automatischen Löschung ausgenommen. Unabhängig davon kannst
            du jederzeit unter der oben genannten Adresse um frühere Löschung deines Kontos bitten; seine Abstimmungen
            gehen dann an einen Administrator über, damit die Stimmen anderer Personen nicht stillschweigend ohne
            Besitzer bleiben.
          </p>
          <p className="mt-2">
            Sitzungen laufen nach 30 Tagen ab, Einladungs- und Reset-Links nach 7 Tagen bzw. 1 Stunde und werden dann
            entfernt. Drossel-Zähler siehe Punkt 7.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">12. Deine Rechte</h2>
          <p className="mt-2">
            Du hast das Recht auf Auskunft (Art. 15 DSGVO), Berichtigung (Art. 16 DSGVO), Löschung (Art. 17 DSGVO),
            Einschränkung der Verarbeitung (Art. 18 DSGVO), Datenübertragbarkeit (Art. 20 DSGVO) und Widerspruch (Art.
            21 DSGVO). Bitte kontaktiere uns dafür über die oben genannte Adresse. Dein Passwort kannst du jederzeit
            unter &quot;Konto&quot; selbst ändern.
          </p>
          <p className="mt-2">
            Unabhängig davon hast du das Recht, dich bei einer Datenschutz-Aufsichtsbehörde zu beschweren, wenn du der
            Ansicht bist, dass die Verarbeitung deiner Daten gegen die DSGVO verstößt.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">13. Datensicherheit</h2>
          <p className="mt-2">
            Die Übertragung erfolgt verschlüsselt (TLS/HTTPS). Anmelde-Cookies sind <code>httpOnly</code> gesetzt und
            damit per JavaScript nicht auslesbar. Passwörter, Sitzungs-Tokens und Einmal-Links werden nur als Hash
            gespeichert, sodass eine Kopie der Datenbank allein keinen Zugang zu Konten ermöglicht.
          </p>
        </div>

        <div className="pt-6 border-t">
          <Link href="/" className="text-blue-600 hover:underline">
            &larr; Zurück zur Startseite
          </Link>
        </div>
      </div>
    </main>
  )
}
