# Current provider-receipt review

The current targets are Mail PR77 and Executive PR91 on `puredev/keep-replacement-attachments-when-late-r-f83756`. The inspected delivery snapshot is Mail `efd10530ebe04106b3cdf68779c38c5bf6fb13a5` and Executive `143fb6431e016d4a668b87c0cd178e9939eb5696`. PureDev owns delivery and ordinary review. The source/check manifest identifies the exact tested content. [Current handoff](send-attachment-handoff.md), [manifest](send-attachment-verification.json).

Final checks show **Mail 1,718 passed / 118 files**, affected **339 passed / 5 files**, typecheck/build 0. **Executive 631 passed / 5 established baseline failures / 114 files**, typecheck/build 0. All 62 consumer, nine CTO-run and four CTO-adoption cases pass. The final negative run against delivered Mail reports **10 failed / 35 passed / 3 files / 170 skipped**.

The comparison tolerates provider address/body formatting differences. Baseline fingerprints distinguish reconstructed derived copies from real edits, including an actual agent update. Pending discards before the first save and sent-derived reconstruction are covered. HTML or other missing comparison evidence can still leave a conservative unsent copy requiring a Sent check and fresh decision. Current manifest paths use relative labels.

Mail PR73 is an open predecessor in the supported read. Its disposition belongs to the owner, and both copies of the work must not be merged. Exact prepared descriptions and supported posting results are retained for normal PureDev delivery. The accepted host close/save prerequisite remains documented.

The final supported description update for Mail PR77 returned HTTP 403, “Resource not accessible by integration”. The supported Executive PR91 read returned HTTP 404, so its update was not attempted. The exact replacement bodies and their hashes are retained. The pending step is for normal PureDev delivery to apply `docs/send-evidence-pr-description.md` from each app to Mail PR77 and Executive PR91. No credential or permission changes were attempted.

The following is retained task5 historical evidence, including its exact saved replacement, original delivery identities, commands, failed stages and posting errors.

# Send evidence continuation — req-0039 task4

