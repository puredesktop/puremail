import type { MailSettings } from '../types'

/** Re-saving the same connector must retain its separately stored SMTP login. */
export function hasConnectionSmtpPassword(settings: MailSettings, profileId: string, replacement: string): boolean {
  return Boolean(replacement || settings.connectionProfiles?.find(profile => profile.id === profileId)?.hasSmtpPassword ||
    (settings.imapAccount?.active && settings.imapAccount.profileId === profileId && settings.imapAccount.hasSmtpPassword))
}

/** Removed accounts leave an inactive tombstone; it must not imply saved credentials. */
export function hasSavedMailConnection(settings: MailSettings, profileId: string): boolean {
  return Boolean(settings.connectionProfiles?.some(profile => profile.id === profileId) ||
    (settings.imapAccount?.active && settings.imapAccount.profileId === profileId))
}
