import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ClipboardPaste,
  File,
  FileSpreadsheet,
  Files,
  Grid3x3,
  Send,
} from 'lucide-react'
import { Button } from '@purescience/platform-ui/components/common/buttons/Button'
import {
  dialogOpenFile,
  dialogOpenFolder,
  fsReadText,
  isStandaloneDevMode,
  sendPromptToDrawerAgent,
  toggleAgentDrawer,
} from '../bridge/platformBridge'
import {
  addDraftsToRun,
  applyRunBinding,
  bodyHasNoteSlot,
  buildRunTemplatePrompt,
  emailedThisMonth,
  guessRunFieldMap,
  mapNoteRegions,
  normalizeRunKey,
  parsePastedRecipients,
  recipientsFromCsv,
  recipientsFromSheetsWorkbook,
  renameRun,
  renderRun,
  renderRunDraftFields,
  runAvailableTokens,
  runTokensIn,
  validateRunRecipients,
  RUN_NOTE_TOKEN,
} from '../lib/mailRuns'
import { sanitizeMailHtml } from '../lib/sanitizeMailHtml'
import { attachmentSizeStatus } from '../lib/mailAttachments'
import type { Draft, MailRun, MailRunFieldBinding, MailRunRecipients, MailStore } from '../types'
import { ComposeEditor } from './ComposeEditor'
import { BulkMenu, BulkMenuItem, BulkMenuWrap, KbdChip } from './mailShellStyles'
import { useOutsideClose } from './useOutsideClose'
import { storeWithRunCardSaved, useRunCard, useRunCardAutosave } from './runCardState'
import type { RunEditorPlumbing } from './RunScreen'
import {
  RunHeaderBack,
  RunHeaderBar,
  RunHeaderButton,
  RunHeaderMeta,
  RunHeaderSpacer,
  RunPanel,
  RunPanelActions,
  RunPanelKicker,
  RunPanelText,
  RunPanelTitle,
  RunPrimaryButton,
  RunPromptBlock,
  RunPromptHint,
  RunPromptInput,
  RunPromptRow,
  RunPromptSend,
  RunPromptStatus,
  RunSurface,
  SetupArrow,
  SetupBodyRow,
  SetupCard,
  SetupCardColumn,
  SetupDraftRow,
  SetupFieldMeta,
  SetupFieldRow,
  SetupFieldSelect,
  SetupFieldToggle,
  SetupFooter,
  SetupInlineBox,
  SetupInlineRow,
  SetupLabel,
  SetupNameInput,
  SetupPanel,
  SetupPanelHeader,
  SetupPreviewBody,
  SetupPreviewCard,
  SetupSectionLabel,
  SetupSmallButton,
  SetupSourceCard,
  SetupSourceIcon,
  SetupSourceMeta,
  SetupSourceName,
  SetupSourceText,
  SetupTable,
  SetupTableWrap,
  SetupTextarea,
  SetupToken,
  SetupWarning,
} from './runStyles'
import { ComposeDockRow, ComposeDockRowLabel, ComposeDockSubjectInput } from './mailShellStyles'
import { ComposeTemplateToChip } from './mailShellStyles'

export interface RunSetupScreenProps {
  run: MailRun
  plumbing: RunEditorPlumbing
  updateRun: (runId: string, update: (run: MailRun, store: MailStore) => MailRun) => void
  onBack: () => void
  onOpenRun: () => void
  onDiscardRun: () => void
  setCommandNotice: (notice: string) => void
  /** The drawer session bound to this tab (null → opened and bound on first send). */
  drawerSessionId?: string | null
}

/** The mapped fields the panel always shows, in order. */
const FIELD_ROWS: Array<{ token: string; hint: string }> = [
  { token: 'email', hint: 'To' },
  { token: 'first_name', hint: '' },
  { token: 'name', hint: '' },
]

function fileNameOf(path: string): string {
  return path.replace(/\/+$/, '').split('/').pop() ?? path
}

