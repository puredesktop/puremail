import { describe, expect, it } from 'vitest'
import {
  attachmentSummary,
  fileNameFromPath,
  isAbsoluteFilePath,
  planAttachmentAdditions,
  planAttachmentRemoval,
} from './draftAttachments'
import { GMAIL_ATTACHMENT_LIMIT_BYTES } from './mailAttachments'
import type { Attachment } from '../types'

function att(overrides: Partial<Attachment> & { size: number }): Attachment {
  return {
    id: `att_${overrides.name ?? 'file'}_${overrides.size}`,
    name: 'file.bin',
    mimeType: 'application/octet-stream',
    sizeLabel: `${overrides.size} B`,
    ...overrides,
  }
}

describe('path helpers', () => {
  it('names files by their last path segment on either separator', () => {
    expect(fileNameFromPath('/Users/developer/Pure/report.pdf')).toBe('report.pdf')
    expect(fileNameFromPath('C:\\Users\\a\\photo.png')).toBe('photo.png')
    expect(fileNameFromPath('/Users/developer/folder/')).toBe('folder')
    expect(fileNameFromPath('plain.txt')).toBe('plain.txt')
  })

  it('accepts only absolute paths', () => {
    expect(isAbsoluteFilePath('/Users/developer/x.pdf')).toBe(true)
    expect(isAbsoluteFilePath('C:\\x.pdf')).toBe(true)
    expect(isAbsoluteFilePath('x.pdf')).toBe(false)
    expect(isAbsoluteFilePath('./x.pdf')).toBe(false)
    expect(isAbsoluteFilePath('~/x.pdf')).toBe(false)
  })
})

describe('planAttachmentAdditions', () => {
  it('appends new files and reports the total against the limit', () => {
    const existing = [att({ name: 'a.pdf', size: 1000 })]
    const plan = planAttachmentAdditions(existing, [
      att({ name: 'b.png', size: 2000 }),
    ])
    expect(plan.status).toBe('ok')
    if (plan.status !== 'ok') return
    expect(plan.attachments.map(item => item.name)).toEqual(['a.pdf', 'b.png'])
    expect(plan.added.map(item => item.name)).toEqual(['b.png'])
    expect(plan.totalBytes).toBe(3000)
    expect(plan.limitBytes).toBe(GMAIL_ATTACHMENT_LIMIT_BYTES)
    expect(plan.skipped).toEqual([])
  })

  it('skips a file already on the draft (same name and size) with a note', () => {
    const existing = [att({ name: 'a.pdf', size: 1000 })]
    const plan = planAttachmentAdditions(existing, [
      att({ id: 'other', name: 'a.pdf', size: 1000 }),
      att({ name: 'b.png', size: 10 }),
    ])
    expect(plan.status).toBe('ok')
    if (plan.status !== 'ok') return
    expect(plan.added.map(item => item.name)).toEqual(['b.png'])
    expect(plan.skipped).toHaveLength(1)
    expect(plan.skipped[0]!.name).toBe('a.pdf')
    expect(plan.skipped[0]!.reason).toMatch(/not added twice/)
  })

  it('does not treat a same-named file of a different size as a duplicate', () => {
    const plan = planAttachmentAdditions(
      [att({ name: 'a.pdf', size: 1000 })],
      [att({ id: 'v2', name: 'a.pdf', size: 1001 })],
    )
    expect(plan.status).toBe('ok')
  })

  it('dedupes within the incoming batch too', () => {
    const plan = planAttachmentAdditions(
      [],
      [att({ id: 'x', name: 'a.pdf', size: 5 }), att({ id: 'y', name: 'a.pdf', size: 5 })],
    )
    expect(plan.status).toBe('ok')
    if (plan.status !== 'ok') return
    expect(plan.added).toHaveLength(1)
    expect(plan.skipped).toHaveLength(1)
  })

  it('reports nothing_to_add when every file was a duplicate', () => {
    const plan = planAttachmentAdditions(
      [att({ name: 'a.pdf', size: 5 })],
      [att({ id: 'dup', name: 'a.pdf', size: 5 })],
    )
    expect(plan.status).toBe('nothing_to_add')
  })

  it('refuses the WHOLE batch when the total would exceed the limit', () => {
    const existing = [att({ name: 'big.zip', size: 20 * 1024 * 1024 })]
    const plan = planAttachmentAdditions(existing, [
      att({ name: 'small.txt', size: 10 }),
      att({ name: 'six.bin', size: 6 * 1024 * 1024 }),
    ])
    expect(plan.status).toBe('over_limit')
    if (plan.status !== 'over_limit') return
    expect(plan.totalBytes).toBe(26 * 1024 * 1024 + 10)
    expect(plan.limitBytes).toBe(GMAIL_ATTACHMENT_LIMIT_BYTES)
    // Even the small file is held back: the refusal is all-or-nothing.
    expect(plan.wouldAdd.map(item => item.name)).toEqual([
      'small.txt',
      'six.bin',
    ])
  })

  it('allows a total exactly at the limit', () => {
    const plan = planAttachmentAdditions(
      [],
      [att({ name: 'edge.bin', size: GMAIL_ATTACHMENT_LIMIT_BYTES })],
    )
    expect(plan.status).toBe('ok')
  })

  it('honours a custom limit', () => {
    const plan = planAttachmentAdditions([], [att({ name: 'a', size: 11 })], 10)
    expect(plan.status).toBe('over_limit')
  })
})

describe('planAttachmentRemoval', () => {
  const list = [
    att({ id: 'one', name: 'a.pdf', size: 1 }),
    att({ id: 'two', name: 'b.pdf', size: 2 }),
    att({ id: 'three', name: 'b.pdf', size: 3 }),
  ]

  it('removes by id', () => {
    const plan = planAttachmentRemoval(list, { attachmentId: 'one' })
    expect(plan.status).toBe('ok')
    if (plan.status !== 'ok') return
    expect(plan.removed.id).toBe('one')
    expect(plan.remaining.map(item => item.id)).toEqual(['two', 'three'])
  })

  it('removes by a unique name, case-insensitively as a fallback', () => {
    const exact = planAttachmentRemoval(list, { name: 'a.pdf' })
    expect(exact.status).toBe('ok')
    const loose = planAttachmentRemoval(list, { name: 'A.PDF' })
    expect(loose.status).toBe('ok')
  })

  it('refuses an ambiguous name instead of guessing', () => {
    const plan = planAttachmentRemoval(list, { name: 'b.pdf' })
    expect(plan.status).toBe('ambiguous')
    if (plan.status !== 'ambiguous') return
    expect(plan.matches.map(item => item.id)).toEqual(['two', 'three'])
  })

  it('reports not_found for an unknown id or name', () => {
    expect(planAttachmentRemoval(list, { attachmentId: 'nope' }).status).toBe(
      'not_found',
    )
    expect(planAttachmentRemoval(list, { name: 'zzz' }).status).toBe('not_found')
    expect(planAttachmentRemoval(list, {}).status).toBe('not_found')
  })
})

describe('attachmentSummary', () => {
  it('is the compact shape the tools return', () => {
    expect(
      attachmentSummary(att({ id: 'x', name: 'a.pdf', size: 42, mimeType: 'application/pdf' })),
    ).toEqual({ id: 'x', name: 'a.pdf', mimeType: 'application/pdf', size: 42 })
  })
})
