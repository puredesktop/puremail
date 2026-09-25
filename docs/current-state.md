# PureMail Current State

This document is the source of truth for what PureMail does today. "Works" means the behavior is implemented in the current desktop app or local demo store. It does not imply production Gmail behavior unless the status explicitly says `provider-backed`.

Drafts have their own document: [`drafts.md`](drafts.md) is the source of truth
for the draft model, provider sync, persistence, and the rules that keep drafts
from going missing. The feature-matrix rows below defer to it.

Forward-looking follow-up design direction is tracked separately in
[`watchers-followups-design-brief.md`](watchers-followups-design-brief.md).
The Live Mail watcher feature described there was removed in July 2026.

Phase 1 of [`simplification-plan.md`](simplification-plan.md) landed in July
2026 and removed: the QA learning loop, person memory and per-person voice
overrides, the QA review console extras (confidence, checklist, provenance,
suppressed-draft view), PureAssistant work requests, the intent review
dialog, AI inbox classification, and the inbox categorisation explainer.

A simplify pass followed phase 4: the separate "Replies for review" tab is
gone — a requested draft is now an ordinary draft on its thread — along with
the QA verdict system, the unreachable second action drawer, and four
settings cards (11 → 7, each with a matching nav entry, pinned by a test).

Phase 4 made PureMail an agent **provider** as well as a
consumer. `plugin.json` declares eight tools, `src/agents/` implements them,
and `usePureMailAgentTools` registers the handlers with the shell — before
this the declared tools were never registered, so every agent call hung for
90 seconds and then failed. Agents read through the same `resolveThreadQuery`
the rail uses, `showQuery` points the user's list at what the agent is
working with, and `proposeAction` stages a batch into the ordinary
multi-select for the user to approve or reject. Agents never mutate mail
directly; approvals and rejections are recorded in the `agent` ledger lane.

Phase 2 landed immediately before and made **the query the view**. Every
thread list is now produced by `resolveThreadQuery` in
`apps/puremail/src/lib/mailQuery.ts` — the sidebar nav items, the search
box, saved views, and sidebar counts all resolve the same query string, so
they cannot disagree. The two older matchers (`mailSearchQuery.ts` and the
special-rail-view helpers) were deleted along with the parallel capped
search result list.

## Architecture

PureMail currently has a local demo implementation plus a Gmail-backed provider path.

- `apps/puremail/src/lib/demoMailProvider.ts` defines `DemoMailProvider`, a local development provider backed by seeded `MailStore` data from `apps/puremail/src/lib/mailModel.ts`.
- Demo actions such as send, archive, unarchive, move, delete, mark read, search, label, and inbox category changes mutate local `MailStore` state and usually mark affected records `syncState: "pending"`. That proves local behavior, not remote Gmail behavior.
- `apps/puremail/src/lib/gmailMailProvider.ts` defines `GmailMailProvider`, which fetches Gmail inbox threads, maps them into PureMail `MailStore` shape, and calls Gmail for archive, unarchive, trash, unread, remote search, and reply/QA draft sends.
- The UI in `apps/puremail/src/components/PureMailShell.tsx` reads and writes local `MailStore` state, but core toolbar actions call the active provider first when Gmail is active. In standalone/dev mode, `apps/puremail/src/hooks/usePureMailBoot.ts` persists only the local demo store to browser storage.
- Google provider configuration is shared with PureCalendar: readable public settings live in app settings, while secrets and OAuth tokens live in the shell vault through `apps/puremail/src/hooks/useGoogleMailAccount.ts` and `apps/puremail/src/bridge/platformBridge.ts`.
- Gmail requires `gmail.modify` and `gmail.send` scopes. Users who previously connected with the older read/send scope set should reconnect Gmail to grant message-action access.

## Feature Matrix

