import { styled } from 'styled-components'

/**
 * A sheet on quiet ground, a reading serif, and two inks. Blue is for the
 * reply; pencil is the reader's own. Define the palette on the room itself:
 * its expanded portal lives outside MailFrame and cannot inherit its tokens.
 */
export const READING_SERIF = `'Newsreader', 'Iowan Old Style', 'Charter', 'Source Serif 4', Georgia, serif`
export const INK = '#2c4f9e'
export const INK_TINT = '#e4eaf6'
export const INK_ACTIVE = '#cfdbf2'
export const PENCIL = '#5d636b'
export const PENCIL_TINT = '#efeee9'

export const Room = styled.section`
  --mail-room-ground: #e5e7e3;
  --mail-room-paper: #ffffff;
  --mail-room-text: #23272f;
  --mail-room-heading: #15181e;
  --mail-room-muted: #6e7480;
  --mail-room-line: #c9ccd2;
  --mail-room-panel: #f6f7f8;
  --mail-room-ink: ${INK};
  --mail-room-selection: #c9d8f4;
  --mail-room-highlight: #f6edc9;
  :root[data-platform-theme='dark'] & {
    color-scheme: dark;
    --mail-room-ground: var(--platform-colors-text-inverse, #142420);
    --mail-room-paper: var(--platform-colors-elevated, #1b2b26);
    --mail-room-text: var(--platform-colors-text, #f7f9f2);
    --mail-room-heading: var(--platform-colors-text, #f7f9f2);
    --mail-room-muted: var(--platform-colors-text-secondary, #b8c1b8);
    --mail-room-line: var(--platform-colors-border, #45554e);
    --mail-room-panel: var(--platform-colors-surface-hover, #2b3b34);
    --mail-room-ink: var(--platform-colors-semantic-blue-text, #c9e0f1);
    --mail-room-selection: var(--platform-colors-selection, #405c70);
    --mail-room-highlight: var(--platform-colors-semantic-orange-muted, #53472f);
  }
  &[data-expanded='true'] {
    position: fixed;
    inset: 0;
    z-index: calc(var(--platform-z-index-zi-app-modal, 1000) - 1);
    background: var(--mail-room-ground);
  }
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--mail-room-ground);
  color: var(--platform-colors-text);
  font-family: var(--platform-typography-font-family);
`

export const RoomBar = styled.header`
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 60px;
  flex-wrap: wrap;
  box-sizing: border-box;
  padding: 10px 24px;
`

export const BarButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 36px;
  padding: 0 12px;
  border: 1px solid var(--platform-colors-border);
  border-radius: 9px;
  background: var(--platform-colors-surface);
  color: var(--platform-colors-text);
  font: 500 13px var(--platform-typography-font-family);
  cursor: pointer;
  white-space: nowrap;
  svg {
    width: 15px;
    height: 15px;
  }
  &:hover:not(:disabled) {
    background: var(--platform-colors-surface-hover);
  }
  &:disabled {
    opacity: 0.55;
    cursor: default;
  }
  &[data-quiet='true'] {
    border-color: transparent;
    background: transparent;
  }
  &[data-primary='true'] {
    border-color: var(--mail-room-ink, ${INK});
    background: ${INK};
    color: #ffffff;
  }
  &[data-primary='true']:hover:not(:disabled) {
    background: #24427f;
  }
`

export const Chip = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border-radius: 99px;
  font-size: 12.5px;
  font-weight: 500;
  white-space: nowrap;
  svg {
    width: 12px;
    height: 12px;
  }
  &[data-ink='reply'] {
    background: color-mix(in srgb, ${INK} 13%, transparent);
    color: var(--mail-room-ink, ${INK});
  }
  &[data-ink='private'] {
    background: color-mix(in srgb, ${PENCIL} 14%, transparent);
    color: var(--platform-colors-text-secondary);
  }
  i {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: ${INK};
  }
`

export const Switch = styled.span<{ $on: boolean }>`
  position: relative;
  width: 26px;
  height: 15px;
  border-radius: 99px;
  background: ${props => (props.$on ? 'var(--platform-colors-text-secondary)' : 'var(--platform-colors-border)')};
  &::after {
    content: '';
    position: absolute;
    top: 2px;
    left: ${props => (props.$on ? '13px' : '2px')};
    width: 11px;
    height: 11px;
    border-radius: 50%;
    background: var(--mail-room-paper, #ffffff);
    transition: left 120ms ease;
  }
`

