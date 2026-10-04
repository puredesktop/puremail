import { expect, it } from 'vitest'
import { reconcileComposeAttachments, retainHydratedAttachments } from './composeAttachments'
import type { Attachment } from '../types'

const remote: Attachment = { id: 'attachment', name: 'file.txt', mimeType: 'text/plain', sizeLabel: '4 B', remote: { provider: 'imap', folderPath: 'Drafts', uid: 143, partId: '2' } }
const hydrated: Attachment = { id: 'attachment', name: 'file.txt', mimeType: 'text/plain', sizeLabel: '4 B', content: 'dGVzdA==' }

it('replaces a deleted-UID attachment reference with bytes from the successful save', () => {
  expect(reconcileComposeAttachments([remote], [remote], [hydrated])).toEqual([hydrated])
  expect(retainHydratedAttachments([remote], [hydrated])).toEqual([hydrated])
})

it('keeps user removals, additions and replacement content while applying store additions and removals', () => {
  const userAdded = { ...hydrated, id: 'user-added' }
  const removed = { ...remote, id: 'store-removed' }
  const storeAdded = { ...hydrated, id: 'store-added' }
  const userReplacement = { ...hydrated, content: 'bmV3' }
  expect(reconcileComposeAttachments([userReplacement, userAdded, removed], [remote, removed], [hydrated, storeAdded])).toEqual([userReplacement, userAdded, storeAdded])
  expect(reconcileComposeAttachments([], [remote], [hydrated])).toEqual([])
  expect(retainHydratedAttachments([userReplacement], [hydrated])).toEqual([userReplacement])
  expect(retainHydratedAttachments([], [hydrated])).toEqual([])
})
