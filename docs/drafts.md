# Drafts

How drafts work, and the rules that keep them working. Written after an audit
that found twenty ways a draft could go missing; each rule below exists because
its absence cost someone a draft.

## The model

A draft belongs to **the conversation it answers**. `Draft.threadId` is that
conversation and nothing else. It is not "which folder this is in", and the two
must never be conflated again — that overload is what forced generated drafts
to be "re-homed" onto synthetic `thread_draft_*` threads, which detached every
one of them from the email it was replying to.

**Drafts is a view, not a folder.** `in:Drafts` and `is:draft` resolve through
the same predicate, `threadHasUnsentDraft` in `lib/mailQuery.ts`: a conversation
appears under Drafts while it holds an unsent draft and drops out the moment it
is sent, without ever leaving the inbox. This is how Gmail behaves, and it makes
"a sent draft moves to Sent" true by construction rather than by a move.

A composed message (a new conversation, answering nothing) is the one draft that
gets its own thread — `thread_compose_*`, filed in the Drafts mailbox. Once sent,
that thread moves to Sent, and is dropped as soon as a sync returns the
provider's real thread for the same message.

Everything counts as a draft, including the ones that went wrong. A generated
draft that failed appears in Drafts and on its thread with the reason and a
retry. Hiding those is how work an agent reported doing became findable nowhere
at all.

## Sync

One rule, one place: `hooks/useDraftProviderSync.ts` watches the store and
pushes any draft that has changed and then stopped changing —
`createDraft` when there is no `providerDraftId`, `updateDraft` when there is.
Definite save failures retain `providerSaveError` in the drafts file so Mail
recovery can explain them after the toast or a restart. A successful account
save clears it. It does not impose the retry lock used for uncertain saves.
Never add a `createDraft` call at a call site; two writers race and leave two
provider drafts for one local one.

`listDrafts()` is the read half. Without it the sync is one-way by construction:
a draft written on another device can never arrive, and one sent there stays
here forever. `mergeMailDrafts` decides who wins — unpushed local edits first,
otherwise the provider's copy — and removes a synced draft the provider no
longer lists, but **only** when `syncCoverage.draftsCovered` says the fetch
actually looked. A failed listing must report no coverage; read as "there are
none" it would delete the user's drafts.

IMAP reads Drafts independently of the incoming-message date window, because
unsent work can be older than that window. Only an exhausted folder listing
reports complete draft coverage; the paging safety limit, a repeated page, or
a missing Drafts folder cannot prove an absent draft was sent or deleted.

IMAP account drafts carry a stable draft Message-ID across APPEND/delete
replacements. A changed UID is correlated only when a complete listing shows
one matching Message-ID in the same account and one local candidate. Ambiguous
copies remain separate. Competing edits preserve both versions in Mail recovery;
choosing the account version replaces its complete content, including absent
HTML, Cc and Bcc fields after restart. SMTP submission receives a separate
Message-ID so a stored draft never counts as delivery confirmation.
Complete Drafts coverage also removes obsolete cached Draft message bodies and
their empty conversations, including conversations moved to Sent locally.
Incomplete listings retain those copies; live newer replies remain editable.

Discarding removes the draft at the provider too, and that is
`useDraftProviderSync`'s job rather than the shell's — because only the thing
holding the in-flight `createDraft` promise can delete a draft discarded
mid-save, where there is no `providerDraftId` to delete yet. A failed delete
retries: the local copy is already gone, so a delete that quietly fails lets
the next sync add the draft straight back, and the discard looks undone.

Sending a synced draft goes through the provider's own draft-send
(Gmail `drafts.send`), with the current content pushed first. `messages.send`
alone leaves the provider draft behind, and it comes back on the next fetch as
an unsent message inside the conversation you just replied to.

## Persistence

Drafts are written to their own file, `mail-drafts.json`, before and separately
from the mailbox cache. They are the only mail state a user cannot get back: a
message can be re-fetched, an unsent reply cannot. A cache write that fails must
never take unsent mail with it.

