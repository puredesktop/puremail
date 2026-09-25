import { css, styled } from 'styled-components'
import { Button } from '@purescience/platform-ui/components/common/buttons/Button'
import { THREAD_ROW_HEIGHTS, type MailDensity } from './mailShellLayout'

export type ConnectionResultTone = 'success' | 'warning' | 'neutral'
export type MailProviderOptionStatus = 'ready' | 'planned' | 'advanced' | 'later'

/**
 * Marks an element for the platform chrome stylesheet (theme/chromeCss in
 * @purescience/platform-ui): sidebars, rows, section labels, meta, fields,
 * toolbars and list rows get their measures, faces and theme colours from
 * the --pure-chrome-* tokens, so nothing here restates a width or a grey.
 * Typed loosely on purpose: styled-components' attrs rejects data-* literals.
 */
export const chrome = (
  kind: string,
  extra: Record<string, string> = {},
): Record<string, string> => ({ 'data-chrome': kind, ...extra })


/**
 * Wraps the app bar above the two columns. The bar spans the whole mail area,
 * which the column grid cannot express on its own.
 */

/**
 * Fast tooltip for icon-only buttons, reading aria-label. Native title
 * tooltips carry an OS-fixed ~1.5s delay; this appears after 300ms and
 * disappears instantly (transition only on hover). Gated on [aria-label]
 * so elements without one never grow an empty bubble.
 */
export const fastTipCss = css`
  position: relative;

  &[aria-label]::after {
    content: attr(aria-label);
    position: absolute;
    top: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%);
    z-index: 40;
    padding: 4px 7px;
    background: var(--platform-colors-text);
    color: var(--platform-colors-bg);
    font-family: var(--platform-typography-font-family);
    font-size: var(--pure-chrome-meta-size);
    font-weight: 500;
    line-height: 1;
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    visibility: hidden;
  }

  &[aria-label]:hover::after {
    opacity: 1;
    visibility: visible;
    transition:
      opacity 0.12s ease 0.3s,
      visibility 0s linear 0.3s;
  }
`

export const MailFrame = styled.div`
  /* The app's design tokens. These lived on Root while the columns were a
     grid inside it; the frame is the outermost mail element now, so every
     surface — top bar, rail, list, reader, overlays — reads them from here. */
  --puremail-pane-bg: var(--pure-chrome-sidebar);
  --puremail-pane-header-bg: var(--pure-chrome-bar);
  --puremail-reader-bg: var(--pure-chrome-well);
  --puremail-message-bg: var(
    --pure-page,
    var(--platform-colors-elevated, #fff)
  );
  --puremail-line: var(--pure-chrome-line);
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --puremail-page-width: min(680px, calc(100% - 72px));
  --puremail-readable-measure: var(--pure-chrome-reading-measure);
  --puremail-empty-surface: var(--puremail-message-bg);
  --puremail-page-shadow: var(
    --page-shadow,
    0 18px 45px color-mix(in srgb, #111827 14%, transparent),
    0 1px 2px color-mix(in srgb, #111827 10%, transparent)
  );
  --puremail-panel-shadow: 0 1px 2px color-mix(in srgb, #111827 8%, transparent);
  --puremail-accent: var(--pure-chrome-accent);
  --puremail-accent-bg: var(--pure-chrome-selection);
  --puremail-accent-text: var(--pure-chrome-accent);
  --puremail-warning-border: color-mix(
    in srgb,
    var(--platform-colors-warning, var(--platform-colors-semantic-orange)) 34%,
    var(--platform-colors-border)
  );
  --puremail-warning-bg: color-mix(
    in srgb,
    var(--platform-colors-warning, var(--platform-colors-semantic-orange)) 10%,
    var(--platform-colors-surface)
  );
  --puremail-warning-text: var(--platform-colors-semantic-orange-text);
  --puremail-danger-text: #b23a2e;
  --puremail-danger-border: color-mix(
    in srgb,
    var(--puremail-danger-text) 38%,
    transparent
  );
  --puremail-danger-bg: color-mix(
    in srgb,
    var(--puremail-danger-text) 10%,
    var(--puremail-message-bg)
  );
  --puremail-success-border: var(--platform-colors-semantic-green-border);
  --puremail-success-bg: var(--platform-colors-semantic-green-muted);
  --puremail-success-text: var(--platform-colors-semantic-green-text);
  --puremail-info-border: var(--platform-colors-border);
  --puremail-info-bg: var(--surface, var(--platform-colors-surface-hover));
  --puremail-info-text: var(--platform-colors-text);
  --puremail-neutral-chip-border: var(--platform-colors-border);
  --puremail-neutral-chip-text: var(--platform-colors-text-secondary);
  --puremail-action-text: var(--platform-colors-text);
  --puremail-action-text-secondary: var(--platform-colors-text-secondary);

  position: relative;
  display: flex;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  background: var(--canvas, var(--platform-colors-bg));
  color: var(--platform-colors-text);
  font-size: var(--pure-chrome-ui-size);
  font-family: var(--platform-typography-font-family);
`


/**
 * The views people switch between constantly, so they stay on screen rather
 * than hiding inside the folder menu.
 */
export const FilterChipRow = styled.div`
  display: flex;
  height: 30px;
  flex: none;
  align-items: center;
  gap: 6px;
  border-bottom: 1px solid var(--puremail-line);
  padding: 0 12px;
  overflow-x: auto;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
`

export const FilterChip = styled.button<{ $active?: boolean }>`
  border: 0;
  border-radius: 11px;
  background: ${({ $active }) =>
    $active
      ? 'var(--platform-colors-text)'
      : 'color-mix(in srgb, currentColor 5%, transparent)'};
  color: ${({ $active }) =>
    $active ? 'var(--platform-colors-surface)' : 'inherit'};
  cursor: pointer;
  flex: none;
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-meta-size);
  opacity: ${({ $active }) => ($active ? 1 : 0.72)};
  padding: 3px 7px;
`


/*
 * A row, not a button: the checkbox inside it is its own control, and a
 * button cannot legally contain one.
 */
/*
 * A row, not a button: the checkbox inside it is its own control, and a
 * button cannot legally contain one.
 */
export const TaskDrawerRow = styled.div.attrs(chrome('list-row'))<{ $active?: boolean }>`
  width: 100%;

  && {
    align-items: flex-start;
    gap: 8px;
    padding: 7px var(--pure-chrome-inset);
    background: ${({ $active }) =>
      $active ? 'var(--pure-chrome-selection)' : 'transparent'};
  }

  &&:hover {
    background: var(--pure-chrome-hover);
  }
`

export const TaskDrawerOpen = styled.button`
  display: flex;
  min-width: 0;
  flex: 1 1 auto;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  padding: 0;
  text-align: left;
`

export const TaskDrawerCheck = styled.button<{
  $thread?: boolean
  $done?: boolean
}>`
  display: inline-flex;
  width: 13px;
  height: 13px;
  flex: none;
  align-items: center;
  justify-content: center;
  margin-top: 2px;
  border: 1.5px solid
    ${({ $thread }) =>
      $thread ? 'var(--puremail-accent)' : 'currentColor'};
  border-radius: 3px;
  background: ${({ $done }) =>
    $done ? 'var(--puremail-accent)' : 'transparent'};
  cursor: pointer;
  opacity: ${({ $thread, $done }) => ($thread || $done ? 1 : 0.4)};
  padding: 0;

  svg {
    width: 9px;
    height: 9px;
    color: var(--pure-chrome-on-accent);
  }
`

export const TaskDrawerText = styled.span`
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
`

export const TaskDrawerTitle = styled.span<{
  $thread?: boolean
  $done?: boolean
}>`
  overflow: hidden;
  font-size: var(--pure-chrome-ui-size);
  font-weight: ${({ $thread }) => ($thread ? 500 : 400)};
  opacity: ${({ $done }) => ($done ? 0.5 : 1)};
  text-decoration: ${({ $done }) => ($done ? 'line-through' : 'none')};
  text-overflow: ellipsis;
  white-space: nowrap;
`

export const TaskDrawerMeta = styled.span.attrs(chrome('meta'))`
  overflow: hidden;
  text-overflow: ellipsis;
`

export const TaskDrawerAdd = styled.button`
  border: 0;
  background: transparent;
  color: var(--puremail-accent);
  cursor: pointer;
  font: inherit;
  font-size: var(--pure-chrome-meta-size);
  font-weight: 500;
  padding: 0;
`

/**
 * Transient state — a fetch result, an undo offer — at the foot of the mail
 * area. Fetch outcomes used to be routed into a notice string that nothing
 * rendered, so a fetch could fail in complete silence.
 */
export const MailToast = styled.div`
  position: absolute;
  bottom: 14px;
  left: 50%;
  z-index: 40;
  display: flex;
  max-width: calc(100% - 32px);
  align-items: center;
  gap: 12px;
  border: 1px solid var(--puremail-line);
  border-radius: 6px;
  background: var(--platform-colors-text);
  color: var(--pure-chrome-on-accent);
  box-shadow: 0 8px 24px color-mix(in srgb, #111827 22%, transparent);
  font-size: var(--pure-chrome-ui-size);
  padding: 8px 12px;
  transform: translateX(-50%);
  white-space: nowrap;
`

export const MailToastAction = styled.button`
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  font-weight: 600;
  padding: 2px 6px;
  text-decoration: underline;
`

export const TaskDrawerEmpty = styled.p`
  margin: 0;
  color: var(--platform-colors-text-tertiary);
  font-size: var(--pure-chrome-ui-size);
  padding: 10px 12px;
`

/**
 * Only the thread rows scroll. The header and the filter chips sit above this
 * and the drawer below it, so neither scrolls away from the list it labels.
 */
export const PaneScroll = styled.div`
  min-height: 0;
  flex: 1 1 auto;
  overflow: auto;
`

/**
 * Tasks docked under the thread list. They used to be a fourth column with a
 * 48px rail beside it, which narrowed the reading pane whether open or shut.
 * Here they cost nothing but their own header when collapsed.
 */
export const DockedTaskDrawer = styled.section`
  display: flex;
  flex: none;
  flex-direction: column;
  /* Visually last in the content column, whatever renders after it in the
     DOM (the reader does, so the surfaces can swap without moving this). */
  order: 10;
  /* Never more than this, so the thread list always keeps rows visible. */
  max-height: 40%;
  border-top: 1px solid var(--puremail-line);
  background: var(--puremail-pane-header-bg);
`

export const DockedTaskDrawerHeader = styled.button`
  display: flex;
  height: 34px;
  align-items: center;
  gap: 8px;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  flex: none;
  font: inherit;
  padding: 0 12px;
  text-align: left;
  width: 100%;
`

export const TaskCountPill = styled.span`
  border-radius: 9px;
  background: color-mix(in srgb, currentColor 8%, transparent);
  color: var(--platform-colors-text-secondary);
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-meta-size);
  padding: 1px 6px;
`

/**
 * The active task filter, visible and dismissible. The '1'/'3' shortcuts
 * still scope the drawer to the open thread or to follow-ups; without this
 * chip that scoping was an invisible state with no mouse exit.
 */
export const TaskModeChip = styled.button`
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 4px;
  border: 0;
  border-radius: 9px;
  background: var(--puremail-accent-bg);
  color: var(--puremail-accent-text);
  cursor: pointer;
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-meta-size);
  padding: 1px 7px;

  &:hover {
    filter: brightness(0.96);
  }
`

export const TaskDrawerChevron = styled.span`
  color: var(--platform-colors-text-tertiary);
  font-size: var(--pure-chrome-meta-size);
`

/**
 * Four rows, then it scrolls inside itself. Sized in rows rather than pixels
 * so it keeps showing four when the row height changes.
 */
export const DockedTaskDrawerBody = styled.div`
  min-height: 0;
  max-height: calc(4 * 38px);
  flex: 1 1 auto;
  overflow: auto;
  background: var(--puremail-message-bg);
`

/**
 * The way back to the list. The reader REPLACES the list at every width now,
 * so this is always visible — it used to exist only below the overlay
 * breakpoint, when the reader covered the list instead of standing beside it.
 */
export const ReaderBackButton = styled.button.attrs(chrome('toolbar-control'))`
  color: var(--platform-colors-text-secondary);

  &:hover {
    color: var(--platform-colors-text);
  }
  ${fastTipCss}
`

export const ReaderEmptyState = styled.div`
  display: grid;
  min-height: 0;
  flex: 1;
  place-items: center;
  padding: 32px;

  > * {
    --platform-empty-state-padding: 24px;
    --platform-empty-state-title-size: 16px;
    --platform-empty-state-title-weight: 700;
    width: min(420px, 100%);
    min-height: 160px;
    justify-content: center;
    border: 1px solid var(--platform-colors-border-subtle);
    border-radius: var(--platform-radius-sm);
    background: var(--puremail-empty-surface);
  }
`

export const Section = styled.section`
  padding: 8px 14px;
  border-bottom: 1px solid var(--platform-colors-border);
`

export const Kicker = styled.div`
  color: var(--platform-colors-text-secondary);
  font-size: var(--platform-typography-font-size-xs);
  font-weight: 700;
  letter-spacing: var(--pure-chrome-label-tracking);
  text-transform: uppercase;
`

export const ListButton = styled.button<{ $active?: boolean }>`
  display: block;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: var(--platform-radius-sm);
  background: ${({ $active }) =>
    $active ? 'var(--platform-colors-surface)' : 'transparent'};
  color: var(--platform-colors-text);
  text-align: left;
  cursor: pointer;

  &:hover {
    background: var(--platform-colors-bg);
  }
`

/**
 * Fixed row height, in px. The rail windows on this, so the row is given this
 * exact height rather than a min-height it might exceed — the constant and the
 * rendered row cannot drift apart.
 */
export const THREAD_ROW_OVERSCAN = 8


export const SelectField = styled.select`
  width: 100%;
  min-width: 0;
  height: var(--pure-chrome-field-height);
  border: 1px solid var(--pure-chrome-line);
  border-radius: var(--pure-chrome-radius);
  padding: 0 7px;
  color: var(--platform-colors-text);
  background: var(--pure-chrome-surface);
  font: inherit;
  font-size: var(--pure-chrome-ui-size);

  &:focus {
    border-color: var(--pure-chrome-accent);
    outline: none;
  }
`

export const SearchRow = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) 34px;
  align-items: center;
  gap: 8px;
`


export const SettingToggle = styled.label`
  display: grid;
  grid-template-columns: minmax(88px, 120px) minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  color: var(--platform-colors-text-secondary);
  font-size: var(--platform-typography-font-size-sm);

  input {
    accent-color: var(--platform-colors-accent);
  }

  input:not([type='checkbox']) {
    width: 100%;
    min-width: 0;
    height: 30px;
    border: 1px solid var(--platform-colors-border-subtle);
    border-radius: var(--platform-radius-sm);
    padding: 0 8px;
    color: var(--platform-colors-text);
    background: var(--platform-colors-surface);
    font: inherit;
  }

  input[type='checkbox'] {
    justify-self: start;
  }
`

export const Subject = styled.div`
  min-width: 0;
  font-size: var(--pure-chrome-ui-size);
  font-weight: 700;
  line-height: 1.28;
  overflow-wrap: anywhere;
`

export const Meta = styled.div`
  min-width: 0;
  margin-top: 3px;
  color: var(--platform-colors-text-secondary);
  font-size: var(--pure-chrome-ui-size);
  line-height: 1.5;
  overflow-wrap: anywhere;
`

/** The word beside a toolbar icon; the first thing dropped when width runs out. */
export const ReaderToolbarLabel = styled.span`
  display: inline;
