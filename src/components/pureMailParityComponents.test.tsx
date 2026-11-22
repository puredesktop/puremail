// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CommandPalette, type CommandPaletteItem } from './CommandPalette'
import { ShortcutsModal } from './ShortcutsModal'
import { TimePickerPopover } from './TimePickerPopover'
import { SearchFilterBuilder } from './SearchFilterBuilder'
import { SecurityShieldPill } from './SecurityShieldPill'
import { PrivacyInspectorModal } from './PrivacyInspectorModal'
import { SenderDrawer } from './SenderDrawer'
import { QuickReplyBar } from './QuickReplyBar'
import { ScreenerQueue } from './ScreenerQueue'
import { TriageFocusMode } from './TriageFocusMode'
import { SnippetPickerMenu } from './SnippetPickerMenu'
import { ThreadListEmptyState, ThreadListSkeleton } from './ThreadListStates'
import { DEFAULT_SNIPPETS } from '../lib/mailSnippets'
import type { SenderProfile } from '../lib/senderIntelligence'
import type { MailMessage, MailThread } from '../types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true

const container = document.createElement('div')
document.body.appendChild(container)
let root = createRoot(container)

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  root = createRoot(container)
})

function setInputValue(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
): void {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  setter?.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

function sampleMessage(): MailMessage {
  return {
    id: 'msg_1',
    threadId: 'thr_1',
    from: { name: 'Alice Vance', email: 'alice@acme.io' },
    to: [{ name: 'Adam', email: 'adam@pure.io' }],
    subject: 'Q4 Security Review',
    body: 'Please inspect the attached report.',
    receivedAt: '2026-11-22T15:00:00.000Z',
    attachments: [],
    read: false,
    rawHeaders: [
      { name: 'From', value: 'Alice Vance <alice@acme.io>' },
      { name: 'Authentication-Results', value: 'spf=pass dkim=pass dmarc=pass' },
      { name: 'X-Mailer', value: 'PureMail/2.0' },
    ],
  }
}

function sampleThread(id = 'thr_1', subject = 'Q4 Security Review'): MailThread {
  return {
    id,
    accountId: 'acc_1',
    mailboxId: 'mb_inbox',
    subject,
    participants: [{ name: 'Alice Vance', email: 'alice@acme.io' }],
    labels: [],
    status: 'inbox',
    priority: 'none',
    summary: 'Please inspect the attached report.',
    lastMessageAt: '2026-11-22T15:00:00.000Z',
    syncState: 'synced',
  }
}

describe('CommandPalette', () => {
  it('filters commands, navigates with keyboard, and runs selection', async () => {
    const onClose = vi.fn()
    const onArchive = vi.fn()
    const onInbox = vi.fn()
    const items: CommandPaletteItem[] = [
      {
        id: 'archive',
        label: 'Archive thread',
        subtitle: 'Move out of Inbox',
        group: 'Actions',
        shortcut: ['E'],
        keywords: ['done'],
        onSelect: onArchive,
      },
      {
        id: 'go_inbox',
        label: 'Go to Inbox',
        group: 'Navigation',
        shortcut: ['G', 'I'],
        onSelect: onInbox,
      },
    ]

    await act(async () => {
      root.render(<CommandPalette open onClose={onClose} items={items} />)
    })

    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog).toBeTruthy()
    expect(container.textContent).toContain('Actions')
    expect(container.textContent).toContain('Navigation')

    const input = container.querySelector(
      'input[role="combobox"]',
    ) as HTMLInputElement
    expect(input).toBeTruthy()

    // ArrowDown moves to second item (Go to Inbox), Enter runs it
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
      )
    })
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      )
    })
    expect(onClose).toHaveBeenCalledOnce()
    expect(onInbox).toHaveBeenCalledOnce()
    expect(onArchive).not.toHaveBeenCalled()

    // Filter to empty state
    await act(async () => {
      setInputValue(input, 'zzzznomatch')
    })
    expect(container.textContent).toContain('No matching commands')

    // Escape closes
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      )
    })
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})

