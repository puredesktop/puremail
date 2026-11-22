import type { MailSnippet, MailStore } from '../types'

const DEFAULT_UPDATED_AT = '2026-01-01T00:00:00.000Z'

export const DEFAULT_SNIPPETS: MailSnippet[] = [
  {
    id: 'snippet_quick_followup',
    title: 'Quick Follow-Up',
    shortcut: 'followup',
    body: [
      'Hi {{first_name}},',
      '',
      'Just circling back on {{subject}} to see if you had a chance to review. Happy to jump on a quick call or adjust anything needed on my end.',
      '',
      'Best,',
      '{{my_name}}',
    ].join('\n'),
    updatedAt: DEFAULT_UPDATED_AT,
  },
  {
    id: 'snippet_meeting_recap',
    title: 'Meeting Recap',
    shortcut: 'recap',
    subject: 'Recap: {{subject}}',
    body: [
      'Hi {{first_name}},',
      '',
      'Thanks for taking the time to connect today ({{date}}). Here is a quick summary of what we covered and our next steps:',
      '',
      '- Key decisions:',
      '- Action items & owners:',
      '- Target timeline:',
      '',
      'Let me know if I missed anything.',
      '',
      'Best,',
      '{{my_name}}',
    ].join('\n'),
    updatedAt: DEFAULT_UPDATED_AT,
  },
  {
    id: 'snippet_intro_handoff',
    title: 'Intro / Handoff',
    shortcut: 'intro',
    subject: 'Introduction: {{name}}',
    body: [
      'Hi {{first_name}},',
      '',
      'Looping you in here so you have full context on {{subject}}. I am handing this thread over so you two can coordinate directly on next steps.',
      '',
      'Moving myself to Bcc to save your inbox — feel free to pull me back in anytime.',
      '',
      'Best,',
      '{{my_name}}',
    ].join('\n'),
    updatedAt: DEFAULT_UPDATED_AT,
  },
  {
    id: 'snippet_scheduling',
    title: 'Out of Office / Scheduling',
    shortcut: 'schedule',
    body: [
      'Hi {{first_name}},',
      '',
      'Thanks for reaching out. I would be glad to find 20 minutes to go through this. Here are a few windows that work on my end:',
      '',
      '- Option 1:',
      '- Option 2:',
      '- Option 3:',
      '',
      'Let me know which works best and I will send over a calendar invite.',
      '',
      'Best,',
      '{{my_name}}',
    ].join('\n'),
    updatedAt: DEFAULT_UPDATED_AT,
  },
]

export interface SnippetTemplateVars {
  recipientName?: string
  myName?: string
  subject?: string
  date?: string
}

function firstNameFrom(name: string | undefined): string {
  const cleaned = (name ?? '').trim()
  if (!cleaned) return 'there'
  if (cleaned.includes('@') && !cleaned.includes(' ')) {
    const local = cleaned.split('@')[0] ?? ''
    const word = local.split(/[._-]+/)[0] ?? ''
    return word ? word[0]!.toUpperCase() + word.slice(1) : 'there'
  }
  return cleaned.split(/\s+/)[0] || 'there'
}

function localIsoDate(now = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function substituteTokens(
  template: string,
  replacements: Record<string, string>,
  htmlEscape = false,
): string {
  return template.replace(
    /\{\{\s*(first_name|name|my_name|subject|date)\s*\}\}/gi,
    (_whole, rawKey: string) => {
      const key = rawKey.toLowerCase()
      const value = replacements[key] ?? ''
      return htmlEscape ? escapeHtml(value) : value
    },
  )
}

export function renderSnippet(
  snippet: MailSnippet,
  vars: SnippetTemplateVars = {},
): { subject?: string; body: string; bodyHtml?: string } {
  const fullName = (vars.recipientName ?? '').trim()
  const replacements: Record<string, string> = {
    first_name: firstNameFrom(fullName),
    name: fullName || 'there',
    my_name: (vars.myName ?? '').trim(),
    subject: (vars.subject ?? '').trim() || 'this',
    date: (vars.date ?? '').trim() || localIsoDate(),
  }
  return {
    ...(snippet.subject !== undefined
      ? { subject: substituteTokens(snippet.subject, replacements) }
      : {}),
    body: substituteTokens(snippet.body, replacements),
    ...(snippet.bodyHtml !== undefined
      ? { bodyHtml: substituteTokens(snippet.bodyHtml, replacements, true) }
      : {}),
  }
}

export function matchSnippets(
  snippets: readonly MailSnippet[],
  query: string,
): MailSnippet[] {
  const normalized = query.trim().replace(/^\/+/, '').toLowerCase()
  if (!normalized) return [...snippets]

  const scored: Array<{ snippet: MailSnippet; score: number }> = []
  for (const snippet of snippets) {
    const shortcut = snippet.shortcut.trim().replace(/^\/+/, '').toLowerCase()
    const title = snippet.title.toLowerCase()
    const body = snippet.body.toLowerCase()
    if (shortcut === normalized) {
      scored.push({ snippet, score: 100 })
    } else if (shortcut.startsWith(normalized)) {
      scored.push({ snippet, score: 80 })
    } else if (title.startsWith(normalized)) {
      scored.push({ snippet, score: 60 })
    } else if (shortcut.includes(normalized) || title.includes(normalized)) {
      scored.push({ snippet, score: 40 })
    } else if (body.includes(normalized)) {
      scored.push({ snippet, score: 20 })
    }
  }
  return scored
    .sort(
      (a, b) =>
        b.score - a.score || a.snippet.title.localeCompare(b.snippet.title),
    )
    .map(item => item.snippet)
}

export function upsertSnippet(
  store: MailStore,
  snippet: Omit<MailSnippet, 'id' | 'updatedAt'> & { id?: string },
  nowIso = new Date().toISOString(),
): MailStore {
  const title = snippet.title.trim()
  const normalizedShortcut = snippet.shortcut.trim().replace(/^\/+/, '')
  if (!title || !normalizedShortcut) return store

  const existing =
    store.snippets === undefined ? [...DEFAULT_SNIPPETS] : store.snippets
  const id = snippet.id?.trim() || `snippet_${crypto.randomUUID()}`

  // Guard duplicate shortcuts across different snippets (case-insensitive).
  const shortcutKey = normalizedShortcut.toLowerCase()
  if (
    existing.some(
      item =>
        item.id !== id &&
        item.shortcut.trim().replace(/^\/+/, '').toLowerCase() === shortcutKey,
    )
  ) {
    return store
  }

  const record: MailSnippet = {
    id,
    title,
    shortcut: normalizedShortcut,
    ...(snippet.subject !== undefined ? { subject: snippet.subject } : {}),
    body: snippet.body,
    ...(snippet.bodyHtml !== undefined ? { bodyHtml: snippet.bodyHtml } : {}),
    updatedAt: nowIso,
  }
  const hasExisting = existing.some(item => item.id === id)
  return {
    ...store,
    snippets: hasExisting
      ? existing.map(item => (item.id === id ? record : item))
      : [...existing, record],
  }
}

export function deleteSnippet(store: MailStore, id: string): MailStore {
  const existing =
    store.snippets === undefined ? [...DEFAULT_SNIPPETS] : store.snippets
  if (!existing.some(item => item.id === id)) return store
  return {
    ...store,
    snippets: existing.filter(item => item.id !== id),
  }
}
