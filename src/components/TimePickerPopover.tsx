import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Calendar,
  CalendarRange,
  Check,
  Clock,
  Sparkles,
  Sun,
  Sunrise,
  X,
} from 'lucide-react'
import styled from 'styled-components'
import {
  buildScheduleSendPresets,
  buildSnoozePresets,
  parseNaturalDateTime,
  type TimePreset,
} from '../lib/timePresets'
import { useOutsideClose } from './useOutsideClose'

export type TimePickerMode = 'snooze' | 'schedule' | 'followup'

export interface TimePickerPopoverProps {
  mode: TimePickerMode
  onSelect: (iso: string, label: string) => void
  onClose: () => void
  title?: string
  align?: 'left' | 'right'
  placement?: 'down' | 'up'
  staticPosition?: boolean
  ignoreRef?: React.RefObject<HTMLElement | null>
}

const DEFAULT_TITLES: Record<TimePickerMode, string> = {
  snooze: 'Snooze until',
  schedule: 'Schedule send',
  followup: 'Remind if no reply',
}

function defaultCustomDateAndTime(): { date: string; time: string } {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
  const yyyy = tomorrow.getFullYear()
  const mm = String(tomorrow.getMonth() + 1).padStart(2, '0')
  const dd = String(tomorrow.getDate()).padStart(2, '0')
  return { date: `${yyyy}-${mm}-${dd}`, time: '09:00' }
}

function presetIcon(id: string): React.ReactElement {
  switch (id) {
    case 'in_1_hour':
    case 'later_today':
      return <Clock size={14} />
    case 'tomorrow_morning':
      return <Sunrise size={14} />
    case 'this_weekend':
      return <Sun size={14} />
    case 'next_week':
    case 'monday_morning':
      return <Calendar size={14} />
    default:
      return <CalendarRange size={14} />
  }
}

const Popover = styled.div<{
  $align: 'left' | 'right'
  $placement: 'down' | 'up'
  $static?: boolean
}>`
  position: ${props => (props.$static ? 'static' : 'absolute')};
  ${props =>
    props.$static
      ? ''
      : props.$placement === 'up'
        ? 'bottom: calc(100% + 6px);'
        : 'top: calc(100% + 6px);'}
  ${props =>
    props.$static ? '' : props.$align === 'right' ? 'right: 0;' : 'left: 0;'}
  z-index: var(--platform-z-index-zi-app-menus, 100);
  width: 300px;
  border: 1px solid var(--n-line);
  border-radius: 6px;
  background: var(--n-sheet);
  box-shadow: 0 12px 32px rgb(0 0 0 / 0.22);
  color: var(--n-ink);
  font-family: var(--platform-typography-font-family, sans-serif);
  overflow: hidden;
`

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 9px 12px;
  border-bottom: 1px solid var(--n-fence);
  background: var(--n-panel);
`

const HeaderTitle = styled.span`
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--n-soft);
`

const IconBtn = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 3px;
  background: transparent;
  color: var(--n-faint);
  cursor: pointer;

  &:hover {
    background: var(--n-hover);
    color: var(--n-ink);
  }
`

const NaturalSection = styled.div`
  padding: 10px 12px;
  border-bottom: 1px solid var(--n-fence);
`

const NaturalInputWrap = styled.div`
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 8px;
  height: 30px;
  border: 1px solid var(--n-line);
  border-radius: 4px;
  background: var(--n-panel);

  &:focus-within {
    border-color: var(--pure-chrome-accent, var(--p-text));
    background: var(--n-sheet);
  }
`

const NaturalInput = styled.input`
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--n-ink);
  font-family: inherit;
  font-size: 12.5px;
  outline: none;

  &::placeholder {
    color: var(--n-faint);
  }
`

const PreviewPill = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  margin-top: 7px;
  padding: 5px 8px;
  border: 1px solid var(--p-done-border, var(--p-done-line));
  border-radius: 4px;
  background: var(--p-done-bg, var(--p-done-tint));
  color: var(--p-done-fg, var(--p-done-text));
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  text-align: left;

  &:hover {
    filter: brightness(0.97);
  }