describe('ShortcutsModal', () => {
  it('renders all 4 shortcut groups and closes on Escape', async () => {
    const onClose = vi.fn()
    await act(async () => {
      root.render(<ShortcutsModal open onClose={onClose} />)
    })

    expect(container.textContent).toContain('Navigation')
    expect(container.textContent).toContain('Go To (Chords)')
    expect(container.textContent).toContain('Triage & Actions')
    expect(container.textContent).toContain('Reading & Compose')
    expect(container.textContent).toContain('Undo last triage')
    expect(container.textContent).toContain('Insert snippet')

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      )
    })
    expect(onClose).toHaveBeenCalledOnce()
  })
})

describe('TimePickerPopover', () => {
  it('supports presets, natural-language parsing, and rejects past custom dates', async () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    await act(async () => {
      root.render(
        <TimePickerPopover mode="snooze" onSelect={onSelect} onClose={onClose} />,
      )
    })

    expect(container.textContent).toContain('Later today')
    expect(container.textContent).toContain('Tomorrow morning')

    const input = container.querySelector(
      'input[aria-label="Natural language date and time"]',
    ) as HTMLInputElement
    await act(async () => {
      setInputValue(input, 'tomorrow 9am')
    })
    const preview = container.querySelector(
      '[data-testid="time-picker-natural-preview"]',
    ) as HTMLButtonElement | null
    expect(preview).toBeTruthy()
    await act(async () => {
      preview!.click()
    })
    expect(onSelect).toHaveBeenCalledOnce()

    // Open custom date picker and verify past date rejection
    const toggleBtn = [...container.querySelectorAll('button')].find(b =>
      b.textContent?.includes('Pick date & time'),
    )!
    await act(async () => {
      toggleBtn.click()
    })
    const dateInput = container.querySelector(
      'input[aria-label="Custom date"]',
    ) as HTMLInputElement
    await act(async () => {
      setInputValue(dateInput, '2000-01-01')
    })
    const applyBtn = [...container.querySelectorAll('button')].find(
      b => b.textContent?.trim() === 'Apply',
    )!
    await act(async () => {
      applyBtn.click()
    })
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'future',
    )
    expect(onSelect).toHaveBeenCalledOnce()
  })
})

describe('SearchFilterBuilder', () => {
  it('parses existing query, builds updated query, and triggers callbacks', async () => {
    const onApply = vi.fn()
    const onCreateFilter = vi.fn()
    const onClear = vi.fn()
    const onClose = vi.fn()

    await act(async () => {
      root.render(
        <SearchFilterBuilder
          query="from:alice is:unread"
          folders={['Inbox', 'Archive']}
          labels={['Finance', 'Legal']}
          recentSearches={['has:attachment invoice']}
          onApply={onApply}
          onCreateFilter={onCreateFilter}
          onClear={onClear}
          onClose={onClose}
        />,
      )
    })

    const preview = container.querySelector(
      '[data-testid="search-builder-preview"]',
    )
    expect(preview?.textContent).toContain('from:alice')
    expect(preview?.textContent).toContain('is:unread')

    // Toggle VIP only
    const vipChip = [...container.querySelectorAll('button')].find(
      b => b.textContent?.trim() === 'VIP only',
    )!
    await act(async () => {
      vipChip.click()
    })
    expect(preview?.textContent).toContain('is:vip')

    // Click Search
    const searchBtn = [...container.querySelectorAll('button')].find(
      b => b.textContent?.trim() === 'Search',
    )!
    await act(async () => {
      searchBtn.click()
    })
    expect(onApply).toHaveBeenCalledWith(expect.stringContaining('is:vip'))

    // Click Create filter
    const createFilterBtn = [...container.querySelectorAll('button')].find(
      b => b.textContent?.trim() === 'Create filter',
    )!
    await act(async () => {
      createFilterBtn.click()
    })
    expect(onCreateFilter).toHaveBeenCalledOnce()

    // Click recent search chip
    const recentChip = [...container.querySelectorAll('button')].find(
      b => b.textContent?.trim() === 'has:attachment invoice',
    )!
    await act(async () => {
      recentChip.click()
    })
    expect(onApply).toHaveBeenCalledWith('has:attachment invoice')

    // Click Clear
    const clearBtn = [...container.querySelectorAll('button')].find(
      b => b.textContent?.trim() === 'Clear',
    )!
    await act(async () => {
      clearBtn.click()
    })
    expect(onClear).toHaveBeenCalledOnce()
  })
})

