import { css, styled } from 'styled-components'
import { chrome, fastTipCss } from './mailShellStyles'

/*
 * Send-run surfaces (Main.dc.html / Setup.dc.html): the run screen's
 * header strip, card column, recipient rail and status line; the Runs
 * index; the setup screen's recipient-list panel. Square corners, the
 * mail accent, mono metas — the same tokens as the rest of the shell.
 */

/** The whole content column while a run surface is showing. */
export const RunSurface = styled.section`
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 0;
  flex-direction: column;
  outline: none;
`

/** 44px header strip: back, name, position, progress, actions. */
/** The run's control row: back, name, position, progress, actions. */
export const RunHeaderBar = styled.div.attrs(chrome('toolbar'))`
  gap: 12px;
  padding: 0 var(--pure-chrome-inset);
  white-space: nowrap;

  > * {
    flex: none;
  }
`

export const RunHeaderBack = styled.button.attrs(chrome('toolbar-control'))`
  color: var(--platform-colors-text-secondary);

  &:hover {
    color: var(--platform-colors-text);
  }
  ${fastTipCss}
`

export const RunHeaderName = styled.span`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--platform-colors-text);
  font-size: 13px;
  font-weight: 600;
`

export const RunHeaderMeta = styled.span.attrs(chrome('meta'))`
  font-variant-numeric: tabular-nums;
`

export const RunHeaderSpacer = styled.span`
  flex: 1 1 auto !important;
  min-width: 0;
`

/** Six 34×4 segments filling left to right with sent progress. */
export const RunProgressSegments = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-left: 6px;
`

export const RunProgressSegment = styled.span<{ $fill: number }>`
  width: 34px;
  height: 4px;
  background: ${({ $fill }) =>
    $fill >= 1
      ? 'var(--puremail-accent)'
      : $fill > 0
        ? 'color-mix(in srgb, var(--puremail-accent) 45%, var(--puremail-line))'
        : 'var(--puremail-line)'};
`

export const RunHeaderButton = styled.button.attrs(chrome('toolbar-select'))`
  gap: 7px;
  cursor: pointer;

  &:hover {
    background: var(--pure-chrome-hover);
  }

  &:disabled {
    opacity: 0.55;
    cursor: default;
  }

  svg {
    width: 12px;
    height: 12px;
  }
`

/** Card column | recipient rail. */
export const RunBodyRow = styled.div`
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 0;
`

export const RunCardColumn = styled.div`
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  padding: 22px 40px 22px;
`

/** The in-between panels (sent item, missing item, done summary). */
export const RunPanel = styled.div`
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  gap: 10px;
  border: 1px solid var(--platform-colors-border);
  background: var(--puremail-message-bg);
  padding: 22px 24px;
`

export const RunPanelKicker = styled.div`
  color: var(--platform-colors-text-tertiary);
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-label-size);
  letter-spacing: var(--pure-chrome-label-tracking);
  text-transform: uppercase;
`

export const RunPanelTitle = styled.div`
  color: var(--platform-colors-text);
  font-size: 15px;
  font-weight: 600;
`

export const RunPanelText = styled.div`
  color: var(--platform-colors-text-secondary);
  font-size: 13px;
  line-height: 1.5;
  max-width: 62ch;
`

export const RunPanelActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
`

export const RunPrimaryButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 7px;
  border: 0;
  background: var(--puremail-accent);
  color: var(--pure-chrome-on-accent);
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  padding: 7px 14px;

  &:hover {
    filter: brightness(0.94);
  }

  &:disabled {
    opacity: 0.55;
    cursor: default;
    filter: none;
  }

  svg {
    width: 13px;
    height: 13px;
  }
`

/** The 280px recipient rail. */
/** The recipient rail: the platform sidebar, on the right. */
export const RunRail = styled.aside.attrs(chrome('sidebar', { 'data-side': 'right' }))``

export const RunRailHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px var(--pure-chrome-inset) 8px;
`

export const RunRailKicker = styled.span`
  color: var(--pure-chrome-muted);
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-label-size);
  font-weight: 500;
  letter-spacing: var(--pure-chrome-label-tracking);
  text-transform: uppercase;
`

export const RunRailHeaderMeta = styled.span.attrs(chrome('meta'))`
  margin-left: auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
`

export const RunRailList = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  border-top: 1px solid var(--puremail-line);
  background: var(--puremail-message-bg);
