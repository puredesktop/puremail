# PureMail: space, surfaces and rhythm

Written after comparing the app against a reference mail design. The brief
was "more space, cleaner areas, less dead space" — which sounds
contradictory until you separate two kinds of white.

**Assigned white** sits *inside* things: card padding, row padding,
line-height. It reads as generosity.

**Residual white** is what is left over *around* things: the gap under a
fixed-height card floating in a large pane, the empty half of a row whose
only occupant is right-aligned, the stack of chrome above a list. It reads
as an unfinished layout.

We have plenty of white. Almost all of it is residual. Measured at 1280px
wide — every figure gets worse on a 2000px window:

| | |
|---|---|
| Sidebar chrome above the first email | **231px — 32% of the pane** |
| Empty row to the left of the action toolbar | **372px — 47% of that row** |
| Grey below the message page | **150px**, far more when the window is tall |

One thing that is *not* wrong, having checked: `MessageBody` is already
constrained to `74ch` at 16px/1.6 and measures 678px. Reading measure is
fine. An earlier probe of mine suggested 123 characters per line; it had
matched a different element and the number was wrong.

---

## 1. Fill the reader

**Now.** `ReaderHeader` and `MessageCard` are two white boxes of
`--puremail-page-width` (max 1040px) floating on a grey pane, each with its
own border and shadow. The page ends where the content ends, so everything
below is grey, and at wide sizes there are deep grey gutters either side.

**The problem with the metaphor.** A page on a desk is a nice idea, but it
only works when the page fills the desk. Ours stops two-thirds of the way
down, and the desk is otherwise empty — so the eye reads the void as
missing content rather than as deliberate space.

**Change.** Make the reading pane one continuous surface: the pane takes the
message background, and header and message drop their own backgrounds,
borders, shadows and rounded corners, keeping their padding. Content stays
constrained to the existing measure and centred. Messages separate with a
hairline rule rather than by floating apart.

This is what the reference does in its reading column, and what most mail
clients settle on. The void disappears because there is nothing left to be
void — the surface simply continues.

Keep the focused-message accent as a left border; that is information.

## 2. Left-align the toolbar to the content

`ReaderCommandRow` is `justify-content: space-between` with an almost always
empty `ReaderCommandMeta` as its first child, so the action buttons are
pushed to the far right and 372px of the row is empty. The buttons also end
up aligned to nothing — the content column starts far to their left.

**Change.** The row becomes `flex-start` and wraps; the meta line takes a
full-width basis and collapses when empty (`&:empty { display: none }`), so
the sync warning gets its own line when it exists rather than stealing half
a row when it does not. Actions align to the same left edge as the subject
and the message body.

## 3. Compress the sidebar chrome

231px sits above the first email: account name, account email, gear,
refresh, the New message button, a sync notice, the mailbox dropdown, and
the search field — eight elements before any mail.

**Change.** Fold the identity to one line with the connection state as a dot
rather than the word "online" on its own row, and let the sync notice occupy
that same line instead of claiming its own. Target ~120px, which returns
roughly two extra emails to the first screen.

## 4. An anchor in each row

A 32px avatar or initial at the left of every row. It costs nothing
vertically at our 64px rows, uses horizontal space we are currently wasting,
and gives the eye something to travel down. This is the single biggest
"looks designed" difference between the reference and us.

Deliberately after 1–3, because it changes the character of the list and is
the one item worth seeing before committing to.

## 5. A spacing scale

Margins in `mailShellStyles.ts` currently run 3, 5, 6, 10, 12, 13, 16, 24px
with no system behind them. Pick 4/8/12/16/24 and apply it. Also settle
elevation: exactly one raised surface, everything else flat. This is the
layer people feel but cannot name.

---

## Taken from the reference

- A filled reading column rather than a floating page.
- An anchor per row.
- A compact toolbar so the reading area stays calm.

## Rejected

- **Three-line previews.** Undoes the density pass.
- **A shadow on every row.** Noise at forty rows, and it fights the
  virtualisation.
- **Colour-coded categories and a pink call to action.** Decoration
  presented as information; we removed the Important/Other lane for the same
  reason.
- **Floating action buttons and "8 of 250".** Hidden affordances, and we
  scroll rather than page.

## Order

1–3 first: they are mostly deletion and realignment, and they are where
"cleaner" comes from. Then look at it before 4–5, which are what make it
beautiful rather than merely tidy.
