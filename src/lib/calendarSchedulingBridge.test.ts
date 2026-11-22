import { describe, expect, it, vi } from 'vitest'
import { formatInviteMultiZoneSummary, formatMailAvailabilitySnippet } from './calendarSchedulingBridge'
import { takeComposeIntents, takeRichComposeIntent } from './composeIntents'
import * as platformBridge from '../bridge/platformBridge'

describe('PureMail ↔ PureCalendar scheduling & multi-timezone integration', () => {
  it('formats dual-timezone availability snippet with booking link for email insertion', () => {
    const text = formatMailAvailabilitySnippet({
      slots: [{ start: '2026-11-24T17:00:00.000Z', end: '2026-11-24T17:30:00.000Z' }],
      hostTimeZone: 'America/Los_Angeles',
      recipientTimeZone: 'Europe/London',
      bookingUrl: 'https://cloud.pure.test/book/ada/intro',
    })
    expect(text).toContain('Europe/London')
    expect(text).toContain('5:00')
    expect(text).toContain('9:00')
    expect(text).toContain('https://cloud.pure.test/book/ada/intro')
  })

  it('shows both viewer local time and organizer timezone on inbound invite cards when they differ', () => {
    const summary = formatInviteMultiZoneSummary({
      startsAt: '2026-11-24T17:00:00.000Z',
      endsAt: '2026-11-24T18:00:00.000Z',
      inviteTimeZone: 'Europe/London',
      viewerTimeZone: 'America/Los_Angeles',
    })
    expect(summary.primary).toContain('9:00')
    expect(summary.secondary).toContain('Organizer time:')
    expect(summary.secondary).toContain('Europe/London')

    const same = formatInviteMultiZoneSummary({
      startsAt: '2026-11-24T17:00:00.000Z',
      endsAt: '2026-11-24T18:00:00.000Z',
      inviteTimeZone: 'Europe/London',
      viewerTimeZone: 'Europe/London',
    })
    expect(same.secondary).toBeNull()
  })

  it('consumes rich compose intents from PureCalendar (to, cc, subject, body, .ics attachment) while preserving legacy to-only intents', async () => {
    vi.spyOn(platformBridge, 'readPlatformStorageJson').mockResolvedValueOnce({
      value: {
        entries: {
          cal_1: {
            to: [{ email: 'kai@tokyo.test' }],
            cc: [{ email: 'clara@berlin.test' }],
            subject: 'Proposed times: Architecture Sync',
            body: 'Pick a slot: https://cloud.pure.test/book/i/abc',
            attachments: [
              {
                id: 'ics_1',
                name: 'invite.ics',
                mimeType: 'text/calendar; method=REQUEST',
                sizeLabel: '1 KB',
                contentBase64: 'QkVHSU46VkNBTEVOREFS',
              },
            ],
          },
        },
      },
      version: 'v1',
    })
    vi.spyOn(platformBridge, 'writePlatformStorageJson').mockResolvedValueOnce({ conflict: false, version: 'v2' })

    const intent = await takeRichComposeIntent()
    expect(intent).not.toBeNull()
    expect(intent?.to).toEqual(['kai@tokyo.test'])
    expect(intent?.cc).toEqual(['clara@berlin.test'])
    expect(intent?.subject).toBe('Proposed times: Architecture Sync')
    expect(intent?.body).toContain('https://cloud.pure.test/book/i/abc')
    expect(intent?.attachments[0]?.name).toBe('invite.ics')
    expect(intent?.attachments[0]?.content).toBe('QkVHSU46VkNBTEVOREFS')

    vi.spyOn(platformBridge, 'readPlatformStorageJson').mockResolvedValueOnce({
      value: { entries: { p_1: { to: [{ email: 'mira@example.com' }] } } },
      version: 'v2',
    })
    vi.spyOn(platformBridge, 'writePlatformStorageJson').mockResolvedValueOnce({ conflict: false, version: 'v3' })
    expect(await takeComposeIntents()).toEqual(['mira@example.com'])
  })
})
