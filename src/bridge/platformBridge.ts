import { bridge } from '@purescience/platform-ui/bridge/client'
import { PLATFORM_BRIDGE_METHODS } from '@purescience/platform-ui/bridge/methods'
import {
  disconnectCredential,
  readCredentialOAuthAccessToken,
  readCredentialStatus,
} from '@purescience/platform-ui/bridge/credentials.mjs'
import type { OAuthCredentialStatus } from '@purescience/platform-ui/bridge/credentials.mjs'
import { renderPrintHtml } from '@purescience/platform-ui/bridge/render'
// Leaf modules, not the assistants index: the index pulls in the event
// bus, which attaches window listeners at import time and cannot load in
// a DOM-less test.
import { sessions as assistantSessions } from '@purescience/platform-ui/bridge/assistants/sessions/api.js'
import { messages as assistantMessages } from '@purescience/platform-ui/bridge/assistants/messages/api.js'
import {
  toggleAgentDrawer as toggleAgentDrawerBridge,
  updateCurrentWorkspaceTab,
} from '@purescience/platform-ui/bridge/workspace.mjs'
import type { ToggleAgentDrawerOptions } from '@purescience/platform-ui/bridge/workspace.mjs'
import type { MailSettings } from '../types'
import type { SaveMailPdfDeps } from '../lib/mailPdf'

export { bridge }

const MAIL_APP_SLUG = 'mail'
const PUREMAIL_LOCAL_SETTINGS_KEY = 'puremail.localSettings.v1'

/** Shell vault id for the Google connection shared by Mail and Calendar. */
export const GOOGLE_CREDENTIAL_ID = 'google.oauth'

/** The slug-scoped secrets key an IMAP account's password lives under. */
export function imapPasswordSecretKey(profileId: string): string {
  return `imap-password.${profileId}`
}

/**
 * The secrets key for a separately-stored SMTP password. Some setups (Proton
 * Bridge among them) hand out distinct credentials per protocol; when none
 * was stored, sending reuses the IMAP password key.
 */
export function smtpPasswordSecretKey(profileId: string): string {
  return `smtp-password.${profileId}`
}

/** Thrown rather than storing a mail password the OS cannot protect. */
export class UnprotectedKeystoreError extends Error {
  constructor(backend: string, available: boolean) {
    super(
      available
        ? `This device's keystore (${backend}) does not encrypt strongly enough to hold a mail password.`
        : 'This device has no secure keystore, so a mail password cannot be stored safely.',
    )
    this.name = 'UnprotectedKeystoreError'
  }
}

/**
 * Store an IMAP account password in the app's slug-scoped secrets store —
 * write-only from the renderer's point of view: the shell's mail transport
 * reads it main-side at dial time, and no request ever carries the value.
 *
 * Two deliberate choices:
 * - The shell's secrets store silently writes plaintext when no OS keystore
 *   answers (ps-suite#396); a mail password is exactly the secret that must
 *   never take that path, so the keystore is checked first and the write is
 *   refused instead of made unsafely.
 * - The old implementation targeted the credentials VAULT, whose catalog is a
 *   fixed allowlist — `imap.password.<id>` was never in it, so every save
 *   would have thrown `Unknown credential id` the first time anyone tried.
 *   The secrets store is the per-app surface and has no such list.
 */
async function saveMailPasswordSecret(
  key: string,
  password: string,
): Promise<void> {
  const status = (await bridge.call(PLATFORM_BRIDGE_METHODS.SECRETS_STATUS, [])) as {
    encryptionAvailable: boolean
    backend: string
    weak: boolean
  } | null
  if (!status || status.weak) {
    throw new UnprotectedKeystoreError(
      status?.backend ?? 'unknown',
      Boolean(status?.encryptionAvailable),
    )
  }
  await bridge.call(PLATFORM_BRIDGE_METHODS.SECRETS_SET, [
    { key, value: password },
  ])
}

export async function saveImapPassword(
  profileId: string,
  password: string,
): Promise<void> {
  await saveMailPasswordSecret(imapPasswordSecretKey(profileId), password)
}

/** SMTP password stored under its own key; same keystore refusal rules. */
export async function saveSmtpPassword(
  profileId: string,
  password: string,
): Promise<void> {
  await saveMailPasswordSecret(smtpPasswordSecretKey(profileId), password)
}

