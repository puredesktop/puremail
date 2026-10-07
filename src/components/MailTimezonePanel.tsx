import { useEffect, useMemo, useRef, useState } from 'react'
import styled from 'styled-components'
import { convertTime, emailTimes, type TimeMention } from '../lib/mailTimezone'
import { guessZone, searchZones, zoneChoices, type ZoneChoice, type ZoneGuess } from '../lib/timezonePick'
import { BarButton } from './readingRoomStyles'

const Panel = styled.section`
  margin: 0 0 28px; padding: 20px; border: 1px solid currentColor; border-radius: 12px;
  h2 { margin: 0 0 8px; font-size: 20px; }
  p { font-size: 14px; line-height: 1.5; }
  article { border-top: 1px solid currentColor; padding-top: 12px; margin-top: 16px; }
  label { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 8px 0; font-size: 14px; }
  input { color: inherit; background: transparent; border: 1px solid currentColor; border-radius: 5px; padding: 6px; max-width: 100%; }
  blockquote { margin: 8px 0; white-space: pre-wrap; overflow-wrap: anywhere; }
  .zone { position: relative; display: inline-flex; flex-direction: column; min-width: 260px; }
  .zone input { width: 100%; box-sizing: border-box; }
  .zone [role="listbox"] { position: absolute; top: 100%; left: 0; z-index: 4; margin: 2px 0 0; padding: 4px 0; list-style: none; min-width: 100%; max-height: 240px; overflow: auto; background: var(--platform-colors-surface, #fff); border: 1px solid currentColor; border-radius: 6px; box-shadow: 0 6px 18px rgba(0, 0, 0, 0.12); }
  .zone [role="option"] { padding: 6px 10px; cursor: pointer; font-size: 14px; display: flex; justify-content: space-between; gap: 12px; }
  .zone [role="option"] small { opacity: 0.6; }
  .zone [role="option"][aria-selected="true"] { background: var(--platform-colors-accent-muted, rgba(0, 0, 0, 0.06)); }
  .hint { margin: 2px 0 0; font-size: 13px; opacity: 0.75; }
`
export function MailTimezonePanel({ source, receivedAt, onClose }: { source: string; receivedAt: string; onClose: () => void }) {
  const target = Intl.DateTimeFormat().resolvedOptions().timeZone
  const mentions = useMemo(() => emailTimes(source, receivedAt), [source, receivedAt])
  const choices = useMemo(() => zoneChoices(), [])
  return <Panel aria-label="Timezone conversion">
    <h2>Times in {target}</h2>
    <p>Dates and relative days are read against the email’s sent/received date (UTC). Check the date before relying on a conversion. The source timezone is guessed from the email’s own words (“2pm UK”, “9am Eastern”); choose another where the guess is wrong.</p>
    <BarButton type="button" onClick={onClose}>Close conversions</BarButton>
    {mentions.length ? mentions.map(m => <Mention key={`${m.index}:${m.text}`} mention={m} target={target} choices={choices} guess={guessZone(source, m)}/>) : <p>No time mentions found. Try a time such as “3pm UTC” or “tomorrow at 14:30”. English date and time expressions are supported.</p>}
  </Panel>
}
function Mention({ mention: m, target, choices, guess }: { mention: TimeMention; target: string; choices: ZoneChoice[]; guess: ZoneGuess | null }) {
  const [date, setDate] = useState(m.date)
  // The zone starts as the guess from the email's words, unless the time carries its own offset (an abbreviation chrono read).
  const [zone, setZone] = useState(m.offset === null && guess ? guess.zone : '')
  const [time, setTime] = useState(`${String(m.hour).padStart(2, '0')}:${String(m.minute).padStart(2, '0')}`)
  let result: string
  try {
    const [hour, minute] = time.split(':').map(Number)
    if (!time) throw new Error('Choose a source time.')
    result = convertTime(date, hour!, minute!, zone, m.offset, target)
    if (m.end) result += ` → ${convertTime(date === m.date ? m.end.date : date, m.end.hour, m.end.minute, zone, m.end.offset ?? m.offset, target)}`
  } catch (error) { result = error instanceof RangeError ? 'Enter a valid IANA timezone, such as America/New_York.' : (error as Error).message }
  return <article>
    <blockquote>{m.text}</blockquote>
    <label>Date {m.assumedDate ? '(inferred — check)' : ''}<input type="date" aria-label={`Date for ${m.text}`} value={date} onChange={e => setDate(e.target.value)}/></label>
    <label>Source time<input type="time" aria-label={`Source time for ${m.text}`} value={time} onChange={e => setTime(e.target.value)}/></label>
    <label>Source timezone<ZonePicker choices={choices} value={zone} onChange={setZone} label={`Source timezone for ${m.text}`} placeholder={m.offset === null ? 'Required: a city or a country' : `Email offset: UTC${m.offset < 0 ? '−' : '+'}${Math.floor(Math.abs(m.offset)/60)}:${String(Math.abs(m.offset)%60).padStart(2,'0')}`}/></label>
    {guess && zone === guess.zone ? <p className="hint">Guessed from “{guess.from}” in the email{guess.ambiguous ? ', which can mean more than one zone: check it' : ''}.</p> : null}
    {m.offset !== null ? <p>Using the email’s timezone offset unless overridden. Abbreviations can have several meanings; verify the source zone.</p> : null}
    {m.assumedMeridiem ? <p>AM/PM was inferred. Verify the original time.</p> : null}
    <p role="status"><strong>{result}</strong></p>
  </article>
}

