// Schmale Typen für das Test-Hilfspaket http_ece (keine eigenen Typen vorhanden) - nur das,
// was tests/e2e/push.spec.ts zum Entschlüsseln nach RFC 8291 braucht.
declare module 'http_ece' {
  import type { ECDH } from 'node:crypto'
  const ece: {
    decrypt(buffer: Buffer, params: { version: 'aes128gcm'; privateKey: ECDH; authSecret: Buffer }): Buffer
  }
  export default ece
}
