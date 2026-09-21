// app/lib/suite.ts
import {
  loadSignersFromEnv,
  normalizeOrigin,
  parseIdpConfig,
  parseTrustedApps,
  type IdpConfig,
  type Signer
} from 'suite-kit'
import { baseUrl } from './base-url'

/**
 * Anbindung an die Konto-Föderation der App-Suite (siehe Paket suite-kit und README).
 * Alles hier ist OPTIONAL: Ohne SUITE_SIGNING_KEY stellt dieses Tool keine Logins für
 * andere Tools aus, ohne SUITE_IDPS nimmt es keine an - dann gibt es nicht einmal einen
 * Login-Button dafür, und das Tool arbeitet ausschließlich mit eigenen lokalen Konten.
 */

/** Origin dieses Tools (`iss`/`aud` in der ganzen Suite) - abgeleitet aus BASE_URL. */
export function selfOrigin(): string | null {
  return normalizeOrigin(baseUrl())
}

let signers: Signer[] | undefined
export function getSigners(): Signer[] {
  if (!signers) {
    try {
      signers = loadSignersFromEnv()
    } catch (error) {
      // Ein kaputter Schlüssel soll das eigenständige Tool nicht lahmlegen, sondern nur die
      // Föderation abschalten - dafür aber laut im Log, damit es auffällt.
      console.error('[suite] SUITE_SIGNING_KEY ungültig, Anmeldung für andere Tools ist deaktiviert:', (error as Error).message)
      signers = []
    }
  }
  return signers
}

let idps: IdpConfig[] | undefined
export function getIdps(): IdpConfig[] {
  return (idps ??= selfOrigin() ? parseIdpConfig(process.env.SUITE_IDPS) : [])
}

let trustedApps: string[] | undefined
export function getTrustedApps(): string[] {
  return (trustedApps ??= parseTrustedApps(process.env.SUITE_TRUSTED_APPS))
}

/** Kann dieses Tool Logins für andere Tools ausstellen? */
export function isProvider(): boolean {
  return !!selfOrigin() && getSigners().length > 0
}

/** Anzeigename in der Discovery und auf Login-Buttons anderer Tools. */
export function appName(): string {
  return process.env.SUITE_APP_NAME?.trim() || 'Abstimmungstool'
}

/** Beschriftung eines Anbieters auf dem Login-Button, ohne dafür das Netzwerk zu bemühen. */
export function idpLabel(idp: IdpConfig): string {
  return idp.label ?? new URL(idp.issuer).host
}

/**
 * Das Rollen-Mapping beim ERSTEN Login eines fremden Kontos (danach vergeben nur noch
 * lokale Admins Rollen). Rechte gibt der Empfänger, nie der Anbieter: Ein Admin des
 * Anbieters wird hier nur Admin, wenn der Anbieter ausdrücklich mit mapAdminRole
 * konfiguriert ist. Ein Moderator bleibt Moderator (kleinste Rechte), alles andere
 * bekommt die Standardrolle CREATOR.
 */
export function mapRole(idp: IdpConfig, remoteRole: string | undefined): 'ADMIN' | 'CREATOR' | 'MODERATOR' {
  if (remoteRole === 'ADMIN' && idp.mapAdminRole) return 'ADMIN'
  if (remoteRole === 'MODERATOR') return 'MODERATOR'
  return 'CREATOR'
}
