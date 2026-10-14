'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { Prisma, type SurveyQuestionKind } from '@prisma/client'
import { prisma } from './lib/prisma'
import { getCurrentUser, requireUser } from './lib/auth'
import { canCreatePolls } from './lib/permissions'
import { formString, normalizeEmail } from './lib/form'
import { clientIp, reserve, surveyRules } from './lib/throttle'
import { getOrCreateVoterToken } from './lib/voter'
import { surveyLang, withLang } from './lib/survey-i18n'
import { checkFormToken, consumeFormToken, HONEYPOT_FIELD } from './lib/survey-token'
import {
  DEFAULT_SCALE, getSurveyLevel, MAX_SUBMIT_LIMIT, MIN_SUBMIT_LIMIT, isGrid, isQuestion, isSurveyOpen, MAX_INFO_TEXT_LENGTH, MAX_DESCRIPTION_LENGTH, MAX_GRID_COLUMNS, MAX_GRID_ROWS, MAX_HINT_LENGTH, MAX_OPTION_LENGTH, MAX_OPTIONS, MAX_QUESTION_LENGTH,
  MAX_QUESTIONS, MAX_SCALE_LABEL_LENGTH, MAX_THANKS_LENGTH, MAX_TITLE_LENGTH, MIN_OPTIONS, parseSurveyAnswers, SCALE_MAX_MAX, SCALE_MAX_MIN,
  SCALE_MINS, SURVEY_IDENTITIES, SURVEY_QUESTION_KINDS, surveyVoterKey, type SurveyLevel
} from './lib/survey'

type QuestionInput = {
  text: string
  hint: string | null
  kind: SurveyQuestionKind
  required: boolean
  hideTitle: boolean
  options: string[]
  /** Nur SINGLE/MULTI: Positionen der Antwortmöglichkeiten mit Textfeld ("Sonstiges: ___"). */
  optionsWithText: number[]
  /** Nur Raster und Skalen-Raster: die Zeilen (options sind beim Raster die Spalten), right = rechter Begriff eines Gegensatzpaars. */
  rows: { label: string; right: string | null }[]
  maxChoices: number | null
  multiline: boolean
  scaleMin: number | null
  scaleMax: number | null
  minLabel: string | null
  maxLabel: string | null
  optOutLabel: string | null
}

/**
 * Liest die Fragen aus dem Editor (app/fragebogen/questions-editor.tsx): s<i>_text, s<i>_hint,
 * s<i>_kind, s<i>_required, s<i>_hideTitle, bei Auswahl s<i>_o<j> und s<i>_max (höchstens n Kreuze), beim Raster
 * s<i>_r<j> (Zeilen) und s<i>_o<j> (Spalten), beim Skalen-Raster s<i>_r<j>/s<i>_rr<j> (Zeile, rechter Begriff),
 * bei Freitext s<i>_multiline, bei Skala und Skalen-Raster s<i>_from/s<i>_to/s<i>_fromLabel/s<i>_toLabel, beim
 * Skalen-Raster zusätzlich s<i>_optOut (Ausweich-Antwort).
 * Überschrift/Text-Blöcke (INFO) brauchen Überschrift oder Text. Fragen ohne Text fallen still weg, ebenso
 * Auswahlfragen mit weniger als zwei Optionen und Raster ohne Zeile oder mit weniger als zwei Spalten; doppelte
 * Einträge zählen einmal.
 */
