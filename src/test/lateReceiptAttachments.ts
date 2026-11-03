import type { Attachment } from '../types'

const local: Attachment = { id: 'file', name: 'letter.pdf', mimeType: 'application/pdf', sizeLabel: '1 B', size: 1, content: 'data:application/pdf;base64,QQ==' }
const remote: Attachment = { ...local, content: undefined, remote: { provider: 'imap', folderPath: 'Drafts', uid: 7, partId: '2' } }
/** Receipt evidence and a later attachment, with every other compose field unchanged. */
const cases: Array<[string, Attachment[] | undefined, Attachment[], boolean]> = [
  ['changed local bytes with the same labels and id', [local], [{ ...local, content: 'data:application/pdf;base64,Qg==' }], true],
  ['changed identity without content evidence', [{ ...local, content: undefined }], [{ ...local, id: 'replacement', content: undefined }], true],
  ['changed remote reference', [remote], [{ ...remote, remote: { ...remote.remote!, uid: 8 } as Attachment['remote'] }], true],
  ['missing receipt attachment list', undefined, [local], true],
  ['receipt labels and id without bytes or reference', [{ ...local, content: undefined }], [local], true],
  ['neither side has content evidence', [{ ...local, content: undefined }], [{ ...local, content: undefined }], true],
  ['incomplete receipt reference', [{ ...remote, remote: { provider: 'imap', uid: 7 } as Attachment['remote'] }], [remote], true],
  ['complete equal bytes with provider bookkeeping', [{ ...local, id: 'sent-part', sizeLabel: '1 byte' }], [local], false],
  ['complete equal remote evidence despite a remapped local id', [remote], [{ ...remote, id: 'provider-remapped', sizeLabel: '1 byte' }], false],
  ['hydration of the same remote file', [remote], [{ ...local, hydratedFrom: remote.remote }], false],
]

export const lateReceiptAttachmentCases = cases.map(([name, before, after, changed]) => [name, before === undefined ? undefined : JSON.parse(JSON.stringify(before)), JSON.parse(JSON.stringify(after)), changed] as [string, Attachment[] | undefined, Attachment[], boolean])
