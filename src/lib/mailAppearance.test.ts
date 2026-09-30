// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { installMailAppearance } from './mailAppearance'

const tick = () => new Promise(resolve => setTimeout(resolve, 0))

describe('mail appearance', () => {
  let stop: (() => void) | null = null
  afterEach(() => {
    stop?.()
    document.documentElement.removeAttribute('data-platform-appearance')
    document.documentElement.removeAttribute('data-mail-appearance')
    document.documentElement.removeAttribute('data-platform-theme')
  })

  it('renders Glass as the shared White in light mode and keeps the choice', async () => {
    const root = document.documentElement
    root.setAttribute('data-platform-theme', 'light')
    root.setAttribute('data-platform-appearance', 'glass')
    stop = installMailAppearance(root)
    await tick()
    expect(root.getAttribute('data-platform-appearance')).toBe('white')
    expect(root.getAttribute('data-mail-appearance')).toBe('glass')
  })

  it('marks White for the neutral greys and follows a later switch', async () => {
    const root = document.documentElement
    root.setAttribute('data-platform-theme', 'light')
    root.setAttribute('data-platform-appearance', 'glass')
    stop = installMailAppearance(root)
    await tick()
    root.setAttribute('data-platform-appearance', 'white')
    await tick()
    expect(root.getAttribute('data-mail-appearance')).toBe('white')
    expect(root.getAttribute('data-platform-appearance')).toBe('white')
    root.setAttribute('data-platform-appearance', 'glass')
    await tick()
    expect(root.getAttribute('data-mail-appearance')).toBe('glass')
    expect(root.getAttribute('data-platform-appearance')).toBe('white')
  })

  it('leaves dark mode as the frame sets it', async () => {
    const root = document.documentElement
    root.setAttribute('data-platform-theme', 'dark')
    root.setAttribute('data-platform-appearance', 'glass')
    stop = installMailAppearance(root)
    await tick()
    expect(root.getAttribute('data-platform-appearance')).toBe('glass')
    root.setAttribute('data-platform-theme', 'light')
    await tick()
    expect(root.getAttribute('data-platform-appearance')).toBe('white')
  })
})