The app correction protects durable send evidence at exit, keeps an older ambiguous submission separate from the later decision, and conservatively keeps compose fields when comparison evidence is incomplete. It does **not** guarantee saving last words from a stale page forcibly destroyed before a conditional merge finishes. The precise host prerequisite is in [drafts.md](drafts.md#exit-limits). This is a continuation of PR73/PR77, not a new assignment or a passed final review.

## Source and preserved work

| Source | Full identity |
|---|---|
| Mail starting HEAD / tree | `afd630eed324d045d60f8df6d1a41ba2072720bb` / `acabf140e8318963ef791ab7952f38f7b9ccbe0e` |
| Executive starting HEAD / tree | `422c4f7d887d3f8c2360ec27af544bb9987974e0` / `a92b8fd2626828edf03dcae627c95b68af85443a` |
| Suite / tree | `f36884f801f4ad3e8780db6c954a82bb5267623f` / `58a53f4cbd356900118c8a92d7c2479aa6bf0a96` |
| Knowledge | `82152ae10e381733e97eca54df27a1c32e3cb6b7` |
| Executive baseline main | `3f0641e3a5aeffaaad563404c687562c0462de17` |

Both worktrees started clean on `puredev/keep-prepared-message-sending-status-con-a8e28e`. No branch, commit, push, merge, installation, controller reload or deployment was performed. PureDev owns the delivered commits. The [verification manifest](send-evidence-verification.json) records full changed-source blobs against these starting commits, config/lock hashes, actual dependency versions and content correspondence. No synthetic tree hash or object-store write was needed. All 261 Mail and 257 Executive source/config files matched their tested copies. The pinned suite's 4,559 relevant files and Knowledge's 58 relevant files matched their checkouts with zero differences.

The starting Mail tree is exactly the full `acabf140…` tree reported by task4. Executive's previously abbreviated source identities resolve to `replies.ts` `5b444497b78ed14b17964dfd29124b24eb4286ec`, `runner/dispatcher.ts` `4389a05be92e5458c834325c3c4c50ef61ac1b21` and the earlier `replies.test.ts` `36127129ffa4f335e27974cf52e98f848ff89c2c`. The runtime parser/dispatcher blobs remain unchanged by this continuation; only consumer tests and handoff documents change in Executive. The manifest also identifies the delivered card and release code through its starting commit.

Preserved: evidence-only recovery with no age/silence inference; first persisted submitting marker; conditional-save arbitration; confirmed-copy checks after preparation and marker persistence; waking preparation stopping on uncertainty; real two-copy dispatch tests; guarded stale-discard/team recovery; stopped schedules in the drafts file; schedule refresh; approved subject/recipient/HTML/attachment retention; definite-failure association; repeat approval and receipt authority. Existing regression tests remain. Two expectations that explicitly blessed overwriting newer evidence with older uncertainty were corrected.

## Correction

- **Exit:** `writeDraftsFileBeforeUnload` uses the version paired with the last agreed file. A stale fast write conflicts without changing disk. No version means no fast write. Tests interrupt the owner before any repair save, including around marker acknowledgement and fake-provider dispatch, then repeatedly load/recover from the actual shared file. A refresh interval is not the safety boundary.
- **Late results:** `sendUncertainties` retains another submission's id, reason and Message-ID. `sendSupersedes` carries predecessor identities known to the later explicit decision, so the file merge can keep that decision even when the old controller itself is stale. These contain send evidence only, not an activity log. The newer phase/Undo/settlement/reason/schedule remains its own; unresolved older evidence blocks ordinary resend. An authoritative receipt remains tied to its submission. Different later words remain an unsent draft; repeated sync and merge retries do not duplicate that draft. Account draft writes/listings also leave unresolved evidence alone.
- **Compose:** sent copies are partial evidence, not cast drafts. Missing recipients, HTML, attachment metadata or all comparison data conservatively keeps every current field. Real Close, stash and autosave cover matching plain words, partial last-seen/sent evidence and missing data. A complete unchanged comparison creates no duplicate. The real stash tests retain the shell, state, autosave and stash logic; only the editor face and, in the missing-snapshot cases, the returned comparison ref are controlled seams. Partial-message calendar/attachment projections no longer throw before stash can run; they do not normalize missing evidence in the store.
- **Consumers:** real sender/controller tests verify persisted readback plus run/draft/agent/team readings. Executive tests reuse the actual parser, existing card and Send/No routes for additive fields/reasons, unknown/absent/legacy/mixed versions, identical/future/different clocks and a stale discard corrected by Mail. The existing observation-time fix is retained. A settled decision corrected to uncertainty stays closed, shows uncertainty and grants no resend or discard.

## Retained reports and five reviews

Retrieved task4 run `f9d5839c-55f9-4483-b594-2178b7c85e84` from the existing PureDev `dev-runs.json`, its original setup report and replacement text from transcript `d954cbfb-e938-4c03-a390-963bd0a2da2d`, and the retained check logs/scripts. Full local copies are in `.verification/retained-task4-evidence.json`; content hashes are in [the retained index](send-evidence-retained-index.json). No old diagnostic task was restarted.

The five failed reviews are retained across three existing runs, rather than five entries in task4's own run:

| Review time (UTC) | Existing run | Principal finding |
|---|---|---|
| 2026-11-02 19:06:34.644 | `a8e28e66-d9be-4a44-86c6-0f7de1c1ff11` | Compose could clear uncertainty; drawer/hydration/status gaps |
| 2026-11-02 19:29:54.828 | same | Compose could resend a removed, confirmed draft |
| 2026-11-02 19:41:55.114 | same | Compose/scheduler could falsely say “could not send” |
| 2026-11-02 22:03:01.140 | `4cf974d8-929a-4553-911d-d3a86bed92da` | Split schedule persistence, age inference, lost later fields, setup gaps |
| 2026-11-03 04:53:55.439 | `f9d5839c-55f9-4483-b594-2178b7c85e84` | Two-copy marker/receipt arbitration, wake, stale discard, clock ordering |

These are failed historical reviews, not a final passed review. Their unsupported estimates are not adopted here. The subsequent CTO judgement of exact Mail `afd630…` was PARTLY. Normal PureDev review of the new delivered pair remains necessary.

Task4's latest **reported**, not freshly reproduced historical results: Mail tsc/vitest/build exit 0, 1,482 cases/113 files; Executive tsc/build exit 0, vitest exit 1 with 587 passed/9 failed/107 files, with the same nine reported on main. The original setup report used the same real configs and pinned suite, with cloned installs from `ps-suite-main-20261102`, Mail modules from `ps-suite-publishers`, Executive modules from `ps-suite-dashboards`, and the lock's happy-dom supplied for Executive. It did not run a fresh npm install. Earlier 1206/49, 1223, 1362, 1417 and 1472/1474 counts are earlier stages, not current proof.

The historical nine were four `src/mcp/server.test.ts` meaning-search cases (reported socket `listen EPERM`), `src/runner/boundary.test.ts`, two `src/screens/DecisionAssignmentLinks.test.tsx` cases and two `src/screens/LeadWorkspace.test.tsx` cases. The exact names and current baseline results are below. Historical logs `results3.txt`, `exec-base-failing.log` and the final report distinguish the pre-narrowing 1,481+1 Mail run from the reported subsequent 1,482-pass rerun.

Original prepared description, retrieved verbatim (historical counts and claims, superseded by the replacement file):

> Interrupted sends settle from evidence only. No elapsed time or silence makes a send "not sent": an unclaimed attempt reads unconfirmed until someone checks Sent, and only its own not-sent record or Undo proves otherwise. Stale discards can't erase a live or uncertain send without a confirmed copy, and older failures don't touch newer attempts. Knowing an owner stopped needs a host-level instance contract that doesn't exist yet. Ship with the paired Executive PR. Checks: Mail tsc, build and 1474 tests pass; Executive tsc and build pass, with the same 9 test failures as its main. Not run in a live desktop.

## Task5 verification — retained historical stage

Node `v24.16.0`. Checks run in `.verification/suite/apps/puremail` and `pureexecutive`, with the real checked-in app configs, the pinned suite packages/scripts/base config and retained dependencies. App Vite builds use each app's actual styled-components SWC plugin. No replacement config, shared stub or ignored build plugin is used. Vitest is 3.2.7, its Vite 6.4.4, TypeScript 5.9.3, root test happy-dom 21.0.4; app happy-dom 17.6.3. Mail's build uses Vite 6.4.4, SWC 1.16.1 and styled-components plugin 13.0.0; Executive uses Vite 6.4.5 and the installed root plugin 12.12.1. Full package/config/lock identities are in the manifest. Version inspection checked 1,911 installed-lock entries without a version mismatch; 12 unrelated workspace/dev entries are absent. This is a reused configured install, not a claim of fresh `npm ci`.

Commands are the package scripts' actual binaries: `../../node_modules/.bin/tsc -p tsconfig.json --noEmit`, `../../node_modules/.bin/vitest run`, and `./node_modules/.bin/vite build`. Each build writes only the disposable app copy's ignored `dist/`. The parent worktree causes an esbuild warning about its unavailable suite-relative base config when loading tooling; the app's own tsc config resolves the pinned base correctly and passes. Build chunk-size warnings remain. `puredesktop:check` is absent from both package scripts and was not invented.

| Check | Exit | Cases / files / skips |
|---|---:|---|
| Mail `tsc -p tsconfig.json --noEmit` | 0 | clean |
| Mail full `vitest run` | 0 | 1,543 passed / 113 files / 0 skipped |
| Mail `vite build` | 0 | actual app config and styled-components plugin |
| Executive `tsc -p tsconfig.json --noEmit` | 0 | clean |
| Executive full `vitest run` | 1 | 595 passed, 6 failed / 107 files / 0 skipped |
| Executive `vite build` | 0 | actual app config and styled-components plugin |
| Executive `vitest run src/lib/replies.test.ts src/screens/ReplyCard.test.tsx src/runner/host.replies.test.ts` | 0 | 62 passed / 3 files / 0 skipped; also all pass in the final full run |
| Current main baseline: `vitest run src/screens/LeadWorkspace.test.tsx src/screens/DecisionAssignmentLinks.test.tsx src/runner/boundary.test.ts src/mcp/server.test.ts src/runner/host.ctoRunsDev.test.ts` | 1 | 25 passed, 5 failed / 5 files / 0 skipped |
| Main baseline: `vitest run src/runner/host.ctoAdopts.test.ts` | 0 | 4 passed / 1 file / 0 skipped |
| New six-file Mail regressions over starting `afd630…` source, same configs/dependencies | 1 | 44 failed, 148 passed / 6 files / 0 skipped |
| New sync-protection cases over starting `afd630…` (command below) | 1 | 2 failed / 2 files / 154 skipped by the named filter |

The six-file before-change run uses `src/lib/twoCopies.test.ts`, `src/lib/mailSendSettlement.test.tsx`, `src/components/ComposeEditor.laterWords.test.tsx`, `src/components/composeStash.test.tsx`, `src/hooks/useComposeDraftAutosave.sending.test.tsx` and `src/lib/mailPersistence.test.ts` from the candidate with the starting production source. It fails on behaviour, not configuration or test-file collection. The extra sync cases separately catch missing-listing loss and an account draft write while older submission evidence is unresolved. Full Mail counts grew from the retained 1,482 to 1,543 through this continuation's tests.

```sh
../../node_modules/.bin/vitest run src/hooks/useDraftProviderSync.test.tsx src/lib/mailModel.test.ts -t 'superseded submission|synced draft carrying older uncertainty'
```

Raw logs and exit records remain in `.verification/`; the manifest records hashes of the final check logs. The final runtime/test source is mapped by starting commit plus full changed blobs and zero tested-copy differences, without requiring a later delivery receipt.

The five failures reproduced on current main and the final Executive candidate are:

- `src/runner/boundary.test.ts`: **the runner > reaches no React and no bridge, through any of its imports** (six forbidden dependency paths).
- `src/screens/DecisionAssignmentLinks.test.tsx`: **shows named actions before collapsed history, opens the saved mission and handles a failed open**; **uses the same actionable note and decline feedback in Waiting for you**.
- `src/screens/LeadWorkspace.test.tsx`: **renders Markdown responsibilities in overview and team without changing the stored instructions**; **uses one workspace layout, opens existing work with top/bottom close and sends feedback to its lead**. These four UI cases report the existing missing `useTeam` mock export.

One additional final full-suite failure remains **unclassified**, not called a flake: `src/runner/host.ctoRunsDev.test.ts` > **a question from the CTO is the one card, and once answered it plans the work** (two note cards where one is expected). It failed in both candidate full runs but passed in the isolated main baseline run. That comparison does not establish whether suite interaction, environment or an earlier branch change causes it. The worker made no Executive production changes; it did not repair the failure; calling it unrelated was unsupported at that stage. See the current full-suite comparison above.

The first candidate full run had 594 passed/7 failed/107 files: the same six plus `src/runner/host.ctoAdopts.test.ts` > **the CTO takes on a needs-you task, an ideas task and a running one, once each, and carries them on**. That case passed on main and in the final candidate full run; no cause is claimed. An intermediate duplicate-key type error in the newly added card-test helper was fixed, and the final complete Executive typecheck passes. Final full-suite source, not that intermediate stage, is represented in the manifest.

The four historical meaning-search failures were **finds a page by meaning when the words do not match, and says it did**; **falls back to words and says why when this computer has no model, the model is gone or the index is another model’s**; **says so when the library has no index yet**; **never asks the model about an empty query**. They passed in the current baseline and both current full runs. The task4 report's four socket denials are retained as historical evidence, not relabelled as current failures or explained away as flakes. The final Executive full suite is still red.

## Delivery and limits

All participating Mail copies need the corrected writer, and Mail/Executive must ship together on a host with the inspected atomic conditional-write contract. Older producers can still misclassify a lost hold, and older writers can overwrite shared evidence. No new release authority, card design, send tool or automatic retry was introduced. Knowing an unclaimed owner stopped across suspended frames/devices still lacks a host contract; no silence or clock supplies it.

For last words at forced page exit, the exact prerequisite is a host-owned save/close barrier that retains the frame until the conditional merge is durably acknowledged, or retains the pending edit outside that frame. At suite `f36884…`, `renderer/workspace/closeTabs.ts` closes after 1,200 ms without acknowledgement. Mail's `useMailStorePersistence` calls the fast writer from `beforeunload`; the shell's storage writer already offers the atomic `ifMatch` used here. Crash-only in-memory edits cannot be recovered after their process disappears. The app-only durable-evidence correction is implemented; that wider last-word guarantee is not claimed complete.

The [Mail replacement description](send-evidence-pr-description.md) replaces the stale task1 PASS/counts. Executive retains its paired replacement in its own `docs/`. Posting is pending through normal PureDev delivery: PR73 could be read at head `afd630eed324d045d60f8df6d1a41ba2072720bb`, but its description update was refused with HTTP 403, `Resource not accessible by integration`. PR77 returned HTTP 404 to the connector. No alternate account or permission change was attempted, and no description is claimed posted. No evidence-only commit or future receipt is required for these worker checks; PureDev performs ordinary delivery and review. The tracked absolute `node_modules` addition remains absent; the underlying install was not removed or replaced.

No mailbox, real provider, customer data, credentials, real send, release, permission change, controller installation/reload, spending or shared production change was used. No new visual design or brand artifact was produced; existing PureDesktop product chrome is retained (profile `puredesktop`; supplied design brief revision 4). No live desktop was opened. Real component tests cover the affected controls; no misleading opening-screen screenshot is supplied.

## Retained exact task5 prepared description

```markdown
Continue req-0039 on the existing paired Mail PR73 and [Executive PR77](https://github.com/purescience-inc/pureexecutive/pull/77). This worker candidate awaits PureDev's normal commit/push and review; it is not a final passed review.

Mail's fast exit write now uses the existing atomic `ifMatch` contract with its last agreed version. A stale closing copy cannot overwrite another copy's saved send evidence or stopped schedule, even if that owner is interrupted before any repair save. No awaited unload read or refresh interval is assumed.

Older ambiguous submissions retain their own identity, reason and Message-ID alongside the newer decision. The actual file merge preserves both attempts using predecessor identities rather than clocks. Unresolved uncertainty blocks resend; receipts remain authoritative for their own submissions. Different later words stay in an unsent draft. Close, stash and autosave conservatively retain every compose field when comparison evidence is missing or partial; a complete unchanged comparison creates no duplicate. Account draft sync also preserves unresolved send evidence.

The existing Executive parser, ReplyCard and Send/No dispatcher routes retain their authority and design. Added consumer tests cover status/reason changes, unknown/absent/legacy/mixed-version fields, status observation ordering and Mail correcting a stale discarded report. The existing observation-time fix is retained.

Worker checks use the actual app configs, pinned suite `f36884f801f4ad3e8780db6c954a82bb5267623f`, Knowledge `82152ae10e381733e97eca54df27a1c32e3cb6b7`, Node v24.16.0 and retained configured dependencies:

- Mail: typecheck/build exit 0; **1,543 tests passed, 113 files, no skips**. The new six-file regressions produce 44 failures on the starting Mail source; the two new sync cases also fail there.
- Executive: typecheck/build exit 0; full suite exit 1, **595 passed / 6 failed, 107 files, no skips**. All 62 reply-consumer cases pass. Five failures reproduce on main; an additional CTO workflow failure remains unclassified. An earlier full run also failed a second CTO workflow case. These are not called flakes or hidden behind isolated passes.

**Limits:** preserving evidence already on disk is fixed. Guaranteeing every last word during forced page exit still needs a host-owned durable save/close acknowledgement; the inspected shell closes after 1.2 seconds without it. Proving an unclaimed sender terminated across suspended frames/devices also lacks a host contract. No timer or silence supplies that proof. All participating Mail copies must be updated; ship both PRs on a host supporting atomic `ifMatch`.

[Handoff, exact baseline failures and retained five-review index](docs/send-evidence-handoff.md), [full source/config/dependency identities](docs/send-evidence-verification.json). The candidate is identified by starting Mail `afd630eed324d045d60f8df6d1a41ba2072720bb`, Executive `422c4f7d887d3f8c2360ec27af544bb9987974e0` and the manifest's full changed blobs; PureDev supplies the eventual new commit identities.

No live desktop, mailbox, real provider/send, credential, release, deployment or shared-production change was used. The tracked absolute dependency link remains absent. Normal PureDev delivery/review and the person's merge decision remain required.
```
