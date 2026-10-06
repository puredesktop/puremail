import type { MailSettings } from '../types'

/** Re-saving the same connector must retain its separately stored SMTP login. */
export function hasConnectionSmtpPassword(settings: MailSettings, profileId: string, replacement: string): boolean {
  return Boolean(replacement || settings.connectionProfiles?.find(profile => profile.id === profileId)?.hasSmtpPassword ||
    (settings.imapAccount?.profileId === profileId && settings.imapAccount.hasSmtpPassword))
}