`

/** The toolbar's fixed height — the sticky sender line stacks under it. */
/** Matches --pure-chrome-toolbar-height; a number because the sticky offsets need one. */
export const READER_TOOLBAR_HEIGHT = 36

/**
 * One 38px row of actions. Sticky FROM LOAD inside the reader's scroll
 * flow: the search band above it scrolls away like content, this row
 * reaches the top and stays. Constant height in both of its states —
 * nothing here animates its size. (It used to be a wrapping band of large
 * text buttons sitting *below* the subject, which pushed the first line of
 * the message most of a screen down.)
 */
export const ReaderToolbar = styled.div.attrs(chrome('toolbar'))`
  position: sticky;
  top: 0;
  z-index: 6;
  height: ${READER_TOOLBAR_HEIGHT}px;
  gap: 10px;
  white-space: nowrap;
  /* Not hidden: the More menu is absolutely positioned inside this row, and
     clipping the row clipped the menu out of existence. The labels give way
     below instead, which is what was actually overflowing. */
  overflow: visible;

  > * {
    flex: none;
  }

  @media (max-width: 860px) {
    gap: 6px;

    /* Icons only. The label is the part of an action that can go. */
    ${ReaderToolbarLabel} {
      display: none;
    }
  }
`

/**
 * The toolbar's flexible middle: two layers overlaid in the same slot, so
 * swapping them is an opacity crossfade with NO layout change — the back
 * button and the triage cluster never move. Layer one holds the reply
 * cluster shown at load; layer two holds the inline subject (plus label
 * chip, Reply and Forward) that fades in once the standalone subject row
 * has scrolled up past the toolbar.
 */
export const ReaderToolbarSwap = styled.div`
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
`

export const ReaderToolbarSwapLayer = styled.div<{ $shown?: boolean }>`
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  white-space: nowrap;
  opacity: ${({ $shown }) => ($shown ? 1 : 0)};
  /* visibility, not display: the hidden layer keeps its box (no reflow),
     drops out of the tab order, and can crossfade. */
  visibility: ${({ $shown }) => ($shown ? 'visible' : 'hidden')};
  pointer-events: ${({ $shown }) => ($shown ? 'auto' : 'none')};
  transition: opacity 150ms ease;

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }

  @media (max-width: 860px) {
    gap: 6px;
  }
`

/**
 * The subject, inline in the toolbar once its standalone row has scrolled
 * past — the only statement of it on screen from then on, no duplicate.
 */
export const ReaderCondensedSubject = styled.span`
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--platform-colors-text);
  font-size: 15px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
`

export const ReaderToolbarButton = styled.button.attrs(chrome('toolbar-control'))`
  gap: 4px;
  color: var(--platform-colors-text-secondary);

  &:hover {
    color: var(--platform-colors-text);
  }

  svg {
    flex: none;
    opacity: 0.75;
  }
  ${fastTipCss}
`

export const ReaderToolbarPrimary = styled(ReaderToolbarButton)`
  && {
    background: var(--pure-chrome-accent);
    color: var(--pure-chrome-on-accent);
    padding: 0 11px;
  }

  &&:hover {
    filter: brightness(0.92);
  }
`

/** `4 of 55`, then the two keys that move it. */
/** `4 of 55`, then the two keys that move it. */
export const ReaderPosition = styled.span.attrs(chrome('meta'))`
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-variant-numeric: tabular-nums;
`

/**
 * The reading pane as three bands: header, message, attachment footer. Only
 * the middle one scrolls, which is what gives the pane a top and a bottom
 * edge — content used to stack at the top-left of a wide pane with no measure
 * cap and nothing closing it off, so a short message looked stranded.
 */
export const ReaderPane = styled.div`
  /* The history popover anchors to this box and clips at its edge. */
  position: relative;
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1;
  height: 100%;
  flex-direction: column;
  overflow: hidden;
`

/** The measure everything in the pane aligns to. */
export const READER_MEASURE = 640

export const ReaderBandInner = styled.div`
  width: 100%;
  max-width: ${READER_MEASURE}px;
  margin: 0 auto;
  min-width: 0;
`

export const ReaderHeaderBand = styled.header`
  /* Part of the reader's scroll flow: the subject row leaves the screen by
     scrolling up past the sticky toolbar, like content — it does not
     animate, collapse, or hide. */
  border-bottom: 1px solid var(--puremail-line);
  background: var(--puremail-pane-header-bg);
  padding: 22px 40px;

  @media (max-width: 720px) {
    padding: 22px 24px;
  }
`

/** State, not action: the accent stays reserved for actions and real priority. */
export const ReaderStateLine = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 8px;
  min-width: 0;
  margin-bottom: 10px;
  color: var(--platform-colors-text-tertiary);
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-meta-size);
  /* An item may move to the next row whole; it may never break inside —
     that is what turned the timestamp into a three-line column. */
  white-space: nowrap;

  > * {
    flex: none;
  }
`

export const ReaderStateChip = styled.span`
  flex: none;
  border-radius: 4px;
  background: color-mix(in srgb, currentColor 12%, transparent);
  color: var(--platform-colors-text-secondary);
  font-size: var(--pure-chrome-label-size);
  letter-spacing: var(--pure-chrome-label-tracking);
  padding: 2px 7px;
  text-transform: uppercase;
`

export const ReaderDetailsButton = styled.button`
  flex: none;
  margin-left: auto;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--puremail-accent);
  cursor: pointer;
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-meta-size);
  padding: 2px 4px;

  &:hover {
    background: color-mix(in srgb, currentColor 10%, transparent);
  }
`

/** Everything the header no longer states inline. */
export const ReaderDetailsPanel = styled.dl`
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 4px 12px;
  margin: 14px 0 0;
  padding-top: 12px;
  border-top: 1px solid var(--puremail-line);
  font-size: var(--pure-chrome-meta-size);

  dt {
    color: var(--platform-colors-text-tertiary);
    font-family: var(--platform-typography-font-family-mono);
  }

  dd {
    margin: 0;
    color: var(--platform-colors-text-secondary);
    overflow-wrap: anywhere;
  }
`

/**
 * Zero-height sticky anchor for the slim sender line. It sits in the scroll
 * flow between the header band and the message body, sticks at exactly the
 * toolbar's height, and — because it is 0px tall — never occupies space, so
 * the line's appearance can never move content. The 28px line itself hangs
 * off it as an absolute child.
 *
 * Direct child of ReaderScroll on purpose: Chromium resolves sticky offsets
 * against the scroll container's CONTENT box, so any padding on the
 * scroller would push the pinned position down by that padding (the line
 * once floated 32px into the message because of exactly this). ReaderScroll
 * therefore carries no padding — ReaderScrollBody does.
 */
export const MessageStickyAnchor = styled.div`
  position: sticky;
  top: ${READER_TOOLBAR_HEIGHT}px;
  z-index: 5;
  height: 0;
  overflow: visible;
`

/**
 * The open message's slim reading-height header: sender + position, pinned
 * directly under the always-sticky toolbar while the body scrolls beneath
 * it. Opaque background by construction — text passes under it the way it
 * passes under any sticky table header. Hidden (not painted) until the
 * message's full header has scrolled out of view; the swap is an opacity
 * fade only, so nothing ever jumps.
 */
export const MessageStickyHeader = styled.div<{ $visible?: boolean }>`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 28px;
  border-bottom: 1px solid var(--puremail-line);
  background: var(--puremail-message-bg);
  padding: 0 40px;
  white-space: nowrap;
  /* Informational chrome: it must never intercept clicks meant for the
     text scrolling beneath it. */
  pointer-events: none;
  opacity: ${({ $visible }) => ($visible ? 1 : 0)};
  visibility: ${({ $visible }) => ($visible ? 'visible' : 'hidden')};
  transition: opacity 150ms ease;

  @media (max-width: 720px) {
    padding: 0 24px;
  }

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
`

/** Aligns the slim line's content to the message column below it. */
export const MessageStickyInner = styled(ReaderBandInner)`
  display: flex;
  height: 100%;
  align-items: center;
  gap: 8px;
`

export const MessageStickySenderName = styled.span`
  min-width: 0;
  overflow: hidden;
  color: var(--platform-colors-text);
  font-size: var(--pure-chrome-ui-size);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
`

/**
 * `⇅ 6 in thread ⌄` on the state line — the whole of the thread's presence
 * in message mode. It replaces the Sent/Received chip wall, which wrapped
 * into two colliding rows at six messages and would have been unusable at
 * fifty.
 */
export const ThreadPill = styled.button<{ $open?: boolean }>`
  display: inline-flex;
  flex: none;
  margin-left: auto;
  align-items: center;
  gap: 5px;
  border: 1px solid
    ${({ $open }) =>
      $open
        ? 'var(--puremail-accent)'
        : 'color-mix(in srgb, currentColor 25%, transparent)'};
  border-radius: 11px;
  background: ${({ $open }) =>
    $open ? 'var(--puremail-accent-bg)' : 'transparent'};
  color: ${({ $open }) =>
    $open
      ? 'var(--puremail-accent-text)'
      : 'var(--platform-colors-text-secondary)'};
  cursor: pointer;
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-meta-size);
  padding: 3px 10px;
  white-space: nowrap;

  &:hover {
    border-color: var(--puremail-accent);
  }
`

/** The words drop before the pill wraps. */
export const ThreadPillLabel = styled.span`
  @media (max-width: 720px) {
    display: none;
  }
`

export const HistoryPopover = styled.div`
  position: absolute;
  top: 52px;
  right: 24px;
  z-index: 12;
  display: flex;
  width: 330px;
  max-width: calc(100% - 32px);
  flex-direction: column;
  border: 1px solid var(--puremail-line);
  border-radius: 10px;
  background: var(--puremail-message-bg);
  box-shadow: 0 14px 38px color-mix(in srgb, #111827 18%, transparent);
  overflow: hidden;
`

export const HistoryPopoverHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  border-bottom: 1px solid var(--puremail-line);
  padding: 10px 12px;
`

export const HistoryPopoverTitle = styled.span`
  color: var(--platform-colors-text-secondary);
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-label-size);
  font-weight: 500;
  letter-spacing: var(--pure-chrome-label-tracking);
  text-transform: uppercase;
`

export const HistoryPopoverCount = styled.span`
  color: var(--platform-colors-text-tertiary);
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-meta-size);
`

export const HistoryCloseButton = styled.button`
  display: inline-flex;
  margin-left: auto;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--platform-colors-text-tertiary);
  cursor: pointer;
  font-size: var(--pure-chrome-ui-size);
  line-height: 1;
  padding: 3px 5px;

  &:hover {
    color: var(--platform-colors-text);
    background: color-mix(in srgb, currentColor 8%, transparent);
  }
`

export const HistoryFilterRow = styled.div`
  display: flex;
  flex: none;
  align-items: center;
  gap: 6px;
  border-bottom: 1px solid
    color-mix(in srgb, var(--platform-colors-text) 6%, transparent);
  padding: 8px 12px;
  overflow-x: auto;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
`

export const HistoryRowList = styled.div`
  min-height: 0;
  /* ~7 rows before it scrolls. */
  max-height: 252px;
  overflow-y: auto;
`

export const HistoryMonthLabel = styled.div`
  border-bottom: 1px solid
    color-mix(in srgb, var(--platform-colors-text) 5%, transparent);
  color: color-mix(in srgb, var(--platform-colors-text) 35%, transparent);
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-label-size);
  letter-spacing: var(--pure-chrome-label-tracking);
  padding: 7px 12px 5px;
  text-transform: uppercase;
`

export const HistoryRow = styled.button<{ $current?: boolean }>`
  display: flex;
  width: 100%;
  align-items: center;
  gap: 8px;
  border: 0;
  border-bottom: 1px solid
    color-mix(in srgb, var(--platform-colors-text) 5%, transparent);
  border-left: 2px solid
    ${({ $current }) =>
      $current ? 'var(--puremail-accent)' : 'transparent'};
  background: ${({ $current }) =>
    $current ? 'var(--puremail-accent-bg)' : 'transparent'};
  color: inherit;
  cursor: pointer;
  font: inherit;
  padding: 7px 12px;
  text-align: left;
  white-space: nowrap;

  &:hover {
    background: ${({ $current }) =>
      $current
        ? 'var(--puremail-accent-bg)'
        : 'color-mix(in srgb, currentColor 4%, transparent)'};
  }
`

export const HistoryRowGlyph = styled.span<{ $state: string }>`
  flex: none;
  color: ${({ $state }) =>
    $state === 'received'
      ? 'var(--platform-colors-text-tertiary)'
      : 'var(--puremail-accent)'};
  font-size: var(--pure-chrome-ui-size);
  opacity: ${({ $state }) => ($state === 'draft' ? 0.55 : 0.8)};
`

export const HistoryRowState = styled.span`
  flex: none;
  font-size: var(--pure-chrome-ui-size);
  font-weight: 500;
`

export const HistoryRowTime = styled.span`
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--platform-colors-text-tertiary);
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-meta-size);
  text-overflow: ellipsis;
`

export const HistoryRowMarker = styled.span`
  flex: none;
  color: var(--platform-colors-text-tertiary);
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-meta-size);
`

export const HistoryFooter = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  border-top: 1px solid var(--puremail-line);
  background: var(--puremail-pane-header-bg);
  color: var(--platform-colors-text-tertiary);
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-meta-size);
  padding: 9px 12px;
`

export const HistoryFooterLink = styled.button`
  margin-left: auto;
  border: 0;
  background: transparent;
  color: var(--puremail-accent);
  cursor: pointer;
  font: inherit;
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-meta-size);
  font-weight: 500;
  padding: 0;

  &:hover {
    text-decoration: underline;
  }
`

/* ── Thread view (9a) ─────────────────────────────────────────────── */

export const ThreadViewHeaderBand = styled.div`
  flex: none;
  border-bottom: 1px solid var(--puremail-line);
  background: var(--puremail-pane-header-bg);
  padding: 16px 40px 14px;

  @media (max-width: 720px) {
    padding: 16px 24px 14px;
  }
`

export const ThreadViewTopRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
`

export const ThreadViewBack = styled.button`
  border: 0;
  background: transparent;
  color: var(--puremail-accent);
  cursor: pointer;
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-meta-size);
  padding: 2px 0;

  &:hover {
    text-decoration: underline;
  }
`

export const PaneModeToggle = styled.div`
  display: inline-flex;
  margin-left: auto;
  border: 1px solid var(--puremail-line);
  border-radius: 6px;
  background: var(--puremail-message-bg);
  overflow: hidden;
`

export const PaneModeButton = styled.button<{ $active?: boolean }>`
  border: 0;
  background: ${({ $active }) =>
    $active ? 'var(--puremail-accent)' : 'transparent'};
  color: ${({ $active }) =>
    $active
      ? 'var(--pure-chrome-on-accent)'
      : 'var(--platform-colors-text-secondary)'};
  cursor: pointer;
  font: inherit;
  font-size: var(--pure-chrome-ui-size);
  font-weight: 500;
  padding: 4px 12px;

  &:hover {
    color: ${({ $active }) =>
      $active
        ? 'var(--pure-chrome-on-accent)'
        : 'var(--platform-colors-text)'};
  }
`

export const ThreadViewSubject = styled.h1`
  margin: 0 0 8px;
  color: var(--platform-colors-text);
  font-size: 18px;
  font-weight: 600;
  line-height: 1.3;
`

export const ThreadViewMetaLine = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  color: var(--platform-colors-text-tertiary);
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-meta-size);
  white-space: nowrap;
`

export const ThreadViewAvatars = styled.span`
  display: inline-flex;
  flex: none;

  > span {
    display: inline-flex;
    width: 18px;
    height: 18px;
    align-items: center;
    justify-content: center;
    border: 1.5px solid var(--puremail-pane-header-bg);
    border-radius: 50%;
    font-family: var(--platform-typography-font-family);
    font-size: 8.5px;
    font-weight: 600;
  }

  > span + span {
    margin-left: -5px;
  }
`

export const ThreadFilterStrip = styled.div`
  display: flex;
  flex: none;
  align-items: center;
  gap: 6px;
  border-bottom: 1px solid var(--puremail-line);
  padding: 8px 40px;

  @media (max-width: 720px) {
    padding: 8px 24px;
  }
`

export const ThreadSearchInput = styled.input`
  width: 130px;
  margin-left: auto;
  border: 0;
  background: transparent;
  color: var(--platform-colors-text);
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-meta-size);
  outline: none;
  padding: 2px 4px;

  &::placeholder {
    color: var(--platform-colors-text-tertiary);
  }
`

