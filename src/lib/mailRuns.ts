import {
  escapeComposeHtml,
  isValidEmailAddress,
  plainTextToComposeHtml,
} from './mailCompose'
import { stripHtmlToText } from './mailTextUtils'
import type {
  Attachment,
  Draft,
  MailContact,
  MailRun,
  MailRunFieldBinding,
  MailRunItem,
  MailRunRecipients,
  MailRunRecipientSource,
  MailStore,
  MailThread,
} from '../types'

/**
 * Send runs: mail-merge with a review-and-send loop.
 *
 * Everything here is pure. A run owns draft IDS and statuses, never
 * content — the drafts it renders are ordinary drafts in Drafts, so the
 * user can open, edit or delete any of them between sessions and the run
 * sees the result the next time it looks (`reconcileRun`). Nothing in this
 * file sends: sending is one explicit Send per item, in the shell.
 */

// ── Tokens ────────────────────────────────────────────────────────────

/** `{{first_name}}`, `{{ Email }}` … — the token grammar, global. */
const RUN_TOKEN_PATTERN = /\{\{\s*([A-Za-z0-9_][A-Za-z0-9_ .-]*?)\s*\}\}/g

/** The per-recipient personal-note slot. */
export const RUN_NOTE_TOKEN = 'note'

/** Marks the note region inside a rendered draft's HTML body. */
export const RUN_NOTE_ATTR = 'data-run-note'

/** `First Name` → `first_name`: how column names become token names. */
export function normalizeRunKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

/** Unique token names in a template, in first-appearance order. */
export function runTokensIn(text: string): string[] {
  const seen = new Set<string>()
  for (const match of text.matchAll(RUN_TOKEN_PATTERN)) {
    const token = (match[1] ?? '').trim()
    if (token && !seen.has(token)) seen.add(token)
  }
  return [...seen]
}

/**
 * Substitute every `{{token}}` from `values`. Lookup is by exact name, then
 * by normalized name (`{{First Name}}` finds `first_name`). Unknown tokens
 * render empty and are reported — a blank beats a literal `{{first_name}}`
 * in someone's inbox, and the setup screen shows the warning.
 */
export function substituteRunTokens(
  text: string,
  values: Record<string, string>,
  options: { html?: boolean; skip?: string[] } = {},
): { text: string; missing: string[] } {
  const missing: string[] = []
  const skip = new Set((options.skip ?? []).map(normalizeRunKey))
  const normalizedValues = new Map<string, string>()
  for (const [key, value] of Object.entries(values)) {
    normalizedValues.set(normalizeRunKey(key), value)
  }
  const result = text.replace(RUN_TOKEN_PATTERN, (whole, rawToken: string) => {
    const token = rawToken.trim()
    const normalized = normalizeRunKey(token)
    if (skip.has(normalized)) return whole
    const value = values[token] ?? normalizedValues.get(normalized)
    if (value === undefined) {
      if (!missing.includes(token)) missing.push(token)
      return ''
    }
    if (!options.html) return value
    return escapeComposeHtml(value).replace(/\r?\n/g, '<br>')
  })
  return { text: result, missing }
}

const NAME_TITLES = new Set([
  'dr',
  'mr',
  'mrs',
  'ms',
  'miss',
  'mx',
  'prof',
  'sir',
  'dame',
])

/**
 * "Sarah Example" → "Sarah"; "Chen, Sarah" → "Sarah"; "Dr. Mere Example" →
 * "Mere". A name with nothing usable yields '' so the template's own
 * fallback ("Hi there") can stand in.
 */