`

const InvalidHint = styled.div`
  margin-top: 6px;
  color: var(--p-needs-you-fg, var(--p-needs-you-text));
  font-size: 11px;
`

const PresetList = styled.div`
  display: flex;
  flex-direction: column;
  padding: 4px 0;
`

const PresetRow = styled.button`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  padding: 7px 12px;
  border: 0;
  background: transparent;
  color: var(--n-ink);
  font-family: inherit;
  font-size: 12.5px;
  cursor: pointer;
  text-align: left;

  &:hover {
    background: var(--n-hover);
  }
  &:focus-visible {
    outline: none;
    background: var(--p-chosen);
    box-shadow: var(--p-chosen-edge);
  }
`

const PresetLeft = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-weight: 500;
`

const PresetIconSpan = styled.span`
  display: inline-flex;
  color: var(--n-soft);
`

const PresetSublabel = styled.span`
  color: var(--n-faint);
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
`

const CustomSection = styled.div`
  border-top: 1px solid var(--n-fence);
  background: var(--n-panel);
  padding: 9px 12px 11px;
`

const CustomToggle = styled.button`
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--n-soft);
  font-family: inherit;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;

  &:hover {
    color: var(--n-ink);
  }
`

const CustomForm = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
`

const DateTimeGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 104px;
  gap: 6px;
`

const StyledInput = styled.input`
  height: 28px;
  padding: 0 7px;
  border: 1px solid var(--n-line);
  border-radius: 3px;
  background: var(--n-sheet);
  color: var(--n-ink);
  font-family: inherit;
  font-size: 12px;
  box-sizing: border-box;

  &:focus {
    outline: none;
    border-color: var(--pure-chrome-accent, var(--p-text));
  }
`

const CustomFooter = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`

const ErrorText = styled.span`
  color: var(--p-failed-fg, var(--p-failed-text));
  font-size: 11px;
`

const PrimaryButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 26px;
  padding: 0 11px;
  border: 1px solid var(--pure-chrome-accent, var(--p-text));
  border-radius: 3px;
  background: var(--pure-chrome-accent, var(--p-text));
  color: var(--pure-chrome-on-accent, var(--p-on-text));
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  margin-left: auto;

  &:hover {
    filter: brightness(0.95);
  }
  &:focus-visible {
    outline: 2px solid var(--pure-chrome-accent, var(--p-text));
    outline-offset: 2px;
  }
`

