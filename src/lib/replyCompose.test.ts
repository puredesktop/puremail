import { describe, expect, it } from 'vitest'
import type { Draft, MailMessage, MailThread } from '../types'
import { replyOpenPlan } from './composeWindowMode'
import {
  baseSubject,
  buildQuotedHistory,
  contactsToComposeInput,
  deriveReplyComposeFields,
  draftComposeKind,
  draftLaunchPreview,
  replyAllContacts,
  replyComposeSubject,
  replyToContacts,
} from './replyCompose'

const thread: MailThread = {
  id: 'thread_1',
  accountId: 'acc_1',
  mailboxId: 'mb_inbox',
  subject: 'Workshop dates for October',
  participants: [
    { name: 'Alex Example', email: 'alex@example.com' },
    { name: 'Sarah Example', email: 'sarah@design.example' },
  ],
  labels: [],
  status: 'inbox',
  priority: 'none',
  summary: 'Dates',
  lastMessageAt: '2026-09-01T08:56:00.000Z',
  syncState: 'synced',
}

const message = (overrides: Partial<MailMessage> = {}): MailMessage => ({
  id: 'msg_1',
  threadId: 'thread_1',
  from: { name: 'Sarah Example', email: 'sarah@design.example' },
  to: [{ name: 'Alex Example', email: 'alex@example.com' }],
  cc: [],
  subject: 'Workshop dates for October',
  body: 'I can hold the 14th and the 21st.',
  receivedAt: '2026-09-01T08:56:00.000Z',
  attachments: [],
  read: true,
  ...overrides,
})

const OWNER = ['alex@example.com']

describe('replyComposeSubject', () => {
  it('prefixes Re: for replies and Fwd: for forwards', () => {
    expect(replyComposeSubject('Budget', 'reply')).toBe('Re: Budget')
    expect(replyComposeSubject('Budget', 'replyAll')).toBe('Re: Budget')
    expect(replyComposeSubject('Budget', 'forward')).toBe('Fwd: Budget')
  })

  it('never stacks prefixes — Re: Re: cannot happen', () => {
    expect(replyComposeSubject('Re: Budget', 'reply')).toBe('Re: Budget')
    expect(replyComposeSubject('RE: re: Budget', 'reply')).toBe('Re: Budget')
    expect(replyComposeSubject('Fwd: Budget', 'forward')).toBe('Fwd: Budget')
  })

  it('switching kind swaps the prefix instead of stacking it', () => {
    expect(replyComposeSubject('Re: Budget', 'forward')).toBe('Fwd: Budget')
    expect(replyComposeSubject('Fwd: Re: Budget', 'reply')).toBe('Re: Budget')
    expect(replyComposeSubject('Fw: Budget', 'reply')).toBe('Re: Budget')
  })

  it('strips prefixes but keeps a Re:-looking word inside the subject', () => {
    expect(baseSubject('Re: About re: everything')).toBe(
      'About re: everything',
    )
  })
})

describe('replyToContacts', () => {
  it('targets the sender by default', () => {
    expect(replyToContacts(message(), OWNER)).toEqual([
      { name: 'Sarah Example', email: 'sarah@design.example' },
    ])
  })

  it('honours a Reply-To header over the From address', () => {
    const withReplyTo = message({
      replyTo: [{ name: 'Studio Desk', email: 'desk@design.example' }],
    })
    expect(replyToContacts(withReplyTo, OWNER)).toEqual([
      { name: 'Studio Desk', email: 'desk@design.example' },
    ])
  })

  it('replying to your own message targets its recipients, never yourself', () => {
    const own = message({
      from: { name: 'Alex Example', email: 'alex@example.com' },
      to: [
        { name: 'Sarah Example', email: 'sarah@design.example' },
        { name: 'Alex Example', email: 'alex@example.com' },
      ],
    })
    expect(replyToContacts(own, OWNER)).toEqual([
      { name: 'Sarah Example', email: 'sarah@design.example' },
    ])
  })
})

describe('replyAllContacts', () => {
  it('keeps other participants on Cc, minus every owned identity', () => {
    const wide = message({
      to: [
        { name: 'Alex Example', email: 'alex@example.com' },
        { name: 'Priya Example', email: 'priya@example.org' },
        { name: 'User Alias', email: 'alex@business.example' },
      ],
      cc: [{ name: 'Robin Example', email: 'ben@example.org' }],
    })
    const result = replyAllContacts(wide, [
      'alex@example.com',
      'alex@business.example',
    ])
    expect(result.to).toEqual([
      { name: 'Sarah Example', email: 'sarah@design.example' },
    ])
    expect(result.cc).toEqual([
      { name: 'Priya Example', email: 'priya@example.org' },
      { name: 'Robin Example', email: 'ben@example.org' },
    ])
  })

  it('never duplicates the sender into Cc when Reply-To redirects To', () => {
    const redirected = message({
      replyTo: [{ name: 'Studio Desk', email: 'desk@design.example' }],
      to: [
        { name: 'Alex Example', email: 'alex@example.com' },
        { name: 'Sarah Example', email: 'sarah@design.example' },
      ],
    })
    const result = replyAllContacts(redirected, OWNER)
    expect(result.to.map(c => c.email)).toEqual(['desk@design.example'])
    expect(result.cc).toEqual([])
  })

  it('a self-send thread reply-all still excludes the owner', () => {
    const own = message({
      from: { name: 'Alex Example', email: 'alex@example.com' },
      to: [{ name: 'Alex Example', email: 'alex@example.com' }],
    })
    const result = replyAllContacts(own, OWNER)
    expect(result.to).toEqual([])
    expect(result.cc).toEqual([])
  })
})

