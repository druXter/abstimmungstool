// scripts/migrate-db.js
// Datenumzüge, die `npx prisma db push` allein nicht verlustfrei schafft. Es gibt keinen
// migrations-Ordner (siehe README "Setup"): Das Schema wird per `db push` abgeglichen, und
// das bricht ab, sobald dabei Spalten mit Daten wegfallen würden. Dieses Skript läuft
// deshalb VOR jedem `db push` (Dockerfile, README), zieht die Daten in die neuen Spalten
// um und entfernt die alten - `db push` erledigt danach nur noch den Rest (NOT NULL,
// Indizes), ohne dass Daten verloren gehen.
//
// Jeder Umzug prüft selbst, ob er nötig ist, und tut sonst nichts - das Skript darf also
// beliebig oft laufen, auch auf einer frischen, noch leeren Datenbank. Bevor ein Umzug
// etwas ändert, legt es eine Kopie der Datenbankdatei daneben (<datei>.vor-umzug-<zeit>).
//
// Lokal:  node scripts/migrate-db.js && npx prisma db push
// Docker: läuft automatisch beim Start des Containers (siehe Dockerfile)
//
// Nur rohe SQL-Befehle: Der generierte Prisma-Client kennt bereits das NEUE Schema und
// passt deshalb noch nicht zu einer Datenbank im alten Zustand.
const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

/** Pfad der SQLite-Datei aus DATABASE_URL. Relative Pfade löst Prisma relativ zu prisma/schema.prisma auf. */
function databaseFile() {
  const url = process.env.DATABASE_URL || '';
  if (!url.startsWith('file:')) return null;
  const file = url.slice('file:'.length).split('?')[0];
  return path.isAbsolute(file) ? file : path.resolve(__dirname, '..', 'prisma', file);
}

let backedUp = false;
function backupOnce() {
  if (backedUp) return;
  const file = databaseFile();
  if (!file || !fs.existsSync(file)) return;
  const target = `${file}.vor-umzug-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.copyFileSync(file, target);
  console.log(`Sicherung angelegt: ${target}`);
  backedUp = true;
}

async function columns(table) {
  const rows = await prisma.$queryRawUnsafe(`PRAGMA table_info("${table}")`);
  return new Set(rows.map(r => r.name));
}

// Umzug 1 (2026-09-30): Identitätsmodell verallgemeinert (TODO.md A0).
// Vote.voterToken/verifiedEmail -> Vote.identityKind + voterKey (+ voterName),
// Poll.requireRsvpVerification -> Poll.voterIdentity. Präfixe wie voterKey() in
// app/lib/voter-identity.ts.
async function voterIdentity() {
  const voteColumns = await columns('Vote');
  if (!voteColumns.has('voterToken')) return false;
  backupOnce();

  const pollColumns = await columns('Poll');
  await prisma.$transaction(async (tx) => {
    const run = (sql) => tx.$executeRawUnsafe(sql);

    if (!pollColumns.has('voterIdentity')) {
      await run(`ALTER TABLE "Poll" ADD COLUMN "voterIdentity" TEXT NOT NULL DEFAULT 'COOKIE'`);
    }
    if (pollColumns.has('requireRsvpVerification')) {
      await run(`UPDATE "Poll" SET "voterIdentity" = 'RSVP' WHERE "requireRsvpVerification" = 1`);
      await run(`ALTER TABLE "Poll" DROP COLUMN "requireRsvpVerification"`);
    }

    if (!voteColumns.has('identityKind')) await run(`ALTER TABLE "Vote" ADD COLUMN "identityKind" TEXT NOT NULL DEFAULT 'COOKIE'`);
    if (!voteColumns.has('voterKey')) await run(`ALTER TABLE "Vote" ADD COLUMN "voterKey" TEXT NOT NULL DEFAULT ''`);
    if (!voteColumns.has('voterName')) await run(`ALTER TABLE "Vote" ADD COLUMN "voterName" TEXT`);

    await run(`UPDATE "Vote" SET "identityKind" = 'COOKIE', "voterKey" = 'cookie:' || "voterToken" WHERE "voterToken" IS NOT NULL`);
    await run(`UPDATE "Vote" SET "identityKind" = 'RSVP', "voterKey" = 'rsvp:' || lower("verifiedEmail"), "voterName" = lower("verifiedEmail") WHERE "voterToken" IS NULL AND "verifiedEmail" IS NOT NULL`);
    // Zeilen ohne jede Identität kann es nach dem alten Code nicht geben - falls doch, wären sie
    // keiner Person zuzuordnen und würden die neue Eindeutigkeit verletzen.
    const orphaned = await run(`DELETE FROM "Vote" WHERE "voterKey" = ''`);
    if (orphaned > 0) console.log(`${orphaned} Stimme(n) ohne Identität entfernt.`);

    // SQLite kann Spalten nur löschen, wenn kein Index mehr an ihnen hängt.
    await run(`DROP INDEX IF EXISTS "Vote_pollId_voterToken_optionId_key"`);
    await run(`DROP INDEX IF EXISTS "Vote_pollId_verifiedEmail_optionId_key"`);
    await run(`ALTER TABLE "Vote" DROP COLUMN "voterToken"`);
    if (voteColumns.has('verifiedEmail')) await run(`ALTER TABLE "Vote" DROP COLUMN "verifiedEmail"`);
  });
  return true;
}

const MIGRATIONS = [
  ['Identitätsmodell (voterIdentity/voterKey)', voterIdentity]
];

async function main() {
  // Frische Datenbank ohne Tabellen: nichts umzuziehen, `db push` legt alles an.
  const tables = await prisma.$queryRawUnsafe(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'Vote'`);
  if (tables.length === 0) return;

  for (const [label, migrate] of MIGRATIONS) {
    if (await migrate()) console.log(`Umzug erledigt: ${label}`);
  }
}

main()
  .catch((error) => {
    console.error('Datenumzug fehlgeschlagen - die Datenbank ist unverändert (Transaktion), bitte nicht mit `db push --accept-data-loss` weitermachen:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
