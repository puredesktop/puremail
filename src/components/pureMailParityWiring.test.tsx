// @vitest-environment happy-dom
import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from 'styled-components'
import { createComposedMessageDraft, emptyMailStore } from '../lib/mailModel'
import { demoMailStore } from '../test/mailFixtures'
import type { MailMessage, MailStore, MailThread } from '../types'
import { ComposeEditor, type ComposeEditorProps } from './ComposeEditor'
import { CommandPalette } from './CommandPalette'
import { MailSettings } from './MailSettings'
import { MailSidebar } from './MailSidebar'
import { MailTopBar, type MailTopBarProps } from './MailTopBar'
import { PrivacyInspectorModal } from './PrivacyInspectorModal'
import { QuickReplyBar } from './QuickReplyBar'
import { RecipientChipsInput } from './RecipientChipsInput'
import { SearchFilterBuilder } from './SearchFilterBuilder'
import { ThreadReader, type ThreadReaderProps } from './ThreadReader'

vi.mock('@purescience/platform-ui/release/gesture', async original => ({
  ...(await original<object>()),
  isPersonGesture: () => true,
}))

vi.mock('@purescience/platform-bridge/components/settings/AppSettings', () => ({
  AppSettingsPages: ({ children }: { children?: React.ReactNode }) => (
    <div data-settings-pages="">{children}</div>
  ),
  useAppSettings: () => ({ open: vi.fn(), close: vi.fn(), isOpen: true }),
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) {
    await act(async () => root.unmount())
  }
  document.body.innerHTML = ''
})

async function mount(element: React.ReactElement): Promise<HTMLDivElement> {
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  roots.push(root)
  await act(async () => {
    root.render(<ThemeProvider theme={{}}>{element}</ThemeProvider>)
  })
  return host
}