export const ThreadExpandAll = styled.button`
  flex: none;
  border: 0;
  background: transparent;
  color: var(--puremail-accent);
  cursor: pointer;
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-meta-size);
  padding: 2px 0;

  &:hover {
    text-decoration: underline;
  }
`

export const ThreadViewScroll = styled.div`
  min-height: 0;
  flex: 1 1 auto;
  overflow: auto;
  padding: 12px 40px;

  @media (max-width: 720px) {
    padding: 12px 24px;
  }
`

export const ThreadViewMonth = styled.div`
  color: color-mix(in srgb, var(--platform-colors-text) 35%, transparent);
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-label-size);
  letter-spacing: var(--pure-chrome-label-tracking);
  padding: 10px 0 6px 34px;
  text-transform: uppercase;
`

/** 22px rail beside each entry: a dot on a shared vertical line. */
export const TimelineEntry = styled.div`
  position: relative;
  display: flex;
  gap: 12px;
  padding-left: 22px;

  &::before {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 4px;
    width: 1px;
    background: color-mix(in srgb, var(--platform-colors-text) 12%, transparent);
    content: '';
  }
`

export const TimelineDot = styled.span<{ $current?: boolean }>`
  position: absolute;
  top: ${({ $current }) => ($current ? '14px' : '14px')};
  left: 0;
  z-index: 1;
  width: ${({ $current }) => ($current ? '9px' : '7px')};
  height: ${({ $current }) => ($current ? '9px' : '7px')};
  border: ${({ $current }) =>
    $current ? '0' : '1.5px solid color-mix(in srgb, var(--platform-colors-text) 30%, transparent)'};
  border-radius: 50%;
  background: ${({ $current }) =>
    $current
      ? 'var(--puremail-accent)'
      : 'var(--puremail-message-bg)'};
  transform: translateX(${({ $current }) => ($current ? '0' : '1px')});
`

export const TimelineBody = styled.div`
  min-width: 0;
  flex: 1;
  padding-bottom: 10px;
`

/** The open message, expanded in place as a bordered card. */
export const TimelineCard = styled.article`
  border: 1px solid color-mix(in srgb, var(--platform-colors-text) 12%, transparent);
  border-radius: 9px;
  background: var(--puremail-message-bg);
  overflow: hidden;
`

export const TimelineCardHead = styled.button<{ $current?: boolean }>`
  display: flex;
  width: 100%;
  align-items: center;
  gap: 8px;
  border: 0;
  border-bottom: 1px solid
    color-mix(in srgb, var(--platform-colors-text) 7%, transparent);
  background: ${({ $current }) =>
    $current ? 'var(--puremail-accent-bg)' : 'var(--puremail-pane-header-bg)'};
  color: inherit;
  cursor: pointer;
  font: inherit;
  padding: 9px 14px;
  text-align: left;
  white-space: nowrap;
`

export const TimelineCardBody = styled.div`
  color: var(--platform-colors-text);
  font-size: var(--pure-chrome-ui-size);
  line-height: 1.7;
  padding: 12px 14px;
  overflow-wrap: anywhere;

  p {
    margin: 0 0 12px;
  }

  p:last-child {
    margin-bottom: 0;
  }
`

/** A collapsed message: one 36px row. */
export const TimelineRow = styled.button`
  display: flex;
  width: 100%;
  height: 36px;
  align-items: center;
  gap: 8px;
  border: 0;
  border-bottom: 1px solid
    color-mix(in srgb, var(--platform-colors-text) 5%, transparent);
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  padding: 0 6px;
  text-align: left;
  white-space: nowrap;

  &:hover {
    background: color-mix(in srgb, currentColor 4%, transparent);
  }
`

export const TimelineRowSnippet = styled.span`
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: color-mix(in srgb, var(--platform-colors-text) 50%, transparent);
  font-size: var(--pure-chrome-ui-size);
  text-overflow: ellipsis;
`

export const TimelineDraftWord = styled.span`
  flex: none;
  color: var(--platform-colors-text-tertiary);
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-meta-size);
`

export const ThreadViewFooter = styled.div`
  display: flex;
  flex: none;
  align-items: center;
  gap: 12px;
  border-top: 1px solid var(--puremail-line);
  background: var(--puremail-pane-header-bg);
  color: var(--platform-colors-text-tertiary);
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-meta-size);
  padding: 10px 40px;

  @media (max-width: 720px) {
    padding: 10px 24px;
  }
`

/* ── Reply composer (10b) ─────────────────────────────────────────── */

/**
 * Full-pane compose. Every band is a sibling of the scrolling body region,
 * never inside it — the old composer lived inside the message's scroll
 * container, so scrolling for Send reply hit the bottom of the message and
 * jumped back to the top.
 */
export const ComposerBar = styled.div`
  display: flex;
  height: 38px;
  flex: none;
  align-items: center;
  gap: 10px;
  border-bottom: 1px solid var(--puremail-line);
  background: var(--puremail-pane-header-bg);
  padding: 0 16px;
  white-space: nowrap;
`

export const ComposerBarStatus = styled.span`
  margin-left: auto;
  color: var(--platform-colors-text-tertiary);
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-meta-size);
`

export const ComposerHeaderBand = styled.div`
  flex: none;
  border-bottom: 1px solid var(--puremail-line);
  background: var(--puremail-pane-header-bg);
  padding: 16px 32px 14px;

  @media (max-width: 720px) {
    padding: 16px 20px 14px;
  }
`

export const ComposerKicker = styled.div`
  margin-bottom: 6px;
  color: var(--platform-colors-text-tertiary);
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-label-size);
  letter-spacing: var(--pure-chrome-label-tracking);
  text-transform: uppercase;
`

/** The subject as text that happens to be editable, not a boxed field. */
export const ComposerSubjectInput = styled.input`
  width: 100%;
  margin: 0 0 10px;
  border: 0;
  background: transparent;
  color: var(--platform-colors-text);
  font-family: var(--platform-typography-font-family);
  font-size: 17px;
  font-weight: 600;
  line-height: 1.3;
  outline: none;
  padding: 0;

  &:focus {
    border-bottom: 1px dashed
      color-mix(in srgb, var(--platform-colors-text) 20%, transparent);
  }
`

export const ComposerRecipientRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;

  > :nth-child(2) {
    flex: 1;
    min-width: 0;
  }
`

export const ComposerToLabel = styled.span`
  flex: none;
  color: var(--platform-colors-text-tertiary);
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-meta-size);
`

export const ComposerCcButton = styled.button`
  flex: none;
  border: 0;
  background: transparent;
  color: var(--puremail-accent);
  cursor: pointer;
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-meta-size);
  padding: 2px 0;

  &:hover {
    text-decoration: underline;
  }
`

/** The only scrolling part of the composer. */
export const ComposerScroll = styled.div<{ $dropActive?: boolean }>`
  min-height: 0;
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 18px 32px;
  outline: ${({ $dropActive }) =>
    $dropActive
      ? '2px dashed var(--puremail-accent)'
      : 'none'};
  outline-offset: -6px;

  @media (max-width: 720px) {
    padding: 18px 20px;
  }
`

/**
 * Typed on the surface at the reading measure, so a reply looks like what
 * the recipient will read. No bordered box. The textarea grows with its
 * content and never scrolls internally — the region above owns the scroll.
 */
export const ComposerBodyArea = styled.textarea`
  display: block;
  width: 100%;
  max-width: ${READER_MEASURE}px;
  margin: 0 auto;
  border: 0;
  background: transparent;
  color: var(--platform-colors-text);
  font-family: var(--platform-typography-font-family);
  font-size: 13.5px;
  line-height: 1.75;
  outline: none;
  overflow: hidden;
  padding: 0;
  resize: none;

  &::placeholder {
    color: var(--platform-colors-text-tertiary);
  }
`

export const ComposerQuoteWrap = styled.div`
  width: 100%;
  max-width: ${READER_MEASURE}px;
  margin: 18px auto 0;
`

export const ComposerAssistRow = styled.div`
  display: flex;
  flex: none;
  align-items: center;
  gap: 6px;
  border-top: 1px solid
    color-mix(in srgb, var(--platform-colors-text) 7%, transparent);
  background: var(--puremail-pane-header-bg);
  padding: 9px 32px;
  overflow-x: auto;
  scrollbar-width: none;
  white-space: nowrap;

  &::-webkit-scrollbar {
    display: none;
  }

  @media (max-width: 720px) {
    padding: 9px 20px;
  }
`

export const AssistLabel = styled.span`
  flex: none;
  color: var(--platform-colors-text-secondary);
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-meta-size);
`

export const AssistPresetChip = styled.button<{ $dashed?: boolean }>`
  flex: none;
  border: 1px ${({ $dashed }) => ($dashed ? 'dashed' : 'solid')}
    color-mix(in srgb, var(--platform-colors-text) 20%, transparent);
  border-radius: 11px;
  background: transparent;
  color: var(--platform-colors-text-secondary);
  cursor: pointer;
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-meta-size);
  padding: 3px 10px;

  &:hover {
    border-color: var(--puremail-accent);
    color: var(--puremail-accent);
  }

  &:disabled {
    cursor: default;
    opacity: 0.5;
  }
`

export const AssistCustomInput = styled.input`
  flex: 1;
  min-width: 80px;
  border: 0;
  border-bottom: 1px dashed
    color-mix(in srgb, var(--platform-colors-text) 25%, transparent);
  background: transparent;
  color: var(--platform-colors-text);
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-meta-size);
  outline: none;
  padding: 2px 4px;
`

export const AssistUndo = styled.button`
  flex: none;
  margin-left: auto;
  border: 0;
  background: transparent;
  color: var(--platform-colors-text-secondary);
  cursor: pointer;
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-meta-size);
  padding: 2px 4px;

  &:hover {
    color: var(--platform-colors-text);
    text-decoration: underline;
  }
`

export const ComposerFooter = styled.div`
  display: flex;
  flex: none;
  /* Wraps rather than overflows: Send reply must be reachable at every
     pane width, which is the whole point of the pinned footer. */
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  border-top: 1px solid var(--puremail-line);
  background: var(--puremail-pane-header-bg);
  padding: 11px 32px;
  white-space: nowrap;

  @media (max-width: 720px) {
    padding: 11px 20px;
  }
`

/** Also the drop hint — the whole body region accepts drops. */
export const ComposerAttachLabel = styled.label`
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 5px;
  border: 1px dashed
    color-mix(in srgb, var(--platform-colors-text) 20%, transparent);
  border-radius: 11px;
  color: var(--platform-colors-text-secondary);
  cursor: pointer;
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-meta-size);
  padding: 3px 10px;

  &:hover {
    border-color: var(--puremail-accent);
    color: var(--puremail-accent);
  }

  input {
    display: none;
  }
`

/**
 * The one draft-state indicator. Replaces the created banner, the DRAFT
 * REPLY heading, "Manual draft", and "Not sent · draft saved …" — which all
 * said versions of the same thing, stacked.
 */
export const ComposerSavedMarker = styled.span<{ $failed?: boolean }>`
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 6px;
  color: ${({ $failed }) =>
    $failed
      ? 'var(--puremail-danger-text, #b23a2e)'
      : 'var(--platform-colors-text-tertiary)'};
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-meta-size);

  &::before {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: ${({ $failed }) =>
      $failed
        ? 'var(--puremail-danger-text, #b23a2e)'
        : 'var(--puremail-accent)'};
    content: '';
  }
`

export const ComposerDiscard = styled.button<{ $armed?: boolean }>`
  flex: none;
  border: 0;
  background: transparent;
  color: ${({ $armed }) =>
    $armed
      ? 'var(--puremail-danger-text, #b23a2e)'
      : 'var(--platform-colors-text-tertiary)'};
  cursor: pointer;
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-meta-size);
  font-weight: ${({ $armed }) => ($armed ? 600 : 400)};
  padding: 4px 6px;

  &:hover {
    color: var(--puremail-danger-text, #b23a2e);
  }
`

/* ── Invite card (8a) ─────────────────────────────────────────────── */

/**
 * A machine-generated notice is state on the object it describes, never a
 * paragraph. The invite card carries the event, the response, and the
 * actions; the old body sentence lives in the status row now.
 */
export const InviteCard = styled.section`
  width: 100%;
  max-width: ${READER_MEASURE}px;
  margin: 0 auto 16px;
  border: 1px solid color-mix(in srgb, var(--platform-colors-text) 12%, transparent);
  border-radius: 9px;
  background: var(--puremail-message-bg);
  overflow: hidden;
`

export const InviteCardHead = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px 12px;
`

export const InviteCardLabel = styled.div`
  margin-bottom: 4px;
  color: var(--platform-colors-text-tertiary);
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-label-size);
  letter-spacing: var(--pure-chrome-label-tracking);
  text-transform: uppercase;
`

export const InviteCardTitle = styled.div`
  color: var(--platform-colors-text);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.35;
  text-wrap: pretty;
`

export const InviteCardWhen = styled.div`
  margin-top: 3px;
  color: color-mix(in srgb, var(--platform-colors-text) 60%, transparent);
  font-size: var(--pure-chrome-ui-size);
`

export const InviteCardMeta = styled.div`
  margin-top: 3px;
  color: var(--platform-colors-text-tertiary);
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-meta-size);
`

export type InviteStatusTone = 'confirmed' | 'tentative' | 'declined' | 'neutral'

const INVITE_TONE = {
  confirmed: {
    border: 'var(--puremail-success-border, #4a7d55)',
    text: 'var(--puremail-success-text, #2f5a38)',
    tint: 'var(--puremail-success-bg, #f4f7f4)',
  },
  tentative: {
    border: 'var(--puremail-warning-border, #c98a2b)',
    text: 'var(--puremail-warning-text, #7a5114)',
    tint: 'var(--puremail-warning-bg, #f9f3e6)',
  },
  declined: {
    border: 'var(--puremail-danger-border, #b23a2e)',
    text: 'var(--puremail-danger-text, #9c3b1f)',
    tint: 'var(--puremail-danger-bg, #fbe8e2)',
  },
  neutral: {
    border: 'color-mix(in srgb, currentColor 25%, transparent)',
    text: 'var(--platform-colors-text-secondary)',
    tint: 'var(--puremail-pane-header-bg)',
  },
} as const

export const InviteStatusPill = styled.span<{ $tone: InviteStatusTone }>`
  flex: none;
  margin-left: auto;
  border: 1px solid ${({ $tone }) => INVITE_TONE[$tone].border};
  border-radius: 11px;
  color: ${({ $tone }) => INVITE_TONE[$tone].text};
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-meta-size);
  padding: 3px 10px;
  white-space: nowrap;
`

/** Where the old "alex@… has accepted the invitation" sentence lives now. */
export const InviteStatusRow = styled.div<{ $tone: InviteStatusTone }>`
  display: flex;
  align-items: center;
  gap: 8px;
  border-top: 1px solid
    color-mix(in srgb, var(--platform-colors-text) 7%, transparent);
  background: ${({ $tone }) => INVITE_TONE[$tone].tint};
  padding: 9px 16px;
  white-space: nowrap;
`

export const InviteStatusText = styled.span<{ $tone: InviteStatusTone }>`
  flex: none;
  color: ${({ $tone }) => INVITE_TONE[$tone].text};
  font-size: var(--pure-chrome-ui-size);
  font-weight: 500;
`

export const InviteStatusMeta = styled.span`
  min-width: 0;
  overflow: hidden;
  color: var(--platform-colors-text-tertiary);
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-meta-size);
  text-overflow: ellipsis;
`

export const InviteCardActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  border-top: 1px solid
    color-mix(in srgb, var(--platform-colors-text) 7%, transparent);
  padding: 10px 16px;
`

export const InviteCardNote = styled.span`
  margin-left: auto;
  color: color-mix(in srgb, var(--platform-colors-text) 42%, transparent);
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-meta-size);
  white-space: nowrap;
