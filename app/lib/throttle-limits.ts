/** Grenzen einer IP-Regel: je einzelner IPv6-Adresse und je Netz (IPv4-Adresse bzw. IPv6-/64), siehe ipRules in throttle.ts. */
export type IpLimits = { address: number; network: number }

/**
 * Grenzen aller IP-Regeln (siehe ipRules): `address` je einzelner IPv6-Adresse, `network` je IPv4-Adresse bzw.
 * IPv6-/64. Die Netz-Grenzen sind so bemessen, dass ein voller Hörsaal hinter einem NAT bzw. in einem gemeinsamen
 * /64 nicht gesperrt wird; Erfolge geben ihren Versuch zurück, wo nur Fehlversuche zählen sollen (Login, PIN, Code).
 */
export const IP_LIMITS = {
  login: { address: 20, network: 60 },
  reset: { address: 10, network: 30 },
  newVoter: { address: 30, network: 200 },
  accessCode: { address: 10, network: 50 },
  voteMail: { address: 20, network: 100 },
  suggestion: { address: 10, network: 50 },
  livePin: { address: 30, network: 100 },
  liveJoin: { address: 30, network: 200 },
  /** Fragebogen: Netz-Grenze je Fragebogen einstellbar (Survey.submitLimit), Standard 200. */
  survey: { address: 30, network: 200 }
} satisfies Record<string, IpLimits>
