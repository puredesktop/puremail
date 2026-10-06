// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { usePureMailBoot } from './usePureMailBoot'

const google = vi.hoisted(() => vi.fn())
const persisted = vi.hoisted(() => vi.fn())
vi.mock('../lib/mailPersistence', () => ({ readPersistedMailStore: persisted }))
vi.mock('../bridge/platformBridge', async importOriginal => ({
  ...await importOriginal<typeof import('../bridge/platformBridge')>(),
  fetchGoogleCredentialStatus: google,
}))
import { createBootProvider, PUREMAIL_LOCAL_SETTINGS_KEY } from './usePureMailBoot'

beforeEach(() => {
  localStorage.clear()
  google.mockReset()
  persisted.mockResolvedValue({ store: null })
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

it('restores disk-saved IMAP-family accounts when browser settings are absent', async () => {
  const { emptyMailStore } = await import('../lib/mailModel')
  for (const profileId of ['proton_user', 'gmailimap_user', 'imap_user']) {
    const store = emptyMailStore()
    store.settings.imapAccount = {
      active: true, profileId, email: 'user@example.test', label: 'Saved account', username: 'saved-user',
      imap: { host: '127.0.0.1', port: 1143, security: 'starttls' },
      smtp: { host: '127.0.0.1', port: 1025, security: 'starttls' }, hasSmtpPassword: true,
    }
    const boot = await createBootProvider(store)
    expect(boot.source).toBe('imap')
  }
  expect(google).not.toHaveBeenCalled()
})

it('honors an explicit local deactivation over a stale disk account', async () => {
  const { emptyMailStore } = await import('../lib/mailModel')
  const store = emptyMailStore()
  store.settings.imapAccount = { active: true, profileId: 'proton' } as never
  localStorage.setItem(PUREMAIL_LOCAL_SETTINGS_KEY, JSON.stringify({ imapAccount: { active: false, profileId: 'proton' } }))
  google.mockResolvedValue({ connected: true })
  expect((await createBootProvider(store)).source).toBe('gmail')
})

it('keeps Gmail as the provider when its token needs reconnecting', async () => {
  google.mockResolvedValue({ connected: false, configured: true, needsReconnect: true })
  const boot = await createBootProvider(null)
  expect(boot.source).toBe('gmail')
  expect(boot.notice).toContain('reconnect')
})

it('boots cached mail while offline and rereads changed account settings on reboot', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const { emptyMailStore } = await import('../lib/mailModel')
  const store = emptyMailStore()
  store.settings.imapAccount = {
    active: true, profileId: 'proton', email: 'user@example.test', label: 'Proton', username: 'bridge-user',
    imap: { host: '127.0.0.1', port: 1143, security: 'starttls' }, smtp: { host: '127.0.0.1', port: 1025, security: 'starttls' },
  }
  persisted.mockResolvedValue({ store })
  let state!: ReturnType<typeof usePureMailBoot>
  function Probe() { state = usePureMailBoot(true); return null }
  const host = document.createElement('div'); const root = createRoot(host)
  try {
    await act(async () => root.render(createElement(Probe)))
    expect(state.boot?.provider).toBe('imap')
    expect(state.boot?.syncOnMount).toBe(true)
    expect(state.bootError).toBeNull()
    const firstBoot = state.boot!.bootId
    store.settings.imapAccount = { ...store.settings.imapAccount, profileId: 'imap-new' }
    await act(async () => state.rebootMail())
    expect(state.boot?.store.settings.imapAccount?.profileId).toBe('imap-new')
    expect(state.boot!.bootId).toBeGreaterThan(firstBoot)
    expect(google).not.toHaveBeenCalled()
  } finally { await act(async () => root.unmount()) }
})

it('keeps cached Gmail connected to its provider when credential status is temporarily unavailable', async () => {
 const { emptyMailStore } = await import('../lib/mailModel')
 const store = emptyMailStore()
 store.accounts = [{ id: 'gmail', provider: 'gmail', name: 'User', email: 'user@example.test', syncState: 'offline' }]
 google.mockRejectedValue(new Error('Keystore temporarily locked'))
 const boot = await createBootProvider(store)
 expect(boot.source).toBe('gmail')
 expect(boot.notice).toContain('Showing saved Gmail')
})
it('falls back to disk settings after corrupt browser settings without logging their contents', async () => {
 const { emptyMailStore } = await import('../lib/mailModel')
 const store = emptyMailStore()
 store.settings.imapAccount = { active: true, profileId: 'proton', email: 'user@example.test', label: 'Proton', username: 'user', imap: { host: 'localhost', port: 1143, security: 'starttls' }, smtp: { host: 'localhost', port: 1025, security: 'starttls' } }
 localStorage.setItem(PUREMAIL_LOCAL_SETTINGS_KEY, '{"google":"sensitive-fixture"')
 const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
 try {
  expect((await createBootProvider(store)).source).toBe('imap')
  expect(JSON.stringify(warn.mock.calls)).not.toContain('sensitive-fixture')
 } finally { warn.mockRestore() }
})