Nothing goes in `localStorage`. A normal Gmail window serialises to about 6.4MB
against a ~5MB origin quota, and past it every write throws silently — which is
what made drafts an agent really did create come back "never written".

Keystrokes do not reach the store. `useDraftBodyBuffer` holds the composer body
until typing pauses, blur, or send; writing per keypress re-serialised the whole
mailbox on the main thread.

An open compose window also snapshots its fields into the same draft store
after a 350 ms pause; it does not wait for Close. The ordinary persistence and
provider-sync hooks remain the only writers. Context changes caused by provider
bookkeeping do not count as edits, and a pending autosave cannot resurrect a
consumed draft or overwrite a conflict or an uncertain send.

Compose identities are opaque UUIDs. Callers inside React state updaters mint
the identity and timestamp before the updater so replaying it is deterministic.

## Confirmed sending and recovery

Electron does not preserve custom Error properties. Mail opts into structured
SMTP outcomes through the generic transport: definite pre-submission failures
and SMTP rejections are `not_sent`; an unexplained socket closure remains
`uncertain`. A missing or malformed receipt never proves success. Legacy shells
still reject failed calls, and legacy clients keep receiving rejected promises.

SMTP acceptance is distinct from saving mailbox copies. An accepted message is
not shown as “Sending”; partial recipient rejection is retained in its receipt
and through sync. Its original draft is consumed so the accepted recipients
cannot receive an automatic retry. Correct rejected addresses in a separate
message.

Before filing Sent, the IMAP provider searches the exact Message-ID; some SMTP
services already file a copy. Sync keeps a mirrored Sent copy visible without
duplicating the message and follows the provider thread when it replaces a
local composed thread.

Mail recovery remains reachable in the account menu after its toast closes.
“Repair Sent / Drafts copies” searches the Message-ID, appends only a missing
Sent copy, and removes only the recorded consumed draft UIDs. It never calls
SMTP. A failed Sent append retains the exact transmitted MIME in the durable
receipt so attachment bytes survive a restart; that MIME is released once the
Sent copy is confirmed. Concurrent repairs share one job, and a repair after a
lost APPEND acknowledgement searches again before writing.

## Rules for anything touching drafts

- **`setStore` updaters must be pure.** No assigning to outer variables inside
  one, and no `setStore(() => snapshot)` built from a ref — React may run an
  updater more than once and keep one result, and a whole-store replacement
  discards anything that landed in between. Compute ids *before* the updater and
  pass them in.
- **Never mint a reconstructible draft id.** Generated ids used to be
  `autodraft_<threadId>`, so anything that lost track of a draft rebuilt the
  same id and the collision overwrote the finished draft with an empty one. Look
  drafts up by conversation; let the id be opaque.
- **A capability flag is a promise.** `capabilities.drafts` means create, update
  and delete all work and `listDrafts` exists. `providerDraftContract.test.ts`
  enforces it for every provider.
- **Report what happened, not what you started.** The `draftReply` tool waits
  for the result and returns a `draftId` and a real status. A tool that returns
  before the work is done teaches the model to claim work it did not do.

## Where things live

| Concern | File |
| --- | --- |
| Draft predicate, query resolution | `lib/mailQuery.ts` |
| Draft records, send, merge | `lib/mailModel.ts` |
| Provider sync loop | `hooks/useDraftProviderSync.ts` |
| Composer buffer | `hooks/useDraftBodyBuffer.ts` |
| Open composer snapshots | `hooks/useComposeDraftAutosave.ts` |
| Provider thread replacement | `lib/mailReaderSelection.ts` |
| Persistence | `lib/mailPersistence.ts`, `hooks/useMailStorePersistence.ts` |
| Re-home undo (store v3) | `lib/mailStoreMigration.ts` |
| Agent tools | `agents/handlers.ts`, `agents/catalog.ts` |
| Regressions from the audit | `lib/draftLifecycle.test.ts` |
| Provider contract | `lib/providerDraftContract.test.ts` |
