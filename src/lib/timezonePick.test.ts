import { describe, expect, it } from 'vitest'
import { guessZone, searchZones, zoneChoices, zoneNamedIn } from './timezonePick'

const choices = zoneChoices(['Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'Asia/Kolkata', 'Pacific/Auckland', 'Australia/Sydney', 'America/Lima'])

describe('picking a timezone', () => {
  it('lists zones by city and region, found by their aliases', () => {
    expect(choices.find(c => c.zone === 'Europe/London')?.label).toBe('London (Europe)')
    expect(searchZones(choices, 'uk')[0]?.zone).toBe('Europe/London')
    expect(searchZones(choices, 'New Y')[0]?.zone).toBe('America/New_York')
    expect(searchZones(choices, 'eastern')[0]?.zone).toBe('America/New_York')
    expect(searchZones(choices, 'nz')[0]?.zone).toBe('Pacific/Auckland')
    expect(searchZones(choices, 'ind')[0]?.zone).toBe('Asia/Kolkata')
    expect(searchZones(choices, '')).toEqual([])
  })

  it('guesses the zone from the words around a time, then from the email', () => {
    expect(zoneNamedIn('that is at 2pm UK and quite local')).toMatchObject({ zone: 'Europe/London', from: 'uk' })
    expect(zoneNamedIn('9am Eastern')).toMatchObject({ zone: 'America/New_York', ambiguous: true })
    expect(zoneNamedIn('meet in New York at 9')).toMatchObject({ zone: 'America/New_York', from: 'new york' })
    expect(zoneNamedIn('the South Africa office')).toMatchObject({ zone: 'Africa/Johannesburg' })
    // A tiny word only counts beside a time: "la" in "la carte" is not Los Angeles.
    expect(zoneNamedIn('an à la carte menu')).toBeNull()
    expect(zoneNamedIn('at 3pm LA')).toMatchObject({ zone: 'America/Los_Angeles' })
    const email = 'Hi,\nOK – this week is a PITA.\nthat is at 2pm UK and quite local – so I should be OK for our call at 5pm. I will ping you.\nSent the invite.'
    expect(guessZone(email, { text: '5pm', index: email.indexOf('5pm') })).toMatchObject({ zone: 'Europe/London', from: 'uk' })
    expect(guessZone('Nothing here at 3pm.', { text: '3pm', index: 16 })).toBeNull()
  })
})
