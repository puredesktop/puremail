import { describe, expect, it } from 'vitest'
import { MailSettings } from '../types'
import {
  normalizeSenderEmail,
  remoteImageBannerState,
  remoteImageDecision,
  setRemoteImagePolicy,
  trustSender,
  untrustSender,
} from './remoteImagePolicy'

const baseSettings: MailSettings = {
  autoDraftVoiceEngine: 'local-retrieval',
  signature: 'Best,\nAdam',
}

describe('normalizeSenderEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeSenderEmail('  News@Example.COM ')).toBe(
      'news@example.com',
    )
  })

  it('handles missing input', () => {
    expect(normalizeSenderEmail(undefined)).toBe('')
  })
})

describe('remoteImageDecision', () => {
  const decide = (
    overrides: Partial<Parameters<typeof remoteImageDecision>[0]> = {},
  ) =>
    remoteImageDecision({
      settings: baseSettings,
      senderEmail: 'news@example.com',
      messageId: 'msg-1',
      onceLoadedIds: [],
      ...overrides,
    })

  it('blocks by default — missing remoteImages means ask', () => {
    expect(decide()).toEqual({ load: false, reason: 'blocked' })
  })

  it('blocks when settings themselves are missing', () => {
    expect(decide({ settings: undefined })).toEqual({
      load: false,
      reason: 'blocked',
    })
  })

  it('loads for the once-loaded message only', () => {
    expect(decide({ onceLoadedIds: ['msg-1'] })).toEqual({
      load: true,
      reason: 'once',
    })
    expect(decide({ onceLoadedIds: ['msg-2'] })).toEqual({
      load: false,
      reason: 'blocked',
    })
  })

  it('loads for a trusted sender, matching after normalization', () => {
    const settings = {
      ...baseSettings,
      remoteImages: { policy: 'ask' as const, trustedSenders: ['News@Example.com '] },
    }
    expect(decide({ settings, senderEmail: ' NEWS@example.COM' })).toEqual({
      load: true,
      reason: 'trusted-sender',
    })
    expect(decide({ settings, senderEmail: 'other@example.com' })).toEqual({
      load: false,
      reason: 'blocked',
    })
  })

  it('never matches an empty sender against the trusted list', () => {
    const settings = {
      ...baseSettings,
      remoteImages: { policy: 'ask' as const, trustedSenders: ['', '  '] },
    }
    expect(decide({ settings, senderEmail: '' })).toEqual({
      load: false,
      reason: 'blocked',
    })
  })

  it('policy always outranks trusted sender, which outranks once', () => {
    const settings = {
      ...baseSettings,
      remoteImages: {
        policy: 'always' as const,
        trustedSenders: ['news@example.com'],
      },
    }
    expect(decide({ settings, onceLoadedIds: ['msg-1'] })).toEqual({
      load: true,
      reason: 'policy-always',
    })
    expect(
      decide({
        settings: {
          ...baseSettings,
          remoteImages: {
            policy: 'ask' as const,
            trustedSenders: ['news@example.com'],
          },
        },
        onceLoadedIds: ['msg-1'],
      }),
    ).toEqual({ load: true, reason: 'trusted-sender' })
  })
})

describe('trustSender / untrustSender', () => {
  it('adds a normalized sender and defaults policy explicitly to ask', () => {
    const next = trustSender(baseSettings, ' News@Example.COM ')
    expect(next.remoteImages).toEqual({
      policy: 'ask',
      trustedSenders: ['news@example.com'],
    })
    expect(next).not.toBe(baseSettings)
    expect(baseSettings.remoteImages).toBeUndefined()
  })

  it('dedupes an already-trusted sender', () => {
    const once = trustSender(baseSettings, 'news@example.com')
    const twice = trustSender(once, 'NEWS@example.com')
    expect(twice.remoteImages?.trustedSenders).toEqual(['news@example.com'])
  })

  it('ignores an empty email', () => {
    expect(trustSender(baseSettings, '   ')).toBe(baseSettings)
  })

  it('keeps an existing always policy when trusting', () => {
    const always = setRemoteImagePolicy(baseSettings, 'always')
    const next = trustSender(always, 'news@example.com')
    expect(next.remoteImages?.policy).toBe('always')
  })

  it('removes a sender, matching after normalization', () => {
    const trusted = trustSender(baseSettings, 'news@example.com')
    const next = untrustSender(trusted, ' NEWS@Example.com')
    expect(next.remoteImages).toEqual({ policy: 'ask', trustedSenders: [] })
    expect(trusted.remoteImages?.trustedSenders).toEqual(['news@example.com'])
  })

  it('untrusting an unknown sender leaves the rest of the list intact', () => {
    const trusted = trustSender(baseSettings, 'news@example.com')
    const next = untrustSender(trusted, 'other@example.com')
    expect(next.remoteImages?.trustedSenders).toEqual(['news@example.com'])
  })
})

describe('setRemoteImagePolicy', () => {
  it('sets always and back to ask with explicit values, keeping the list', () => {
    const trusted = trustSender(baseSettings, 'news@example.com')
    const always = setRemoteImagePolicy(trusted, 'always')
    expect(always.remoteImages).toEqual({
      policy: 'always',
      trustedSenders: ['news@example.com'],
    })
    const ask = setRemoteImagePolicy(always, 'ask')
    // "Off" is an explicit value: spread-merge persistence cannot delete keys.
    expect(ask.remoteImages).toEqual({
      policy: 'ask',
      trustedSenders: ['news@example.com'],
    })
  })
})

describe('remoteImageBannerState', () => {
  it('blocked offers no single reverse action (the selector renders instead)', () => {
    expect(
      remoteImageBannerState(
        { load: false, reason: 'blocked' },
        'news@example.com',
      ),
    ).toEqual({
      label: 'Remote images blocked for privacy',
      actionLabel: null,
    })
  })

  it('once loaded keeps the existing wording', () => {
    expect(
      remoteImageBannerState({ load: true, reason: 'once' }, 'a@b.c'),
    ).toEqual({ label: 'Remote images loaded', actionLabel: 'Block images' })
  })

  it('trusted sender names the sender', () => {
    expect(
      remoteImageBannerState(
        { load: true, reason: 'trusted-sender' },
        ' News@Example.com',
      ),
    ).toEqual({
      label: 'Images load automatically for news@example.com',
      actionLabel: 'Block for this sender',
    })
  })

  it('policy always says so and offers turn off', () => {
    expect(
      remoteImageBannerState(
        { load: true, reason: 'policy-always' },
        'news@example.com',
      ),
    ).toEqual({
      label: 'Images load automatically (all senders)',
      actionLabel: 'Turn off',
    })
  })
})