/** Best-effort secrets cleanup when a saved connection profile is removed. */
export async function forgetConnectionPasswords(
  profileId: string,
): Promise<void> {
  for (const key of [
    imapPasswordSecretKey(profileId),
    smtpPasswordSecretKey(profileId),
  ]) {
    try {
      await bridge.call(PLATFORM_BRIDGE_METHODS.SECRETS_DELETE, [{ key }])
    } catch {
      // A missing secret (never saved, or store unavailable) must not
      // block removing the profile itself.
    }
  }
}

/**
 * Disconnect the shared Google credential. Tokens are dropped shell-side;
 * the OAuth client configuration is kept so reconnecting is one click.
 */
export async function disconnectGoogleCredential(): Promise<void> {
  await disconnectCredential({ id: GOOGLE_CREDENTIAL_ID })
}

export interface PlatformNetworkFetchRequest {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string
}

export interface PlatformNetworkFetchResponse {
  status: number
  ok: boolean
  headers: Record<string, string>
  body: string
}

export function isStandaloneDevMode(): boolean {
  return import.meta.env.DEV && window.parent === window
}

export async function fetchAppSettings<T extends object>(
  appSlug: string,
): Promise<T> {
  if (isStandaloneDevMode()) {
    const raw = window.localStorage.getItem(`purescience:${appSlug}:settings`)
    return raw ? (JSON.parse(raw) as T) : ({} as T)
  }
  return bridge.call<T>(PLATFORM_BRIDGE_METHODS.SETTINGS_APP_GET, [appSlug])
}

export async function updateAppSettings(
  appSlug: string,
  patch: Record<string, unknown>,
): Promise<void> {
  if (isStandaloneDevMode()) {
    const current = await fetchAppSettings(appSlug)
    window.localStorage.setItem(
      `purescience:${appSlug}:settings`,
      JSON.stringify({ ...current, ...patch }),
    )
    return
  }
  await bridge.call(PLATFORM_BRIDGE_METHODS.SETTINGS_APP_UPDATE, [
    { appSlug, patch },
  ])
}

/**
 * Legacy settings blobs (app-settings and the localStorage mirror) used to
 * carry a `google` key with the OAuth client id. Credentials are shell-owned
 * now — strip the stale key so it never round-trips back into persistence.
 */
function withoutLegacyGoogleKey(
  settings: Partial<MailSettings>,
): Partial<MailSettings> {
  const { google: _legacyGoogle, ...rest } = settings as Partial<MailSettings> &
    Record<'google', unknown>
  return rest
}

export async function fetchMailSettings(): Promise<Partial<MailSettings>> {
  const settings = withoutLegacyGoogleKey(
    await fetchAppSettings<Partial<MailSettings>>(MAIL_APP_SLUG),
  )
  if (typeof window === 'undefined') return settings
  try {
    const raw = window.localStorage.getItem(PUREMAIL_LOCAL_SETTINGS_KEY)
    if (!raw) return settings
    const localSettings = withoutLegacyGoogleKey(
      JSON.parse(raw) as Partial<MailSettings>,
    )
    return {
      ...localSettings,
      ...settings,
    }
  } catch (error) {
    console.warn(
      '[puremail] local settings unreadable; using app settings only:',
      error,
    )
    return settings
  }
}

export async function mergeMailSettings(
  patch: Partial<MailSettings>,
): Promise<void> {
  // The host merges patches atomically. Reading then rewriting the whole settings
  // object can restore stale preferences from another open Mail window.
  await updateAppSettings(MAIL_APP_SLUG, patch)
}

/**
 * Redacted Google connection state from the shell vault — the only
 * connection-state source apps may read. Never contains secret material.
 */
export async function fetchGoogleCredentialStatus(): Promise<OAuthCredentialStatus> {
  if (isStandaloneDevMode()) {
    return {
      id: GOOGLE_CREDENTIAL_ID,
      kind: 'oauth',
      provider: 'google',
      configured: false,
      connected: false,
      scopes: [],
      needsReconnect: false,
    }
  }
  return readCredentialStatus({ id: GOOGLE_CREDENTIAL_ID })
}

/**
 * Short-lived Google access token; the shell refreshes it transparently.
 * Refresh tokens and the client secret never cross the bridge.
 */
export async function fetchGoogleAccessToken(): Promise<{
  accessToken: string
  expiresAt: number
}> {
  if (isStandaloneDevMode()) {
    throw new Error(
      'Google access tokens need the PureDesktop shell (standalone dev mode has no credential vault)',
    )
  }
  return readCredentialOAuthAccessToken({ id: GOOGLE_CREDENTIAL_ID })
}

