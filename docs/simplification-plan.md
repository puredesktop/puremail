# PureMail: plan for a quiet, solid mail app

Goal: a mail app that is **readable, reliable, and quiet** — it does mail
well, does nothing on its own, and exposes a clean surface that agents can
drive.

Today the app is 41,590 lines across `src`. It has roughly 40 distinct
user-facing surfaces, 13 settings cards, two separate search engines that
disagree with each other, and a 3,665-line component that holds all state
for everything. This plan cuts it to about a third of that and reorganises
what remains around a single idea.

---

## The single idea: the list is a query

Right now a list of threads can come into existence three unrelated ways:

1. The rail list — `f(mailbox, inbox lane, special view, attachment filter)`,
   sorted by one hardcoded line, **search is not part of it**.
2. The search drawer — a *parallel* result list, capped at 8 items, produced
   by a different matcher (`filterThreadsForSearch`) with different rules
   about account scope, fetch window, trash, and label case.
3. `searchMailAndTasks` — a *third* matcher over the whole store with no
   account scope at all, feeding the command palette.

That is the root of "messy". Three answers to one question, and the user
can't tell which one they're looking at. It's also why counts disagree:
the sidebar badge counts threads while the rail renders conversations, from
different code paths.

**The fix:** exactly one way a thread list comes to exist.

```
resolveThreadQuery(store, query) -> { threads, total, query }
```

- The rail renders `resolveThreadQuery(store, currentQuery)`. Always. Only.
- Every sidebar nav item *is* a query: Inbox = `in:inbox`,
  Starred = `is:starred`, a label = `label:"Receipts"`.
- The search box always shows the current query and is always editable.
  Typing in it narrows the actual list, rather than opening a parallel one.
- Sort is part of the query (`sort:oldest`), not a hardcoded line.

Once that is true, the app becomes predictable for a person *and*
addressable by an agent, for free — because a query is a short string a
human can read and an agent can write.

---

## Answering the open question: agent lists and how the user sees them

> "Say we want a sorted, filtered list of emails for the agents to
> manipulate, for any use case — how do we make that part of the UI for easy
> reading by the user if needed?"

The answer falls out of the idea above: **don't build an agent list. Make the
agent's list and the user's list the same object.** There is nothing to
"surface" because the agent is pointing at the thing already on screen.

### Three objects, that's all

**1. Query** — a string in one language, the same one the user types.

```
in:inbox from:stripe is:unread older_than:30d sort:oldest
label:"Receipts" has:attachment after:2026/01/01
-from:me is:read in:archive sort:largest
```

Agents send this string. Not JSON, not an internal filter object — the
string, because it round-trips into the search box verbatim and the user can
read it, edit it, and re-run it. One parser, one resolver, one meaning. A
structured form can be *accepted* as input, but it is immediately normalised
to the canonical string via the existing `buildMailSearchQuery`.

**2. View** — a saved, named query, sitting in the sidebar next to Inbox.

```
"Newsletter purge"  =  label:newsletter older_than:60d sort:oldest
```

This is what makes "any use case" tractable without inventing new UI for each
one. An agent can create a view, and the user now has a permanent, clickable,
readable thing. Views are persisted; the current query is persisted too (none
of the filter state survives reload today).

**3. Proposal** — `{ query, threadIds, action, rationale }`.

An agent never mutates mail directly. It produces a proposal, and the
proposal renders as **the ordinary rail with those threads checked**, plus a
banner:

```
PureAssistant wants to archive 42 threads matching
  label:newsletter older_than:60d
                         [Approve all] [Approve checked] [Reject]
```

This deliberately reuses the multi-select and bulk-action bar the user
already drives by hand (`checkedThreadIds` + `BulkActionBar` +
`applyBulkTriageAction`). Unchecking a row, shift-selecting a range, changing
the label — all the normal gestures work on an agent's proposal, because it
is not a special mode, it is just a selection that something else made. The
existing-but-unused `'agent'` lane in the operations ledger becomes the audit
trail.

### The tool surface

