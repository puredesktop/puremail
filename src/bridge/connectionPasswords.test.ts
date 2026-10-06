import { afterEach, describe, expect, it, vi } from 'vitest'
import { bridge, PLATFORM_BRIDGE_METHODS } from '@purescience/platform-ui/bridge/client'
import { saveConnectionPasswords } from './platformBridge'

afterEach(() => vi.restoreAllMocks())
describe('saving connection passwords', () => {
  it('preserves both protocol passwords in a read-modify-write vault', async () => {
    let vault: Record<string, string> = {}
    vi.spyOn(bridge, 'call').mockImplementation(async (method, args) => {
      if (method === PLATFORM_BRIDGE_METHODS.SECRETS_STATUS) return { weak: false, encryptionAvailable: true, backend: 'test' }
      const { key, value } = args![0] as { key: string; value: string }
      const snapshot = { ...vault }
      await new Promise(resolve => setTimeout(resolve, 1))
      vault = { ...snapshot, [key]: value }
      return { ok: true }
    })
    await saveConnectionPasswords('example', 'incoming-fixture', 'outgoing-fixture')
    expect(vault).toEqual({ 'imap-password.example': 'incoming-fixture', 'smtp-password.example': 'outgoing-fixture' })
  })
  it('stops after a failed save instead of reporting a completed pair', async () => {
    const call = vi.spyOn(bridge, 'call').mockImplementation(async method => {
      if (method === PLATFORM_BRIDGE_METHODS.SECRETS_STATUS) return { weak: false, encryptionAvailable: true, backend: 'test' }
      throw new Error('Vault unavailable')
    })
    await expect(saveConnectionPasswords('example', 'incoming-fixture', 'outgoing-fixture')).rejects.toThrow('Vault unavailable')
    expect(call.mock.calls.filter(([method]) => method === PLATFORM_BRIDGE_METHODS.SECRETS_SET)).toHaveLength(1)
  })
  it('never writes passwords when encryption is unavailable even if weak is absent', async () => {
    const call = vi.spyOn(bridge, 'call').mockResolvedValue({ encryptionAvailable: false, backend: 'unknown' })
    await expect(saveConnectionPasswords('example', 'incoming-fixture')).rejects.toThrow('secure keystore')
    expect(call.mock.calls.filter(([method]) => method === PLATFORM_BRIDGE_METHODS.SECRETS_SET)).toHaveLength(0)
  })

})
