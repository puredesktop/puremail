import type { AgentToolHandlerResult } from '@purescience/platform-ui/bridge/react/usePlatformAgentTools'
import {
  activeRuns,
  addDraftsToRun,
  advanceRun,
  archiveRun,
  bodyHasNoteSlot,
  createRun,
  createRunFromDrafts,
  createRunId,
  createRunTemplateDraft,
  draftHasNote,
  findRun,
  guessRunFieldMap,
  markRunItemCommitted,
  markRunItemSent,
  markRunItemUnsent,
  noteTextFromBodyHtml,
  parsePastedRecipients,
  pauseRun,
  recipientsFromCsv,
  recipientsFromSheetsWorkbook,
  reconcileRun,
  renderRun,
  renderRunDraftFields,
  replaceRun,
  runAvailableTokens,
  runProgress,
  runStatusLabel,
  runTokensIn,
  setNoteInBodyHtml,
  skipRunItem,
  startRun,
  templateNoteSlotHtml,
  validateRunRecipients,
  RUN_NOTE_TOKEN,
  normalizeRunKey,
} from '../lib/mailRuns'
import { plainTextToComposeHtml } from '../lib/mailCompose'
import type {
  MailRun,
  MailRunFieldBinding,
  MailRunItem,
  MailRunRecipients,
  MailStore,
} from '../types'
import {
  AgentMailToolError,
  optionalNumber,
  optionalString,
  requireString,
  type MailAgentToolContext,
} from './catalog'

/*
 * Send-run tools. Every handler drives the same pure functions and store
 * paths the run screens use (lib/mailRuns + the shell's sendStoreDraft),
 * so an agent and the user are always looking at one run.
 *
 * There is deliberately no "send all": sendRunItem sends ONE item per
 * call, each call approval-gated, each send under the usual undo hold.
 */

function ok(payload: unknown): AgentToolHandlerResult {
  return { content: JSON.stringify(payload, null, 2) }
}

const TEMPLATE_CONVENTIONS =
  'Template conventions: {{field}} tokens are substituted per recipient from the mapped columns (e.g. {{first_name}}, {{email}}, or any column name); {{note}} marks the personal-note slot — one per template, filled per draft during the run and dropped entirely from any draft where it is left empty. Write the template body as plain text with updateDraft (body + subject) — tokens work in both.'

const NO_BULK_SEND_NOTE =
  'A run never bulk-sends: sendRunItem sends exactly one item per call, each call approved by the user, each send undoable for the usual hold.'

function requireRun(context: MailAgentToolContext, runId: string): MailRun {
  const run = findRun(context.store, runId)
  if (!run) {
    throw new AgentMailToolError(
      `No run with id "${runId}". Call listRuns to see what exists.`,
    )
  }
  return run
}

function requireAccountId(context: MailAgentToolContext): string {
  const accountId = context.accountId ?? context.store.accounts[0]?.id
  if (!accountId) throw new AgentMailToolError('No mail account is connected.')
  return accountId
}

/** Mutate one run through a pure step, the way the shell's updateRun does. */
function updateRunInStore(
  context: MailAgentToolContext,
  runId: string,
  update: (run: MailRun, store: MailStore) => MailRun,
): void {
  context.setStore(current => {
    const run = findRun(current, runId)
    if (!run) return current
    const next = update(run, current)
    return next === run ? current : replaceRun(current, next)
  })
}

function itemSummary(
  context: MailAgentToolContext,
  run: MailRun,
  item: MailRunItem,
  index: number,
): Record<string, unknown> {
  const draft = context.store.drafts.find(entry => entry.id === item.draftId)
  return {
    position: index + 1,
    ...(item.rowIndex !== undefined ? { row: item.rowIndex + 1 } : { inherited: true }),
    draftId: item.draftId,
    status: item.status,
    label: item.label ?? null,
    to: draft?.to.map(contact => contact.email) ?? null,
    subject: draft?.subject ?? null,
    noteAdded: Boolean(item.noteAdded || (draft && draftHasNote(draft))),
    ...(item.sentAt ? { sentAt: item.sentAt } : {}),
    ...(item.pendingSendId ? { sendPending: true } : {}),
    ...(item.skipReason ? { reason: item.skipReason } : {}),
    ...(item.emailedThisMonth ? { emailedThisMonth: true } : {}),
    current: index === run.cursor,
  }
}

