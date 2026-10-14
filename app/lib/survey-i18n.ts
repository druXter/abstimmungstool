/**
 * Feste Texte der Ausfüllseite eines Fragebogens auf Deutsch und Englisch (`?lang=en`, z.B. aus der zweisprachigen
 * Campus-App). Die Fragen selbst schreibt die Verwaltung und werden nicht übersetzt. Ohne Server-Abhängigkeiten, weil
 * auch Client-Komponenten sie brauchen. Englisch in britischer Schreibweise (wie die Campus-App).
 */

export type SurveyLang = 'de' | 'en'

export function surveyLang(value: unknown): SurveyLang {
  return value === 'en' ? 'en' : 'de'
}

/** Hängt `lang=en` an eine Adresse der Ausfüllseite an (Deutsch ist der Standard und braucht nichts). */
export function withLang(path: string, lang: SurveyLang, query = ''): string {
  const params = new URLSearchParams(query)
  if (lang === 'en') params.set('lang', 'en')
  const search = params.toString()
  return search ? `${path}?${search}` : path
}

const TEXTS = {
  de: {
    submit: 'Absenden',
    saveChanges: 'Änderungen speichern',
    required: 'Pflichtfrage',
    anonymous: 'Anonym, ohne Konto.',
    perDevice: 'Ohne Konto, eine Antwort pro Gerät.',
    privacy: 'Datenschutz',
    thanks: 'Danke!',
    thanksDefault: 'Deine Antworten sind angekommen.',
    viewOrChange: 'Antworten ansehen oder ändern',
    closed: 'Dieser Fragebogen ist beendet - Antworten sind nicht mehr möglich.',
    alreadyAnswered: 'Du hast schon geantwortet. Du kannst deine Antworten ändern, solange der Fragebogen läuft.',
    maxChoices: (n: number) => `Höchstens ${n} ankreuzen.`,
    multiple: 'Mehrere Antworten möglich.',
    gridMultiple: 'Pro Zeile mehrere Antworten möglich.',
    chooseOne: 'Bitte wähle mindestens eine Option.',
    chooseInRow: 'Bitte kreuze in dieser Zeile mindestens eine Antwort an.',
    otherPlaceholder: 'bitte angeben',
    otherLabel: (option: string) => `${option}: bitte angeben`,
    cookieBlocked: 'Hier kann jede Person nur einmal antworten. Dafür muss sich dein Browser das merken - in dieser App lässt er das nicht zu.',
    openInNewTab: 'Fragebogen in neuem Tab öffnen ↗',
    notices: {
      pflicht: 'Bitte beantworte alle Pflichtfragen - deine Antworten wurden nicht gespeichert.',
      auswahl: 'Bei einer Frage passt die Auswahl nicht (z.B. zu viele Kreuze) - deine Antworten wurden nicht gespeichert.',
      leer: 'Bitte beantworte mindestens eine Frage.',
      gedrosselt: 'Von deinem Netzwerk aus kamen in der letzten Stunde sehr viele Antworten. Bitte versuche es später noch einmal.',
      ungueltig: 'Das Formular ist abgelaufen oder wurde schon abgeschickt. Bitte fülle es noch einmal aus - deine Antworten wurden nicht gespeichert.',
      'zu-schnell': 'Das ging sehr schnell. Bitte nimm dir einen Moment für die Fragen und schicke das Formular dann noch einmal ab.'
    } as Record<string, string>,
    honeypot: 'Dieses Feld bitte leer lassen'
  },
  en: {
    submit: 'Submit',
    saveChanges: 'Save changes',
    required: 'Required',
    anonymous: 'Anonymous, no account needed.',
    perDevice: 'No account needed, one response per device.',
    privacy: 'Privacy (German)',
    thanks: 'Thank you!',
    thanksDefault: 'Your answers have been received.',
    viewOrChange: 'View or change your answers',
    closed: 'This questionnaire has closed - responses are no longer possible.',
    alreadyAnswered: 'You have already responded. You can change your answers while the questionnaire is open.',
    maxChoices: (n: number) => `Tick up to ${n}.`,
    multiple: 'You can choose more than one answer.',
    gridMultiple: 'You can choose more than one answer per row.',
    chooseOne: 'Please choose at least one option.',
    chooseInRow: 'Please tick at least one answer in this row.',
    otherPlaceholder: 'please specify',
    otherLabel: (option: string) => `${option}: please specify`,
    cookieBlocked: 'Each person can only respond once here. Your browser needs to remember that, but it does not allow this inside this app.',
    openInNewTab: 'Open questionnaire in a new tab ↗',
    notices: {
      pflicht: 'Please answer all required questions - your answers have not been saved.',
      auswahl: 'The selection for one question is not valid (e.g. too many ticks) - your answers have not been saved.',
      leer: 'Please answer at least one question.',
      gedrosselt: 'There have been a great many responses from your network in the last hour. Please try again later.',
      ungueltig: 'The form has expired or has already been submitted. Please fill it in again - your answers have not been saved.',
      'zu-schnell': 'That was very quick. Please take a moment to answer the questions and then submit the form again.'
    } as Record<string, string>,
    honeypot: 'Please leave this field empty'
  }
} satisfies Record<SurveyLang, unknown>

export type SurveyTexts = (typeof TEXTS)['de']

export function surveyTexts(lang: SurveyLang): SurveyTexts {
  return TEXTS[lang]
}