function parseQuestions(formData: FormData): QuestionInput[] {
  const questions: QuestionInput[] = []
  for (let i = 0; i < MAX_QUESTIONS; i++) {
    const kind = SURVEY_QUESTION_KINDS.find(k => k === formData.get(`s${i}_kind`)) ?? 'SINGLE'
    const text = formString(formData, `s${i}_text`, MAX_QUESTION_LENGTH)
    const hint = formString(formData, `s${i}_hint`, kind === 'INFO' ? MAX_INFO_TEXT_LENGTH : MAX_HINT_LENGTH) || null
    if (kind === 'INFO') {
      if (text || hint) questions.push({ ...EMPTY_QUESTION, kind, text, hint })
      continue
    }
    if (!text) continue
    const grid = isGrid(kind)
    const scaled = kind === 'SCALE' || kind === 'SCALE_GRID'
    const labels = (prefix: string, max: number) => {
      const list: string[] = []
      for (let j = 0; j < max; j++) {
        const label = formString(formData, `s${i}_${prefix}${j}`, MAX_OPTION_LENGTH)
        if (label && !list.includes(label)) list.push(label)
      }
      return list
    }
    const options = kind === 'SINGLE' || kind === 'MULTI' ? labels('o', MAX_OPTIONS) : grid ? labels('o', MAX_GRID_COLUMNS) : []
    // Textfeld je Option (s<i>_t<j> am Eingabefeld s<i>_o<j>) - über das Label zugeordnet, weil leere Felder wegfallen.
    const withText = new Set<string>()
    if (kind === 'SINGLE' || kind === 'MULTI') {
      for (let j = 0; j < MAX_OPTIONS; j++) {
        if (formData.get(`s${i}_t${j}`) === 'on') withText.add(formString(formData, `s${i}_o${j}`, MAX_OPTION_LENGTH))
      }
    }
    const rows: QuestionInput['rows'] = []
    if (grid) rows.push(...labels('r', MAX_GRID_ROWS).map(label => ({ label, right: null })))
    if (kind === 'SCALE_GRID') {
      for (let j = 0; j < MAX_GRID_ROWS; j++) {
        const label = formString(formData, `s${i}_r${j}`, MAX_OPTION_LENGTH)
        const right = formString(formData, `s${i}_rr${j}`, MAX_OPTION_LENGTH) || null
        if (label && !rows.some(r => r.label === label && r.right === right)) rows.push({ label, right })
      }
    }
    if ((kind === 'SINGLE' || kind === 'MULTI' || grid) && options.length < MIN_OPTIONS) continue
    if ((grid || kind === 'SCALE_GRID') && rows.length === 0) continue
    const max = Number.parseInt(formString(formData, `s${i}_max`, 3), 10)
    const from = Number.parseInt(formString(formData, `s${i}_from`, 3), 10)
    const to = Number.parseInt(formString(formData, `s${i}_to`, 3), 10)
    questions.push({
      text,
      hint,
      kind,
      required: formData.get(`s${i}_required`) === 'on',
      hideTitle: formData.get(`s${i}_hideTitle`) === 'on',
      options,
      optionsWithText: options.flatMap((label, index) => (withText.has(label) ? [index] : [])),
      rows,
      // "höchstens alle" ist keine Grenze.
      maxChoices: kind === 'MULTI' && Number.isInteger(max) && max >= 1 && max < options.length ? max : null,
      multiline: kind === 'TEXT' && formData.get(`s${i}_multiline`) === 'on',
      scaleMin: scaled ? ((SCALE_MINS as readonly number[]).includes(from) ? from : DEFAULT_SCALE.min) : null,
      scaleMax: scaled ? (Number.isInteger(to) && to >= SCALE_MAX_MIN && to <= SCALE_MAX_MAX ? to : DEFAULT_SCALE.max) : null,
      minLabel: scaled ? formString(formData, `s${i}_fromLabel`, MAX_SCALE_LABEL_LENGTH) || null : null,
      maxLabel: scaled ? formString(formData, `s${i}_toLabel`, MAX_SCALE_LABEL_LENGTH) || null : null,
      optOutLabel: kind === 'SCALE_GRID' ? formString(formData, `s${i}_optOut`, MAX_SCALE_LABEL_LENGTH) || null : null
    })
  }
  return questions
}

const EMPTY_QUESTION: Omit<QuestionInput, 'kind' | 'text' | 'hint'> = {
  required: false, hideTitle: false, options: [], optionsWithText: [], rows: [], maxChoices: null, multiline: false, scaleMin: null, scaleMax: null, minLabel: null, maxLabel: null, optOutLabel: null
}

/** Mindestens eine echte Frage - nur Überschriften wären ein leerer Fragebogen. */
function hasQuestion(questions: QuestionInput[]): boolean {
  return questions.some(q => isQuestion(q.kind))
}