`

/**
 * `Generated by PureMail from invite-reply.ics · no message body`
 *
 * A div, not a p: inside MessageCard a descendant `p` rule sets 16px body
 * type with higher specificity, which blew this up to headline size the
 * first time it rendered on real mail.
 */
export const ProvenanceLine = styled.div`
  width: 100%;
  max-width: ${READER_MEASURE}px;
  margin: 0 auto;
  color: color-mix(in srgb, var(--platform-colors-text) 42%, transparent);
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-meta-size);
  line-height: 1.5;
`

/**
 * The reader's ONE scroll container. In reading mode the search band, the
 * sticky toolbar and the header band all live INSIDE it: disappearing
 * chrome is simply part of the scrollable flow and scrolls off like
 * content, and the toolbar sticks at the top from load.
 *
 * No padding here — Chromium resolves sticky offsets against the scroll
 * container's content box, so padding on this element would push every
 * sticky child down by that much. The reading margin lives on
 * ReaderScrollBody instead.
 */
export const ReaderScroll = styled.div`
  min-height: 0;
  flex: 1 1 auto;
  overflow: auto;
`

/** The message column's margin, moved off the scroller (see above). */
export const ReaderScrollBody = styled.div`
  padding: 32px 40px;

  @media (max-width: 720px) {
    padding: 24px;
  }
`

/**
 * The pane's bottom edge. Without it a short message trailed off into empty
 * white with nothing closing the column.
 */
export const ReaderAttachmentBand = styled.div`
  flex: none;
  border-top: 1px solid var(--puremail-line);
  background: var(--puremail-pane-header-bg);
  padding: 12px 40px;

  @media (max-width: 720px) {
    padding: 12px 24px;
  }
`

/**
 * Attachments as chips that flow across the pane's width, not a column of
 * full-width rows. Two files sit side by side instead of stacking; a
 * mailbox full of them wraps and, once expanded past a handful, scrolls
 * inside a capped height rather than pushing the band down the pane.
 */
/**
 * Attachments read as a wide scannable strip, not the 640px prose column:
 * chips flow across the pane so two normal files sit side by side, and
 * the band stays short.
 */
export const AttachmentBandInner = styled.div`
  width: 100%;
  max-width: 1040px;
  margin: 0 auto;
  min-width: 0;
`

export const AttachmentChips = styled.div<{ $scroll?: boolean }>`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  ${({ $scroll }) =>
    $scroll ? 'max-height: 40vh; overflow-y: auto; padding-right: 4px;' : ''}
`

export const ReaderAttachmentChip = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  max-width: 100%;
  padding: 5px 8px 5px 6px;
  border: 1px solid var(--puremail-line);
  border-radius: 8px;
  background: var(--puremail-message-bg);
`

export const AttachmentChipActions = styled.div`
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 4px;
`

/**
 * Save all (and Reveal folder) ride the chip line, pushed to its right by
 * margin-left:auto — sharing the row when the chips leave room, wrapping
 * to a right-aligned line of their own only when they do not.
 */
export const AttachmentChipControlsRight = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
`

export const AttachmentRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;

  & + & {
    margin-top: 10px;
  }
`

export const AttachmentTypeTile = styled.span`
  display: inline-flex;
  width: 24px;
  height: 24px;
  flex: none;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--puremail-line);
  border-radius: 5px;
  background: var(--puremail-message-bg);
  color: var(--platform-colors-text-tertiary);
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-meta-size);
  text-transform: lowercase;
`

export const AttachmentRowText = styled.div`
  display: flex;
  min-width: 0;
  /* One line inside a chip: name then a muted size, the name ellipsizing
     so a chip is only as wide as it needs and never stretches across the
     pane. Content-sized (not flex:1) so chips pack rather than fill. */
  flex: 0 1 auto;
  max-width: 300px;
  align-items: baseline;
  gap: 6px;
`

export const AttachmentRowName = styled.span`
  overflow: hidden;
  font-size: var(--pure-chrome-ui-size);
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
`

export const AttachmentRowMeta = styled.span`
  overflow: hidden;
  color: var(--platform-colors-text-tertiary);
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-meta-size);
  text-overflow: ellipsis;
  white-space: nowrap;
`

export const AttachmentRowActions = styled.div`
  display: flex;
  flex: none;
  align-items: center;
  gap: 6px;
`

/** Attachment action button that grows the app's fast tooltip from its aria-label. */
export const AttachmentActionButton = styled(Button)`
  ${fastTipCss}
`

export const ReaderTimestamp = styled.span`
  color: var(--platform-colors-text-tertiary);
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-meta-size);
`

export const ReaderTaskChip = styled.button`
  border: 0;
  border-radius: 4px;
  background: color-mix(in srgb, currentColor 6%, transparent);
  color: var(--platform-colors-text-secondary);
  cursor: pointer;
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-label-size);
  letter-spacing: var(--pure-chrome-label-tracking);
  padding: 2px 7px;
  text-transform: uppercase;

  &:hover {
    color: var(--platform-colors-text);
  }
`

/**
 * The sender, once, under the subject. The header printed it twice — above
 * the subject as a participants line and again in the message card below it.
 */
export const ReaderSenderRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
`

export const ReaderSenderAvatar = styled.span`
  display: inline-flex;
  width: 24px;
  height: 24px;
  flex: none;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-size: 10px;
  font-weight: 500;
  user-select: none;
`

export const ReaderSenderName = styled.span`
  overflow: hidden;
  color: var(--platform-colors-text);
  font-size: var(--pure-chrome-ui-size);
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
`

export const ReaderSenderTo = styled.span`
  min-width: 0;
  overflow: hidden;
  color: var(--platform-colors-text-tertiary);
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-meta-size);
  text-overflow: ellipsis;
  white-space: nowrap;
`

/**
 * Two lines at most, then it ellipsises. At 24px most subjects wrapped to two
 * anyway, which is a lot of vertical space spent on text the list showed.
 */
export const Title = styled.h1`
  display: -webkit-box;
  overflow: hidden;
  margin: 0 0 12px;
  color: var(--platform-colors-text);
  font-size: 20px;
  font-weight: 600;
  line-height: 1.32;
  letter-spacing: 0;
  text-wrap: pretty;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
`

export const MessageCard = styled.article<{ $focused?: boolean }>`
  width: 100%;
  max-width: ${READER_MEASURE}px;
  margin: 0 auto;
  padding: 0 0 8px;
  /* Messages separate with a rule, not by floating apart. */
  border: 0;
  border-top: 1px solid var(--puremail-line);
  border-left: ${({ $focused }) =>
    $focused ? '3px solid var(--puremail-accent)' : '0'};
  padding-left: ${({ $focused }) => ($focused ? '13px' : '0')};
  background: transparent;

  p {
    margin: 10px 0 0;
    color: var(--platform-colors-text);
    font-size: 16px;
    line-height: 1.6;
  }
`

/**
 * The message paper. Light ALWAYS, in both themes — the way Gmail renders
 * mail in dark mode. Sender HTML is designed against white: the sanitizer
 * now lets sender colors, bgcolors and borders through, and #3c4043 body
 * text or a #f5f5f5 band on a dark app theme is illegible. So the paper is
 * pinned — explicit light background, dark ink — while the chrome AROUND
 * the card (header band, toolbar, banners, quote boundaries) stays
 * theme-aware. The platform tokens the body and its descendants read
 * (blockquote rules, quote blocks, links, <pre> chips) are re-declared
 * locally with fixed light values so everything on the paper matches it.
 */
export const MessageBody = styled.div`
  --platform-colors-text: #1f2328;
  --platform-colors-text-secondary: #59636e;
  --platform-colors-text-tertiary: #6e7781;
  --platform-colors-border: #d1d9e0;
  --platform-colors-surface: #f6f8fa;
  --platform-colors-surface-hover: #eef1f4;
  --platform-colors-info: #0b57d0;
  --platform-colors-semantic-blue-text: #0842a0;

  margin-top: 0;
  max-width: 100%;
  padding: 16px 18px;
  border-radius: 8px;
  background: #ffffff;
  color: #1f2328;
  font-family: var(--platform-typography-font-family);
  font-size: 13.5px;
  line-height: 1.65;
  /* break-word, never anywhere: a genuinely long token (a tracking URL,
     an invoice id) still breaks to fit rather than blow out the pane, but
     — unlike anywhere — soft breaks are NOT folded into a column's
     min-content width. anywhere let an auto-laid table starve a short
     right-aligned cell to ~1ch, so "$23.90" wrapped one glyph per line
     in receipts (Stripe/Replit) and any newsletter with a narrow amount
     column. */
  overflow-wrap: break-word;

  /* Email clients render message content with UA-default content-box; the
     app's global border-box reset must not leak in, or every td/img that
     pairs a width with padding/border comes out narrower than the sender
     designed (and than Gmail shows it). */
  *,
  *::before,
  *::after {
    box-sizing: content-box;
  }

  /* Typographic DEFAULTS for plain mail, at :where() zero specificity so
     they behave like UA styles: a designed newsletter's own (scoped,
     filtered) <style> rules — e.g. MJML's \`p { margin: 13px 0 }\` — must
     override them, exactly as they do in Gmail. Before this, the
     \`p:last-child { margin-bottom: 0 }\` rule out-specified every sender
     sheet and shaved the last paragraph margin off each table cell. */
  :where(p, blockquote, ul, ol) {
    margin: 0 0 0.85em;
  }

  :where(p, blockquote, ul, ol):where(:last-child) {
    margin-bottom: 0;
  }

  blockquote {
    padding-left: 12px;
    border-left: 3px solid var(--platform-colors-border);
    color: var(--platform-colors-text-secondary);
  }

  /* Links must read as links: the app accent is near-black in light theme
     and the frame strips underlines, which rendered mail links as plain
     prose. Info blue theme-flips properly and matches mail convention. */
  a {
    color: var(--platform-colors-info);
    text-decoration: underline;
    text-underline-offset: 0.18em;
    word-break: break-word;
  }

  a:hover {
    color: var(--platform-colors-semantic-blue-text);
  }

  :where(h1, h2, h3, h4, h5, h6) {
    margin: 1.1em 0 0.45em;
    line-height: 1.3;
    font-weight: 600;
  }

  :where(h1) { font-size: 1.35em; }
  :where(h2) { font-size: 1.2em; }
  :where(h3) { font-size: 1.1em; }
  :where(h4, h5, h6) { font-size: 1em; }

  :where(h1, h2, h3):where(:first-child) {
    margin-top: 0;
  }

  :where(ul, ol) {
    padding-left: 1.5em;
  }

  :where(li) {
    margin: 0 0 0.25em;
  }

  hr {
    border: 0;
    border-top: 1px solid var(--platform-colors-border);
    margin: 1em 0;
  }

  pre,
  code {
    font-family: var(--platform-typography-font-family-mono);
    font-size: 0.92em;
  }

  pre {
    padding: 10px 12px;
    background: var(--platform-colors-surface);
    border: 1px solid var(--platform-colors-border);
    overflow-x: auto;
  }

  img {
    max-width: 100%;
    height: auto;
  }

  /* Tables render the way the sender designed them. The old reset here
     (td/th { padding: 0; border: 0; vertical-align: top } and a forced
     border-spacing: 0) is exactly what fused button cells together:
     cellpadding/cellspacing/valign/border are presentational HINTS, and any
     author CSS — even this component's — outranks them, so the reset
     silently deleted the sender's cell padding and alignment. Only the
     overflow cap survives; presentational attributes and the sanitized
     inline styles do the rest. */
  table {
    max-width: 100%;
  }
`

export const MailSystemBanner = styled.div`
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--puremail-warning-border);
  background: var(--puremail-warning-bg);
  color: var(--puremail-warning-text);
  font-size: var(--platform-typography-font-size-sm);

  strong {
    color: var(--puremail-warning-text);
  }

  div:last-child {
    margin-left: auto;
    display: flex;
    gap: 6px;
  }
`

export const ReaderCardHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin: -24px -32px 0;
  padding: 14px 32px;
  border-bottom: 1px solid var(--platform-colors-border);
  background: transparent;
`

export const ReaderCardBody = styled.div`
  padding-top: 16px;
`

export const ThreadSignalRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 5px;
  align-items: center;
`

export const MailStateChip = styled.span<{
  $tone?: 'priority' | 'reply' | 'draft' | 'waiting' | 'overdue' | 'replied' | 'label'
}>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 7px;
  border: 1px solid
    ${({ $tone }) =>
      $tone === 'priority' || $tone === 'overdue'
        ? 'var(--puremail-danger-border)'
        : $tone === 'reply'
        ? 'var(--puremail-info-border)'
        : $tone === 'draft' || $tone === 'replied'
        ? 'var(--puremail-success-border)'
        : 'var(--puremail-neutral-chip-border)'};
  border-radius: var(--platform-radius-sm);
  background: ${({ $tone }) =>
    $tone === 'priority' || $tone === 'overdue'
      ? 'var(--puremail-danger-bg)'
      : $tone === 'reply'
      ? 'var(--puremail-info-bg)'
      : $tone === 'draft' || $tone === 'replied'
      ? 'var(--puremail-success-bg)'
      : $tone === 'waiting'
      ? 'var(--puremail-warning-bg)'
      : 'transparent'};
  color: ${({ $tone }) =>
    $tone === 'priority' || $tone === 'overdue'
      ? 'var(--puremail-danger-text)'
      : $tone === 'reply'
      ? 'var(--puremail-info-text)'
      : $tone === 'draft' || $tone === 'replied'
      ? 'var(--puremail-success-text)'
      : $tone === 'waiting'
      ? 'var(--puremail-warning-text)'
      : 'var(--puremail-neutral-chip-text)'};
  font-size: var(--pure-chrome-meta-size);
  font-weight: 550;
  white-space: nowrap;
`


export const PriorityDot = styled.span`
  width: 6px;
  height: 6px;
  border-radius: var(--platform-radius-sm);
  background: var(--puremail-danger-text);
  flex: 0 0 auto;
`


export const TextLinkButton = styled.button`
  border: 0;
  background: transparent;
  color: var(--platform-colors-accent);
  font: inherit;
  font-size: var(--pure-chrome-ui-size);
  font-weight: 600;
  cursor: pointer;

  &:hover {
    text-decoration: underline;
  }
`

export const CollapsedQuoteBoundary = styled.div`
  display: inline-flex;
  max-width: 100%;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  padding: 6px 9px;
  border-left: 2px solid var(--platform-colors-border);
  border-radius: var(--platform-radius-sm);
  background: color-mix(
    in srgb,
    var(--platform-colors-surface-hover) 72%,
    transparent
  );
  color: var(--platform-colors-text-secondary);
  font-size: var(--pure-chrome-ui-size);
  line-height: 1.3;

  ${TextLinkButton} {
    padding: 0;
  }
`

export const ExpandedQuoteBlock = styled.div`
  margin: 18px 0;
  padding: 0 0 0 14px;
  border-left: 2px solid
    color-mix(in srgb, var(--platform-colors-text) 12%, transparent);
  color: color-mix(in srgb, var(--platform-colors-text) 50%, transparent);
  font-size: 13.5px;
  line-height: 1.8;

  p {
    margin-bottom: 8px;
    color: inherit;
    font-size: inherit;
    line-height: inherit;
  }

  p:last-child {
    margin-bottom: 0;
  }
`

export const ExpandedQuoteHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
  color: var(--platform-colors-text-tertiary);
  font-size: var(--pure-chrome-label-size);
  font-weight: 600;
  line-height: 1.3;
  text-transform: uppercase;

  ${TextLinkButton} {
    padding: 0;
    font-size: inherit;
  }
`

export const FiledLine = styled.div`
  min-width: 0;
  margin-top: 0;
  overflow: hidden;
  color: var(--platform-colors-text-secondary);
  font-size: var(--platform-typography-font-size-sm);
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;

  button {
    margin-left: 5px;
    border: 0;
    background: transparent;
    color: var(--platform-colors-accent);
    font: inherit;
    cursor: pointer;
  }
`

export const QaEditedTag = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  color: var(--platform-colors-accent);
  font-size: var(--platform-typography-font-size-sm);
`

export const PendingSendLabel = styled.span`
  display: inline-flex;
  align-items: center;
  animation: pending-send-soft-pulse 900ms ease-in-out infinite alternate;

  @keyframes pending-send-soft-pulse {
    from {
      opacity: 0.78;
    }
    to {
      opacity: 1;
    }
  }
`