describe('SecurityShieldPill & PrivacyInspectorModal', () => {
  it('displays tracker count and warning states and inspects headers', async () => {
    const onOpen = vi.fn()
    await act(async () => {
      root.render(
        <SecurityShieldPill
          trackers={[
            {
              vendor: 'Mailchimp',
              url: 'https://list-manage.com/track/open?id=1',
              reason: 'known-tracker',
            },
          ]}
          linkWarnings={[]}
          senderMismatch={null}
          auth={{ spf: 'pass', dkim: 'pass', dmarc: 'pass' }}
          onClick={onOpen}
        />,
      )
    })
    expect(container.textContent).toContain('1 tracker blocked')
    await act(async () => {
      ;(container.querySelector('button') as HTMLButtonElement).click()
    })
    expect(onOpen).toHaveBeenCalledOnce()

    // Render PrivacyInspectorModal and inspect both tabs
    const onClose = vi.fn()
    await act(async () => {
      root.render(
        <PrivacyInspectorModal
          open
          onClose={onClose}
          message={sampleMessage()}
          trackers={[
            {
              vendor: 'Mailchimp',
              url: 'https://list-manage.com/track/open?id=1',
              reason: 'known-tracker',
            },
          ]}
          linkWarnings={[
            {
              displayText: 'https://paypal.com',
              href: 'https://evil.example/login',
              reason: 'domain-mismatch',
            },
          ]}
          senderMismatch={{
            fromDomain: 'acme.io',
            replyOrReturnDomain: 'other.org',
          }}
          auth={{ spf: 'pass', dkim: 'pass', dmarc: 'fail' }}
        />,
      )
    })

    expect(container.textContent).toContain('Mailchimp')
    expect(container.textContent).toContain('Domain mismatch')
    expect(container.textContent).toContain('other.org')

    const headersTab = [...container.querySelectorAll('[role="tab"]')].find(t =>
      t.textContent?.includes('Original Headers'),
    ) as HTMLButtonElement
    await act(async () => {
      headersTab.click()
    })
    expect(container.textContent).toContain('X-Mailer')
    expect(container.textContent).toContain('PureMail/2.0')

    const filterInput = container.querySelector(
      'input[aria-label="Filter RFC headers"]',
    ) as HTMLInputElement
    await act(async () => {
      setInputValue(filterInput, 'X-Mailer')
    })
    expect(container.textContent).toContain('PureMail/2.0')
    expect(container.textContent).not.toContain('Authentication-Results')

    const copyBtn = [...container.querySelectorAll('button')].find(b =>
      b.textContent?.includes('Copy raw headers'),
    )!
    await act(async () => {
      copyBtn.click()
    })
    expect(container.textContent).toContain('Copied')
  })
})

