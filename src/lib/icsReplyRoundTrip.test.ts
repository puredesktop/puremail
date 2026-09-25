/**
 * Round-trip contract between the shared ICS writer and PureMail's real
 * invite parser (ICAL.js): a generated METHOD:REPLY must come back with the
 * same uid/sequence and the attendee carrying the chosen response, or
 * organizers' calendars would mis-record RSVPs sent from PureMail.
 */

import { describe, expect, it } from 'vitest'
import { generateIcsReply } from '@purescience/platform-ui/ics/generateIcs'
import { parseCalendarInvite } from './mailCalendarInvite'

const BASE = {
  uid: 'evt-42@organizer.example',
  sequence: 3,
  timestamp: '2026-07-04T10:00:00.000Z',
  title: 'Quarterly planning',
  startsAt: '2026-07-10T09:00:00.000Z',
  endsAt: '2026-07-10T10:30:00.000Z',
  organizer: { email: 'organizer@example.com', name: 'Orla Organizer' },
  attendee: { email: 'alex@alternate.example', name: 'User' },
} as const

describe('generateIcsReply → parseCalendarInvite round trip', () => {
  it.each(['accepted', 'declined', 'tentative'] as const)(
    'preserves method, uid, sequence, and the %s response',
    response => {
      const ics = generateIcsReply({ ...BASE, response })

      const invite = parseCalendarInvite(ics)
      expect(invite).not.toBeNull()
      expect(invite?.method).toBe('REPLY')
      expect(invite?.uid).toBe(BASE.uid)
      expect(invite?.sequence).toBe(BASE.sequence)
      expect(invite?.attendees).toEqual([
        { name: 'User', email: 'alex@alternate.example', response },
      ])
    },
  )

  it('preserves the event identity fields the organizer matches on', () => {
    const invite = parseCalendarInvite(
      generateIcsReply({ ...BASE, response: 'accepted' }),
    )

    expect(invite?.title).toBe(BASE.title)
    expect(invite?.startsAt).toBe(BASE.startsAt)
    expect(invite?.endsAt).toBe(BASE.endsAt)
    expect(invite?.organizer).toEqual({
      name: 'Orla Organizer',
      email: 'organizer@example.com',
    })
  })

  it('defaults sequence to 0 when the original invite had none', () => {
    const { sequence: _unused, ...withoutSequence } = BASE
    const invite = parseCalendarInvite(
      generateIcsReply({ ...withoutSequence, response: 'declined' }),
    )

    expect(invite?.sequence).toBe(0)
    expect(invite?.attendees[0]?.response).toBe('declined')
  })
})
