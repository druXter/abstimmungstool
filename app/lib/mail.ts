// app/lib/mail.ts
import nodemailer from 'nodemailer'

// Gleicher Transporter-Aufbau wie in rsvp-app - falls beide Tools auf demselben
// Mailbox.org-Postfach laufen, deckt der dort bereits abgeschlossene AVV auch diesen
// zweiten, unabhängigen Versand ab (gleicher Auftragsverarbeiter, kein neuer Vertrag
// nötig). SMTP_HOST bewusst nicht vorausgesetzt: bleibt es leer, bricht sendMail()
// unten früh ab statt einen kaputten Transporter zu nutzen - das Feature ist rein
// optional (siehe Poll.creatorEmail).
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_PORT === '465',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
})

/**
 * Schickt dem Ersteller einer Abstimmung (Poll.creatorEmail) den privaten
 * Verwaltungs-Link zu - gleiches Prinzip wie bei vergleichbaren Umfrage-Tools:
 * kein Konto nötig, aber der Link geht nicht verloren, wenn man ihn nicht selbst
 * abspeichert. Wird einmalig direkt nach dem Anlegen aufgerufen (siehe createPoll
 * in app/actions.ts), nicht bei jeder späteren Bearbeitung erneut.
 */
export async function sendManagementLinkEmail(
  toEmail: string,
  pollTitle: string,
  managementLink: string,
  publicLink: string
): Promise<boolean> {
  if (!process.env.SMTP_HOST) return false // Kein Mailversand konfiguriert - Feature bleibt inaktiv

  const mailOptions = {
    from: process.env.SMTP_FROM,
    to: toEmail,
    subject: `Verwaltungs-Link für deine Abstimmung "${pollTitle}"`,
    text: `Hallo,

du hast gerade die Abstimmung "${pollTitle}" angelegt.

Mit diesem Link kannst du sie jederzeit bearbeiten, schließen oder löschen - bewahre ihn gut auf, er ist deine einzige Zugriffsmöglichkeit dafür:
${managementLink}

Link zum Teilen (zum Abstimmen):
${publicLink}

Viele Grüße`,
    html: `
      <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto;">
        <h2>Verwaltungs-Link für "${pollTitle}"</h2>
        <p>Du hast gerade diese Abstimmung angelegt. Mit dem folgenden Link kannst du sie jederzeit bearbeiten, schließen oder löschen - bewahre ihn gut auf, er ist deine einzige Zugriffsmöglichkeit dafür.</p>
        <p style="text-align: center; margin: 30px 0;">
          <a href="${managementLink}" style="display: inline-block; padding: 12px 24px; background-color: #2563eb; color: #fff; text-decoration: none; border-radius: 5px; font-weight: bold;">Abstimmung verwalten</a>
        </p>
        <p style="font-size: 12px; color: #666;">Falls der Button nicht funktioniert, kopiere diesen Link in deinen Browser:<br>${managementLink}</p>
        <p>Link zum Teilen (zum Abstimmen):<br><a href="${publicLink}">${publicLink}</a></p>
      </div>
    `,
    envelope: {
      from: process.env.SMTP_USER,
      to: toEmail
    }
  }

  try {
    await transporter.sendMail(mailOptions)
    return true
  } catch (error) {
    console.error(`Fehler beim Senden des Verwaltungs-Links an ${toEmail}:`, error)
    return false
  }
}