export const RoomScroll = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
`

export const RoomColumns = styled.div`
  position: relative;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  gap: 40px;
  padding: 4px 32px 80px;
  @media (max-width: 1080px) {
    flex-direction: column;
    align-items: center;
  }
`

export const Sheet = styled.article`
  position: relative;
  flex: 0 1 820px;
  width: min(820px, 100%);
  min-width: 0;
  box-sizing: border-box;
  padding: 64px 76px 72px;
  border-radius: 3px;
  background: var(--mail-room-paper);
  color: var(--mail-room-text);
  box-shadow: 0 1px 2px rgba(20, 25, 40, 0.05), 0 18px 48px -28px rgba(20, 25, 40, 0.28);
  @media (max-width: 760px) {
    padding: 40px 28px 48px;
  }
`

export const Kicker = styled.div`
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--mail-room-muted);
`

export const Headline = styled.h1`
  margin: 14px 0 10px;
  font: 400 40px/1.14 ${READING_SERIF};
  letter-spacing: -0.01em;
  color: var(--mail-room-heading);
  overflow-wrap: anywhere;
`

export const Dateline = styled.div`
  font-size: 13.5px;
  color: var(--mail-room-muted);
`

export const Rule = styled.div`
  width: 56px;
  height: 1px;
  margin: 30px 0;
  background: var(--mail-room-line);
