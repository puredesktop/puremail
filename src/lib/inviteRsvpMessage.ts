/**
 * iMIP RSVP mail construction: when someone answers a calendar invite in
 * PureMail, the organizer only learns about it if a `METHOD:REPLY` ICS is
 * mailed back (RFC 6047). This builds that mail as a regular Draft so the
 * existing provider send path delivers it unchanged — pure logic, no shell
 * or provider dependencies.
 */

import { generateIcsReply } from '@purescience/platform-ui/ics/generateIcs'
import type { Draft, MailCalendarInvite } from '../types'
import { formatAttachmentBytes } from './mailAttachments'

export type InviteRsvpResponse = 'accepted' | 'declined' | 'tentative'

/**
 * Narrow an invite-card response to one that owes the organizer an RSVP
 * mail — "Add to calendar" passes no response and `needsAction` answers
 * nothing.
 */
export function isInviteRsvpResponse(
  value: string | undefined,
): value is InviteRsvpResponse {
  return value === 'accepted' || value === 'declined' || value === 'tentative'
}

const SUBJECT_PREFIX: Record<InviteRsvpResponse, string> = {
  accepted: 'Accepted',
  declined: 'Declined',
  tentative: 'Tentative',
}

const BODY_VERB: Record<InviteRsvpResponse, string> = {
  accepted: 'accepted',
  declined: 'declined',
  tentative: 'tentatively accepted',
}

export const INVITE_RSVP_ATTACHMENT_NAME = 'invite-reply.ics'

/**
 * `method=REPLY` on the content type is what lets Google Calendar and
 * Outlook process the RSVP automatically instead of showing a bare
 * attachment. The MIME builder emits `Content-Type: <mimeType>; name=...`
 * verbatim, so the parameter survives into the sent message.
 */
export const INVITE_RSVP_ATTACHMENT_MIME_TYPE = 'text/calendar; method=REPLY'

export interface InviteRsvpAccount {
  email: string
  /** Display name; ignored when empty or just the email again. */
  name?: string
}

export interface InviteRsvpInput {
  invite: MailCalendarInvite
  response: InviteRsvpResponse
  account: InviteRsvpAccount
  /** Thread the invite arrived on — the RSVP replies within it. */
  threadId: string
  /** ISO timestamp for DTSTAMP/ids — injectable so tests are deterministic. */
  timestamp: string
}

function accountDisplayName(account: InviteRsvpAccount): string {
  const name = account.name?.trim() ?? ''
  if (name && name.toLowerCase() !== account.email.trim().toLowerCase()) {
    return name
  }
  return account.email.trim()
}

/**
 * Build the RSVP mail for an invite response, or return null when no reply
 * is owed: the invite names no organizer to answer, it is not a
 * `METHOD:REQUEST` invite (replies/cancellations/publishes are not
 * answered), or the account has no address to reply from.
 */
export function buildInviteRsvpDraft(input: InviteRsvpInput): Draft | null {
  const { invite, response, account } = input
  const organizerEmail = invite.organizer?.email.trim() ?? ''
  if (!organizerEmail) return null
  if (invite.method !== 'REQUEST') return null
  const accountEmail = account.email.trim()
  if (!accountEmail) return null

  const organizerName = invite.organizer?.name.trim() ?? ''
  const attendeeName = accountDisplayName(account)
  const ics = generateIcsReply({
    uid: invite.uid,
    sequence: invite.sequence,
    timestamp: input.timestamp,
    title: invite.title,
    startsAt: invite.startsAt,
    endsAt: invite.endsAt,
    organizer: {
      email: organizerEmail,
      ...(organizerName && organizerName !== organizerEmail
        ? { name: organizerName }
        : {}),
    },
    attendee: {
      email: accountEmail,
      ...(attendeeName !== accountEmail ? { name: attendeeName } : {}),
    },
    response,
  })
  const icsBytes = new TextEncoder().encode(ics).length

  return {
    id: `invite_rsvp_${invite.uid}_${input.timestamp}`,
    threadId: input.threadId,
    to: [{ name: organizerName || organizerEmail, email: organizerEmail }],
    subject: `${SUBJECT_PREFIX[response]}: ${invite.title}`,
    body: `${attendeeName} has ${BODY_VERB[response]} the invitation to "${invite.title}".`,
    attachments: [
      {
        id: `invite_rsvp_ics_${invite.uid}_${input.timestamp}`,
        name: INVITE_RSVP_ATTACHMENT_NAME,
        mimeType: INVITE_RSVP_ATTACHMENT_MIME_TYPE,
        sizeLabel: formatAttachmentBytes(icsBytes),
        size: icsBytes,
        // Plain ICS text, not a data URI — the same shape Gmail text/calendar
        // parts use locally; the MIME layer base64-encodes it for sending.
        content: ics,
      },
    ],
    updatedAt: input.timestamp,
    syncState: 'pending',
  }
}
