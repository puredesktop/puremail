import { expect, it } from 'vitest'
import { demoMailStore } from '../test/mailFixtures'
import { hasConnectionSmtpPassword, hasSavedMailConnection } from './mailConnectionPasswords'
it('retains a saved SMTP password when a connector is re-saved without editing its profile', () => {
 const settings = demoMailStore().settings
 settings.connectionProfiles = [{ id: 'proton_user', provider: 'proton-bridge', label: 'Proton', description: 'Local Bridge', mode: 'bridge', status: 'ready', hasSmtpPassword: true }]
 expect(hasConnectionSmtpPassword(settings, 'proton_user', '')).toBe(true)
 expect(hasConnectionSmtpPassword(settings, 'another_user', '')).toBe(false)
})
it('retains an active legacy account flag and enables a supplied replacement', () => {
 const settings = demoMailStore().settings
 settings.imapAccount = { profileId: 'proton_user', active: true, hasSmtpPassword: true } as never
 expect(hasConnectionSmtpPassword(settings, 'proton_user', '')).toBe(true)
 expect(hasConnectionSmtpPassword(settings, 'another_user', 'new-fixture')).toBe(true)
})

it('requires fresh credentials when re-adding a removed connection with an inactive tombstone', () => {
 const settings = demoMailStore().settings
 settings.connectionProfiles = []
 settings.imapAccount = { profileId: 'proton_user', active: false, hasSmtpPassword: true } as never
 expect(hasSavedMailConnection(settings, 'proton_user')).toBe(false)
 expect(hasConnectionSmtpPassword(settings, 'proton_user', '')).toBe(false)
})
