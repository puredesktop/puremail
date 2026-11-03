// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it } from 'vitest'
import { copyIsKnown, findOutIfHeld, forgetHeldCopyForTest, isHeldCopy } from './heldCopy'

/** Where this frame sits. A normal tab and the Personal agent's page look the same from here; only the shell can tell them apart. */
function sitIn(place: 'alone' | 'shell' | 'another-app') {
  const shell = { name: 'shell' } as unknown as Window
  const parent = place === 'alone' ? window : place === 'shell' ? shell : ({ name: 'room' } as unknown as Window)
  Object.defineProperty(window, 'parent', { value: parent, configurable: true })
  Object.defineProperty(window, 'top', { value: place === 'alone' ? window : shell, configurable: true })
  forgetHeldCopyForTest()
}
beforeEach(() => document.documentElement.removeAttribute('data-held-in-room'))
afterEach(() => sitIn('alone'))

it('outside the shell it is simply the app', () => {
  sitIn('alone')
  expect(copyIsKnown()).toBe(true)
  expect(isHeldCopy()).toBe(false)
})

it('reads as held until the shell has answered, so nothing starts on a guess', async () => {
  sitIn('shell')
  expect(copyIsKnown()).toBe(false)
  expect(isHeldCopy()).toBe(true)
  await findOutIfHeld(async () => null)
  expect(copyIsKnown()).toBe(true)
  expect(isHeldCopy()).toBe(false)
})

it('a normal tab, alone or beside an app in split view, is not held', async () => {
  sitIn('shell')
  await findOutIfHeld(async () => ({}))
  expect(isHeldCopy()).toBe(false)
})

it('on the Personal agent\'s page the frame looks like a tab: only the shell\'s answer says it is held', async () => {
  sitIn('shell')
  expect(window.parent === window.top).toBe(true)
  await findOutIfHeld(async () => ({ heldInRoom: true }))
  expect(isHeldCopy()).toBe(true)
  expect(document.documentElement.hasAttribute('data-held-in-room')).toBe(true)
})

it('inside the Executive room it stays a second copy even when opened straight into its full view', async () => {
  sitIn('another-app')
  await findOutIfHeld(async () => null)
  expect(isHeldCopy()).toBe(true)
})

it('a shell that cannot answer means a normal tab', async () => {
  sitIn('shell')
  await findOutIfHeld(async () => { throw new Error('Unknown method') })
  expect(isHeldCopy()).toBe(false)
})
