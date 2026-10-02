import { styled } from 'styled-components'

/**
 * The reading room's look: a white sheet on the reader's quiet ground, a
 * reading serif, and two inks. Blue ink is for the reply; pencil (grey) is
 * the reader's own. The sheet stays white paper in every appearance, as mail
 * bodies do; the chrome around it follows the app's tokens.
 */
export const READING_SERIF = `'Newsreader', 'Iowan Old Style', 'Charter', 'Source Serif 4', Georgia, serif`
export const INK = '#2c4f9e'
export const INK_TINT = '#e4eaf6'
export const INK_ACTIVE = '#cfdbf2'
export const PENCIL = '#5d636b'
export const PENCIL_TINT = '#efeee9'

export const Room = styled.section`
  &[data-expanded='true'] {
    position: fixed;
    inset: 0;
    z-index: 100;
  }
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--puremail-reader-bg, #eceef1);
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
  padding-block: 10px;
  box-sizing: border-box;
  padding: 0 24px;
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
    border-color: ${INK};
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
    color: ${INK};
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
    background: #ffffff;
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
  flex: 0 1 720px;
  min-width: 0;
  box-sizing: border-box;
  padding: 64px 76px 72px;
  border-radius: 3px;
  background: #ffffff;
  color: #23272f;
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
  color: #6e7480;
`

export const Headline = styled.h1`
  margin: 14px 0 10px;
  font: 400 40px/1.14 ${READING_SERIF};
  letter-spacing: -0.01em;
  color: #15181e;
  overflow-wrap: anywhere;
`

export const Dateline = styled.div`
  font-size: 13.5px;
  color: #6e7480;
`

export const Rule = styled.div`
  width: 56px;
  height: 1px;
  margin: 30px 0;
  background: #c9ccd2;
`

export const Prose = styled.div`
  font: 400 19px/1.72 ${READING_SERIF};
  color: #23272f;
  overflow-wrap: break-word;
  p {
    margin: 0 0 1.05em;
    white-space: normal;
    &[data-preserve-lines='true'] { white-space: pre-line; }
  }
  a {
    color: ${INK};
    text-decoration-thickness: 1px;
    text-underline-offset: 3px;
  }
  mark {
    color: inherit;
    padding: 1px 0;
    cursor: pointer;
  }
  mark[data-ink='reply'] {
    background: ${INK_TINT};
    box-shadow: inset 0 -1.5px 0 #9fb3dc;
  }
  mark[data-ink='reply'][data-active='true'] {
    background: ${INK_ACTIVE};
    box-shadow: inset 0 -2px 0 ${INK};
  }
  mark[data-ink='private'] {
    background: ${PENCIL_TINT};
    border-bottom: 1.5px dashed #9a9fa6;
  }
  mark[data-ink='private'][data-active='true'] {
    background: #e3e1d8;
    border-bottom-color: #6a7078;
  }
  mark[data-ink='highlight'] {
    background: #f6edc9;
  }
  mark[data-ink='highlight'][data-active='true'] {
    background: #efdf9f;
  }
  sup {
    margin-left: 2px;
    font: 600 11px var(--platform-typography-font-family);
    color: ${INK};
  }
  sup[data-ink='private'] {
    color: #6a7078;
  }
  ::selection {
    background: #c9d8f4;
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
  background: #ffffff;
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
    color: #4f545c;
    font: 500 13px var(--platform-typography-font-family);
    cursor: pointer;
    white-space: nowrap;
  }
  button:hover {
    background: #f1f3f6;
  }
  button[data-ink='reply'] {
    color: ${INK};
  }
  svg {
    width: 15px;
    height: 15px;
  }
  span {
    width: 1px;
    height: 20px;
    margin: 0 2px;
    background: #e3e5ea;
  }
`

export const Margin = styled.aside`
  position: sticky;
  top: 8px;
  flex: 0 0 340px;
  max-width: 100%;
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
    color: var(--platform-colors-text-tertiary);
  }
`

export const NoteCard = styled.div`
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
    color: var(--platform-colors-text-tertiary);
    font: italic 12.5px/1.4 var(--platform-typography-font-family);
    text-align: left;
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .text {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  &[data-ink='reply'] .text {
    font: italic 400 17px/1.45 ${READING_SERIF};
    color: ${INK};
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
    color: var(--platform-colors-text-tertiary);
  }
  .private svg {
    width: 11px;
    height: 11px;
  }
  .lost {
    font-size: 12px;
    color: var(--platform-colors-text-tertiary);
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
    color: var(--platform-colors-text-tertiary);
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
  display: flex;
  flex-direction: column;
  gap: 8px;
  textarea {
    box-sizing: border-box;
    width: 100%;
    min-height: 64px;
    padding: 8px 10px;
    border: 1px solid var(--platform-colors-border);
    border-radius: 8px;
    background: var(--platform-colors-surface);
    color: var(--platform-colors-text);
    resize: vertical;
    font: italic 400 16px/1.45 ${READING_SERIF};
  }
  textarea:focus {
    outline: 2px solid color-mix(in srgb, ${INK} 45%, transparent);
    outline-offset: 0;
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
    color: ${INK};
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
    color: var(--platform-colors-text-tertiary);
  }
`

export const Notice = styled.div`
  margin: 0 24px 8px;
  padding: 8px 12px;
  border-radius: 9px;
  background: var(--puremail-warning-bg);
  color: var(--puremail-warning-text);
  font-size: 13px;
`