`

export const RunRailRow = styled.button.attrs(chrome('list-row'))<{ $active?: boolean; $muted?: boolean }>`
  width: 100%;
  border: 0;
  cursor: pointer;
  font: inherit;
  text-align: left;

  && {
    gap: 8px;
    background: ${({ $active }) =>
      $active ? 'var(--pure-chrome-selection)' : 'transparent'};
    color: ${({ $active, $muted }) =>
      $active
        ? 'var(--platform-colors-text)'
        : $muted
          ? 'var(--pure-chrome-muted)'
          : 'var(--platform-colors-text-secondary)'};
    font-weight: ${({ $active }) => ($active ? 600 : 400)};
  }

  &&:hover {
    background: ${({ $active }) =>
      $active ? 'var(--pure-chrome-selection)' : 'var(--pure-chrome-hover)'};
  }
`

export const RunRailTick = styled.span<{ $tone: 'sent' | 'current' | 'pending' | 'off' }>`
  display: inline-flex;
  width: 14px;
  height: 14px;
  flex: none;
  align-items: center;
  justify-content: center;
  color: ${({ $tone }) =>
    $tone === 'sent'
      ? 'var(--platform-colors-success, #2e7d4f)'
      : $tone === 'current'
        ? 'var(--puremail-accent-text)'
        : 'var(--platform-colors-text-tertiary)'};

  svg {
    width: 12px;
    height: 12px;
  }
`

export const RunRailSquare = styled.span`
  width: 6px;
  height: 6px;
  border: 1px solid
    color-mix(in srgb, var(--platform-colors-text) 24%, transparent);
`

export const RunRailLabel = styled.span`
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
`

export const RunRailMeta = styled.span.attrs(chrome('meta'))<{ $accent?: boolean }>`
  flex: none;
  ${({ $accent }) =>
    $accent &&
    css`
      && {
        color: var(--pure-chrome-accent);
      }
    `}
`

export const RunRailFooter = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  border-top: 1px solid var(--puremail-line);
  padding: 10px 12px;
  color: var(--platform-colors-text-tertiary);
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-meta-size);
  line-height: 1.4;
`

/** The 24px run status line above the app's own status bar. */
export const RunStatusLine = styled.div`
  display: flex;
  height: 24px;
  flex: none;
  align-items: center;
  gap: 12px;
  border-top: 1px solid var(--puremail-line);
  background: var(--puremail-pane-bg);
  padding: 0 14px;
  color: var(--platform-colors-text-tertiary);
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-meta-size);
  white-space: nowrap;
`

export const RunStatusSpacer = styled.span`
  flex: 1;
  min-width: 0;
`

export const RunStatusAction = styled.button`
  border: 0;
  background: transparent;
  color: var(--puremail-accent-text);
  cursor: pointer;
  font: inherit;
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-meta-size);
  font-weight: 600;
  padding: 0;

  &:hover {
    text-decoration: underline;
  }
`

/* ── Runs index ─────────────────────────────────────────────────────── */

export const RunsIndexScroll = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 24px 24px;
`

export const RunsIndexEmpty = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 56ch;
  padding: 24px 0;
  color: var(--platform-colors-text-secondary);
  font-size: 13px;
  line-height: 1.5;
`

export const RunsIndexList = styled.div`
  display: flex;
  flex-direction: column;
  border: 1px solid var(--platform-colors-border);
  background: var(--puremail-message-bg);
`

export const RunsIndexRow = styled.div.attrs(chrome('list-row'))`
  &:last-child {
    border-bottom: 0;
  }
`

export const RunsIndexName = styled.button`
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  border: 0;
  background: transparent;
  color: var(--platform-colors-text);
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  padding: 0;
  text-align: left;

  &:hover {
    color: var(--puremail-accent-text);
  }
`

export const RunsIndexMeta = styled.span.attrs(chrome('meta'))`
  flex: none;
  font-variant-numeric: tabular-nums;
`

export const RunsIndexSection = styled.div.attrs(chrome('section-label'))`
  margin-top: 8px;

  && {
    padding-inline: 0;
  }
`

/* ── Setup: the recipient-list panel ────────────────────────────────── */

export const SetupBodyRow = styled.div`
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 0;
`

export const SetupCardColumn = styled.div`
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
`

/** The recipient-list panel: the platform sidebar, on the right. */
export const SetupPanel = styled.aside.attrs(chrome('sidebar', { 'data-side': 'right' }))``

export const SetupPanelHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px var(--pure-chrome-inset) 8px;
`

export const SetupLabel = styled.span`
  color: var(--pure-chrome-muted);
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-label-size);
  font-weight: 500;
  letter-spacing: var(--pure-chrome-label-tracking);
  text-transform: uppercase;
`

export const SetupSectionLabel = styled.div`
  display: flex;
  align-items: center;
  padding: 14px var(--pure-chrome-inset) 6px;
`

export const SetupCard = styled.div`
  margin: 0 var(--pure-chrome-inset);
  border: 1px solid var(--platform-colors-border);
  background: var(--puremail-message-bg);
