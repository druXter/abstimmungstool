// auskunft.js
// Auskunft und Löschung zu einer E-Mail-Adresse (Art. 15 und 17 DSGVO, Idee Q8 der Suite, Regeln in
// suite-kit/docs/KONVENTIONEN.md „Datenschutz“). Läuft nur auf dem Server, es gibt keinen Endpunkt dafür.
//
//   node auskunft.js <adresse>                  alles zu dieser Adresse als JSON auf stdout
//   node auskunft.js <adresse> --loeschen       zeigt, was gelöscht würde - ändert nichts
//   node auskunft.js <adresse> --loeschen --ja  löscht
//
// Docker: docker compose exec -T abstimmungstool node auskunft.js anna@example.org
// Für alle Tools auf einmal: suite-kit/scripts/auskunft.sh
//
// Gefunden wird über die Adresse (ohne Groß-/Kleinschreibung): Verwaltungskonto, Stimmen mit dieser Adresse als
// Schlüssel (Modus EMAIL und RSVP - dort ist die Adresse auch der angezeigte Name), Bestätigungen (EmailVoter),
// persönliche Stimmlinks mit Adresse, Freigabelisten (allowedEmails) und alte Verwaltungslinks (creatorEmail).
// Löschen: Stimmen werden anonymisiert statt gelöscht (Schlüssel zufällig, ohne Namen) - so bleiben Ergebnisse und
// Beschlüsse, wie sie waren, aber niemand kann sie der Person mehr zuordnen. Bestätigungen werden gelöscht, die
// Adresse verschwindet aus Stimmlinks, Freigabelisten und Verwaltungslinks. Teilnehmendenkonten aus dem Verbund
// kennen hier keine Adresse (nur Kennung und Name) - sie findet das Skript in rsvp-app. Verwaltungskonten löscht es
// nie, nur einen Hinweis.
const { randomBytes } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');

const TOOL = 'abstimmungstool';
const prisma = new PrismaClient();

/** Technisches, das keine Auskunft braucht und nicht hinausgehört (Tokens, Hashes, Push-Schlüssel). */
const SECRET_KEYS = /(token|hash|secret)$|^p256dh$|^auth$|^endpoint$/i;
function clean(value) {
  if (Array.isArray(value)) return value.map(clean);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([key]) => !SECRET_KEYS.test(key)).map(([key, v]) => [key, clean(v)]));
  }
  return value;
}
const same = (a, b) => typeof a === 'string' && a.trim().toLowerCase() === b;
async function idsByEmail(model, email, fields = ['email']) {
  const rows = await model.findMany({ select: { id: true, ...Object.fromEntries(fields.map(f => [f, true])) } });
  return rows.filter(row => fields.some(f => same(row[f], email))).map(row => row.id);
}
const allowedLines = text => (text ?? '').split('\n');
/** Freigabeliste, auf die keine Adresse passt (.invalid ist reserviert, RFC 2606). */
const NOBODY = '@geloescht.invalid';

async function collect(email) {
  const users = await prisma.user.findMany({
    where: { id: { in: await idsByEmail(prisma.user, email) } },
    include: {
      identities: true,
      _count: { select: { ownedPolls: true, surveys: true, liveSessions: true, assemblies: true, sessions: true, pushSubscriptions: true } }
    }
  });
  const keys = [`email:${email}`, `rsvp:${email}`];
  const votes = (await prisma.vote.findMany({
    where: { OR: [{ voterKey: { startsWith: 'email:' } }, { voterKey: { startsWith: 'rsvp:' } }, { voterName: { not: null } }] },
    include: { poll: { select: { title: true } }, option: { select: { label: true } } }
  })).filter(v => keys.includes(v.voterKey.toLowerCase()) || same(v.voterName, email));
  const emailVoters = await prisma.emailVoter.findMany({
    where: { id: { in: await idsByEmail(prisma.emailVoter, email) } }, include: { poll: { select: { title: true } } }
  });
  const voterLinks = await prisma.voterLink.findMany({
    where: { id: { in: await idsByEmail(prisma.voterLink, email) } }, include: { poll: { select: { title: true } } }
  });
  const allowedIn = (await prisma.poll.findMany({ where: { allowedEmails: { not: null } }, select: { id: true, title: true, allowedEmails: true } }))
    .filter(p => allowedLines(p.allowedEmails).some(line => same(line, email)));
  const creatorOf = (await prisma.poll.findMany({ where: { creatorEmail: { not: null } }, select: { id: true, title: true, creatorEmail: true, createdAt: true } }))
    .filter(p => same(p.creatorEmail, email));
  return { users, votes, emailVoters, voterLinks, allowedIn, creatorOf };
}

