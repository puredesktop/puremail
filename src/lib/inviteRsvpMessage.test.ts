import { describe, expect, it } from 'vitest'
import type { MailCalendarInvite } from '../types'
import {
  buildInviteRsvpDraft,
  INVITE_RSVP_ATTACHMENT_MIME_TYPE,
  INVITE_RSVP_ATTACHMENT_NAME,
  isInviteRsvpResponse,
} from './inviteRsvpMessage'

function invite(overrides: Partial<MailCalendarInvite> = {}): MailCalendarInvite {
  return {
    uid: 'evt-42@organizer.example',
    method: 'REQUEST',
    sequence: 2,
    status: 'confirmed',
    title: 'Quarterly planning',
    description: '',
    startsAt: '2026-07-10T09:00:00.000Z',
    endsAt: '2026-07-10T10:30:00.000Z',
    timeZone: 'UTC',
    organizer: { name: 'Orla Organizer', email: 'organizer@example.com' },
    attendees: [],
    rawSource: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n',
    ...overrides,
  }
}

const BASE_INPUT = {
  invite: invite(),
  response: 'accepted' as const,
  account: { email: 'alex@alternate.example', name: 'User' },
  threadId: 'gmail_thread_123',
  timestamp: '2026-07-04T10:00:00.000Z',
}

describe('isInviteRsvpResponse', () => {
  it('accepts only responses that owe the organizer a reply', () => {
    expect(isInviteRsvpResponse('accepted')).toBe(true)
    expect(isInviteRsvpResponse('declined')).toBe(true)
    expect(isInviteRsvpResponse('tentative')).toBe(true)
    expect(isInviteRsvpResponse('needsAction')).toBe(false)
    expect(isInviteRsvpResponse(undefined)).toBe(false)
  })
})

describe('buildInviteRsvpDraft', () => {
  it('addresses the organizer with a response-prefixed subject and one-line body', () => {
    const draft = buildInviteRsvpDraft(BASE_INPUT)

    expect(draft).not.toBeNull()
    expect(draft?.to).toEqual([
      { name: 'Orla Organizer', email: 'organizer@example.com' },
    ])
    expect(draft?.subject).toBe('Accepted: Quarterly planning')
    expect(draft?.body).toBe(
      'User has accepted the invitation to "Quarterly planning".',
    )
    expect(draft?.threadId).toBe('gmail_thread_123')
    expect(draft?.syncState).toBe('pending')
  })

  it.each([
    ['declined', 'Declined: Quarterly planning', 'declined'],
    ['tentative', 'Tentative: Quarterly planning', 'tentatively accepted'],
  ] as const)('maps the %s response to subject and body wording', (response, subject, verb) => {
    const draft = buildInviteRsvpDraft({ ...BASE_INPUT, response })

    expect(draft?.subject).toBe(subject)
    expect(draft?.body).toBe(
      `User has ${verb} the invitation to "Quarterly planning".`,
    )
  })

  it('attaches a METHOD:REPLY ICS carrying the response partstat', () => {
    const draft = buildInviteRsvpDraft({ ...BASE_INPUT, response: 'tentative' })

    const attachment = draft?.attachments[0]
    expect(draft?.attachments).toHaveLength(1)
    expect(attachment?.name).toBe(INVITE_RSVP_ATTACHMENT_NAME)
    expect(attachment?.mimeType).toBe(INVITE_RSVP_ATTACHMENT_MIME_TYPE)
    expect(attachment?.content).toContain('METHOD:REPLY')
    expect(attachment?.content).toContain('UID:evt-42@organizer.example')
    expect(attachment?.content).toContain('SEQUENCE:2')
    expect(attachment?.content).toContain(
      'ATTENDEE;CN=User;PARTSTAT=TENTATIVE:mailto:alex@alternate.example',
    )
    expect(attachment?.content).toContain(
      'ORGANIZER;CN=Orla Organizer:mailto:organizer@example.com',
    )
    expect(attachment?.size).toBe(
      new TextEncoder().encode(attachment?.content ?? '').length,
    )
  })

  it('falls back to the account email when no display name is set', () => {
    const draft = buildInviteRsvpDraft({
      ...BASE_INPUT,
      // Gmail accounts store the email as the name too — that must not
      // produce a doubled "email has accepted" with a CN of the email.
      account: { email: 'alex@alternate.example', name: 'alex@alternate.example' },
    })

    expect(draft?.body).toBe(
      'alex@alternate.example has accepted the invitation to "Quarterly planning".',
    )
    expect(draft?.attachments[0]?.content).toContain(
      'ATTENDEE;PARTSTAT=ACCEPTED:mailto:alex@alternate.example',
    )
  })

  it('returns null when the invite has no organizer email', () => {
    expect(
      buildInviteRsvpDraft({
        ...BASE_INPUT,
        invite: invite({ organizer: undefined }),
      }),
    ).toBeNull()
    expect(
      buildInviteRsvpDraft({
        ...BASE_INPUT,
        invite: invite({ organizer: { name: 'Nameless', email: '  ' } }),
      }),
    ).toBeNull()
  })

  it.each(['REPLY', 'CANCEL', 'PUBLISH'] as const)(
    'returns null for %s invites — only REQUEST owes an RSVP',
    method => {
      expect(
        buildInviteRsvpDraft({ ...BASE_INPUT, invite: invite({ method }) }),
      ).toBeNull()
    },
  )

  it('returns null when the account has no email to reply from', () => {
    expect(
      buildInviteRsvpDraft({ ...BASE_INPUT, account: { email: '  ' } }),
    ).toBeNull()
  })
})