export interface PlatformStorageReadResult {
  path?: string
  value: unknown
}

/**
 * Read one of this app's JSON store files from the shell-managed data folder.
 * Standalone dev mode (a plain browser tab, no shell) has no filesystem
 * bridge, so it falls back to localStorage under the same file name.
 *
 * This is the store PureMail persists its mailbox into. localStorage cannot
 * hold it: a normal Gmail fetch window serialises past the ~5MB origin quota,
 * after which every write throws and nothing local survives a reload — which
 * is how drafts an agent really did create came back as "never written".
 */
export async function readPlatformStorageJson(input: {
  appSlug: string
  fileName: string
}): Promise<PlatformStorageReadResult> {
  if (isStandaloneDevMode()) {
    const raw = window.localStorage.getItem(
      `purescience:${input.appSlug}:${input.fileName}`,
    )
    return { value: raw ? (JSON.parse(raw) as unknown) : null }
  }
  const result = (await bridge.call(PLATFORM_BRIDGE_METHODS.STORAGE_READ_JSON, [
    input,
  ])) as PlatformStorageReadResult | null
  return { value: result?.value ?? null, ...(result?.path ? { path: result.path } : {}) }
}

/** Write one of this app's JSON store files. See readPlatformStorageJson. */
export async function writePlatformStorageJson(input: {
  appSlug: string
  fileName: string
  value: unknown
}): Promise<void> {
  if (isStandaloneDevMode()) {
    window.localStorage.setItem(
      `purescience:${input.appSlug}:${input.fileName}`,
      JSON.stringify(input.value),
    )
    return
  }
  await bridge.call(PLATFORM_BRIDGE_METHODS.STORAGE_WRITE_JSON, [input])
}

export async function networkFetch(
  request: PlatformNetworkFetchRequest,
): Promise<PlatformNetworkFetchResponse> {
  if (isStandaloneDevMode()) {
    const response = await fetch(request.url, {
      method: request.method ?? 'GET',
      headers: request.headers,
      body: request.body,
    })
    const headers: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      headers[key] = value
    })
    return {
      status: response.status,
      ok: response.ok,
      headers,
      body: await response.text(),
    }
  }
  return bridge.call<PlatformNetworkFetchResponse>(
    PLATFORM_BRIDGE_METHODS.NETWORK_FETCH,
    [request],
  )
}

export interface PlatformSaveFileOptions {
  defaultName?: string
  filters?: Array<{ name: string; extensions: string[] }>
}

export interface PlatformDialogPathResult {
  path: string | null
}

/**
 * Native save-file picker. Returns null when the picker is unavailable
 * (standalone dev mode) so callers can fall back to a browser download.
 */
export async function dialogSaveFile(
  options: PlatformSaveFileOptions,
): Promise<string | null> {
  if (isStandaloneDevMode()) return null
  const result = await bridge.call<PlatformDialogPathResult>(
    PLATFORM_BRIDGE_METHODS.DIALOG_SAVE_FILE,
    [options],
  )
  return result.path
}

/**
 * Native open-file picker; null when unavailable (standalone dev mode) or
 * cancelled. Send-run recipient lists (CSV, a flat PureSheets file) come in
 * through here.
 */
export async function dialogOpenFile(): Promise<string | null> {
  if (isStandaloneDevMode()) return null
  const result = await bridge.call<PlatformDialogPathResult | null>(
    PLATFORM_BRIDGE_METHODS.DIALOG_OPEN_FILE,
    [],
  )
  return result?.path ?? null
}

/** Native folder picker (a `.sheets` package IS a folder); null when unavailable or cancelled. */
export async function dialogOpenFolder(): Promise<string | null> {
  if (isStandaloneDevMode()) return null
  const result = await bridge.call<PlatformDialogPathResult | null>(
    PLATFORM_BRIDGE_METHODS.DIALOG_OPEN_FOLDER,
    [],
  )
  return result?.path ?? null
}

/** Read a text file through the shell (UTF-8). Throws when unreadable. */
export async function fsReadText(path: string): Promise<string> {
  const result = await bridge.call<unknown>(PLATFORM_BRIDGE_METHODS.FS_READ, [
    path,
  ])
  if (typeof result === 'string') return result
  if (result && typeof result === 'object') {
    const record = result as { content?: unknown; text?: unknown }
    if (typeof record.content === 'string') return record.content
    if (typeof record.text === 'string') return record.text
  }
  throw new Error(`Could not read "${path}" as text.`)
}