/**
 * Setup: the template card (the docked window, one size up, in 'run'
 * mode) beside the recipient-list panel — source, field mapping with
 * validation counts, a 3-row preview, warnings. "Preview as <first row>"
 * renders one draft in place; "Render N drafts" creates them in Drafts and
 * opens the run. Nothing sends here.
 */
export function RunSetupScreen({
  run,
  plumbing,
  updateRun,
  onBack,
  onOpenRun,
  onDiscardRun,
  setCommandNotice,
  drawerSessionId = null,
}: RunSetupScreenProps): React.ReactElement {
  const { store, setStore } = plumbing
  const template = run.template
    ? store.drafts.find(draft => draft.id === run.template?.draftId) ?? null
    : null
  const { card, setters } = useRunCard(template)
  const { flush } = useRunCardAutosave(card, setStore)
  const composeToRef = useRef<HTMLInputElement>(null)

  const [sourceMenuOpen, setSourceMenuOpen] = useState(false)
  const sourceMenuRef = useRef<HTMLDivElement>(null)
  useOutsideClose(sourceMenuRef, sourceMenuOpen, () => setSourceMenuOpen(false))
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [draftPickerOpen, setDraftPickerOpen] = useState(false)
  const [pickedDraftIds, setPickedDraftIds] = useState<string[]>([])
  const [previewRow, setPreviewRow] = useState<number | null>(null)
  // The prompt box: a brief for the DRAWER agent, which writes the template
  // with its run tools; the card re-seeds as the draft changes underneath.
  const [promptText, setPromptText] = useState('')
  const [promptBusy, setPromptBusy] = useState(false)
  const [promptStatus, setPromptStatus] = useState<{
    text: string
    tone?: 'warn'
  } | null>(null)
  const [discardArmed, setDiscardArmed] = useState(false)
  useEffect(() => {
    if (!discardArmed) return undefined
    const timer = window.setTimeout(() => setDiscardArmed(false), 4000)
    return () => window.clearTimeout(timer)
  }, [discardArmed])

  // ── Derived: validation, tokens, warnings ─────────────────────────────
  const validation = useMemo(
    () => validateRunRecipients(run.recipients, run.fieldMap),
    [run.recipients, run.fieldMap],
  )
  const validCount = validation.validRowIndexes.length
  const tokens = useMemo(
    () => runAvailableTokens(run).filter(token => token !== RUN_NOTE_TOKEN),
    [run],
  )
  const templateTokens = useMemo(
    () =>
      card
        ? runTokensIn(`${card.subject} ${card.bodyHtml || card.body}`)
        : [],
    [card],
  )
  const unknownTokens = templateTokens.filter(
    token =>
      normalizeRunKey(token) !== RUN_NOTE_TOKEN &&
      !tokens.some(known => normalizeRunKey(known) === normalizeRunKey(token)),
  )
  const hasNoteSlot = card
    ? bodyHasNoteSlot({ body: card.body, bodyHtml: card.bodyHtml })
    : run.noteSlot
  const emailedCount = useMemo(() => {
    if (!run.recipients || !validation.emailColumn) return 0
    const column = validation.emailColumn
    return validation.validRowIndexes
      .slice(0, 500)
      .filter(rowIndex =>
        emailedThisMonth(store, run.recipients!.rows[rowIndex]?.[column] ?? ''),
      ).length
    // Sent history changes rarely; recompute on the list, not every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.recipients, validation, store.messages])
  const templateHasContent = Boolean(card && (card.subject.trim() || card.body.trim()))
  const renderedBefore = run.items.some(item => item.rowIndex !== undefined)
  const canRender = Boolean(template && run.recipients && validCount > 0 && templateHasContent)
  const attachmentStatus = attachmentSizeStatus(card?.attachments ?? [])

  // ── Recipient sources ─────────────────────────────────────────────────
  const applyRecipients = (recipients: MailRunRecipients): void => {
    if (!recipients.rows.length) {
      setCommandNotice('No recipients found in that source.')
      return
    }
    updateRun(run.id, current => ({
      ...current,
      recipients,
      fieldMap: guessRunFieldMap(recipients.columns),
      updatedAt: new Date().toISOString(),
    }))
    setPasteOpen(false)
    setPasteText('')
    setSourceMenuOpen(false)
    setCommandNotice(
      `${recipients.rows.length} recipient${recipients.rows.length === 1 ? '' : 's'} from ${recipients.source.label}.`,
    )
  }
  const pickersUnavailable = isStandaloneDevMode()
  const loadSheets = async (): Promise<void> => {
    setSourceMenuOpen(false)
    if (pickersUnavailable) {
      setCommandNotice('File pickers need the PureDesktop shell — paste addresses instead.')
      return
    }
    try {
      // A .sheets package is a folder (manifest + workbook.json); the
      // folder picker is the one that can select it.
      const path = await dialogOpenFolder()
      if (!path) return
      let raw: string
      try {
        raw = await fsReadText(`${path.replace(/\/+$/, '')}/workbook.json`)
      } catch {
        raw = await fsReadText(path)
      }
      applyRecipients(
        recipientsFromSheetsWorkbook(JSON.parse(raw), {
          kind: 'sheet',
          path,
          label: fileNameOf(path),
        }),
      )
    } catch (error) {
      setCommandNotice(
        error instanceof Error
          ? `Could not read that workbook: ${error.message}`
          : 'Could not read that workbook.',
      )
    }
  }
  const loadCsv = async (): Promise<void> => {
    setSourceMenuOpen(false)
    if (pickersUnavailable) {
      setCommandNotice('File pickers need the PureDesktop shell — paste addresses instead.')
      return
    }
    try {
      const path = await dialogOpenFile()
      if (!path) return
      const raw = await fsReadText(path)
      const lower = path.toLowerCase()
      if (lower.endsWith('.sheets') || lower.endsWith('.sheets.html') || lower.endsWith('.json')) {
        const json = lower.endsWith('.sheets.html')
          ? JSON.parse(
              /<script[^>]*id=["']puresheets-workbook-data["'][^>]*>([\s\S]*?)<\/script>/i.exec(raw)?.[1] ?? 'null',
            )
          : JSON.parse(raw)
        applyRecipients(
          recipientsFromSheetsWorkbook(json, { kind: 'sheet', path, label: fileNameOf(path) }),
        )
        return
      }
      applyRecipients(recipientsFromCsv(raw, { kind: 'csv', path, label: fileNameOf(path) }))
    } catch (error) {
      setCommandNotice(
        error instanceof Error ? `Could not read that file: ${error.message}` : 'Could not read that file.',
      )
    }
  }
  const usePasted = (): void => {
    applyRecipients(parsePastedRecipients(pasteText))
  }
  const pickableDrafts: Draft[] = store.drafts.filter(
    draft =>
      !draft.sentAt &&
      draft.draftKind !== 'run_template' &&
      draft.id !== run.template?.draftId &&
      !run.items.some(item => item.draftId === draft.id) &&
      (!draft.runId || draft.runId === run.id),
  )
  const addPickedDrafts = (): void => {
    if (!pickedDraftIds.length) return
    setStore(current => {
      const target = (current.runs ?? []).find(item => item.id === run.id)
      return target ? addDraftsToRun(current, target, pickedDraftIds).store : current
    })
    setCommandNotice(`${pickedDraftIds.length} draft${pickedDraftIds.length === 1 ? '' : 's'} added to the run.`)
    setPickedDraftIds([])
    setDraftPickerOpen(false)
  }

  // ── Field mapping ─────────────────────────────────────────────────────
  const setBinding = (token: string, binding: MailRunFieldBinding | null): void => {
    updateRun(run.id, current => {
      const fieldMap = { ...current.fieldMap }
      if (binding) fieldMap[token] = binding
      else delete fieldMap[token]
      return { ...current, fieldMap, updatedAt: new Date().toISOString() }
    })
  }

  // ── Render / preview ──────────────────────────────────────────────────
  const render = (): void => {
    if (!canRender || !card) return
    const now = new Date().toISOString()
    setStore(current => renderRun(storeWithRunCardSaved(current, card, now), run.id, now).store)
    setCommandNotice(
      `${validCount} draft${validCount === 1 ? '' : 's'} rendered into Drafts. Nothing sends until you press Send & next on each one.`,
    )
    onOpenRun()
  }
  const firstPreviewRow = validation.validRowIndexes[0] ?? null
  const previewFields =
    previewRow !== null && card
      ? renderRunDraftFields(run, { subject: card.subject, body: card.body, bodyHtml: card.bodyHtml }, previewRow)
      : null
  const previewName = ((): string => {
    if (firstPreviewRow === null || !run.recipients) return 'first row'
    const row = run.recipients.rows[firstPreviewRow]!
    const first = run.fieldMap.first_name ? applyRunBinding(row, run.fieldMap.first_name) : ''
    return first || (run.fieldMap.email ? applyRunBinding(row, run.fieldMap.email) : 'first row')
  })()

  const discard = (): void => {
    if (!discardArmed) {
      setDiscardArmed(true)
      return
    }
    onDiscardRun()
  }

  const sendPrompt = async (): Promise<void> => {
    const request = promptText.trim()
    if (!request || !template || !card || promptBusy) return
    flush()
    setPromptBusy(true)
    setPromptStatus(null)
    try {
      await sendPromptToDrawerAgent({
        sessionId: drawerSessionId,
        content: buildRunTemplatePrompt({
          runId: run.id,
          runName: run.name,
          templateDraftId: template.id,
          tokens,
          hasNoteSlot,
          currentSubject: card.subject,
          currentBody: card.body,
          request,
        }),
      })
      setPromptText('')
      await toggleAgentDrawer({ open: true })
      setPromptStatus({
        text: 'Sent to the drawer agent — the template updates here as it writes.',
      })
    } catch (error) {
      setPromptStatus({
        text:
          error instanceof Error
            ? error.message
            : 'Could not reach the drawer agent.',
        tone: 'warn',
      })
    } finally {
      setPromptBusy(false)
    }
  }

  const attachmentCount = card?.attachments.length ?? 0
  const cardMeta = [
    'template',
    run.recipients ? `${run.recipients.rows.length} recipient${run.recipients.rows.length === 1 ? '' : 's'}` : 'no list yet',
    attachmentCount ? `${attachmentCount} attachment${attachmentCount === 1 ? '' : 's'}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <RunSurface aria-label={`Set up run ${run.name}`} data-puremail-run-setup>
      <RunHeaderBar>
        <RunHeaderBack type="button" aria-label="Back" onClick={() => { flush(); onBack() }}>
          <ArrowLeft aria-hidden="true" />
        </RunHeaderBack>
        <SetupNameInput
          aria-label="Run name"
          value={run.name}
          placeholder="Name this run"
          style={{ color: 'var(--platform-colors-text)', borderBottomColor: 'var(--platform-colors-border)', maxWidth: 320 }}
          onChange={event => {
            const name = event.currentTarget.value
            updateRun(run.id, current => ({ ...current, name, updatedAt: new Date().toISOString() }))
          }}
          onBlur={event => updateRun(run.id, current => renameRun(current, event.currentTarget.value || 'Untitled run'))}
        />
        <RunHeaderMeta>
          {run.status === 'setup' ? 'setup' : `${run.items.length} drafts rendered`}
        </RunHeaderMeta>
        <RunHeaderSpacer />
        {run.items.length > 0 && (
          <RunHeaderButton type="button" onClick={() => { flush(); onOpenRun() }}>
            Back to the run
          </RunHeaderButton>
        )}
      </RunHeaderBar>

      <SetupBodyRow>
        <SetupCardColumn style={{ padding: '18px 24px 18px 28px' }}>
          {template && card && !previewFields && (
            <RunPromptBlock aria-label="Ask the drawer agent to draft the template">
              <RunPromptHint>
                <strong>Drafts the template with the drawer agent</strong>
                <span>·</span>
                <span>
                  fields {tokens.length ? tokens.map(token => `{{${token}}}`).join(' ') : 'from the list once attached'}
                </span>
                <span>·</span>
                <span>keeps one {'{{note}}'} slot</span>
              </RunPromptHint>
              <RunPromptRow>
                <RunPromptInput
                  aria-label="Brief for the drawer agent"
                  placeholder="e.g. write a warm invite to the October workshops, mention both dates, use {{first_name}} and leave a {{note}} slot"
                  rows={1}
                  value={promptText}
                  disabled={promptBusy}
                  onChange={event => setPromptText(event.currentTarget.value)}
                  onKeyDown={event => {
                    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                      event.preventDefault()
                      event.stopPropagation()
                      void sendPrompt()
                    }
                  }}
                />
                <KbdChip>⌘⏎</KbdChip>
                <RunPromptSend
                  type="button"
                  aria-label="Send the brief to the drawer agent"
                  disabled={!promptText.trim() || promptBusy}
                  onClick={() => void sendPrompt()}
                >
                  <Send aria-hidden="true" />
                </RunPromptSend>
              </RunPromptRow>
              {promptStatus && (
                <RunPromptStatus $tone={promptStatus.tone} role="status">
                  <span>{promptStatus.text}</span>
                </RunPromptStatus>
              )}
            </RunPromptBlock>
          )}
          {previewFields && card ? (
            <SetupPreviewCard aria-label="Rendered preview">
              <ComposeDockRow>
                <ComposeDockRowLabel>Preview</ComposeDockRowLabel>
                <ComposeTemplateToChip>
                  {previewFields.to.name || previewFields.to.email}
                  <span>{previewFields.to.email}</span>
                </ComposeTemplateToChip>
                <RunHeaderSpacer />
                <SetupSmallButton type="button" onClick={() => setPreviewRow(null)}>
                  Back to template
                </SetupSmallButton>
              </ComposeDockRow>
              <ComposeDockRow>
                <ComposeDockSubjectInput readOnly value={previewFields.subject} aria-label="Preview subject" />
              </ComposeDockRow>
              <SetupPreviewBody
                dangerouslySetInnerHTML={{
                  // The sanitizer drops the region marker (as it should for
                  // mail); the preview shows the slot as a placeholder line.
                  __html: sanitizeMailHtml(
                    mapNoteRegions(
                      previewFields.bodyHtml,
                      () => '<p><em>· personal note — typed per draft during the run ·</em></p>',
                    ),
                    { allowRemoteImages: true },
                  ),
                }}
              />
              {previewFields.missing.length > 0 && (
                <SetupFooter>
                  <SetupWarning>
                    Not in the list, rendered blank: {previewFields.missing.map(token => `{{${token}}}`).join(', ')}
                  </SetupWarning>
                </SetupFooter>
              )}
            </SetupPreviewCard>
          ) : template && card ? (
            <ComposeEditor
              key={`run-template-${template.id}-${card.seed}`}
              {...plumbing}
              variant="run"
              runChrome={{
                mode: 'template',
                title: `${run.status === 'setup' ? 'New run' : 'Run'} · ${run.name}`,
                meta: cardMeta,
                tokens,
                onRender: render,
                renderLabel: renderedBefore
                  ? `Re-render ${validCount} draft${validCount === 1 ? '' : 's'}`
                  : `Render ${validCount} draft${validCount === 1 ? '' : 's'}`,
                renderDisabled: !canRender,
                renderNote: 'nothing sends yet · you review each one',
                onPreview:
                  firstPreviewRow !== null
                    ? () => {
                        flush()
                        setPreviewRow(firstPreviewRow)
                      }
                    : undefined,
                previewLabel: `Preview as ${previewName}`,
                onDiscard: discard,
                discardArmed,
                attachmentNote: 'go on every draft',
              }}
              composeTo={card.to}
              setComposeTo={setters.setTo}
              composeCc={card.cc}
              setComposeCc={setters.setCc}
              composeBcc={card.bcc}
              setComposeBcc={setters.setBcc}
              composeCcBccOpen={card.ccBccOpen}
              setComposeCcBccOpen={setters.setCcBccOpen}
              composeSubject={card.subject}
              setComposeSubject={setters.setSubject}
              composeBody={card.body}
              setComposeBody={setters.setBody}
              composeBodyHtml={card.bodyHtml}
              setComposeBodyHtml={setters.setBodyHtml}
              composeAttachments={card.attachments}
              setComposeAttachments={setters.setAttachments}
              composeDropActive={card.dropActive}
              setComposeDropActive={setters.setDropActive}
              setComposeOpen={() => {}}
              composeContext={{
                threadId: template.threadId,
                messageId: null,
                kind: 'draft',
                draftId: template.id,
              }}
              composeQuote={null}
              setComposeQuote={() => {}}
              switchComposeReplyKind={() => {}}
              onResetComposeContext={() => {}}
              discardContextDraft={() => {}}
              composeToRef={composeToRef}
            />
          ) : (
            <RunPanel role="status">
              <RunPanelKicker>Existing drafts</RunPanelKicker>
              <RunPanelTitle>
                {run.template ? 'The template draft was deleted.' : 'This run reviews drafts you already have.'}
              </RunPanelTitle>
              <RunPanelText>
                {run.template
                  ? 'Discard the run and start again, or keep going with the drafts it already holds.'
                  : `${run.items.length} draft${run.items.length === 1 ? '' : 's'} in the loop — add more with "Add existing drafts…" on the right. Each stays an ordinary draft in Drafts.`}
              </RunPanelText>
              <RunPanelActions>
                {run.items.length > 0 && (
                  <RunPrimaryButton type="button" onClick={onOpenRun}>
                    Open the run
                  </RunPrimaryButton>
                )}
                <RunHeaderButton type="button" onClick={discard}>
                  {discardArmed ? 'Discard? click again' : 'Discard run'}
                </RunHeaderButton>
              </RunPanelActions>
            </RunPanel>
          )}
        </SetupCardColumn>

        <SetupPanel aria-label="Recipient list">
          <SetupPanelHeader>
            <SetupLabel>Recipient list</SetupLabel>
            <RunHeaderSpacer />
            <BulkMenuWrap ref={sourceMenuRef}>
              <SetupSmallButton
                type="button"
                aria-haspopup="menu"
                aria-expanded={sourceMenuOpen}
                onClick={() => setSourceMenuOpen(open => !open)}
              >
                {run.recipients ? 'Change…' : 'Attach…'}
              </SetupSmallButton>
              {sourceMenuOpen && (
                <BulkMenu role="menu" aria-label="Recipient source">
                  <BulkMenuItem type="button" role="menuitem" onClick={() => void loadSheets()}>
                    <FileSpreadsheet aria-hidden="true" />
                    PureSheets workbook…
                  </BulkMenuItem>
                  <BulkMenuItem type="button" role="menuitem" onClick={() => void loadCsv()}>
                    <File aria-hidden="true" />
                    CSV file…
                  </BulkMenuItem>
                  <BulkMenuItem
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setSourceMenuOpen(false)
                      setDraftPickerOpen(false)
                      setPasteOpen(true)
                    }}
                  >
                    <ClipboardPaste aria-hidden="true" />
                    Paste addresses…
                  </BulkMenuItem>
                  <BulkMenuItem
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setSourceMenuOpen(false)
                      setPasteOpen(false)
                      setDraftPickerOpen(true)
                    }}
                  >
                    <Files aria-hidden="true" />
                    Add existing drafts…
                  </BulkMenuItem>
                </BulkMenu>
              )}
            </BulkMenuWrap>
          </SetupPanelHeader>

          <SetupSourceCard>
            <SetupSourceIcon $tone={run.recipients?.source.kind ?? 'none'}>
              {run.recipients?.source.kind === 'sheet' ? (
                <FileSpreadsheet aria-hidden="true" />
              ) : run.recipients?.source.kind === 'pasted' ? (
                <ClipboardPaste aria-hidden="true" />
              ) : run.recipients ? (
                <File aria-hidden="true" />
              ) : (
                <Grid3x3 aria-hidden="true" />
              )}
            </SetupSourceIcon>
            <SetupSourceText>
              <SetupSourceName title={run.recipients?.source.path ?? run.recipients?.source.label}>
                {run.recipients?.source.label ?? 'No list yet'}
              </SetupSourceName>
              <SetupSourceMeta>
                {run.recipients
                  ? `${run.recipients.source.kind === 'sheet' ? 'PureSheets' : run.recipients.source.kind === 'csv' ? 'CSV' : 'Pasted'} · ${run.recipients.rows.length} rows · ${run.recipients.columns.length} columns`
                  : 'PureSheets, CSV, or pasted addresses'}
              </SetupSourceMeta>
            </SetupSourceText>
          </SetupSourceCard>

          {pasteOpen && (
            <SetupInlineBox>
              <SetupLabel>Paste addresses</SetupLabel>
              <SetupTextarea
                aria-label="Pasted addresses"
                placeholder={'Enter one recipient per line (email address, optionally with a name)'}
                value={pasteText}
                onChange={event => setPasteText(event.currentTarget.value)}
              />
              <SetupInlineRow>
                <Button size="sm" variant="primary" disabled={!pasteText.trim()} onClick={usePasted}>
                  Use these addresses
                </Button>
                <Button size="sm" onClick={() => setPasteOpen(false)}>
                  Cancel
                </Button>
              </SetupInlineRow>
            </SetupInlineBox>
          )}

          {draftPickerOpen && (
            <SetupInlineBox>
              <SetupLabel>Add existing drafts</SetupLabel>
              {pickableDrafts.length === 0 && (
                <SetupSourceMeta>No other unsent drafts to add.</SetupSourceMeta>
              )}
              {pickableDrafts.slice(0, 40).map(draft => (
                <SetupDraftRow key={draft.id}>
                  <input
                    type="checkbox"
                    checked={pickedDraftIds.includes(draft.id)}
                    onChange={event =>
                      setPickedDraftIds(current =>
                        event.currentTarget.checked
                          ? [...current, draft.id]
                          : current.filter(id => id !== draft.id),
                      )
                    }
                  />
                  <span title={draft.subject}>
                    {draft.to[0]?.name || draft.to[0]?.email || '(no recipient)'} · {draft.subject || '(no subject)'}
                  </span>
                </SetupDraftRow>
              ))}
              <SetupInlineRow>
                <Button size="sm" variant="primary" disabled={!pickedDraftIds.length} onClick={addPickedDrafts}>
                  Add {pickedDraftIds.length || ''} draft{pickedDraftIds.length === 1 ? '' : 's'}
                </Button>
                <Button size="sm" onClick={() => setDraftPickerOpen(false)}>
                  Cancel
                </Button>
              </SetupInlineRow>
            </SetupInlineBox>
          )}

          {run.recipients && (
            <>
              <SetupSectionLabel>
                <SetupLabel>Fields</SetupLabel>
              </SetupSectionLabel>
              <SetupCard>
                {FIELD_ROWS.map(({ token }) => {
                  const binding = run.fieldMap[token]
                  const columns = run.recipients!.columns
                  const isEmail = token === 'email'
                  const meta = isEmail
                    ? !binding
                      ? { text: 'pick a column', tone: 'warn' as const }
                      : validation.invalid.length
                        ? { text: `${validCount} valid · ${validation.invalid.length} invalid`, tone: 'warn' as const }
                        : { text: `${validCount} valid`, tone: 'ok' as const }
                    : !binding
                      ? { text: 'unmapped', tone: undefined }
                      : null
                  return (
                    <SetupFieldRow key={token}>
                      <SetupToken>{`{{${token}}}`}</SetupToken>
                      <SetupArrow aria-hidden="true">←</SetupArrow>
                      <SetupFieldSelect
                        aria-label={`Column for ${token}`}
                        value={binding?.column ?? ''}
                        onChange={event => {
                          const column = event.currentTarget.value
                          setBinding(
                            token,
                            column
                              ? { column, ...(binding?.transform ? { transform: binding.transform } : {}) }
                              : null,
                          )
                        }}
                      >
                        <option value="">{isEmail ? 'Choose the email column' : '— not mapped —'}</option>
                        {columns.map(column => (
                          <option key={column} value={column}>
                            {column}
                          </option>
                        ))}
                      </SetupFieldSelect>
                      {token === 'first_name' && binding && (
                        <SetupFieldToggle
                          type="button"
                          $on={binding.transform === 'first-word'}
                          aria-pressed={binding.transform === 'first-word'}
                          title="Use only the first word of the column"
                          onClick={() =>
                            setBinding(token, {
                              column: binding.column,
                              ...(binding.transform === 'first-word' ? {} : { transform: 'first-word' as const }),
                            })
                          }
                        >
                          first word
                        </SetupFieldToggle>
                      )}
                      {meta && <SetupFieldMeta $tone={meta.tone}>{meta.text}</SetupFieldMeta>}
                    </SetupFieldRow>
                  )
                })}
                <SetupFieldRow>
                  <SetupToken>{'{{note}}'}</SetupToken>
                  <SetupArrow aria-hidden="true">←</SetupArrow>
                  <span style={{ color: 'var(--platform-colors-text-tertiary)' }}>
                    {hasNoteSlot ? 'typed per draft' : 'no slot in the template yet'}
                  </span>
                </SetupFieldRow>
              </SetupCard>

              <SetupSectionLabel>
                <SetupLabel>Preview rows</SetupLabel>
                <RunHeaderSpacer />
                <SetupSourceMeta>
                  {Math.min(3, run.recipients.rows.length)} of {run.recipients.rows.length}
                </SetupSourceMeta>
              </SetupSectionLabel>
              <SetupTableWrap>
                <SetupTable>
                  <thead>
                    <tr>
                      {run.recipients.columns.slice(0, 4).map(column => (
                        <th key={column}>{column}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {run.recipients.rows.slice(0, 3).map((row, index) => (
                      <tr key={index}>
                        {run.recipients!.columns.slice(0, 4).map(column => (
                          <td key={column} title={row[column]}>
                            {row[column]}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </SetupTable>
              </SetupTableWrap>
            </>
          )}

          {!run.recipients && run.items.length > 0 && (
            <>
              <SetupSectionLabel>
                <SetupLabel>Drafts in this run</SetupLabel>
                <RunHeaderSpacer />
                <SetupSourceMeta>{run.items.length}</SetupSourceMeta>
              </SetupSectionLabel>
              <SetupCard>
                {run.items.slice(0, 12).map(item => (
                  <SetupFieldRow key={item.draftId}>
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.label ?? item.draftId}
                    </span>
                    <SetupFieldMeta>{item.status}</SetupFieldMeta>
                  </SetupFieldRow>
                ))}
                {run.items.length > 12 && (
                  <SetupFieldRow>
                    <SetupFieldMeta>{run.items.length - 12} more…</SetupFieldMeta>
                  </SetupFieldRow>
                )}
              </SetupCard>
            </>
          )}

          <SetupFooter>
            {validation.invalid.length > 0 && (
              <SetupWarning>
                {validation.invalid.length} row{validation.invalid.length === 1 ? '' : 's'} excluded — no valid email address
              </SetupWarning>
            )}
            {validation.duplicates.length > 0 && (
              <SetupWarning>
                {validation.duplicates.length} duplicate address{validation.duplicates.length === 1 ? '' : 'es'} excluded
              </SetupWarning>
            )}
            {unknownTokens.length > 0 && (
              <SetupWarning>
                Not in the list, will render blank: {unknownTokens.map(token => `{{${token}}}`).join(', ')}
              </SetupWarning>
            )}
            {attachmentStatus.overLimit && (
              <SetupWarning>
                Attachments total {attachmentStatus.totalLabel} — over the {attachmentStatus.limitLabel} limit
              </SetupWarning>
            )}
            {emailedCount > 0 && (
              <span>
                {emailedCount} row{emailedCount === 1 ? '' : 's'} already emailed this month — flagged in the run
              </span>
            )}
            <span>Sends go one at a time, from your account, as normal mail</span>
          </SetupFooter>
        </SetupPanel>
      </SetupBodyRow>
    </RunSurface>
  )
}