`

export const SetupSourceCard = styled(SetupCard)`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
`

export const SetupSourceIcon = styled.span<{ $tone?: 'sheet' | 'csv' | 'pasted' | 'drafts' | 'none' }>`
  display: inline-flex;
  width: 22px;
  height: 22px;
  flex: none;
  align-items: center;
  justify-content: center;
  background: ${({ $tone }) =>
    $tone === 'sheet'
      ? 'var(--platform-colors-success, #2e7d4f)'
      : $tone === 'none'
        ? 'var(--platform-colors-text-tertiary)'
        : 'var(--puremail-accent)'};
  color: #fff;

  svg {
    width: 12px;
    height: 12px;
  }
`

export const SetupSourceText = styled.div`
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
`

export const SetupSourceName = styled.span`
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--platform-colors-text);
  font-size: var(--pure-chrome-ui-size);
  font-weight: 500;
`

export const SetupSourceMeta = styled.span`
  color: var(--platform-colors-text-tertiary);
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-meta-size);
`

export const SetupSmallButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: none;
  border: 1px solid var(--platform-colors-border);
  background: var(--puremail-message-bg);
  color: var(--platform-colors-text);
  cursor: pointer;
  font: inherit;
  font-size: var(--pure-chrome-ui-size);
  padding: 3px 8px;

  &:hover {
    background: var(--platform-colors-surface-hover);
  }

  &:disabled {
    opacity: 0.55;
    cursor: default;
  }

  svg {
    width: 11px;
    height: 11px;
  }
`

export const SetupFieldRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  border-bottom: 1px solid
    color-mix(in srgb, var(--puremail-line) 60%, transparent);
  padding: 6px 10px;
  font-size: var(--pure-chrome-ui-size);

  &:last-child {
    border-bottom: 0;
  }
`

export const SetupToken = styled.span`
  display: inline-block;
  flex: none;
  border: 1px solid var(--puremail-accent-bg);
  background: color-mix(in srgb, var(--puremail-accent-bg) 55%, transparent);
  color: var(--puremail-accent-text);
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-meta-size);
  padding: 0 4px;
`

export const SetupArrow = styled.span`
  flex: none;
  color: var(--platform-colors-text-tertiary);
`

export const SetupFieldSelect = styled.select`
  flex: 1;
  min-width: 0;
  border: 1px solid transparent;
  background: transparent;
  color: var(--platform-colors-text);
  font: inherit;
  font-size: var(--pure-chrome-ui-size);
  padding: 2px 0;

  &:hover,
  &:focus {
    border-color: var(--platform-colors-border);
    outline: none;
  }
`

export const SetupFieldMeta = styled.span<{ $tone?: 'ok' | 'warn' }>`
  margin-left: auto;
  flex: none;
  color: ${({ $tone }) =>
    $tone === 'ok'
      ? 'var(--platform-colors-success, #2e7d4f)'
      : $tone === 'warn'
        ? 'var(--platform-colors-warning, #b58a00)'
        : 'var(--platform-colors-text-tertiary)'};
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-meta-size);
`

export const SetupFieldToggle = styled.button<{ $on?: boolean }>`
  flex: none;
  border: 1px solid var(--platform-colors-border);
  background: ${({ $on }) =>
    $on ? 'var(--puremail-accent-bg)' : 'transparent'};
  color: ${({ $on }) =>
    $on
      ? 'var(--puremail-accent-text)'
      : 'var(--platform-colors-text-tertiary)'};
  cursor: pointer;
  font: inherit;
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-meta-size);
  padding: 1px 5px;
`

export const SetupTable = styled.table`
  width: 100%;
  border-collapse: collapse;

  th {
    border-bottom: 1px solid var(--platform-colors-border);
    background: var(--puremail-pane-header-bg);
    color: var(--platform-colors-text-tertiary);
    font-size: var(--pure-chrome-ui-size);
    font-weight: 500;
    padding: 6px 10px;
    text-align: left;
    white-space: nowrap;
  }

  td {
    max-width: 160px;
    overflow: hidden;
    border-bottom: 1px solid
      color-mix(in srgb, var(--puremail-line) 60%, transparent);
    color: var(--platform-colors-text);
    font-size: var(--pure-chrome-ui-size);
    padding: 6px 10px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  tr:last-child td {
    border-bottom: 0;
  }
`

export const SetupTableWrap = styled(SetupCard)`
  overflow: hidden;
`

export const SetupFooter = styled.div`
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: auto;
  border-top: 1px solid var(--puremail-line);
  padding: 10px 14px;
  color: var(--platform-colors-text-tertiary);
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-meta-size);
  line-height: 1.4;