export const AttachmentList = styled.div<{ $dropActive?: boolean }>`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
  padding: ${({ $dropActive }) => ($dropActive ? '8px' : '0')};
  border: ${({ $dropActive }) =>
    $dropActive ? '1px dashed var(--platform-colors-accent)' : '0'};
  border-radius: var(--platform-radius-sm);
  background: ${({ $dropActive }) =>
    $dropActive
      ? 'color-mix(in srgb, var(--platform-colors-accent) 8%, var(--platform-colors-surface))'
      : 'transparent'};
`

export const AttachmentChip = styled.div`
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px;
  max-width: 520px;
  min-width: 0;
  padding: 5px 8px;
  border: 1px solid var(--platform-colors-border-subtle);
  border-radius: var(--platform-radius-sm);
  background: var(--platform-colors-bg);
  color: var(--platform-colors-text);
  font-size: var(--platform-typography-font-size-sm);
`

export const AttachmentName = styled.span`
  min-width: 0;
  overflow: hidden;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
`

export const AttachmentMeta = styled.span`
  color: var(--platform-colors-text-secondary);
  white-space: nowrap;
`

export const AttachmentButton = styled.button`
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--platform-colors-accent);
  font: inherit;
  font-weight: 700;
  cursor: pointer;

  &:hover {
    text-decoration: underline;
  }
`

export const AttachmentSizeNotice = styled.span<{
  $tone?: 'neutral' | 'warning' | 'danger'
}>`
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  color: ${({ $tone }) =>
    $tone === 'danger'
      ? 'var(--platform-colors-danger, var(--puremail-danger-text))'
      : $tone === 'warning'
        ? 'var(--platform-colors-warning, var(--puremail-warning-text))'
        : 'var(--platform-colors-text-secondary)'};
  font-size: var(--platform-typography-font-size-sm);
  font-weight: ${({ $tone }) => ($tone && $tone !== 'neutral' ? 700 : 400)};
`

export const AttachmentPreviewBackdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  padding: 32px;
  background: color-mix(in srgb, var(--platform-colors-bg) 72%, transparent);
`

export const AttachmentPreviewCard = styled.section`
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  max-width: min(920px, 100%);
  max-height: 100%;
  overflow: hidden;
  border: 1px solid var(--platform-colors-border);
  border-radius: var(--platform-radius-md);
  background: var(--platform-colors-surface);
  box-shadow: var(--platform-shadow-lg, 0 18px 48px rgba(0, 0, 0, 0.35));
`

export const AttachmentPreviewHeader = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--platform-colors-border);
`

export const AttachmentPreviewTitle = styled.span`
  min-width: 0;
  overflow: hidden;
  color: var(--platform-colors-text);
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
`

export const AttachmentPreviewBody = styled.div`
  display: grid;
  place-items: center;
  min-height: 120px;
  overflow: auto;
  padding: 16px;
`

export const AttachmentPreviewImage = styled.img`
  max-width: 100%;
  max-height: 70vh;
  object-fit: contain;
  border-radius: var(--platform-radius-sm);
`

export const AttachmentPreviewText = styled.pre`
  justify-self: stretch;
  margin: 0;
  max-height: 70vh;
  overflow: auto;
  padding: 4px;
  color: var(--platform-colors-text);
  font-size: var(--platform-typography-font-size-sm);
  white-space: pre-wrap;
  word-break: break-word;
`

/**
 * The Ask panel is a block under the reader header. It used to be rendered as
 * a third flex item inside ReaderCommandRow, which laid a panel out as though
 * it were a button: floated beside the toolbar, squeezed to the leftover
 * width, placeholder truncated mid-word.
 */
export const AskPanel = styled.section`
  display: grid;
  gap: 12px;
  width: 100%;
  margin: 12px 0 0;
  padding: 14px 16px;
  border: 1px solid var(--platform-colors-border);
  border-radius: var(--platform-radius-md, 8px);
  background: var(--platform-colors-surface);
`

export const AskPanelHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
`

export const AskPanelTitle = styled.div`
  color: var(--platform-colors-text);
  font-size: 13px;
  font-weight: 600;
`

/** Deliberately not ReaderCommandRow: no top border, no space-between. */
export const AskInputRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
`

export const AskInput = styled.input`
  flex: 1 1 auto;
  min-width: 0;
  height: 34px;
  padding: 0 11px;
  border: 1px solid var(--platform-colors-border);
  border-radius: var(--platform-radius-sm);
  background: var(--platform-colors-surface);
  color: var(--platform-colors-text);
  font: inherit;
  font-size: 13px;

  &:focus-visible {
    outline: 2px solid var(--puremail-accent);
    outline-offset: -1px;
  }
`

export const AskSuggestionRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
`

export const AskChip = styled.button`
  padding: 4px 10px;
  border: 1px solid var(--platform-colors-border);
  border-radius: 999px;
  background: transparent;
  color: var(--platform-colors-text-secondary);
  font: inherit;
  font-size: var(--pure-chrome-ui-size);
  cursor: pointer;

  &:hover:not(:disabled) {
    border-color: var(--puremail-accent);
    color: var(--platform-colors-text);
  }

  &:disabled {
    opacity: 0.5;
    cursor: default;
  }
`

export const AskTranscript = styled.div`
  display: grid;
  gap: 10px;
`

export const AskEntryCard = styled.article<{ $failed?: boolean }>`
  display: grid;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid
    ${({ $failed }) =>
      $failed
        ? 'var(--puremail-danger-border)'
        : 'color-mix(in srgb, var(--platform-colors-border) 64%, transparent)'};
  border-radius: var(--platform-radius-sm);
  background: ${({ $failed }) =>
    $failed ? 'var(--puremail-danger-bg)' : 'var(--puremail-pane-bg)'};
`

export const AskEntryQuestion = styled.div`
  color: var(--platform-colors-text-secondary);
  font-size: var(--pure-chrome-ui-size);
  font-weight: 600;
`

export const AskEntryAnswer = styled.div<{ $failed?: boolean }>`
  color: ${({ $failed }) =>
    $failed ? 'var(--puremail-danger-text)' : 'var(--platform-colors-text)'};
  font-size: 13px;
  line-height: 1.55;
  white-space: pre-wrap;
`

export const AskEntryActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
`

export const AskActionItemRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-top: 6px;
  border-top: 1px solid
    color-mix(in srgb, var(--platform-colors-border) 50%, transparent);
`

export const AskStatusLine = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--platform-colors-text-secondary);
  font-size: var(--pure-chrome-ui-size);
`

export const SentReplyRecipient = styled.div`
  display: grid;
  gap: 5px;
  margin-bottom: 12px;
`

export const SentReplyRecipientText = styled.div`
  color: var(--platform-colors-text);
  font-size: var(--platform-typography-font-size-sm);
  line-height: 1.45;
`

export const SentReplyBody = styled.div`
  min-height: clamp(220px, 26vh, 360px);
  padding-top: 6px;
  color: var(--platform-colors-text);
  font-size: var(--platform-typography-font-size-sm);
  line-height: 1.6;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
`

export const DraftAddressToggle = styled.button`
  min-height: 37px;
  border: 1px solid
    color-mix(in srgb, var(--platform-colors-border) 70%, transparent);
  border-radius: var(--platform-radius-sm);
  background: var(--platform-colors-surface);
  color: var(--platform-colors-text-secondary);
  font: inherit;
  font-size: var(--platform-typography-font-size-sm);
  padding: 7px 11px;
  cursor: pointer;

  &:hover {
    color: var(--platform-colors-text);
    border-color: color-mix(
      in srgb,
      var(--platform-colors-accent) 34%,
      var(--platform-colors-border)
    );
  }
`

export const TaskField = styled.label`
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 6px;
`

export const TaskDrawerBackdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: 30;
  display: flex;
  justify-content: flex-end;
  background: color-mix(in srgb, var(--platform-colors-bg) 72%, transparent);
  backdrop-filter: blur(2px);
`

export const TaskDrawer = styled.aside`
  width: min(360px, 92vw);
  height: 100%;
  min-width: 0;
  overflow: auto;
  border-left: 1px solid var(--platform-colors-border);
  background: var(--platform-colors-surface);
  box-shadow: -16px 0 42px color-mix(in srgb, black 14%, transparent);
`

export const SettingsCard = styled.section`
  display: grid;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--platform-colors-border-subtle);
  border-radius: var(--platform-radius-sm);
  background: var(--platform-colors-bg);
`

export const ConnectionSetupPage = styled.section`
  display: grid;
  gap: 14px;
`

export const ConnectionSetupIntro = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--platform-colors-border-subtle);
  border-radius: var(--platform-radius-sm);
  background: var(--platform-colors-bg);
`

export const ConnectionSetupGrid = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(260px, 0.65fr);
  gap: 14px;

  @media (max-width: 860px) {
    grid-template-columns: 1fr;
  }
`

export const ConnectionOptionGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(220px, 1fr));
  gap: 10px;

  @media (max-width: 860px) {
    grid-template-columns: 1fr;
  }
`

export const ConnectionOptionCard = styled.button<{ $selected?: boolean }>`
  display: grid;
  gap: 10px;
  min-height: 132px;
  padding: 14px;
  border: 1px solid
    ${({ $selected }) =>
      $selected
        ? 'var(--platform-colors-accent)'
        : 'var(--platform-colors-border-subtle)'};
  border-radius: var(--platform-radius-sm);
  background: var(--platform-colors-surface);
  color: var(--platform-colors-text);
  text-align: left;
  cursor: pointer;

  &:hover {
    border-color: var(--platform-colors-border);
    background: var(--platform-colors-surface-hover);
  }
`

export const ConnectionOptionHeader = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  gap: 10px;
`

export const ConnectionOptionBadge = styled.span<{
  $status: MailProviderOptionStatus
}>`
  padding: 2px 8px;
  border: 1px solid var(--platform-colors-border);
  border-radius: var(--platform-radius-sm);
  color: ${({ $status }) =>
    $status === 'ready'
      ? 'var(--platform-colors-accent)'
      : 'var(--platform-colors-text-secondary)'};
  background: var(--platform-colors-surface);
  font-size: var(--platform-typography-font-size-xs);
  font-weight: 800;
  letter-spacing: var(--pure-chrome-label-tracking);
  text-transform: uppercase;
`

export const ConnectionPanel = styled.section`
  display: grid;
  align-content: start;
  gap: 13px;
  padding: 16px;
  border: 1px solid var(--platform-colors-border-subtle);
  border-radius: var(--platform-radius-sm);
  background: var(--platform-colors-bg);
`

export const ConnectionDetailHeader = styled.div`
  display: grid;
  gap: 4px;
`

export const ConnectionDetailMeta = styled.span`
  color: var(
    --platform-colors-text-subtle,
    var(--platform-colors-text-muted, var(--platform-colors-text-secondary))
  );
  font-size: 0.74rem;
  font-weight: 700;
  letter-spacing: 0;
  text-transform: uppercase;
`

export const ConnectionPanelTitle = styled.h3`
  margin: 0;
  color: var(--platform-colors-text);
  font-size: 1.03rem;
  line-height: 1.2;
`

export const ConnectionPanelText = styled.p`
  margin: 0;
  color: var(--platform-colors-text-secondary);
  line-height: 1.45;
`

export const ConnectionStepList = styled.ol`
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
`

export const ConnectionStepItem = styled.li`
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: 10px;
`

export const ConnectionStepNumber = styled.span`
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border: 1px solid var(--platform-colors-border);
  border-radius: var(--platform-radius-sm);
  background: var(--platform-colors-surface);
  color: var(--platform-colors-text-secondary);
  font-size: var(--platform-typography-font-size-sm);
  font-weight: 700;
`

/** One protocol's settings (incoming IMAP / outgoing SMTP), visually fenced. */
export const ConnectionFormSection = styled.fieldset`
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 12px;
  min-width: 0;
  border: 1px solid var(--platform-colors-border-subtle);
  border-radius: var(--platform-radius-sm);
`

export const ConnectionFormLegend = styled.legend`
  padding: 0 4px;
  color: var(--platform-colors-text-secondary);
  font-size: var(--platform-typography-font-size-sm);
  font-weight: 700;
  letter-spacing: var(--pure-chrome-label-tracking);
  text-transform: uppercase;
`

export const ConnectionFieldLabel = styled.label`
  display: grid;
  gap: 4px;
  min-width: 0;
  align-content: start;
  color: var(--platform-colors-text-secondary);
  font-size: var(--platform-typography-font-size-sm);

  input,
  select {
    min-width: 0;
    height: 36px;
    border: 1px solid var(--platform-colors-border);
    border-radius: var(--platform-radius-sm);
    padding: 0 10px;
    color: var(--platform-colors-text);
    background: var(--platform-colors-surface);
    font: inherit;
  }

  input:focus,
  select:focus {
    border-color: var(--platform-colors-accent);
    outline: none;
  }
`

export const ConnectionFieldPair = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
  gap: 8px;

  @media (max-width: 720px) {
    grid-template-columns: 1fr;
  }
`

export const ConnectionButtonRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
`

export const ConnectionTestResultBox = styled.div<{ $tone: ConnectionResultTone }>`
  display: grid;
  gap: 6px;
  padding: 12px;
  border: 1px solid
    ${({ $tone }) =>
      $tone === 'success'
        ? 'color-mix(in srgb, var(--platform-colors-success, var(--puremail-success-text)) 42%, var(--platform-colors-border))'
        : $tone === 'warning'
        ? 'color-mix(in srgb, var(--platform-colors-warning, var(--puremail-warning-text)) 44%, var(--platform-colors-border))'
        : 'var(--platform-colors-border)'};
  border-radius: var(--platform-radius-sm);
  background: ${({ $tone }) =>
    $tone === 'success'
      ? 'color-mix(in srgb, var(--platform-colors-success, var(--puremail-success-text)) 9%, var(--platform-colors-bg))'
      : $tone === 'warning'
      ? 'color-mix(in srgb, var(--platform-colors-warning, var(--puremail-warning-text)) 12%, var(--platform-colors-bg))'
      : 'var(--platform-colors-surface)'};
`

export const ConnectionResultTitle = styled.strong`
  color: var(--platform-colors-text);
`

export const ConnectionResultList = styled.ul`
  display: grid;
  gap: 4px;
  margin: 0;
  padding-left: 18px;
  color: var(--platform-colors-text-secondary);
`

export const ConnectionSavedCard = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--platform-colors-border);
  border-radius: var(--platform-radius-sm);
  background: var(--platform-colors-surface);

  @media (max-width: 720px) {
    grid-template-columns: 1fr;
  }
`

export const ComposeScreen = styled.section`
  display: flex;
  flex: 1;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  background: var(--platform-colors-surface);
`

export const SettingsDrawerBackdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  justify-content: flex-end;
  background: color-mix(in srgb, var(--platform-colors-bg) 74%, transparent);
`

export const SettingsDrawer = styled.aside`
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  width: min(920px, 88vw);
  height: 100%;
  min-width: 0;
  border-left: 1px solid var(--platform-colors-border);
  background: var(--platform-colors-surface);
  box-shadow: -18px 0 48px color-mix(in srgb, black 18%, transparent);
`

export const SettingsDrawerHeader = styled.header`
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 20px 14px;
  border-bottom: 1px solid var(--platform-colors-border);
`

export const SettingsDrawerBody = styled.div`
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 18px 20px 22px;
`

export const ComposeHeader = styled.header`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 22px 16px;
  border-bottom: 1px solid var(--platform-colors-border);
`

export const ComposeBody = styled.div`
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  gap: 14px;
  overflow: auto;
  padding: 18px 28px;
`

export const ComposeFooter = styled.footer`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 28px;
  border-top: 1px solid var(--platform-colors-border);
`

export const ComposeField = styled.label<{ $grow?: boolean }>`
  display: flex;
  flex: ${({ $grow }) => ($grow ? '1 1 auto' : '0 0 auto')};
  min-height: ${({ $grow }) => ($grow ? '260px' : 'auto')};
  flex-direction: column;
  gap: 7px;
