import { afterEach, describe, expect, it } from 'vitest'
import {
  mailCommandForKey,
  mailCommands,
  mailCommandsForQuery,
  mailShortcutCommandForEvent,
  mailShortcutTargetIsTyping,
} from './mailCommands'

describe('PureMail commands', () => {
  it('defines keyboard-visible thread and task pane commands', () => {
    expect(
      mailCommands.some(
        command => command.id === 'archive' && command.scope === 'thread',
      ),
    ).toBe(true)
    expect(
      mailCommands.some(
        command =>
          command.id === 'thread-tasks' && command.scope === 'task-pane',
      ),
    ).toBe(true)
  })

  it('resolves shortcuts case-insensitively', () => {
    expect(mailCommandForKey('E')).toBe('archive')
    expect(mailCommandForKey('s')).toBe('snooze-follow-up')
    expect(mailCommandForKey('3')).toBe('follow-ups')
    expect(mailCommandForKey('Escape')).toBeNull()
  })

  it('binds the Gmail-style triage keys', () => {
    expect(mailCommandForKey('a')).toBe('reply-all')
    expect(mailCommandForKey('j')).toBe('next-thread')
    expect(mailCommandForKey('k')).toBe('previous-thread')
    expect(mailCommandForKey('e')).toBe('archive')
    expect(mailCommandForKey('r')).toBe('reply')
    expect(mailCommandForKey('f')).toBe('forward')
    expect(mailCommandForKey('c')).toBe('compose')
    expect(mailCommandForKey('/')).toBe('focus-search')
    expect(mailCommandForKey('u')).toBe('toggle-unread')
    expect(mailCommandForKey('#')).toBe('trash')
    // '#' (shift+3) and '3' are distinct keys with distinct commands.
    expect(mailCommandForKey('3')).toBe('follow-ups')
  })

  it('finds executable commands from command bar queries', () => {
    expect(
      mailCommandsForQuery('archive').map(command => command.id),
    ).toContain('archive')
    expect(mailCommandsForQuery('follow').map(command => command.id)).toEqual(
      expect.arrayContaining(['snooze-follow-up', 'follow-ups']),
    )
    expect(mailCommandsForQuery('')).toEqual([])
  })
})

/**
 * Minimal DOM stand-ins: the suppression check relies on instanceof against
 * the standard element constructors, so tests install fake constructors and
 * build targets from them.
 */
class FakeHTMLElement {
  isContentEditable = false
}
class FakeHTMLInputElement extends FakeHTMLElement {}
class FakeHTMLTextAreaElement extends FakeHTMLElement {}
class FakeHTMLSelectElement extends FakeHTMLElement {}

function installDomConstructors(): void {
  Object.assign(globalThis, {
    HTMLElement: FakeHTMLElement,
    HTMLInputElement: FakeHTMLInputElement,
    HTMLTextAreaElement: FakeHTMLTextAreaElement,
    HTMLSelectElement: FakeHTMLSelectElement,
  })
}

function removeDomConstructors(): void {
  for (const name of [
    'HTMLElement',
    'HTMLInputElement',
    'HTMLTextAreaElement',
    'HTMLSelectElement',
  ]) {
    delete (globalThis as Record<string, unknown>)[name]
  }
}

describe('keyboard shortcut dispatch', () => {
  afterEach(removeDomConstructors)

  it('suppresses single-key shortcuts while typing', () => {
    installDomConstructors()
    const input = new FakeHTMLInputElement() as unknown as EventTarget
    const textarea = new FakeHTMLTextAreaElement() as unknown as EventTarget
    const editable = new FakeHTMLElement()
    editable.isContentEditable = true

    expect(mailShortcutTargetIsTyping(input)).toBe(true)
    expect(mailShortcutTargetIsTyping(textarea)).toBe(true)
    expect(
      mailShortcutTargetIsTyping(editable as unknown as EventTarget),
    ).toBe(true)
    expect(
      mailShortcutTargetIsTyping(
        new FakeHTMLElement() as unknown as EventTarget,
      ),
    ).toBe(false)

    expect(mailShortcutCommandForEvent({ key: 'e', target: input })).toBeNull()
    expect(
      mailShortcutCommandForEvent({ key: 'j', target: textarea }),
    ).toBeNull()
    expect(
      mailShortcutCommandForEvent({
        key: 'e',
        target: new FakeHTMLElement() as unknown as EventTarget,
      }),
    ).toBe('archive')
  })

  it('ignores modifier chords so app shortcuts pass through', () => {
    installDomConstructors()
    expect(mailShortcutCommandForEvent({ key: 'c', metaKey: true })).toBeNull()
    expect(mailShortcutCommandForEvent({ key: 'r', ctrlKey: true })).toBeNull()
    expect(mailShortcutCommandForEvent({ key: 'e', altKey: true })).toBeNull()
    expect(mailShortcutCommandForEvent({ key: 'c' })).toBe('compose')
  })

  it('dispatches without DOM globals (non-browser environments)', () => {
    expect(mailShortcutCommandForEvent({ key: 'u' })).toBe('toggle-unread')
    expect(mailShortcutCommandForEvent({ key: '#' })).toBe('trash')
  })
})
