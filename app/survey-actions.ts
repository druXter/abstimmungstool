'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { Prisma, type SurveyQuestionKind } from '@prisma/client'
import { prisma } from './lib/prisma'
import { getCurrentUser, requireUser } from './lib/auth'
import { canCreatePolls } from './lib/permissions'
import { formString, normalizeEmail } from './lib/form'
import { clientIp, reserve, surveyRule } from './lib/throttle'
import { getOrCreateVoterToken } from './lib/voter'
import {
  DEFAULT_SCALE, getSurveyLevel, isSurveyOpen, MAX_DESCRIPTION_LENGTH, MAX_HINT_LENGTH, MAX_OPTION_LENGTH, MAX_OPTIONS, MAX_QUESTION_LENGTH,
  MAX_QUESTIONS, MAX_SCALE_LABEL_LENGTH, MAX_THANKS_LENGTH, MAX_TITLE_LENGTH, MIN_OPTIONS, parseSurveyAnswers, SCALE_MAX_MAX, SCALE_MAX_MIN,
  SCALE_MINS, SURVEY_IDENTITIES, SURVEY_QUESTION_KINDS, surveyVoterKey, type SurveyLevel
} from './lib/survey'

type QuestionInput = {
  text: string
  hint: string | null
  kind: SurveyQuestionKind
  required: boolean
  options: string[]
  maxChoices: number | null
  multiline: boolean
  scaleMin: number | null
  scaleMax: number | null
  minLabel: string | null
  maxLabel: string | null
}

/**
 * Liest die Fragen aus dem Editor (app/fragebogen/questions-editor.tsx): s<i>_text, s<i>_hint,
 * s<i>_kind, s<i>_required, bei Auswahl s<i>_o<j> und s<i>_max (höchstens n Kreuze), bei Freitext
 * s<i>_multiline, bei der Skala s<i>_from/s<i>_to/s<i>_fromLabel/s<i>_toLabel. Fragen ohne Text
 * fallen still weg, ebenso Auswahlfragen mit weniger als zwei Optionen; doppelte Optionen zählen einmal.
 */
function parseQuestions(formData: FormData): QuestionInput[] {
  const questions: QuestionInput[] = []
  for (let i = 0; i < MAX_QUESTIONS; i++) {
    const text = formString(formData, `s${i}_text`, MAX_QUESTION_LENGTH)
    if (!text) continue
    const kind = SURVEY_QUESTION_KINDS.find(k => k === formData.get(`s${i}_kind`)) ?? 'SINGLE'
    const choice = kind === 'SINGLE' || kind === 'MULTI'
    const options: string[] = []
    if (choice) {
      for (let j = 0; j < MAX_OPTIONS; j++) {
        const label = formString(formData, `s${i}_o${j}`, MAX_OPTION_LENGTH)
        if (label && !options.includes(label)) options.push(label)
      }
      if (options.length < MIN_OPTIONS) continue
    }
    const max = Number.parseInt(formString(formData, `s${i}_max`, 3), 10)
    const from = Number.parseInt(formString(formData, `s${i}_from`, 3), 10)
    const to = Number.parseInt(formString(formData, `s${i}_to`, 3), 10)
    questions.push({
      text,
      hint: formString(formData, `s${i}_hint`, MAX_HINT_LENGTH) || null,
      kind,
      required: formData.get(`s${i}_required`) === 'on',
      options,
      // "höchstens alle" ist keine Grenze.
      maxChoices: kind === 'MULTI' && Number.isInteger(max) && max >= 1 && max < options.length ? max : null,
      multiline: kind === 'TEXT' && formData.get(`s${i}_multiline`) === 'on',
      scaleMin: kind === 'SCALE' ? ((SCALE_MINS as readonly number[]).includes(from) ? from : DEFAULT_SCALE.min) : null,
      scaleMax: kind === 'SCALE' ? (Number.isInteger(to) && to >= SCALE_MAX_MIN && to <= SCALE_MAX_MAX ? to : DEFAULT_SCALE.max) : null,
      minLabel: kind === 'SCALE' ? formString(formData, `s${i}_fromLabel`, MAX_SCALE_LABEL_LENGTH) || null : null,
      maxLabel: kind === 'SCALE' ? formString(formData, `s${i}_toLabel`, MAX_SCALE_LABEL_LENGTH) || null : null
    })
  }
  return questions
}

async function writeQuestions(tx: Prisma.TransactionClient, surveyId: string, questions: QuestionInput[]) {
  for (const [position, q] of questions.entries()) {
    await tx.surveyQuestion.create({
      data: {
        surveyId, position, text: q.text, hint: q.hint, kind: q.kind, required: q.required, maxChoices: q.maxChoices, multiline: q.multiline,
        scaleMin: q.scaleMin, scaleMax: q.scaleMax, minLabel: q.minLabel, maxLabel: q.maxLabel,
        options: { create: q.options.map((label, index) => ({ position: index, label })) }
      }
    })
  }
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
  if (!title || questions.length === 0) redirect('/fragebogen/neu?fehler=leer')

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
  if (withQuestions && questions.length === 0) redirect(`/fragebogen/${survey.id}/bearbeiten?fehler=leer`)

  await prisma.$transaction(async tx => {
    await tx.survey.update({
      where: { id: survey.id },
      data: {
        title,
        description: formString(formData, 'description', MAX_DESCRIPTION_LENGTH) || null,
        thanksText: formString(formData, 'thanksText', MAX_THANKS_LENGTH) || null,
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
 * Eine Abgabe (Seite /fragebogen/<id> oder eingebettet /fragebogen/<id>/einbetten, Feld `embed`).
 * ANONYMOUS: immer eine neue Antwort, jede gedrosselt. COOKIE: eine Antwort pro Gerät
 * (voter_token), eine erneute Abgabe ersetzt die bisherige; gedrosselt wird nur die erste.
 */
export async function submitSurvey(formData: FormData): Promise<void> {
  const surveyId = formString(formData, 'surveyId', 50)
  const base = `/fragebogen/${surveyId}${formData.get('embed') === '1' ? '/einbetten' : ''}`
  const survey = await prisma.survey.findUnique({
    where: { id: surveyId },
    include: { questions: { orderBy: { position: 'asc' }, include: { options: { select: { id: true } } } } }
  })
  if (!survey) return
  if (!isSurveyOpen(survey)) redirect(`${base}?hinweis=geschlossen`)

  const parsed = parseSurveyAnswers(survey.questions, formData)
  if (!parsed.ok) redirect(`${base}?hinweis=${parsed.error}`)
  if (parsed.rows.length === 0) redirect(`${base}?hinweis=leer`)

  // Ohne erkennbare IP (kein Proxy-Header) wird nicht gedrosselt - sonst teilten sich alle einen Zähler.
  const ip = await clientIp()
  const throttled = async () => ip !== 'unknown' && !(await reserve([surveyRule(ip, survey.id)]))

  if (survey.identity === 'ANONYMOUS') {
    if (await throttled()) redirect(`${base}?hinweis=gedrosselt`)
    await prisma.surveyResponse.create({ data: { surveyId: survey.id, answers: { create: parsed.rows } } })
  } else {
    const voterKey = surveyVoterKey(await getOrCreateVoterToken())
    const existing = await prisma.surveyResponse.findUnique({ where: { surveyId_voterKey: { surveyId: survey.id, voterKey } }, select: { id: true } })
    if (!existing && (await throttled())) redirect(`${base}?hinweis=gedrosselt`)
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
  redirect(`${base}?danke=1`)
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