`

export const ComposeLabel = styled.span`
  color: var(
    --platform-colors-text-subtle,
    var(--platform-colors-text-muted, var(--platform-colors-text-secondary))
  );
  font-size: 0.74rem;
  font-weight: 700;
  letter-spacing: 0;
  text-transform: uppercase;
`

export const ComposeInput = styled.input`
  width: 100%;
  border: 1px solid
    color-mix(in srgb, var(--platform-colors-border) 68%, transparent);
  border-radius: var(--platform-radius-sm);
  background: var(--platform-colors-surface);
  color: var(--platform-colors-text);
  font: inherit;
  padding: 10px 12px;

  &:focus {
    border-color: color-mix(
      in srgb,
      var(--platform-colors-accent) 42%,
      var(--platform-colors-border)
    );
    outline: none;
  }
`

export const ComposeTextArea = styled.textarea`
  flex: 1;
  min-height: 240px;
  resize: none;
  border: 1px solid
    color-mix(in srgb, var(--platform-colors-border) 68%, transparent);
  border-radius: var(--platform-radius-sm);
  background: var(--platform-colors-surface);
  color: var(--platform-colors-text);
  font: inherit;
  line-height: 1.5;
  padding: 12px;

  &:focus {
    border-color: color-mix(
      in srgb,
      var(--platform-colors-accent) 42%,
      var(--platform-colors-border)
    );
    outline: none;
  }
`

export const ComposeAttachmentList = styled.div<{ $dropActive?: boolean }>`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  min-height: 38px;
  padding: 8px;
  border: 1px dashed
    ${({ $dropActive }) =>
      $dropActive
        ? 'var(--platform-colors-accent)'
        : 'var(--platform-colors-border)'};
  border-radius: var(--platform-radius-sm);
  background: ${({ $dropActive }) =>
    $dropActive
      ? 'color-mix(in srgb, var(--platform-colors-accent) 8%, var(--platform-colors-surface))'
      : 'transparent'};
`

export const ComposeAttachmentChip = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 100%;
  border: 1px solid var(--platform-colors-border);
  border-radius: var(--platform-radius-sm);
  background: var(--platform-colors-bg);
  color: var(--platform-colors-text);
  padding: 5px 9px;
`

export const AttachmentDropHint = styled.span`
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  color: var(--platform-colors-text-secondary);
  font-size: var(--platform-typography-font-size-sm);
`

export const ComposeFileInput = styled.input`
  display: none;
`

export const SettingsCardHeader = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  gap: 12px;
`

export const SettingsActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`

export const SettingsOptionGrid = styled.div`
  display: grid;
  gap: 12px;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);

  @media (max-width: 720px) {
    grid-template-columns: 1fr;
  }
`

export const SettingsFullRow = styled.div`
  grid-column: 1 / -1;
`

export const InstructionRiskPanel = styled.div`
  display: grid;
  gap: 8px;
  margin-top: 8px;
  padding: 10px 12px;
  border: 1px solid
    color-mix(
      in srgb,
      var(--platform-colors-warning, var(--puremail-warning-text)) 45%,
      transparent
    );
  border-radius: var(--platform-radius-sm);
  background: color-mix(
    in srgb,
    var(--platform-colors-warning, var(--puremail-warning-text)) 12%,
    var(--platform-colors-surface) 88%
  );
`

export const InstructionRiskList = styled.ul`
  display: grid;
  gap: 6px;
  margin: 0;
  padding-left: 18px;
  color: var(--platform-colors-text-secondary);
  font-size: var(--platform-typography-font-size-sm);
`

export const DrawerActionList = styled.div`
  display: grid;
  gap: 8px;
  padding: 12px 14px;
`

export const DrawerAction = styled.button<{ $danger?: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 3px;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--platform-colors-border);
  border-radius: var(--platform-radius-sm);
  background: var(--platform-colors-surface);
  color: ${({ $danger }) =>
    $danger
      ? 'var(--platform-colors-danger, var(--puremail-danger-text))'
      : 'var(--platform-colors-text)'};
  text-align: left;
  cursor: pointer;

  &:hover {
    background: var(--platform-colors-surface-hover);
  }
`

export const SearchResults = styled.div`
  display: grid;
  gap: 8px;
  margin-top: 12px;
`

/* ── Phase M1: sidebar navigation ──────────────────────────────────── */

export const MailNavList = styled.nav`
  display: grid;
  gap: 1px;
  padding: 4px 6px 6px;
`

/**
 * A menu hanging off the header button, capped so it stays a menu. It used to
 * open as a full-height panel over the thread list — you could not see the
 * mailbox you were leaving, or the one you had just chosen.
 */
export const MailNavDropdownPanel = styled.div`
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 30;
  width: 268px;
  max-width: calc(100vw - 24px);
  /*
   * Grows with the window instead of stopping at a fixed 320px. An account
   * with a few labels and folders overran that, and since macOS hides the
   * scrollbar until you scroll, the list simply looked cut off — the rows
   * past the fold gave no sign they were there. The viewport clamp keeps the
   * panel on screen when the menu sits low.
   */
  max-height: min(68vh, calc(100vh - 96px));
  overflow-y: auto;
  overscroll-behavior: contain;
  border: 1px solid var(--platform-colors-border);
  border-radius: var(--platform-radius-sm);
  background: var(--puremail-pane-bg);
  box-shadow: 0 14px 34px
    color-mix(in srgb, var(--platform-colors-text) 16%, transparent);
`

export const MailNavSectionTitle = styled.div`
  margin: 10px 8px 4px;
  color: var(--platform-colors-text-secondary);
  font-size: var(--pure-chrome-label-size);
  font-weight: 700;
  letter-spacing: var(--pure-chrome-label-tracking);
  text-transform: uppercase;
`

export const MailNavItem = styled.button<{ $active?: boolean }>`
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  min-height: 30px;
  padding: 4px 10px;
  border: 0;
  border-radius: var(--platform-radius-sm);
  background: ${({ $active }) =>
    $active
      ? 'color-mix(in srgb, var(--app-bg, var(--platform-colors-surface-hover)) 26%, transparent)'
      : 'transparent'};
  color: ${({ $active }) =>
    $active
      ? 'var(--platform-colors-text)'
      : 'var(--platform-colors-text-secondary)'};
  font: inherit;
  font-size: 13px;
  font-weight: ${({ $active }) => ($active ? 700 : 500)};
  text-align: left;
  cursor: pointer;

  &:hover {
    background: ${({ $active }) =>
      $active
        ? 'color-mix(in srgb, var(--app-bg, var(--platform-colors-surface-hover)) 32%, transparent)'
        : 'var(--platform-colors-surface-hover)'};
  }

  svg {
    width: 15px;
    height: 15px;
    flex: none;
    opacity: ${({ $active }) => ($active ? 1 : 0.75)};
  }
`

export const MailNavLabel = styled.span`
  flex: 1;
  /*
   * A flex item will not shrink below its own content width without this —
   * min-width defaults to auto, so overflow: hidden never got a chance to
   * bite. A long unbreakable name ("[Superhuman]/AI/Marketing") therefore
   * widened the row past the panel, which clipped the name AND pushed the
   * count out of sight entirely: the row looked cut off and countless at the
   * same time.
   */
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

export const MailNavCount = styled.span`
  flex: none;
  color: var(--platform-colors-text-secondary);
  font-size: var(--pure-chrome-ui-size);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
`

/* New-since-you-looked, in the accent: filtered mail lands where you are
   not looking, and this is what says so. */
export const MailNavUnseen = styled.span.attrs(chrome('meta'))`
  flex: none;
  padding: 0 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--pure-chrome-accent) 14%, transparent);

  && {
    color: var(--pure-chrome-accent);
    font-weight: 600;
  }
`

export const MailNavLabelDot = styled.span<{ $color?: string }>`
  width: 8px;
  height: 8px;
  flex: none;
  border-radius: 50%;
  background: ${({ $color }) =>
    $color || 'var(--platform-colors-text-secondary)'};
`

/* ── Phase M1: thread rail multi-select + stars ────────────────────── */


export const BulkMenuWrap = styled.div`
  position: relative;
`

export const BulkMenu = styled.div`
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 6;
  min-width: 180px;
  max-height: 240px;
  overflow-y: auto;
  padding: 4px;
  border: 1px solid var(--platform-colors-border);
  border-radius: var(--platform-radius-sm);
  /*
   * A fallback chain, not a bare token. The shell injects
   * --platform-colors-* and a bare var() is fine there, but standalone dev
   * has no shell, so the menu painted fully transparent and the page showed
   * through it. --puremail-message-bg bottoms out at #fff.
   */
  background: var(--puremail-message-bg, var(--platform-colors-surface));
  box-shadow: 0 14px 34px
    color-mix(in srgb, var(--platform-colors-text) 16%, transparent);
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.14);
  display: grid;
  gap: 1px;
`

/**
 * Searches the assistant ran, shown as chips under the search row. Clicking
 * one points the rail at that query — the same object the agent read, so
 * "show me what you looked at" costs one click and can never disagree.
 */
export const AgentSearchRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  align-items: center;
  margin-top: var(--space-2);
`

export const AgentSearchChip = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  padding: 2px 8px;
  border: 1px solid var(--platform-colors-border);
  border-radius: 999px;
  background: transparent;
  color: var(--platform-colors-text-secondary);
  font: inherit;
  font-size: var(--pure-chrome-ui-size);
  cursor: pointer;

  > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &:hover {
    border-color: var(--puremail-accent);
    color: var(--platform-colors-text);
  }
`

export const AgentSearchDismiss = styled.button`
  border: 0;
  padding: 0 2px;
  background: transparent;
  color: var(--platform-colors-text-secondary);
  font: inherit;
  font-size: var(--pure-chrome-ui-size);
  cursor: pointer;

  &:hover {
    color: var(--platform-colors-text);
  }
`

/** A failed send, stated where the user pressed Send — not off in a corner. */
export const SendErrorNotice = styled.div`
  flex: 1 0 100%;
  padding: 6px 10px;
  border: 1px solid var(--puremail-danger-border);
  border-radius: var(--platform-radius-sm);
  background: var(--puremail-danger-bg);
  color: var(--puremail-danger-text);
  font-size: var(--pure-chrome-ui-size);
  line-height: 1.45;
  overflow-wrap: anywhere;
`

/** Anchored to the last button in the reader toolbar, so it opens leftwards. */
export const ThreadActionsMenu = styled(BulkMenu)`
  right: 0;
  left: auto;
`

export const BulkMenuItem = styled.button`
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: 0;
  border-radius: var(--platform-radius-sm);
  background: transparent;
  color: var(--platform-colors-text);
  font: inherit;
  font-size: var(--pure-chrome-ui-size);
  text-align: left;
  cursor: pointer;

  &:hover {
    background: var(--platform-colors-surface-hover);
  }

  svg {
    width: 13px;
    height: 13px;
    flex: none;
    opacity: 0.75;
  }
`

/* ── Phase M1: keyboard shortcut reference (settings) ──────────────── */

export const ShortcutList = styled.dl`
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 6px 14px;
  margin: 0;
`

export const ShortcutKey = styled.dt`
  justify-self: start;
  min-width: 26px;
  padding: 2px 7px;
  border: 1px solid var(--platform-colors-border);
  border-radius: var(--platform-radius-sm);
  background: var(--platform-colors-surface);
  color: var(--platform-colors-text);
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-meta-size);
  font-weight: 600;
  text-align: center;
`

export const ShortcutMeaning = styled.dd`
  margin: 0;
  align-self: center;
  color: var(--platform-colors-text-secondary);
  font-size: var(--pure-chrome-ui-size);
`

/* ── Phase M2: compose stack ───────────────────────────────────────── */

export const ChipField = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  min-height: 32px;
  padding: 3px 6px;
  border: 1px solid var(--platform-colors-border);
  border-radius: var(--platform-radius-sm);
  background: var(--platform-colors-surface);

  &:focus-within {
    border-color: var(--pure-chrome-accent);
  }
`

export const RecipientChip = styled.span<{ $invalid?: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  padding: 2px 6px;
  border: 1px solid
    ${({ $invalid }) =>
      $invalid
        ? 'var(--platform-colors-danger, #b3453e)'
        : 'var(--platform-colors-border)'};
  border-radius: 999px;
  background: ${({ $invalid }) =>
    $invalid
      ? 'color-mix(in srgb, var(--platform-colors-danger, #b3453e) 8%, transparent)'
      : 'var(--platform-colors-surface-hover)'};
  color: ${({ $invalid }) =>
    $invalid
      ? 'var(--platform-colors-danger, #b3453e)'
      : 'var(--platform-colors-text)'};
  font-size: var(--pure-chrome-ui-size);
  line-height: 1.4;
  white-space: nowrap;

  span {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  button {
    display: inline-flex;
    align-items: center;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
    opacity: 0.7;
  }

  button:hover {
    opacity: 1;
  }

  svg {
    width: 11px;
    height: 11px;
  }
`

export const ChipTextInput = styled.input`
  flex: 1;
  min-width: 140px;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--platform-colors-text);
  font: inherit;
  font-size: 13px;
`

export const RecipientMenuWrap = styled.div`
  position: relative;
  width: 100%;
`

export const RecipientMenu = styled.div`
  position: absolute;
  top: 2px;
  left: 0;
  z-index: 8;
  min-width: 260px;
  max-height: 220px;
  overflow-y: auto;
  padding: 4px;
  border: 1px solid var(--platform-colors-border);
  border-radius: var(--platform-radius-sm);
  background: var(--platform-colors-surface);
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.14);
  display: grid;
  gap: 1px;
`

export const RecipientMenuItem = styled.button<{ $active?: boolean }>`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  width: 100%;
  padding: 5px 8px;
  border: 0;
  border-radius: var(--platform-radius-sm);
  background: ${({ $active }) =>
    $active ? 'var(--platform-colors-surface-hover)' : 'transparent'};
  color: var(--platform-colors-text);
  font: inherit;
  font-size: var(--pure-chrome-ui-size);
  text-align: left;
  cursor: pointer;

  &:hover {
    background: var(--platform-colors-surface-hover);
  }
`

export const RecipientMenuMeta = styled.span`
  color: var(--platform-colors-text-secondary);
  font-size: var(--pure-chrome-ui-size);
`

export const ComposeToolbar = styled.div.attrs(chrome('toolbar'))`
  border-top: 1px solid var(--pure-chrome-line);
  border-inline: 1px solid var(--pure-chrome-line);
  border-radius: var(--platform-radius-sm) var(--platform-radius-sm) 0 0;
`

/** A format control; \`aria-pressed\` marks it active for the chrome. */
export const ComposeToolbarButton = styled.button.attrs(chrome('toolbar-control'))<{ $active?: boolean }>``

export const ComposeRichBody = styled.div`
  flex: 1;
  min-height: 180px;
  padding: 10px 12px;
  border: 1px solid var(--pure-chrome-line);
  border-top: 0;
  border-radius: 0 0 var(--platform-radius-sm) var(--platform-radius-sm);
  background: var(--pure-chrome-surface);
  color: var(--platform-colors-text);
  font-family: var(--platform-typography-font-family-content);
  font-size: var(--pure-chrome-reading-size);
  line-height: var(--pure-chrome-reading-line);
  overflow-y: auto;
  outline: none;

  min-width: 0;
  overflow-x: hidden;
  img, video, audio { max-width: 100%; vertical-align: middle; }
  img { height: auto; }
  video { display: block; max-height: 320px; }
  audio { display: block; width: 100%; }

  &:focus {
    border-color: var(--pure-chrome-accent);
  }

  p {
    margin: 0 0 0.6em;
  }

  ul,
  ol {
    margin: 0 0 0.6em;
    padding-left: 1.4em;
  }

  a {
    color: var(--pure-chrome-accent);
  }
`

export const ComposeInlineRow = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border: 1px solid var(--platform-colors-border);
  border-radius: var(--platform-radius-sm);
  background: var(--platform-colors-surface);
