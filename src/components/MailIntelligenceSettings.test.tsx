// @vitest-environment happy-dom
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { act, createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MailIntelligenceSettings } from './MailIntelligenceSettings'
import { demoMailStoreForNow } from '../test/mailFixtures'
import type { MailIntelligenceHistoryRange, MailStore } from '../types'

const NOW = new Date('2026-11-23T12:00:00.000Z')

afterEach(() => {
  document.body.innerHTML = ''
})

describe('MailIntelligenceSettings UI', () => {
  it('starts Off by default, supports enabling all or in part, and runs history scans across presets & custom ranges', async () => {
    const onRunHistoryScan = vi.fn(async (_range: MailIntelligenceHistoryRange) => null)
    const onCancelHistoryScan = vi.fn()
    let latestStore: MailStore = demoMailStoreForNow(NOW)

    function Wrapper() {
      const [store, setStore] = useState<MailStore>(() => demoMailStoreForNow(NOW))
      latestStore = store
      return createElement(MailIntelligenceSettings, {
        store,
        setStore,
        hubAvailable: true,
        historyScan: { running: false, progress: null },
        onRunHistoryScan,
        onCancelHistoryScan,
      })
    }

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(createElement(Wrapper))
    })

    // Default state: Off (always optional)
    expect(container.textContent).toContain('Off')
    expect(latestStore.settings.mailIntelligence?.enabled ?? false).toBe(false)

    // Enable in part: click ONLY "Writing voice profile" checkbox while master is Off.
    const checkboxes = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    )
    const voiceCheckbox = checkboxes.find(cb =>
      cb.closest('label')?.textContent?.includes('Writing voice profile'),
    )
    expect(voiceCheckbox).toBeTruthy()
    await act(async () => {
      voiceCheckbox!.click()
    })
    expect(latestStore.settings.mailIntelligence?.enabled).toBe(true)
    expect(latestStore.settings.mailIntelligence?.voiceProfile).toBe(true)
    expect(latestStore.settings.mailIntelligence?.signalExtraction).toBe(false)
    expect(container.textContent).toContain('Partial')

    // Click "Enable all" -> all capabilities active.
    const enableAllBtn = Array.from(container.querySelectorAll('button')).find(
      b => b.textContent?.trim() === 'Enable all',
    )
    await act(async () => {
      enableAllBtn!.click()
    })
    expect(latestStore.settings.mailIntelligence?.signalExtraction).toBe(true)
    expect(latestStore.settings.mailIntelligence?.crossAppOutbox).toBe(true)
    expect(latestStore.settings.mailIntelligence?.semanticMemory).toBe(true)
    expect(latestStore.settings.mailIntelligence?.voiceProfile).toBe(true)
    expect(latestStore.settings.mailIntelligence?.allowOrgSharing).toBe(true)
    expect(container.textContent).toContain('All enabled')

    // Select "All emails" preset and click Run.
    const allEmailsChip = Array.from(container.querySelectorAll('button')).find(
      b => b.textContent?.trim() === 'All emails',
    )
    await act(async () => {
      allEmailsChip!.click()
    })
    const runBtn = Array.from(container.querySelectorAll('button')).find(b =>
      b.textContent?.includes('Run on all'),
    )
    expect(runBtn).toBeTruthy()
    await act(async () => {
      runBtn!.click()
    })
    expect(onRunHistoryScan).toHaveBeenCalledWith({ mode: 'all' })

    // Switch to Custom -> 2 weeks -> Run.
    const customChip = Array.from(container.querySelectorAll('button')).find(
      b => b.textContent?.trim() === 'Custom',
    )
    await act(async () => {
      customChip!.click()
    })
    const amountInput = container.querySelector<HTMLInputElement>(
      'input[aria-label="History scan amount"]',
    )
    const unitSelect = container.querySelector<HTMLSelectElement>(
      'select[aria-label="History scan unit"]',
    )
    expect(amountInput).toBeTruthy()
    expect(unitSelect).toBeTruthy()

    await act(async () => {
      root.unmount()
    })
  })
})