`

export const SetupWarning = styled.div`
  color: var(--platform-colors-warning, #b58a00);
`

/** Inline source pickers (paste box, existing-drafts list). */
export const SetupInlineBox = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 8px 14px 0;
  border: 1px solid var(--platform-colors-border);
  background: var(--puremail-message-bg);
  padding: 10px;
`

export const SetupTextarea = styled.textarea`
  min-height: 96px;
  resize: vertical;
  border: 1px solid var(--platform-colors-border);
  background: var(--platform-colors-surface);
  color: var(--platform-colors-text);
  font: inherit;
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-meta-size);
  line-height: 1.5;
  padding: 8px;
  outline: none;

  &:focus {
    border-color: var(--puremail-accent);
  }
`

export const SetupInlineRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`

export const SetupNameInput = styled.input`
  flex: 1;
  min-width: 0;
  border: 0;
  border-bottom: 1px solid rgb(255 255 255 / 0.35);
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: var(--pure-chrome-ui-size);
  font-weight: 600;
  padding: 2px 0;
  outline: none;

  &::placeholder {
    color: rgb(255 255 255 / 0.6);
    font-weight: 400;
  }

  &:focus {
    border-bottom-color: var(--platform-colors-text);
  }
`

export const SetupDraftRow = styled.label`
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: var(--pure-chrome-meta-size);

  input {
    margin: 0;
  }

  span {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  em {
    margin-left: auto;
    flex: none;
    color: var(--platform-colors-text-tertiary);
    font-family: var(--platform-typography-font-family-mono);
    font-size: var(--pure-chrome-meta-size);
    font-style: normal;
  }
`

/* ── The setup prompt box (to the drawer agent) ─────────────────────── */

export const RunPromptBlock = styled.div`
  display: flex;
  flex: none;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
  border: 1px solid var(--platform-colors-border);
  background: var(--puremail-pane-bg);
  padding: 10px 12px;
`

export const RunPromptHint = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--platform-colors-text-tertiary);
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-meta-size);
  letter-spacing: 0.04em;

  strong {
    color: var(--platform-colors-text-secondary);
    font-weight: 600;
  }
`

export const RunPromptRow = styled.div`
  display: flex;
  align-items: flex-end;
  gap: 8px;
`

export const RunPromptInput = styled.textarea`
  flex: 1;
  min-width: 0;
  min-height: 34px;
  max-height: 120px;
  resize: none;
  border: 1px solid var(--platform-colors-border);
  background: var(--puremail-message-bg);
  color: var(--platform-colors-text);
  font: inherit;
  font-size: 13px;
  line-height: 1.4;
  padding: 7px 10px;
  outline: none;

  &::placeholder {
    color: var(--platform-colors-text-tertiary);
  }

  &:focus {
    border-color: var(--puremail-accent);
  }

  &:disabled {
    opacity: 0.6;
  }
`

export const RunPromptSend = styled.button`
  display: inline-flex;
  width: 34px;
  height: 34px;
  flex: none;
  align-items: center;
  justify-content: center;
  border: 0;
  background: var(--puremail-accent);
  color: var(--pure-chrome-on-accent);
  cursor: pointer;
  padding: 0;

  &:hover {
    filter: brightness(0.94);
  }

  &:disabled {
    opacity: 0.55;
    cursor: default;
    filter: none;
  }

  svg {
    width: 14px;
    height: 14px;
  }
  ${fastTipCss}
`

export const RunPromptStatus = styled.div<{ $tone?: 'warn' }>`
  display: flex;
  align-items: center;
  gap: 8px;
  color: ${({ $tone }) =>
    $tone === 'warn'
      ? 'var(--platform-colors-warning, #b58a00)'
      : 'var(--platform-colors-text-secondary)'};
  font-size: var(--pure-chrome-ui-size);
`

/** The rendered preview standing in for the template editor. */
export const SetupPreviewCard = styled.div`
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  border: 1px solid var(--platform-colors-border);
  background: var(--puremail-message-bg);
`

export const SetupPreviewBody = styled.div`
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 14px 16px;
  color: var(--platform-colors-text);
  font-family: var(
    --platform-typography-font-family-content,
    var(--platform-typography-font-family)
  );
  font-size: 13.5px;
  line-height: 1.55;

  p {
    margin: 0 0 0.6em;
  }

  [data-run-note] {
    margin: 0 0 0.6em;
    padding: 8px 10px;
    border: 1px dashed var(--puremail-accent);
    background: var(--puremail-accent-bg);
    color: var(--puremail-accent-text);
    font-family: var(--platform-typography-font-family-mono);
    font-size: var(--pure-chrome-label-size);
  }

  [data-run-note]::before {
    content: 'Personal note · typed per draft during the run';
  }
`
