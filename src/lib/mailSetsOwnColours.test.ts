import { describe, expect, it } from 'vitest'
import { mailSetsOwnColours } from './mailSetsOwnColours'

describe('mailSetsOwnColours', () => {
  it('is false for a plain message, so it follows the dark reader', () => {
    expect(mailSetsOwnColours('<p>The updated design pass is attached.</p><p>Nadia</p>')).toBe(false)
    expect(mailSetsOwnColours('<p style="margin:0">Spacing is not colour</p>')).toBe(false)
  })

  it('is true for designed mail that paints its own colours, which keeps its light page', () => {
    expect(mailSetsOwnColours('<style>p{color:#333}</style><p>x</p>')).toBe(true)
    expect(mailSetsOwnColours('<table bgcolor="#ffffff"><tr><td>x</td></tr></table>')).toBe(true)
    expect(mailSetsOwnColours('<div style="background-color:#fafafa">x</div>')).toBe(true)
    expect(mailSetsOwnColours("<span style='color: #b00'>x</span>")).toBe(true)
    expect(mailSetsOwnColours('<font color="red">x</font>')).toBe(true)
  })
})