`

export const ComposeInlineNotice = styled.div<{ $tone?: 'warning' }>`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border: 1px solid
    ${({ $tone }) =>
      $tone === 'warning'
        ? 'color-mix(in srgb, var(--platform-colors-warning, #b58a00) 55%, transparent)'
        : 'var(--platform-colors-border)'};
  border-radius: var(--platform-radius-sm);
  background: ${({ $tone }) =>
    $tone === 'warning'
      ? 'color-mix(in srgb, var(--platform-colors-warning, #b58a00) 7%, transparent)'
      : 'var(--platform-colors-surface)'};
  color: var(--platform-colors-text);
  font-size: var(--pure-chrome-ui-size);
`

export const SignatureListRow = styled.div`
  display: grid;
  gap: 6px;
  padding: 8px 0;
  border-bottom: 1px solid
    color-mix(in srgb, var(--platform-colors-border) 68%, transparent);
`


/* ── Gmail/Proton-style layout redesign ─────────────────────────────────
 *
 * The list and the reader are mutually exclusive full-width surfaces beside
 * a 232px nav rail, under one 50px top bar that spans everything. The
 * components below are the chrome of that model; values come from the
 * design mockups (Main/Reading/ListView.dc.html). Square corners
 * throughout — the mocks have none.
 */

/** 50px bar over rail + content: mark, search, account-wide actions. */
export const MailTopBar = styled.header`
  display: flex;
  height: 50px;
  flex: none;
  align-items: center;
  gap: 14px;
  border-bottom: 1px solid var(--puremail-line);
  background: var(--puremail-pane-header-bg);
  padding: 0 16px;
  white-space: nowrap;

  > * {
    flex: none;
  }
`

/** Anchors the results panel under the permanent search field. */
export const TopSearchWrap = styled.div`
  position: relative;
  flex: 1 1 auto;
  min-width: 120px;
  max-width: 560px;
`

export const TopSearchField = styled.div.attrs(chrome('field'))`
  > svg {
    width: var(--pure-chrome-icon);
    height: var(--pure-chrome-icon);
    flex: none;
    color: var(--pure-chrome-muted);
  }
`

export const TopSearchInput = styled.input`
  flex: 1 1 auto;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--platform-colors-text);
  font: inherit;
  font-size: var(--pure-chrome-ui-size);

  &::placeholder {
    color: var(--pure-chrome-muted);
  }
`

/** The ⌘K hint (and the composer's ⌘⏎): a keyboard fact, in mono. */
/** The ⌘K hint (and the composer's ⌘⏎): a keyboard fact, in mono. */
export const KbdChip = styled.span.attrs(chrome('meta'))`
  flex: none;
  border: 1px solid var(--pure-chrome-line);
  padding: 1px 5px;
`

/**
 * The search results, dropped under the field. Local hits first, then the
 * server-side rows — same content the old sidebar drawer carried.
 */
export const TopSearchPanel = styled.div`
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 40;
  display: grid;
  gap: 8px;
  max-height: min(70vh, calc(100vh - 120px));
  overflow-y: auto;
  overscroll-behavior: contain;
  border: 1px solid var(--platform-colors-border);
  background: var(--puremail-pane-bg);
  box-shadow: 0 14px 34px
    color-mix(in srgb, var(--platform-colors-text) 16%, transparent);
  padding: 10px 12px 12px;
`

export const TopBarIconButton = styled.button.attrs(chrome('toolbar-control'))<{ $fetching?: boolean }>`
  color: var(--platform-colors-text-secondary);

  &:hover {
    color: var(--platform-colors-text);
  }

  svg {
    animation: ${({ $fetching }) =>
      $fetching ? 'puremail-fetch-spin 900ms linear infinite' : 'none'};
  }

  /* The spin keyframes used to ride along inside MailFetchButton; this bar
     replaced that button, so the animation it names must live here too. */
  @keyframes puremail-fetch-spin {
    to {
      transform: rotate(360deg);
    }
  }
  ${fastTipCss}
`

export const TopBarSpacer = styled.span`
  flex: 1 1 auto;
  min-width: 0;
`

export const TopAccountChip = styled.button.attrs(chrome('toolbar-select'))`
  color: var(--platform-colors-text-secondary);
  cursor: pointer;
  padding: 0 9px 0 4px;

  &:hover {
    background: var(--pure-chrome-hover);
  }

  svg {
    width: 10px;
    height: 10px;
    color: var(--pure-chrome-muted);
  }
`

export const TopAccountAvatar = styled.span`
  display: inline-flex;
  width: 22px;
  height: 22px;
  align-items: center;
  justify-content: center;
  background: var(--puremail-accent-bg);
  color: var(--puremail-accent-text);
  font-size: 10px;
  font-weight: 600;
`

/** Everything under the top bar: rail beside content. */
export const MailBodyRow = styled.div`
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  /* The docked compose window anchors here: its bottom: 0 is exactly the
     top of the status bar, whatever height that bar happens to have. */
  position: relative;
`

/**
 * The office-family status line: one full-width mono band at the very
 * bottom of the window, matching sheets' status bar and calendar's new one.
 */
/**
 * The office-family status line: one full-width mono band at the very
 * bottom of the window, matching sheets' status bar and calendar's new one.
 */
export const MailStatusBar = styled.div.attrs(chrome('meta'))`
  flex: none;
  display: flex;
  align-items: center;
  padding: 6px var(--pure-chrome-inset);
  border-top: 1px solid var(--pure-chrome-line);
  background: var(--pure-chrome-bar);
`

/** The 232px navigation rail. */
/** The navigation rail: the platform sidebar (264, rows of 32, 16 inset). */
export const NavRail = styled.nav.attrs(chrome('sidebar'))`
  gap: 2px;
  padding: 10px 0;
`

/** THE one accent-filled button. */
/** THE one accent-filled button. */
export const NavComposeButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  flex: none;
  height: var(--pure-chrome-field-height);
  margin: 0 8px 8px;
  border: 0;
  border-radius: var(--pure-chrome-radius);
  background: var(--pure-chrome-accent);
  color: var(--pure-chrome-on-accent);
  cursor: pointer;
  font: inherit;
  font-size: var(--pure-chrome-ui-size);
  font-weight: 500;
  padding: 0 14px;

  &:hover {
    filter: brightness(0.94);
  }

  svg {
    width: var(--pure-chrome-icon);
    height: var(--pure-chrome-icon);
  }
`

/** One sidebar row; \`aria-current\` marks the active one for the chrome. */
export const NavRailItem = styled.button.attrs(chrome('row'))<{ $active?: boolean }>`
  flex: none;
`

export const NavRailCount = styled.span.attrs(chrome('meta'))<{ $accent?: boolean }>`
  margin-left: auto;
  flex: none;
  font-variant-numeric: tabular-nums;
  ${({ $accent }) =>
    $accent &&
    css`
      && {
        color: var(--pure-chrome-accent);
        font-weight: 600;
      }
    `}
`

export const NavRailSectionTitle = styled.div.attrs(chrome('section-label'))`
  flex: none;
`

export const NavRailLabelDot = styled.span<{ $color?: string }>`
  width: 9px;
  height: 9px;
  flex: none;
  background: ${({ $color }) =>
    $color || 'var(--platform-colors-text-secondary)'};
`

/** Bottom-docked sync status line. */
/** The full-width surface beside the rail: list OR reader, never both. */
export const ContentColumn = styled.main`
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  background: var(--puremail-message-bg);
`

/** 44px list header: selection, refresh, view name — or the bulk toolbar. */
/** The list's control row: selection, refresh, view name — or the bulk toolbar. */
export const ListHeaderBar = styled.div.attrs(chrome('toolbar'))`
  gap: 6px;
  padding: 0 var(--pure-chrome-inset);
  white-space: nowrap;
  /* Menus anchor inside this row. */
  overflow: visible;

  > * {
    flex: none;
  }
`

export const ListHeaderName = styled.span`
  margin-left: 6px;
  color: var(--platform-colors-text-secondary);
  font-size: var(--pure-chrome-ui-size);
`

export const ListHeaderCount = styled.span.attrs(chrome('meta'))`
  font-variant-numeric: tabular-nums;
`

export const ListHeaderRange = styled.span.attrs(chrome('meta'))`
  margin-left: auto;
  font-variant-numeric: tabular-nums;
`

export const ListHeaderSelectedCount = styled.span`
  margin: 0 6px;
  color: var(--platform-colors-text);
  font-size: var(--pure-chrome-ui-size);
  font-weight: 500;
`

/** The 13px square checkbox from the mocks — rows and the select-all. */
export const SquareCheck = styled.button<{ $checked?: boolean }>`
  display: inline-flex;
  width: 13px;
  height: 13px;
  flex: none;
  align-items: center;
  justify-content: center;
  border: 1px solid
    ${({ $checked }) =>
      $checked
        ? 'var(--puremail-accent)'
        : 'color-mix(in srgb, var(--platform-colors-text) 24%, transparent)'};
  background: ${({ $checked }) =>
    $checked ? 'var(--puremail-accent)' : 'var(--puremail-message-bg)'};
  color: var(--pure-chrome-on-accent);
  cursor: pointer;
  padding: 0;

  svg {
    width: 9px;
    height: 9px;
  }
`

export const ListIconButton = styled.button.attrs(chrome('toolbar-control'))<{ $fetching?: boolean }>`
  color: var(--platform-colors-text-secondary);

  &:hover {
    color: var(--platform-colors-text);
  }

  svg {
    animation: ${({ $fetching }) =>
      $fetching ? 'puremail-fetch-spin 900ms linear infinite' : 'none'};
  }
  ${fastTipCss}
`

/**
 * One thread, one line: checkbox, star, sender, chip, subject — snippet,
 * time. Hover swaps the time for the four triage icons without reflow (they
 * are absolutely positioned over it).
 */
/**
 * One thread, one line: checkbox, star, sender, chip, subject — snippet,
 * time. Hover swaps the time for the four triage icons without reflow (they
 * are absolutely positioned over it). The platform list row supplies the
 * inset, hairline, faces and hover; the density map supplies the height
 * the virtualised rail windows on.
 */
export const MailListRow = styled.div.attrs(chrome('list-row'))<{
  $density?: MailDensity
  $unread?: boolean
  $active?: boolean
  $checked?: boolean
}>`
  position: relative;
  width: 100%;
  height: ${({ $density }) =>
    THREAD_ROW_HEIGHTS[
      $density === 'comfortable' ? 'comfortable' : 'compact'
    ]}px;
  box-sizing: border-box;
  cursor: pointer;
  font: inherit;
  text-align: left;

  && {
    background: ${({ $checked, $active }) =>
      $checked
        ? 'color-mix(in srgb, var(--pure-chrome-accent) 10%, transparent)'
        : $active
          ? 'var(--pure-chrome-selection)'
          : 'transparent'};
    box-shadow: ${({ $active }) =>
      $active ? 'inset 0 0 0 1px var(--pure-chrome-line)' : 'none'};
  }

  &&:hover {
    background: ${({ $checked }) =>
      $checked
        ? 'color-mix(in srgb, var(--pure-chrome-accent) 14%, transparent)'
        : 'var(--pure-chrome-hover)'};
  }
`

export const RowStar = styled.span<{ $starred?: boolean }>`
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  color: ${({ $starred }) =>
    $starred
      ? 'var(--platform-colors-semantic-orange, #b58a00)'
      : 'color-mix(in srgb, var(--platform-colors-text) 24%, transparent)'};
  cursor: pointer;

  &:hover {
    color: ${({ $starred }) =>
      $starred
        ? 'var(--platform-colors-semantic-orange, #b58a00)'
        : 'var(--platform-colors-text-secondary)'};
  }

  svg {
    width: 14px;
    height: 14px;
    fill: ${({ $starred }) => ($starred ? 'currentColor' : 'none')};
  }
`

export const RowSender = styled.span<{ $unread?: boolean }>`
  width: 190px;
  flex: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: ${({ $unread }) =>
    $unread
      ? 'var(--platform-colors-text)'
      : 'var(--platform-colors-text-secondary)'};
  font-size: var(--pure-chrome-ui-size);
  font-weight: ${({ $unread }) => ($unread ? 600 : 400)};
`

export const RowChip = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: none;
  max-width: 130px;
  overflow: hidden;
  border: 1px solid var(--pure-chrome-line);
  border-radius: 999px;
  color: var(--platform-colors-text-secondary);
  font-size: var(--pure-chrome-meta-size);
  padding: 1px 7px;
  white-space: nowrap;
`

export const RowChipDot = styled.span<{ $color?: string }>`
  width: 7px;
  height: 7px;
  flex: none;
  background: ${({ $color }) =>
    $color || 'var(--platform-colors-text-secondary)'};
`

export const RowSubject = styled.span<{ $unread?: boolean }>`
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--platform-colors-text-secondary);
  font-size: var(--pure-chrome-ui-size);

  strong {
    color: var(--platform-colors-text);
    font-weight: ${({ $unread }) => ($unread ? 600 : 500)};
  }
`

export const RowTime = styled.span.attrs(chrome('meta'))`
  /* Sized to its text, never narrower than the column. A fixed 64px box
     let "Sep 3, 6:07 PM" run past the pane edge and lose its last letters;
     the subject beside it is the column that gives. */
  min-width: 64px;
  flex: none;
  font-variant-numeric: tabular-nums;
  text-align: right;
`

/**
 * The four triage icons, shown on hover OVER the time — absolutely
 * positioned so nothing reflows under the cursor.
 */
export const RowHoverActions = styled.span`
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  display: none;
  align-items: center;
  gap: 2px;
  padding-left: 14px;
  background: linear-gradient(
    to right,
    transparent,
    var(--pure-chrome-hover) 14px
  );

  ${MailListRow}:hover & {
    display: flex;
  }
`

export const RowActionButton = styled.span`
  display: inline-flex;
  width: 24px;
  height: 24px;
  align-items: center;
  justify-content: center;
  color: var(--platform-colors-text-secondary);
  cursor: pointer;

  &:hover {
    color: var(--platform-colors-text);
    background: color-mix(in srgb, currentColor 10%, transparent);
  }

  svg {
    width: 13px;
    height: 13px;
  }
  ${fastTipCss}
`

/** Vertical divider inside toolbars (back | actions). */
/** Vertical divider inside toolbars (back | actions). */
export const ToolbarDivider = styled.span.attrs(chrome('toolbar-divider'))``

/** 26×26 accent paper-plane send, per the reading mock. */
export const ComposerSendButton = styled.button`
  display: inline-flex;
  width: 26px;
  height: 26px;
  flex: none;
  align-items: center;
  justify-content: center;
  border: 0;
  background: var(--puremail-accent);
  color: var(--pure-chrome-on-accent);
  cursor: pointer;
  padding: 0;

  &:hover {
    filter: brightness(0.92);
  }

  &:disabled {
    opacity: 0.5;
    cursor: default;
  }

  svg {
    width: 14px;
    height: 14px;
  }
`

/* ── Docked compose window ──────────────────────────────────────────────
 *
 * Compose as a 540×560 small window docked bottom-right over the mail
 * surface (Main/Window.dc.html). Anchored inside MailBodyRow so bottom: 0
 * sits exactly on the status bar; the inbox/reader behind it stays fully
 * interactive. Square corners; the title strip and the minimized strip use
 * the platform bar — the accent is spent on Send.
 */

export const ComposeDockWindow = styled.section<{
  $dropActive?: boolean
  /** The run card: the same window chrome laid inline, filling its column. */
  $inline?: boolean
}>`
  position: ${({ $inline }) => ($inline ? 'relative' : 'absolute')};
  right: ${({ $inline }) => ($inline ? 'auto' : '12px')};
  bottom: ${({ $inline }) => ($inline ? 'auto' : '0')};
  z-index: ${({ $inline }) => ($inline ? 'auto' : '30')};
  display: flex;
  flex-direction: column;
  width: ${({ $inline }) => ($inline ? '100%' : 'min(540px, calc(100% - 24px))')};
  height: ${({ $inline }) => ($inline ? '100%' : 'min(560px, calc(100% - 12px))')};
  min-height: 0;
  border: 1px solid
    ${({ $dropActive }) =>
      $dropActive
        ? 'var(--pure-chrome-accent)'
        : 'var(--platform-colors-border)'};
  background: var(--puremail-message-bg);
  box-shadow: ${({ $inline }) =>
    $inline ? 'none' : '0 8px 32px rgb(27 27 30 / 0.28)'};
