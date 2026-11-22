import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  cachedPeopleDirectory,
  loadPeopleDirectory,
  type PeopleDirectoryEntry,
} from '../lib/peopleDirectory'
import { Users, X } from 'lucide-react'
import {
  formatRecipientToken,
  isValidEmailAddress,
  parseRecipientInput,
  rankedCorrespondents,
} from '../lib/mailCompose'
import type { MailContactGroup, MailStore } from '../types'
import { senderAvatar } from './mailShellHelpers'
import {
  ChipField,
  ChipTextInput,
  RecipientChip,
  RecipientMenu,
  RecipientMenuItem,
  RecipientMenuMeta,
  RecipientMenuWrap,
} from './mailShellStyles'

export interface RecipientChipsInputProps {
  /** Comma-separated recipient string owned by the shell compose state. */
  value: string
  onChange: (next: string) => void
  store: MailStore
  accountId?: string
  ariaLabel: string
  placeholder?: string
  inputRef?: React.RefObject<HTMLInputElement | null>
}

const CONSUMER_WEBMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'icloud.com',
  'me.com',
  'yahoo.com',
  'proton.me',
  'protonmail.com',
  'fastmail.com',
])

function contactToken(name: string, email: string): string {
  return formatRecipientToken(name, email)
}

/**
 * Recipient chips over a plain comma-separated string: completed addresses
 * render as chips (invalid ones marked, never silently dropped), the tail
 * stays editable text, and prior correspondents autocomplete underneath.
 */
