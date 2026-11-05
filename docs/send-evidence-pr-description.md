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
