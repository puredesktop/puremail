import type { MailSettings } from '../types'
/** Persist only this window's edits, not stale values belonging to other windows. */
export function mailSettingsPatch(previous: MailSettings, next: MailSettings): Partial<MailSettings> {
  return Object.fromEntries(Object.entries(next).filter(([key,value]) =>
    JSON.stringify(value) !== JSON.stringify(previous[key as keyof MailSettings]),
  )) as Partial<MailSettings>
}
