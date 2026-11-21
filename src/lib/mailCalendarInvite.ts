import ICAL from 'ical.js'
import type { MailCalendarInvite, MailContact } from '../types'

function normalizeMailto(value: unknown): string {
  return String(value ?? '')
    .replace(/^mailto:/i, '')
    .trim()
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim()
}

function normalizeMethod(value: unknown): MailCalendarInvite['method'] {
  const method = normalizeText(value).toUpperCase()
  if (method === 'REPLY' || method === 'CANCEL' || method === 'PUBLISH')
    return method
  return 'REQUEST'
}

function normalizeStatus(
  value: unknown,
  method: MailCalendarInvite['method'],
): MailCalendarInvite['status'] {
  if (method === 'CANCEL') return 'cancelled'
  const status = normalizeText(value).toUpperCase()
  if (status === 'CANCELLED') return 'cancelled'
  if (status === 'TENTATIVE') return 'tentative'
  return 'confirmed'
}

function normalizePartstat(
  value: unknown,
): MailCalendarInvite['attendees'][number]['response'] {
  const partstat = normalizeText(value).toUpperCase()
  if (partstat === 'ACCEPTED') return 'accepted'
  if (partstat === 'DECLINED') return 'declined'
  if (partstat === 'TENTATIVE') return 'tentative'
  return 'needsAction'
}

function contactFromProperty(
  property: ICAL.Property | null,
): MailContact | undefined {
  if (!property) return undefined
  const email = normalizeMailto(property.getFirstValue())
  if (!email) return undefined
  const name = normalizeText(property.getParameter('cn')) || email
  return { name, email }
}

const WINDOWS_TO_IANA_TZ: Record<string, string> = {
  'utc': 'UTC',
  'coordinated universal time': 'UTC',
  'gmt standard time': 'Europe/London',
  'greenwich standard time': 'Atlantic/Reykjavik',
  'w. europe standard time': 'Europe/Berlin',
  'central europe standard time': 'Europe/Budapest',
  'central european standard time': 'Europe/Warsaw',
  'romance standard time': 'Europe/Paris',
  'e. europe standard time': 'Europe/Bucharest',
  'fle standard time': 'Europe/Helsinki',
  'gtb standard time': 'Europe/Athens',
  'russian standard time': 'Europe/Moscow',
  'eastern standard time': 'America/New_York',
  'us eastern standard time': 'America/Indiana/Indianapolis',
  'central standard time': 'America/Chicago',
  'mountain standard time': 'America/Denver',
  'us mountain standard time': 'America/Phoenix',
  'pacific standard time': 'America/Los_Angeles',
  'alaskan standard time': 'America/Anchorage',
  'hawaiian standard time': 'Pacific/Honolulu',
  'atlantic standard time': 'America/Halifax',
  'newfoundland standard time': 'America/St_Johns',
  'e. south america standard time': 'America/Sao_Paulo',
  'sa eastern standard time': 'America/Cayenne',
  'argentina standard time': 'America/Argentina/Buenos_Aires',
  'india standard time': 'Asia/Kolkata',
  'china standard time': 'Asia/Shanghai',
  'taipei standard time': 'Asia/Taipei',
  'singapore standard time': 'Asia/Singapore',
  'tokyo standard time': 'Asia/Tokyo',
  'korea standard time': 'Asia/Seoul',
  'aus eastern standard time': 'Australia/Sydney',
  'cen. australia standard time': 'Australia/Adelaide',
  'w. australia standard time': 'Australia/Perth',
  'new zealand standard time': 'Pacific/Auckland',
  'arabian standard time': 'Asia/Dubai',
  'israel standard time': 'Asia/Jerusalem',
  'south africa standard time': 'Africa/Johannesburg',
  'e. africa standard time': 'Africa/Nairobi',
}

function isValidIanaTimeZone(tz: string): boolean {
  if (!tz) return false
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz })
    return true
  } catch {
    return false
  }
}

