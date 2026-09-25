import type { MailProvider, MailProviderCapabilities } from '../types'

/**
 * Capability gate for UI features. A provider without a capability map, or
 * without the specific flag, does NOT support the feature — undefined is
 * false, so demo/IMAP providers degrade gracefully instead of surfacing
 * actions the provider cannot honour.
 */
export function mailProviderSupports(
  provider: Pick<MailProvider, 'capabilities'> | null | undefined,
  capability: keyof MailProviderCapabilities,
): boolean {
  return provider?.capabilities?.[capability] === true
}