`

export const Prose = styled.div<{ $fontSize: number }>`
  font: 400 ${({ $fontSize }) => $fontSize}px/1.72 ${READING_SERIF};
  color: var(--mail-room-text);
  --page: var(--mail-room-paper);
  overflow-wrap: break-word;
  --vs-body-font: ${READING_SERIF};
  --vs-font-size: ${({ $fontSize }) => $fontSize}px;
  --vs-line-height: 1.72;
  && .mail-annotation-document > div,
  && .mail-annotation-document > div > div {
    padding: 0; margin: 0; width: 100%; max-width: none; min-width: 0; min-height: 0;
    border: 0; background: transparent; box-shadow: none; overflow: visible; font: inherit;
  }
  && .mail-annotation-document .tiptap,
  && .mail-annotation-document .tiptap p { font: inherit; color: var(--mail-room-text); background: transparent; }
  && .mail-annotation-document .tiptap p { margin: 0 0 1.05em; }
  && .mail-annotation-document .tiptap a { color: var(--mail-room-ink); }
  && .mail-annotation-document .comment-mark[data-comment-author='For the reply'] {
    --comment-mark-border: var(--mail-room-ink);
    --comment-mark-bg: color-mix(in srgb, var(--mail-room-ink) 20%, transparent);
  }
  && .mail-annotation-document .comment-mark[data-comment-author='Private'] {
    --comment-mark-border: var(--mail-room-muted);
    --comment-mark-bg: color-mix(in srgb, var(--mail-room-muted) 18%, transparent);
  }
  && .mail-annotation-document textarea {
    background: var(--mail-room-paper);
    color: var(--mail-room-text);
    border-color: var(--mail-room-line);
  }
  && .mail-annotation-document textarea::placeholder {
    color: var(--mail-room-muted);
    opacity: 0.8;
  }


  p {
    margin: 0 0 1.05em;
    white-space: normal;
    &[data-preserve-lines='true'] { white-space: pre-line; }
  }
  a {
    color: var(--mail-room-ink, ${INK});
    text-decoration-thickness: 1px;
    text-underline-offset: 3px;
  }
  mark {
    color: inherit;
    padding: 1px 0;
    cursor: pointer;
  }
  mark[data-ink='reply'] {
    background: color-mix(in srgb, var(--mail-room-ink, ${INK}) 14%, var(--mail-room-paper, #fff));
    box-shadow: inset 0 -1.5px 0 #9fb3dc;
  }
  mark[data-ink='reply'][data-active='true'] {
    background: color-mix(in srgb, var(--mail-room-ink, ${INK}) 22%, var(--mail-room-paper, #fff));
    box-shadow: inset 0 -2px 0 ${INK};
  }
  mark[data-ink='private'] {
    background: color-mix(in srgb, var(--mail-room-muted, ${PENCIL}) 12%, var(--mail-room-paper, #fff));
    border-bottom: 1.5px dashed #9a9fa6;
  }
  mark[data-ink='private'][data-active='true'] {
    background: color-mix(in srgb, var(--mail-room-muted, ${PENCIL}) 20%, var(--mail-room-paper, #fff));
    border-bottom-color: #6a7078;
  }
  mark[data-ink='highlight'] {
    background: var(--mail-room-highlight, #f6edc9);
  }
  mark[data-ink='highlight'][data-active='true'] {
    background: var(--mail-room-highlight, #efdf9f);
  }
  sup {
    margin-left: 2px;
    font: 600 11px var(--platform-typography-font-family);
    color: var(--mail-room-ink, ${INK});
  }
  sup[data-ink='private'] {
    color: #6a7078;
  }
  ::selection {
    background: var(--mail-room-selection);
  }
`

export const SelectionBar = styled.div`
  position: absolute;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  border-radius: 12px;
  background: var(--mail-room-paper, #ffffff);
  box-shadow: 0 2px 6px rgba(20, 25, 40, 0.1), 0 14px 32px -12px rgba(20, 25, 40, 0.35);
  transform: translate(-50%, calc(-100% - 10px));
  font-family: var(--platform-typography-font-family);
  button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 34px;
    padding: 0 10px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--mail-room-muted, #4f545c);
    font: 500 13px var(--platform-typography-font-family);
    cursor: pointer;
    white-space: nowrap;
  }
  button:hover {
    background: var(--mail-room-panel, #f1f3f6);
  }
  button[data-ink='reply'] {
    color: var(--mail-room-ink, ${INK});
  }
  svg {
    width: 15px;
    height: 15px;
  }
  span {
    width: 1px;
    height: 20px;
    margin: 0 2px;
    background: var(--mail-room-line, #e3e5ea);
  }
`

export const Margin = styled.aside`
  position: sticky;
  top: 8px;
  flex: 0 0 340px;
  width: 340px;
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-top: 56px;
  @media (max-width: 1080px) {
    position: static;
    flex-basis: auto;
    width: min(720px, 100%);
    padding-top: 0;
  }
`

export const MarginHead = styled.div`
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 0 14px 8px;
  h2 {
    margin: 0;
    font: 400 23px/1.2 ${READING_SERIF};
  }
  span {
    font-size: 12.5px;
    color: var(--mail-room-muted, var(--platform-colors-text-tertiary));
  }
`

export const NoteCard = styled.div`
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  display: flex;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 12px;
  &[data-active='true'] {
    background: var(--platform-colors-surface);
  }
  &[data-active='true'][data-ink='reply'] {
    background: color-mix(in srgb, ${INK} 8%, var(--platform-colors-surface));
  }
  .badge {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    margin-top: 1px;
    border-radius: 50%;
    font-size: 11.5px;
    font-weight: 600;
  }
  &[data-ink='reply'] .badge {
    background: ${INK};
    color: #ffffff;
  }
  &[data-ink='private'] .badge {
    width: 19px;
    height: 19px;
    border: 1.5px dashed #858b93;
    color: var(--platform-colors-text-secondary);
  }
  &[data-ink='highlight'] .badge {
    background: #f6edc9;
    color: #7a6514;
  }
  .body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .quote {
    padding: 0;
    border: 0;
    background: none;
    color: var(--mail-room-muted, var(--platform-colors-text-tertiary));
    font: italic 12.5px/1.4 var(--platform-typography-font-family);
    text-align: left;
    cursor: pointer;
    overflow: hidden;
    white-space: normal;
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
  }
  .text {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  &[data-ink='reply'] .text {
    font: italic 400 17px/1.45 ${READING_SERIF};
    color: var(--mail-room-ink, ${INK});
  }
  &[data-ink='private'] .text,
  &[data-ink='highlight'] .text {
    font-size: 14px;
    line-height: 1.5;
    color: var(--platform-colors-text-secondary);
  }
  .private {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 11.5px;
    color: var(--mail-room-muted, var(--platform-colors-text-tertiary));
  }
  .private svg {
    width: 11px;
    height: 11px;
  }
  .lost {
    font-size: 12px;
    color: var(--mail-room-muted, var(--platform-colors-text-tertiary));
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 2px;
    margin-left: -6px;
  }
  .actions button {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 28px;
    padding: 0 8px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--mail-room-muted, var(--platform-colors-text-tertiary));
    font: 500 12px var(--platform-typography-font-family);
    cursor: pointer;
  }
  .actions button:hover {
    background: var(--platform-colors-surface-hover);
    color: var(--platform-colors-text);
  }
  .actions svg {
    width: 13px;
    height: 13px;
  }
`

export const NoteEditor = styled.div`
  min-width: 0;
  max-width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
  textarea {
    box-sizing: border-box;
    width: 100%;
    min-height: 96px;
    max-width: 100%;
    padding: 8px 10px;
    border: 1px solid var(--platform-colors-border);
    border-radius: 8px;
    background: var(--platform-colors-surface);
    color: var(--platform-colors-text);
    resize: vertical;
    font: italic 400 16px/1.45 ${READING_SERIF};
  }
  textarea:focus {
    outline: 2px solid color-mix(in srgb, var(--mail-room-ink, ${INK}) 45%, transparent);
    outline-offset: 0;
  }
  textarea::placeholder {
    color: var(--mail-room-muted, var(--platform-colors-text-secondary));
    opacity: 0.8;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .ink {
    height: 30px;
    padding: 0 10px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--platform-colors-text-secondary);
    font: 500 12.5px var(--platform-typography-font-family);
    cursor: pointer;
  }
  .ink[aria-pressed='true'][data-ink='reply'] {
    background: color-mix(in srgb, ${INK} 14%, transparent);
    color: var(--mail-room-ink, ${INK});
  }
  .ink[aria-pressed='true'][data-ink='private'] {
    background: color-mix(in srgb, ${PENCIL} 16%, transparent);
    color: var(--platform-colors-text);
  }
  .ink[aria-pressed='true'][data-ink='highlight'] {
    background: #f6edc9;
    color: #6b5810;
  }
  .grow {
    flex: 1;
  }
`

export const ReplyBox = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0 0 12px;
  padding: 14px 14px 12px;
  border-radius: 14px;
  background: var(--mail-room-paper, #ffffff);
  box-shadow: 0 1px 2px rgba(20, 25, 40, 0.06);
  label {
    font: 400 19px/1.2 ${READING_SERIF};
    color: var(--mail-room-text, #23272f);
  }
  textarea {
    box-sizing: border-box;
    width: 100%;
    min-height: 84px;
    padding: 9px 11px;
    border: 1px solid var(--mail-room-line, #d5d9e0);
    border-radius: 9px;
    background: var(--mail-room-paper, #ffffff);
    color: var(--mail-room-ink, ${INK});
    resize: vertical;
    font: italic 400 16.5px/1.5 ${READING_SERIF};
  }
  textarea:focus {
    outline: 2px solid color-mix(in srgb, var(--mail-room-ink, ${INK}) 45%, transparent);
    outline-offset: 0;
  }
  textarea::placeholder {
    color: var(--mail-room-muted);
    opacity: 0.8;
  }
  .with {
    margin: 0;
    font-size: 12.5px;
    line-height: 1.45;
    color: var(--mail-room-muted, #6e7480);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .done {
    font-size: 12.5px;
    color: var(--platform-colors-success, #1e7d4f);
  }
`

export const WholeNote = styled.div`
  margin: 14px 14px 0;
  padding: 14px;
  border-radius: 12px;
  background: var(--platform-colors-surface);
  label {
    display: block;
    margin-bottom: 8px;
    font-size: 12.5px;
    font-weight: 500;
    color: var(--mail-room-muted, var(--platform-colors-text-tertiary));
  }
`

export const Notice = styled.div`
  margin: 0 24px 8px;
  padding: 8px 12px;
  border-radius: 9px;
  background: var(--puremail-warning-bg, var(--platform-colors-semantic-orange-muted));
  color: var(--puremail-warning-text, var(--platform-colors-semantic-orange-text));
  font-size: 13px;
`
