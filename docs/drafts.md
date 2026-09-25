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
Never add a `createDraft` call at a call site; two writers race and leave two
provider drafts for one local one.

`listDrafts()` is the read half. Without it the sync is one-way by construction:
a draft written on another device can never arrive, and one sent there stays
here forever. `mergeMailDrafts` decides who wins — unpushed local edits first,
otherwise the provider's copy — and removes a synced draft the provider no
longer lists, but **only** when `syncCoverage.draftsCovered` says the fetch
actually looked. A failed listing must report no coverage; read as "there are
none" it would delete the user's drafts.

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
| Persistence | `lib/mailPersistence.ts`, `hooks/useMailStorePersistence.ts` |
| Re-home undo (store v3) | `lib/mailStoreMigration.ts` |
| Agent tools | `agents/handlers.ts`, `agents/catalog.ts` |
| Regressions from the audit | `lib/draftLifecycle.test.ts` |
| Provider contract | `lib/providerDraftContract.test.ts` |