async function main() {
  const [rawEmail, ...flags] = process.argv.slice(2);
  const email = (rawEmail ?? '').trim().toLowerCase();
  if (!email.includes('@')) {
    console.error('Aufruf: node auskunft.js <adresse> [--loeschen [--ja]]');
    process.exit(1);
  }
  const erase = flags.includes('--loeschen');
  const confirmed = flags.includes('--ja');
  const found = await collect(email);
  const hints = ['Teilnehmendenkonten (Abstimmen mit Konto aus rsvp-app) tragen hier keine Adresse - sie stehen in der Auskunft von rsvp-app.'];
  if (found.users.length) hints.push('Verwaltungskonto vorhanden: wird nicht automatisch gelöscht (daran hängen Abstimmungen). Löschen über „Konten“ einer Admin-Person.');

  if (!erase) {
    console.log(JSON.stringify({
      tool: TOOL, adresse: email, erstellt: new Date().toISOString(),
      daten: {
        verwaltungskonten: clean(found.users),
        stimmen: clean(found.votes.map(v => ({ abstimmung: v.poll.title, option: v.option.label, wert: v.value, art: v.identityKind, name: v.voterName, createdAt: v.createdAt }))),
        bestaetigungen: clean(found.emailVoters),
        stimmlinks: clean(found.voterLinks),
        freigabelisten: found.allowedIn.map(p => ({ abstimmung: p.title })),
        verwaltungslinks: clean(found.creatorOf.map(p => ({ abstimmung: p.title, createdAt: p.createdAt })))
      },
      hinweise: hints
    }, null, 2));
    return;
  }

  const plan = {
    stimmenAnonymisiert: found.votes.length,
    bestaetigungen: found.emailVoters.length,
    stimmlinksOhneAdresse: found.voterLinks.length,
    freigabelisten: found.allowedIn.length,
    verwaltungslinksOhneAdresse: found.creatorOf.length
  };
  if (confirmed) {
    // Eine Person = ein neuer Schlüssel je Abstimmung, damit Mehrfachauswahl und Teilnehmendenzahl stimmen
    const anonymous = new Map();
    const keyFor = pollId => anonymous.get(pollId) ?? anonymous.set(pollId, `geloescht:${randomBytes(16).toString('base64url')}`).get(pollId);
    await prisma.$transaction([
      ...found.votes.map(v => prisma.vote.update({ where: { id: v.id }, data: { voterKey: keyFor(v.pollId), voterName: null } })),
      prisma.emailVoter.deleteMany({ where: { id: { in: found.emailVoters.map(v => v.id) } } }),
      prisma.voterLink.updateMany({ where: { id: { in: found.voterLinks.map(l => l.id) } }, data: { email: null } }),
      // Leer hieße „jede Adresse“ - dann bleibt ein Eintrag, der auf niemanden passt
      ...found.allowedIn.map(p => prisma.poll.update({
        where: { id: p.id }, data: { allowedEmails: allowedLines(p.allowedEmails).filter(line => !same(line, email) && line.trim()).join('\n') || NOBODY }
      })),
      prisma.poll.updateMany({ where: { id: { in: found.creatorOf.map(p => p.id) } }, data: { creatorEmail: null } })
    ]);
  }
  console.log(JSON.stringify({ tool: TOOL, adresse: email, modus: confirmed ? 'geloescht' : 'probe', loeschen: plan, hinweise: hints }, null, 2));
}

main()
  .catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
