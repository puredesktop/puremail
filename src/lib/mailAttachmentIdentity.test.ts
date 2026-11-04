import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import { attachmentReceiptHash, receiptTextHash } from './mailAttachmentIdentity'
import { attachmentContentToBase64 } from './mailAttachments'

it.each(['A', 'abc', 'x'.repeat(55), 'y'.repeat(56), 'z'.repeat(64), 'abc'.repeat(1000)].map((content, i) => [i, content] as const))('receipt digest agrees with SHA-256, vector %s', (_index, content) => {
  const file = { id: 'file', name: 'file.txt', mimeType: 'text/plain', sizeLabel: '', content }
  expect(attachmentReceiptHash(file)).toBe(createHash('sha256').update(attachmentContentToBase64(file)!).digest('hex'))
  expect(attachmentReceiptHash({ ...file, content: `data:text/plain;base64,${attachmentContentToBase64(file)}` })).toBe(attachmentReceiptHash(file))
})

it.each(['', '<p>Words</p>', '<p>Māori ✉</p>'])('formatted receipt identity uses UTF-8 for %s', html => {
  const canonical = Buffer.from(html, 'utf8').toString('base64')
  expect(receiptTextHash(html)).toBe(createHash('sha256').update(canonical).digest('hex'))
})

it('does not reuse a receipt digest after bytes change on the same attachment object', () => {
  const file = { id: 'file', name: 'file.txt', mimeType: 'text/plain', sizeLabel: '', content: 'A' }
  const first = attachmentReceiptHash(file)
  file.content = 'B'
  expect(attachmentReceiptHash(file)).not.toBe(first)
  expect(attachmentReceiptHash(file)).toBe(createHash('sha256').update(Buffer.from('B').toString('base64')).digest('hex'))
})
