# Replacement attachments and late receipts — req-0039 continuation

An older genuine receipt now keeps its own submission authoritative while an attachment-only replacement survives as a separate unsent draft. It has no hold, submission identity or schedule and needs a fresh explicit send decision. Names and MIME types alone no longer count as file identity. No composition flow, warning or sending authority was added.

## Current review — provider-normalized receipts and draft revisions

The receipt comparison now uses normalized email addresses within each separate To, Cc and Bcc list. It normalizes CRLF and surrounding whitespace in plain text and raw HTML. This follows the provider round trip exercised by the new synthetic Gmail payload and IMAP envelope fixtures. Meaningful body, address-list and HTML edits remain in their own unsent draft. Attachment equality continues to require byte/hash or complete source evidence.

A discarded derived record is classified as reconstructed only when this copy lacks a baseline for that id or its persisted fingerprint still equals that baseline. A known draft that was edited follows the normal record merge. The writer returns the rejected snapshot fingerprint to its running copy, so an edit made while the save is completing can survive application of the result. The writer carries the fingerprint in its transient change result. This replaces the broad derived-id discard rule that could erase an agent's real edit.

Pending explicit discards are now honored in the disk-arrival loop for records this copy has never agreed with. Confirmed sent copies also reject reconstruction of their derived id. Existing live-send and uncertainty evidence protects an attempt during these decisions. Tests exercise the actual `updateDraft` handler, the before-first-save discard, sent-derived reconstruction, and repeated reopening over the real conditional writer.

### Evidence limits

Parsed names, address casing, line endings and surrounding whitespace are handled by the comparison. Other HTML serialization changes may still lack sufficient evidence. A compacted receipt keeps only a digest of its original HTML, and that digest cannot itself be normalized. The comparator accepts a matching exact or canonical candidate digest. When neither matches, or when text/contact/attachment comparison data is incomplete, Mail conservatively keeps a separate unsent copy. That copy requires a Sent check and a fresh explicit decision before sending. The earlier limitation concerning different Drafts/Sent attachment references without bytes or a digest still applies. This limitation now covers unavailable text/recipient/HTML evidence as well.

### Delivery snapshot and manifest labels

This review inspected Mail PR77 at `efd10530ebe04106b3cdf68779c38c5bf6fb13a5`, paired with Executive PR91 at `143fb6431e016d4a668b87c0cd178e9939eb5696`, on `puredev/keep-replacement-attachments-when-late-r-f83756`. Normal PureDev delivery and local heads agree. The integration confirms Mail's head and reports Executive PR91 as inaccessible with 404. The full blob manifest identifies tested content beyond that inspected snapshot. PureDev owns commits, pushes and ordinary review.

Mail PR73 and Executive PR77 remain predecessor evidence. The supported Mail PR73 read reports it open. Its disposition remains the owner's decision, and both copies of the work must not be merged. No PR was closed or merged here.

Machine-specific paths in the current manifest are replaced with relative installation, repository and worktree labels. Source/package hashes and retained check identities are preserved. Exact local delivery records and verification logs remain in ignored verification artifacts. The manifest records their hashes.

### Current check results

The checked-in app configs and retained installation were used serially. All **273 Mail / 281 Executive source/config files** match the tested copies. Fresh package checks have zero mismatches, the suite installed lock matches, and **4,561 shared-source / 102 Knowledge files** match the resolved installation. App-specific installed-lock evidence remains unavailable. Current manifest paths are relative labels.

| Check | Full command from the app in `.verification/suite/apps/` | Exit | Cases / files / skips |
|---|---|---:|---|
| Mail affected | `../../node_modules/.bin/vitest run src/lib/twoCopies.test.ts src/lib/draftsFileMerge.test.ts src/lib/mailReceiptRevisions.test.ts src/lib/mailSendSettlement.test.tsx src/lib/mailSendOutcome.test.tsx` | 0 | **339 passed / 5 files / 0 skipped** |
| Mail full | `../../node_modules/.bin/vitest run` | 0 | **1,718 passed / 118 files / 0 skipped** |
| Mail typecheck | `../../node_modules/.bin/tsc -p tsconfig.json --noEmit` | 0 | final source |
| Mail build | `./node_modules/.bin/vite build` | 0 | checked-in build config |
| Executive full rerun | `../../node_modules/.bin/vitest run` | 1 | **631 passed / 5 failed / 114 files / 0 skipped** |
| Executive typecheck | `../../node_modules/.bin/tsc -p tsconfig.json --noEmit` | 0 | matched source/config |
| Executive build | `./node_modules/.bin/vite build` | 0 | checked-in build config |
| Retained complete Executive main `3f0641e…` | `../../node_modules/.bin/vitest run` | 1 | **556 passed / 6 failed / 107 files / 0 skipped** |

The final regression command against delivered Mail `efd1053…` reports **10 failed / 35 passed / 3 files / 170 skipped**, exit 1. The three changed production files were replaced with their exact delivered blobs for that negative run, then restored. Final source passes those cases. Exact command and all per-stage source/log hashes are in `review3Followup` of the manifest.