/** A timezone chosen from the zones the runtime knows, found by city, country or the usual abbreviation as it is typed. */
function ZonePicker({ choices, value, onChange, label, placeholder }: { choices: ZoneChoice[]; value: string; onChange: (zone: string) => void; label: string; placeholder: string }) {
  const [typed, setTyped] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const wrap = useRef<HTMLDivElement>(null)
  const shown = typed ?? (choices.find(c => c.zone === value)?.label ?? value)
  const matches = useMemo(() => (typed === null ? [] : searchZones(choices, typed)), [choices, typed])
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) { setOpen(false); setTyped(null) } }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])
  const pick = (c: ZoneChoice) => { onChange(c.zone); setTyped(null); setOpen(false) }
  const id = useMemo(() => `zones-${Math.random().toString(36).slice(2, 8)}`, [])
  return <div className="zone" ref={wrap}>
    <input type="text" role="combobox" aria-label={label} aria-expanded={open && matches.length > 0} aria-controls={id} aria-autocomplete="list" placeholder={placeholder} value={shown}
      onFocus={() => { setTyped(shown); setOpen(true) }}
      onChange={e => {
        const v = e.target.value
        setTyped(v); setOpen(true); setActive(0)
        // Cleared, or a zone written out in full (Europe/London): taken as typed, no pick needed.
        const exact = choices.find(c => c.zone.toLowerCase() === v.trim().toLowerCase())
        if (!v.trim()) onChange('')
        else if (exact) onChange(exact.zone)
      }}
      onKeyDown={e => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, matches.length - 1)) }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
        else if (e.key === 'Enter' && matches[active]) { e.preventDefault(); pick(matches[active]!) }
        else if (e.key === 'Escape') { setOpen(false); setTyped(null) }
      }}
      onBlur={() => { if (typed !== null && !open) setTyped(null) }}/>
    {open && matches.length > 0 ? <ul role="listbox" id={id}>
      {matches.map((c, i) => <li key={c.zone} role="option" aria-selected={i === active} onMouseDown={e => { e.preventDefault(); pick(c) }} onMouseEnter={() => setActive(i)}>{c.label}<small>{c.zone}</small></li>)}
    </ul> : null}
  </div>
}