The three tools currently declared in `plugin.json` are replaced. (They are
declared but never registered — see "Bugs found" — so nothing depends on
them.)

| Tool | Purpose | Approval |
|---|---|---|
| `listThreads({query, limit?, cursor?})` | Read a sorted, filtered list. Returns `{query, total, returned, threads[]}` | no |
| `getThread({threadId, includeBody?})` | Read one thread | no |
| **`showQuery({query})`** | **Point the user's rail at this query.** Returns `{shown, total}` | no |
| `saveView({name, query})` / `listViews()` | Create/list named views | save: yes |
| `proposeAction({query\|threadIds, action, rationale})` | Stage a reviewable batch | yes — via the review UI, not a modal |
| `createTask({threadId, ...})` / `createDraft({threadId, ...})` | Single-thread writes | yes |

`showQuery` is the whole answer to "for easy reading by the user if needed".
The agent can make its working set visible at any point, in one call, with no
bespoke rendering — because the rail is query-driven, showing an agent's
query costs literally nothing. The count the agent reports and the count on
screen come from the same resolver, so they cannot drift.

`action` in `proposeAction` reuses the existing `BulkTriageAction`
vocabulary, which is already clean and already provider-aware:
`archive | trash | read | label | move | category | snooze`.

### Query language, extended

Current operators (`mailSearchQuery.ts`): `from: to: subject: label: before:
after: has:attachment is:unread is:starred`. No negation, no OR, no mailbox
scope, no sort.

Needed for real use cases:

- `in:<mailbox>` — inbox/archive/sent/trash/custom
- `cc:` , `-` negation (`-from:me`), `OR` / parens
- `older_than:30d` / `newer_than:7d` — relative dates (agents need these far
  more than absolute ones)
- `is:read`, `is:snoozed`, `has:calendar`
- `sort:newest|oldest|sender|subject|largest`
- `limit:` — agent-side paging

Every one of these is also a thing a user might want typed into the box, so
there is no agent-only syntax. The operator-builder chips in the sidebar
extend to cover them.

---

## What gets cut

The app currently tries to be a mail client, an AI drafting studio, a QA
review console, a per-person voice-tuning system, a learning loop, and a
background work dispatcher. The mail client is the part worth keeping.

### Cut entirely

| Feature | Where | Why |
|---|---|---|
| Learning loop — "What PureMail has learned", learned rules, retired examples, draft comparisons, suppression rescue | `MailSettings.tsx` card 9, `mailDraftInsight.ts`, learning fields across `mailModel.ts` | Invisible state that silently changes behaviour. The opposite of quiet. |
| Person memory + per-person voice overrides | `MailContextPane.tsx` (1,091 lines), Person + Voice tabs | Enormous surface (tone/length/directness/format/greeting/signoff/avoid-phrases/examples/per-field locks) for marginal benefit. |
| QA review console extras — confidence chips, "Before you send" checklist, provenance panel, generated-vs-edited comparison, suppressed-draft view | `QaQueue.tsx` (1,393 lines) | The suppressed view is already unreachable (nothing sets that mode). The rest is ceremony around a draft. |
| Work requests → PureAssistant background jobs | `MailWorkRequest` in `types.ts`, `startMailWorkRequest`/`pollMailWorkRequest` in the shell, QA work sections | This is exactly what the agent tool API should do. A bespoke second pipeline for it is redundant. |
| Intent review dialog | `MailOverlays.tsx:98-298` | Ceremony before drafting. |
| AI Important/Other classification + editable classifier instructions + "Are you sure?" risk dialogs | `mailInboxClassifierAgent.ts`, settings card 4 | Background model calls on arriving mail. Keep a plain local rule, or nothing. |
| "Filed to …" explainer line, drafting chips | `ThreadReader.tsx:1132-1179` | Explaining machinery that will no longer exist. |

### Keep, but simplify

- **Drafting** — keep "draft a reply to this thread, on request". Drop the
  separate "Replies for review" tab; a generated draft is just a draft on the
  thread, marked as generated. That removes the second top-level tab and the
  whole QA rail.
