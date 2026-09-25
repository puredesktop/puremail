# PureMail: revamping Ask

Written after using Ask against a real thread. It is the last part of the
reader that has not been through a pass, and it shows: two genuine bugs, a
layout that fights its container, and the three-doors problem that
[`improvements-plan.md`](improvements-plan.md) §3 was supposed to remove
quietly reappearing inside the panel.

Everything below was confirmed in the code, not inferred from the screenshot.

---

## 1. Correctness first: the panel belongs to no thread

**The bug you can see.** `ThreadReader` holds `agentPanelOpen`,
`agentQuestion`, `agentAnswer` and `threadSummary` as local state
(`ThreadReader.tsx:317-324`). `<ThreadReader>` is rendered without a `key`
(`PureMailShell.tsx:2407`), so React keeps one instance alive across thread
selections, and the component contains **no `useEffect` at all** — nothing
clears that state when the thread changes.

So an answer about *MR Invoice* stays on screen when you open *Design
review attachments*, sitting directly under the new thread's subject. The
panel does not misattribute the answer in some subtle way — it presents
last thread's analysis as this thread's.

That is a trust bug, not a cosmetic one. An assistant that confidently shows
you the wrong email's answer is worse than one that shows nothing.

**The bug you cannot see.** There is no request token. `runAskAgent`
(`ThreadReader.tsx:326`) resolves into `setAgentAnswer` unconditionally, so a
question asked on thread A that returns *after* you switch to thread B writes
A's answer into B's panel. Clearing state on thread change does **not** fix
this — the in-flight promise still lands. Both need fixing, and the second is
the one that will survive a naive fix and reappear as an intermittent report.

**Fix.** Scope the state to the thread and make stale responses
unlandable:

- Reset panel state when `selectedThread.id` changes. The blunt version —
  `<ThreadReader key={selectedThread.id}>` — also resets scroll position and
  every other local state in a 1,900-line component, so prefer an explicit
  reset keyed on the id.
- Stamp each request with the thread id it was asked about (or an
  incrementing token held in a ref) and drop any response whose stamp is no
  longer current.
- Cover both with tests: state clears on thread change, and a response
  arriving after a thread switch is discarded. The second is exactly the kind
  of race that is easy to write and easy to regress.

---

## 2. The panel is laid out as a button

`ReplyImprovePanel` is rendered as the **third child of a
`ReaderCommandRow`** (`ThreadReader.tsx:1132-1194`), and that row is
`display: flex; align-items: center; justify-content: space-between`
(`mailShellStyles.ts`). A block panel is therefore being laid out as a flex
item beside the toolbar.

Everything odd in the screenshot follows from that one fact:

- The panel floats to the right of `Reply · Reply all · Ask · Archive`
  instead of appearing below them, vertically centred against the buttons.
- It is squeezed to whatever width is left over, so the input truncates its
  placeholder mid-word — "Ask about this thread — anal".
- `ReaderCommandRow` is then reused *inside* the panel for its two button
  rows. That component carries `border-top`, `min-height: 44px` and
  `justify-content: space-between`, so inside the panel it draws stray
  separator lines and pushes the two buttons to opposite edges — which is why
  "Summarize thread" and "Drafted below" sit so far apart with nothing
  between them.

**Fix.** Move the panel out of the row so it is a block under the header, and
stop reusing `ReaderCommandRow` as a generic layout primitive — give the
panel its own row component with no border and no `space-between`. This is a
small change that fixes most of what reads as "ugly" without any redesign.

---

## 3. One door, again

§3 of the improvements plan collapsed `Ask agent · Summarize · Draft reply`
into a single **Ask**. The toolbar did get shorter — but the three buttons
were moved into the panel rather than unified, so opening Ask now presents
*Ask*, *Summarize thread*, and *Draft a reply / Drafted below* as three
separate controls with three separate code paths (`runAskAgent`,
`runSummarize`, `createSelectedThreadDraft`). The decision the user has to
make is unchanged; it just happens one click later.

**Fix — one input, suggestions that fill it.** Keep a single text input as
the only way to ask for something. Offer "Summarize this thread", "What are
they asking me to do?", "Draft a reply" as **suggestion chips that populate
and submit the input**, not as sibling buttons. Discoverability is preserved,
the mental model collapses to one, and the special-case handlers become
prompts rather than parallel implementations.

Drafting stays a distinct capability underneath — it writes a draft rather
than returning prose — but it should be *reachable through the same door*.

---

## 4. Results are a dead end

Today the answer is a single string rendered into `ReplyImprovePreview`, and:

- **Asking again destroys the previous answer.** `runAskAgent` clears
  `agentAnswer` before each call, so there is no way to ask a follow-up while
  keeping what you just read. Follow-ups are the normal way people use this.
- **Errors are indistinguishable from answers.** The catch blocks write
  `The agent is not available: …` and `Summary unavailable: …` into the same
  box with the same styling (`ThreadReader.tsx:332-338`, `349-357`). A
  failure looks exactly like a considered response, with no retry.
- **Nothing can be done with an answer.** No copy, no "turn this into a
  task", no "use this as my reply". The one exception is summary action items,
  which do get an `Add task` button — proving the pattern is wanted and just
  is not applied anywhere else.
- **"Drafted below" is a disabled button used as a label.** It reports that a
  draft exists somewhere further down the page and then refuses to take you
  there. It should be a link that scrolls to and focuses the draft.

**Fix.** Render an append-only transcript of question/answer pairs for the
current thread, each answer carrying a small action row (Copy · Add task ·
Use as reply). Give errors their own tone and a Retry. Make the draft result
a link to the draft.

---

## 5. Status and affordances

- The **toolbar button doubles as a status readout** — it relabels itself
  `Working…` / `Drafting…` (`ThreadReader.tsx:1109-1113`), so the control you
  press to open the panel changes its name based on background activity, and
  the panel's own buttons say `Asking…` and `Working…` for the same wait.
  One vocabulary, and put progress inside the panel where the result will
  appear.
- **No way to close the panel** except pressing the toolbar button again.
  Add an explicit dismiss and support `Escape`.
- **Focus is not managed.** Opening the panel should focus the input;
  `Enter` already submits (`ThreadReader.tsx:1142`), which is right.
- **The placeholder is a disclaimer** — "analysis only, no drafts" — which is
  now also untrue, since the panel drafts. Say what to type, and put the
  boundary in the panel's own copy if it is worth stating.

---

## Suggested order

1. **Thread-scoped state + stale-response guard** (§1). It is a correctness
   bug and independent of any redesign. Do it first even if nothing else
   happens.
2. **Lift the panel out of the flex row** (§2). Small, and removes most of the
   visible ugliness.
3. **One input with suggestion chips** (§3).
4. **Transcript, answer actions, real error state** (§4).
5. **Status vocabulary, dismiss, focus, copy** (§5).

Items 1 and 2 are quick and worth doing together. Items 3–4 are the actual
redesign and change how the feature is used; 5 is polish that only makes
sense once 3–4 land.
