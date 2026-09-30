// scripts/generate-vapid-keys.js
// Erzeugt ein VAPID-Schlüsselpaar für Web-Push-Mitteilungen (siehe app/lib/push.ts und
// README "Push-Mitteilungen"). Die Ausgabe gehört in die .env - den privaten Schlüssel geheim
// halten. Ein Schlüsselwechsel macht alle bestehenden Abos ungültig (die Browser haben sie
// für den alten öffentlichen Schlüssel angelegt); danach muss jedes Gerät Mitteilungen neu
// einschalten.
//
// node scripts/generate-vapid-keys.js
const { createECDH } = require('node:crypto');

const ecdh = createECDH('prime256v1');
ecdh.generateKeys();
console.log(`VAPID_PUBLIC_KEY=${ecdh.getPublicKey().toString('base64url')}`);
// Auf 32 Byte auffüllen - eine führende Null würde sonst wegfallen, JWK verlangt genau 32.
const privateKey = ecdh.getPrivateKey();
console.log(`VAPID_PRIVATE_KEY=${Buffer.concat([Buffer.alloc(32 - privateKey.length), privateKey]).toString('base64url')}`);
console.log('VAPID_SUBJECT=mailto:deine-email@domain.de');