describe('Wave 2B enterprise parity UI wiring', () => {
  it('MailTopBar opens SearchFilterBuilder, fires layout switcher, and opens Focus Triage', async () => {
    const setReadingPaneLayout = vi.fn()
    const onOpenFocusTriage = vi.fn()
    const onCreateFilterFromSearch = vi.fn()
    const store: MailStore = {
      ...emptyMailStore(),
      settings: {
        ...emptyMailStore().settings,
        recentSearches: ['from:alice@example.com'],
      },
    }
    const props: MailTopBarProps = {
      store,
      selectedAccount: null,
      selectedAccountId: 'acct_1',
      switchAccount: vi.fn(),
      searchInputRef: createRef(),
      searchPanelOpen: true,
      setSearchPanelOpen: vi.fn(),
      currentQuery: 'in:inbox',
      setCurrentQuery: vi.fn(),
      setStore: vi.fn(),
      runMailCommand: vi.fn(),
      openThread: vi.fn(),
      searchGmail: null,
      searchAllMail: null,
      importRemoteThread: null,
      refreshMail: vi.fn(async () => {}),
      mailFetching: false,
      mailFetchDisabled: false,
      density: 'compact',
      setDensity: vi.fn(),
      readingPaneLayout: 'list-only',
      setReadingPaneLayout,
      onOpenFocusTriage,
      onCreateFilterFromSearch,
      openSettings: vi.fn(),
    }

    const host = await mount(<MailTopBar {...props} />)

    const operatorsBtn = host.querySelector<HTMLButtonElement>(
      '[aria-label="Query operators"]',
    )
    expect(operatorsBtn).toBeTruthy()
    await act(async () => operatorsBtn!.click())

    // SearchFilterBuilder renders structured filter fields and recent search chip.
    expect(host.textContent).toContain('from:alice@example.com')

    const splitRightBtn = host.querySelector<HTMLButtonElement>(
      '[aria-label="Split right layout"]',
    )
    expect(splitRightBtn).toBeTruthy()
    await act(async () => splitRightBtn!.click())
    expect(setReadingPaneLayout).toHaveBeenCalledWith('split-right')

    const focusBtn = host.querySelector<HTMLButtonElement>(
      '[aria-label="Focus triage mode"]',
    )
    expect(focusBtn).toBeTruthy()
    await act(async () => focusBtn!.click())
    expect(onOpenFocusTriage).toHaveBeenCalledOnce()
  })

  it('ThreadReader wires SecurityShieldPill, inline RFC 8058 Unsubscribe, stacked messages, QuickReplyBar, and SenderDrawer', async () => {
    const base = demoMailStore()
    const account = base.accounts[0]!
    const thread: MailThread = {
      ...base.threads[0]!,
      id: 'thread_parity',
      accountId: account.id,
      subject: 'Quarterly Product Update',
      participants: [
        { name: 'Clara Vance', email: 'clara@newsletter.example' },
        { name: account.name, email: account.email },
      ],
    }
    const earlierMsg: MailMessage = {
      id: 'msg_earlier',
      threadId: thread.id,
      from: { name: 'Clara Vance', email: 'clara@newsletter.example' },
      to: [{ name: account.name, email: account.email }],
      subject: thread.subject,
      body: 'Earlier note in this conversation.',
      attachments: [],
      receivedAt: '2026-10-01T09:00:00Z',
      read: true,
    }
    const latestMsg: MailMessage = {
      id: 'msg_latest',
      threadId: thread.id,
      from: { name: 'Clara Vance', email: 'clara@newsletter.example' },
      to: [{ name: account.name, email: account.email }],
      subject: thread.subject,
      body: 'Latest message body.\n\n> On Oct 1, Clara wrote:\n> Earlier quote',
      bodyHtml:
        '<p>Latest HTML body.</p><img src="https://open.substack.com/o/pixel.gif" width="1" height="1" />',
      attachments: [],
      receivedAt: '2026-10-02T10:00:00Z',
      read: true,
      listUnsubscribe: '<https://newsletter.example/unsub>',
      listUnsubscribePost: 'List-Unsubscribe=One-Click',
      authResults: { spf: 'pass', dkim: 'pass', dmarc: 'pass' },
    }
    const store: MailStore = {
      ...base,
      threads: [thread, ...base.threads.filter(t => t.id !== thread.id)],
      messages: [earlierMsg, latestMsg, ...base.messages],
    }

    const onQuickReplySend = vi.fn()
    const replyWithBody = vi.fn()
    const noop = () => {}

    const props: ThreadReaderProps = {
      store,
      setStore: vi.fn(),
      storeRef: { current: store },
      providerBacked: undefined,
      activeProvider: 'demo',
      mailProviderRef: { current: undefined },
      selectedThreadStarred: false,
      toggleThreadStarred: vi.fn(),
      selectedThread: thread,
      selectedMailbox: store.mailboxes[0] ?? null,
      selectedAccount: account,
      selectedMessages: [earlierMsg, latestMsg],
      selectedThreadReplyDrafts: [],
      activeMessageTab: latestMsg,
      activeReplyDraft: null,
      selectedThreadDrafting: false,
      selectedThreadGeneratedDraft: null,
      selectedThreadQaStatus: null,
      selectedInvite: undefined,
      selectedInviteMessage: undefined,
      readerMode: 'email',
      setReaderMode: noop,
      setActiveMessageTabId: noop,
      setActiveReplyDraftId: noop,
      focusedMessageId: null,
      setFocusedMessageId: noop,
      setFocusedDraftId: noop,
      expandedQuotedMessageIds: [],
      setExpandedQuotedMessageIds: noop,
      collapsedQuotedMessageIds: [],
      setCollapsedQuotedMessageIds: noop,
      remoteImagesLoadedIds: [],
      setRemoteImagesLoadedIds: noop,
      attachmentActionErrors: {},
      setAttachmentActionErrors: noop,
      setAttachmentPreview: noop,
      systemNotice: '',
      systemNoticeDismissed: false,
      setSystemNoticeDismissed: noop,
      mailDraftNotice: '',
      setCommandNotice: vi.fn(),
      markSelectedUnread: noop,
      deleteSelectedThread: noop,
      addSelectedThreadToCalendar: async () => {},
      forwardSelectedThread: noop,
      openDraftInComposeWindow: noop,
      replyWithBody,
      onQuickReplySend,
      openTaskDrawer: noop,
      threadTaskCount: 0,
      addTask: noop,
      threadPosition: 1,
      threadTotal: 1,
      selectAdjacentThread: noop,
      closeThread: noop,
      focusReply: noop,
      focusReplyAll: noop,
      askThreadAgent: async () => '',
      summarizeSelectedThread: async () => ({ summary: '', actionItems: [] }),
      addExtractedTask: noop,
      createSelectedThreadDraft: noop,
      archiveSelectedThread: noop,
      unarchiveSelectedThread: noop,
      addFollowUp: noop,
      inviteActionState: null,
      openCalendarInvite: async () => {},
      openCalendarInviteForMessage: async () => {},
    }

    const host = await mount(<ThreadReader {...props} />)

    // SecurityShieldPill shows tracker blocked badge and opens PrivacyInspectorModal.
    expect(host.textContent).toContain('1 tracker blocked')
    const shieldBtn = Array.from(host.querySelectorAll('button')).find(b =>
      b.textContent?.includes('1 tracker blocked'),
    )
    expect(shieldBtn).toBeTruthy()
    await act(async () => shieldBtn!.click())
    expect(host.textContent).toContain('SPF')
    expect(host.textContent).toContain('Substack')

    // Inline RFC 8058 One-Click Unsubscribe banner is rendered.
    const unsubBanner = host.querySelector('[aria-label="Mailing list unsubscribe"]')
    expect(unsubBanner).toBeTruthy()
    expect(unsubBanner!.textContent).toContain('One-click unsubscribe supported')

    // Stacked earlier message summary card is rendered and expands on click.
    const earlierCardBtn = host.querySelector<HTMLButtonElement>(
      '[aria-label="Earlier message from Clara Vance"] button',
    )
    expect(earlierCardBtn).toBeTruthy()
    await act(async () => earlierCardBtn!.click())
    expect(host.textContent).toContain('Earlier note in this conversation.')

    // SenderDrawer toggles open from toolbar button.
    const senderBtn = host.querySelector<HTMLButtonElement>(
      '[aria-label="Toggle sender details drawer"]',
    )
    expect(senderBtn).toBeTruthy()
    await act(async () => senderBtn!.click())
    expect(host.textContent).toContain('clara@newsletter.example')

    // QuickReplyBar renders at bottom.
    expect(host.textContent).toContain('Quick reply to Clara Vance')
  })

  it('ComposeEditor renders extended formatting, From switcher, Snippets picker, Priority/Read Receipt, and drop overlay', async () => {
    const made = createComposedMessageDraft(emptyMailStore(), {
      to: [{ name: 'Ana Silva', email: 'ana@example.test' }],
      subject: 'Roadmap sync',
      body: 'Hi there',
      attachments: [],
    })
    const secondAccount = {
      id: 'acct_2',
      provider: 'imap' as const,
      name: 'Personal',
      email: 'me@personal.test',
      syncState: 'online' as const,
    }
    const store: MailStore = {
      ...made.store,
      snippets: undefined,
      accounts: [
        {
          id: 'acct_1',
          provider: 'gmail',
          name: 'Work Me',
          email: 'me@work.test',
          syncState: 'online',
        },
        secondAccount,
      ],
    }
    const storeRef = { current: store }
    const setComposeBody = vi.fn()
    const setComposeBodyHtml = vi.fn()
    const noop = () => {}

    const props = {
      store,
      setStore: vi.fn(),
      storeRef,
      activeProvider: 'demo',
      mailProviderRef: { current: undefined },
      selectedAccount: store.accounts[0]!,
      composeTo: 'Ana Silva <ana@example.test>',
      composeCc: '',
      composeBcc: '',
      composeCcBccOpen: false,
      composeSubject: 'Roadmap sync',
      composeBody: 'Hi there',
      composeBodyHtml: '<p>Hi there</p>',
      composeAttachments: [],
      composeDropActive: true,
      variant: 'docked',
      setComposeTo: noop,
      setComposeCc: noop,
      setComposeBcc: noop,
      setComposeCcBccOpen: noop,
      setComposeSubject: noop,
      setComposeBody,
      setComposeBodyHtml,
      setComposeAttachments: noop,
      setComposeDropActive: noop,
      setComposeOpen: noop,
      composeContext: null,
      composeQuote: null,
      setComposeQuote: noop,
      switchComposeReplyKind: noop,
      onResetComposeContext: noop,
      discardContextDraft: noop,
      composeToRef: { current: null },
      pendingSend: null,
      schedulePendingSend: vi.fn(() => true),
      undoPendingSend: noop,
      sendDraftThroughProvider: vi.fn(),
      markDraftSending: noop,
      setSelectedMailboxId: noop,
      setSelectedThreadId: noop,
      setCommandNotice: vi.fn(),
      onSwitchAccount: vi.fn(),
    } as unknown as ComposeEditorProps

    const host = await mount(<ComposeEditor {...props} />)

    // From selector appears with multiple accounts.
    expect(host.querySelector('select[aria-label="From account"]')).toBeTruthy()

    // Drop overlay appears when composeDropActive is true.
    expect(host.textContent).toContain('Drop files to attach')

    // Extended formatting controls exist.
    expect(host.querySelector('[aria-label="Strikethrough"]')).toBeTruthy()
    expect(host.querySelector('[aria-label="Blockquote"]')).toBeTruthy()
    expect(host.querySelector('[aria-label="Inline code"]')).toBeTruthy()
    expect(host.querySelector('[aria-label="Clear formatting"]')).toBeTruthy()
    expect(host.querySelector('[aria-label="Insert inline image"]')).toBeTruthy()

    // High priority & Read receipt toggles toggle aria-pressed.
    const prioBtn = host.querySelector<HTMLButtonElement>('[aria-label="High priority"]')!
    expect(prioBtn.getAttribute('aria-pressed')).toBe('false')
    await act(async () => prioBtn.click())
    expect(prioBtn.getAttribute('aria-pressed')).toBe('true')

    const rrBtn = host.querySelector<HTMLButtonElement>('[aria-label="Request read receipt"]')!
    expect(rrBtn.getAttribute('aria-pressed')).toBe('false')
    await act(async () => rrBtn.click())
    expect(rrBtn.getAttribute('aria-pressed')).toBe('true')

    // Snippets picker opens and shows default snippets.
    const snippetBtn = host.querySelector<HTMLButtonElement>('[aria-label="Insert snippet"]')!
    await act(async () => snippetBtn.click())
    expect(host.textContent).toContain('Quick Follow-Up')
  })

  it('RecipientChipsInput expands Contact Groups and marks external domain chips', async () => {
    const base = demoMailStore()
    const store: MailStore = {
      ...base,
      contactGroups: [
        {
          id: 'grp_eng',
          name: 'Engineering',
          members: [
            { name: 'Alice', email: 'alice@external.org' },
            { name: 'Bob', email: 'bob@external.org' },
          ],
          updatedAt: '2026-10-01T00:00:00Z',
        },
      ],
    }
    const onChange = vi.fn()
    const host = await mount(
      <RecipientChipsInput
        value="External Person <ext@otherdomain.io>"
        onChange={onChange}
        store={store}
        accountId={store.accounts[0]!.id}
        ariaLabel="To recipients"
      />,
    )

    // External domain badge renders on recipient chips with a different domain.
    expect(host.textContent).toContain('External')

    // Typing group name offers Contact Group in autocomplete options and expands all members.
    const input = host.querySelector('input')!
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!
    await act(async () => {
      setter.call(input, 'Eng')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const groupOption = Array.from(host.querySelectorAll('[role="option"]')).find(
      el => el.textContent?.includes('Engineering'),
    )
    expect(groupOption).toBeTruthy()
    await act(async () => {
      groupOption!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      groupOption!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onChange).toHaveBeenCalled()
    const expanded = String(onChange.mock.calls[0]![0])
    expect(expanded).toContain('alice@external.org')
    expect(expanded).toContain('bob@external.org')
  })

  it('MailSidebar renders Smart Views, Waiting On, and inline label creation', async () => {
    const store = demoMailStore()
    const createMailLabel = vi.fn()
    const setCurrentQuery = vi.fn()
    const host = await mount(
      <MailSidebar
        store={store}
        selectedAccount={store.accounts[0]!}
        accountMailboxes={store.mailboxes.filter(
          m => m.accountId === store.accounts[0]!.id,
        )}
        selectedMailboxId={store.mailboxes[0]!.id}
        selectedSpecialView={null}
        currentQuery="in:inbox"
        setCurrentQuery={setCurrentQuery}
        setSelectedThreadId={vi.fn()}
        setFocusedMessageId={vi.fn()}
        setStore={vi.fn()}
        exitReading={vi.fn()}
        openCompose={vi.fn()}
        unsubscribeCount={0}
        openUnsubscribeDrawer={vi.fn()}
        runs={[]}
        activeRunId={null}
        runsIndexActive={false}
        openRunsIndex={vi.fn()}
        openRun={vi.fn()}
        createMailLabel={createMailLabel}
        screenerCount={3}
      />,
    )

    expect(host.textContent).toContain('Waiting On')
    expect(host.textContent).toContain('Screener')
    expect(host.textContent).toContain('Feed')
    expect(host.textContent).toContain('Paper Trail')

    const addLabelBtn = host.querySelector<HTMLButtonElement>(
      '[aria-label="Create label"]',
    )
    expect(addLabelBtn).toBeTruthy()
    await act(async () => addLabelBtn!.click())
    const labelInput = host.querySelector<HTMLInputElement>(
      '[aria-label="New label name"]',
    )
    expect(labelInput).toBeTruthy()
  })
})

describe('Pass B adversarial review UI & shell regression tests', () => {
  it('P0-1: QuickReplyBar resets across thread switches, preserves body on send failure, and clears on Pop out', async () => {
    const onSend = vi.fn().mockResolvedValueOnce({ ok: false, error: 'Held copy cannot send.' })
    const onExpandToCompose = vi.fn()
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    roots.push(root)

    await act(async () => {
      root.render(
        <ThemeProvider theme={{}}>
          <QuickReplyBar
            threadId="thread_a"
            recipientSummary="Alice"
            onSend={onSend}
            onExpandToCompose={onExpandToCompose}
          />
        </ThemeProvider>,
      )
    })

    const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="Quick reply to Alice"]')!
    await act(async () => trigger.click())

    const textarea = host.querySelector<HTMLTextAreaElement>('textarea')!
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    await act(async () => {
      setter.call(textarea, 'Draft text for thread A')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })

    // Failed send preserves body and renders inline alert.
    const sendBtn = host.querySelector<HTMLButtonElement>('button[data-release="send"]')!
    await act(async () => sendBtn.click())
    expect(onSend).toHaveBeenCalledTimes(1)
    expect(host.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('Draft text for thread A')
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Held copy cannot send.')

    // Switching threadId clears draft, error, and collapses QuickReplyBar.
    await act(async () => {
      root.render(
        <ThemeProvider theme={{}}>
          <QuickReplyBar
            threadId="thread_b"
            recipientSummary="Bob"
            onSend={onSend}
            onExpandToCompose={onExpandToCompose}
          />
        </ThemeProvider>,
      )
    })
    expect(host.querySelector('textarea')).toBeNull()
    expect(host.querySelector('[role="alert"]')).toBeNull()

    // Pop out clears and collapses.
    const triggerB = host.querySelector<HTMLButtonElement>('button[aria-label="Quick reply to Bob"]')!
    await act(async () => triggerB.click())
    const textareaB = host.querySelector<HTMLTextAreaElement>('textarea')!
    await act(async () => {
      setter.call(textareaB, 'Move to composer')
      textareaB.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const popOut = Array.from(host.querySelectorAll('button')).find(b => b.textContent?.includes('Pop out'))!
    await act(async () => popOut.click())
    expect(onExpandToCompose).toHaveBeenCalledWith('Move to composer')
    expect(host.querySelector('textarea')).toBeNull()
  })

  it('P0-3: SearchFilterBuilder emits general negated terms and matches folder names case-insensitively', async () => {
    const onApply = vi.fn()
    const host = await mount(
      <SearchFilterBuilder
        inline
        query="in:INBOX -newsletter"
        folders={['Inbox', 'Archive', 'Work']}
        labels={[]}
        onApply={onApply}
        onClear={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    const folderSelect = Array.from(
      host.querySelectorAll<HTMLSelectElement>('select'),
    ).find(select =>
      Array.from(select.options).some(opt => opt.value === 'Inbox'),
    )!
    expect(folderSelect.value).toBe('Inbox')

    const inputs = Array.from(host.querySelectorAll<HTMLInputElement>('input[type="text"]'))
    const doesntHaveInput = inputs.find(input => input.value === 'newsletter')
    expect(doesntHaveInput).toBeTruthy()

    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      setter.call(doesntHaveInput!, 'spam promo')
      doesntHaveInput!.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const searchBtn = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
      b => b.textContent?.trim() === 'Search',
    )!
    await act(async () => searchBtn.click())
    expect(onApply).toHaveBeenCalledTimes(1)
    const emitted = String(onApply.mock.calls[0]![0])
    expect(emitted).toContain('-spam')
    expect(emitted).toContain('-promo')
    expect(emitted).not.toContain('-subject:')
  })

  it('P0-4: CommandPalette prefilters using initialQuery for L/V shortcuts', async () => {
    const onApplyLabel = vi.fn()
    const host = await mount(
      <CommandPalette
        open
        initialQuery="Apply label: "
        onClose={vi.fn()}
        items={[
          { id: '1', label: 'Compose new message', group: 'Actions', onSelect: vi.fn() },
          { id: '2', label: 'Apply label: Urgent', group: 'Actions', onSelect: onApplyLabel },
          { id: '3', label: 'Move to: Archive', group: 'Actions', onSelect: vi.fn() },
        ]}
      />,
    )

    const input = host.querySelector<HTMLInputElement>('input')!
    expect(input.value).toBe('Apply label: ')
    expect(host.textContent).toContain('Apply label: Urgent')
    expect(host.textContent).not.toContain('Move to: Archive')
  })

  it('P0-5, P0-6 & P1-10: ComposeEditor preserves empty snippets=[], rejects SVG inline images, and uses Cmd+; instead of raw ;', async () => {
    const base = demoMailStore()
    const store: MailStore = {
      ...base,
      snippets: [],
    }
    const setCommandNotice = vi.fn()
    const setComposeBodyHtml = vi.fn()
    const noop = () => {}
    const props = {
      store,
      setStore: vi.fn(),
      storeRef: { current: store },
      activeProvider: 'demo',
      mailProviderRef: { current: undefined },
      selectedAccount: store.accounts[0]!,
      composeTo: 'ana@example.test',
      composeCc: '',
      composeBcc: '',
      composeCcBccOpen: false,
      composeSubject: 'Test',
      composeBody: 'Hello',
      composeBodyHtml: '<p>Hello</p>',
      composeAttachments: [],
      composeDropActive: false,
      variant: 'docked',
      setComposeTo: noop,
      setComposeCc: noop,
      setComposeBcc: noop,
      setComposeCcBccOpen: noop,
      setComposeSubject: noop,
      setComposeBody: noop,
      setComposeBodyHtml,
      setComposeAttachments: noop,
      setComposeDropActive: noop,
      setComposeOpen: noop,
      composeContext: null,
      composeQuote: null,
      setComposeQuote: noop,
      switchComposeReplyKind: noop,
      onResetComposeContext: noop,
      discardContextDraft: noop,
      composeToRef: { current: null },
      pendingSend: null,
      schedulePendingSend: vi.fn(() => true),
      undoPendingSend: noop,
      sendDraftThroughProvider: vi.fn(),
      markDraftSending: noop,
      setSelectedMailboxId: noop,
      setSelectedThreadId: noop,
      setCommandNotice,
    } as unknown as ComposeEditorProps

    const host = await mount(<ComposeEditor {...props} />)

    // P0-5: store.snippets = [] stays empty (does NOT resurrect DEFAULT_SNIPPETS).
    const snippetBtn = host.querySelector<HTMLButtonElement>('[aria-label="Insert snippet"]')!
    await act(async () => snippetBtn.click())
    expect(host.textContent).toContain('0 snippets')
    expect(host.textContent).not.toContain('Quick Follow-Up')
    // Close snippet menu via Escape
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(host.textContent).not.toContain('0 snippets')

    // P1-10: Typing a single ';' in the editor does NOT open the snippet menu; Cmd+; DOES.
    const editor = host.querySelector<HTMLElement>('[contenteditable="true"]')!
    await act(async () => {
      editor.dispatchEvent(new KeyboardEvent('keydown', { key: ';', bubbles: true }))
    })
    expect(host.textContent).not.toContain('0 snippets')
    await act(async () => {
      editor.dispatchEvent(new KeyboardEvent('keydown', { key: ';', metaKey: true, bubbles: true }))
    })
    expect(host.textContent).toContain('0 snippets')

    // P0-6: Reject image/svg+xml inline image upload with a clear notice.
    const inlineImgInput = host.querySelector<HTMLInputElement>('input[type="file"][accept*="image/png"]')!
    expect(inlineImgInput).toBeTruthy()
    const svgFile = new File(['<svg onload="alert(1)"></svg>'], 'evil.svg', { type: 'image/svg+xml' })
    await act(async () => {
      Object.defineProperty(inlineImgInput, 'files', { value: [svgFile], configurable: true })
      inlineImgInput.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(setCommandNotice).toHaveBeenCalledWith(expect.stringContaining('PNG, JPEG, GIF, and WebP'))
    expect(setComposeBodyHtml).not.toHaveBeenCalled()
  })

  it('P1-17: MailSettings adds VIP idempotently and validates duplicate/invalid Contact Groups inline', async () => {
    let currentStore: MailStore = {
      ...demoMailStore(),
      vipSenders: ['ceo@company.test'],
      contactGroups: [
        {
          id: 'grp_existing',
          name: 'Board',
          members: [{ name: 'Chair', email: 'chair@company.test' }],
          updatedAt: '2026-10-01T00:00:00Z',
        },
      ],
    }
    const setStore = vi.fn((updater: MailStore | ((prev: MailStore) => MailStore)) => {
      currentStore = typeof updater === 'function' ? updater(currentStore) : updater
    })

    const host = await mount(
      <MailSettings
        store={currentStore}
        setStore={setStore}
        setCommandNotice={vi.fn()}
        selectedAccount={currentStore.accounts[0] ?? null}
        googleStatus={null}
        setGoogleStatus={vi.fn()}
        providerDrawerOpen={false}
        setProviderDrawerOpen={vi.fn()}
        mailFetching={false}
        refreshMail={vi.fn(async () => {})}
        onRunTriage={vi.fn()}
        replayQueuedActionsNow={vi.fn(async () => {})}
        discardQueuedActionNow={vi.fn()}
      />,
    )

    // Adding an existing VIP again does NOT remove them (uses setVipSender(..., true)).
    const vipInput = host.querySelector<HTMLInputElement>('input[aria-label="Add VIP sender email"]')!
    expect(vipInput).toBeTruthy()
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      setter.call(vipInput, 'ceo@company.test')
      vipInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const addVipBtn = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
      b => b.textContent?.trim() === 'Add VIP',
    )!
    await act(async () => addVipBtn.click())
    expect(currentStore.vipSenders).toContain('ceo@company.test')

    // Adding a duplicate Contact Group shows inline alert error.
    const groupNameInput = host.querySelector<HTMLInputElement>('input[aria-label="New contact group name"]')!
    const groupMembersInput = host.querySelector<HTMLInputElement>('input[aria-label="Contact group members"]')!
    await act(async () => {
      setter.call(groupNameInput, 'Board')
      groupNameInput.dispatchEvent(new Event('input', { bubbles: true }))
      setter.call(groupMembersInput, 'new@company.test')
      groupMembersInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const addGroupBtn = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
      b => b.textContent?.trim() === 'Add group',
    )!
    await act(async () => addGroupBtn.click())
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('already exists')
  })

  it('P2-19: PrivacyInspectorModal resets tab on message change and does not report Copied on clipboard error', async () => {
    const base = demoMailStore()
    const msgA: MailMessage = {
      ...base.messages[0]!,
      id: 'msg_priv_a',
      subject: 'First message',
      rawHeaders: [{ name: 'Authentication-Results', value: 'spf=pass dkim=pass dmarc=pass' }],
    }
    const msgB: MailMessage = {
      ...base.messages[0]!,
      id: 'msg_priv_b',
      subject: 'Second message',
      rawHeaders: [{ name: 'Subject', value: 'Second message' }],
    }

    const writeText = vi.fn().mockRejectedValueOnce(new Error('Clipboard denied'))
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    const auth = { spf: 'pass' as const, dkim: 'pass' as const, dmarc: 'pass' as const }
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    roots.push(root)
    await act(async () => {
      root.render(
        <ThemeProvider theme={{}}>
          <PrivacyInspectorModal
            open
            message={msgA}
            trackers={[]}
            linkWarnings={[]}
            senderMismatch={null}
            auth={auth}
            onClose={vi.fn()}
          />
        </ThemeProvider>,
      )
    })

    // Switch to Original Headers tab and attempt copy that rejects -> must NOT show "Copied".
    const headersTab = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(
      b => b.textContent?.includes('Original Headers'),
    )!
    await act(async () => headersTab.click())
    expect(headersTab.getAttribute('aria-selected')).toBe('true')

    const copyBtn = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
      b => b.textContent?.includes('Copy'),
    )!
    await act(async () => copyBtn.click())
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(copyBtn.textContent).not.toContain('Copied')

    // Changing message resets active tab back to Security & Privacy.
    await act(async () => {
      root.render(
        <ThemeProvider theme={{}}>
          <PrivacyInspectorModal
            open
            message={msgB}
            trackers={[]}
            linkWarnings={[]}
            senderMismatch={null}
            auth={auth}
            onClose={vi.fn()}
          />
        </ThemeProvider>,
      )
    })
    const securityTab = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(
      b => b.textContent?.includes('Security'),
    )!
    expect(securityTab.getAttribute('aria-selected')).toBe('true')
  })

  it('P2-20: RecipientChipsInput suppresses External badge for consumer webmail accounts', async () => {
    const base = demoMailStore()
    const gmailAccount = {
      ...base.accounts[0]!,
      id: 'acct_gmail_consumer',
      email: 'alex@gmail.com',
    }
    const store: MailStore = {
      ...base,
      accounts: [gmailAccount],
    }
    const host = await mount(
      <RecipientChipsInput
        value="Friend <friend@otherdomain.io>"
        onChange={vi.fn()}
        store={store}
        accountId={gmailAccount.id}
        ariaLabel="To recipients"
      />,
    )
    expect(host.textContent).toContain('friend@otherdomain.io')
    expect(host.textContent).not.toContain('External')
  })
})
