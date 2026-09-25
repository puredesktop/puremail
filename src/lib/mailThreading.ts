/**
 * Which conversation a message belongs to.
 *
 * The old rule keyed a message on its immediate parent — `inReplyTo`, and
 * only when that parent had already been seen in this fetch. Three things
 * followed, all of them visible in a real mailbox:
 *
 * - a chain broke after two messages, because the third keyed on the
 *   second rather than on the conversation's root;
 * - the answer depended on FOLDER ORDER, since "already seen" meant
 *   "fetched from an earlier folder" — a reply read from Inbox before its
 *   original was read from Sent started a thread of its own;
 * - with no threading headers at all (the shell transport dropped them
 *   until now) every message became its own thread, so a sent message
 *   never learned it had been answered and Sent showed "no reply" forever.
 *
 * Keying on the first reference alone is not enough either: clients
 * disagree about what References holds. One will send the whole chain
 * root-first; another sends only the message it is answering. A real
 * exchange here had our reply pointing at the conversation's root and
 * their answer pointing at OUR message, so the two never met.
 *
 * So messages are joined transitively instead: every message is linked to
 * everything it names — its parent and each of its references — and a
 * conversation is a connected component of those links. Whatever subset
 * of the chain a client chooses to cite, the component still closes over
 * it. The component is named after its earliest message, so a thread's id
 * does not change as it grows.
 */

export interface ThreadableEnvelope {
  uid: number
  messageId?: string
  inReplyTo?: string
  references?: string[]
}

/** `  <A@b.c> ` → `A@b.c`. Message-IDs travel with angle brackets and stray space. */
export function normalizeMessageId(raw: string | undefined | null): string | null {
  const trimmed = (raw ?? '').trim().replace(/^<+/, '').replace(/>+$/, '').trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * The conversation key for one message. `fallback` names the message when
 * it carries no usable id at all (a mailbox that hides Message-ID).
 */
export function conversationKey(
  envelope: ThreadableEnvelope,
  fallback: string,
): string {
  for (const reference of envelope.references ?? []) {
    const root = normalizeMessageId(reference)
    if (root) return root
  }
  return (
    normalizeMessageId(envelope.inReplyTo) ??
    normalizeMessageId(envelope.messageId) ??
    fallback
  )
}

/** A stable, id-safe thread id for a conversation key. */
export function threadIdForKey(key: string): string {
  return `imap_thread_${key.replace(/[^a-zA-Z0-9]/g, '')}`
}

/** Union-find over message ids, small and allocation-light. */
class Components {
  private parent = new Map<string, string>()

  private root(id: string): string {
    if (!this.parent.has(id)) {
      this.parent.set(id, id)
      return id
    }
    let node: string = id
    for (;;) {
      const next: string = this.parent.get(node) ?? node
      if (next === node) return node
      // Path halving keeps the tree flat without a second pass.
      const above: string = this.parent.get(next) ?? next
      this.parent.set(node, above)
      node = above
    }
  }

  join(a: string, b: string): void {
    const rootA = this.root(a)
    const rootB = this.root(b)
    if (rootA !== rootB) this.parent.set(rootA, rootB)
  }

  find(id: string): string {
    return this.root(id)
  }
}

export interface DatedEnvelope extends ThreadableEnvelope {
  /** ISO date; the earliest message in a component names it. */
  date?: string
}

/**
 * Conversation keys for a whole fetch, in one pass over every folder.
 *
 * The returned map is keyed by each envelope's `fallback` (the caller's
 * stable per-message handle), so the caller need not re-derive anything.
 * Order of the input does not affect the result.
 */
export function assignConversationKeys<T extends DatedEnvelope>(
  envelopes: readonly { envelope: T; fallback: string }[],
): Map<string, string> {
  const components = new Components()
  const idOf = new Map<string, string>()

  for (const { envelope, fallback } of envelopes) {
    const own = normalizeMessageId(envelope.messageId) ?? fallback
    idOf.set(fallback, own)
    components.join(own, own)
    const parent = normalizeMessageId(envelope.inReplyTo)
    if (parent) components.join(own, parent)
    for (const reference of envelope.references ?? []) {
      const id = normalizeMessageId(reference)
      if (id) components.join(own, id)
    }
  }

  // Name each component after its earliest message — a stable choice that
  // does not move as later replies arrive.
  const namer = new Map<string, { id: string; date: string }>()
  for (const { envelope, fallback } of envelopes) {
    const own = idOf.get(fallback)!
    const root = components.find(own)
    const date = envelope.date ?? ''
    const held = namer.get(root)
    if (!held || date < held.date || (date === held.date && own < held.id)) {
      namer.set(root, { id: own, date })
    }
  }

  const keys = new Map<string, string>()
  for (const { fallback } of envelopes) {
    const own = idOf.get(fallback)!
    keys.set(fallback, namer.get(components.find(own))?.id ?? own)
  }
  return keys
}
