// create-user.js
// Legt ein Konto an (oder setzt bei einem bestehenden das Passwort und die Rolle neu).
// Für das allererste Konto auf einem frischen Server, da es keine öffentliche
// Registrierung gibt - danach kannst du unter "Nutzer" weitere Konten einladen. Auch der
// einzige Weg, ein Administrator-Konto zu ändern (die Oberfläche schützt diese absichtlich).
//
// Das Passwort wird verdeckt abgefragt, damit es weder im Shell-Verlauf noch in der
// Prozessliste landet. (Nicht-interaktiv geht auch: PASSWORD=... node create-user.js ...)
//
// Lokal:  node create-user.js deine-email@domain.de [ADMIN|CREATOR|MODERATOR]
// Docker: docker compose run --rm abstimmungstool node create-user.js deine-email@domain.de ADMIN
const readline = require('node:readline');
const { randomBytes, scrypt } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const ROLES = ['ADMIN', 'CREATOR', 'MODERATOR'];
const MIN_PASSWORD_LENGTH = 10;

// Muss zum Format in app/lib/password.ts passen (scrypt$N$r$p$salt$hash). Die Parameter
// stehen im Hash selbst - die App liest sie von dort und schreibt beim nächsten Login
// einen neuen Hash, falls die dortigen Werte inzwischen höher sind.
function hashPassword(password) {
  const N = 2 ** 15, r = 8, p = 3, keyLength = 64;
  const salt = randomBytes(16);
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, { N, r, p, maxmem: 128 * 1024 * 1024 }, (error, key) => {
      if (error) return reject(error);
      resolve(`scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`);
    });
  });
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (text) => {
      // Die Frage selbst anzeigen, getippte Zeichen aber nicht.
      if (text.includes(question)) process.stdout.write(text);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function main() {
  const [, , emailArg, roleArg] = process.argv;
  const role = roleArg || 'CREATOR';
  if (!emailArg || !ROLES.includes(role)) {
    console.error(`Verwendung: node create-user.js <email> [${ROLES.join('|')}]`);
    process.exit(1);
  }
  const email = emailArg.trim().toLowerCase();

  const password = process.env.PASSWORD || (await askHidden('Passwort: '));
  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(`Das Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein.`);
    process.exit(1);
  }
  if (!process.env.PASSWORD && (await askHidden('Passwort wiederholen: ')) !== password) {
    console.error('Die Passwörter stimmen nicht überein.');
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.upsert({
    where: { email },
    // Ein offener Einladungs-/Reset-Link wird mit einem neu gesetzten Passwort überflüssig.
    update: { passwordHash, role, resetTokenHash: null, resetTokenExpiresAt: null },
    create: { email, passwordHash, role },
  });
  // Ein neues Passwort beendet alle bestehenden Sitzungen dieses Kontos.
  await prisma.session.deleteMany({ where: { userId: user.id } });

  console.log(`Konto bereit: ${user.email} (${user.role})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
