// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest'

const google = vi.hoisted(() => vi.fn())
vi.mock('../bridge/platformBridge', async importOriginal => ({
  ...await importOriginal<typeof import('../bridge/platformBridge')>(),
  fetchGoogleCredentialStatus: google,
}))
import { createBootProvider, PUREMAIL_LOCAL_SETTINGS_KEY } from './usePureMailBoot'

beforeEach(() => {
  localStorage.clear()
  google.mockReset()
})

it('boots active Proton Bridge without touching a broken Google credential', async () => {
  google.mockRejectedValue(new Error('Google keychain is locked'))
  localStorage.setItem(PUREMAIL_LOCAL_SETTINGS_KEY, JSON.stringify({
    imapAccount: {
      active: true, profileId: 'proton', email: 'user@example.test',
      label: 'Proton Bridge', username: 'bridge-user',
      imap: { host: '127.0.0.1', port: 1143 },
      smtp: { host: '127.0.0.1', port: 1025 },
    },
  }))
  const boot = await createBootProvider()
  expect(boot.source).toBe('imap')
  expect(google).not.toHaveBeenCalled()
})

it('still checks Google when no IMAP account is active', async () => {
  google.mockResolvedValue({ connected: true, email: 'user@example.test' })
  const boot = await createBootProvider()
  expect(boot.source).toBe('gmail')
  expect(google).toHaveBeenCalledOnce()
})