/** Native folder picker for multi-file saves; null when unavailable or cancelled. */
export async function dialogSaveFolder(): Promise<string | null> {
  if (isStandaloneDevMode()) return null
  const result = await bridge.call<PlatformDialogPathResult>(
    PLATFORM_BRIDGE_METHODS.DIALOG_SAVE_FOLDER,
    [],
  )
  return result.path
}

export interface PlatformReadBinaryResult {
  path: string
  mimeType: string
  base64: string
  truncated: boolean
  byteLength: number
}

/**
 * Read a file's bytes through the shell (base64 + the shell's extension
 * mime guess). The shell clips at 5 MB unless told otherwise, so callers
 * that need the whole file pass `maxBytes` and check `truncated`.
 */
export async function fsReadBinary(
  path: string,
  maxBytes?: number,
): Promise<PlatformReadBinaryResult> {
  return bridge.call<PlatformReadBinaryResult>(
    PLATFORM_BRIDGE_METHODS.FS_READ_BINARY,
    [maxBytes === undefined ? { path } : { path, maxBytes }],
  )
}

export async function fsWriteBinary(
  path: string,
  base64: string,
): Promise<void> {
  await bridge.call(PLATFORM_BRIDGE_METHODS.FS_WRITE_BINARY, [
    { path, base64 },
  ])
}

/** Write a UTF-8 text file through the shell (creating its folder as needed). */
export async function fsWriteText(path: string, content: string): Promise<void> {
  await bridge.call(PLATFORM_BRIDGE_METHODS.FS_WRITE, [path, content])
}

/** The names of the entries in a folder. Throws when the folder cannot be listed. */
export async function fsListNames(folder: string): Promise<string[]> {
  const result = await bridge.call<{ entries?: Array<{ name?: string }> }>(
    PLATFORM_BRIDGE_METHODS.FS_LIST,
    [{ rootPath: folder }],
  )
  return (result?.entries ?? [])
    .map(entry => entry.name ?? '')
    .filter(Boolean)
}

/** Print an HTML file on disk to PDF (`render.printHtml`); resolves to the PDF path. */
export async function printHtmlToPdf(request: {
  htmlPath: string
  outputPath: string
}): Promise<string> {
  return renderPrintHtml({
    ...request,
    paginate: 'browser',
    loadingMessage: 'Saving the email as a PDF',
  })
}

let mailScratchDir: Promise<string | null> | null = null

/**
 * A folder beside the app's JSON stores for files PureMail prepares (the
 * page a PDF is printed from). Its location is learned by probing where a
 * store file WOULD live; the probe never creates the store file.
 */
export function ensureMailScratchDir(): Promise<string | null> {
  mailScratchDir ??= (async () => {
    try {
      const probe = await readPlatformStorageJson({
        appSlug: MAIL_APP_SLUG,
        fileName: 'puremail-scratch.json',
      })
      const cut = probe.path
        ? Math.max(probe.path.lastIndexOf('/'), probe.path.lastIndexOf('\\'))
        : -1
      if (!probe.path || cut <= 0) return null
      return await fsCreateFolder(probe.path.slice(0, cut), 'puremail-scratch')
    } catch (error) {
      console.warn('[puremail] scratch folder unavailable:', error)
      return null
    }
  })().then(dir => {
    if (!dir) mailScratchDir = null
    return dir
  })
  return mailScratchDir
}

/** The shell side of saving mail as a PDF: scratch page, write, print, no overwrite. */
export const mailPdfDeps: SaveMailPdfDeps = {
  scratchDir: () => ensureMailScratchDir(),
  writeText: (path, text) => fsWriteText(path, text),
  print: request => printHtmlToPdf(request),
  readBinary: path => fsReadBinary(path, 200 * 1024 * 1024),
  writeBinary: (path, base64) => fsWriteBinary(path, base64),
  existingNames: folder => fsListNames(folder),
}

/** Create (idempotently) a folder under parentPath; returns its absolute path. */
export async function fsCreateFolder(
  parentPath: string,
  name: string,
): Promise<string> {
  const result = await bridge.call<{ path: string }>(
    PLATFORM_BRIDGE_METHODS.FS_CREATE_FOLDER,
    [{ parentPath, name }],
  )
  return result.path
}

/**
 * Open a local PDF in the shell's detached viewer window — a separate OS
 * window beside the suite window, not a tab over PureMail. The method name
 * is a literal rather than a PLATFORM_BRIDGE_METHODS constant so this app
 * still typechecks against a platform-ui build that predates the capability;
 * an older shell rejects the call with a clear error the caller surfaces.
 */
