// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { fileToAttachment } from './mailShellHelpers'
import {
  attachmentFromBytes,
  attachmentContentToBase64,
  base64ToBytes,
} from '../lib/mailAttachments'

/**
 * The pairing rule made concrete: the compose window's File path and the
 * agent's bytes path must produce the same attachment, because they ARE
 * the same builder. This pins the File side to `attachmentFromBytes`.
 */
describe('fileToAttachment', () => {
  it('builds through attachmentFromBytes: same name, mime, size and content', async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])
    const file = new File([bytes], 'report.pdf', { type: 'application/pdf' })
    const viaFile = await fileToAttachment(file)
    const viaBytes = attachmentFromBytes('report.pdf', 'application/pdf', bytes)
    expect(viaFile.name).toBe(viaBytes.name)
    expect(viaFile.mimeType).toBe('application/pdf')
    expect(viaFile.size).toBe(6)
    expect(viaFile.sizeLabel).toBe(viaBytes.sizeLabel)
    expect(viaFile.content).toBe(viaBytes.content)
    expect(base64ToBytes(attachmentContentToBase64(viaFile)!)).toEqual(bytes)
    expect(viaFile.id).toMatch(/^att_\d+_report_pdf$/)
  })

  it('resolves the mime type the same way the agent path does', async () => {
    // A browser File with no type and an unknown extension: octet-stream,
    // exactly what the old FileReader path produced.
    const file = new File([new Uint8Array([1, 2, 3])], 'blob.xyz')
    expect((await fileToAttachment(file)).mimeType).toBe(
      'application/octet-stream',
    )
    // Magic bytes win over a wrong browser-supplied type.
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'p.jpg', {
      type: 'image/jpeg',
    })
    expect((await fileToAttachment(png)).mimeType).toBe('image/png')
  })
})
