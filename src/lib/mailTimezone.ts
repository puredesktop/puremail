import { parse, type ParsedComponents } from 'chrono-node'

export interface TimeMention {
  text: string
  index: number
  date: string
  hour: number
  minute: number
  end?: { date: string; hour: number; minute: number; offset: number | null }
  offset: number | null
  assumedDate: boolean
  assumedMeridiem: boolean
}
const dateOf = (c: ParsedComponents) => `${c.get('year')}-${String(c.get('month')).padStart(2, '0')}-${String(c.get('day')).padStart(2, '0')}`
export function emailTimes(text: string, receivedAt: string): TimeMention[] {
  const reference = new Date(receivedAt)
  if (!Number.isFinite(reference.getTime())) return []
  return parse(text, { instant: reference, timezone: 0 }).filter(r => r.start.isCertain('hour')).map(r => ({
    text: r.text, index: r.index, date: dateOf(r.start), hour: r.start.get('hour')!, minute: r.start.get('minute') ?? 0,
    offset: r.start.isCertain('timezoneOffset') ? r.start.get('timezoneOffset') : null,
    end: r.end?.isCertain('hour') ? { date: dateOf(r.end), hour: r.end.get('hour')!, minute: r.end.get('minute') ?? 0, offset: r.end.isCertain('timezoneOffset') ? r.end.get('timezoneOffset') : null } : undefined,
    assumedDate: !r.start.isCertain('day') || !r.start.isCertain('month') || !r.start.isCertain('year'),
    assumedMeridiem: !r.start.isCertain('meridiem') && r.start.get('hour')! < 13 && !/\b0?\d:\d{2}\b/.test(r.text),
  }))
}

/** Enumerate possible instants: reject missing and repeated DST wall times. */
export function convertTime(date: string, hour: number, minute: number, zone: string, offset: number | null, target: string): string {
  const [year, month, day] = date.split('-').map(Number)
  const wall = Date.UTC(year!, month! - 1, day!, hour, minute)
  if (!Number.isFinite(wall) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(wall).toISOString().slice(0, 10) !== date) throw new Error('Choose a valid date.')
  let instant: number
  if (!zone.trim()) {
    if (offset === null) throw new Error('Enter the source timezone to convert this time.')
    instant = wall - offset * 60000
  } else {
    const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: zone.trim(), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    const wallAt = (ms: number) => {
      const parts = Object.fromEntries(formatter.formatToParts(ms).map(p => [p.type, p.value]))
      return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute))
    }
    const offsets = new Set<number>()
    for (const delta of [-36, -12, 0, 12, 36]) { const probe = wall + delta * 3600000; offsets.add(wallAt(probe) - probe) }
    const candidates = [...offsets].map(o => wall - o).filter(ms => wallAt(ms) === wall)
    if (candidates.length !== 1) throw new Error(candidates.length ? 'This time occurs twice when clocks change. Use an explicit UTC offset in the email.' : 'This time does not exist when clocks change. Choose another time.')
    instant = candidates[0]!
  }
  return new Intl.DateTimeFormat(undefined, { timeZone: target, weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(instant)
}
