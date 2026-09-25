# PureMail: improvements plan

Written after seeing the app run against a real Gmail account (41 threads)
rather than the 6-thread demo mailbox. Real volume changes the priorities:
problems that were invisible with six rows dominate with forty, and will
dominate far harder at four thousand.

This follows [`simplification-plan.md`](simplification-plan.md), whose
phases 1, 2 and 4 have landed. Phase 3 (structural split) is still open and
appears at the end here.

---

## 1. Density — the highest-leverage change

**The problem.** The thread list is the product. With a real inbox you can
see 7 threads out of 41. `ThreadRow` is `min-height: 84px` plus a 13/11px
padding block and an 8px row gap, so each row costs ~90–100px. Two-line
subjects and a signal-chip row push some rows past that.

This was genuinely invisible with demo data. It is the first thing anyone
with real mail will feel.

**Target.** Roughly 2.5× the rows on screen — about 36–40px per row — while
keeping the list readable rather than cramped.

**Changes:**

- One line per field, with truncation: sender + time on the first line,
  subject + snippet sharing the second. No wrapped subjects.
- Drop `min-height` to a line-height-derived value; cut padding to ~6px
  vertical.
- Signal chips move inline and only render when they carry information
  (`reply requested` does; `sync pending` on freshly synced mail does not —
  see §4).
- The checkbox appears on hover, on keyboard focus, or once any row is
  checked — not permanently on every row. Two controls before any content on
  every row is what makes the list feel busy.
- Keep the star always visible; it is a status as much as a control.

**Do not** add a density setting. Pick one good default. A setting here is
an admission that we did not choose.

**Verify** against a real inbox, not the demo store: count visible rows at a
standard window height before and after.

---

## 2. Make Important / Other earn its place, or remove it

**The problem.** On a real inbox the split reads `Important 5 · Other 36`.
That is not a useful division — it says "almost everything is Other." It
occupies a permanent line above every list and asks the user to make a
decision every time they look at it, while returning close to nothing.

Phase 1 removed the AI classifier, so this is now driven purely by local
rules that were never tuned against a real mailbox.

**Two honest options:**

- **Earn it.** Tune the local rules against real inbox data until the split
  is meaningfully predictive, and show the count only when it is (e.g. hide
  when one side holds >85% of the mail).
- **Remove it.** Delete the lane concept, the `is:important` / `is:other`
  query terms, the lane counts, and the "Filed to …" line. Rely on search
  and saved views instead — which is what phase 2 made cheap.

Recommendation: **remove it** unless there is appetite for the tuning work.
It is the last surviving piece of the "app decides for you" layer that
phases 1 and 4 otherwise stripped out, and it is not currently earning the
screen space.

---

## 3. One AI affordance, not three

The reader toolbar reads:

```
Reply · Reply all · Ask agent · Summarize · Draft reply · Archive · Follow up · More
```

`Ask agent`, `Summarize` and `Draft reply` are three doors into the same
capability. Collapse to a single **Ask** entry point whose panel offers
summarise and draft as suggested actions, and drop the other two buttons.
That takes the toolbar to five items and removes the "which one do I want?"
decision.

---

## 4. Status language that tells the truth

- **`sync pending` on freshly synced mail.** It means "local changes not yet
  pushed," but sitting under "Gmail inbox synced." it reads as a
  contradiction. Show it only when there is actually an unpushed local
  change, and word it as such (`unsent change`).
- **`Filed to Other. mark important`** reads like debug output — a sentence
  fragment with a lowercase link glued on. If §2 keeps the lanes, make it a
  proper control; if §2 removes them, this line goes with it.
- **The Fetch button in demo mode.** It can never fetch, but you have to
  click it to find out. Disable it with the reason as its tooltip, or
  relabel it, rather than letting it fail politely every time.

---

## 5. Scale: the list will not survive a real mailbox

Two ceilings, neither of which the demo data exposed:

- **No virtualisation.** `ThreadRail` is a plain `.map` over every thread.
  41 rows is fine; 4,000 is not. Density (§1) makes this worse by putting
  more rows in the DOM at once. Add windowing.
- **The fetch window caps at 30 days.** For a real account that is a hard
  limit on what the app can ever show — mail older than a month is
  unreachable, and the resolver applies the window as an unconditional
  scope. Either raise the ceiling, or let a query opt out of it explicitly
  (`older_than:60d` currently cannot return anything).

The second is more likely to bite first: a user searching for something from
two months ago gets silence, with no indication the window is why.

---

## 6. Structural work (phase 3, still open)

Unchanged from the simplification plan, and still last:

- `PureMailShell.tsx` is ~2,700 lines holding all state; extract into hooks
  by domain (`useMailQuery`, `useMailSelection`, `useMailSync`,
  `useComposeState`).
- `mailModel.ts` is ~5,100 lines; split into `threads`, `drafts`, `labels`,
  `settings`, `persistence`.

No user-visible payoff, which is exactly why it should follow the items
above rather than precede them. Worth doing as its own commit so a reviewer
can skip it wholesale.

---

## Suggested order

1. **Density** (§1) — changes how the app feels more than everything else
   combined.
2. **Decide Important/Other** (§2) — removal is a quick win and unblocks §4.
3. **Status language** (§4) — small, and stops the UI contradicting itself.
4. **One AI affordance** (§3).
5. **Scale** (§5) — before real users hit either ceiling.
6. **Structural split** (§6).

Items 1–4 are all small. Item 5 is the first that needs real design thought.