async function writeQuestions(tx: Prisma.TransactionClient, surveyId: string, questions: QuestionInput[]) {
  for (const [position, q] of questions.entries()) {
    await tx.surveyQuestion.create({
      data: {
        surveyId, position, text: q.text, hint: q.hint, kind: q.kind, required: q.required, hideTitle: q.hideTitle, maxChoices: q.maxChoices,
        multiline: q.multiline, scaleMin: q.scaleMin, scaleMax: q.scaleMax, minLabel: q.minLabel, maxLabel: q.maxLabel, optOutLabel: q.optOutLabel,
        options: {
          create: [
            ...q.options.map((label, index) => ({ position: index, label, allowText: q.optionsWithText.includes(index) })),
            ...q.rows.map((row, index) => ({ position: index, label: row.label, labelRight: row.right, isRow: true }))
          ]
        }
      }
    })
  }
}

/** Abgaben pro Stunde und Netz: 10 bis 5000, sonst bleibt der bisherige Wert. */
function parseSubmitLimit(formData: FormData, current: number): number {
  const value = Number.parseInt(formString(formData, 'submitLimit', 6), 10)
  return Number.isInteger(value) && value >= MIN_SUBMIT_LIMIT && value <= MAX_SUBMIT_LIMIT ? value : current
}

function parseIdentity(formData: FormData) {
  return SURVEY_IDENTITIES.find(i => i === formData.get('identity')) ?? 'ANONYMOUS'
}

function parseClosesAt(formData: FormData): Date | null {
  const input = formString(formData, 'closesAt', 30)
  const closesAt = input ? new Date(input) : null
  return closesAt && !Number.isNaN(closesAt.getTime()) ? closesAt : null
}

/** Der Fragebogen, wenn das eingeloggte Konto ihn mindestens auf `required` verwalten darf, sonst null. */
async function manageableSurvey(surveyId: string, required: SurveyLevel = 'moderator') {
  const survey = await prisma.survey.findUnique({ where: { id: surveyId } })
  if (!survey) return null
  const level = await getSurveyLevel(await getCurrentUser(), survey)
  if (!level || (required === 'owner' && level !== 'owner')) return null
  return survey
}

const manageUrl = (id: string, query = '') => `/fragebogen/${id}/verwalten${query ? `?${query}` : ''}`

export async function createSurvey(formData: FormData) {
  const user = await requireUser('/fragebogen/neu')
  if (!canCreatePolls(user)) return

  const title = formString(formData, 'title', MAX_TITLE_LENGTH)
  const questions = parseQuestions(formData)
  if (!title || !hasQuestion(questions)) redirect('/fragebogen/neu?fehler=leer')

  const survey = await prisma.$transaction(async tx => {
    const created = await tx.survey.create({
      data: { title, description: formString(formData, 'description', MAX_DESCRIPTION_LENGTH) || null, identity: parseIdentity(formData), ownerId: user.id }
    })
    await writeQuestions(tx, created.id, questions)
    return created
  }, { timeout: 20_000 })
  redirect(manageUrl(survey.id, 'angelegt=1'))
}

/**
 * Grunddaten jederzeit; Fragen und "wer darf antworten" nur, solange niemand geantwortet hat -
 * sonst passten gespeicherte Antworten nicht mehr zu den Fragen (bzw. stünden Antworten mit und
 * ohne Gerätebezug nebeneinander). Das Formular schickt die Fragen dann gar nicht erst mit.
 */
export async function updateSurvey(formData: FormData) {
  const survey = await manageableSurvey(formString(formData, 'surveyId', 50))
  if (!survey) return

  const title = formString(formData, 'title', MAX_TITLE_LENGTH)
  if (!title) redirect(`/fragebogen/${survey.id}/bearbeiten?fehler=titel`)
  const answered = (await prisma.surveyResponse.count({ where: { surveyId: survey.id } })) > 0
  const withQuestions = formData.get('withQuestions') === '1'
  if (withQuestions && answered) redirect(manageUrl(survey.id, 'fehler=beantwortet'))
  const questions = withQuestions ? parseQuestions(formData) : []
  if (withQuestions && !hasQuestion(questions)) redirect(`/fragebogen/${survey.id}/bearbeiten?fehler=leer`)

  await prisma.$transaction(async tx => {
    await tx.survey.update({
      where: { id: survey.id },
      data: {
        title,
        description: formString(formData, 'description', MAX_DESCRIPTION_LENGTH) || null,
        thanksText: formString(formData, 'thanksText', MAX_THANKS_LENGTH) || null,
        numbered: formData.get('numbered') === 'on',
        submitLimit: parseSubmitLimit(formData, survey.submitLimit),
        closesAt: parseClosesAt(formData),
        ...(answered ? {} : { identity: parseIdentity(formData) })
      }
    })
    if (withQuestions) {
      await tx.surveyQuestion.deleteMany({ where: { surveyId: survey.id } })
      await writeQuestions(tx, survey.id, questions)
    }
  }, { timeout: 20_000 })
  redirect(`/fragebogen/${survey.id}/bearbeiten?gespeichert=1`)
}