function runSummary(
  context: MailAgentToolContext,
  run: MailRun,
  full: boolean,
): Record<string, unknown> {
  const progress = runProgress(run)
  const validation = validateRunRecipients(run.recipients, run.fieldMap)
  const template = run.template
    ? context.store.drafts.find(draft => draft.id === run.template?.draftId)
    : undefined
  const base = {
    runId: run.id,
    name: run.name,
    status: run.status,
    statusLabel: runStatusLabel(run),
    progress,
    templateDraftId: run.template?.draftId ?? null,
    templateExists: Boolean(template),
    noteSlot: template ? bodyHasNoteSlot(template) : run.noteSlot,
    recipients: run.recipients
      ? {
          source: run.recipients.source.label,
          kind: run.recipients.source.kind,
          rows: run.recipients.rows.length,
          columns: run.recipients.columns,
          valid: validation.validRowIndexes.length,
          invalid: validation.invalid.length,
          duplicates: validation.duplicates.length,
        }
      : null,
    fieldMap: run.fieldMap,
    availableTokens: runAvailableTokens(run),
    updatedAt: run.updatedAt,
    ...(run.archivedAt ? { archivedAt: run.archivedAt } : {}),
  }
  if (!full) return base
  const current = run.items[run.cursor]
  return {
    ...base,
    cursor: run.items.length ? run.cursor + 1 : null,
    currentItem: current ? itemSummary(context, run, current, run.cursor) : null,
    items: run.items.map((item, index) => itemSummary(context, run, item, index)),
    ...(validation.invalid.length
      ? { invalidRows: validation.invalid.map(entry => ({ row: entry.rowIndex + 1, reason: entry.reason })) }
      : {}),
    ...(validation.duplicates.length
      ? {
          duplicateRows: validation.duplicates.map(entry => ({
            row: entry.rowIndex + 1,
            duplicateOf: entry.firstRowIndex + 1,
            email: entry.email,
          })),
        }
      : {}),
    ...(template
      ? {
          template: {
            subject: template.subject,
            body: template.body,
            tokensUsed: runTokensIn(`${template.subject} ${template.body}`),
            attachments: template.attachments.map(attachment => attachment.name),
          },
        }
      : {}),
  }
}

/** The item a tool means: by draftId, by 1-based row, or the current one. */
function resolveItem(
  run: MailRun,
  args: Record<string, unknown>,
): { item: MailRunItem; index: number } {
  const draftId = optionalString(args, 'draftId')
  const row = optionalNumber(args, 'row')
  let index = -1
  if (draftId) {
    index = run.items.findIndex(item => item.draftId === draftId)
    if (index < 0) {
      throw new AgentMailToolError(
        `Draft "${draftId}" is not in run "${run.name}". getRun lists its items.`,
      )
    }
  } else if (row !== undefined) {
    index = run.items.findIndex(item => item.rowIndex === row - 1)
    if (index < 0) {
      throw new AgentMailToolError(
        `Row ${row} has no item in run "${run.name}" (invalid or duplicate rows are excluded). getRun lists its items.`,
      )
    }
  } else {
    if (!run.items.length) {
      throw new AgentMailToolError('The run has no items yet — renderRun first.')
    }
    index = Math.min(Math.max(run.cursor, 0), run.items.length - 1)
  }
  return { item: run.items[index]!, index }
}

