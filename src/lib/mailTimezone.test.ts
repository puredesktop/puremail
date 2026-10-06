import { describe, expect, it } from 'vitest'
import { convertTime, emailTimes } from './mailTimezone'
describe('reader timezone conversion', () => {
  it('extracts multiple time mentions and ranges without date-only false positives', () => {
    const times = emailTimes('Tomorrow at 3pm UTC, then October 8, 2026 from 9am to 11am PST. Report dated October 10.', '2026-10-06T12:00:00Z')
    expect(times).toHaveLength(2)
    expect(times[0]).toMatchObject({ date: '2026-10-07', hour: 15, offset: 0 })
    expect(times[1]?.end).toMatchObject({ hour: 11 })
  })
  it('requires a source zone for unzoned mentions', () => {
    expect(emailTimes('At 3pm', '2026-10-06T12:00:00Z')[0]?.offset).toBeNull()
    expect(() => convertTime('2026-10-06', 15, 0, '', null, 'UTC')).toThrow('source timezone')
  })
  it('converts explicit offsets with day rollover', () => {
    expect(convertTime('2026-10-06', 1, 30, '', 330, 'UTC')).toContain('5')
    expect(convertTime('2026-10-06', 1, 30, '', 330, 'UTC')).toContain('8:00')
  })
  it('uses seasonal IANA offsets independently of the computer timezone', () => {
    expect(convertTime('2026-07-10', 15, 0, 'America/New_York', null, 'UTC')).toContain('7:00')
    expect(convertTime('2026-01-10', 15, 0, 'America/New_York', null, 'UTC')).toContain('8:00')
  })
  it('rejects DST gaps and overlaps', () => {
    expect(() => convertTime('2026-03-08', 2, 30, 'America/New_York', null, 'UTC')).toThrow('does not exist')
    expect(() => convertTime('2026-11-01', 1, 30, 'America/New_York', null, 'UTC')).toThrow('twice')
  })
  it('handles invalid input and missing message dates', () => {
    expect(emailTimes('at 3pm', '')).toEqual([])
    expect(() => convertTime('2026-02-30', 1, 0, '', 0, 'UTC')).toThrow('valid date')
  })
})
