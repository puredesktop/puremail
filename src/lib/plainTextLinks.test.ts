import { describe, expect, it } from 'vitest'
import { plainTextSegments } from './plainTextLinks'

const long = 'https://email-link.parentsquare.com/ls/click?upn=u001.w-2Fv-2FxuFWAzcH-2BzcLTPJcq1I4fzlysqcyybQU'

describe('plain-text links', () => {
  it('turns "Label [url]" into a link on the label and drops the URL', () => {
    expect(plainTextSegments(`* Sun hat for garden class [${long}]`)).toEqual([
      { kind: 'text', text: '* ' },
      { kind: 'link', text: 'Sun hat for garden class', href: long },
    ])
  })

  it('takes the line above as the label when the bracket starts its own line', () => {
    expect(plainTextSegments(`Intro sentence.\n* Sun hat for garden class\n[${long}]\nJackie Paz posted`)).toEqual([
      { kind: 'text', text: 'Intro sentence.\n* ' },
      { kind: 'link', text: 'Sun hat for garden class', href: long },
      { kind: 'text', text: '\nJackie Paz posted' },
    ])
  })

  it('gives a bracket with no label a short domain link', () => {
    expect(plainTextSegments(`[${long}]`)).toEqual([
      { kind: 'link', text: 'email-link.parentsquare.com ↗', href: long },
    ])
  })

  it('shows a bare URL as its domain and keeps trailing punctuation outside', () => {
    expect(plainTextSegments('See https://replit.com/@adam394/Pure-Desktop.')).toEqual([
      { kind: 'text', text: 'See ' },
      { kind: 'link', text: 'replit.com/…', href: 'https://replit.com/@adam394/Pure-Desktop' },
      { kind: 'text', text: '.' },
    ])
  })

  it('leaves text without links alone', () => {
    expect(plainTextSegments('Hi Adam,\nthanks.')).toEqual([{ kind: 'text', text: 'Hi Adam,\nthanks.' }])
  })
})
