import { describe, expect, it } from 'vitest'
import { mailProviderSupports } from './mailProviderCapabilities'

describe('mailProviderSupports', () => {
  it('treats a declared true flag as supported', () => {
    expect(
      mailProviderSupports({ capabilities: { compose: true } }, 'compose'),
    ).toBe(true)
  })

  it('treats false, missing flags, missing maps, and missing providers as unsupported', () => {
    expect(
      mailProviderSupports({ capabilities: { compose: false } }, 'compose'),
    ).toBe(false)
    expect(mailProviderSupports({ capabilities: {} }, 'bulkActions')).toBe(
      false,
    )
    expect(mailProviderSupports({}, 'labels')).toBe(false)
    expect(mailProviderSupports(null, 'drafts')).toBe(false)
    expect(mailProviderSupports(undefined, 'compose')).toBe(false)
  })

  it('never treats truthy non-boolean values as supported', () => {
    expect(
      mailProviderSupports(
        { capabilities: { labels: 'yes' as unknown as boolean } },
        'labels',
      ),
    ).toBe(false)
  })
})
