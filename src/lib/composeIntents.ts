import { readPlatformStorageJson, writePlatformStorageJson } from '../bridge/platformBridge'
import type { Attachment } from '../types'

const storage = { appSlug: 'mail', fileName: 'compose-intents.json' }

interface RawComposeIntentEntry {
  to?: Array<{ email?: string; name?: string }>
  cc?: Array<{ email?: string; name?: string }>
  subject?: string
  body?: string
  attachments?: Array<{
    id?: string
    name?: string
    mimeType?: string
    sizeLabel?: string
    contentBase64?: string
  }>
}

export interface RichComposeIntent {
  to: string[]
  cc: string[]
  subject?: string
  body?: string
  attachments: Attachment[]
}

/**
 * Consume pending compose requests written by PurePeople, PureCalendar, or
 * other suite apps into compose-intents.json, clearing only when the file
 * version still matches what was read.
 */
export async function takeRichComposeIntent(): Promise<RichComposeIntent | null> {
  const read = await readPlatformStorageJson(storage)
  const entries = Object.values(
    (read.value as { entries?: Record<string, RawComposeIntentEntry> } | null)?.entries ?? {},
  )
  if (entries.length === 0) return null
  const written = await writePlatformStorageJson({
    ...storage,
    value: { entries: {} },
    ...(read.version !== undefined ? { ifMatch: read.version } : {}),
  })
  if (written.conflict) return null

  const to = [
    ...new Set(
      entries.flatMap(entry =>
        (entry.to ?? []).map(recipient => (recipient.email ?? '').trim()).filter(Boolean),
      ),
    ),
  ]
  const cc = [
    ...new Set(
      entries.flatMap(entry =>
        (entry.cc ?? []).map(recipient => (recipient.email ?? '').trim()).filter(Boolean),
      ),
    ),
  ]
  const rich = [...entries].reverse().find(e => e.subject || e.body || (e.attachments && e.attachments.length > 0))
  const attachments: Attachment[] = (rich?.attachments ?? [])
    .filter(a => Boolean(a && typeof a.name === 'string' && a.name.trim()))
    .map((a, idx) => ({
      id: typeof a.id === 'string' && a.id.trim() ? a.id.trim() : `cal_att_${Date.now()}_${idx}`,
      name: a.name!.trim().slice(0, 200),
      mimeType: typeof a.mimeType === 'string' && a.mimeType.trim() ? a.mimeType.trim() : 'application/octet-stream',
      sizeLabel: typeof a.sizeLabel === 'string' && a.sizeLabel.trim() ? a.sizeLabel.trim() : '1 KB',
      ...(typeof a.contentBase64 === 'string' && a.contentBase64.length > 0 ? { content: a.contentBase64 } : {}),
    }))

  if (!to.length && !cc.length && !rich?.subject && !rich?.body && attachments.length === 0) {
    return null
  }
  return {
    to,
    cc,
    ...(rich?.subject ? { subject: rich.subject } : {}),
    ...(rich?.body ? { body: rich.body } : {}),
    attachments,
  }
}

/**
 * Backwards-compatible helper returning only recipient addresses from compose-intents.json.
 */
export async function takeComposeIntents(): Promise<string[]> {
  const rich = await takeRichComposeIntent()
  return rich?.to ?? []
}