```sh
../../node_modules/.bin/vitest run src/lib/twoCopies.test.ts src/lib/draftsFileMerge.test.ts src/lib/mailReceiptRevisions.test.ts -t 'receipt parsed by|agent edit of a known|pending discard before|confirmed sent derived|discarded receipt-derived copy|incomplete .* contact evidence|partial draft .* evidence'
```

The 44 added cases cover 36 parser-backed receipt rows, three actual persistence races and five incomplete contact/compose comparisons. The Gmail rows run the real payload parser through a fake HTTP adapter. IMAP rows run the real envelope-to-message mapping through a fake transport. Plain, raw HTML and compacted HTML cases include multiline bodies and nameless contacts. Meaningful body/To/Cc/Bcc/HTML edits remain preserved. Existing attachment identity, controller/sender, Close/stash/autosave, exit, boot/load, no-age-inference, dispatch, schedule/Undo, persistence-failure and duplicate-approval tests remain covered by the full suite.

The initial probe had **16 failed / 23 passed / 1 file / 142 skipped**, including eight fixture assertions requiring an absent optional property. Those assertions were corrected before the final negative run. The first full Mail stage had **1,715 passed / 1 failed / 118 files**, exit 1, because the new test fixture used a literal provider comparison caught by the parity guard. The fixture now uses a discriminated switch, and final affected/full/typecheck/build checks pass. The guard remains enforced. These intermediate stages are retained separately.

Executive again passes all 62 consumer, nine CTO-run and four CTO-adoption cases. Its question-card case passes in **9,790 ms**, and the historical first-run CTO-adoption case passes in **30,063 ms**. The five failures match the import-boundary/DecisionAssignmentLinks/LeadWorkspace failures named in retained baseline evidence below. The pinned baseline's additional signed-out timeout passes here. The historical two-card cause remains unproven. No flaky or unrelated classification is made. The accepted host close/save prerequisite, atomic `ifMatch` dependency and all-copies requirement remain recorded. No live desktop validation is claimed.

### Current description delivery

The final supported description update for Mail PR77 returned HTTP 403, “Resource not accessible by integration”. The supported Executive PR91 read returned HTTP 404, so its update was not attempted. The exact replacement bodies and their hashes are retained. The pending step is for normal PureDev delivery to apply `docs/send-evidence-pr-description.md` from each app to Mail PR77 and Executive PR91. No credential or permission changes were attempted.

## Review 2 — retained receipt-route correction

A sender that had taken in the later edit used to create a random-id unsent draft in `settleReceipt`, while the receipt-aware file writer created a second stable-id draft. The controller now delegates to `draftAfterEarlierReceipt` using the complete approved snapshot, so controller, provider sync and persistence agree on comparison and the same `draft_compose_after_<draft>_<attempt>` identity. An existing derived draft is retained instead of appended again. This also prevents a spurious copy when attachment bytes/source prove sameness despite provider part-id bookkeeping.

The expanded actual two-copy matrix covers the sender both stale and caught up before its callback, with and without a fresh approval, plain/formatted bodies, changed bytes/identity/remote reference, incomplete receipt evidence and provably unchanged controls. Reopening repeats three times, with exactly one fake submission. Provider-sync races separately apply a delayed result after another copy's saved discard or the same copy's pending discard, for bytes/identity/reference replacements, including a future `updatedAt` to reject clock inference.

Before the merge, the writer now rejects free receipt-derived records whose reserved id has an explicit saved or pending discard, and applies that rejection back into the running copy. This closes the provider-sync resurrection route as well as the file-generation route. The general provider-id revival branch is unchanged. A held, preparing, submitting or unconfirmed send retains its existing evidence protections; the special application rule concerns a free discarded derived copy, not a clock comparison. Existing original-provider records and conflicting alternate writing retain their protections.

### Delivery identity and ownership

