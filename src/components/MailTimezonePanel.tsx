import { useMemo, useState } from 'react'
import styled from 'styled-components'
import { convertTime, emailTimes, type TimeMention } from '../lib/mailTimezone'
import { BarButton } from './readingRoomStyles'

const Panel = styled.section`
  margin: 0 0 28px; padding: 20px; border: 1px solid currentColor; border-radius: 12px;
  h2 { margin: 0 0 8px; font-size: 20px; }
  p { font-size: 14px; line-height: 1.5; }
  article { border-top: 1px solid currentColor; padding-top: 12px; margin-top: 16px; }
  label { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 8px 0; font-size: 14px; }
  input { color: inherit; background: transparent; border: 1px solid currentColor; border-radius: 5px; padding: 6px; max-width: 100%; }
  blockquote { margin: 8px 0; white-space: pre-wrap; overflow-wrap: anywhere; }
`
export function MailTimezonePanel({ source, receivedAt, onClose }: { source: string; receivedAt: string; onClose: () => void }) {
  const target = Intl.DateTimeFormat().resolvedOptions().timeZone
  const mentions = useMemo(() => emailTimes(source, receivedAt), [source, receivedAt])
  return <Panel aria-label="Timezone conversion">
    <h2>Times in {target}</h2>
    <p>Dates and relative days are read against the email’s sent/received date (UTC). Check the date before relying on a conversion. Enter an IANA timezone, such as Europe/London, for times without a zone or to override an abbreviation.</p>
    <BarButton type="button" onClick={onClose}>Close conversions</BarButton>
    {mentions.length ? mentions.map(m => <Mention key={`${m.index}:${m.text}`} mention={m} target={target}/>) : <p>No time mentions found. Try a time such as “3pm UTC” or “tomorrow at 14:30”. English date and time expressions are supported.</p>}
  </Panel>
}
function Mention({ mention: m, target }: { mention: TimeMention; target: string }) {
  const [date, setDate] = useState(m.date)
  const [zone, setZone] = useState('')
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
    <label>Source timezone<input type="text" aria-label={`Source timezone for ${m.text}`} placeholder={m.offset === null ? 'Required, e.g. Europe/London' : `Email offset: UTC${m.offset < 0 ? '−' : '+'}${Math.floor(Math.abs(m.offset)/60)}:${String(Math.abs(m.offset)%60).padStart(2,'0')}`} value={zone} onChange={e => setZone(e.target.value)}/></label>
    {m.offset !== null ? <p>Using the email’s timezone offset unless overridden. Abbreviations can have several meanings; verify the source zone.</p> : null}
    {m.assumedMeridiem ? <p>AM/PM was inferred. Verify the original time.</p> : null}
    <p role="status"><strong>{result}</strong></p>
  </article>
}
