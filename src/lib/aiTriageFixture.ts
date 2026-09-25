import type { Attachment, MailContact, MailMessage, MailStore, MailThread } from '../types'
import { demoMailStoreForNow } from './mailModel'

/**
 * Test fixture for AI triage: the demo store's account and mailboxes with a
 * small, known set of threads in place of the demo mail.
 *
 * - t_ask    a partner asks the user to sign something (unread)
 * - t_mine   the user sent the last message
 * - t_news   bulk mail with a List-Unsubscribe header
 * - t_cc     the user is only on Cc, with a PDF attached
 * - t_old    archived, outside in:inbox
 */
export function aiTriageFixture(now: Date) {
  const base = demoMailStoreForNow(now)
  const account = base.accounts[0]
  if (!account?.email) throw new Error('the demo store needs an account with an email')
  const inbox = base.mailboxes.find(
    mailbox => mailbox.accountId === account.id && mailbox.role === 'inbox',
  )!
  const archive =
    base.mailboxes.find(
      mailbox => mailbox.accountId === account.id && mailbox.role === 'archive',
    ) ?? inbox
  const owner: MailContact = { name: account.name, email: account.email }
  const people = {
    partner: { name: 'Mere Example', email: 'mere@partner.example' },
    digest: { name: 'Weekly Digest', email: 'digest@news.example' },
    colleague: { name: 'Tama Example', email: 'tama@team.example' },
  }
  const at = (minutesAgo: number): string =>
    new Date(now.getTime() - minutesAgo * 60_000).toISOString()

  const makeThread = (
    id: string,
    subject: string,
    minutesAgo: number,
    mailboxId = inbox.id,
  ): MailThread => ({
    ...base.threads[0],
    id,
    accountId: account.id,
    mailboxId,
    subject,
    participants: [],
    labels: [],
    status: 'inbox',
    priority: 'none',
    summary: subject,
    lastMessageAt: at(minutesAgo),
    snoozedUntil: undefined,
    snoozeReturnedAt: undefined,
    filterRunAt: undefined,
    filteredBy: undefined,
  })

  const makeMessage = (
    id: string,
    threadId: string,
    from: MailContact,
    body: string,
    minutesAgo: number,
    extra: Partial<MailMessage> = {},
  ): MailMessage => ({
    ...base.messages[0],
    id,
    threadId,
    gmailMessageId: undefined,
    messageIdHeader: undefined,
    optimistic: undefined,
    isDraft: undefined,
    from,
    replyTo: undefined,
    to: [owner],
    cc: [],
    bcc: undefined,
    subject: 'subject',
    body,
    bodyHtml: undefined,
    receivedAt: at(minutesAgo),
    attachments: [],
    calendarInvite: undefined,
    listUnsubscribe: undefined,
    read: false,
    ...extra,
  })

  const pdf: Attachment = {
    id: 'att_board_pack',
    name: 'board-pack.pdf',
    mimeType: 'application/pdf',
    sizeLabel: '1 MB',
  }

  const threads = [
    makeThread('t_ask', 'Contract sign-off', 30),
    makeThread('t_mine', 'Re: Invoice', 40),
    makeThread('t_news', 'This week in publishing', 50),
    makeThread('t_cc', 'Board pack', 60),
    makeThread('t_old', 'An archived thread', 70, archive.id),
  ]
  const messages = [
    makeMessage(
      'm_ask',
      't_ask',
      people.partner,
      'Hi, the partner contract is ready. It needs your signature before Friday so we can start the pilot.',
      30,
    ),
    makeMessage('m_mine_1', 't_mine', people.colleague, 'Here is the invoice.', 45, {
      read: true,
    }),
    makeMessage('m_mine_2', 't_mine', owner, 'Thanks, paid today.', 40, {
      read: true,
      to: [people.colleague],
    }),
    makeMessage('m_news', 't_news', people.digest, 'The top stories this week.', 50, {
      listUnsubscribe: '<mailto:unsubscribe@news.example>',
    }),
    makeMessage('m_cc', 't_cc', people.colleague, 'Board pack attached for Thursday.', 60, {
      to: [people.partner],
      cc: [owner],
      attachments: [pdf],
    }),
    makeMessage('m_old', 't_old', people.partner, 'Old news.', 70),
  ]

  const store: MailStore = {
    ...base,
    threads,
    messages,
    drafts: [],
    aiTriage: [],
  }
  return { store, accountId: account.id, owner, people, at, makeMessage, makeThread }
}