- **Settings: 13 cards → 5** — Accounts & providers, Fetching, Signatures,
  Notifications, Shortcuts. (Also fixes the dead "Live Mail" nav link and the
  five cards that have no nav entry.)
- **Two action drawers → one** — "Organize" and "More" overlap heavily.
- **Right pane → Tasks only** — once Person and Voice are gone.

### Keep — this is the app

Provider sync (Gmail/IMAP) · fetch window · offline action queue · thread
list · reader · compose · attachments · remote-image gate + HTML sanitiser ·
labels · archive/trash/move/snooze/star · bulk triage · search · thread-linked
tasks and follow-ups · calendar-invite handoff · unsubscribe · keyboard
commands.

Rough estimate: cuts remove **12–15k lines**, before the restructure.

---

## Structural work

These are the "solid and reliable" items, distinct from feature cuts.

1. **Break up `PureMailShell.tsx`** (3,665 lines, one component, all state,
   40–60 props per child). Extract into hooks by domain: `useMailStore`,
   `useThreadQuery`, `useMailSelection`, `useMailSync`, `useComposeState`.
   Children read from context instead of prop soup.
2. **Break up `mailModel.ts`** (6,679 lines — 26% of the tree with its test).
   Split into `threads`, `drafts`, `labels`, `settings`, `persistence`,
   `classification`.
3. **One resolver** — collapse `filterThreadsForSearch` and
   `searchMailAndTasks` into `resolveThreadQuery`. Fixes the account-scope,
   fetch-window, trash, and label-case divergences in one move.
4. **Fix count consistency** — sidebar badges and rail rows must come from
   the same resolver and the same conversation-grouping.
5. **Virtualise the rail** — currently a plain `.map()` over every thread.
6. **Persist view state** — current query, sort, and saved views survive
   reload.

---

## Bugs found while surveying

Worth fixing regardless of the plan:

- **The declared agent tools are never registered.** `plugin.json` declares
  `getMailContext`, `listMailThreads`, `createMailTask`, but PureMail never
  calls `usePlatformAgentTools` / `registerAgentTools` — those names appear
  nowhere else in the repo, while 19 other apps in the suite do register
  handlers. Because the shell exposes manifest tools unfiltered when no
  registration exists, **the model is shown these tools and calls to them
  hang for 90 seconds and then fail.** PureMail would also fail the
  platform's own `validate-puredesktop-app` check.
- Settings nav "Live Mail" points at `settings-live-mail`, which no longer
  exists — scroll-to is a no-op. Five cards have no nav entry.
- Toggling the attachment filter does not clear the thread selection, so a
  bulk action can apply to threads that are no longer visible.
- `commandNotice` is regex-routed into three display channels; any notice
  matching none of the three patterns is silently never shown.
- The QA "suppressed drafts" view can never be opened.

---

## Phases

Ordered so that nothing gets carefully refactored right before being deleted.

**Phase 1 — Cut.** Delete the features in "Cut entirely", plus their types,
tests, settings cards, and store fields. Biggest single reduction; makes
every later phase smaller. Ends with a working, much quieter app.

**Phase 2 — The query core.** Build `resolveThreadQuery`, extend the query
language, make the rail render only from a query, make nav items and saved
views into queries, persist them. This is the keystone.

**Phase 3 — Split the shell and the model.** Now much easier, against a
smaller codebase with one list pipeline.

**Phase 4 — Agent provider API.** Register real handlers via
`usePlatformAgentTools`. Implement `listThreads`, `getThread`, `showQuery`,
`saveView`, `listViews`, `proposeAction`, `createTask`, `createDraft`. Build
the proposal review banner on top of the existing selection UI. Record agent
actions in the `'agent'` ledger lane.

**Phase 5 — Quiet and solid.** Virtualise the rail, fix count consistency,
fix the notice routing, audit that nothing calls a model without the user
asking, and settle the reliability edges (sync merge, offline queue).

Phases 1 and 2 are the ones that make it feel like a different app. Phase 4
is the one that makes it useful to agents, and it is small *because* of
phase 2.
