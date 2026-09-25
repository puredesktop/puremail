import { readAssetTransfer } from '@purescience/platform-editor/assetTransfer.ts'
import { readSourceTransfer, sourceDescription } from '@purescience/platform-editor/sourceTransfer.ts'
import { readContentTransfer } from '@purescience/platform-editor/contentTransfer.ts'
import { attachmentFromBytes } from './mailAttachments'
import type { Attachment } from '../types'
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[
        c
      ]!),
  )
export interface MailDrop {
  html: string
  attachments: Attachment[]
  notice: string
}
/** Only explicit public contact fields and source metadata enter the message. */
export async function prepareMailDrop(
  value: string,
  rasterize: (bytes: Uint8Array) => Promise<Uint8Array>,
): Promise<MailDrop> {
  if (value.length > 24 * 1024 * 1024)
    throw new Error('This item is too large to drag.')
  const kind = JSON.parse(value)?.kind
  if (kind === 'reference' || kind === 'webpage') {
    const { reference } = readSourceTransfer(value)
    const url =
      reference.url ||
      (reference.doi
        ? `https://doi.org/${reference.doi.replace(
            /^https?:\/\/(dx\.)?doi\.org\//i,
            '',
          )}`
        : '')
    const html = `<p>${escape(sourceDescription(reference))}${
      url ? ` — <a href="${escape(url)}">${escape(reference.title)}</a>` : ''
    }</p>`
    return { html, attachments: [], notice: 'Linked citation added.' }
  }
  if (kind === 'contact') {
    const contact = readContentTransfer(value)
    if (contact.kind !== 'contact') throw new Error('Invalid contact.')
    const lines = [
      contact.name,
      ...contact.emails,
      ...contact.phones,
      ...contact.links,
    ]
    return {
      html: `<p>${lines.map(escape).join('<br>')}</p>`,
      attachments: [],
      notice: 'Name and contact details added.',
    }
  }
  let name: string,
    mime: string,
    bytes: Uint8Array,
    alt = '',
    caption = ''
  if (kind === 'file') {
    const file = readContentTransfer(value)
    if (file.kind !== 'file') throw new Error('Invalid file.')
    name = file.name
    const match = file.dataUrl.match(/^data:([^;]+);base64,([\s\S]+)$/)!
    mime = match[1]
    bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0))
    alt = name
    if (mime === 'image/svg+xml') {
      const image = readAssetTransfer(
        JSON.stringify({ version: 1, name, alt, dataUrl: file.dataUrl }),
      )
      bytes = image.bytes
    }
  } else {
    const asset = readAssetTransfer(value)
    name = asset.name
    mime = asset.mimeType
    bytes = asset.bytes
    alt = asset.alt
    caption = asset.caption || ''
  }
  if (mime === 'image/svg+xml') {
    bytes = await rasterize(bytes)
    mime = 'image/png'
    name = name.replace(/\.svg$/i, '') + '.png'
  }
  const attachment = attachmentFromBytes(name, mime, bytes)
  if (/^image\/(png|jpeg|gif|webp)$/.test(mime))
    return {
      html: `<p><img src="${escape(attachment.content!)}" alt="${escape(
        alt,
      )}" style="max-width:100%;height:auto"></p>${
        caption ? `<p>${escape(caption)}</p>` : ''
      }`,
      attachments: [attachment],
      notice: 'Image embedded and included with the draft.',
    }
  if (
    /^(video\/(mp4|webm|ogg)|audio\/(mpeg|mp3|mp4|ogg|wav|webm))$/.test(mime)
  ) {
    const tag = mime.startsWith('video/') ? 'video' : 'audio'
    return {
      html: `<p><${tag} controls preload="none" src="${escape(
        attachment.content!,
      )}" style="max-width:100%">${escape(
        name,
      )}</${tag}></p><p>Attached ${tag}: ${escape(name)}</p>`,
      attachments: [attachment],
      notice: `${
        tag === 'video' ? 'Video' : 'Audio'
      } embedded, with the file included for compatibility.`,
    }
  }
  return { html: '', attachments: [attachment], notice: `${name} attached.` }
}
export async function rasterizeMailSvg(bytes: Uint8Array): Promise<Uint8Array> {
  const url = URL.createObjectURL(
    new Blob([new Uint8Array(bytes)], { type: 'image/svg+xml' }),
  )
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    const scale = Math.min(
      1,
      2400 / Math.max(image.naturalWidth, image.naturalHeight),
    )
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Image renderer unavailable.')
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Could not embed image.'))),
        'image/png',
      ),
    )
    return new Uint8Array(await blob.arrayBuffer())
  } finally {
    URL.revokeObjectURL(url)
  }
}