export function deriveFirstName(name: string): string {
  let text = name.trim().replace(/["“”]/g, '')
  if (!text) return ''
  if (text.includes(',')) {
    const [, after = ''] = text.split(',')
    text = after.trim() || text.split(',')[0]!.trim()
  }
  const words = text.split(/\s+/).filter(Boolean)
  const usable = words.filter(
    word => !NAME_TITLES.has(word.replace(/\./g, '').toLowerCase()),
  )
  const first = (usable[0] ?? words[0] ?? '').replace(/[.,;:]+$/g, '')
  return first
}

export function applyRunBinding(
  row: Record<string, string>,
  binding: MailRunFieldBinding,
): string {
  const raw = (row[binding.column] ?? '').trim()
  return binding.transform === 'first-word' ? deriveFirstName(raw) : raw
}

/**
 * Every value a template token can reach for one row: each column under
 * its own name AND its normalized name, then the mapped fields on top.
 */
export function resolveRunValues(
  recipients: Pick<MailRunRecipients, 'columns'>,
  row: Record<string, string>,
  fieldMap: Record<string, MailRunFieldBinding>,
): Record<string, string> {
  const values: Record<string, string> = {}
  for (const column of recipients.columns) {
    const value = (row[column] ?? '').trim()
    values[column] = value
    values[normalizeRunKey(column)] = value
  }
  for (const [token, binding] of Object.entries(fieldMap)) {
    values[token] = applyRunBinding(row, binding)
  }
  return values
}

/** The tokens a template may use for this run, `note` included. */
export function runAvailableTokens(run: Pick<MailRun, 'recipients' | 'fieldMap'>): string[] {
  const tokens = new Set<string>(Object.keys(run.fieldMap))
  for (const column of run.recipients?.columns ?? []) {
    tokens.add(normalizeRunKey(column))
  }
  tokens.add(RUN_NOTE_TOKEN)
  return [...tokens]
}

// ── Field mapping ──────────────────────────────────────────────────────

function findColumn(
  columns: string[],
  test: (normalized: string) => boolean,
): string | undefined {
  return columns.find(column => test(normalizeRunKey(column)))
}

/**
 * A sensible default mapping from column names: the email column, a first
 * name (its own column, or the first word of a name column), and the full
 * name. The user adjusts in the Fields panel; nothing here is final.
 */
export function guessRunFieldMap(
  columns: string[],
): Record<string, MailRunFieldBinding> {
  const map: Record<string, MailRunFieldBinding> = {}
  const email =
    findColumn(columns, key => key === 'email' || key === 'e_mail') ??
    findColumn(columns, key => key.includes('email') || key.includes('e_mail')) ??
    findColumn(columns, key => key === 'address' || key === 'mail')
  if (email) map.email = { column: email }
  const nameColumn =
    findColumn(columns, key => key === 'name' || key === 'full_name') ??
    findColumn(columns, key => key === 'contact' || key === 'recipient') ??
    findColumn(columns, key => key.endsWith('_name') && !key.includes('first') && !key.includes('last'))
  const firstColumn = findColumn(columns, key => key.includes('first'))
  const lastColumn = findColumn(
    columns,
    key => key.includes('last') || key.includes('surname'),
  )
  if (firstColumn) map.first_name = { column: firstColumn }
  else if (nameColumn) map.first_name = { column: nameColumn, transform: 'first-word' }
  if (nameColumn) map.name = { column: nameColumn }
  else if (firstColumn) map.name = { column: firstColumn }
  if (lastColumn) map.last_name = { column: lastColumn }
  return map
}

// ── Recipient sources ──────────────────────────────────────────────────

const EMAIL_IN_TEXT = /[^\s<>,;"']+@[^\s<>,;"']+\.[A-Za-z]{2,}/

function looksLikeEmail(value: string): boolean {
  return isValidEmailAddress(value.trim())
}

/**
 * Header or not? A first row holding an email address is data. Columns
 * are then synthesized — the email column is found, the first plain-text
 * column becomes `name`, the rest are numbered.
 */
export function recipientsFromGrid(
  grid: string[][],
  source: MailRunRecipientSource,
): MailRunRecipients {
  const rows = grid
    .map(row => row.map(cell => (cell ?? '').trim()))
    .filter(row => row.some(cell => cell.length > 0))
  if (!rows.length) return { source, columns: [], rows: [] }
  const width = Math.max(...rows.map(row => row.length))
  const first = rows[0]!
  const headerless = first.some(looksLikeEmail)
  let columns: string[]
  let dataRows: string[][]
  if (headerless) {
    const emailIndex = first.findIndex(looksLikeEmail)
    const nameIndex = first.findIndex(
      (cell, index) =>
        index !== emailIndex && cell.length > 0 && !/^[\d\s.,-]+$/.test(cell),
    )
    columns = Array.from({ length: width }, (_, index) =>
      index === emailIndex
        ? 'email'
        : index === nameIndex
          ? 'name'
          : `column_${index + 1}`,
    )
    dataRows = rows
  } else {
    const seen = new Map<string, number>()
    columns = Array.from({ length: width }, (_, index) => {
      const raw = first[index] ?? ''
      let name = raw || `column_${index + 1}`
      const count = seen.get(name.toLowerCase()) ?? 0
      seen.set(name.toLowerCase(), count + 1)
      if (count > 0) name = `${name} ${count + 1}`
      return name
    })
    dataRows = rows.slice(1)
  }
  return {
    source,
    columns,
    rows: dataRows.map(row => {
      const record: Record<string, string> = {}
      columns.forEach((column, index) => {
        record[column] = row[index] ?? ''
      })
      return record
    }),
  }
}

/** `,` `;` or tab — whichever the header line uses most. */
export function detectCsvDelimiter(text: string): ',' | ';' | '\t' {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const counts: Array<[',' | ';' | '\t', number]> = [
    [',', (firstLine.match(/,/g) ?? []).length],
    [';', (firstLine.match(/;/g) ?? []).length],
    ['\t', (firstLine.match(/\t/g) ?? []).length],
  ]
  counts.sort((a, b) => b[1] - a[1])
  return counts[0]![1] > 0 ? counts[0]![0] : ','
}

/**
 * RFC 4180-ish CSV: quoted fields, doubled quotes, embedded newlines,
 * CRLF or LF rows. Trailing empty lines are dropped.
 */
export function parseCsv(
  text: string,
  delimiter: ',' | ';' | '\t' = detectCsvDelimiter(text),
): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const source = text.replace(/^﻿/, '')
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          quoted = false
        }
      } else {
        field += char
      }
      continue
    }
    if (char === '"') {
      quoted = true
      continue
    }
    if (char === delimiter) {
      row.push(field)
      field = ''
      continue
    }
    if (char === '\r') continue
    if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      continue
    }
    field += char
  }
  if (field.length || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter(entry => entry.some(cell => cell.trim().length > 0))
}

export function recipientsFromCsv(
  text: string,
  source: MailRunRecipientSource = { kind: 'csv', label: 'CSV' },
): MailRunRecipients {
  return recipientsFromGrid(parseCsv(text), source)
}

/**
 * One recipient per line: `email`, `Name <email>`, `email, name`,
 * `name, email`, or tab/semicolon separated. A line with no address is kept
 * as-is so validation can point at it instead of it silently vanishing.
 */
export function parsePastedRecipients(
  text: string,
  source: MailRunRecipientSource = { kind: 'pasted', label: 'Pasted addresses' },
): MailRunRecipients {
  const rows = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const angled = /^(.*?)\s*<([^<>]+)>\s*$/.exec(line)
      if (angled) {
        return {
          email: angled[2]!.trim(),
          name: angled[1]!.trim().replace(/^["']|["']$/g, ''),
        }
      }
      const parts = line
        .split(/[\t;,]/)
        .map(part => part.trim())
        .filter(Boolean)
      const emailPart = parts.find(looksLikeEmail)
      if (!emailPart) {
        const found = EMAIL_IN_TEXT.exec(line)?.[0]
        return { email: found ?? line, name: '' }
      }
      const name = parts.filter(part => part !== emailPart).join(' ')
      return { email: emailPart, name }
    })
  return { source, columns: ['email', 'name'], rows }
}

function columnIndexFromLetters(letters: string): number {
  let index = 0
  for (const char of letters) {
    index = index * 26 + (char.charCodeAt(0) - 64)
  }
  return index - 1
}

/**
 * The first sheet of a PureSheets workbook (`workbook.json` inside a
 * `.sheets` package, or the legacy flat file) as a recipient grid. Cells
 * are keyed `A1`-style; row 1 is the header when it holds no address.
 */
export function recipientsFromSheetsWorkbook(
  document: unknown,
  source: MailRunRecipientSource,
): MailRunRecipients {
  if (!document || typeof document !== 'object') {
    throw new Error('Not a PureSheets workbook.')
  }
  const record = document as {
    app?: unknown
    workbook?: { sheets?: Array<{ cells?: Record<string, { value?: unknown }> }> }
  }
  if (record.app !== 'PureSheets') {
    throw new Error('Not a PureSheets workbook.')
  }
  const sheet = record.workbook?.sheets?.[0]
  if (!sheet) throw new Error('The workbook has no sheets.')
  const cells = sheet.cells ?? {}
  const grid: string[][] = []
  for (const [key, cell] of Object.entries(cells)) {
    const match = /^([A-Z]+)(\d+)$/.exec(key)
    if (!match) continue
    const column = columnIndexFromLetters(match[1]!)
    const row = Number(match[2]) - 1
    const value =
      typeof cell?.value === 'string'
        ? cell.value
        : cell?.value == null
          ? ''
          : String(cell.value)
    grid[row] ??= []
    grid[row]![column] = value
  }
  const dense = grid.map(row => {
    const width = row?.length ?? 0
    return Array.from({ length: width }, (_, index) => row?.[index] ?? '')
  })
  return recipientsFromGrid(dense, source)
}

