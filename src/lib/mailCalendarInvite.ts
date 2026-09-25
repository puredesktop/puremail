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

function isoFromTime(value: ICAL.Time | null): string {
  return value?.toJSDate().toISOString() ?? new Date().toISOString()
}

export function parseCalendarInvite(
  rawSource: string,
): MailCalendarInvite | null {
  try {
    const calendar = new ICAL.Component(ICAL.parse(rawSource))
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
      startsAt: isoFromTime(event.startDate),
      endsAt: isoFromTime(event.endDate),
      timeZone:
        event.startDate?.zone?.tzid ??
        Intl.DateTimeFormat().resolvedOptions().timeZone,
      organizer,
      attendees,
      recurrenceRule: eventComponent.getFirstPropertyValue('rrule')?.toString(),
      rawSource,
    }
  } catch {
    // Silence is correct: malformed or non-invite .ics content is expected
    // inbound mail — the message just renders without an invite card.
    return null
  }
}
