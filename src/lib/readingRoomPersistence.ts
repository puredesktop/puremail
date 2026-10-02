import { fsCreateFolder, fsDelete, fsWriteText, readPlatformStorageJson, writePlatformStorageJson } from '../bridge/platformBridge'
import {
  CONTEXT_FOLDER,
  contextFileName,
  contextMarkdown,
  emptyAnnotationsFile,
  parseAnnotationsFile,
  type AnnotationsFile,
  type MessageAnnotations,
} from './readingRoom'

/**
 * Notes and kept context live in their own file beside the mail store. They
 * are the reader's own words and cannot be fetched again, so they stay out of
 * the cache file that a re-sync may rebuild.
 */
const storage = { appSlug: 'mail', fileName: 'mail-annotations.json' }

export async function readAnnotationsFile(): Promise<AnnotationsFile> {
  const { value } = await readPlatformStorageJson(storage)
  if (value == null) return emptyAnnotationsFile()
  if ((value as { version?: unknown }).version !== 1) throw new Error('The reading room notes file is not one PureMail can read.')
  return parseAnnotationsFile(value)
}

/**
 * Changes the file under one lock across Mail windows, reading disk inside
 * the lock, so a stale window never replaces notes written in another.
 */
export async function updateAnnotationsFile(change: (file: AnnotationsFile) => AnnotationsFile): Promise<AnnotationsFile> {
  const run = async () => {
    const next = change(await readAnnotationsFile())
    await writePlatformStorageJson({ ...storage, value: next })
    return next
  }
  return typeof navigator !== 'undefined' && navigator.locks ? navigator.locks.request('puremail:annotations-file', run) : run()
}

let contextFolder: Promise<string | null> | null = null

/**
 * Pure/Context/PureMail: a visible folder beside the user's documents, where
 * context kept for every app is written as Markdown. Found from where the
 * app's store lives (Pure/.appdata), so it follows the user's Pure folder.
 */
export function ensureContextFolder(): Promise<string | null> {
  contextFolder ??= (async () => {
    try {
      const probe = await readPlatformStorageJson(storage)
      const path = probe.path ?? ''
      const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
      if (cut <= 0) return null
      const appdata = path.slice(0, cut)
      const pure = appdata.slice(0, Math.max(appdata.lastIndexOf('/'), appdata.lastIndexOf('\\')))
      if (!pure) return null
      let folder = pure
      for (const name of CONTEXT_FOLDER) folder = await fsCreateFolder(folder, name)
      return folder
    } catch (error) {
      console.warn('[puremail] context folder unavailable:', error)
      return null
    }
  })().then(folder => {
    if (!folder) contextFolder = null
    return folder
  })
  return contextFolder
}

/**
 * Brings the shared Markdown file in line with the record: written when the
 * context is for every app, removed when it is not (or no longer kept).
 * Returns the file's path, or undefined when there is none.
 */
export async function syncContextFile(record: MessageAnnotations | undefined, previousFile?: string): Promise<string | undefined> {
  const shared = record?.context?.scope === 'all' ? record : undefined
  let path: string | undefined
  if (shared) {
    const folder = await ensureContextFolder()
    if (!folder) throw new Error('PureMail could not reach your Pure folder to share this context.')
    path = `${folder}/${contextFileName(shared, shared.context?.title)}`
    await fsWriteText(path, contextMarkdown(shared))
  }
  if (previousFile && previousFile !== path) await fsDelete(previousFile).catch(() => undefined)
  return path
}
