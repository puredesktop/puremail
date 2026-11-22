import { useEffect, useRef } from 'react'
import { Keyboard, X } from 'lucide-react'
import styled from 'styled-components'

export interface ShortcutsModalProps {
  open: boolean
  onClose: () => void
}

interface ShortcutRowSpec {
  label: string
  keys: string[]
  separator?: 'then' | 'or'
}

interface ShortcutSectionSpec {
  title: string
  rows: ShortcutRowSpec[]
}

const LEFT_SECTIONS: readonly ShortcutSectionSpec[] = [
  {
    title: 'Navigation',
    rows: [
      { label: 'Older thread', keys: ['J'] },
      { label: 'Newer thread', keys: ['K'] },
      { label: 'Open thread', keys: ['O', 'Enter'], separator: 'or' },
      { label: 'Back / Close', keys: ['Esc'] },
      { label: 'Search mail', keys: ['/'] },
      { label: 'Command palette', keys: ['⌘K'] },
      { label: 'Keyboard shortcuts', keys: ['?'] },
    ],
  },
  {
    title: 'Go To (Chords)',
    rows: [
      { label: 'Inbox', keys: ['G', 'I'], separator: 'then' },
      { label: 'Starred', keys: ['G', 'S'], separator: 'then' },
      { label: 'Snoozed', keys: ['G', 'H'], separator: 'then' },
      { label: 'Waiting on', keys: ['G', 'W'], separator: 'then' },
      { label: 'Feed', keys: ['G', 'F'], separator: 'then' },
      { label: 'Paper trail', keys: ['G', 'P'], separator: 'then' },
      { label: 'Sent', keys: ['G', 'T'], separator: 'then' },
      { label: 'Drafts', keys: ['G', 'D'], separator: 'then' },
      { label: 'Archive', keys: ['G', 'A'], separator: 'then' },
    ],
  },
]

const RIGHT_SECTIONS: readonly ShortcutSectionSpec[] = [
  {
    title: 'Triage & Actions',
    rows: [
      { label: 'Archive', keys: ['E'] },
      { label: 'Move to Trash', keys: ['#'] },
      { label: 'Snooze picker', keys: ['H'] },
      { label: 'Quick snooze', keys: ['S'] },
      { label: 'Mute thread', keys: ['M'] },
      { label: 'Pin thread', keys: ['P'] },
      { label: 'Mark unread', keys: ['U'] },
      { label: 'Label', keys: ['L'] },
      { label: 'Move to folder', keys: ['V'] },
      { label: 'Select thread', keys: ['X'] },
      { label: 'Undo last triage', keys: ['Z'] },
    ],
  },
  {
    title: 'Reading & Compose',
    rows: [
      { label: 'Compose', keys: ['C'] },
      { label: 'Reply', keys: ['R'] },
      { label: 'Reply all', keys: ['A'] },
      { label: 'Forward', keys: ['F'] },
      { label: 'Send / Quick reply', keys: ['⌘↵'] },
      { label: 'Insert snippet', keys: [';'] },
    ],
  },
]

const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: var(--platform-z-index-zi-app-modal, 300);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgb(0 0 0 / 0.44);
  font-family: var(--platform-typography-font-family, sans-serif);
`

const Dialog = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 720px;
  max-height: min(84vh, 660px);
  overflow: hidden;
  border: 1px solid var(--n-line);
  border-radius: 6px;
  background: var(--n-sheet);
  box-shadow: 0 12px 32px rgb(0 0 0 / 0.22);
  color: var(--n-ink);
`

const Header = styled.div`
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--n-line);
  background: var(--n-panel);
`

const TitleWrap = styled.div`
  display: flex;
  align-items: center;
  gap: 9px;
`

const TitleIcon = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 1px solid var(--n-line);
  border-radius: 4px;
  background: var(--n-sheet);
  color: var(--pure-chrome-accent, var(--p-text));