The inspected delivery snapshot is **[Mail PR77](https://github.com/puredesktop/puremail/pull/77)** at `a9ea5c78092b409caf7ca7b5f634a1e898c43082`, paired with **[Executive PR91](https://github.com/purescience-inc/pureexecutive/pull/91)** at `8c03f856d3f3a243553aa8b99f77aa43e3ac4f86`, branch `puredev/keep-replacement-attachments-when-late-r-f83756`. Normal PureDev run `f8375650-4011-43d2-8dd2-d5f64d3fd3dd` and local heads agree. The supported GitHub read confirms Mail's head; Executive PR91 still returns 404 to the integration, so no independent remote-head read is claimed there. The full blob manifest identifies the tested content beyond this snapshot. PureDev owns commits, pushes and ordinary review; this handoff does not depend on whether another delivery has since advanced the branch.

Earlier **Mail PR73 / Executive PR77** are predecessor evidence, not the targets of this review. The supported read still reports Mail PR73 open. The owner must decide its disposition; do not merge both copies of the work. No old PR was closed or merged here. Executive runtime/tests/config and ps-suite are unchanged; Executive's documents identify the current pair and source evidence. The historical sections below retain each earlier check and delivery stage rather than presenting them as the latest heads or results.

### Current checks and source correspondence

Checks ran serially with the real checked-in configs, no timeout/plugin/config overrides, and the same retained installation. Final inventories: **272 Mail / 281 Executive source/config files**, byte-for-byte equal to the tested copies. The direct installed-package hashes and suite installed lock match retained evidence; app-specific installed-lock evidence remains unavailable and is not invented. Fresh comparison also finds zero differences in **4,561** resolved shared-source files and **102** Knowledge files. Executive's source/config blobs match both delivered `8c03f85…` and the preceding tested candidate. This demonstrates why the retained complete pinned-baseline result remains comparable.

| Check | Full command (from `.verification/suite/apps/<app>`) | Exit | Cases / files / skips |
|---|---|---:|---|
| Mail affected | `../../node_modules/.bin/vitest run src/lib/twoCopies.test.ts src/lib/draftsFileMerge.test.ts src/lib/mailReceiptRevisions.test.ts src/lib/mailSendSettlement.test.tsx src/lib/mailSendOutcome.test.tsx` | 0 | **295 passed / 5 files / 0 skipped** |
| Mail full | `../../node_modules/.bin/vitest run` | 0 | **1,674 passed / 118 files / 0 skipped** |
| Mail typecheck | `../../node_modules/.bin/tsc -p tsconfig.json --noEmit` | 0 | final source |
| Mail build | `./node_modules/.bin/vite build` | 0 | checked-in app config |
| Executive full rerun | `../../node_modules/.bin/vitest run` | 1 | **631 passed / 5 failed / 114 files / 0 skipped** |
| Executive typecheck | `../../node_modules/.bin/tsc -p tsconfig.json --noEmit` | 0 | unchanged runtime/config |
| Executive build | `./node_modules/.bin/vite build` | 0 | checked-in app config |
| Retained complete pinned Executive baseline `3f0641e…` | `../../node_modules/.bin/vitest run` | 1 | **556 passed / 6 failed / 107 files / 0 skipped** |

The final new regression command run against delivered Mail `a9ea5c7…` reports **35 failed / 12 passed / 2 files / 121 skipped**, exit 1. Only the four changed production files were replaced with their exact delivered blobs in the disposable app copy for that negative run, then restored. Final test/source hashes, all full commands/exits/counts, and raw-log hashes are in `review2Followup` of the manifest. The initial negative probe stage (before the last guard test) remains separately recorded as **34 failed / 12 passed / 1 file / 96 skipped**. Exact final regression command:

```sh
../../node_modules/.bin/vitest run src/lib/twoCopies.test.ts src/lib/draftsFileMerge.test.ts -t 'sender has taken in the edit before receipt: true|two-copy provider sync cannot resurrect|discarded receipt-derived copy'
```

The Mail full run adds **47** cases to the prior 1,627-case stage: 40 caught-up sender rows, six provider-sync discard races, and one application test covering clock skew, all three live phases, uncertainty and ordinary provider records. It retains all previous attachment, controller/sender, actual Close/stash/autosave, exit, boot/load, no-age-inference, two-copy dispatch, schedule/Undo, persistence-failure, duplicate-approval and receipt cases. All services/files are fake. No live desktop validation is claimed; known tooling base-config/chunk-size warnings remain.

Executive again passes all **62** consumer cases, all **9** CTO-run cases (question-card case **8,474 ms**) and all **4** CTO-adoption cases. Its five failures are exactly the named import-boundary/DecisionAssignmentLinks/LeadWorkspace failures retained below and reproduced on the pinned full baseline. The baseline's additional signed-out timeout passes here. The historical two-card cause remains unproven; no flaky/unrelated classification or CTO workflow repair is made. Review 1's results, its initial typecheck failure, task5's first-run CTO-adoption failure and every earlier limitation remain at their actual historical stages below.

### Current posting result and next delivery step

The supported **Mail PR77** update with the exact current saved description again returned **HTTP 403, “Resource not accessible by integration”**. **Executive PR91** returned **HTTP 404** on supported read, so no update was attempted there. The exact bodies remain in each repository's `docs/send-evidence-pr-description.md`; their hashes and the tool responses are recorded under `review2Followup` in the manifest. No alternate account, TLS bypass, credential or permission change was used.

Normal PureDev delivery must apply these source changes and the two exact descriptions to **Mail PR77 / Executive PR91** on `puredev/keep-replacement-attachments-when-late-r-f83756`, then run ordinary review. The owner decides the open predecessor Mail PR73's disposition; no predecessor PR was closed or merged here, and both copies of this work must not be merged. The accepted host prerequisite is unchanged and does not block this app-only correction. No evidence-only commit or future delivery receipt is required for worker checks. These statements identify ownership and inspected evidence rather than asserting a commit state that later delivery could invalidate.

## Review 1 — retained delivery snapshot

Normal PureDev delivery has now created **[Mail PR77](https://github.com/puredesktop/puremail/pull/77)** at `6047fc4735fbc8485e48b862eb1d9f4212cc4ee6` and **[Executive PR91](https://github.com/purescience-inc/pureexecutive/pull/91)** at `cee10343cd1088919325549efc8fae392b457e02`, on `puredev/keep-replacement-attachments-when-late-r-f83756`. These are the current reviewed pair and the targets for these working-tree fixes. The earlier **Mail PR73 / Executive PR77** at `2bdde1f…` / `c7696c2…` are retained predecessor evidence, not this review's delivery targets. Mail PR73 is still open; no old PR has been closed or merged by this worker. PureDev delivered a new pair despite the original reuse instruction; do not mistake the predecessors for the corrected pair or merge both copies of the work.

The current identities come from normal PureDev run `f8375650-4011-43d2-8dd2-d5f64d3fd3dd` (pushed `2026-11-03T18:12:44.878Z`) and exact local heads. The supported GitHub read independently confirms Mail PR77/head `6047fc4…`; Executive PR91 still returns HTTP 404 to this integration, so its remote head is not independently claimed. This was the delivery snapshot inspected in review 1; PureDev owns commits, pushes and ordinary review. Earlier statements below about no worker commit describe the earlier worker stage, before PureDev delivery.

Claude Code identified a real gap that the earlier worker PASS verdict missed: after “I checked Sent — allow retry”, editing without a new press did not add `sendSupersedes`, so a stale sender's accepted receipt could tombstone the replacement. Receipt-aware persistence now also matches the settled attempt's own identity. The existing `confirmed` exclusion retains that receipt's evidence record, and the comparison decides whether to create the stable unsent draft. Tests use the retry button's exact patch, no new hold, a stale sender with no look before its callback, unchanged attachment labels and other compose fields, three reopening passes, equal-content controls, and one fake service call. Later words are covered too.

The review also reproduced a discarded derived draft returning from a third stale copy. Derived drafts now respect both saved tombstones and a pending local discard. Already-confirmed records retain their own content/time/message id when an older receipt arrives, through the shared helper, controller callback and real persistence/application. Both receipt routes build unsent drafts through one cleanup helper: submission metadata, sent-recipient snapshots and old provider identities/revisions/save state do not carry over. No Executive runtime, host production code, sending authority, warning or compose flow changed.

Review check results and exact source mapping are recorded below and in the manifest; preceding counts remain historical stages.

## Review 1 — retained follow-up checks

Checks ran serially using the same pinned verification layout, real checked-in configs and unchanged dependency installation described below. No app config, timeout, plugin or shared stub was changed. Current source/config inventories are **272 Mail / 281 Executive**, byte-for-byte equal to the tested copies; the manifest records every blob. Executive's entire source/config inventory also matches delivered `cee1034…`, so the retained complete pinned-baseline run remains valid comparison evidence. The review reran its full candidate suite instead of substituting selected-file passes.

| Current check | Command (from `.verification/suite/apps/<app>`) | Exit | Cases / files / skips |
|---|---|---:|---|
| Mail affected | `../../node_modules/.bin/vitest run src/lib/twoCopies.test.ts src/lib/mailReceiptRevisions.test.ts src/lib/mailSendSettlement.test.tsx src/lib/mailSendOutcome.test.tsx` | 0 | **223 passed / 4 files / 0 skipped** |
| Mail full | `../../node_modules/.bin/vitest run` | 0 | **1,627 passed / 118 files / 0 skipped** |
| Mail typecheck | `../../node_modules/.bin/tsc -p tsconfig.json --noEmit` | 0 | clean final source |
| Mail build | `./node_modules/.bin/vite build` | 0 | checked-in app build config |
| Executive full | `../../node_modules/.bin/vitest run` | 1 | **631 passed / 5 failed / 114 files / 0 skipped** |
| Executive typecheck | `../../node_modules/.bin/tsc -p tsconfig.json --noEmit` | 0 | unchanged runtime/config |
| Executive build | `./node_modules/.bin/vite build` | 0 | unchanged runtime/config |
| Retained pinned Executive full baseline `3f0641e…` | `../../node_modules/.bin/vitest run` | 1 | **556 passed / 6 failed / 107 files / 0 skipped** |

The final regression set was also run against delivered Mail `6047fc4…`, replacing only the three changed production files in the disposable tested copy and restoring them afterward. It fails **26 assertions / 2 files / 73 skipped** (exit 1) before the fix: no-reapproval attachment replacements/controls in plain and formatted bodies; later words; third-copy resurrection; already-confirmed receipt protection; and both unsent-copy cleanup routes. Final source passes all of these. Exact command:

```sh
../../node_modules/.bin/vitest run src/lib/twoCopies.test.ts src/lib/mailReceiptRevisions.test.ts -t 'new approval after allowing retry: false|stale third copy|allowing retry and editing words|persistence does not let|already confirmed record|later draft carries content'
```

The review's first full Mail run also passed all 1,627 cases, but its following typecheck exited **2** on an optional attachment-list value in the new test fixture. That annotation was corrected; final affected/full/typecheck/build were rerun, rather than reporting the intermediate typecheck as clean. The final cleanup preserves conflicting alternate writing while clearing obsolete copy metadata. Intermediate logs/counts are retained in the manifest alongside the final checks.

Executive's five failures are the exact five named below and in the pinned baseline. All **62** consumer cases pass again (35 parser, 17 existing card, 10 actual Send/No host). All **9** CTO-run cases pass, including the question-card case (**8,304 ms**) and signed-out recovery (**12,453 ms**). All **4** CTO-adoption cases pass, including the historical first-run failure (**26,079 ms**). No new Executive failure or consumer regression is demonstrated. The historical two-card cause remains unproven; it is not called unrelated or flaky. The accepted forced-close host prerequisite, atomic `ifMatch` dependency, all-copies requirement and earlier failed stages remain below.

## Review 1 — retained posting attempt

The supported update of **Mail PR77** with the exact current saved description returned **HTTP 403, “Resource not accessible by integration”**. The supported read of **Executive PR91** returned **HTTP 404**, so no update was attempted or claimed there. The exact two replacement bodies remain in each repository's `docs/send-evidence-pr-description.md`; hashes and the responses are retained in the manifest. These are current-target results, distinct from task5's historical Mail PR73 403/Executive PR77 404. No TLS bypass, alternate account, credential or permission work was used.

Precise pending step: normal PureDev delivery updates the delivered **Mail PR77 / Executive PR91** on the `…f83756` branch with the source corrections and the two saved descriptions, then runs ordinary review. The predecessor PRs remain untouched. There is no required owner choice about the accepted host prerequisite before this app-only correction, and no evidence-only commit or future delivery receipt is a prerequisite for worker checks. This worker made no commit, push or merge; PureDev's preceding delivered commits are explicitly identified above.

## Source and normal delivery — retained initial stage

The prepared worktrees started clean on newer main content: Mail `9d4b4aa37fd8a7c09e7b33d2e4fca857d33edcaf` (tree `63953ac4b0221a04356fb68569ce19165dff7e16`) and Executive `0303b1e7978a839ea36ab71fd1fc55f19b4380a2` (tree `8d838eb95d812c8c0f730e1dc378209e8dcfe3ef`). The retained changes were reconciled by file against their common ancestors, without conflicts, preserving intervening main work. The initial worker performed no branch switch, commit, push or merge. Its instruction was to reuse the earlier pair; PureDev subsequently delivered the actual PR77/PR91 pair identified above on the supplied `puredev/keep-replacement-attachments-when-late-r-f83756` branch.

The existing branch refs resolve to exact Mail `2bdde1f8512128b2fa7aa7b532f5b34ce0a29837`, tree `9a3964d5f3006dbd48d350f7dbd26aacfbbb1e5d`, and Executive `c7696c29e6bda097dbb29cec638bac27ad5e6cf3`, tree `47426b0c8dde5a456022991fc3e00de05e69c729`. Both complete source trees were read from those local objects. This is the actual companion source, not a projection from Mail's status producer.

Normal PureDev record `0f31748e-9acb-4752-9849-8f358b30f3cf`, task `09d28175-8cad-4d15-8635-2041a7f2980b`, in the retained `latest/workspace/.appdata/dev-runs.json` records Mail `2bdde1f…`, pushed at `2026-11-03T05:46:51.420Z`, PR73, and `together` Executive `c7696c2…`, PR77, on that same existing branch. Its phase is `needs-you` for the documented host prerequisite; it has no completed review entries. GitHub's supported read independently reports PR73 open at `2bdde1f…`; PR77 and a direct read of `c7696c2…` still return HTTP 404. The normal record plus exact local objects establish the retained pair; remote PR77 access is not claimed.

[The current manifest](send-attachment-verification.json) identifies every tested source/config blob and maps task5's full changed Mail and Executive blobs to their actual retained commits and this candidate. All task5 manifest blobs match their retained commits in full. The retained exit/controller/compose/merge assertions and production rules remain; the stash fixture now explicitly holds the clock before autosave, and the attachment comparison/compaction files have the current identities recorded in the manifest. Mail's shell also retains current main's archive-sweep integration. Executive retains current main's additional room functionality. These intervening changes were not reversed.

## Attachment correction

`draftAfterEarlierReceipt` compares corresponding attachment labels plus canonical bytes, using SHA-256 when receipt bytes have been compacted. A complete matching remote reference can establish the same immutable source even when a local part id was remapped; explicit `hydratedFrom` provenance bridges a hydrated copy to that source. Different bytes take precedence over matching ids/references. A missing list, bytes, usable source or other incomplete evidence is unknown, never equality. Equal bytes permit legitimate provider part-id/display-size bookkeeping without making a duplicate.

Content identities are captured before either persistence surface compacts a receipt. The drafts-file writer compares full in-memory drafts before dropping re-fetchable bytes; an exact compacted version of that same record may use its full comparison evidence, without borrowing across different edits or attempts. Saved receipts retain compact formatted-body and attachment-content digests, while continuing to omit large HTML renderings and attachment bytes. This is needed so a stale second copy with a provably unchanged formatted draft does not manufacture a duplicate merely because the receipt was compacted. Old receipts without sufficient evidence remain conservative. Current draft bytes always take precedence over a carried receipt digest.

The saved receipt still names the old `sentDraftId`/`sentAttemptId`. Its evidence record retains the newer attempt's identity, reason and stopped schedule, but its attachments come from the older receipt, never the replacement. Missing receipt attachment data is not filled from the replacement. The later draft's stable id makes repeated sync and conditional-write retries/reopening idempotent. It receives no old approval or schedule.

The actual provider-sync and actual two-copy persistence/application tests isolate ten attachment scenarios while keeping subject, recipients, plain body and formatted body unchanged (the two-copy cases run both without HTML and with unchanged formatted HTML): changed local bytes with identical labels/id; changed attachment identity; changed remote reference; absent receipt list; receipt labels/id with no content/source; neither side having content evidence; an incomplete receipt reference; complete equal bytes with changed provider bookkeeping; complete equal remote evidence; and explicit hydration of the same file. The real controller and sender coverage is retained, with one fake service call, old-attempt receipt authority, newer failure/Undo evidence and stopped schedules, repeated persistence/readback and reopening. No real service is accessed.

### Provider Sent-copy comparison limit

A normal provider Sent listing often has no bytes or digest and uses a different immutable source reference from the Drafts copy. Those labels alone cannot prove sameness. In that case even an unchanged draft may be retained as a conservative extra unsent draft; the existing receipt still proves what went, and the extra copy must not be sent without a fresh decision and a check of Sent. Equal-byte and complete equal-source controls prove the no-duplicate cases; they do not claim equivalence across different provider references without content evidence. This review documents that limit rather than treating missing evidence as equality or adding a new warning/flow.

## Actual Executive consumer

| Surface | Actual candidate blob | Relevant source evidence |
|---|---|---|
| Parser/status | `5b444497b78ed14b17964dfd29124b24eb4286ec` | `src/lib/replies.ts:102–106` maps unknown states to unconfirmed; `121–139` parses additive delivery/reasons and `discardedBy`; `152–168` requires actual sent/discard evidence; `173–179` observes a changed status-file `at` relative to the value captured at approval, rather than ordering two machines' clocks; `186–201` blocks Send/No on unresolved evidence. |
| Existing card | `864a5b07362e086142548d86c0d589432b62f5d1` | `src/screens/ReplyCard.tsx:37–42,60–67,78–84`: only Mail's sent state says sent; a settled corrected uncertainty stays visible without reopening the old decision; Send/No use the shared blocks. |
| Send dispatcher | `0a1f50a8d98d04d0ea969bb4dba9dc074b5b2a57` | `src/runner/dispatcher.ts:1916–1970`: rereads status, validates the proposed decision, uses `planRelease`, stores the observed `fileAt`, and treats a press as approval until Mail confirms. |
| No dispatcher / later settlement | same dispatcher blob | `1988–2019` rereads Mail and applies `noBlock` before writing a discard; `2021–2038` only settles from evidence and clears an answered release without inventing sent; `2951–2959` reads status files for existing reply decisions, including recent settled ones, so Mail's correction of an older stale discard reaches the existing card. |
| Release plan | `bf4f631e4da0ce86b5e17a411f0587933076203a` | The existing reply release uses the status block and version; no new release route. |

Parser, card and release-plan blobs are byte-for-byte the actual `c7696c2…` source. The complete current dispatcher blob differs because of authorised main room work; its entire Send, No, `settleReplies` and `repliesOf` blocks are byte-for-byte identical to `c7696c2…`. Full block hashes and line ranges are in the manifest. The observation-order fix and stale-discard correction were retained, not reimplemented.

The three retained consumer-test blobs are unchanged: `src/lib/replies.test.ts` `6c203000cf09df689aae5fe8f8d30c92f721ea6f`, `src/screens/ReplyCard.test.tsx` `7b2db257bd3361d8234eb1f3ce87d9149be3b33c`, `src/runner/host.replies.test.ts` `e4776e2b1fea00aa38cf6b6ad31e46f387be57c2`. Their previously reported 62 passing cases are valid retained evidence of that source, but current full-suite results below supersede broad old-suite claims. No duplicate consumer tests or new Executive behaviour were added for the attachment correction.

## Retained verification before this review

Node `v24.16.0`; suite `f36884f801f4ad3e8780db6c954a82bb5267623f`, Knowledge `82152ae10e381733e97eca54df27a1c32e3cb6b7`, and the retained configured installation. No fresh install, changed app config, shared stub, ignored SWC plugin or timeout override was used. The actual checked-in configs run in `.verification/suite/apps/puremail`, `pureexecutive` and `exec-baseline`. The latter is a complete archive of pinned Executive main, not a selected-file baseline.

At that stage, all **271 Mail and 281 Executive** source/config files matched their tested copies. The current review adds one Mail test file; the current manifest maps **272 Mail / 281 Executive** source/config files with zero tested-copy differences. The actual resolved shared-package/script sources match the pinned suite across **4,561 files**, with zero differences; all **102** files of the Knowledge archive match the resolved copy. Direct package/runtime hashes and the suite's installed-lock hash match task5's retained manifest. The same physical installs serve baseline and candidate. Task5's 1,911-entry version audit remains retained evidence of that unchanged install, with its 12 recorded absent unrelated entries; this is not a claim of fresh `npm ci`. Test runtime: Vitest 3.2.7, Vite 6.4.4, root happy-dom 21.0.4; app happy-dom 17.6.3. TypeScript 5.9.3. Mail build: Vite 6.4.4/SWC 1.16.1/styled-components plugin 13.0.0; Executive build: Vite 6.4.5 and retained root plugin 12.12.1.

| Check (full commands) | Exit | Cases / files / skips |
|---|---:|---|
| Mail `../../node_modules/.bin/vitest run` | 0 | **1,601 passed / 117 files / 0 skipped** |
| Mail `../../node_modules/.bin/tsc -p tsconfig.json --noEmit` | 0 | clean final source |
| Mail `./node_modules/.bin/vite build` | 0 | actual app config and SWC plugin |
| Executive `../../node_modules/.bin/vitest run` | 1 | **631 passed / 5 failed / 114 files / 0 skipped** |
| Pinned Executive main `../../node_modules/.bin/vitest run` | 1 | **556 passed / 6 failed / 107 files / 0 skipped** |
| Executive `../../node_modules/.bin/tsc -p tsconfig.json --noEmit` | 0 | source unchanged since this check; full tested-copy correspondence recorded |
| Executive `./node_modules/.bin/vite build` | 0 | same unchanged source/config/dependencies; actual app SWC plugin |
| Five-file Mail affected stage (command below) | 0 | **149 passed / 5 files / 0 skipped**; before the final common-compaction extraction; final full run covers the final extraction, cache refresh, all these assertions and remapped-id control |
| Initial ten-scenario old-production regression (command below) | 1 | **15 failed / 15 passed / 2 files / 96 skipped**; includes actual attachment loss with plain body, and spurious duplicates with formatted body |
| Old production, extra missing-receipt evidence assertion | 1 | **1 failed / 1 file / 52 skipped** |
| `git diff --check` in Mail and Executive | 0 | no whitespace errors |

```sh
# Affected stage: final full run also exercises all five files.
../../node_modules/.bin/vitest run src/lib/twoCopies.test.ts src/lib/mailSendSettlement.test.tsx src/lib/mailAttachmentIdentity.test.ts src/lib/providerParity.test.ts src/components/composeStash.test.tsx
# Exact retained Mail production 2bdde1f… with the then-current ten-scenario tests.
../../node_modules/.bin/vitest run src/lib/mailSendSettlement.test.tsx src/lib/twoCopies.test.ts -t 'provider receipt sync:|two-copy receipt application:'
../../node_modules/.bin/vitest run src/lib/mailSendSettlement.test.tsx -t 'provider receipt sync: missing receipt attachment list'
```

The final Mail suite includes 30 attachment integration rows (10 provider-sync, 20 two-copy/plain-and-formatted cases), 10 digest oracle cases and all prior controller/sender, exit, boot/load, silence/clock, two-copy dispatch, schedule/Undo, persistence-failure, duplicate-approval and actual Close/stash/autosave coverage. Byte hashes are checked against Node's SHA-256, including UTF-8 HTML and mutation of the same attachment object. Cache refresh is applied between the older receipt and the stale copy's save; reopening is repeated three times. All 11 stash cases pass with the fixture clock explicitly held at 20 ms, before the real 350 ms autosave. The real shell, state, stash and every earlier assertion are retained; product compose code was not changed.

The current Executive full run independently passes the **same 62** consumer cases: parser 35, card 17, Send/No host 10. Its four `host.ctoAdopts` cases pass too. Full-suite baseline and candidate run **serially**, with the checked-in `maxWorkers: 2` and the same dependency installation. The question-card case passes in both full suites (baseline 22,848 ms; candidate 9,617 ms). Thus the historical two-card failure is **not reproduced in this current paired candidate/full-baseline comparison**; no consumer regression is demonstrated, and no causal explanation or “flaky/unrelated” classification of the earlier occurrence is invented. No CTO workflow code was repaired or broadened.

The candidate's five failures all also fail in the pinned full baseline:

- `src/runner/boundary.test.ts`: **the runner > reaches no React and no bridge, through any of its imports**.
- `src/screens/DecisionAssignmentLinks.test.tsx`: **shows named actions before collapsed history, opens the saved mission and handles a failed open**; **uses the same actionable note and decline feedback in Waiting for you**.
- `src/screens/LeadWorkspace.test.tsx`: **renders Markdown responsibilities in overview and team without changing the stored instructions**; **uses one workspace layout, opens existing work with top/bottom close and sends feedback to its lead**.

 Baseline has one additional **60,000 ms timeout** in `host.ctoRunsDev` > “a signed-out failure is diagnosed and switched to Codex by the CTO, without the owner”; that case passes in the candidate. This extra baseline stage remains visible, rather than being substituted for the historical two-card result.

Earlier during this continuation, the computer/app closure interrupted candidate and baseline full checks before summaries; neither is assigned aggregate counts. A subsequent overlapping-validation candidate stage timed out eight CTO cases and was cancelled with exit **130** before a final aggregate result. It is retained in the manifest/log, not used as a comparable completed suite or as proof about the two-card cause. The completed serial comparison above replaces it.

Before the stash fixture clock was controlled, a current-source Mail full stage was **1,594 passed / 3 failed / 117 files**, the two compact-view cases plus “a later recipient is kept as its own unsent draft, and the sent copy is left alone”. A full run of exact retained `2bdde1f…` was **1,539 passed / 4 failed / 113 files**, the two compact-view cases plus the matching-prefix/missing-recipients and missing-attachments stash cases. Those real-clock failures remain recorded at their stages, not called flakes; the fixture now actually guarantees its stated before-autosave ordering. An earlier Mail full stage also caught the newly introduced provider-parity comparison (1,584 passed/3 failed); it was corrected using the reference union's switch without weakening the guardrail. Final parity checks and the final full suite pass.

All completed check commands, exits, aggregate counts/skips, failure names and raw-log hashes—including intermediate stages—are in the manifest. Logs remain under ignored `.verification/`. The tooling warns about the outer standalone worktree's unavailable suite-relative base config; the app's own TypeScript paths resolve the pinned base and pass. Build chunk-size warnings remain. Neither app defines `puredesktop:check`; no such script was invented. No live desktop or cross-host provider validation is claimed.

## Retained stages and remaining limits

Task5's checked-in manifest, retained five-review index and exact prepared descriptions remain available at `2bdde1f…`/`c7696c2…`. Its setup commands and final check output were also retrieved from Codex session `01a19fd9-4ad7-74a3-a040-a3bad7300d58`, `rollout-2026-11-02T21-19-40-01a19fd9-4ad7-74a3-a040-a3bad7300d58.jsonl`. Relevant exact transcript events and the PureDev delivery record are saved under ignored `.verification/`, with hashes in the current manifest. The old standalone raw `.verification` logs were removed with the old worktree; the transcript retains the actual final command output. No historical task1 investigation was restarted.

Credited task5 results remain **Mail 1,543 passed/113 files; tsc/build 0** and **Executive 595 passed/6 failed/107 files; tsc/build 0; 62 consumer cases passed**. Five named failures reproduced on pinned main `3f0641e3a5aeffaaad563404c687562c0462de17`. The sixth question-card failure occurred in both task5 full runs; the selected-file main pass did not classify it. The first task5 full run was **594 passed/7 failed**, additionally failing `host.ctoAdopts` > “the CTO takes on a needs-you task, an ideas task and a running one, once each, and carries them on”; it passed in the final task5 full run and selected-file main stage. These stages are not relabelled as flakes, unrelated failures or current all-green checks. The four earlier socket-denied meaning-search failures and the historical nine-failure stage remain in [the retained handoff](send-evidence-handoff.md).

Mail's two compact-view cases failed at earlier current-source stages and reproduce on its untouched starting main `9d4b4aa…` with the same config/install: “finds the full app as it was on growing, and again after coming back” and “keeps the full app's open thread and ticked rows across the box.” Baseline selected-file command: `../../node_modules/.bin/vitest run src/components/CompactInRoom.test.tsx`, exit 1, **8 passed/2 failed/1 file/0 skipped**. The same selected-file check on exact retained Mail `2bdde1f…` gave **9 passed/1 failed**, the first of those two cases. These are reported at their actual stages; the compact-view source was not changed. Both pass in the final 1,601-case run; that pass alone is not labelled proof of flakiness.

The required host prerequisite is unchanged and accepted as a prerequisite report: guaranteeing every last in-memory word during forced frame destruction needs a host-owned durable save/close acknowledgement that keeps Mail alive until its conditional merge is saved, or retains the pending edit outside the destroyed frame. The inspected `closeTabs.ts` still proceeds after 1,200 ms. The new attachment fix does not implement host production changes. Existing saved-evidence guarantees depend on atomic `ifMatch` and on every participating Mail copy using the corrected writer. Old writers can still overwrite evidence. Silence, age and clocks still do not prove an unclaimed sender stopped.

The current prepared descriptions are `docs/send-evidence-pr-description.md` in both repositories and identify **Mail PR77 / Executive PR91**. Task5's exact replacements remain verbatim in each historical handoff with their reported Mail 403/Executive 404. PureDev must update the current delivered pair and run ordinary review. No evidence-only commit or future delivery receipt is a prerequisite for worker checks; no passed final review, merge or release is claimed.

At the earlier worker stage, the supported Mail PR73 description update was attempted with the exact saved replacement and again returned **HTTP 403, “Resource not accessible by integration”**. PR77 and its recorded companion commit read returned **HTTP 404**; no update is claimed there. No alternate account, credential or permission change was attempted. That historical posting failure does not describe the new pair. Exact current pending step: PureDev must push this follow-up on the delivered `…f83756` branch and apply the two prepared descriptions to **Mail PR77 and Executive PR91**. Mail PR73 and Executive PR77 remain predecessors; this worker does not close them or claim an owner decision to merge them. The current worker is ready for ordinary review; metadata posting is pending, not a reason for an evidence-only commit or another diagnostic assignment.

No mailbox/provider access, real send, customer data, credentials, spending, merge, release, deployment, controller install/reload, global configuration or permissions change occurred. ps-suite was source/contract inspection and a pinned verification layout only; its working tree is unchanged. Existing PureDesktop product identity is retained (`puredesktop`, supplied design revision 4); no new visual/brand artifact or UI change was produced. The late receipt itself is synthetic-only, so no manual screen path that would imply using a real mailbox is supplied. No live desktop validation is claimed.