// ── Validation ─────────────────────────────────────────────────────────

export interface RunRecipientValidation {
  /** Row indexes that render, in list order. */
  validRowIndexes: number[]
  invalid: Array<{ rowIndex: number; reason: string }>
  duplicates: Array<{ rowIndex: number; email: string; firstRowIndex: number }>
  emailColumn: string | null
}

export function validateRunRecipients(
  recipients: Pick<MailRunRecipients, 'columns' | 'rows'> | undefined,
  fieldMap: Record<string, MailRunFieldBinding>,
): RunRecipientValidation {
  const emailColumn = fieldMap.email?.column ?? null
  if (!recipients || !emailColumn) {
    return {
      validRowIndexes: [],
      invalid: (recipients?.rows ?? []).map((_, rowIndex) => ({
        rowIndex,
        reason: 'No email column is mapped.',
      })),
      duplicates: [],
      emailColumn,
    }
  }
  const validRowIndexes: number[] = []
  const invalid: RunRecipientValidation['invalid'] = []
  const duplicates: RunRecipientValidation['duplicates'] = []
  const seen = new Map<string, number>()
  recipients.rows.forEach((row, rowIndex) => {
    const email = (row[emailColumn] ?? '').trim()
    if (!email) {
      invalid.push({ rowIndex, reason: 'No email address.' })
      return
    }
    if (!isValidEmailAddress(email)) {
      invalid.push({ rowIndex, reason: `"${email}" is not a valid email address.` })
      return
    }
    const key = email.toLowerCase()
    const firstRowIndex = seen.get(key)
    if (firstRowIndex !== undefined) {
      duplicates.push({ rowIndex, email, firstRowIndex })
      return
    }
    seen.set(key, rowIndex)
    validRowIndexes.push(rowIndex)
  })
  return { validRowIndexes, invalid, duplicates, emailColumn }
}

/**
 * Best effort: did the user already mail this address this calendar
 * month? Reads the local sent history (messages from any owner address to
 * it); an address outside the synced window is invisible, so this flags,
 * never blocks.
 */
export function emailedThisMonth(
  store: Pick<MailStore, 'messages' | 'accounts'>,
  email: string,
  now: Date = new Date(),
): boolean {
  const target = email.trim().toLowerCase()
  if (!target) return false
  const owners = new Set(
    store.accounts.map(account => account.email.trim().toLowerCase()).filter(Boolean),
  )
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()
  return store.messages.some(message => {
    if (!owners.has(message.from.email.trim().toLowerCase())) return false
    const at = new Date(message.receivedAt)
    if (Number.isNaN(at.getTime())) return false
    if (at.getUTCFullYear() !== year || at.getUTCMonth() !== month) return false
    return [...message.to, ...(message.cc ?? [])].some(
      contact => contact.email.trim().toLowerCase() === target,
    )
  })
}

// ── The note slot ──────────────────────────────────────────────────────

interface NoteRegion {
  start: number
  end: number
  innerStart: number
  innerEnd: number
}

const REGION_OPEN = new RegExp(`<div\\b[^>]*\\b${RUN_NOTE_ATTR}\\b[^>]*>`, 'i')
const DIV_TAG = /<\/?div\b[^>]*>/gi

/** Locate every note region, nesting-aware, without a DOM. */
function findNoteRegions(html: string): NoteRegion[] {
  const regions: NoteRegion[] = []
  let cursor = 0
  while (cursor < html.length) {
    const rest = html.slice(cursor)
    const open = REGION_OPEN.exec(rest)
    if (!open) break
    const start = cursor + open.index
    const innerStart = start + open[0].length
    let depth = 1
    let innerEnd = -1
    let end = html.length
    DIV_TAG.lastIndex = innerStart
    let tag: RegExpExecArray | null
    while ((tag = DIV_TAG.exec(html))) {
      if (tag[0].startsWith('</')) {
        depth -= 1
        if (depth === 0) {
          innerEnd = tag.index
          end = tag.index + tag[0].length
          break
        }
      } else {
        depth += 1
      }
    }
    if (innerEnd < 0) {
      innerEnd = html.length
      end = html.length
    }
    regions.push({ start, end, innerStart, innerEnd })
    cursor = end
  }
  return regions
}

/** An empty region is whitespace, `<br>`s and empty paragraphs only. */
function regionInnerIsEmpty(inner: string): boolean {
  if (/<img\b/i.test(inner)) return false
  return stripHtmlToText(inner).replace(/\s+/g, '').length === 0
}

/** The markup a fresh (empty) note region takes in a rendered draft. */
export function emptyNoteRegionHtml(): string {
  return `<div ${RUN_NOTE_ATTR}=""><p><br></p></div>`
}

/** What "Insert note slot" puts into the TEMPLATE: the token, marked. */
export function templateNoteSlotHtml(): string {
  return `<div ${RUN_NOTE_ATTR}=""><p>{{${RUN_NOTE_TOKEN}}}</p></div>`
}

const NOTE_TOKEN_PATTERN = new RegExp(`\\{\\{\\s*${RUN_NOTE_TOKEN}\\s*\\}\\}`, 'gi')

export function bodyHasNoteSlot(body: { body: string; bodyHtml?: string }): boolean {
  if (body.bodyHtml && findNoteRegions(body.bodyHtml).length > 0) return true
  return NOTE_TOKEN_PATTERN.test(body.bodyHtml ?? '') || NOTE_TOKEN_PATTERN.test(body.body)
}

/**
 * Render a template body for one recipient: existing note regions are
 * emptied (the recipient gets a blank slot, not the template's token),
 * bare `{{note}}` tokens become empty regions, and every other token is
 * substituted, HTML-escaped.
 */
export function renderRunBodyHtml(
  templateHtml: string,
  values: Record<string, string>,
): { html: string; missing: string[] } {
  let html = ''
  let cursor = 0
  for (const region of findNoteRegions(templateHtml)) {
    html += templateHtml.slice(cursor, region.start)
    html += emptyNoteRegionHtml()
    cursor = region.end
  }
  html += templateHtml.slice(cursor)
  html = html.replace(NOTE_TOKEN_PATTERN, emptyNoteRegionHtml())
  const substituted = substituteRunTokens(html, values, { html: true })
  return { html: substituted.text, missing: substituted.missing }
}