export async function openFileViewerWindow(request: {
  path: string
  title?: string
}): Promise<void> {
  await bridge.call('viewer.openFileWindow', [request])
}

/** Ask the shell to front the calendar app (8a's "Open in PureCalendar"). */
export async function openCalendarApp(): Promise<void> {
  await bridge.call(PLATFORM_BRIDGE_METHODS.WORKSPACE_OPEN_APP, [
    { appSlug: 'calendar' },
  ])
}

export async function osReveal(path: string): Promise<void> {
  await bridge.call(PLATFORM_BRIDGE_METHODS.OS_REVEAL, [path])
}

/**
 * Open an http(s) link from mail content in the system browser. The app runs
 * in a sandboxed iframe where `target="_blank"` navigation is not reliable,
 * so anchor clicks in message bodies route through the shell instead.
 */
export async function openExternalUrl(url: string): Promise<void> {
  await bridge.call(PLATFORM_BRIDGE_METHODS.OS_OPEN_EXTERNAL, [url])
}

// ---- Platform operations ledger ---------------------------------------------
// Suite-wide record of user/agent interactions in two lanes ('user'|'agent'),
// stored by the shell and rendered live by the PureAssistant tab. Building
// rule (see AGENTS.md "Operations ledger"): record every meaningful user or
// agent interaction this app performs, and when you find legacy activity/feed
// code duplicating this, tag it `DEPRECATED(operations-ledger)` for cleanup.
import {
  listPlatformOperations as listPlatformOperationsBridge,
  onPlatformOperationRecorded as onPlatformOperationRecordedBridge,
  recordPlatformOperation as recordPlatformOperationBridge,
} from '@purescience/platform-ui/bridge/operations'
import type {
  PlatformOperation,
  PlatformOperationInput,
  PlatformOperationsListQuery,
  PlatformOperationsListResult,
} from '@purescience/platform-ui/bridge/operations'

export type {
  PlatformOperation,
  PlatformOperationInput,
  PlatformOperationsListQuery,
  PlatformOperationsListResult,
}

function operationsBridgeAvailable(): boolean {
  return !(import.meta.env.DEV && window.parent === window)
}

/** Record one interaction into the ledger (the shell pins appSlug to this app). */
export async function recordOperation(
  input: PlatformOperationInput,
): Promise<PlatformOperation | null> {
  if (!operationsBridgeAvailable()) return null
  return recordPlatformOperationBridge(input)
}

/** List recorded operations, newest first. */
export async function listOperations(
  query?: PlatformOperationsListQuery,
): Promise<PlatformOperationsListResult> {
  if (!operationsBridgeAvailable()) return { operations: [] }
  return listPlatformOperationsBridge(query)
}

/** Subscribe to live ledger appends. Returns unsubscribe. */
export function onOperationRecorded(
  listener: (operation: PlatformOperation) => void,
): () => void {
  if (!operationsBridgeAvailable()) return () => undefined
  return onPlatformOperationRecordedBridge(listener)
}

/**
 * Hand a prompt to the DRAWER agent — the shell's own agent for this tab,
 * with PureMail's tools — as a user message in the tab's session. The
 * session is the one bound to this tab (`meta.viewport.sessionId`); when
 * the tab has none yet, a new session is created and bound to the tab
 * so the drawer shows the conversation. Sending runs the agent's turn
 * whether or not the drawer is visible.
 */
let pendingDrawerSession: Promise<string> | null = null

export async function sendPromptToDrawerAgent(input: {
  content: string
  sessionId?: string | null
}): Promise<{ sessionId: string }> {
  if (isStandaloneDevMode()) {
    throw new Error('The drawer agent needs the PureDesktop shell.')
  }
  let sessionId = input.sessionId ?? null
  if (!sessionId) {
    pendingDrawerSession ??= (async () => {
      const session = await assistantSessions.create({ appId: MAIL_APP_SLUG, title: 'Mail' })
      await updateCurrentWorkspaceTab({ sessionId: session.id })
      return session.id
    })().catch(error => { pendingDrawerSession = null; throw error })
    sessionId = await pendingDrawerSession
  }
  if (input.sessionId) pendingDrawerSession = null
  await assistantMessages.send(sessionId, { content: input.content })
  return { sessionId }
}

export async function toggleAgentDrawer(
  options?: ToggleAgentDrawerOptions,
): Promise<void> {
  if (isStandaloneDevMode()) return
  await toggleAgentDrawerBridge(options)
}