/**
 * Eine Abgabe (Seite /fragebogen/<id> oder eingebettet /fragebogen/<id>/einbetten, Feld `embed`). Braucht ein gültiges
 * Einmal-Token aus der Seite (formToken, app/lib/survey-token.ts); ein ausgefülltes Lockfeld wird still verworfen.
 * ANONYMOUS: immer eine neue Antwort, jede gedrosselt. COOKIE: eine Antwort pro Gerät
 * (voter_token), eine erneute Abgabe ersetzt die bisherige; gedrosselt wird nur die erste.
 */
export async function submitSurvey(formData: FormData): Promise<void> {
  const surveyId = formString(formData, 'surveyId', 50)
  const page = `/fragebogen/${surveyId}${formData.get('embed') === '1' ? '/einbetten' : ''}`
  // Rückmeldungen hängen ?hinweis=/?danke= an; ?lang=en bleibt dabei erhalten (Englisch aus der Campus-App).
  const lang = surveyLang(formData.get('lang'))
  const to = (query: string) => withLang(page, lang, query)
  const survey = await prisma.survey.findUnique({
    where: { id: surveyId },
    include: { questions: { orderBy: { position: 'asc' }, include: { options: { select: { id: true, isRow: true, allowText: true } } } } }
  })
  if (!survey) return
  if (!isSurveyOpen(survey)) redirect(to('hinweis=geschlossen'))

  // Schutz vor Skripten (app/lib/survey-token.ts): gültiges, frisches Einmal-Token aus der Seite, Mindest-Ausfüllzeit.
  const token = checkFormToken(survey.id, formData.get('formToken'))
  if (!token.ok) redirect(to(`hinweis=${token.reason}`))
  // Lockfeld ausgefüllt: ein Bot. Er bekommt dieselbe Antwort wie ein Mensch, gespeichert wird nichts.
  if (formString(formData, HONEYPOT_FIELD, 200)) {
    await consumeFormToken(token.nonce)
    redirect(to('danke=1'))
  }

  const parsed = parseSurveyAnswers(survey.questions, formData)
  if (!parsed.ok) redirect(to(`hinweis=${parsed.error}`))
  if (parsed.rows.length === 0) redirect(to('hinweis=leer'))

  // Erst jetzt verbrauchen: Eine abgelehnte Abgabe (Pflicht fehlt) lädt die Seite ohnehin mit neuem Token neu.
  if (!(await consumeFormToken(token.nonce))) redirect(to('hinweis=ungueltig'))

  // Ohne erkennbare IP (kein Proxy-Header) wird nicht gedrosselt - sonst teilten sich alle einen Zähler.
  const ip = await clientIp()
  const throttled = async () => {
    if (ip === 'unknown' || (await reserve(surveyRules(ip, survey.id, survey.submitLimit)))) return false
    // Mitzählen, damit die Verwaltung sieht, wenn die Grenze echte Teilnehmende trifft (z.B. ein voller Hörsaal).
    await prisma.survey.update({ where: { id: survey.id }, data: { throttledCount: { increment: 1 } } })
    return true
  }

  if (survey.identity === 'ANONYMOUS') {
    if (await throttled()) redirect(to('hinweis=gedrosselt'))
    await prisma.surveyResponse.create({ data: { surveyId: survey.id, answers: { create: parsed.rows } } })
  } else {
    const voterKey = surveyVoterKey(await getOrCreateVoterToken())
    const existing = await prisma.surveyResponse.findUnique({ where: { surveyId_voterKey: { surveyId: survey.id, voterKey } }, select: { id: true } })
    if (!existing && (await throttled())) redirect(to('hinweis=gedrosselt'))
    await prisma.$transaction(async tx => {
      // upsert statt create: Ein Doppelklick (zwei gleichzeitige erste Abgaben) ergibt trotzdem nur eine Antwort.
      const response = await tx.surveyResponse.upsert({
        where: { surveyId_voterKey: { surveyId: survey.id, voterKey } },
        create: { surveyId: survey.id, voterKey },
        update: { updatedAt: new Date() }
      })
      await tx.surveyAnswer.deleteMany({ where: { responseId: response.id } })
      await tx.surveyAnswer.createMany({ data: parsed.rows.map(row => ({ ...row, responseId: response.id })) })
    })
  }
  revalidatePath(manageUrl(survey.id))
  redirect(to('danke=1'))
}