async function recipientsFromArgs(
  context: MailAgentToolContext,
  args: Record<string, unknown>,
): Promise<MailRunRecipients | null> {
  const pasted = optionalString(args, 'recipients')
  const path = optionalString(args, 'recipientsPath')
  if (pasted) return parsePastedRecipients(pasted)
  if (!path) return null
  if (!context.readTextFile) {
    throw new AgentMailToolError('Reading files is unavailable in this session; pass the addresses in "recipients" instead.')
  }
  if (!path.startsWith('/')) {
    throw new AgentMailToolError(`"recipientsPath" must be an absolute path, not "${path}".`)
  }
  const label = path.replace(/\/+$/, '').split('/').pop() ?? path
  const lower = path.toLowerCase()
  let raw: string
  try {
    raw = lower.endsWith('.sheets')
      ? await context.readTextFile(`${path.replace(/\/+$/, '')}/workbook.json`).catch(() =>
          context.readTextFile!(path),
        )
      : await context.readTextFile(path)
  } catch (error) {
    throw new AgentMailToolError(
      `Could not read "${path}": ${error instanceof Error ? error.message : String(error)}.`,
    )
  }
  if (lower.endsWith('.sheets') || lower.endsWith('.sheets.html') || lower.endsWith('.json')) {
    const json = lower.endsWith('.sheets.html')
      ? JSON.parse(
          /<script[^>]*id=["']puresheets-workbook-data["'][^>]*>([\s\S]*?)<\/script>/i.exec(raw)?.[1] ?? 'null',
        )
      : JSON.parse(raw)
    return recipientsFromSheetsWorkbook(json, { kind: 'sheet', path, label })
  }
  return recipientsFromCsv(raw, { kind: 'csv', path, label })
}

function fieldMapFromArgs(args: Record<string, unknown>): Record<string, MailRunFieldBinding> | undefined {
  const raw = args.fieldMap
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const map: Record<string, MailRunFieldBinding> = {}
  for (const [token, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string' && value.trim()) {
      map[normalizeRunKey(token)] = { column: value.trim() }
    } else if (value && typeof value === 'object') {
      const binding = value as { column?: unknown; transform?: unknown }
      if (typeof binding.column === 'string' && binding.column.trim()) {
        map[normalizeRunKey(token)] = {
          column: binding.column.trim(),
          ...(binding.transform === 'first-word' ? { transform: 'first-word' as const } : {}),
        }
      }
    }
  }
  return map
}

// ── Reads ──────────────────────────────────────────────────────────────

export function listRunsHandler(
  context: MailAgentToolContext,
  args: Record<string, unknown>,
): AgentToolHandlerResult {
  const includeArchived = args.includeArchived === true
  const runs = (includeArchived ? context.store.runs ?? [] : activeRuns(context.store))
    .map(run => reconcileRun(context.store, run))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return ok({
    total: runs.length,
    runs: runs.map(run => runSummary(context, run, false)),
    note: runs.length
      ? 'Call getRun for a run\'s items and cursor before acting on it.'
      : 'No send runs yet. createRun starts one from a template draft and a recipient list; createRunFromDrafts loops over drafts that already exist.',
  })
}

export function getRunHandler(
  context: MailAgentToolContext,
  args: Record<string, unknown>,
): AgentToolHandlerResult {
  const run = reconcileRun(context.store, requireRun(context, requireString(args, 'runId')))
  return ok({
    ...runSummary(context, run, true),
    conventions: TEMPLATE_CONVENTIONS,
    note: NO_BULK_SEND_NOTE,
  })
}

// ── Setup ──────────────────────────────────────────────────────────────

export async function createRunHandler(
  context: MailAgentToolContext,
  args: Record<string, unknown>,
): Promise<AgentToolHandlerResult> {
  const accountId = requireAccountId(context)
  const name = requireString(args, 'name')
  const templateDraftId = optionalString(args, 'templateDraftId')
  if (templateDraftId) {
    const draft = context.store.drafts.find(item => item.id === templateDraftId)
    if (!draft) {
      throw new AgentMailToolError(`No draft with id "${templateDraftId}". listDrafts shows what exists.`)
    }
    if (draft.sentAt) throw new AgentMailToolError('That draft has been sent; a template must be an unsent draft.')
    if (draft.runId && draft.draftKind === 'run_template') {
      throw new AgentMailToolError(`Draft "${templateDraftId}" is already the template of run "${draft.runId}".`)
    }
  }
  const recipients = await recipientsFromArgs(context, args)
  const explicitMap = fieldMapFromArgs(args)
  const subject = optionalString(args, 'subject')
  const body = optionalString(args, 'body')
  const now = (context.now ?? new Date()).toISOString()
  const runId = createRunId(context.store, now)
  const newTemplateId = templateDraftId ? null : `draft_run_template_${now.replace(/[^0-9]/g, '')}`
  context.setStore(current => {
    let next = current
    let templateId = templateDraftId
    if (!templateId) {
      next = createRunTemplateDraft(
        next,
        {
          accountId,
          runId,
          ...(subject ? { subject } : {}),
          ...(body ? { body, bodyHtml: plainTextToComposeHtml(body) } : {}),
        },
        now,
      ).store
      templateId = newTemplateId!
    } else if (subject || body) {
      next = {
        ...next,
        drafts: next.drafts.map(draft =>
          draft.id === templateId
            ? {
                ...draft,
                ...(subject ? { subject } : {}),
                ...(body ? { body, bodyHtml: plainTextToComposeHtml(body) } : {}),
                updatedAt: now,
                syncState: 'pending' as const,
              }
            : draft,
        ),
      }
    }
    return createRun(
      next,
      {
        id: runId,
        name,
        accountId,
        templateDraftId: templateId,
        ...(recipients ? { recipients } : {}),
        ...(explicitMap ? { fieldMap: explicitMap } : {}),
      },
      now,
    ).store
  })
  const validation = recipients
    ? validateRunRecipients(recipients, explicitMap ?? guessRunFieldMap(recipients.columns))
    : null
  return ok({
    runId,
    name,
    status: 'setup',
    templateDraftId: templateDraftId ?? newTemplateId,
    recipients: recipients
      ? {
          rows: recipients.rows.length,
          columns: recipients.columns,
          valid: validation!.validRowIndexes.length,
          invalid: validation!.invalid.length,
          duplicates: validation!.duplicates.length,
        }
      : null,
    fieldMap: explicitMap ?? (recipients ? guessRunFieldMap(recipients.columns) : {}),
    availableTokens: recipients
      ? runAvailableTokens({ recipients, fieldMap: explicitMap ?? guessRunFieldMap(recipients.columns) })
      : [RUN_NOTE_TOKEN],
    next: [
      'Write the template with updateDraft(templateDraftId, { subject, body }) using {{field}} tokens and one {{note}} slot.',
      recipients ? null : 'Attach a list with setRunRecipients (pasted addresses, a CSV path, or a .sheets path).',
      'Check the mapping with getRun (fieldMap / availableTokens), then renderRun to create the drafts.',
    ].filter(Boolean),
    conventions: TEMPLATE_CONVENTIONS,
    note: 'Nothing sends here. ' + NO_BULK_SEND_NOTE,
  })
}

export function createRunFromDraftsHandler(
  context: MailAgentToolContext,
  args: Record<string, unknown>,
): AgentToolHandlerResult {
  const accountId = requireAccountId(context)
  const raw = args.draftIds
  if (!Array.isArray(raw) || !raw.length || !raw.every(item => typeof item === 'string')) {
    throw new AgentMailToolError('"draftIds" must be a non-empty array of draft ids (listDrafts shows them).')
  }
  const draftIds = raw as string[]
  const now = (context.now ?? new Date()).toISOString()
  const preview = createRunFromDrafts(
    context.store,
    { name: optionalString(args, 'name') ?? `Review ${draftIds.length} drafts`, accountId, draftIds },
    now,
  )
  if (!preview.run.items.length) {
    throw new AgentMailToolError(
      `None of those drafts exist unsent: ${preview.missing.join(', ')}. listDrafts shows what does.`,
    )
  }
  const runId = createRunId(context.store, now)
  const name = optionalString(args, 'name') ?? `Review ${preview.run.items.length} draft${preview.run.items.length === 1 ? '' : 's'}`
  context.setStore(current => createRunFromDrafts(current, { id: runId, name, accountId, draftIds }, now).store)
  return ok({
    runId,
    name,
    status: 'ready',
    items: preview.run.items.map(item => ({ draftId: item.draftId, label: item.label })),
    ...(preview.missing.length ? { skipped: preview.missing } : {}),
    note:
      'The drafts stay ordinary drafts — editable in Drafts and in the run. resumeRun opens the loop for the user; sendRunItem sends one at a time. ' +
      NO_BULK_SEND_NOTE,
  })
}

export async function setRunRecipientsHandler(
  context: MailAgentToolContext,
  args: Record<string, unknown>,
): Promise<AgentToolHandlerResult> {
  const run = requireRun(context, requireString(args, 'runId'))
  const recipients = await recipientsFromArgs(context, args)
  if (!recipients) {
    throw new AgentMailToolError('Pass "recipients" (one address per line: email, "Name <email>", or "email, name") or "recipientsPath" (an absolute CSV or .sheets path).')
  }
  if (!recipients.rows.length) throw new AgentMailToolError('No recipients found in that source.')
  const explicitMap = fieldMapFromArgs(args)
  const fieldMap = explicitMap ?? guessRunFieldMap(recipients.columns)
  const now = (context.now ?? new Date()).toISOString()
  updateRunInStore(context, run.id, current => ({ ...current, recipients, fieldMap, updatedAt: now }))
  const validation = validateRunRecipients(recipients, fieldMap)
  return ok({
    runId: run.id,
    source: recipients.source.label,
    rows: recipients.rows.length,
    columns: recipients.columns,
    fieldMap,
    availableTokens: runAvailableTokens({ recipients, fieldMap }),
    valid: validation.validRowIndexes.length,
    invalid: validation.invalid.map(entry => ({ row: entry.rowIndex + 1, reason: entry.reason })),
    duplicates: validation.duplicates.map(entry => ({ row: entry.rowIndex + 1, email: entry.email })),
    note: run.items.some(item => item.rowIndex !== undefined)
      ? 'The run already has rendered drafts: renderRun again to re-render unsent ones from the new list (sent items are never touched).'
      : 'Check fieldMap — setRunFieldMap fixes a wrong guess — then renderRun.',
  })
}

export function setRunFieldMapHandler(
  context: MailAgentToolContext,
  args: Record<string, unknown>,
): AgentToolHandlerResult {
  const run = requireRun(context, requireString(args, 'runId'))
  if (!run.recipients) throw new AgentMailToolError('The run has no recipient list yet — setRunRecipients first.')
  const map = fieldMapFromArgs(args)
  if (!map || !Object.keys(map).length) {
    throw new AgentMailToolError(
      '"fieldMap" must map token names to column names, e.g. { "email": "Email", "first_name": { "column": "Name", "transform": "first-word" } }.',
    )
  }
  const columns = run.recipients.columns
  for (const [token, binding] of Object.entries(map)) {
    if (!columns.includes(binding.column)) {
      throw new AgentMailToolError(
        `Column "${binding.column}" (for {{${token}}}) is not in the list. Columns: ${columns.join(', ')}.`,
      )
    }
  }
  const fieldMap = { ...run.fieldMap, ...map }
  const now = (context.now ?? new Date()).toISOString()
  updateRunInStore(context, run.id, current => ({ ...current, fieldMap, updatedAt: now }))
  const validation = validateRunRecipients(run.recipients, fieldMap)
  return ok({
    runId: run.id,
    fieldMap,
    availableTokens: runAvailableTokens({ recipients: run.recipients, fieldMap }),
    valid: validation.validRowIndexes.length,
    invalid: validation.invalid.length,
    duplicates: validation.duplicates.length,
  })
}

export function setRunTemplateHandler(
  context: MailAgentToolContext,
  args: Record<string, unknown>,
): AgentToolHandlerResult {
  const run = requireRun(context, requireString(args, 'runId'))
  const accountId = run.accountId
  const draftId = optionalString(args, 'draftId')
  const subject = optionalString(args, 'subject')
  const body = optionalString(args, 'body')
  const now = (context.now ?? new Date()).toISOString()
  let templateId = draftId ?? run.template?.draftId ?? null
  if (draftId) {
    const draft = context.store.drafts.find(item => item.id === draftId)
    if (!draft) throw new AgentMailToolError(`No draft with id "${draftId}". listDrafts shows what exists.`)
    if (draft.sentAt) throw new AgentMailToolError('That draft has been sent; a template must be an unsent draft.')
  }
  const newTemplateId = templateId ? null : `draft_run_template_${now.replace(/[^0-9]/g, '')}`
  if (!templateId) templateId = newTemplateId
  if (!templateId) throw new AgentMailToolError('Could not mint a template draft.')
  const finalTemplateId = templateId
  context.setStore(current => {
    let next = current
    if (newTemplateId) {
      next = createRunTemplateDraft(next, { accountId, runId: run.id }, now).store
    }
    next = {
      ...next,
      drafts: next.drafts.map(draft =>
        draft.id === finalTemplateId
          ? {
              ...draft,
              draftKind: 'run_template' as const,
              runId: run.id,
              ...(subject !== undefined ? { subject } : {}),
              ...(body !== undefined ? { body, bodyHtml: plainTextToComposeHtml(body) } : {}),
              updatedAt: now,
              syncState: 'pending' as const,
            }
          : draft,
      ),
    }
    const target = findRun(next, run.id)
    if (!target) return next
    const template = next.drafts.find(draft => draft.id === finalTemplateId)
    return replaceRun(next, {
      ...target,
      template: { draftId: finalTemplateId },
      noteSlot: template ? bodyHasNoteSlot(template) : false,
      updatedAt: now,
    })
  })
  const bodyText = body ?? context.store.drafts.find(item => item.id === finalTemplateId)?.body ?? ''
  const subjectText = subject ?? context.store.drafts.find(item => item.id === finalTemplateId)?.subject ?? ''
  return ok({
    runId: run.id,
    templateDraftId: finalTemplateId,
    tokensUsed: runTokensIn(`${subjectText} ${bodyText}`),
    noteSlot: bodyHasNoteSlot({ body: bodyText }),
    availableTokens: runAvailableTokens(run),
    conventions: TEMPLATE_CONVENTIONS,
    note: 'The template is an ordinary unsent draft in Drafts. Keep editing it with updateDraft; renderRun when ready.',
  })
}

export function insertRunNoteSlotHandler(
  context: MailAgentToolContext,
  args: Record<string, unknown>,
): AgentToolHandlerResult {
  const run = requireRun(context, requireString(args, 'runId'))
  const template = run.template
    ? context.store.drafts.find(draft => draft.id === run.template?.draftId)
    : undefined
  if (!template) throw new AgentMailToolError('The run has no template draft — setRunTemplate first.')
  if (bodyHasNoteSlot(template)) {
    return ok({ runId: run.id, templateDraftId: template.id, changed: false, note: 'The template already has a {{note}} slot.' })
  }
  const placement = optionalString(args, 'placement') === 'end' ? 'end' : 'after-first-paragraph'
  const paragraphs = template.body.split(/\n{2,}/)
  const bodyParts =
    placement === 'end' || paragraphs.length < 2
      ? [...paragraphs, `{{${RUN_NOTE_TOKEN}}}`]
      : [paragraphs[0]!, `{{${RUN_NOTE_TOKEN}}}`, ...paragraphs.slice(1)]
  const body = bodyParts.join('\n\n')
  const htmlParas = plainTextToComposeHtml(template.body)
  const slotHtml = templateNoteSlotHtml()
  const bodyHtml = ((): string => {
    if (placement === 'end' || paragraphs.length < 2) return `${htmlParas}${slotHtml}`
    const firstClose = htmlParas.indexOf('</p>')
    return firstClose < 0
      ? `${htmlParas}${slotHtml}`
      : `${htmlParas.slice(0, firstClose + 4)}${slotHtml}${htmlParas.slice(firstClose + 4)}`
  })()
  const now = (context.now ?? new Date()).toISOString()
  context.setStore(current => {
    const next: MailStore = {
      ...current,
      drafts: current.drafts.map(draft =>
        draft.id === template.id ? { ...draft, body, bodyHtml, updatedAt: now, syncState: 'pending' as const } : draft,
      ),
    }
    const target = findRun(next, run.id)
    return target ? replaceRun(next, { ...target, noteSlot: true, updatedAt: now }) : next
  })
  return ok({ runId: run.id, templateDraftId: template.id, changed: true, placement, body })
}

export function previewRunItemHandler(
  context: MailAgentToolContext,
  args: Record<string, unknown>,
): AgentToolHandlerResult {
  const run = requireRun(context, requireString(args, 'runId'))
  const template = run.template
    ? context.store.drafts.find(draft => draft.id === run.template?.draftId)
    : undefined
  if (!template) throw new AgentMailToolError('The run has no template draft — setRunTemplate first.')
  if (!run.recipients) throw new AgentMailToolError('The run has no recipient list — setRunRecipients first.')
  const validation = validateRunRecipients(run.recipients, run.fieldMap)
  const row = optionalNumber(args, 'row')
  const rowIndex = row !== undefined ? row - 1 : validation.validRowIndexes[0]
  if (rowIndex === undefined || rowIndex < 0 || rowIndex >= run.recipients.rows.length) {
    throw new AgentMailToolError(`Row ${row ?? 1} is out of range; the list has ${run.recipients.rows.length} rows.`)
  }
  const fields = renderRunDraftFields(run, template, rowIndex)
  if (!fields) throw new AgentMailToolError('Could not render that row.')
  return ok({
    runId: run.id,
    row: rowIndex + 1,
    excluded: !validation.validRowIndexes.includes(rowIndex)
      ? validation.invalid.find(entry => entry.rowIndex === rowIndex)?.reason ?? 'Duplicate address.'
      : null,
    to: fields.to,
    subject: fields.subject,
    body: fields.body,
    noteSlot: bodyHasNoteSlot(template),
    missingTokens: fields.missing,
    note: 'Nothing was created — this is what renderRun would write for that row.',
  })
}

export function renderRunHandler(
  context: MailAgentToolContext,
  args: Record<string, unknown>,
): AgentToolHandlerResult {
  const run = requireRun(context, requireString(args, 'runId'))
  if (!run.template) throw new AgentMailToolError('The run has no template — setRunTemplate first.')
  const template = context.store.drafts.find(draft => draft.id === run.template?.draftId)
  if (!template) throw new AgentMailToolError('The template draft no longer exists — setRunTemplate again.')
  if (!run.recipients) throw new AgentMailToolError('The run has no recipient list — setRunRecipients first.')
  if (!template.subject.trim() && !template.body.trim()) {
    throw new AgentMailToolError('The template is empty — write it with updateDraft first.')
  }
  const validation = validateRunRecipients(run.recipients, run.fieldMap)
  if (!validation.validRowIndexes.length) {
    throw new AgentMailToolError(
      validation.emailColumn
        ? 'No valid rows to render — every row is invalid or a duplicate. getRun lists the reasons.'
        : 'No email column is mapped — setRunFieldMap with { "email": "<column>" } first.',
    )
  }
  const now = (context.now ?? new Date()).toISOString()
  const preview = renderRun(context.store, run.id, now)
  context.setStore(current => renderRun(current, run.id, now).store)
  return ok({
    runId: run.id,
    created: preview.created,
    updated: preview.updated,
    items: preview.run.items.length,
    excluded: preview.excluded.map(entry => ({ row: entry.rowIndex + 1, reason: entry.reason })),
    missingTokens: preview.missingTokens,
    status: preview.run.status,
    note:
      'Drafts are in Drafts, each an ordinary draft. Nothing sends until the user presses Send & next on each (resumeRun opens the loop) or sendRunItem is approved per item. Re-rendering updates unsent drafts in place and never touches sent ones.',
  })
}

// ── The loop ───────────────────────────────────────────────────────────

export function setRunNoteHandler(
  context: MailAgentToolContext,
  args: Record<string, unknown>,
): AgentToolHandlerResult {
  const run = requireRun(context, requireString(args, 'runId'))
  const note = requireString(args, 'note')
  const { item } = resolveItem(run, args)
  const draft = context.store.drafts.find(entry => entry.id === item.draftId)
  if (!draft || draft.sentAt || item.status === 'sent') {
    throw new AgentMailToolError(`Item "${item.label ?? item.draftId}" is ${item.status === 'sent' ? 'already sent' : 'missing'}; its note cannot change.`)
  }
  const bodyHtml = setNoteInBodyHtml(draft.bodyHtml ?? plainTextToComposeHtml(draft.body), note)
  if (!bodyHtml) {
    throw new AgentMailToolError(
      'That draft has no {{note}} slot. Edit its body with updateDraft instead, or insertRunNoteSlot on the template and renderRun again.',
    )
  }
  const now = (context.now ?? new Date()).toISOString()
  context.setStore(current => {
    const next: MailStore = {
      ...current,
      drafts: current.drafts.map(entry =>
        entry.id === draft.id
          ? {
              ...entry,
              bodyHtml,
              // The plain body carries the note too, for search and text-only clients.
              body: entry.body.replace(/\n{3,}/g, '\n\n'),
              updatedAt: now,
              syncState: 'pending' as const,
            }
          : entry,
      ),
    }
    const target = findRun(next, run.id)
    return target ? replaceRun(next, reconcileRun(next, { ...target, updatedAt: now })) : next
  })
  return ok({
    runId: run.id,
    draftId: draft.id,
    label: item.label ?? null,
    note: noteTextFromBodyHtml(bodyHtml),
    status: 'not_sent',
  })
}

export function sendRunItemHandler(
  context: MailAgentToolContext,
  args: Record<string, unknown>,
): AgentToolHandlerResult {
  if (!context.sendStoreDraft) throw new AgentMailToolError('Sending is unavailable in this session.')
  const run = reconcileRun(context.store, requireRun(context, requireString(args, 'runId')))
  const { item } = resolveItem(run, args)
  if (item.status === 'sent') {
    throw new AgentMailToolError(`"${item.label ?? item.draftId}" was already sent${item.sentAt ? ` at ${item.sentAt}` : ''}.`)
  }
  const draft = context.store.drafts.find(entry => entry.id === item.draftId)
  if (!draft || draft.sentAt) {
    throw new AgentMailToolError(`The draft for "${item.label ?? item.draftId}" no longer exists (deleted from Drafts). renderRun recreates it from the template.`)
  }
  const draftId = draft.id
  const result = context.sendStoreDraft(draft, {
    label: 'Message',
    onCommitted: sentMessageId =>
      updateRunInStore(context, run.id, current => markRunItemCommitted(current, draftId, sentMessageId)),
    onFailed: reason =>
      updateRunInStore(context, run.id, current => markRunItemUnsent(current, draftId, reason)),
  })
  if (!result.ok) throw new AgentMailToolError(result.reason)
  const now = (context.now ?? new Date()).toISOString()
  // With no undo hold the commit already ran (synchronously) — recording
  // a hold id now would leave the item looking pending forever.
  const pendingSendId = result.undoSeconds > 0 ? result.pendingId : undefined
  updateRunInStore(context, run.id, current =>
    advanceRun(markRunItemSent(current, draftId, { pendingSendId }, now), now),
  )
  const remaining = runProgress(run).toGo - 1
  return ok({
    runId: run.id,
    draftId,
    to: draft.to.map(contact => contact.email),
    subject: draft.subject,
    status: result.undoSeconds > 0 ? 'queued' : 'sent',
    undoSeconds: result.undoSeconds,
    remaining: Math.max(0, remaining),
    note:
      result.undoSeconds > 0
        ? `Leaves in ${result.undoSeconds}s unless the user undoes it. One item per call — call sendRunItem again for the next, each call approved separately.`
        : 'Sent. One item per call — call sendRunItem again for the next, each call approved separately.',
  })
}

export function skipRunItemHandler(
  context: MailAgentToolContext,
  args: Record<string, unknown>,
): AgentToolHandlerResult {
  const run = requireRun(context, requireString(args, 'runId'))
  const { item } = resolveItem(run, args)
  if (item.status === 'sent') throw new AgentMailToolError(`"${item.label ?? item.draftId}" was already sent; it cannot be skipped.`)
  const reason = optionalString(args, 'reason')
  const now = (context.now ?? new Date()).toISOString()
  updateRunInStore(context, run.id, current => advanceRun(skipRunItem(current, item.draftId, reason, now), now))
  return ok({
    runId: run.id,
    draftId: item.draftId,
    label: item.label ?? null,
    status: 'skipped',
    note: 'The draft stays in Drafts, unsent. The run moved to the next open item.',
  })
}

export function pauseRunHandler(
  context: MailAgentToolContext,
  args: Record<string, unknown>,
): AgentToolHandlerResult {
  const run = requireRun(context, requireString(args, 'runId'))
  const now = (context.now ?? new Date()).toISOString()
  updateRunInStore(context, run.id, current => pauseRun(current, now))
  return ok({ runId: run.id, status: 'paused', progress: runProgress(run), note: 'The run resumes where it stopped — resumeRun, or the Runs rail.' })
}

export function resumeRunHandler(
  context: MailAgentToolContext,
  args: Record<string, unknown>,
): AgentToolHandlerResult {
  const run = reconcileRun(context.store, requireRun(context, requireString(args, 'runId')))
  if (run.status === 'setup') {
    throw new AgentMailToolError('The run is still in setup — renderRun first (or add drafts with createRunFromDrafts).')
  }
  const now = (context.now ?? new Date()).toISOString()
  const started = startRun(run, now)
  updateRunInStore(context, run.id, (current, store) => startRun(reconcileRun(store, current), now))
  context.openRun?.(run.id)
  const current = started.items[started.cursor]
  return ok({
    runId: run.id,
    status: started.status,
    cursor: started.items.length ? started.cursor + 1 : null,
    currentItem: current ? itemSummary(context, started, current, started.cursor) : null,
    progress: runProgress(started),
    note:
      started.status === 'done'
        ? 'Nothing left to review — the run is done.'
        : 'The run is open on screen at its first open item. The user presses Send & next per draft, or sendRunItem sends one per approved call.',
  })
}

export function archiveRunHandler(
  context: MailAgentToolContext,
  args: Record<string, unknown>,
): AgentToolHandlerResult {
  const run = requireRun(context, requireString(args, 'runId'))
  if (run.status !== 'done') {
    throw new AgentMailToolError(`Run "${run.name}" is ${run.status}, not done; pause it instead, or skip what remains.`)
  }
  const now = (context.now ?? new Date()).toISOString()
  updateRunInStore(context, run.id, current => archiveRun(current, now))
  return ok({ runId: run.id, archived: true, progress: runProgress(run), note: 'Off the rail; the record and the sent mail stay.' })
}

/** For getMailContext: the runs a user is mid-way through. */
export function activeRunContext(store: MailStore): Array<Record<string, unknown>> {
  return activeRuns(store)
    .filter(run => run.status !== 'done')
    .map(run => ({
      runId: run.id,
      name: run.name,
      status: run.status,
      statusLabel: runStatusLabel(run),
      progress: runProgress(run),
    }))
}

/** Add drafts to a run: the "Add existing drafts…" door for agents. */
export function addDraftsToRunHandler(
  context: MailAgentToolContext,
  args: Record<string, unknown>,
): AgentToolHandlerResult {
  const run = requireRun(context, requireString(args, 'runId'))
  const raw = args.draftIds
  if (!Array.isArray(raw) || !raw.length || !raw.every(item => typeof item === 'string')) {
    throw new AgentMailToolError('"draftIds" must be a non-empty array of draft ids.')
  }
  const now = (context.now ?? new Date()).toISOString()
  const preview = addDraftsToRun(context.store, run, raw as string[], now)
  if (!preview.added.length) {
    throw new AgentMailToolError(
      preview.missing.length
        ? `None of those drafts exist unsent: ${preview.missing.join(', ')}.`
        : 'Every one of those drafts is already in the run.',
    )
  }
  context.setStore(current => {
    const target = findRun(current, run.id)
    return target ? addDraftsToRun(current, target, raw as string[], now).store : current
  })
  return ok({ runId: run.id, added: preview.added, ...(preview.missing.length ? { missing: preview.missing } : {}), items: preview.run.items.length })
}