describe('deriveReplyComposeFields', () => {
  const messages = [
    message(),
    message({
      id: 'msg_0',
      from: { name: 'Alex Example', email: 'alex@example.com' },
      to: [{ name: 'Sarah Example', email: 'sarah@design.example' }],
      body: 'How many people fit?',
      receivedAt: '2026-08-31T10:00:00.000Z',
    }),
  ]

  it('reply: sender in To, Re: subject, quoted history present', () => {
    const fields = deriveReplyComposeFields(
      thread,
      messages,
      messages[0]!,
      'reply',
      OWNER,
    )
    expect(fields.to).toBe('Sarah Example <sarah@design.example>')
    expect(fields.cc).toBe('')
    expect(fields.subject).toBe('Re: Workshop dates for October')
    expect(fields.quote?.count).toBe(2)
    expect(fields.quote?.text).toContain('Sarah Example wrote:')
  })

  it('forward: clears recipients and prefixes Fwd:', () => {
    const fields = deriveReplyComposeFields(
      thread,
      messages,
      messages[0]!,
      'forward',
      OWNER,
    )
    expect(fields.to).toBe('')
    expect(fields.subject).toBe('Fwd: Workshop dates for October')
    expect(fields.quote?.text).toContain('---------- Forwarded message ---------')
    expect(fields.quote?.text).toContain('From: Sarah Example <sarah@design.example>')
  })

  it('no source message: reply targets the other participants', () => {
    const fields = deriveReplyComposeFields(thread, [], null, 'reply', OWNER)
    expect(fields.to).toBe('Sarah Example <sarah@design.example>')
    expect(fields.quote).toBeNull()
  })
})

describe('buildQuotedHistory', () => {
  it('quotes replies newest first and forwards oldest first', () => {
    const older = message({
      id: 'older',
      body: 'First mail.',
      receivedAt: '2026-08-30T08:00:00.000Z',
    })
    const newer = message({
      id: 'newer',
      body: 'Second mail.',
      receivedAt: '2026-08-31T08:00:00.000Z',
    })
    const reply = buildQuotedHistory([older, newer], 'reply')!
    expect(reply.text.indexOf('Second mail.')).toBeLessThan(
      reply.text.indexOf('First mail.'),
    )
    const forward = buildQuotedHistory([older, newer], 'forward')!
    expect(forward.text.indexOf('First mail.')).toBeLessThan(
      forward.text.indexOf('Second mail.'),
    )
  })

  it('skips unsent draft messages and escapes HTML in bodies', () => {
    const sketchy = message({ body: 'A <script>alert(1)</script> tag.' })
    const draft = message({ id: 'd1', isDraft: true })
    const quote = buildQuotedHistory([sketchy, draft], 'reply')!
    expect(quote.count).toBe(1)
    expect(quote.html).not.toContain('<script>')
    expect(quote.html).toContain('&lt;script&gt;')
  })

  it('returns null with nothing to quote', () => {
    expect(buildQuotedHistory([], 'reply')).toBeNull()
  })
})

describe('replyOpenPlan (reply over an existing compose)', () => {
  it('opens straight away when there is nothing unsent to lose', () => {
    expect(replyOpenPlan(false)).toBe('open')
  })

  it('saves unsent content to Drafts first — never silently clobbers', () => {
    expect(replyOpenPlan(true)).toBe('save-draft-then-open')
  })
})

describe('draftComposeKind / launcher preview', () => {
  const draft = (overrides: Partial<Draft>): Draft => ({
    id: 'draft_reply_thread_1_1',
    threadId: 'thread_1',
    to: [],
    subject: 'Re: x',
    body: '',
    attachments: [],
    updatedAt: '2026-09-01T00:00:00.000Z',
    syncState: 'pending',
    ...overrides,
  })

  it('classifies drafts by id shape, source message, and thread context', () => {
    expect(draftComposeKind(draft({}), true)).toBe('reply')
    expect(
      draftComposeKind(draft({ id: 'draft_forward_thread_1_1' }), true),
    ).toBe('forward')
    expect(
      draftComposeKind(
        draft({ id: 'draft_llm_1', sourceMessageId: 'msg_1' }),
        false,
      ),
    ).toBe('reply')
    // An agent-generated draft with neither prefix nor source message is
    // still a reply when its thread holds real mail…
    expect(draftComposeKind(draft({ id: 'draft_launch' }), true)).toBe('reply')
    // …and a bare draft only when it stands alone on its own thread.
    expect(draftComposeKind(draft({ id: 'draft_compose_1' }), false)).toBe(
      'draft',
    )
  })

  it('flattens and trims the launcher preview', () => {
    expect(draftLaunchPreview('Hi\n\nthere  team')).toBe('Hi there team')
    expect(draftLaunchPreview('x'.repeat(300)).length).toBeLessThanOrEqual(110)
    expect(draftLaunchPreview('x'.repeat(300)).endsWith('…')).toBe(true)
  })
})

describe('contactsToComposeInput', () => {
  it('renders Name <email> pairs the recipient parser understands', () => {
    expect(
      contactsToComposeInput([
        { name: 'Sarah Example', email: 'sarah@design.example' },
        { name: '', email: 'ben@example.org' },
      ]),
    ).toBe('Sarah Example <sarah@design.example>, ben@example.org')
  })
})