describe('SenderDrawer', () => {
  it('renders profile intelligence, VIP toggle, screener routing, and files', async () => {
    const onClose = vi.fn()
    const onToggleVip = vi.fn()
    const onScreenDecision = vi.fn()
    const onComposeTo = vi.fn()
    const onCreateFilter = vi.fn()
    const onOpenThread = vi.fn()
    const onPreviewAttachment = vi.fn()

    const profile: SenderProfile = {
      name: 'Alice Vance',
      email: 'alice@acme.io',
      domain: 'acme.io',
      receivedCount: 12,
      sentCount: 5,
      firstContactAt: '2026-01-01T00:00:00.000Z',
      lastContactAt: '2026-11-22T15:00:00.000Z',
      isVip: false,
      screenerDestination: 'inbox',
      latestAuth: { spf: 'pass', dkim: 'pass', dmarc: 'pass' },
      recentThreads: [
        {
          threadId: 'thr_1',
          subject: 'Q4 Security Review',
          lastMessageAt: '2026-11-22T15:00:00.000Z',
          status: 'inbox',
          unread: true,
          snippet: 'Please inspect',
        },
      ],
      sharedAttachments: [
        {
          id: 'att_1',
          name: 'audit.pdf',
          mimeType: 'application/pdf',
          sizeLabel: '240 KB',
          messageId: 'msg_1',
          threadId: 'thr_1',
          receivedAt: '2026-11-22T15:00:00.000Z',
        },
      ],
    }

    await act(async () => {
      root.render(
        <SenderDrawer
          open
          profile={profile}
          orgTitle="VP Security · Acme"
          onClose={onClose}
          onToggleVip={onToggleVip}
          onScreenDecision={onScreenDecision}
          onComposeTo={onComposeTo}
          onCreateFilter={onCreateFilter}
          onOpenThread={onOpenThread}
          onPreviewAttachment={onPreviewAttachment}
        />,
      )
    })

    expect(container.textContent).toContain('Alice Vance')
    expect(container.textContent).toContain('VP Security · Acme')
    expect(container.textContent).toContain('SPF & DKIM pass')

    const clickByText = async (label: string) => {
      const btn = [...container.querySelectorAll('button')].find(
        b => b.textContent?.trim() === label,
      )!
      expect(btn).toBeTruthy()
      await act(async () => {
        btn.click()
      })
    }

    await clickByText('VIP')
    expect(onToggleVip).toHaveBeenCalledWith('alice@acme.io')

    await clickByText('Feed')
    expect(onScreenDecision).toHaveBeenCalledWith(
      'alice@acme.io',
      'feed',
      'Alice Vance',
    )

    await clickByText('Compose')
    expect(onComposeTo).toHaveBeenCalledWith('alice@acme.io', 'Alice Vance')

    await clickByText('Filter')
    expect(onCreateFilter).toHaveBeenCalledWith('alice@acme.io')

    const threadBtn = [...container.querySelectorAll('button')].find(b =>
      b.textContent?.includes('Q4 Security Review'),
    )!
    await act(async () => {
      threadBtn.click()
    })
    expect(onOpenThread).toHaveBeenCalledWith('thr_1')

    const fileBtn = [...container.querySelectorAll('button')].find(b =>
      b.textContent?.includes('audit.pdf'),
    )!
    await act(async () => {
      fileBtn.click()
    })
    expect(onPreviewAttachment).toHaveBeenCalledWith('thr_1', 'msg_1', 'att_1')
  })
})

