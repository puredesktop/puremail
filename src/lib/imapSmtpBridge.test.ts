import { expect, it, vi } from 'vitest'
import { bridge } from '@purescience/platform-ui/bridge/client'
import { bridgeSmtpTransport } from './imapMailProvider'
const config = {
  profileId: 'audit',
  imap: { host: 'localhost', port: 3143, security: 'none' as const },
  smtp: { host: 'localhost', port: 3025, security: 'none' as const },
  username: 'adam',
  passwordSecretKey: 'imap-password.audit',
}

it.each(['not_sent', 'uncertain'] as const)(
  'preserves the shell %s outcome for the delivery controller',
  async outcome => {
    const call = vi
      .spyOn(bridge, 'call')
      .mockResolvedValue({ ok: false, outcome, error: 'SMTP test error' })
    try {
      await expect(
        bridgeSmtpTransport(config).send('mime', 'adam@example.com', [
          'mira@example.com',
        ]),
      ).rejects.toMatchObject({ outcome, message: 'SMTP test error' })
    } finally {
      call.mockRestore()
    }
  },
)
it('does not light the connection indicator for a rejected verification', async () => {
  const call = vi
    .spyOn(bridge, 'call')
    .mockResolvedValue({
      ok: false,
      outcome: 'not_sent',
      error: 'Authentication rejected',
    })
  try {
    await expect(bridgeSmtpTransport(config).verify!()).rejects.toThrow(
      'Authentication rejected',
    )
  } finally {
    call.mockRestore()
  }
})
it('treats a malformed or missing transport receipt as uncertain', async () => {
  const call = vi.spyOn(bridge, 'call').mockResolvedValue(undefined)
  try {
    await expect(
      bridgeSmtpTransport(config).send('mime', 'adam@example.com', [
        'mira@example.com',
      ]),
    ).rejects.toMatchObject({
      outcome: 'uncertain',
      message: expect.stringContaining('no send confirmation'),
    })
  } finally {
    call.mockRestore()
  }
})
it('preserves rejected recipients from a partially accepted submission', async () => {
  const call = vi
    .spyOn(bridge, 'call')
    .mockResolvedValue({
      ok: true,
      accepted: ['adam@example.com'],
      rejected: ['rejected@example.com'],
    })
  try {
    await expect(
      bridgeSmtpTransport(config).send('mime', 'adam@example.com', [
        'adam@example.com',
        'rejected@example.com',
      ]),
    ).resolves.toEqual({ rejected: ['rejected@example.com'] })
  } finally {
    call.mockRestore()
  }
})
