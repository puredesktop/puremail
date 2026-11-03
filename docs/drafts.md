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

Several copies of Mail can run over one file (a window and a split), each with
its own memory, so saving merges record by record (`lib/draftsFileMerge.ts`) and
never rewrites the list from what one copy holds:

- Absence never means deleted. A draft on disk and not in memory arrived from
  another copy; a draft in memory and not on disk is written back.
- A delete is a tombstone in the file, written by the copy that deleted it: it
  held the draft when it last agreed with the file and now does not. A
  tombstone yields to a real edit made after it, to a send this copy has begun
  or left uncertain since, and to a draft new to the copy holding it (a provider
  listing it again). Tombstones expire after 90 days.
- A draft only one side changed takes that side. Both changed: sent beats unsent,
  an uncertain send beats an edit, the record settling an attempt beats that
  attempt, an attempt under way beats an edit, a draft's maker beats a copy
  imported from the account, then the later `updatedAt`. Provider bookkeeping and
  send attempts do not move `updatedAt`, so edit time alone cannot decide.
- A schedule only moves forward, so each keeps its furthest status: a copy with
  an older view cannot restart one another copy stopped.

Send runs merge the same way; delivery receipts only accumulate. A save re-reads
the file, writes only if the merge changes it, and writes conditionally (the
shell's `ifMatch`), so a copy saving in between makes it merge again. What arrives goes into this copy's store. A copy also syncs
every 15 seconds, on focus, and before the executive share looks, so it never
decides from an old view. A draft that just arrived is left to the copy that
saved it to push to the provider, or two account copies would appear.

A draft keeps its identity across provider sync. A listing begun before a save
cannot show that draft, so it is treated as gone at the account only after two
complete listings in a row without it (`providerAbsentOnce`); dropping it on the
first made the next listing bring the same message back as a new record, under
`imap_draft_<uid>` and on a made-up thread. A listing that lands before the save
is acknowledged links to the draft by the Message-ID PureMail gave it. A store
that never held the draft imports it under the id that Message-ID names and marks
it `importedFromProvider`; the store that made it speaks for it.

The mailbox cache (`mail-store.json`) is merged too (`lib/storeFileMerge.ts`),
three ways against what this copy last agreed with the file on: records by id,
strings by value, objects by key. See `agents.md`, "Several running copies".
Scheduled sends are not in it: they travel in the drafts file with the drafts they
would send. A cache from before that is read once, until the drafts file carries them.
A running copy that needs the saved record reads it with `readSavedMailStore`, which
leaves what it agreed with the files on alone; only boot uses `readPersistedMailStore`.

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

## Sends and the merge

A tombstone never ends a record that is held, preparing, submitting or unconfirmed unless a confirmed copy shows it went (`recordConfirmedSent`: a receipt or Sent copy naming the draft, or carrying the Message-ID it was submitted under). This holds whether or not the attempt had reached the saving copy's baseline, because a removal can come from a copy with an old view. The record then returns to the copy that removed it, and a real discard of a free draft still removes it everywhere. The cost is on the safe side: a window frozen with an old attempt can bring back a draft another window really discarded, and it reads unconfirmed until someone looks.

The exit writer uses `ifMatch` with the version paired with this copy's last agreed file. If another copy saved since then, the shell refuses the exit write; it never replaces newer evidence, even if its owner never saves again. Without a version the fast exit write is skipped. This needs no awaited read during unload. Normal saves still read, merge and retry on conflict.

Two copies starting one send are ordered by the conditional write: `saveDraftsFile` merges against the file and retries on a conflict, a marker (`phase: 'submitting'`) already in the file beats another attempt's, and the controller calls the mail service only if the record is still its own after that save and no confirmed copy has arrived. A record read as unconfirmed with no attempt named beats a marker that did not know of it. Both normal and fast exit writes depend on the shell's atomic `ifMatch`. A refresh interval or eventual repair is not their safety boundary.

Definite failures are tied to attempts in `mailDelivery.ts`: `sendSettledAttemptId` names the current settled outcome, and a definite rejection from another attempt leaves it alone (`MailSendError.superseded`). An older ambiguous submission is different: `sendUncertainties` retains its own attempt id, reason and submitted Message-ID beside the newer record. It does not replace the newer phase, Undo, settled identity, reason or schedule decision. `sendSupersedes` records only the predecessor attempt ids a later explicit decision knew about: this lets a stale controller's settlement preserve that later record during the actual file merge without ordering two machines' clocks. These ids and unresolved outcomes are the narrow send contract, not a general history. Its unresolved evidence makes `draftDelivery` unconfirmed even during a newer hold or submission, so no ordinary resend is offered. The person's explicit check marks that independent outcome checked; merging those entries keeps the check without comparing clocks. A genuine late settlement from a stale controller is still evidence and can require another check. A receipt still proves submission, and its attempt identity survives a subsequent sync. When a late receipt meets a newer record, that record is retained as sent evidence; different later words also stay in their own unsent draft. This is send evidence, not an activity history.


## Exit limits

A conditional exit write can be refused safely, but the departing page cannot guarantee an awaited merge will finish. Last words held only in that page can therefore be lost on forced page exit or a crash; this repair does **not** claim otherwise. Compose Close and replacement-window stash preserve them through their normal save path, and the debounced persistence/visibility path remains in place.

At ps-suite `f36884f801f4ad3e8780db6c954a82bb5267623f`, `packages/shell/src/modules/storage/jsonStore.ts` serializes the version check and file replacement per path (lines 81–94, 119–141). Mail calls it through `writePlatformStorageJson` in `src/bridge/platformBridge.ts:306`; `useMailStorePersistence` calls the exit writer from `beforeunload`. The shell's `renderer/workspace/closeTabs.ts:19,40–80` sends `workspace.willClose`, but closes after 1200 ms even without an acknowledgement. Removing a frame need not fire unload. Mail has no host-owned durable buffer for an unacknowledged stale-window edit.

To guarantee **both** preservation of saved evidence and every last word across forced exit, the missing capability is a host-owned close/save barrier that keeps the Mail frame alive until a version-checked merge is durably acknowledged (or retains the pending edit outside that frame). Mail's caller must snapshot the composer and flush persistence before acknowledging. The existing timeout notification is not that guarantee, and no awaited unload read can supply it. This is a prerequisite outside this app repair, not a proposal to invent a new shared store here. Process crashes can preserve only work already handed off durably. Separately, proving an unclaimed sender terminated still requires host instance-liveness across every device sharing the store; this task adds no such authority.

## Incomplete compose comparisons

The persisted-message parser retains records with an id without promising complete compose fields; cache compaction also drops HTML. A sent message is therefore partial comparison evidence, not a `Draft`. Missing recipients, HTML or attachment metadata never prove unchanged content, and absent comparison data keeps the whole current snapshot as a separate unsent draft. A complete known-unchanged comparison creates no duplicate. Live complete draft snapshots capture their optional empty fields before removal. Attachment hydration bytes alone still do not count as a content change.

All participating Mail copies must use the corrected writer. Older copies can still overwrite the shared drafts file unconditionally. Coordinated delivery of Mail PR73 and Executive PR77, on a host with the inspected atomic `ifMatch` contract, remains required; no upgrade, reload or release was performed here.

### Replacement attachments after a late receipt

A genuine older receipt remains authoritative for its own attempt. A later attachment replacement stays in its own unsent draft, even when its filename and MIME type did not change. Equality needs matching bytes (a compact SHA-256 digest in saved receipts) or complete matching source evidence; missing receipt data is unknown. Explicit hydration provenance and provably equal bytes survive provider bookkeeping without creating another draft. The receipt writer compares before cache compaction and retains compact identities of the formatted body and attachment content, while omitting large HTML renderings and attachment bytes from the receipt file. Neither the later draft nor repeated reopening inherits the old approval or schedule.

Allowing retry is permission to edit, not a fresh send approval. A late receipt also matches the settled attempt itself, even when no later hold populated `sendSupersedes`. A stale submitting copy therefore cannot tombstone the edited content: the matching receipt is applied before the merge, and any replacement stays in the stable unsent draft. That derived id respects saved tombstones and a pending discard, so another stale copy cannot recreate a discarded replacement. An already-confirmed record is left with its own receipt, content and time; the older receipt remains separately recorded. Both receipt routes clear submission and old provider-copy metadata from a derived unsent draft.

A provider Sent listing may contain no attachment bytes/digest and a different reference from the Drafts copy. Even unchanged content is then not provably equal and can leave an extra unsent draft; the person must check Sent and make a fresh decision before sending that copy. No name-only equality or new attachment warning is introduced.

Every receipt route, including a controller that has already taken in the later edit, uses the same content comparison and stable derived id. The controller compares against its complete approved snapshot rather than treating provider bookkeeping as changed content. An existing derived id is not appended again. A delayed provider-sync result can also reconstruct that id in memory after a discard: the writer drops a free derived copy covered by an explicit saved or pending discard before merging, and applies that removal back into the copy. This exception is limited to receipt-derived ids; the general provider-listing revival rule is unchanged, and a live or unconfirmed attempt is still protected. Clock skew does not free a discarded derived copy.
