// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { RecipientChipsInput } from './RecipientChipsInput'
import { demoMailStore } from '../lib/mailStoreData'
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

function setup(): {
  container: HTMLDivElement
  input: HTMLInputElement
  onChange: ReturnType<typeof vi.fn>
} {
  const store = demoMailStore()
  const onChange = vi.fn()
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      <RecipientChipsInput
        value=""
        onChange={onChange}
        store={store}
        accountId={store.accounts[0]!.id}
        ariaLabel="To recipients"
      />,
    )
  })
  return {
    container,
    input: container.querySelector('input')!,
    onChange,
  }
}

function type(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )!.set!
  act(() => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function press(input: HTMLInputElement, key: string): void {
  act(() => {
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    )
  })
}

describe('RecipientChipsInput selection', () => {
  it('survives a double-click on a suggestion (second click hits the chip ×)', () => {
    const { container, input, onChange } = setup()
    type(input, 'a')
    const option = container.querySelector('[role="option"]')!
    act(() => {
      option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      option.dispatchEvent(
        new MouseEvent('click', { bubbles: true, detail: 1 }),
      )
    })
    expect(onChange).toHaveBeenCalledTimes(1)
    // The layout shifted; the double-click's second click lands on the
    // freshly rendered chip's remove button.
    const remove = container.querySelector(
      'button[aria-label^="Remove recipient"]',
    )
    if (remove) {
      act(() => {
        remove.dispatchEvent(
          new MouseEvent('click', { bubbles: true, detail: 2 }),
        )
      })
    }
    // No second onChange wiping the chip.
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('clicking a suggestion commits it as a chip', () => {
    const { container, input, onChange } = setup()
    type(input, 'a')
    const options = container.querySelectorAll('[role="option"]')
    expect(options.length).toBeGreaterThan(0)
    act(() => {
      options[0]!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      options[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(String(onChange.mock.calls[0]![0])).toContain('@')
  })

  it('Enter takes the highlighted suggestion, arrows move the highlight', () => {
    const { container, input, onChange } = setup()
    type(input, 'a')
    const options = container.querySelectorAll('[role="option"]')
    expect(options.length).toBeGreaterThan(1)
    // First is pre-highlighted; ArrowDown moves to the second.
    expect(options[0]!.getAttribute('aria-selected')).toBe('true')
    press(input, 'ArrowDown')
    const after = container.querySelectorAll('[role="option"]')
    expect(after[1]!.getAttribute('aria-selected')).toBe('true')

    press(input, 'Enter')
    expect(onChange).toHaveBeenCalledTimes(1)
    const committed = String(onChange.mock.calls[0]![0])
    expect(committed).toContain(after[1]!.textContent!.split('·')[0]!.trim().slice(0, 4))
  })

  it('Escape dismisses the menu; Enter then commits the raw text', () => {
    const { container, input, onChange } = setup()
    type(input, 'someone@nowhere.example')
    press(input, 'Escape')
    press(input, 'Enter')
    expect(onChange).toHaveBeenCalledWith('someone@nowhere.example')
    expect(container.querySelectorAll('[role="option"]').length).toBe(0)
  })
})