export function TimePickerPopover({
  mode,
  onSelect,
  onClose,
  title,
  align = 'left',
  placement = 'down',
  staticPosition = false,
  ignoreRef,
}: TimePickerPopoverProps): React.ReactElement {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [naturalText, setNaturalText] = useState('')
  const [customOpen, setCustomOpen] = useState(false)
  const defaults = useMemo(() => defaultCustomDateAndTime(), [])
  const [customDate, setCustomDate] = useState(defaults.date)
  const [customTime, setCustomTime] = useState(defaults.time)
  const [customError, setCustomError] = useState<string | null>(null)

  useOutsideClose(rootRef, true, onClose, ignoreRef)

  useEffect(() => {
    requestAnimationFrame(() => {
      inputRef.current?.focus()
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
  }, [onClose])

  const presets: TimePreset[] = useMemo(() => {
    return mode === 'schedule'
      ? buildScheduleSendPresets()
      : buildSnoozePresets()
  }, [mode])

  const parsedNatural = useMemo(() => {
    if (!naturalText.trim()) return null
    return parseNaturalDateTime(naturalText)
  }, [naturalText])

  const handleApplyNatural = (): void => {
    if (!parsedNatural) return
    onSelect(parsedNatural.iso, parsedNatural.label)
  }

  const handleApplyCustom = (): void => {
    if (!customDate || !customTime) {
      setCustomError('Choose a date and time.')
      return
    }
    const candidate = new Date(`${customDate}T${customTime}:00`)
    if (!Number.isFinite(candidate.getTime())) {
      setCustomError('Enter a valid date and time.')
      return
    }
    if (candidate.getTime() <= Date.now()) {
      setCustomError('Pick a future date and time.')
      return
    }
    setCustomError(null)
    const formatted = new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(candidate)
    onSelect(candidate.toISOString(), formatted)
  }

  return (
    <Popover
      ref={rootRef}
      role="dialog"
      aria-label={title ?? DEFAULT_TITLES[mode]}
      $align={align}
      $placement={placement}
      $static={staticPosition}
      onClick={event => event.stopPropagation()}
    >
      <Header>
        <HeaderTitle>{title ?? DEFAULT_TITLES[mode]}</HeaderTitle>
        <IconBtn
          type="button"
          aria-label="Close time picker"
          onClick={onClose}
        >
          <X size={13} />
        </IconBtn>
      </Header>

      <NaturalSection>
        <NaturalInputWrap>
          <Sparkles
            size={13}
            style={{ color: 'var(--n-faint)', flex: 'none' }}
            aria-hidden="true"
          />
          <NaturalInput
            ref={inputRef}
            type="text"
            value={naturalText}
            onChange={event => setNaturalText(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && parsedNatural) {
                event.preventDefault()
                handleApplyNatural()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                onClose()
              }
            }}
            placeholder='e.g. "tomorrow 9am", "fri 2pm", "in 3 days"'
            aria-label="Natural language date and time"
          />
        </NaturalInputWrap>
        {parsedNatural && (
          <PreviewPill
            type="button"
            onClick={handleApplyNatural}
            data-testid="time-picker-natural-preview"
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <Check size={13} aria-hidden="true" />
              {parsedNatural.label}
            </span>
            <span style={{ fontSize: 10.5, opacity: 0.85 }}>↵ Apply</span>
          </PreviewPill>
        )}
        {naturalText.trim().length > 0 && !parsedNatural && (
          <InvalidHint role="status">
            Try a future time like &ldquo;tomorrow 9am&rdquo; or &ldquo;in 2
            hours&rdquo;.
          </InvalidHint>
        )}
      </NaturalSection>

      <PresetList role="menu" aria-label={title ?? DEFAULT_TITLES[mode]}>
        {presets.map(preset => (
          <PresetRow
            key={preset.id}
            type="button"
            role="menuitem"
            onClick={() => onSelect(preset.iso, preset.label)}
          >
            <PresetLeft>
              <PresetIconSpan aria-hidden="true">
                {presetIcon(preset.id)}
              </PresetIconSpan>
              <span>{preset.label}</span>
            </PresetLeft>
            <PresetSublabel>{preset.sublabel}</PresetSublabel>
          </PresetRow>
        ))}
      </PresetList>

      <CustomSection>
        <CustomToggle
          type="button"
          aria-expanded={customOpen}
          onClick={() => {
            setCustomOpen(prev => !prev)
            setCustomError(null)
          }}
        >
          <span>Pick date &amp; time</span>
          <span>{customOpen ? '−' : '+'}</span>
        </CustomToggle>
        {customOpen && (
          <CustomForm>
            <DateTimeGrid>
              <StyledInput
                type="date"
                aria-label="Custom date"
                value={customDate}
                onChange={event => {
                  setCustomDate(event.target.value)
                  setCustomError(null)
                }}
              />
              <StyledInput
                type="time"
                aria-label="Custom time"
                value={customTime}
                onChange={event => {
                  setCustomTime(event.target.value)
                  setCustomError(null)
                }}
              />
            </DateTimeGrid>
            <CustomFooter>
              {customError && <ErrorText role="alert">{customError}</ErrorText>}
              <PrimaryButton type="button" onClick={handleApplyCustom}>
                Apply
              </PrimaryButton>
            </CustomFooter>
          </CustomForm>
        )}
      </CustomSection>
    </Popover>
  )
}
