import { expect, it } from 'vitest'
import { inviteDescriptionParagraphs } from './inviteDescription'

it('turns a flattened Teams invitation into readable details without changing destinations', () => {
  const join = 'https://teams.microsoft.com/meet/287944914944831?p=secret'
  const options = 'https://teams.microsoft.com/meetingOptions/?organizerId=abc&context=long'
  const text = `________ Microsoft Teams meeting Join: ${join} Meeting ID: 287 944 941 944 831 Passcode: 6dn68wH9 ________ Need help? <https://aka.ms/JoinTeamsMeeting?omkt=en-US> System reference<https://teams.microsoft.com/l/meetup-join/abc?context=xyz> Dial in by phone +1 213-267-0106,,97943826# <tel:+12132670106,,97943826#> United States, Los Angeles Find a local number<https://dialin.teams.microsoft.com/abc?id=97943826> Phone conference ID: 979 438 26# For organizers: Meeting options<${options}>` 
  const paragraphs = inviteDescriptionParagraphs(text)
  const links = paragraphs.flat().filter(s => s.kind === 'link')
  expect(links.map(s => s.href)).toContain(join)
  expect(links.map(s => s.href)).toContain(options)
  expect(links.map(s => s.text)).toContain('Join Microsoft Teams meeting')
  expect(links.map(s => s.text)).toContain('Meeting options')
  expect(paragraphs.some(p => p[0]?.text === 'Meeting ID: 287 944 941 944 831')).toBe(true)
  expect(paragraphs.some(p => p[0]?.text === 'Passcode: 6dn68wH9')).toBe(true)
  expect(paragraphs.flat().map(s => s.text).join(' ')).toContain('United States, Los Angeles')
  expect(paragraphs.flat().map(s => s.text).join(' ')).not.toContain('________')
})

it('preserves ordinary descriptions, line breaks and arbitrary web links', () => {
  const paragraphs = inviteDescriptionParagraphs('Bring the draft.\nReview budget and timing.\nNotes [https://example.test/notes?one=1&two=2]')
  expect(paragraphs).toHaveLength(3)
  expect(paragraphs[0]).toEqual([{ kind: 'text', text: 'Bring the draft.' }])
  expect(paragraphs[2]?.[1]).toEqual({ kind: 'link', text: 'example.test', href: 'https://example.test/notes?one=1&two=2' })
})

it('keeps unsafe markup as text rather than producing an executable link', () => {
  const segments = inviteDescriptionParagraphs('<script>alert(1)</script> <javascript:alert(1)>').flat()
  expect(segments.every(s => s.kind === 'text')).toBe(true)
})