export function RecipientChipsInput({
  value,
  onChange,
  store,
  accountId,
  ariaLabel,
  placeholder,
  inputRef,
}: RecipientChipsInputProps): React.ReactElement {
  const [pending, setPending] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  // Keyboard selection: the first suggestion starts highlighted, arrows
  // move, Enter takes the highlighted one, Escape dismisses the menu
  // (after which Enter commits the raw text).
  const [activeIndex, setActiveIndex] = useState(0)
  const localInputRef = useRef<HTMLInputElement | null>(null)
  // Double-click shield: picking a suggestion collapses the menu and the
  // fresh chip's remove button lands exactly under the cursor — the second
  // click of a double-click was deleting the pick it just made.
  const lastPickAtRef = useRef(0)
  const chips = useMemo(() => parseRecipientInput(value), [value])
  const chipEmails = useMemo(
    () => new Set(chips.map(chip => chip.email.trim().toLowerCase())),
    [chips],
  )
  // PurePeople's directory joins the mail-derived ranking: the contact
  // book holds people fed by the WHOLE suite (and the user's curated
  // names/orgs), so To/Cc can offer them too. Cached and best-effort —
  // typing never waits on the bridge.
  const [peopleDirectory, setPeopleDirectory] = useState<
    PeopleDirectoryEntry[]
  >(() => cachedPeopleDirectory())
  useEffect(() => {
    if (!menuOpen) return
    let cancelled = false
    void loadPeopleDirectory().then(entries => {
      if (!cancelled) setPeopleDirectory(entries)
    })
    return () => {
      cancelled = true
    }
  }, [menuOpen])

  const activeAccountDomain = useMemo(() => {
    const acct =
      store.accounts.find(a => a.id === accountId) ?? store.accounts[0]
    const email = acct?.email?.trim().toLowerCase() ?? ''
    const at = email.indexOf('@')
    return at > 0 ? email.slice(at + 1) : ''
  }, [store.accounts, accountId])

  type RecipientSuggestion =
    | { kind: 'contact'; name: string; email: string }
    | { kind: 'group'; group: MailContactGroup }

  const suggestions = useMemo<RecipientSuggestion[]>(() => {
    if (!accountId || !menuOpen) return []
    const needle = pending.trim().toLowerCase()
    const fromGroups: RecipientSuggestion[] = (store.contactGroups ?? [])
      .filter(group => {
        if (!group.members.length) return false
        if (!needle) return true
        return (
          group.name.toLowerCase().includes(needle) ||
          group.members.some(
            m =>
              m.email.toLowerCase().includes(needle) ||
              m.name.toLowerCase().includes(needle),
          )
        )
      })
      .slice(0, 3)
      .map(group => ({ kind: 'group', group }))
    const fromMail: RecipientSuggestion[] = rankedCorrespondents(
      store,
      accountId,
      pending,
    )
      .filter(contact => !chipEmails.has(contact.email.trim().toLowerCase()))
      .map(contact => ({
        kind: 'contact',
        name: contact.name,
        email: contact.email,
      }))
    const seen = new Set(
      fromMail.map(item =>
        item.kind === 'contact' ? item.email.trim().toLowerCase() : '',
      ),
    )
    const fromPeople: RecipientSuggestion[] = peopleDirectory
      .filter(entry => {
        if (chipEmails.has(entry.email) || seen.has(entry.email)) return false
        if (!needle) return false
        return (
          entry.email.includes(needle) ||
          entry.name.toLowerCase().includes(needle) ||
          (entry.org ?? '').toLowerCase().includes(needle)
        )
      })
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 4)
      .map(entry => ({
        kind: 'contact',
        name: entry.org ? `${entry.name} (${entry.org})` : entry.name,
        email: entry.email,
      }))
    return [...fromGroups, ...fromMail, ...fromPeople].slice(0, 8)
  }, [accountId, chipEmails, menuOpen, pending, peopleDirectory, store])

  const commitChips = (nextChips: string[]): void => {
    onChange(nextChips.join(', '))
  }

  const commitPending = (): void => {
    // Read the LIVE input first: anything that set the value without a
    // React input event (native autofill, password managers) would
    // otherwise be silently reverted by the controlled value.
    const raw = localInputRef.current?.value ?? pending
    const token = raw.trim().replace(/[,;]+$/, '')
    setPending('')
    if (!token) return
    const parsedIncoming = parseRecipientInput(token)
    const nextTokens = [...chips.map(chip => contactToken(chip.name, chip.email))]
    const existingEmails = new Set(chipEmails)
    for (const item of parsedIncoming) {
      const normalized = item.email.trim().toLowerCase()
      if (isValidEmailAddress(item.email) && existingEmails.has(normalized)) {
        continue
      }
      if (normalized) existingEmails.add(normalized)
      nextTokens.push(contactToken(item.name, item.email))
    }
    commitChips(nextTokens)
  }

  const editChip = (index: number): void => {
    const target = chips[index]
    if (!target) return
    const restored = contactToken(target.name, target.email)
    removeChip(index)
    setPending(restored)
    setMenuOpen(true)
    window.setTimeout(() => {
      const input = localInputRef.current
      if (input) {
        input.focus()
        input.setSelectionRange(restored.length, restored.length)
      }
    }, 0)
  }

  const removeChip = (index: number): void => {
    commitChips(
      chips
        .filter((_, chipIndex) => chipIndex !== index)
        .map(chip => contactToken(chip.name, chip.email)),
    )
  }

  const addSuggestion = (suggestion: RecipientSuggestion): void => {
    lastPickAtRef.current = Date.now()
    setPending('')
    setMenuOpen(false)
    if (suggestion.kind === 'group') {
      const existing = new Set(chipEmails)
      const nextTokens = chips.map(chip => contactToken(chip.name, chip.email))
      for (const member of suggestion.group.members) {
        const normalized = member.email.trim().toLowerCase()
        if (!normalized || existing.has(normalized)) continue
        existing.add(normalized)
        nextTokens.push(contactToken(member.name, member.email))
      }
      commitChips(nextTokens)
      return
    }
    commitChips([
      ...chips.map(chip => contactToken(chip.name, chip.email)),
      contactToken(suggestion.name, suggestion.email),
    ])
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    // Commit typed text before ⌘Enter / Ctrl+Enter bubbles up to Send.
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      if ((localInputRef.current?.value ?? pending).trim()) {
        commitPending()
      }
      return
    }
    const menuShowing = menuOpen && suggestions.length > 0
    if (event.key === 'ArrowDown' && menuShowing) {
      event.preventDefault()
      setActiveIndex(index => (index + 1) % suggestions.length)
      return
    }
    if (event.key === 'ArrowUp' && menuShowing) {
      event.preventDefault()
      setActiveIndex(
        index => (index - 1 + suggestions.length) % suggestions.length,
      )
      return
    }
    if (event.key === 'Enter' && menuShowing) {
      event.preventDefault()
      const active = suggestions[activeIndex] ?? suggestions[0]
      if (active) addSuggestion(active)
      return
    }
    if (event.key === 'Enter' || event.key === ',' || event.key === ';') {
      event.preventDefault()
      commitPending()
      return
    }
    if (event.key === 'Escape') {
      setMenuOpen(false)
      return
    }
    if (event.key === 'Backspace' && pending === '' && chips.length > 0) {
      event.preventDefault()
      removeChip(chips.length - 1)
    }
  }

  return (
    <div>
      <ChipField
        onClick={event => {
          const field = event.currentTarget.querySelector('input')
          field?.focus()
        }}
      >
        {chips.map((chip, index) => {
          const valid = isValidEmailAddress(chip.email)
          const avatar = senderAvatar(chip.name || chip.email)
          const atIdx = chip.email.indexOf('@')
          const chipDomain =
            atIdx > 0 ? chip.email.slice(atIdx + 1).trim().toLowerCase() : ''
          const isExternal =
            valid &&
            Boolean(activeAccountDomain) &&
            !CONSUMER_WEBMAIL_DOMAINS.has(activeAccountDomain) &&
            Boolean(chipDomain) &&
            chipDomain !== activeAccountDomain
          return (
            <RecipientChip
              key={`${chip.email}-${index}`}
              $invalid={!valid}
              title={
                valid
                  ? `${chip.email}${isExternal ? ' (external domain)' : ''} (double-click to edit)`
                  : `"${chip.email}" is not a valid email address — click or press Enter to edit`
              }
              onDoubleClick={event => {
                event.stopPropagation()
                editChip(index)
              }}
            >
              {valid && (
                <span
                  aria-hidden="true"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 18,
                    height: 18,
                    borderRadius: '50%',
                    background: avatar.bg,
                    color: avatar.fg,
                    fontSize: 9.5,
                    fontWeight: 600,
                    flex: 'none',
                  }}
                >
                  {avatar.initial}
                </span>
              )}
              <span
                tabIndex={!valid ? 0 : undefined}
                role={!valid ? 'button' : undefined}
                aria-label={
                  !valid
                    ? `Invalid recipient ${chip.email} — press Enter or click to edit`
                    : undefined
                }
                onClick={event => {
                  if (!valid) {
                    event.stopPropagation()
                    editChip(index)
                  }
                }}
                onKeyDown={event => {
                  if (!valid && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault()
                    event.stopPropagation()
                    editChip(index)
                  }
                }}
              >
                {chip.name && chip.name !== chip.email
                  ? `${chip.name} · ${chip.email}`
                  : chip.email}
                {!valid ? ' — invalid' : ''}
              </span>
              {isExternal && (
                <span
                  title={`External domain: ${chipDomain}`}
                  style={{
                    fontSize: 9.5,
                    fontWeight: 600,
                    padding: '0 4px',
                    borderRadius: 3,
                    background: 'color-mix(in srgb, var(--b-amber) 14%, transparent)',
                    color: 'var(--b-amber)',
                    lineHeight: '15px',
                    flex: 'none',
                  }}
                >
                  External
                </span>
              )}
              <button
                type="button"
                aria-label={`Remove recipient ${chip.email}`}
                onMouseDown={event => event.preventDefault()}
                onKeyDown={event => event.stopPropagation()}
                onClick={event => {
                  event.stopPropagation()
                  // The second click of a double-click (detail > 1) or any
                  // click within the pick grace period is the ghost of the
                  // selection gesture, not an intent to remove.
                  if (
                    event.detail > 1 ||
                    Date.now() - lastPickAtRef.current < 400
                  ) {
                    return
                  }
                  removeChip(index)
                }}
              >
                <X aria-hidden="true" />
              </button>
            </RecipientChip>
          )
        })}
        <ChipTextInput
          ref={element => {
            localInputRef.current = element
            if (inputRef) inputRef.current = element
          }}
          value={pending}
          aria-label={ariaLabel}
          placeholder={chips.length === 0 ? placeholder : undefined}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={event => {
            setPending(event.currentTarget.value)
            setMenuOpen(event.currentTarget.value.trim().length > 0)
            setActiveIndex(0)
          }}
          onKeyDown={onKeyDown}
          onBlur={() => {
            // Let a click on a suggestion land before the menu goes away.
            window.setTimeout(() => setMenuOpen(false), 150)
            commitPending()
          }}
        />
      </ChipField>
      {suggestions.length > 0 && (
        <RecipientMenuWrap>
          <RecipientMenu role="listbox" aria-label="Recipient suggestions">
            {suggestions.map((item, index) =>
              item.kind === 'group' ? (
                <RecipientMenuItem
                  key={`group-${item.group.id}`}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  $active={index === activeIndex}
                  onMouseDown={event => {
                    event.preventDefault()
                  }}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => addSuggestion(item)}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Users size={12} aria-hidden="true" />
                    {item.group.name}
                  </span>
                  <RecipientMenuMeta>
                    Group · {item.group.members.length}{' '}
                    {item.group.members.length === 1 ? 'member' : 'members'}
                  </RecipientMenuMeta>
                </RecipientMenuItem>
              ) : (
                <RecipientMenuItem
                  key={item.email}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  $active={index === activeIndex}
                  onMouseDown={event => {
                    event.preventDefault()
                  }}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => addSuggestion(item)}
                >
                  {item.name && item.name !== item.email
                    ? item.name
                    : item.email}
                  <RecipientMenuMeta>{item.email}</RecipientMenuMeta>
                </RecipientMenuItem>
              ),
            )}
          </RecipientMenu>
        </RecipientMenuWrap>
      )}
    </div>
  )
}
