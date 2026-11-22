import * as chrono from 'chrono-node'

export interface TimePreset {
  id: string
  label: string
  sublabel: string
  iso: string
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const

const MS_PER_DAY = 24 * 60 * 60 * 1000
const MS_PER_15M = 15 * 60 * 1000

function formatClock(date: Date): string {
  const hours24 = date.getHours()
  const minutes = date.getMinutes()
  const suffix = hours24 >= 12 ? 'PM' : 'AM'
  const hours12 = hours24 % 12 || 12
  return minutes === 0
    ? `${hours12}:00 ${suffix}`
    : `${hours12}:${String(minutes).padStart(2, '0')} ${suffix}`
}

/** DST-safe local calendar-day difference between `now` and `date`. */
function calendarDayDiff(date: Date, now: Date): number {
  const dateDayUtc = Date.UTC(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  )
  const nowDayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((dateDayUtc - nowDayUtc) / MS_PER_DAY)
}

function formatShortDateTime(date: Date, now: Date): string {
  const diffDays = calendarDayDiff(date, now)
  if (diffDays === 0) return formatClock(date)
  const day = WEEKDAYS[date.getDay()]
  const month = MONTHS[date.getMonth()]
  if (diffDays >= 1 && diffDays < 7) {
    return `${day}, ${formatClock(date)}`
  }
  return `${day}, ${month} ${date.getDate()}, ${formatClock(date)}`
}

function atLocalTime(
  base: Date,
  daysOffset: number,
  hour: number,
  minute = 0,
): Date {
  return new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate() + daysOffset,
    hour,
    minute,
    0,
    0,
  )
}

function nextWeekdayAt(base: Date, targetWeekday: number, hour: number): Date {
  const current = base.getDay()
  let delta = (targetWeekday - current + 7) % 7
  const candidate = atLocalTime(base, delta, hour, 0)
  if (candidate.getTime() <= base.getTime()) {
    delta += 7
  }
  return atLocalTime(base, delta, hour, 0)
}

function roundUpTo15Minutes(date: Date): Date {
  const roundedMs = Math.ceil(date.getTime() / MS_PER_15M) * MS_PER_15M
  const out = new Date(roundedMs)
  out.setSeconds(0, 0)
  return out
}

function addOneMonthClamped(base: Date, hour: number): Date {
  const targetYear = base.getFullYear()
  const targetMonthIndex = base.getMonth() + 1
  // Day 0 of (targetMonthIndex + 1) is the last day of targetMonthIndex.
  const lastDayOfTargetMonth = new Date(
    targetYear,
    targetMonthIndex + 1,
    0,
  ).getDate()
  const clampedDay = Math.min(base.getDate(), lastDayOfTargetMonth)
  return new Date(targetYear, targetMonthIndex, clampedDay, hour, 0, 0, 0)
}

function dedupePresets(presets: TimePreset[]): TimePreset[] {
  const seenIso = new Set<string>()
  const out: TimePreset[] = []
  for (const preset of presets) {
    if (seenIso.has(preset.iso)) continue
    seenIso.add(preset.iso)
    out.push(preset)
  }
  return out
}

