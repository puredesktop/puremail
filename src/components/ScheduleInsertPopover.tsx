import { useEffect, useMemo, useState } from 'react'
import styled from 'styled-components'
import { Calendar, Clock, Link2 } from 'lucide-react'
import {
  formatMailAvailabilitySnippet,
  localTimeZone,
  MAIL_RECIPIENT_ZONES,
  readCalendarSchedulingCatalog,
  type CalendarSchedulingCatalog,
} from '../lib/calendarSchedulingBridge'

const Popover = styled.div<{ $placement?: 'up' | 'down' }>`
  position: absolute;
  ${p => (p.$placement === 'down' ? 'top: calc(100% + 6px);' : 'bottom: calc(100% + 6px);')}
  right: 0;
  z-index: 80;
  width: 340px;
  max-height: 400px;
  overflow-y: auto;
  border: 1px solid var(--platform-colors-border);
  border-radius: var(--platform-radius-md, 4px);
  background: var(--platform-colors-surface);
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.16);
  padding: 10px;
  display: grid;
  gap: 8px;
  color: var(--platform-colors-text);
  font-size: 12.5px;
`

const Tabs = styled.div`
  display: flex;
  gap: 6px;
`

const Tab = styled.button<{ $active: boolean }>`
  flex: 1;
  height: 26px;
  border: 1px solid ${p => (p.$active ? 'var(--platform-colors-accent)' : 'var(--platform-colors-border)')};
  border-radius: 3px;
  background: ${p => (p.$active ? 'var(--platform-colors-surface-selected)' : 'var(--platform-colors-surface)')};
  color: var(--platform-colors-text);
  font: inherit;
  font-size: 11.5px;
  font-weight: ${p => (p.$active ? 650 : 500)};
  cursor: pointer;
`

const RowBtn = styled.button<{ $selected?: boolean }>`
  display: grid;
  gap: 2px;
  width: 100%;
  padding: 7px 8px;
  border: 1px solid ${p => (p.$selected ? 'var(--platform-colors-accent)' : 'var(--platform-colors-border-soft, var(--platform-colors-border))')};
  border-radius: 3px;
  background: ${p => (p.$selected ? 'var(--platform-colors-surface-selected)' : 'var(--platform-colors-surface)')};
  color: var(--platform-colors-text);
  font: inherit;
  text-align: left;
  cursor: pointer;

  &:hover {
    background: var(--platform-colors-surface-hover);
  }

  small {
    color: var(--platform-colors-text-secondary);
    font-family: var(--platform-typography-font-family-mono);
    font-size: 10.5px;
  }
`

const Select = styled.select`
  width: 100%;
  padding: 5px 7px;
  border: 1px solid var(--platform-colors-border);
  border-radius: 3px;
  background: var(--platform-colors-surface);
  color: var(--platform-colors-text);
  font: inherit;
  font-size: 12px;
`

const Footer = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
  padding-top: 4px;
  border-top: 1px solid var(--platform-colors-border-soft, var(--platform-colors-border));