export async function closeSurvey(formData: FormData) {
  const survey = await manageableSurvey(formString(formData, 'surveyId', 50))
  if (!survey) return
  await prisma.survey.update({ where: { id: survey.id }, data: { closedAt: new Date() } })
  revalidatePath(manageUrl(survey.id))
}

/** Wieder öffnen: auch ein schon abgelaufenes Schließdatum fällt weg, sonst wäre er sofort wieder zu. */
export async function reopenSurvey(formData: FormData) {
  const survey = await manageableSurvey(formString(formData, 'surveyId', 50))
  if (!survey) return
  await prisma.survey.update({
    where: { id: survey.id },
    data: { closedAt: null, ...(survey.closesAt && survey.closesAt <= new Date() ? { closesAt: null } : {}) }
  })
  revalidatePath(manageUrl(survey.id))
}

/** Alle Antworten löschen (danach lassen sich die Fragen wieder ändern). Nur Owner und Admins. */
export async function clearSurveyResponses(formData: FormData) {
  const survey = await manageableSurvey(formString(formData, 'surveyId', 50), 'owner')
  if (!survey) return
  await prisma.surveyResponse.deleteMany({ where: { surveyId: survey.id } })
  redirect(manageUrl(survey.id, 'geleert=1'))
}

/**
 * Einzelne Abgaben löschen (z.B. nach einem Spam-Angriff, auch alle identischen auf einmal). Nur Owner und Admins.
 * Es werden nur Abgaben DIESES Fragebogens gelöscht, auch wenn das Formular andere IDs mitschickt.
 */
export async function deleteSurveyResponses(formData: FormData) {
  const survey = await manageableSurvey(formString(formData, 'surveyId', 50), 'owner')
  if (!survey) return
  const ids = formData.getAll('responseId').filter((v): v is string => typeof v === 'string' && v.length <= 50).slice(0, 5000)
  const { count } = await prisma.surveyResponse.deleteMany({ where: { surveyId: survey.id, id: { in: ids } } })
  redirect(manageUrl(survey.id, `entfernt=${count}#antworten`))
}

export async function deleteSurvey(formData: FormData) {
  const survey = await manageableSurvey(formString(formData, 'surveyId', 50), 'owner')
  if (!survey) return
  await prisma.survey.delete({ where: { id: survey.id } })
  redirect('/meine-abstimmungen')
}

/** Mit einem bestehenden Konto teilen (wie shareLive). Nur Owner und Admins. */
export async function shareSurvey(formData: FormData) {
  const survey = await manageableSurvey(formString(formData, 'surveyId', 50), 'owner')
  if (!survey) return
  const email = normalizeEmail(formString(formData, 'email', 254))
  const target = email ? await prisma.user.findUnique({ where: { email }, select: { id: true } }) : null
  if (!target) redirect(manageUrl(survey.id, 'teilenFehler=unbekannt'))
  if (target.id === survey.ownerId) redirect(manageUrl(survey.id, 'teilenFehler=owner'))

  await prisma.surveyAccess.upsert({
    where: { surveyId_userId: { surveyId: survey.id, userId: target.id } },
    update: {},
    create: { surveyId: survey.id, userId: target.id }
  })
  redirect(manageUrl(survey.id, 'geteilt=1'))
}

export async function unshareSurvey(formData: FormData) {
  const access = await prisma.surveyAccess.findUnique({ where: { id: formString(formData, 'accessId', 50) } })
  if (!access) return
  const survey = await manageableSurvey(access.surveyId, 'owner')
  if (!survey) return
  await prisma.surveyAccess.delete({ where: { id: access.id } })
  revalidatePath(manageUrl(survey.id))
}
