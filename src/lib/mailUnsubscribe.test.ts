import { describe, expect, it } from 'vitest'
import { demoMailStore } from './mailModel'
import {
  parseListUnsubscribe,
  unsubscribeCandidatesForStore,
  unsubscribeLinkFromBody,
} from './mailUnsubscribe'
import type { MailMessage, MailStore } from '../types'

describe('List-Unsubscribe parsing (RFC 2369)', () => {
  it('parses mailto-only, https-only, and combined headers', () => {
    expect(parseListUnsubscribe('<mailto:unsub@list.example>')).toEqual({
      mailto: 'mailto:unsub@list.example',
    })
    expect(
      parseListUnsubscribe('<https://list.example/unsubscribe?u=1>'),
    ).toEqual({ https: 'https://list.example/unsubscribe?u=1' })
    expect(
      parseListUnsubscribe(
        '<https://list.example/u?x=1>, <mailto:unsub@list.example?subject=stop>',
      ),
    ).toEqual({
      https: 'https://list.example/u?x=1',
      mailto: 'mailto:unsub@list.example?subject=stop',
    })
  })

  it('takes the first usable URL of each kind from multi-URL headers', () => {
    const targets = parseListUnsubscribe(
      '<mailto:a@x.example>, <mailto:b@x.example>, <https://x.example/1>, <https://x.example/2>',
    )
    expect(targets.mailto).toBe('mailto:a@x.example')
    expect(targets.https).toBe('https://x.example/1')
  })

  it('tolerates missing angle brackets and rejects http/junk schemes', () => {
    expect(parseListUnsubscribe('mailto:plain@x.example')).toEqual({
      mailto: 'mailto:plain@x.example',
    })
    expect(parseListUnsubscribe('<http://insecure.example/u>')).toEqual({})
    expect(parseListUnsubscribe('<javascript:alert(1)>')).toEqual({})
    expect(parseListUnsubscribe(undefined)).toEqual({})
    expect(parseListUnsubscribe('')).toEqual({})
  })
})

describe('body-link heuristic', () => {
  it('finds unsubscribe links in html and plain text', () => {
    expect(
      unsubscribeLinkFromBody(
        '',
        '<a href="https://news.example/unsubscribe?id=9">unsubscribe</a>',
      ),
    ).toBe('https://news.example/unsubscribe?id=9')
    expect(
      unsubscribeLinkFromBody(
        'To stop these emails visit https://news.example/opt-out/123 today',
      ),
    ).toBe('https://news.example/opt-out/123')
    expect(unsubscribeLinkFromBody('No links here.')).toBeNull()
  })
})

describe('candidate grouping', () => {
  function newsletterMessage(
    id: string,
    threadId: string,
    senderEmail: string,
    listUnsubscribe?: string,
    body = 'Weekly update.',
  ): MailMessage {
    return {
      id,
      threadId,
      from: { name: senderEmail.split('@')[0] ?? senderEmail, email: senderEmail },
      to: [{ name: 'Alex Example', email: 'alex@example.com' }],
      subject: 'Newsletter',
      body,
      receivedAt: '2026-06-20T10:00:00.000Z',
      attachments: [],
      read: true,
      ...(listUnsubscribe ? { listUnsubscribe } : {}),
    }
  }

  function storeWithNewsletters(): MailStore {
    const store = demoMailStore()
    return {
      ...store,
      messages: [
        ...store.messages,
        newsletterMessage(
          'nl_1',
          'thread_launch',
          'news@letters.example',
          '<https://letters.example/u/1>, <mailto:unsub@letters.example>',
        ),
        newsletterMessage(
          'nl_2',
          'thread_contract',
          'news@letters.example',
          '<https://letters.example/u/2>',
        ),
        newsletterMessage(
          'nl_3',
          'thread_design',
          'promo@shop.example',
          undefined,
          'Sale! To opt out visit https://shop.example/unsubscribe/x1',
        ),
      ],
    }
  }

  it('groups per sender with header candidates ranked above heuristics', () => {
    const candidates = unsubscribeCandidatesForStore(
      storeWithNewsletters(),
      'acct_demo',
    )
    const senders = candidates.map(candidate => candidate.senderEmail)
    expect(senders).toContain('news@letters.example')
    expect(senders).toContain('promo@shop.example')
    expect(senders.indexOf('news@letters.example')).toBeLessThan(
      senders.indexOf('promo@shop.example'),
    )

    const newsletter = candidates.find(
      candidate => candidate.senderEmail === 'news@letters.example',
    )!
    expect(newsletter.messageCount).toBe(2)
    expect(newsletter.threadIds).toHaveLength(2)
    expect(newsletter.targets.mailto).toBe('mailto:unsub@letters.example')
    expect(newsletter.targets.https).toBe('https://letters.example/u/1')
    expect(newsletter.heuristicOnly).toBe(false)

    const promo = candidates.find(
      candidate => candidate.senderEmail === 'promo@shop.example',
    )!
    expect(promo.heuristicOnly).toBe(true)
    expect(promo.targets.https).toBe('https://shop.example/unsubscribe/x1')
  })

  it('ignores senders outside the inbox and without any channel', () => {
    const store = storeWithNewsletters()
    const outside: MailStore = {
      ...store,
      threads: store.threads.map(thread =>
        thread.id === 'thread_design'
          ? { ...thread, mailboxId: 'mailbox_archive' }
          : thread,
      ),
    }
    const senders = unsubscribeCandidatesForStore(outside, 'acct_demo').map(
      candidate => candidate.senderEmail,
    )
    expect(senders).not.toContain('promo@shop.example')
  })
})
