// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
vi.mock('@purescience/platform-ui/bridge/client', () => ({ bridge: { call: vi.fn() } }))
import { bridge, openCalendarApp } from './platformBridge'
it('requests split placement only for the toolbar action', async () => {
  await openCalendarApp('beside')
  expect(bridge.call).toHaveBeenLastCalledWith('workspace.openApp', [{appSlug: 'calendar', placement: 'beside'}])
  await openCalendarApp()
  expect(bridge.call).toHaveBeenLastCalledWith('workspace.openApp', [{appSlug: 'calendar'}])
})
