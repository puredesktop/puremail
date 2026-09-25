export type MailCommandId =
  | 'reply'
  | 'reply-all'
  | 'forward'
  | 'archive'
  | 'snooze-follow-up'
  | 'create-task'
  | 'thread-tasks'
  | 'my-tasks'
  | 'follow-ups'
  | 'next-thread'
  | 'previous-thread'
  | 'compose'
  | 'focus-search'
  | 'toggle-unread'
  | 'trash'

export interface MailCommand {
  id: MailCommandId
  label: string
  shortcut: string
  scope: 'thread' | 'task-pane' | 'global'
  description: string
}

export const mailCommands: MailCommand[] = [
  {
    id: 'reply',
    label: 'Reply',
    shortcut: 'R',
    scope: 'thread',
    description: 'Focus the selected thread reply draft.',
  },
  {
    id: 'reply-all',
    label: 'Reply all',
    shortcut: 'A',
    scope: 'thread',
    description:
      'Reply to the sender and keep everyone else on the thread on Cc.',
  },
  {
    id: 'forward',
    label: 'Forward',
    shortcut: 'F',
    scope: 'thread',
    description: 'Prepare to forward the selected thread.',
  },
  {
    id: 'archive',
    label: 'Archive',
    shortcut: 'E',
    scope: 'thread',
    description: 'Move the selected thread to Archive.',
  },
  {
    id: 'trash',
    label: 'Trash',
    shortcut: '#',
    scope: 'thread',
    description: 'Move the selected thread to Trash.',
  },
  {
    id: 'toggle-unread',
    label: 'Toggle unread',
    shortcut: 'U',
    scope: 'thread',
    description: 'Mark the selected thread read or unread.',
  },
  {
    id: 'next-thread',
    label: 'Next thread',
    shortcut: 'J',
    scope: 'global',
    description: 'Select the next thread in the list.',
  },
  {
    id: 'previous-thread',
    label: 'Previous thread',
    shortcut: 'K',
    scope: 'global',
    description: 'Select the previous thread in the list.',
  },
  {
    id: 'compose',
    label: 'Compose',
    shortcut: 'C',
    scope: 'global',
    description: 'Start a new message.',
  },
  {
    id: 'focus-search',
    label: 'Search',
    shortcut: '/',
    scope: 'global',
    description: 'Open and focus mail search.',
  },
  {
    id: 'snooze-follow-up',
    label: 'Snooze',
    shortcut: 'S',
    scope: 'thread',
    description: 'Create a follow-up task and snooze the selected thread.',
  },
  {
    id: 'create-task',
    label: 'Task',
    shortcut: 'T',
    scope: 'thread',
    description: 'Create a task linked to the selected thread.',
  },
  {
    id: 'thread-tasks',
    label: 'Thread tasks',
    shortcut: '1',
    scope: 'task-pane',
    description: 'Show tasks linked to the selected thread.',
  },
  {
    id: 'my-tasks',
    label: 'My tasks',
    shortcut: '2',
    scope: 'task-pane',
    description: 'Show all active mail tasks.',
  },
  {
    id: 'follow-ups',
    label: 'Follow-ups',
    shortcut: '3',
    scope: 'task-pane',
    description: 'Show waiting follow-up tasks.',
  },
]

const commandByShortcut = new Map(
  mailCommands.map(command => [command.shortcut.toLowerCase(), command.id]),
)

export function mailCommandForKey(key: string): MailCommandId | null {
  return commandByShortcut.get(key.toLowerCase()) ?? null
}

export interface MailShortcutKeyEvent {
  key: string
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  target?: EventTarget | null
}

/**
 * Resolve a keydown into a mail command. Gmail-style single keys only:
 * modifier chords (copy, reload, app shortcuts) and keystrokes aimed at a
 * text field never trigger commands.
 */
export function mailShortcutCommandForEvent(
  event: MailShortcutKeyEvent,
): MailCommandId | null {
  if (event.metaKey || event.ctrlKey || event.altKey) return null
  if (mailShortcutTargetIsTyping(event.target ?? null)) return null
  return mailCommandForKey(event.key)
}

/**
 * Gmail-style single-key shortcuts must never fire while the user is
 * typing. True when the event target is an input, textarea, select, or any
 * contenteditable surface.
 */
export function mailShortcutTargetIsTyping(
  target: EventTarget | null,
): boolean {
  if (typeof HTMLElement === 'undefined') return false
  if (!(target instanceof HTMLElement)) return false
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    return true
  }
  return target.isContentEditable
}

export function mailCommandsForQuery(query: string): MailCommand[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return []
  return mailCommands.filter(command =>
    [
      command.label,
      command.id,
      command.shortcut,
      command.scope,
      command.description,
    ]
      .join(' ')
      .toLowerCase()
      .includes(normalized),
  )
}