describe('QuickReplyBar', () => {
  it('expands, pops out with draft body, and sends on Cmd+Enter', async () => {
    const onSend = vi.fn(async () => {})
    const onExpandToCompose = vi.fn()
    const onReplyAll = vi.fn()
    const onForward = vi.fn()

    await act(async () => {
      root.render(
        <QuickReplyBar
          recipientSummary="Alice Vance"
          onSend={onSend}
          onExpandToCompose={onExpandToCompose}
          onReplyAll={onReplyAll}
          onForward={onForward}
        />,
      )
    })

    const trigger = container.querySelector(
      'button[aria-label="Quick reply to Alice Vance"]',
    ) as HTMLButtonElement
    await act(async () => {
      trigger.click()
    })

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    expect(textarea).toBeTruthy()
    await act(async () => {
      setInputValue(textarea, 'Looks good to me!')
    })

    const popOut = [...container.querySelectorAll('button')].find(b =>
      b.textContent?.includes('Pop out'),
    )!
    await act(async () => {
      popOut.click()
    })
    expect(onExpandToCompose).toHaveBeenCalledWith('Looks good to me!')

    // Re-expand and send via Cmd+Enter (Pop out cleared & collapsed the draft).
    const triggerAgain = container.querySelector(
      'button[aria-label="Quick reply to Alice Vance"]',
    ) as HTMLButtonElement
    expect(triggerAgain).toBeTruthy()
    await act(async () => {
      triggerAgain.click()
    })
    const textareaAgain = container.querySelector('textarea') as HTMLTextAreaElement
    await act(async () => {
      setInputValue(textareaAgain, 'Looks good to me!')
    })
    await act(async () => {
      textareaAgain.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          metaKey: true,
          bubbles: true,
        }),
      )
    })
    expect(onSend).toHaveBeenCalledWith('Looks good to me!', expect.anything())
  })
})

describe('ScreenerQueue', () => {
  const senders = [
    {
      email: 'digest@news.io',
      name: 'Weekly Digest',
      latestThreadId: 'thr_news',
      latestSubject: 'Issue #42: Systems Design',
      latestDate: '2026-11-22T12:00:00.000Z',
      count: 2,
      suggestedDestination: 'feed' as const,
    },
  ]

  it('renders compact banner and full decision cards', async () => {
    const onDecide = vi.fn()
    const onOpenThread = vi.fn()
    const onOpenFullScreener = vi.fn()

    await act(async () => {
      root.render(
        <ScreenerQueue
          senders={senders}
          compactBanner
          onDecide={onDecide}
          onOpenThread={onOpenThread}
          onOpenFullScreener={onOpenFullScreener}
        />,
      )
    })
    expect(container.textContent).toContain('1 new sender waiting in Screener')
    const reviewBtn = [...container.querySelectorAll('button')].find(b =>
      b.textContent?.includes('Review'),
    )!
    await act(async () => {
      reviewBtn.click()
    })
    expect(onOpenFullScreener).toHaveBeenCalledOnce()

    await act(async () => {
      root.render(
        <ScreenerQueue
          senders={senders}
          onDecide={onDecide}
          onOpenThread={onOpenThread}
        />,
      )
    })
    expect(container.textContent).toContain('Weekly Digest')
    expect(container.querySelector('[data-suggested="true"]')?.textContent).toContain(
      'Feed',
    )

    const feedBtn = [...container.querySelectorAll('button')].find(
      b => b.textContent?.trim() === 'Feed',
    )!
    await act(async () => {
      feedBtn.click()
    })
    expect(onDecide).toHaveBeenCalledWith(
      'digest@news.io',
      'feed',
      'Weekly Digest',
    )
  })
})