`

/** "Mere Example · paper supplier" beside the run card's title. */
/** "Mere Example · paper supplier" beside the run card's title. */
export const ComposeDockTitleMeta = styled.span.attrs(chrome('meta'))`
  flex: none;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
`

export const ComposeDockTitleSpacer = styled.span`
  flex: 1 1 auto;
  min-width: 0;
`

/** "⌘← previous · ⌘→ skip" at the right of the run card's title. */
/** "⌘← previous · ⌘→ skip" at the right of the run card's title. */
export const ComposeDockTitleHint = styled.span.attrs(chrome('meta'))`
  flex: none;
  padding-right: 8px;
`

/** The `{{email}} · from list` chip standing in for the template's To. */
export const ComposeTemplateToChip = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid var(--puremail-accent);
  background: var(--puremail-accent-bg);
  color: var(--puremail-accent-text);
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-meta-size);
  padding: 2px 7px;

  span {
    color: var(--platform-colors-text-tertiary);
    font-family: var(--platform-typography-font-family);
    font-size: var(--pure-chrome-meta-size);
  }
`

/** Right-aligned mono meta in a To row ("from list · row 3"). */
export const ComposeDockRowMeta = styled.span`
  flex: none;
  margin-left: auto;
  color: var(--platform-colors-text-tertiary);
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-meta-size);
`

/** A text button in the dock toolbar ("Insert field ▾", "Insert note slot"). */
export const ComposeDockToolbarTextButton = styled.button.attrs(chrome('toolbar-select'))`
  gap: 5px;
  flex: none;
  cursor: pointer;

  &:hover {
    background: var(--pure-chrome-hover);
  }

  svg {
    width: 12px;
    height: 12px;
  }
`

/** Secondary footer button in the run card ("Skip ⌘→", "Preview as Sarah"). */
export const ComposeDockSecondaryButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 7px;
  flex: none;
  border: 1px solid var(--platform-colors-border);
  background: var(--puremail-message-bg);
  color: var(--platform-colors-text);
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  padding: 6px 12px;

  &:hover {
    background: var(--platform-colors-surface-hover);
  }

  &:disabled {
    opacity: 0.55;
    cursor: default;
  }
`

/** Mono side-note in a footer or attachment row. */
export const ComposeDockFooterNote = styled.span`
  flex: none;
  color: var(--platform-colors-text-tertiary);
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-meta-size);
`

export const ComposeDockTitleBar = styled.header.attrs(chrome('toolbar'))`
  gap: 8px;
`

export const ComposeDockTitle = styled.span`
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: var(--pure-chrome-ui-size);
  font-weight: 600;
`

export const ComposeDockWinButton = styled.button.attrs(chrome('toolbar-control'))`
  color: var(--platform-colors-text-secondary);

  &:hover {
    color: var(--platform-colors-text);
  }

  svg {
    width: 12px;
    height: 12px;
  }

  ${fastTipCss}
`

/** A 34px To/Subject row: borderless fields over a hairline divider. */
export const ComposeDockRow = styled.div`
  display: flex;
  min-height: 34px;
  flex: none;
  align-items: center;
  gap: 8px;
  padding: 0 14px;
  border-bottom: 1px solid
    color-mix(in srgb, var(--platform-colors-border) 62%, transparent);
  font-size: 13px;
`

export const ComposeDockRowLabel = styled.span`
  flex: none;
  color: var(--platform-colors-text-tertiary);
`

/**
 * Hosts RecipientChipsInput inline in the 34px To row: the shared ChipField
 * chrome (border, background, min-height) is stripped so the chips sit on
 * the row itself.
 */
export const ComposeDockRecipients = styled.div`
  flex: 1;
  min-width: 0;

  ${ChipField} {
    min-height: 28px;
    padding: 2px 0;
    border: 0;
    background: transparent;

    &:focus-within {
      border: 0;
    }
  }
`

export const ComposeDockCcBccToggle = styled.button`
  flex: none;
  border: 0;
  background: transparent;
  color: var(--platform-colors-text-tertiary);
  cursor: pointer;
  font: inherit;
  font-size: var(--pure-chrome-ui-size);
  padding: 2px 0;

  &:hover {
    color: var(--platform-colors-text);
  }
`

export const ComposeDockSubjectInput = styled.input`
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--platform-colors-text);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  padding: 0;

  &::placeholder {
    color: var(--platform-colors-text-tertiary);
    font-weight: 400;
  }
`

/** The serif body, filling the window — no inner border of its own. */
export const ComposeDockEditor = styled(ComposeRichBody)`
  flex: 1;
  min-height: 0;
  padding: 12px 14px;
  border: 0;
  border-radius: 0;

  &:focus {
    border: 0;
  }

  /* The send-run personal-note slot: a marked region inside the body. In
     a rendered draft it is where the per-recipient line goes; in the
     template it holds the {{note}} token. Empty at send time, it is
     stripped entirely (lib/mailRuns finalizeRunBodyHtml). */
  [data-run-note] {
    margin: 0 0 0.6em;
    padding: 8px 10px;
    border: 1px dashed var(--puremail-accent);
    background: var(--puremail-accent-bg);
  }

  [data-run-note]::before {
    content: 'Personal note';
    display: block;
    margin-bottom: 4px;
    color: var(--puremail-accent-text);
    font-family: var(--platform-typography-font-family-mono);
    font-size: var(--pure-chrome-label-size);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  [data-run-note] > :last-child {
    margin-bottom: 0;
  }

  &[data-run-mode='template'] [data-run-note]::before {
    content: 'Personal note slot · filled per draft during the run · dropped if left empty';
    letter-spacing: 0;
    text-transform: none;
  }
`

export const ComposeDockAttachmentRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  flex: none;
  align-items: center;
  gap: 6px;
  padding: 6px 14px 0;
`

export const ComposeDockAttachmentChip = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 240px;
  border: 1px solid var(--platform-colors-border);
  background: var(--puremail-pane-bg, var(--platform-colors-surface));
  color: var(--platform-colors-text);
  font-size: var(--pure-chrome-ui-size);
  padding: 3px 8px;

  > svg {
    width: 11px;
    height: 11px;
    flex: none;
  }
`

export const ComposeDockAttachmentName = styled.span`
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
`

export const ComposeDockAttachmentMeta = styled.span`
  flex: none;
  color: var(--platform-colors-text-tertiary);
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-meta-size);
`

export const ComposeDockAttachmentRemove = styled.button`
  display: inline-flex;
  flex: none;
  align-items: center;
  border: 0;
  background: transparent;
  color: var(--platform-colors-text-tertiary);
  cursor: pointer;
  padding: 0;

  &:hover {
    color: var(--platform-colors-text);
  }

  svg {
    width: 10px;
    height: 10px;
  }
`

/** Inline notices (invalid recipient, reminders) inside the small window. */
export const ComposeDockNotices = styled.div`
  display: grid;
  flex: none;
  gap: 6px;
  padding: 6px 14px 0;
`

/** The slim B/I/U · lists · link row above the footer. */
export const ComposeDockToolbar = styled.div.attrs(chrome('toolbar'))``

export const ComposeDockToolbarDivider = styled.span.attrs(chrome('toolbar-divider'))``

export const ComposeDockToolbarButton = styled(ComposeToolbarButton)`
  ${fastTipCss}

  /* Near the bottom of the window: tips open upward, off the status bar. */
  &[aria-label]::after {
    top: auto;
    bottom: calc(100% + 6px);
  }
`

export const ComposeDockFooter = styled.footer`
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
  padding: 8px 12px 10px;
`

export const ComposeDockSendGroup = styled.span`
  display: inline-flex;
  flex: none;
  align-items: stretch;
`

export const ComposeDockSendButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 7px;
  border: 0;
  background: var(--pure-chrome-accent);
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

export const ComposeDockSendLater = styled.button`
  display: inline-flex;
  width: 26px;
  align-items: center;
  justify-content: center;
  border: 0;
  border-left: 1px solid color-mix(in srgb, var(--pure-chrome-on-accent) 28%, transparent);
  background: var(--pure-chrome-accent);
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
    width: 11px;
    height: 11px;
  }

  ${fastTipCss}

  &[aria-label]::after {
    top: auto;
    bottom: calc(100% + 6px);
  }
`

/** The schedule/signature menus open upward from the footer. */
export const ComposeDockMenu = styled(BulkMenu)`
  top: auto;
  bottom: calc(100% + 4px);
`

export const ComposeDockIconButton = styled.button<{ $armed?: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-width: 24px;
  height: 24px;
  flex: none;
  border: 0;
  background: ${({ $armed }) =>
    $armed
      ? 'color-mix(in srgb, var(--puremail-danger-text) 12%, transparent)'
      : 'transparent'};
  color: ${({ $armed }) =>
    $armed
      ? 'var(--puremail-danger-text)'
      : 'var(--platform-colors-text-secondary)'};
  cursor: pointer;
  font: inherit;
  font-size: var(--pure-chrome-ui-size);
  font-weight: ${({ $armed }) => ($armed ? 600 : 400)};
  padding: 0 ${({ $armed }) => ($armed ? '7px' : '0')};

  &:hover {
    background: ${({ $armed }) =>
      $armed
        ? 'color-mix(in srgb, var(--puremail-danger-text) 16%, transparent)'
        : 'var(--platform-colors-surface-hover)'};
    color: ${({ $armed }) =>
      $armed ? 'var(--puremail-danger-text)' : 'var(--platform-colors-text)'};
  }

  svg {
    width: 14px;
    height: 14px;
  }

  ${fastTipCss}

  &[aria-label]::after {
    top: auto;
    bottom: calc(100% + 6px);
  }
`

export const ComposeDockFooterSpacer = styled.span`
  flex: 1 1 auto;
  min-width: 0;
`

/** The 240×36 minimized strip, docked in the same corner. */
export const ComposeMinimizedStrip = styled.section.attrs(chrome('toolbar'))`
  position: absolute;
  right: 12px;
  bottom: 0;
  z-index: 30;
  width: 240px;
  gap: 8px;
  border: 1px solid var(--pure-chrome-line);
  box-shadow: 0 4px 18px rgb(27 27 30 / 0.22);
`

export const ComposeMinimizedTitle = styled.button`
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  font-size: var(--pure-chrome-ui-size);
  font-weight: 500;
  padding: 0;
  text-align: left;
`

export const ComposeMinimizedButton = styled(ComposeDockWinButton)`
  width: 20px;
  height: 20px;

  svg {
    width: 11px;
    height: 11px;
  }

  /* The strip sits on the status bar: tips open upward. */
  &[aria-label]::after {
    top: auto;
    bottom: calc(100% + 6px);
  }
`

/* ── Reply context in the compose window (Reply.dc.html) ────────────────
 *
 * A 28px strip under the title bar states what the window is answering —
 * "Replying to Sarah Example · 8:56 today" — with text-link switches to the
 * other reply types on the right. Switching RE-DERIVES recipients and the
 * subject prefix; the strip is the only chrome a reply adds to compose.
 */

export const ComposeContextStrip = styled.div`
  display: flex;
  min-height: 28px;
  flex: none;
  align-items: center;
  gap: 10px;
  padding: 0 14px;
  background: var(--puremail-pane-bg, var(--platform-colors-surface));
  border-bottom: 1px solid
    color-mix(in srgb, var(--platform-colors-border) 62%, transparent);
  font-size: var(--pure-chrome-ui-size);
  color: var(--platform-colors-text-secondary);

  > svg {
    width: 11px;
    height: 11px;
    flex: none;
    color: var(--pure-chrome-accent);
  }
`

export const ComposeContextText = styled.span`
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;

  strong {
    color: var(--platform-colors-text);
    font-weight: 600;
  }
`

export const ComposeContextSpacer = styled.span`
  flex: 1 1 auto;
  min-width: 0;
`

export const ComposeContextLink = styled.button`
  flex: none;
  border: 0;
  background: transparent;
  color: var(--pure-chrome-accent);
  cursor: pointer;
  font: inherit;
  font-size: var(--pure-chrome-ui-size);
  padding: 2px 0;

  &:hover {
    color: var(--platform-colors-text);
  }
`

/**
 * The collapsed quoted-history chip at the end of the body. Expanding
 * injects the (sanitized) quote into the editor for trimming; collapsed,
 * the quote is still included on send — the chip hides words, it never
 * drops them.
 */
export const ComposeQuoteChipRow = styled.div`
  display: flex;
  flex: none;
  padding: 0 14px 6px;
`

export const ComposeQuoteChip = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--platform-colors-border);
  background: var(--puremail-pane-bg, var(--platform-colors-surface));
  color: var(--platform-colors-text-secondary);
  cursor: pointer;
  font: inherit;
  font-size: var(--pure-chrome-ui-size);
  padding: 3px 9px;

  &:hover {
    color: var(--platform-colors-text);
    border-color: var(--platform-colors-text-tertiary);
  }

  svg {
    width: 11px;
    height: 11px;
    flex: none;
  }
`

/* ── The reader-foot reply launcher ─────────────────────────────────────
 *
 * The inline reply composer became the docked window; what remains at the
 * reader's foot is a LAUNCHER strip: the drafted-reply preview (agent or
 * saved draft) or a "Reply to …" placeholder. Clicking it opens the docked
 * compose window seeded with that draft. One composer surface.
 */

export const ReplyLaunchStrip = styled.button`
  display: flex;
  width: 100%;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--platform-colors-border);
  background: var(--puremail-pane-bg, var(--platform-colors-surface));
  color: var(--platform-colors-text-secondary);
  cursor: pointer;
  font: inherit;
  font-size: var(--pure-chrome-ui-size);
  text-align: left;
  padding: 10px 14px;
  margin-top: 14px;

  &:hover {
    border-color: var(--platform-colors-text-tertiary);
    color: var(--platform-colors-text);
  }

  > svg {
    width: 14px;
    height: 14px;
    flex: none;
    color: var(--pure-chrome-accent);
  }
`

export const ReplyLaunchKicker = styled.span`
  flex: none;
  color: var(--pure-chrome-accent);
  font-size: var(--pure-chrome-label-size);
  font-weight: 600;
  letter-spacing: var(--pure-chrome-label-tracking);
  text-transform: uppercase;
`

export const ReplyLaunchPreview = styled.span`
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
`

export const ReplyLaunchOpen = styled.span`
  flex: none;
  color: var(--platform-colors-text-tertiary);
  font-size: var(--pure-chrome-ui-size);
`

/**
 * "120 of 2,236" under a long thread list.
 *
 * The rail scrolls one continuous list, so there are no pages to number —
 * but a scrollbar alone does not say how far in you are or how much is
 * left. This sits at the foot of the list, out of the way, and doubles as
 * the way to jump somewhere.
 */
export const ListPositionBar = styled.div`
  position: sticky;
  bottom: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-top: 1px solid var(--puremail-line);
  background: color-mix(in srgb, var(--puremail-pane-header-bg) 92%, transparent);
  backdrop-filter: blur(6px);
`

export const ListPositionLabel = styled.span`
  color: var(--platform-colors-text-tertiary);
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-meta-size);
  font-variant-numeric: tabular-nums;
`

export const ListPositionButton = styled.button`
  border: 0;
  padding: 2px 6px;
  background: transparent;
  color: var(--platform-colors-text-secondary);
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-meta-size);
  font-variant-numeric: tabular-nums;
  cursor: pointer;

  &:hover:not(:disabled) {
    color: var(--platform-colors-text);
    background: color-mix(in srgb, currentColor 8%, transparent);
  }
  &:disabled {
    opacity: 0.45;
    cursor: default;
  }
`

export const ListPositionInput = styled.input`
  width: 68px;
  padding: 1px 5px;
  border: 1px solid var(--puremail-line);
  background: var(--puremail-message-bg);
  color: inherit;
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-meta-size);
  font-variant-numeric: tabular-nums;
`
