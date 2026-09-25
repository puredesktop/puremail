import { describe, expect, it } from 'vitest'
import { DemoMailProvider } from './demoMailProvider'
import { GmailMailProvider } from './gmailMailProvider'
import { ImapMailProvider } from './imapMailProvider'
import { demoMailStoreForNow } from './mailModel'
import { mailProviderSupports } from './mailProviderCapabilities'
import type { MailProvider } from '../types'

/**
 * What `capabilities.drafts: true` has to mean.
 *
 * IMAP claimed draft support while `createDraft` returned a fabricated id
 * that addressed nothing on the server, and with no update or delete at all.
 * Gmail had all three implemented and only ever called one of them. A flag
 * that does not imply a working set of methods is worse than no flag: the UI
 * gates on it and offers actions the provider cannot perform.
 *
 * Every provider is checked against the same rules, so a new one cannot join
 * with a capability it does not honour.
 */

const PROVIDERS: Array<{ name: string; make: () => MailProvider }> = [
  {
    name: 'DemoMailProvider',
    make: () => new DemoMailProvider(demoMailStoreForNow()),
  },
  {
    name: 'GmailMailProvider',
    make: () =>
      new GmailMailProvider({
        email: 'alex@example.com',
        accessToken: async () => 'token',
        fetch: async () => ({ ok: true, status: 200, body: '{}' }),
      }),
  },
  {
    name: 'ImapMailProvider',
    make: () =>
      new ImapMailProvider({
        email: 'alex@example.com',
        imap: {
          connect: async () => undefined,
          listFolders: async () => [],
          fetchMessages: async () => [],
          setFlag: async () => undefined,
          move: async () => undefined,
          append: async () => 1,
          deleteMessage: async () => undefined,
        },
        smtp: { send: async () => undefined },
      }),
  },
]

describe('provider draft contract', () => {
  for (const { name, make } of PROVIDERS) {
    describe(name, () => {
      const provider = make()
      const claimsDrafts = mailProviderSupports(provider, 'drafts')

      /**
       * A provider is either remote-backed for drafts or local-only. Local-only
       * (the demo store) is legitimate: the store IS the source of truth, so
       * there is no elsewhere for a draft to come from. What is not legitimate
       * is implementing half a remote draft surface.
       */
      const remoteBacked = typeof provider.createDraft === 'function'

      it('implements the whole remote draft surface, or none of it', () => {
        if (!remoteBacked) {
          expect(provider.updateDraft).toBeUndefined()
          expect(provider.deleteDraft).toBeUndefined()
          return
        }
        // IMAP shipped createDraft alone, returning an id that addressed
        // nothing on the server, so the draft could never be changed again.
        expect(typeof provider.updateDraft).toBe('function')
        expect(typeof provider.deleteDraft).toBe('function')
      })

      it('can be read as well as written', () => {
        // Without a read the sync is one-way by construction: a draft written
        // elsewhere can never arrive, and one sent there stays here forever.
        if (!remoteBacked) return
        expect(typeof provider.listDrafts).toBe('function')
      })

      it('does not claim drafts it cannot keep', () => {
        if (claimsDrafts) return
        expect(remoteBacked).toBe(false)
      })
    })
  }

  it('every provider that can compose can also send', () => {
    for (const { name, make } of PROVIDERS) {
      const provider = make()
      if (!mailProviderSupports(provider, 'compose')) continue
      expect(typeof provider.send, name).toBe('function')
    }
  })
})