`

const Title = styled.h2`
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.25;
`

const Subtitle = styled.span`
  color: var(--n-faint);
  font-size: 11.5px;
`

const CloseButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--n-btn-line);
  border-radius: 3px;
  background: var(--n-sheet);
  color: var(--n-soft);
  cursor: pointer;

  &:hover {
    background: var(--n-hover);
    color: var(--n-ink);
  }
  &:focus-visible {
    outline: 2px solid var(--pure-chrome-accent, var(--p-text));
    outline-offset: 2px;
  }
`

const Body = styled.div`
  display: grid;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px 28px;
  padding: 16px 20px 20px;

  @media (max-width: 640px) {
    grid-template-columns: 1fr;
  }
`

const Column = styled.div`
  display: flex;
  flex-direction: column;
  gap: 18px;
`

const Section = styled.section`
  display: flex;
  flex-direction: column;
`

const SectionHeading = styled.h3`
  margin: 0 0 8px;
  padding-bottom: 5px;
  border-bottom: 1px solid var(--n-fence);
  color: var(--n-soft);
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
`

const Row = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 4.5px 0;
  font-size: 12.5px;
`

const RowLabel = styled.span`
  color: var(--n-ink);
`

const KeysWrap = styled.span`
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 4px;
`

const KeySep = styled.span`
  color: var(--n-faint);
  font-size: 10.5px;
`

const Kbd = styled.kbd`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 21px;
  padding: 0 6px;
  border: 1px solid var(--n-line);
  border-bottom-width: 2px;
  border-radius: 3px;
  background: var(--n-panel);
  color: var(--n-ink);
  font-family: var(--platform-typography-font-family-mono, monospace);
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
`

const Footer = styled.div`
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  border-top: 1px solid var(--n-fence);
  background: var(--n-panel);
  color: var(--n-faint);
  font-size: 11.5px;
`

function renderSection(section: ShortcutSectionSpec): React.ReactElement {
  return (
    <Section key={section.title}>
      <SectionHeading>{section.title}</SectionHeading>
      {section.rows.map(row => (
        <Row key={`${section.title}-${row.label}`}>
          <RowLabel>{row.label}</RowLabel>
          <KeysWrap>
            {row.keys.map((key, index) => (
              <span
                key={`${row.label}-${key}-${index}`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
              >
                {index > 0 && row.separator === 'or' && (
                  <KeySep aria-hidden="true">/</KeySep>
                )}
                {index > 0 && row.separator === 'then' && (
                  <KeySep aria-hidden="true">then</KeySep>
                )}
                <Kbd>{key}</Kbd>
              </span>
            ))}
          </KeysWrap>
        </Row>
      ))}
    </Section>
  )
}

export function ShortcutsModal({
  open,
  onClose,
}: ShortcutsModalProps): React.ReactElement | null {
  const closeBtnRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!open) return
    requestAnimationFrame(() => {
      closeBtnRef.current?.focus()
    })
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <Backdrop
      data-testid="shortcuts-modal-backdrop"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <Dialog
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        onMouseDown={event => event.stopPropagation()}
      >
        <Header>
          <TitleWrap>
            <TitleIcon aria-hidden="true">
              <Keyboard size={14} />
            </TitleIcon>
            <div>
              <Title>Keyboard shortcuts</Title>
              <Subtitle>Single-key navigation and triage across PureMail</Subtitle>
            </div>
          </TitleWrap>
          <CloseButton
            ref={closeBtnRef}
            type="button"
            aria-label="Close keyboard shortcuts"
            onClick={onClose}
          >
            <X size={14} />
          </CloseButton>
        </Header>

        <Body>
          <Column>{LEFT_SECTIONS.map(renderSection)}</Column>
          <Column>{RIGHT_SECTIONS.map(renderSection)}</Column>
        </Body>

        <Footer>
          <span>Shortcuts pause automatically while typing in inputs or compose.</span>
          <span>Press Esc to close</span>
        </Footer>
      </Dialog>
    </Backdrop>
  )
}
