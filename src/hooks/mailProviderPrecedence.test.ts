import { describe, expect, it } from 'vitest'

/**
 * The rule itself, stated once so it cannot drift back: an IMAP account
 * the user activated is the mailbox, even when a Google credential is
 * connected — that credential is shared with PureCalendar, so connecting
 * it to see calendars must never move the user's mail.
 */
function bootProvider(input: {
  googleConnected: boolean
  imapActive: boolean
}): 'imap' | 'gmail' | 'demo' {
  if (input.imapActive) return 'imap'
  if (input.googleConnected) return 'gmail'
  return 'demo'
}

describe('mail provider precedence', () => {
  it('keeps an active IMAP account when Google connects for Calendar', () => {
    expect(
      bootProvider({ googleConnected: true, imapActive: true }),
    ).toBe('imap')
  })

  it('uses Gmail when no IMAP account is active', () => {
    expect(
      bootProvider({ googleConnected: true, imapActive: false }),
    ).toBe('gmail')
  })

  it('falls back to the demo mailbox with neither', () => {
    expect(
      bootProvider({ googleConnected: false, imapActive: false }),
    ).toBe('demo')
  })

  it('uses the IMAP account with Google disconnected', () => {
    expect(
      bootProvider({ googleConnected: false, imapActive: true }),
    ).toBe('imap')
  })
})
