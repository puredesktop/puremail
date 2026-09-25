// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import type { Attachment, MailMessage, MailThread } from '../types'
import { base64Of, buildThreadHandoff, threadMarkdown } from './assignHandoff'

const thread = { id: 't1', subject: 'Contract: Q3/Q4' } as MailThread
const file = (name: string, mimeType: string, text: string, extra: Partial<Attachment> = {}): Attachment => ({
  id: `att_${name}`,
  name,
  mimeType,
  sizeLabel: `${text.length} B`,
  size: text.length,
  content: `data:${mimeType};base64,${btoa(text)}`,
  ...extra,
})
const message = (id: string, at: string, extra: Partial<MailMessage> = {}): MailMessage =>
  ({
    id,
    threadId: 't1',
    from: { name: 'Riley', email: 'v@publisher.example' },
    to: [{ name: '', email: 'alex@business.example' }],
    subject: 'Contract: Q3/Q4',
    body: 'Hello',
    receivedAt: at,
    attachments: [],
    read: true,
    ...extra,
  }) as MailMessage

describe('handing an email to a mission', () => {
  it('writes the thread as markdown, oldest first, bodies as text', () => {
    const md = threadMarkdown(thread, [
      message('b', '2026-07-22T09:00:00.000Z', { bodyHtml: '<p>Newer <b>reply</b></p>' }),
      message('a', '2026-07-20T09:00:00.000Z', { attachments: [file('x.pdf', 'application/pdf', '%PDF')] }),
    ])
    expect(md.startsWith('# Contract: Q3/Q4\n')).toBe(true)
    expect(md.indexOf('Hello')).toBeLessThan(md.indexOf('Newer reply'))
    expect(md).toContain('Riley <v@publisher.example> · 2026-07-20 09:00')
    expect(md).toContain('- x.pdf (4 B)')
  })

  it('attaches the documents once each as bytes, resolves remote ones, and leaves out the rest', async () => {
    const remote: Attachment = { id: 'r', name: 'schedule.xlsx', mimeType: 'application/vnd.ms-excel', sizeLabel: '3 B', size: 3 }
    const handoff = await buildThreadHandoff(
      thread,
      [
        message('a', '2026-07-20T09:00:00.000Z', { attachments: [file('contract.docx', 'application/msword', 'v1')] }),
        message('b', '2026-07-22T09:00:00.000Z', {
          attachments: [file('contract.docx', 'application/msword', 'v1'), remote, file('logo.png', 'image/png', 'png')],
        }),
      ],
      { resolve: async (_m, a) => ({ ...a, content: 'data:application/vnd.ms-excel;base64,QUJD' }) },
    )
    expect(handoff.attachments?.map(item => item.name)).toEqual(['Contract_ Q3_Q4 — email.md', 'contract.docx', 'schedule.xlsx'])
    expect(handoff.attachments?.[2]?.source).toEqual({ type: 'data', encoding: 'base64', data: 'QUJD' })
    expect(handoff.source).toBe('this email and 2 attachments')
  })

  it('respects the byte budget and says what was left out', async () => {
    const handoff = await buildThreadHandoff(
      thread,
      [message('a', '2026-07-20T09:00:00.000Z', { attachments: [file('big.pdf', 'application/pdf', 'x'.repeat(40))] })],
      { resolve: async () => null, maxBytes: 10 },
    )
    expect(handoff.attachments).toHaveLength(1)
    expect(handoff.source).toBe('this email (1 left out)')
  })

  it('reads only base64 data urls', () => {
    expect(base64Of('data:text/plain;base64,aGk=')).toBe('aGk=')
    expect(base64Of('data:text/plain,hi')).toBe(null)
    expect(base64Of(undefined)).toBe(null)
  })
})