| Feature                                 | Status          | Backing implementation                                                                                                                                                                                         | User-visible behavior                                                                                                                                                                                                                                                                                                                                  | Known limits                                                                                                                                                                                              |
| --------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mailbox/thread list                     | provider-backed | `GmailMailProvider.fetchStore`, `emptyMailStore`, `PureMailShell`, `inboxCategoryCounts`, `threadInboxCategory`                                                                                                | With Gmail tokens, PureMail loads Gmail inbox threads; otherwise it shows an empty local workspace.                                                                                                                                                                                                                                                    | V1 fetches the Inbox page only. Gmail labels are simplified into PureMail labels/categories.                                                                                                              |
| Reading messages                        | provider-backed | `GmailMailProvider` Gmail message parser; `PureMailShell` selected thread/message rendering                                                                                                                    | Selecting a Gmail-backed thread shows mapped Gmail messages, participants, snippets/body text, attachments, invite panel where parsable, drafts, and tasks. Gmail attachments with remote `attachmentId` metadata can be downloaded on demand.                                                                                                         | HTML rendering is converted to text for now.                                                                                                                                                              |
| Search                                  | provider-backed | `GmailMailProvider.search`; `searchMailAndTasks` in `mailModel.ts`; `DemoMailProvider.search`                                                                                                                  | Gmail mode calls Gmail thread search and maps results into PureMail search results. Demo mode searches local threads, tasks, and attachments.                                                                                                                                                                                                          | Gmail operator UX is not yet documented in the UI.                                                                                                                                                        |
| Drafts (create, edit, sync, send)       | provider-backed | `lib/mailPersistence.ts`, `hooks/useDraftProviderSync.ts`, `GmailMailProvider.listDrafts/createDraft/updateDraft/deleteDraft` | Every draft — reply, forward, compose, generated, or written in Gmail — is one editable `Draft` record on the conversation it answers, appears under Drafts while unsent, syncs both ways with the account, and is sent through the provider's own draft-send so it leaves Drafts remotely too. See [`drafts.md`](drafts.md). | IMAP draft sync is implemented but its transport is still a shell follow-up. |
| Compose/send                            | works locally   | Compose drawer in `PureMailShell`; `sendDraft` in `mailModel.ts`; `DemoMailProvider.send`                                                                                                                      | Compose can create a local draft or append a sent message to local store and remove the draft.                                                                                                                                                                                                                                                         | Brand-new Gmail compose/send is still local in this pass; reply/QA sends are provider-backed.                                                                                                             |
| Reply/forward                           | provider-backed | `GmailMailProvider.send`; `createReplyDraft`, `createForwardDraft`, and draft focus flows in `PureMailShell`                                                                                                   | Reply creates or focuses a local draft attached to the selected thread; sending a reply/QA draft uses Gmail when Gmail is active. Forward creates an editable thread draft with `Fwd:` subject, forwarded headers/body, and carried attachments, then requires recipients before send.                                                                 | Reply/forward UI still needs manual acceptance in Electron. Forward is a local draft flow in this pass; brand-new provider-backed Gmail forward send still follows the normal draft send boundary.        |
| Archive/move/mark unread/delete         | provider-backed | `GmailMailProvider.archiveThread`, `unarchiveThread`, `deleteThread`, `markThreadRead`; local model helpers                                                                                                    | Gmail mode removes/adds the Inbox label, trashes threads, and toggles Unread through Gmail before updating PureMail state. Demo mode remains local.                                                                                                                                                                                                    | Generic Move and local-only label chips do not yet map to arbitrary Gmail labels. Archive count/unarchive behavior should still be manually accepted in Electron.                                         |
| Follow-ups/tasks                        | works locally   | `createTaskFromThread`, `createFollowUpTask`, task drawer and task status updates in `PureMailShell`                                                                                                           | Users can create thread-linked tasks/follow-ups and update local task state.                                                                                                                                                                                                                                                                           | No server-backed task sync is proven. Follow-up defaults/settings are still limited to current implementation.                                                                                            |
| Requested drafts/voice/signature        | works locally   | `ensureAutoDraftForThread`, draft voice helpers, signature settings                                                                                                                                            | Reply drafts are generated only when the user asks (Send to QA) and land in the review queue. Signature and the general My Voice profile shape draft text. Automatic background drafting, per-person voice overrides, person memory, and the QA learning loop were all removed in July 2026.                                                    | Voice is deterministic/local retrieval against local data only.                                                                                                                                           |
| Attachments                             | provider-backed | Attachment chips and compose/draft file readers in `PureMailShell`; attachment fields in `MailMessage` and `Draft`; `GmailMailProvider.getAttachmentContent`; `addAttachmentInviteToCalendar` for invite files | Demo attachments display as chips; local content can be opened/downloaded; Gmail remote attachments download on demand before opening. Compose and draft attachments can be added/removed locally. `.ics` and `text/calendar` attachments expose an `Add to calendar` action that uses the same review-first PureCalendar handoff as invite responses. | Raw file viewing depends on local content/data URLs. Provider-backed attachment upload is not verified.                                                                                                   |
| Calendar invite parsing/add-to-calendar | works locally   | `parseCalendarInvite`, `calendarInviteForMessage`, `createCalendarInviteIntentFromMessage`, storage handoff to PureCalendar                                                                                    | Invite messages can show a calendar invite panel and open a review-first handoff to PureCalendar through app-scoped storage.                                                                                                                                                                                                                           | PureMail and PureCalendar now declare `filesystem` because shell `storage.*` bridge calls require it. Electron needs a restart after manifest changes. Remote calendar provider behavior is not verified. |
| Google provider config                  | provider-backed | `useGoogleMailAccount`, `GmailMailProvider`, `googleProviderConfig` bridge helpers, shell settings/secrets/network/oauth methods                                                                               | Settings screen can save visible Google client settings, share them with Calendar/Today, start Gmail OAuth in the shell, and use stored tokens for Gmail sync/actions on boot.                                                                                                                                                                         | Existing users may need to reconnect Gmail to grant the newer `gmail.modify` scope.                                                                                                                       |

## Known Issues

- Archive count/unarchive behavior has local model support, but the visible Electron flow and any future provider mapping need acceptance verification before this is production-ready.
- Calendar invite handoff uses `storage.readJson` / `storage.writeJson`; shell permissions require `filesystem`, so Electron must be restarted after manifest permission changes.
- Reply creates or focuses a local draft, but the reply flow still needs UI verification to ensure it always presents a usable reply composer clearly.
- Forward now creates a local editable draft from the selected thread. Provider-backed remote forward semantics still depend on the normal send path after the user adds recipients.
- Live Mail is V0: no full dashboard, background scheduler, provider-backed evaluation, or pre-approved auto-send queue is production-ready.
- Gmail-backed behavior has unit coverage with a fake Gmail API, but still needs manual acceptance against a real Gmail account for OAuth reconnect, inbox sync, archive/unarchive, unread, trash, search, and reply send.

## Verification Notes

Use these commands after doc or implementation changes:

```sh
npm run test -w @purescience/puremail
npm run typecheck -w @purescience/puremail
```

Manual comparison should cover compose, reply, archive/unarchive, Live Mail, attachments, calendar invite handoff, and the Google provider settings screen in the Electron shell.