export function renderRunBodyText(
  templateText: string,
  values: Record<string, string>,
): { text: string; missing: string[] } {
  const withoutNote = templateText.replace(NOTE_TOKEN_PATTERN, '')
  return substituteRunTokens(withoutNote, values)
}

/**
 * At send time: an EMPTY note region is removed outright (no blank
 * paragraph left behind); a filled one is unwrapped so the recipient gets
 * plain paragraphs, never the marker div.
 */
export function finalizeRunBodyHtml(html: string): {
  html: string
  hadNote: boolean
  changed: boolean
} {
  const regions = findNoteRegions(html)
  if (!regions.length) return { html, hadNote: false, changed: false }
  let out = ''
  let cursor = 0
  let hadNote = false
  for (const region of regions) {
    out += html.slice(cursor, region.start)
    const inner = html.slice(region.innerStart, region.innerEnd)
    if (!regionInnerIsEmpty(inner)) {
      hadNote = true
      out += inner
    }
    cursor = region.end
  }
  out += html.slice(cursor)
  return { html: out, hadNote, changed: true }
}

/** Rewrite every note region through `replace(inner)` — previews stand a placeholder in. */
export function mapNoteRegions(
  html: string,
  replace: (inner: string) => string,
): string {
  let out = ''
  let cursor = 0
  for (const region of findNoteRegions(html)) {
    out += html.slice(cursor, region.start)
    out += replace(html.slice(region.innerStart, region.innerEnd))
    cursor = region.end
  }
  return out + html.slice(cursor)
}

/** The draft as it should leave the machine. Identity when untouched. */
export function finalizeRunDraftForSend(draft: Draft): Draft {
  if (!draft.bodyHtml) return draft
  const finalized = finalizeRunBodyHtml(draft.bodyHtml)
  if (!finalized.changed) return draft
  return { ...draft, bodyHtml: finalized.html }
}

