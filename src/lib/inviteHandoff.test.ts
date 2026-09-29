import { describe, expect, it } from 'vitest'
import { createCalendarInviteIntentFromMessage } from './mailModel'
import type { MailMessage, MailThread } from '../types'

const thread: MailThread = {
  id: 'thread_invite',
  accountId: 'account_example',
  mailboxId: 'inbox',
  subject: 'Planning',
  summary: 'Invitation',
  participants: [],
  labels: [],
  syncState: 'synced',
  status: 'inbox',
  priority: 'none',
  lastMessageAt: '2026-06-20T10:00:00Z',
}
const message: MailMessage = {
  id: 'message_invite',
  threadId: thread.id,
  from: { name: 'Organizer', email: 'organizer@example.com' },
  to: [{ name: 'Guest', email: 'guest@example.com' }],
  subject: thread.subject,
  read: true,
  body: '',
  receivedAt: thread.lastMessageAt,
  attachments: [],
  calendarInvite: {
    uid: 'planning@example.com',
    method: 'REQUEST',
    sequence: 1,
    status: 'confirmed',
    title: 'Planning',
    description: '',
    location: '',
    startsAt: '2026-06-21T10:00:00Z',
    endsAt: '2026-06-21T11:00:00Z',
    timeZone: 'UTC',
    organizer: { name: 'Organizer', email: 'organizer@example.com' },
    attendees: [
      { name: 'Other', email: 'other@example.com', response: 'tentative' },
      { name: 'Guest', email: 'guest@example.com', response: 'needsAction' },
    ],
    rawSource: '',
  },
}

describe('invitation response handoff', () => {
  it('records only the responding account, even when it is not the first attendee', () => {
    const intent = createCalendarInviteIntentFromMessage(
      thread,
      message,
      'accepted',
      thread.lastMessageAt,
      true,
      'GUEST@example.com',
    )
    expect(intent?.attendees.map(a => a.response)).toEqual([
      'tentative',
      'accepted',
    ])
    expect(message.calendarInvite?.attendees[1].response).toBe('needsAction')
    expect(intent?.source.messageId).toBe(message.id)
  })
  it('never guesses an attendee when the responding identity is unknown', () => {
    const intent = createCalendarInviteIntentFromMessage(
      thread,
      message,
      'accepted',
    )
    expect(intent?.attendees).toEqual(message.calendarInvite?.attendees)
  })
})