`

const ActionBtn = styled.button<{ $primary?: boolean }>`
  height: 26px;
  padding: 0 10px;
  border: 1px solid ${p => (p.$primary ? 'var(--platform-colors-accent)' : 'var(--platform-colors-border)')};
  border-radius: 3px;
  background: ${p => (p.$primary ? 'var(--platform-colors-accent)' : 'var(--platform-colors-surface)')};
  color: ${p => (p.$primary ? 'var(--platform-colors-text-on-accent)' : 'var(--platform-colors-text)')};
  font: inherit;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`

export function ScheduleInsertPopover({
  placement = 'up',
  onInsert,
  onOpenCalendar,
  onClose,
}: {
  placement?: 'up' | 'down'
  onInsert: (text: string) => void
  onOpenCalendar?: () => void
  onClose: () => void
}) {
  const [tab, setTab] = useState<'links' | 'slots'>('links')
  const [catalog, setCatalog] = useState<CalendarSchedulingCatalog | null>(null)
  const [loading, setLoading] = useState(true)
  const [recipientTz, setRecipientTz] = useState<string>('')
  const [selectedStarts, setSelectedStarts] = useState<string[]>([])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    let active = true
    void readCalendarSchedulingCatalog().then(data => {
      if (!active) return
      setCatalog(data)
      if (data && data.links.length === 0 && data.upcomingFreeSlots.length > 0) {
        setTab('slots')
      }
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [])

  const hostTz = catalog?.timeZone || localTimeZone()
  const activeLinks = useMemo(() => (catalog?.links ?? []).filter(l => l.active), [catalog])
  const slots = useMemo(() => (catalog?.upcomingFreeSlots ?? []).slice(0, 8), [catalog])

  const toggleSlot = (start: string) => {
    setSelectedStarts(prev => (prev.includes(start) ? prev.filter(s => s !== start) : [...prev, start]))
  }

  const insertSelectedSlots = () => {
    const chosen = slots.filter(s => selectedStarts.includes(s.start))
    if (!chosen.length) return
    const text = formatMailAvailabilitySnippet({
      slots: chosen,
      hostTimeZone: hostTz,
      recipientTimeZone: recipientTz || undefined,
      bookingUrl: activeLinks[0]?.url,
    })
    onInsert(text)
    onClose()
  }

  return (
    <Popover $placement={placement} role="dialog" aria-label="Insert booking link or available times">
      <Tabs>
        <Tab type="button" $active={tab === 'links'} onClick={() => setTab('links')}>
          <Link2 size={12} style={{ verticalAlign: -2, marginRight: 4 }} />
          Booking links ({activeLinks.length})
        </Tab>
        <Tab type="button" $active={tab === 'slots'} onClick={() => setTab('slots')}>
          <Clock size={12} style={{ verticalAlign: -2, marginRight: 4 }} />
          Offer times ({slots.length})
        </Tab>
      </Tabs>

      {loading ? (
        <div style={{ color: 'var(--platform-colors-text-secondary)' }}>Reading PureCalendar…</div>
      ) : tab === 'links' ? (
        activeLinks.length === 0 ? (
          <div style={{ color: 'var(--platform-colors-text-secondary)', lineHeight: 1.45 }}>
            No active PureCalendar booking links yet. Open PureCalendar → <strong>Booking links</strong> to create a booking page or one-off invite link.
          </div>
        ) : (
          activeLinks.map(link => (
            <RowBtn
              key={link.id}
              type="button"
              onClick={() => {
                onInsert(`Book a time (${link.title}): ${link.url}`)
                onClose()
              }}
            >
              <strong>{link.title}</strong>
              <small>{link.url}</small>
            </RowBtn>
          ))
        )
      ) : (
        <>
          <label style={{ display: 'grid', gap: 4, fontSize: 11.5 }}>
            Recipient timezone (optional dual-TZ conversion)
            <Select value={recipientTz} onChange={e => setRecipientTz(e.target.value)} aria-label="Recipient timezone">
              <option value="">Same as mine ({hostTz})</option>
              {MAIL_RECIPIENT_ZONES.map(z => (
                <option key={z.timeZone} value={z.timeZone}>
                  {z.label}
                </option>
              ))}
            </Select>
          </label>
          {slots.length === 0 ? (
            <div style={{ color: 'var(--platform-colors-text-secondary)' }}>
              Open PureCalendar once to sync upcoming available times.
            </div>
          ) : (
            slots.map(slot => {
              const selected = selectedStarts.includes(slot.start)
              const label = new Intl.DateTimeFormat(undefined, {
                timeZone: hostTz,
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              }).format(new Date(slot.start))
              const guestLabel = recipientTz
                ? new Intl.DateTimeFormat(undefined, {
                    timeZone: recipientTz,
                    weekday: 'short',
                    hour: 'numeric',
                    minute: '2-digit',
                  }).format(new Date(slot.start))
                : null
              return (
                <RowBtn key={slot.start} type="button" $selected={selected} onClick={() => toggleSlot(slot.start)}>
                  <strong>{label}</strong>
                  {guestLabel && <small>Recipient: {guestLabel} ({recipientTz})</small>}
                </RowBtn>
              )
            })
          )}
          <Footer>
            <ActionBtn type="button" $primary disabled={selectedStarts.length === 0} onClick={insertSelectedSlots}>
              Insert {selectedStarts.length || ''} slot{selectedStarts.length === 1 ? '' : 's'}
            </ActionBtn>
            <ActionBtn type="button" onClick={onClose}>
              Close
            </ActionBtn>
          </Footer>
        </>
      )}

      {tab === 'links' && (
        <Footer>
          {onOpenCalendar ? (
            <ActionBtn
              type="button"
              onClick={() => {
                onOpenCalendar()
                onClose()
              }}
            >
              <Calendar size={12} style={{ verticalAlign: -2, marginRight: 4 }} />
              Open PureCalendar
            </ActionBtn>
          ) : (
            <span />
          )}
          <ActionBtn type="button" onClick={onClose}>
            Close
          </ActionBtn>
        </Footer>
      )}
    </Popover>
  )
}