/** The note text a draft carries in its slot ('' when empty or absent). */
export function noteTextFromBodyHtml(html: string | undefined): string {
  if (!html) return ''
  const [region] = findNoteRegions(html)
  if (!region) return ''
  const inner = html.slice(region.innerStart, region.innerEnd)
  if (regionInnerIsEmpty(inner)) return ''
  return stripHtmlToText(inner)
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

export function draftHasNote(draft: Pick<Draft, 'bodyHtml'>): boolean {
  return noteTextFromBodyHtml(draft.bodyHtml).length > 0
}

/**
 * Write a note into the draft's slot. Returns null when the draft has no
 * slot — the caller says so rather than guessing where the note belongs.
 */
export function setNoteInBodyHtml(
  html: string | undefined,
  note: string,
): string | null {
  if (!html) return null
  const [region] = findNoteRegions(html)
  if (!region) return null
  const inner = note.trim() ? plainTextToComposeHtml(note.trim()) : '<p><br></p>'
  return `${html.slice(0, region.innerStart)}${inner}${html.slice(region.innerEnd)}`
}

// ── Rendering ──────────────────────────────────────────────────────────

export interface RenderedRunFields {
  to: MailContact
  subject: string
  body: string
  bodyHtml: string
  missing: string[]
}

function displayNameForRow(
  values: Record<string, string>,
  fieldMap: Record<string, MailRunFieldBinding>,
): string {
  const direct =
    (fieldMap.name && values.name) ||
    values.full_name ||
    values.name ||
    ''
  if (direct.trim()) return direct.trim()
  const first = values.first_name ?? ''
  const last = values.last_name ?? ''
  return `${first} ${last}`.trim()
}

/**
 * The draft fields for one recipient row — the same function "Preview as
 * Sarah" and Render use, so the preview IS what renders.
 */
export function renderRunDraftFields(
  run: Pick<MailRun, 'recipients' | 'fieldMap'>,
  template: Pick<Draft, 'subject' | 'body' | 'bodyHtml'>,
  rowIndex: number,
): RenderedRunFields | null {
  const recipients = run.recipients
  const row = recipients?.rows[rowIndex]
  if (!recipients || !row) return null
  const values = resolveRunValues(recipients, row, run.fieldMap)
  const email = (values.email ?? '').trim()
  const subject = substituteRunTokens(template.subject, values)
  const text = renderRunBodyText(template.body, values)
  const html = template.bodyHtml
    ? renderRunBodyHtml(template.bodyHtml, values)
    : renderRunBodyHtml(plainTextToComposeHtml(template.body), values)
  const missing = [...new Set([...subject.missing, ...text.missing, ...html.missing])]
    .filter(token => normalizeRunKey(token) !== RUN_NOTE_TOKEN)
  return {
    to: { name: displayNameForRow(values, run.fieldMap), email },
    subject: subject.text,
    body: text.text,
    bodyHtml: html.html,
    missing,
  }
}

// ── Runs in the store ──────────────────────────────────────────────────

function stampOf(now: string): string {
  return now.replace(/[^0-9]/g, '')
}

export function createRunId(store: Pick<MailStore, 'runs'>, now: string): string {
  return `run_${stampOf(now)}_${(store.runs ?? []).length + 1}`
}

export function findRun(store: Pick<MailStore, 'runs'>, runId: string): MailRun | undefined {
  return (store.runs ?? []).find(run => run.id === runId)
}

export function replaceRun(store: MailStore, run: MailRun): MailStore {
  const runs = store.runs ?? []
  return {
    ...store,
    runs: runs.some(item => item.id === run.id)
      ? runs.map(item => (item.id === run.id ? run : item))
      : [...runs, run],
  }
}

/** Runs still on the rail: anything not archived. */
export function activeRuns(store: Pick<MailStore, 'runs'>): MailRun[] {
  return (store.runs ?? []).filter(run => !run.archivedAt)
}

export function draftLabel(draft: Pick<Draft, 'to' | 'subject'>): string {
  const first = draft.to[0]
  return first?.name?.trim() || first?.email || draft.subject || '(no recipient)'
}

function draftsMailboxIdFor(store: MailStore, accountId: string): string {
  return (
    store.mailboxes.find(
      mailbox => mailbox.role === 'drafts' && mailbox.accountId === accountId,
    )?.id ??
    store.mailboxes.find(mailbox => mailbox.role === 'drafts')?.id ??
    store.mailboxes[0]?.id ??
    ''
  )
}

export interface CreateRunInput {
  /** Caller-minted id (createRunId) when it must be known before the store updates. */
  id?: string
  name: string
  accountId: string
  templateDraftId?: string
  recipients?: MailRunRecipients
  fieldMap?: Record<string, MailRunFieldBinding>
}

/** A run in setup: a template draft, a list, a mapping — nothing rendered. */
export function createRun(
  store: MailStore,
  input: CreateRunInput,
  now = new Date().toISOString(),
): { store: MailStore; run: MailRun } {
  const template = input.templateDraftId
    ? store.drafts.find(draft => draft.id === input.templateDraftId)
    : undefined
  const run: MailRun = {
    id: input.id ?? createRunId(store, now),
    name: input.name.trim() || 'Untitled run',
    accountId: input.accountId,
    status: 'setup',
    ...(input.templateDraftId ? { template: { draftId: input.templateDraftId } } : {}),
    ...(input.recipients ? { recipients: input.recipients } : {}),
    fieldMap:
      input.fieldMap ?? (input.recipients ? guessRunFieldMap(input.recipients.columns) : {}),
    noteSlot: template ? bodyHasNoteSlot(template) : false,
    items: [],
    cursor: 0,
    createdAt: now,
    updatedAt: now,
  }
  let next = replaceRun(store, run)
  if (template) {
    next = {
      ...next,
      drafts: next.drafts.map(draft =>
        draft.id === template.id
          ? { ...draft, draftKind: 'run_template', runId: run.id }
          : draft,
      ),
    }
  }
  return { store: next, run }
}

/** The template draft a run renders from, minted empty for a new run. */
export function createRunTemplateDraft(
  store: MailStore,
  input: { accountId: string; runId?: string; subject?: string; body?: string; bodyHtml?: string; attachments?: Attachment[] },
  now = new Date().toISOString(),
): { store: MailStore; draft: Draft; thread: MailThread } {
  const stamp = stampOf(now)
  const account = store.accounts.find(item => item.id === input.accountId)
  const draftId = `draft_run_template_${stamp}`
  const threadId = `thread_run_template_${stamp}`
  const subject = input.subject?.trim() || ''
  const thread: MailThread = {
    id: threadId,
    accountId: input.accountId,
    mailboxId: draftsMailboxIdFor(store, input.accountId),
    subject: subject || 'Run template',
    participants: [{ name: account?.name ?? 'Me', email: account?.email ?? '' }],
    labels: [],
    status: 'waiting',
    priority: 'none',
    summary: (input.body ?? '').trim().slice(0, 160) || 'Send run template',
    lastMessageAt: now,
    syncState: 'pending',
  }
  const draft: Draft = {
    id: draftId,
    threadId,
    to: [],
    cc: [],
    bcc: [],
    subject,
    body: input.body ?? '',
    ...(input.bodyHtml ? { bodyHtml: input.bodyHtml } : {}),
    attachments: input.attachments ?? [],
    updatedAt: now,
    syncState: 'pending',
    source: 'manual',
    draftKind: 'run_template',
    ...(input.runId ? { runId: input.runId } : {}),
    provenance: ['Template for a send run. Not sent itself.'],
  }
  return {
    store: {
      ...store,
      threads: [thread, ...store.threads],
      drafts: [...store.drafts, draft],
    },
    draft,
    thread,
  }
}

/**
 * Inherit existing drafts: a run with no template or list, its items the
 * given drafts in the given order. The drafts stay where they are —
 * editable in Drafts and in the run's card alike.
 */
export function createRunFromDrafts(
  store: MailStore,
  input: { id?: string; name: string; accountId: string; draftIds: string[] },
  now = new Date().toISOString(),
): { store: MailStore; run: MailRun; missing: string[] } {
  const created = createRun(
    store,
    { ...(input.id ? { id: input.id } : {}), name: input.name, accountId: input.accountId },
    now,
  )
  const added = addDraftsToRun(created.store, created.run, input.draftIds, now)
  return { store: added.store, run: added.run, missing: added.missing }
}

/** "Add existing drafts…": append unsent drafts not already in the run. */
export function addDraftsToRun(
  store: MailStore,
  run: MailRun,
  draftIds: string[],
  now = new Date().toISOString(),
): { store: MailStore; run: MailRun; missing: string[]; added: string[] } {
  const missing: string[] = []
  const added: string[] = []
  const present = new Set(run.items.map(item => item.draftId))
  const items = [...run.items]
  for (const draftId of draftIds) {
    if (present.has(draftId)) continue
    const draft = store.drafts.find(item => item.id === draftId && !item.sentAt)
    if (!draft) {
      missing.push(draftId)
      continue
    }
    present.add(draftId)
    added.push(draftId)
    items.push({
      draftId,
      status: 'pending',
      label: draftLabel(draft),
      noteAdded: draftHasNote(draft),
    })
  }
  const nextRun: MailRun = {
    ...run,
    items,
    status:
      run.status === 'setup' && items.length > 0 && !run.template
        ? 'ready'
        : run.status === 'done' && added.length
          ? 'ready'
          : run.status,
    updatedAt: now,
  }
  const drafts = store.drafts.map(draft =>
    added.includes(draft.id) ? { ...draft, runId: run.id } : draft,
  )
  return { store: replaceRun({ ...store, drafts }, nextRun), run: nextRun, missing, added }
}

export interface RenderRunResult {
  store: MailStore
  run: MailRun
  /** Drafts created for the first time. */
  created: number
  /** Unsent drafts re-rendered in place. */
  updated: number
  /** Rows excluded, with reasons — invalid addresses, duplicates. */
  excluded: Array<{ rowIndex: number; reason: string }>
  missingTokens: string[]
}

/**
 * Render (or re-render) the run's drafts from its template.
 *
 * Idempotent per row: an unsent item's draft is updated in place (keeping
 * its id, its provider copy and any personal note already typed); a sent
 * item is never touched; a row whose draft was deleted gets a new one; an
 * unsent item whose row no longer validates is removed along with its
 * draft. Inherited drafts (no rowIndex) ride through untouched.
 */
export function renderRun(
  store: MailStore,
  runId: string,
  now = new Date().toISOString(),
): RenderRunResult {
  const run = findRun(store, runId)
  if (!run) throw new Error(`No run "${runId}".`)
  if (!run.template) throw new Error('This run has no template to render from.')
  const template = store.drafts.find(draft => draft.id === run.template?.draftId)
  if (!template) throw new Error('The run\'s template draft no longer exists.')
  if (!run.recipients) throw new Error('This run has no recipient list yet.')

  const validation = validateRunRecipients(run.recipients, run.fieldMap)
  const excluded = [
    ...validation.invalid,
    ...validation.duplicates.map(duplicate => ({
      rowIndex: duplicate.rowIndex,
      reason: `Duplicate of row ${duplicate.firstRowIndex + 1} (${duplicate.email}).`,
    })),
  ].sort((a, b) => a.rowIndex - b.rowIndex)
  const validSet = new Set(validation.validRowIndexes)
  const stamp = stampOf(now)
  const draftsMailboxId = draftsMailboxIdFor(store, run.accountId)
  const account = store.accounts.find(item => item.id === run.accountId)
  const from: MailContact = { name: account?.name ?? 'Me', email: account?.email ?? '' }

  let drafts = [...store.drafts]
  let threads = [...store.threads]
  const messages = store.messages
  const missingTokens = new Set<string>()
  let created = 0
  let updated = 0

  const byRow = new Map<number, MailRunItem>()
  for (const item of run.items) {
    if (item.rowIndex !== undefined) byRow.set(item.rowIndex, item)
  }

  // Unsent items whose row is gone or now invalid: draft and thread go.
  for (const item of run.items) {
    if (item.rowIndex === undefined || item.status === 'sent') continue
    if (validSet.has(item.rowIndex)) continue
    const draft = drafts.find(entry => entry.id === item.draftId)
    if (draft && !draft.sentAt) {
      drafts = drafts.filter(entry => entry.id !== draft.id)
      const stillHosted =
        drafts.some(entry => entry.threadId === draft.threadId) ||
        messages.some(message => message.threadId === draft.threadId)
      if (!stillHosted) threads = threads.filter(thread => thread.id !== draft.threadId)
    }
    byRow.delete(item.rowIndex)
  }

  const renderedItems: MailRunItem[] = []
  for (const rowIndex of validation.validRowIndexes) {
    const fields = renderRunDraftFields(run, template, rowIndex)
    if (!fields) continue
    fields.missing.forEach(token => missingTokens.add(token))
    const existing = byRow.get(rowIndex)
    const existingDraft = existing
      ? drafts.find(draft => draft.id === existing.draftId)
      : undefined
    if (existing?.status === 'sent') {
      renderedItems.push(existing)
      continue
    }
    if (existingDraft && !existingDraft.sentAt) {
      // Keep a note the user already typed into this recipient's slot.
      const note = noteTextFromBodyHtml(existingDraft.bodyHtml)
      const bodyHtml = note ? setNoteInBodyHtml(fields.bodyHtml, note) ?? fields.bodyHtml : fields.bodyHtml
      const { bodyHtml: _stale, ...kept } = existingDraft
      const next: Draft = {
        ...kept,
        to: [fields.to],
        cc: template.cc ?? [],
        bcc: template.bcc ?? [],
        subject: fields.subject,
        body: fields.body,
        bodyHtml,
        attachments: template.attachments,
        updatedAt: now,
        syncState: 'pending',
        draftKind: 'run',
        runId: run.id,
      }
      drafts = drafts.map(draft => (draft.id === next.id ? next : draft))
      threads = threads.map(thread =>
        thread.id === next.threadId
          ? { ...thread, subject: fields.subject, participants: [from, fields.to], summary: fields.body.trim().slice(0, 160) || 'Draft message', lastMessageAt: now }
          : thread,
      )
      updated += 1
      renderedItems.push({
        ...existing!,
        status: existing!.status === 'missing' ? 'pending' : existing!.status,
        label: draftLabel(next),
        noteAdded: Boolean(note),
        emailedThisMonth: emailedThisMonth(store, fields.to.email, new Date(now)),
        skipReason: undefined,
      })
      continue
    }
    const draftId = `draft_run_${stamp}_${rowIndex}`
    const threadId = `thread_run_${stamp}_${rowIndex}`
    const draft: Draft = {
      id: draftId,
      threadId,
      to: [fields.to],
      cc: template.cc ?? [],
      bcc: template.bcc ?? [],
      subject: fields.subject,
      body: fields.body,
      bodyHtml: fields.bodyHtml,
      attachments: template.attachments,
      updatedAt: now,
      syncState: 'pending',
      source: 'manual',
      draftKind: 'run',
      runId: run.id,
      provenance: [`Rendered by run "${run.name}" for row ${rowIndex + 1}. Not sent.`],
    }
    const thread: MailThread = {
      id: threadId,
      accountId: run.accountId,
      mailboxId: draftsMailboxId,
      subject: fields.subject || '(no subject)',
      participants: [from, fields.to],
      labels: [],
      status: 'waiting',
      priority: 'none',
      summary: fields.body.trim().slice(0, 160) || 'Draft message',
      lastMessageAt: now,
      syncState: 'pending',
    }
    drafts.push(draft)
    threads = [thread, ...threads]
    created += 1
    renderedItems.push({
      rowIndex,
      draftId,
      status: 'pending',
      label: draftLabel(draft),
      noteAdded: false,
      emailedThisMonth: emailedThisMonth(store, fields.to.email, new Date(now)),
    })
  }

  const inherited = run.items.filter(item => item.rowIndex === undefined)
  const items = [...renderedItems, ...inherited]
  const hasPending = items.some(item => item.status === 'pending' || item.status === 'reviewing')
  const status: MailRun['status'] =
    !hasPending && items.length
      ? 'done'
      : run.status === 'running' || run.status === 'paused'
        ? run.status
        : 'ready'
  const nextRun: MailRun = {
    ...run,
    items,
    status,
    noteSlot: bodyHasNoteSlot(template),
    updatedAt: now,
  }
  const withCursor: MailRun = { ...nextRun, cursor: Math.max(0, resumeIndex(nextRun)) }
  return {
    store: replaceRun({ ...store, drafts, threads }, withCursor),
    run: withCursor,
    created,
    updated,
    excluded,
    missingTokens: [...missingTokens],
  }
}

/** The `msg_sent_<draftId>_<stamp>` copy sendDraft appends. */
function sentMessageForDraft(store: Pick<MailStore, 'messages'>, draftId: string) {
  return store.messages.find(message => message.id.startsWith(`msg_sent_${draftId}_`))
}

/**
 * Bring a run's items up to date with the drafts as they are NOW: a draft
 * sent outside the run counts as sent, a deleted draft becomes `missing`,
 * labels and note flags follow edits made in Drafts. Returns the same run
 * object when nothing changed, so callers can skip a store write.
 */
export function reconcileRun(
  store: Pick<MailStore, 'drafts' | 'messages'>,
  run: MailRun,
): MailRun {
  let changed = false
  const items = run.items.map(item => {
    if (item.status === 'sent') return item
    const draft = store.drafts.find(entry => entry.id === item.draftId)
    if (!draft) {
      const sent = sentMessageForDraft(store, item.draftId)
      if (sent) {
        changed = true
        return {
          ...item,
          status: 'sent' as const,
          sentAt: item.sentAt ?? sent.receivedAt,
          sentMessageId: item.sentMessageId ?? sent.id,
          pendingSendId: undefined,
        }
      }
      if (item.status === 'missing') return item
      changed = true
      return {
        ...item,
        status: 'missing' as const,
        skipReason: 'The draft was deleted.',
      }
    }
    if (draft.sentAt) {
      changed = true
      return {
        ...item,
        status: 'sent' as const,
        sentAt: item.sentAt ?? draft.sentAt,
        sentMessageId: item.sentMessageId ?? draft.sentMessageId,
        pendingSendId: undefined,
      }
    }
    const label = draftLabel(draft)
    const noteAdded = draftHasNote(draft)
    const status =
      item.status === 'missing'
        ? ('pending' as const)
        : item.status === 'reviewing' && run.status !== 'running'
          ? ('pending' as const)
          : item.status
    if (label === item.label && noteAdded === Boolean(item.noteAdded) && status === item.status) {
      return item
    }
    changed = true
    return {
      ...item,
      status,
      label,
      noteAdded,
      ...(status === 'pending' && item.status === 'missing' ? { skipReason: undefined } : {}),
    }
  })
  if (!changed) return run
  const hasPending = items.some(item => item.status === 'pending' || item.status === 'reviewing')
  return {
    ...run,
    items,
    status: !hasPending && items.length && run.status !== 'setup' ? 'done' : run.status,
  }
}

// ── Cursor / progress ──────────────────────────────────────────────────

function isOpen(item: MailRunItem): boolean {
  return item.status === 'pending' || item.status === 'reviewing'
}

/** The first open item at or after the cursor, else the first anywhere; -1 when none. */
export function resumeIndex(run: Pick<MailRun, 'items' | 'cursor'>): number {
  const from = Math.max(0, Math.min(run.cursor, run.items.length))
  for (let index = from; index < run.items.length; index += 1) {
    if (isOpen(run.items[index]!)) return index
  }
  for (let index = 0; index < from; index += 1) {
    if (isOpen(run.items[index]!)) return index
  }
  return -1
}

/** The next open item after `from` (wrapping), -1 when none remain. */
export function nextPendingIndex(run: Pick<MailRun, 'items'>, from: number): number {
  const count = run.items.length
  for (let step = 1; step <= count; step += 1) {
    const index = (from + step) % count
    if (index === from) break
    if (isOpen(run.items[index]!)) return index
  }
  return -1
}

/** ⌘←: the item before this one, whatever its status; -1 at the start. */
export function previousIndex(run: Pick<MailRun, 'items'>, from: number): number {
  return from > 0 && from <= run.items.length ? from - 1 : -1
}

export interface RunProgress {
  total: number
  sent: number
  skipped: number
  missing: number
  pending: number
  /** What is still to review: pending + reviewing. */
  toGo: number
}

export function runProgress(run: Pick<MailRun, 'items'>): RunProgress {
  const progress: RunProgress = { total: run.items.length, sent: 0, skipped: 0, missing: 0, pending: 0, toGo: 0 }
  for (const item of run.items) {
    if (item.status === 'sent') progress.sent += 1
    else if (item.status === 'skipped') progress.skipped += 1
    else if (item.status === 'missing') progress.missing += 1
    else progress.pending += 1
  }
  progress.toGo = progress.pending
  return progress
}

export function runSummaryLine(run: Pick<MailRun, 'name' | 'items' | 'status'>): string {
  const progress = runProgress(run)
  const parts = [`${progress.sent} sent`]
  if (progress.skipped) parts.push(`${progress.skipped} skipped`)
  if (progress.missing) parts.push(`${progress.missing} missing`)
  parts.push(run.status === 'done' ? 'done' : `${progress.toGo} to go`)
  return `Run: ${run.name} · ${parts.join(' · ')}`
}

// ── Item transitions ───────────────────────────────────────────────────

function withItem(
  run: MailRun,
  draftId: string,
  patch: (item: MailRunItem) => MailRunItem,
  now: string,
): MailRun {
  if (!run.items.some(item => item.draftId === draftId)) return run
  return {
    ...run,
    items: run.items.map(item => (item.draftId === draftId ? patch(item) : item)),
    updatedAt: now,
  }
}

/** Send pressed: the item counts as sent NOW; the undo hold may still reverse it. */
export function markRunItemSent(
  run: MailRun,
  draftId: string,
  input: { pendingSendId?: string; sentMessageId?: string },
  now = new Date().toISOString(),
): MailRun {
  return withItem(
    run,
    draftId,
    item => ({
      ...item,
      status: 'sent',
      sentAt: now,
      pendingSendId: input.pendingSendId,
      ...(input.sentMessageId ? { sentMessageId: input.sentMessageId } : {}),
      skipReason: undefined,
    }),
    now,
  )
}

/** The hold elapsed and the message left: record its id, clear the hold. */
export function markRunItemCommitted(
  run: MailRun,
  draftId: string,
  sentMessageId: string | undefined,
  now = new Date().toISOString(),
): MailRun {
  return withItem(
    run,
    draftId,
    item => ({
      ...item,
      status: 'sent',
      pendingSendId: undefined,
      ...(sentMessageId ? { sentMessageId } : {}),
    }),
    now,
  )
}

/** Undo pressed, or the provider refused: back to pending, cursor on it. */
export function markRunItemUnsent(
  run: MailRun,
  draftId: string,
  reason: string | undefined,
  now = new Date().toISOString(),
): MailRun {
  const index = run.items.findIndex(item => item.draftId === draftId)
  if (index < 0) return run
  const next = withItem(
    run,
    draftId,
    item => ({
      ...item,
      status: 'pending',
      sentAt: undefined,
      sentMessageId: undefined,
      pendingSendId: undefined,
      skipReason: reason,
    }),
    now,
  )
  return { ...next, cursor: index, status: next.status === 'done' ? 'running' : next.status }
}

export function skipRunItem(
  run: MailRun,
  draftId: string,
  reason?: string,
  now = new Date().toISOString(),
): MailRun {
  return withItem(
    run,
    draftId,
    item =>
      item.status === 'sent'
        ? item
        : { ...item, status: 'skipped', skipReason: reason },
    now,
  )
}

/** Looking at an item marks it `reviewing`; everything else open stays `pending`. */
export function setRunCursor(run: MailRun, index: number, now = new Date().toISOString()): MailRun {
  if (index < 0 || index >= run.items.length) return run
  return {
    ...run,
    cursor: index,
    items: run.items.map((item, position) =>
      position === index
        ? isOpen(item)
          ? { ...item, status: 'reviewing' }
          : item
        : item.status === 'reviewing'
          ? { ...item, status: 'pending' }
          : item,
    ),
    updatedAt: now,
  }
}

/** After a send or skip: move to the next open item, or finish. */
export function advanceRun(run: MailRun, now = new Date().toISOString()): MailRun {
  const cleared: MailRun = {
    ...run,
    items: run.items.map(item =>
      item.status === 'reviewing' ? { ...item, status: 'pending' } : item,
    ),
  }
  const next = nextPendingIndex(cleared, cleared.cursor)
  if (next < 0) {
    const stillOpen = cleared.items.some(isOpen)
    return {
      ...cleared,
      status: stillOpen ? cleared.status : 'done',
      updatedAt: now,
    }
  }
  return setRunCursor({ ...cleared, status: 'running' }, next, now)
}

/** Opening a run: resume at the first open item at or after the cursor. */
export function startRun(run: MailRun, now = new Date().toISOString()): MailRun {
  const index = resumeIndex(run)
  if (index < 0) {
    return { ...run, status: run.items.length ? 'done' : run.status, updatedAt: now }
  }
  return setRunCursor({ ...run, status: 'running' }, index, now)
}

export function pauseRun(run: MailRun, now = new Date().toISOString()): MailRun {
  if (run.status === 'done' || run.status === 'setup') return run
  return {
    ...run,
    status: 'paused',
    items: run.items.map(item =>
      item.status === 'reviewing' ? { ...item, status: 'pending' } : item,
    ),
    updatedAt: now,
  }
}

export function archiveRun(run: MailRun, now = new Date().toISOString()): MailRun {
  return { ...run, archivedAt: now, updatedAt: now }
}

/**
 * Throw a run away: the record, its template draft, and every rendered
 * draft that was never sent (inherited drafts are untagged, not deleted;
 * sent copies stay in Sent). Returns the drafts removed so the shell can
 * forget their provider copies.
 */
export function discardRun(
  store: MailStore,
  runId: string,
): { store: MailStore; removedDrafts: Draft[] } {
  const run = findRun(store, runId)
  if (!run) return { store, removedDrafts: [] }
  const removable = new Set<string>()
  if (run.template) removable.add(run.template.draftId)
  for (const item of run.items) {
    if (item.rowIndex !== undefined && item.status !== 'sent') removable.add(item.draftId)
  }
  const removedDrafts = store.drafts.filter(
    draft => removable.has(draft.id) && !draft.sentAt,
  )
  const removedIds = new Set(removedDrafts.map(draft => draft.id))
  const drafts = store.drafts
    .filter(draft => !removedIds.has(draft.id))
    .map(draft => (draft.runId === runId ? { ...draft, runId: undefined } : draft))
  const hosted = new Set(drafts.map(draft => draft.threadId))
  const withMessages = new Set(store.messages.map(message => message.threadId))
  const orphanThreadIds = new Set(
    removedDrafts
      .map(draft => draft.threadId)
      .filter(threadId => !hosted.has(threadId) && !withMessages.has(threadId)),
  )
  return {
    store: {
      ...store,
      drafts,
      threads: store.threads.filter(thread => !orphanThreadIds.has(thread.id)),
      runs: (store.runs ?? []).filter(item => item.id !== runId),
    },
    removedDrafts,
  }
}

export function renameRun(run: MailRun, name: string, now = new Date().toISOString()): MailRun {
  const trimmed = name.trim()
  if (!trimmed || trimmed === run.name) return run
  return { ...run, name: trimmed, updatedAt: now }
}

/** The single-line status for the rail and Runs index. */
export function runStatusLabel(run: Pick<MailRun, 'status' | 'items'>): string {
  const progress = runProgress(run)
  switch (run.status) {
    case 'setup':
      return 'setup'
    case 'ready':
      return `${progress.total} ready`
    case 'running':
      return `${progress.sent} of ${progress.total} sent`
    case 'paused':
      return `paused · ${progress.sent} of ${progress.total}`
    case 'done':
      return `done · ${progress.sent} sent`
  }
}

// ── The setup prompt box ───────────────────────────────────────────────

export interface RunTemplatePromptInput {
  runId: string
  runName: string
  templateDraftId: string
  /** Tokens the list provides (note excluded — its convention is stated). */
  tokens: string[]
  hasNoteSlot: boolean
  currentSubject: string
  currentBody: string
  request: string
}

/**
 * The message the setup screen's prompt box hands to the DRAWER agent:
 * the user's brief plus everything the run tools need to act on it — run
 * and template ids, the fields the list provides, the note-slot
 * convention, and the current template so a revision is a revision.
 */
export function buildRunTemplatePrompt(input: RunTemplatePromptInput): string {
  const fields = input.tokens.length
    ? input.tokens.map(token => `{{${token}}}`).join(', ')
    : 'none yet (no recipient list attached) — write with {{first_name}} and {{email}} anyway'
  const current = input.currentSubject.trim() || input.currentBody.trim()
    ? `Current template (revise it, keep what still fits):\nSubject: ${input.currentSubject.trim() || '(none)'}\n${input.currentBody.trim() || '(empty body)'}`
    : 'The template is empty.'
  return [
    `Draft the template for send run "${input.runName}" in PureMail (runId ${input.runId}, templateDraftId ${input.templateDraftId}).`,
    `Fields available from the recipient list: ${fields}. Use {{field}} tokens where the message should personalise.`,
    input.hasNoteSlot
      ? 'Keep the existing {{note}} slot — exactly one — for a personal line typed per recipient during the run (it is dropped from drafts where it stays empty).'
      : 'Leave exactly one {{note}} slot for a personal line typed per recipient during the run (it is dropped from drafts where it stays empty).',
    `Write it with updateDraft(templateDraftId, { subject, body }) as plain text — call getRun ${input.runId} first for the field map. Do not renderRun or send; the user reviews in the setup screen.`,
    current,
    `Brief: ${input.request.trim()}`,
  ].join('\n\n')
}
