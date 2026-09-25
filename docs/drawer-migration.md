# Drawer-owned Mail reasoning

Reply drafting and regeneration now use `draftReply` (prepare only), drawer reasoning, `commitReplyDraft`, then `getDraft` readback. Questions and summaries are dispatched to the tab drawer. The inline Ask panel is a launcher with dispatch status, not a second conversation. No direct invoke or private model session remains in Mail.

Preparation captures thread/account/draft state and expires after ten minutes. Account/session changes clear outstanding requests. New source messages, edited/discarded/sent drafts, or changed recipients reject late commits. Commits are single-use, preserve an existing generated draft ID and provider identity, and never send email. Manual or ambiguous drafts require explicit `getDraft` / guarded `updateDraft`; the latter requires the exact `version` returned by the read. Open compose state blocks conflicting drawer writes.

Mail owns deterministic application and its existing local persistence/provider synchronization. Receipts explicitly report applied state, persisted:false and pending provider sync. No success receipt claims disk durability. A provider ID alone is not proof the latest content synced. Existing per-call send approvals are unchanged. No local fallback mail is fabricated on failure.

Changed only this submodule. No shell/API/IPC changes. Missing tab sessions use the existing public create-session and tab-binding APIs, not an unrelated app-wide session.

Validation: 100 focused tests across reply request lifecycle, handler prepare/commit/readback, draft lifecycle, provider contract, provider sync, and send-run handlers; TypeScript and production build pass. No live mailbox send, paid model generation or end-to-end Electron mission was performed in this change. Validate with a synthetic account before production rollout: draft, improve, ask, summarize, edit while reasoning, discard while reasoning, stop/retry, switch account/session, then save/reopen.

No background pending draft is created by preparation. Closing/reloading loses a prepared token, so the drawer must prepare again. Disk writes and provider writes retain their existing debounce/retry owners; saving is not newly made synchronous by this migration.