describe('TriageFocusMode', () => {
  it('handles keyboard shortcuts and renders Inbox Zero when empty', async () => {
    const onClose = vi.fn()
    const onArchive = vi.fn()
    const onTrash = vi.fn()
    const onSnooze = vi.fn()
    const onStar = vi.fn()
    const onMute = vi.fn()
    const onReply = vi.fn()
    const onSkip = vi.fn()
    const onUndo = vi.fn()
    const thread = sampleThread()

    await act(async () => {
      root.render(
        <TriageFocusMode
          open
          threads={[thread]}
          currentIndex={0}
          triagedCount={2}
          totalCount={5}
          onClose={onClose}
          onArchive={onArchive}
          onTrash={onTrash}
          onSnooze={onSnooze}
          onStar={onStar}
          onMute={onMute}
          onReply={onReply}
          onSkip={onSkip}
          onUndo={onUndo}
          canUndo
          renderPreview={t => <div data-testid="preview">{t.subject}</div>}
        />,
      )
    })

    expect(container.querySelector('[data-testid="preview"]')?.textContent).toBe(
      'Q4 Security Review',
    )
    expect(container.textContent).toContain('2 of 5')

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', bubbles: true }))
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '#', bubbles: true }))
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }))
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }))
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }))
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }))
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', bubbles: true }))
    })
    expect(onArchive).toHaveBeenCalledWith('thr_1')
    expect(onTrash).toHaveBeenCalledWith('thr_1')
    expect(onStar).toHaveBeenCalledWith('thr_1')
    expect(onMute).toHaveBeenCalledWith('thr_1')
    expect(onReply).toHaveBeenCalledWith('thr_1')
    expect(onSkip).toHaveBeenCalledOnce()
    expect(onUndo).toHaveBeenCalledOnce()

    // Empty state -> Inbox Zero
    await act(async () => {
      root.render(
        <TriageFocusMode
          open
          threads={[]}
          currentIndex={0}
          triagedCount={5}
          totalCount={5}
          onClose={onClose}
          onArchive={onArchive}
          onTrash={onTrash}
          onSnooze={onSnooze}
          onStar={onStar}
          onMute={onMute}
          onReply={onReply}
          onSkip={onSkip}
          renderPreview={() => null}
        />,
      )
    })
    expect(container.querySelector('[data-testid="triage-inbox-zero"]')).toBeTruthy()
    expect(container.textContent).toContain('Inbox Zero')
  })
})

describe('SnippetPickerMenu', () => {
  it('renders variable-substituted previews and inserts selected snippet', async () => {
    const onInsert = vi.fn()
    const onManageSnippets = vi.fn()
    const onClose = vi.fn()

    await act(async () => {
      root.render(
        <SnippetPickerMenu
          snippets={DEFAULT_SNIPPETS}
          vars={{
            recipientName: 'Alice Vance',
            myName: 'Adam',
            subject: 'Q4 Security Review',
          }}
          onInsert={onInsert}
          onManageSnippets={onManageSnippets}
          onClose={onClose}
        />,
      )
    })

    expect(container.textContent).toContain(';followup')
    expect(container.textContent).toContain('Hi Alice,')
    expect(container.textContent).toContain('Q4 Security Review')

    const input = container.querySelector(
      'input[aria-label="Search snippets"]',
    ) as HTMLInputElement
    await act(async () => {
      setInputValue(input, 'recap')
    })
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      )
    })

    expect(onInsert).toHaveBeenCalledOnce()
    const [rendered, snippet] = onInsert.mock.calls[0]!
    expect(snippet.shortcut).toBe('recap')
    expect(rendered.subject).toBe('Recap: Q4 Security Review')
    expect(rendered.body).toContain('Hi Alice,')
    expect(rendered.body).toContain('Adam')
    expect(onClose).toHaveBeenCalledOnce()
  })
})

describe('ThreadListStates', () => {
  it('renders skeleton rows and contextual empty states with CTAs', async () => {
    await act(async () => {
      root.render(<ThreadListSkeleton rows={4} density="compact" />)
    })
    expect(
      container.querySelector('[aria-label="Loading conversations"]')?.children
        .length,
    ).toBe(4)

    const onClearSearch = vi.fn()
    const onSearchServer = vi.fn()
    await act(async () => {
      root.render(
        <ThreadListEmptyState
          variant="search"
          query="invoice"
          onClearSearch={onClearSearch}
          onSearchServer={onSearchServer}
        />,
      )
    })
    expect(container.textContent).toContain('No matches for "invoice"')
    const clearBtn = [...container.querySelectorAll('button')].find(b =>
      b.textContent?.includes('Clear search'),
    )!
    const serverBtn = [...container.querySelectorAll('button')].find(b =>
      b.textContent?.includes('Search all mail'),
    )!
    await act(async () => {
      clearBtn.click()
      serverBtn.click()
    })
    expect(onClearSearch).toHaveBeenCalledOnce()
    expect(onSearchServer).toHaveBeenCalledOnce()
  })
})