function normalizeToIanaTimeZone(raw: string | undefined): string | null {
  const cleaned = (raw ?? '').trim().replace(/^["']|["']$/g, '').trim()
  if (!cleaned || cleaned.toLowerCase() === 'floating') return null
  if (cleaned.toUpperCase() === 'Z' || cleaned.toUpperCase() === 'UTC') return 'UTC'
  const mapped = WINDOWS_TO_IANA_TZ[cleaned.toLowerCase()]
  if (mapped && isValidIanaTimeZone(mapped)) return mapped
  if (isValidIanaTimeZone(cleaned)) return cleaned
  return null
}

/** Convert a wall-clock date/time in a valid IANA timezone to a UTC ISO string. */
function wallClockInIanaToIso(
  value: ICAL.Time,
  ianaTimeZone: string,
): string | null {
  try {
    const guessUtcMs = Date.UTC(
      value.year,
      value.month - 1,
      value.day,
      value.hour,
      value.minute,
      value.second,
    )
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: ianaTimeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
    const offsetAt = (ms: number): number => {
      const parts = fmt.formatToParts(new Date(ms))
      const get = (type: string) =>
        Number(parts.find(p => p.type === type)?.value ?? 0)
      const zonedAsUtc = Date.UTC(
        get('year'),
        get('month') - 1,
        get('day'),
        get('hour') === 24 ? 0 : get('hour'),
        get('minute'),
        get('second'),
      )
      return zonedAsUtc - ms
    }
    const offset1 = offsetAt(guessUtcMs)
    let utcMs = guessUtcMs - offset1
    const offset2 = offsetAt(utcMs)
    if (offset2 !== offset1) utcMs = guessUtcMs - offset2
    return new Date(utcMs).toISOString()
  } catch {
    return null
  }
}

function isoFromTime(
  value: ICAL.Time | null,
  rawTzid: string,
  localVtimezones: ReadonlyMap<string, ICAL.Timezone>,
): string {
  if (!value) return new Date().toISOString()
  if (value.isDate) {
    const yyyy = String(value.year).padStart(4, '0')
    const mm = String(value.month).padStart(2, '0')
    const dd = String(value.day).padStart(2, '0')
    return `${yyyy}-${mm}-${dd}T00:00:00.000Z`
  }
  const tzKey = rawTzid.trim().toLowerCase()
  const localTz = tzKey ? localVtimezones.get(tzKey) : undefined
  if (localTz) {
    try {
      const offsetSeconds = localTz.utcOffset(value)
      if (Number.isFinite(offsetSeconds)) {
        const wallUtcMs = Date.UTC(
          value.year,
          value.month - 1,
          value.day,
          value.hour,
          value.minute,
          value.second,
        )
        return new Date(wallUtcMs - offsetSeconds * 1000).toISOString()
      }
    } catch {
      // Fall through to IANA or JS conversion.
    }
  }
  const zoneTzid = value.zone?.tzid
  if (!zoneTzid || zoneTzid === 'floating') {
    const iana = normalizeToIanaTimeZone(rawTzid)
    if (iana) {
      const converted = wallClockInIanaToIso(value, iana)
      if (converted) return converted
    }
  }
  return value.toJSDate().toISOString()
}

export function parseCalendarInvite(
  rawSource: string,
): MailCalendarInvite | null {
  try {
    const calendar = new ICAL.Component(ICAL.parse(rawSource))
    // Resolve VTIMEZONE definitions scoped strictly to this VCALENDAR rather
    // than mutating the process-global ICAL.TimezoneService singleton.
    const localVtimezones = new Map<string, ICAL.Timezone>()
    for (const vtimezone of calendar.getAllSubcomponents('vtimezone')) {
      try {
        const tz = new ICAL.Timezone(vtimezone)
        if (tz.tzid) localVtimezones.set(tz.tzid.trim().toLowerCase(), tz)
      } catch {
        // Ignore malformed VTIMEZONE blocks; keep parsing the VEVENT.
      }
    }
    const eventComponent = calendar.getFirstSubcomponent('vevent')
    if (!eventComponent) return null
    const event = new ICAL.Event(eventComponent)
    const method = normalizeMethod(calendar.getFirstPropertyValue('method'))
    const organizer = contactFromProperty(
      eventComponent.getFirstProperty('organizer'),
    )
    const attendees = eventComponent
      .getAllProperties('attendee')
      .map(property => ({
        name:
          normalizeText(property.getParameter('cn')) ||
          normalizeMailto(property.getFirstValue()),
        email: normalizeMailto(property.getFirstValue()),
        response: normalizePartstat(property.getParameter('partstat')),
      }))
      .filter(attendee => attendee.email.length > 0)

    const dtStartTzid = normalizeText(
      eventComponent.getFirstProperty('dtstart')?.getParameter('tzid'),
    )
    const dtEndTzid =
      normalizeText(
        eventComponent.getFirstProperty('dtend')?.getParameter('tzid'),
      ) || dtStartTzid
    const resolvedZone = event.startDate?.zone?.tzid
    const localIana = Intl.DateTimeFormat().resolvedOptions().timeZone
    const timeZone =
      normalizeToIanaTimeZone(
        resolvedZone && resolvedZone !== 'floating' ? resolvedZone : dtStartTzid,
      ) ??
      normalizeToIanaTimeZone(dtStartTzid) ??
      localIana
    const allDay = Boolean(event.startDate?.isDate)
    const recurrenceIdValue = eventComponent.getFirstPropertyValue('recurrence-id')
    const recurrenceId = recurrenceIdValue ? String(recurrenceIdValue) : undefined

    return {
      uid: event.uid || `invite_${Date.now()}`,
      method,
      sequence: Number(
        event.sequence ?? eventComponent.getFirstPropertyValue('sequence') ?? 0,
      ),
      status: normalizeStatus(
        eventComponent.getFirstPropertyValue('status'),
        method,
      ),
      title: event.summary || 'Calendar invite',
      description: event.description || '',
      location: event.location || undefined,
      startsAt: isoFromTime(event.startDate, dtStartTzid, localVtimezones),
      endsAt: isoFromTime(event.endDate, dtEndTzid, localVtimezones),
      ...(allDay ? { allDay: true } : {}),
      timeZone,
      organizer,
      attendees,
      recurrenceRule: eventComponent.getFirstPropertyValue('rrule')?.toString(),
      ...(recurrenceId ? { recurrenceId } : {}),
      rawSource,
    }
  } catch {
    // Silence is correct: malformed or non-invite .ics content is expected
    // inbound mail — the message just renders without an invite card.
    return null
  }
}