export function buildSnoozePresets(now = new Date()): TimePreset[] {
  const plusThree = roundUpTo15Minutes(
    new Date(now.getTime() + 3 * 60 * 60 * 1000),
  )
  const sixPm = atLocalTime(now, 0, 18, 0)
  const laterToday =
    sixPm.getTime() >= now.getTime() + 60 * 60 * 1000 &&
    sixPm.getTime() < plusThree.getTime()
      ? sixPm
      : plusThree
  const laterTodayLabel =
    calendarDayDiff(laterToday, now) === 0 ? 'Later today' : 'Early tomorrow'

  const tomorrowMorning = atLocalTime(now, 1, 9, 0)
  const thisWeekend = nextWeekdayAt(now, 6, 9) // Saturday 9:00 AM
  const nextWeek = nextWeekdayAt(now, 1, 9) // Monday 9:00 AM
  const nextMonth = addOneMonthClamped(now, 9)

  return dedupePresets([
    {
      id: 'later_today',
      label: laterTodayLabel,
      sublabel: formatShortDateTime(laterToday, now),
      iso: laterToday.toISOString(),
    },
    {
      id: 'tomorrow_morning',
      label: 'Tomorrow morning',
      sublabel: formatShortDateTime(tomorrowMorning, now),
      iso: tomorrowMorning.toISOString(),
    },
    {
      id: 'this_weekend',
      label: 'This weekend',
      sublabel: formatShortDateTime(thisWeekend, now),
      iso: thisWeekend.toISOString(),
    },
    {
      id: 'next_week',
      label: 'Next week',
      sublabel: formatShortDateTime(nextWeek, now),
      iso: nextWeek.toISOString(),
    },
    {
      id: 'next_month',
      label: 'Next month',
      sublabel: formatShortDateTime(nextMonth, now),
      iso: nextMonth.toISOString(),
    },
  ])
}

export function buildScheduleSendPresets(now = new Date()): TimePreset[] {
  const inOneHour = roundUpTo15Minutes(new Date(now.getTime() + 60 * 60 * 1000))

  const fivePm = atLocalTime(now, 0, 17, 0)
  const laterToday =
    fivePm.getTime() > now.getTime() + 30 * 60 * 1000
      ? fivePm
      : roundUpTo15Minutes(new Date(now.getTime() + 3 * 60 * 60 * 1000))
  const laterTodayLabel =
    calendarDayDiff(laterToday, now) === 0 ? 'Later today' : 'Early tomorrow'

  const tomorrowMorning = atLocalTime(now, 1, 9, 0)
  const mondayMorning = nextWeekdayAt(now, 1, 9)

  return dedupePresets([
    {
      id: 'in_1_hour',
      label: 'In 1 hour',
      sublabel: formatShortDateTime(inOneHour, now),
      iso: inOneHour.toISOString(),
    },
    {
      id: 'later_today',
      label: laterTodayLabel,
      sublabel: formatShortDateTime(laterToday, now),
      iso: laterToday.toISOString(),
    },
    {
      id: 'tomorrow_morning',
      label: 'Tomorrow morning',
      sublabel: formatShortDateTime(tomorrowMorning, now),
      iso: tomorrowMorning.toISOString(),
    },
    {
      id: 'monday_morning',
      label: 'Monday morning',
      sublabel: formatShortDateTime(mondayMorning, now),
      iso: mondayMorning.toISOString(),
    },
  ])
}

const FILLER_WORDS = new Set([
  'at',
  'on',
  'in',
  'by',
  'for',
  'until',
  'around',
  'about',
  'the',
])

export function parseNaturalDateTime(
  input: string,
  now = new Date(),
): { iso: string; label: string } | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const results = chrono.parse(trimmed, now, { forwardDate: true })
  if (results.length === 0) return null

  const first = results[0]!
  const matchedText = first.text.trim()
  const remainder = `${trimmed.slice(0, first.index)} ${trimmed.slice(first.index + first.text.length)}`
    .trim()
    .toLowerCase()
  const nonFillerRemainder = remainder
    .split(/\s+/)
    .filter(token => token && !FILLER_WORDS.has(token))

  // Reject incidental matches inside non-date prose (e.g. "may be later" matching "may").
  if (
    nonFillerRemainder.length > 0 &&
    matchedText.length / trimmed.length < 0.6
  ) {
    return null
  }

  const parsed = first.start.date()
  if (!Number.isFinite(parsed.getTime())) return null
  parsed.setSeconds(0, 0)
  if (parsed.getTime() <= now.getTime()) return null
  return {
    iso: parsed.toISOString(),
    label: formatShortDateTime(parsed, now),
  }
}
