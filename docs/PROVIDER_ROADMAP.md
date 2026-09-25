# PureMail provider roadmap

Status as of Phase M6.

## Live today
- **Gmail (OAuth)** — full provider: sync, archive/trash/read, stars
  (STARRED), labels API (list/apply/remove/create), drafts API, send with
  HTML alternatives, operator search passthrough.
- **Demo** — local in-memory provider for development and offline use.

## Foundation shipped, transport pending
- **IMAP/SMTP** (`src/lib/imapMailProvider.ts`) — the provider logic is
  complete and tested against an in-memory fake transport: folder→mailbox
  mapping, References-based threading, \Seen/\Flagged flag semantics,
  folder moves for archive/trash, drafts via APPEND, compose via SMTP with
  a best-effort Sent copy. Honest capability flags: `labels: false`
  (folders instead), no scheduling/snooze/bulk/watch.

  **Blocker:** raw TCP sockets are not available to renderer apps. The
  `bridgeImapTransport()` stub reports this at connect time. Enabling real
  IMAP is transport-only work once the shell exposes a socket (or IMAP
  proxy) capability through the platform bridge — no provider changes
  needed. Account presets (iCloud, Fastmail, Proton Bridge localhost,
  generic) and vault-stored passwords (`imap.password.<profileId>`,
  write-only via `setCredential`) are already in place.

## Deferred
- **Outlook / Microsoft Graph** — its own future provider work: Graph is a
  REST API (usable from the renderer like Gmail), but needs Microsoft
  OAuth app registration, delta-query sync design, and folder/category
  mapping. Tracked as a separate provider effort; not part of M6.
- **JMAP** — worth evaluating once Fastmail-style JMAP accounts matter;
  REST-based, so renderer-compatible.
