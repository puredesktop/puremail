import { readPlatformStorageJson } from '../bridge/platformBridge'

export interface CalendarSchedulingLinkSummary {
  id: string
  kind: 'booking' | 'oneoff' | 'poll'
  title: string
  url: string
  durations: number[]
  defaultDuration: number
  active: boolean
  localOnly?: boolean
}

export interface CalendarSchedulingCatalog {
  updatedAt: string
  timeZone: string
  cloudConnected: boolean
  links: CalendarSchedulingLinkSummary[]
  upcomingFreeSlots: Array<{ start: string; end: string }>
}

export const MAIL_RECIPIENT_ZONES = [
  { timeZone: 'America/Los_Angeles', label: 'San Francisco / LA (PT)', code: 'PT' },
  { timeZone: 'America/Denver', label: 'Denver (MT)', code: 'MT' },
  { timeZone: 'America/Chicago', label: 'Chicago / Austin (CT)', code: 'CT' },
  { timeZone: 'America/New_York', label: 'New York / Boston (ET)', code: 'ET' },
  { timeZone: 'Europe/London', label: 'London (UK)', code: 'LDN' },
  { timeZone: 'Europe/Berlin', label: 'Berlin / Paris / Zurich (CET)', code: 'CET' },
  { timeZone: 'Asia/Dubai', label: 'Dubai (GST)', code: 'DXB' },
  { timeZone: 'Asia/Kolkata', label: 'Bengaluru / Mumbai (IST)', code: 'IST' },
  { timeZone: 'Asia/Singapore', label: 'Singapore (SGT)', code: 'SIN' },
  { timeZone: 'Asia/Tokyo', label: 'Tokyo (JST)', code: 'TYO' },
  { timeZone: 'Australia/Sydney', label: 'Sydney / Melbourne (AET)', code: 'SYD' },
  { timeZone: 'Pacific/Auckland', label: 'Auckland (NZT)', code: 'AKL' },
  { timeZone: 'UTC', label: 'UTC', code: 'UTC' },
] as const

export async function readCalendarSchedulingCatalog(): Promise<CalendarSchedulingCatalog | null> {
  try {
    const res = await readPlatformStorageJson({
      appSlug: 'calendar',
      fileName: 'scheduling-catalog.json',
    })
    const value = res?.value as Partial<CalendarSchedulingCatalog> | null | undefined
    if (!value || typeof value !== 'object') return null
    return {
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '',
      timeZone: typeof value.timeZone === 'string' ? value.timeZone : localTimeZone(),
      cloudConnected: Boolean(value.cloudConnected),
      links: Array.isArray(value.links) ? value.links : [],
      upcomingFreeSlots: Array.isArray(value.upcomingFreeSlots) ? value.upcomingFreeSlots : [],
    }
  } catch {
    return null
  }
}

export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

function isValidTz(tz: string | undefined): tz is string {
  if (!tz) return false
  try {
    Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

function dateKeyInTz(iso: string, tz: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date(iso))
      .map(p => [p.type, p.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day}`
}

function shortOffset(iso: string, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(
    new Date(iso),
  )
  return parts.find(p => p.type === 'timeZoneName')?.value || tz
}

function formatSlotInTz(startIso: string, endIso: string, tz: string): string {
  const start = new Date(startIso)
  const end = new Date(endIso)
  const day = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' }).format(start)
  const fmt = (d: Date) => new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(d)
  return `${day}, ${fmt(start)}–${fmt(end)} (${shortOffset(startIso, tz)})`
}

/** Format selected free slots for pasting into an email, optionally side-by-side in recipient's timezone. */
export function formatMailAvailabilitySnippet(input: {
  slots: Array<{ start: string; end: string }>
  hostTimeZone: string
  recipientTimeZone?: string
  bookingUrl?: string
}): string {
  const hostTz = isValidTz(input.hostTimeZone) ? input.hostTimeZone : localTimeZone()
  const guestTz = isValidTz(input.recipientTimeZone) && input.recipientTimeZone !== hostTz ? input.recipientTimeZone : null
  const lines: string[] = ['Here are a few times that work on my end:', '']
  for (const slot of input.slots) {
    const mine = formatSlotInTz(slot.start, slot.end, hostTz)
    if (guestTz) {
      const theirs = formatSlotInTz(slot.start, slot.end, guestTz)
      lines.push(`• ${theirs} [${guestTz}]  /  ${mine}`)
    } else {
      lines.push(`• ${mine}`)
    }
  }
  if (input.bookingUrl) {
    lines.push('')
    lines.push(`Or pick any open slot directly (auto-converts to your timezone): ${input.bookingUrl}`)
  }
  return lines.join('\n')
}

/** Format an inbound calendar invite showing local time AND original timezone when they differ. */
export function formatInviteMultiZoneSummary(input: {
  startsAt: string
  endsAt: string
  inviteTimeZone?: string
  viewerTimeZone?: string
}): { primary: string; secondary: string | null } {
  const viewerTz = isValidTz(input.viewerTimeZone) ? input.viewerTimeZone : localTimeZone()
  const inviteTz = isValidTz(input.inviteTimeZone) ? input.inviteTimeZone : null
  const start = new Date(input.startsAt)
  const end = new Date(input.endsAt)
  const sameDay = dateKeyInTz(input.startsAt, viewerTz) === dateKeyInTz(input.endsAt, viewerTz)
  const fmtTime = (d: Date, tz: string) =>
    new Intl.DateTimeFormat(undefined, { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(d)
  const fmtDay = (d: Date, tz: string) =>
    new Intl.DateTimeFormat(undefined, { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' }).format(d)

  const primary = sameDay
    ? `${fmtDay(start, viewerTz)} · ${fmtTime(start, viewerTz)} – ${fmtTime(end, viewerTz)} (${shortOffset(input.startsAt, viewerTz)})`
    : `${fmtDay(start, viewerTz)} ${fmtTime(start, viewerTz)} – ${fmtDay(end, viewerTz)} ${fmtTime(end, viewerTz)} (${shortOffset(input.startsAt, viewerTz)})`

  if (!inviteTz || inviteTz === viewerTz) {
    return { primary, secondary: null }
  }
  const origDaySame = dateKeyInTz(input.startsAt, viewerTz) === dateKeyInTz(input.startsAt, inviteTz)
  const secondary = origDaySame
    ? `Organizer time: ${fmtTime(start, inviteTz)} – ${fmtTime(end, inviteTz)} ${inviteTz} (${shortOffset(input.startsAt, inviteTz)})`
    : `Organizer time: ${fmtDay(start, inviteTz)}, ${fmtTime(start, inviteTz)} – ${fmtTime(end, inviteTz)} ${inviteTz} (${shortOffset(input.startsAt, inviteTz)})`

  return { primary, secondary }
}
