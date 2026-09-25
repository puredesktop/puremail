# Watchers And Follow-Ups Design Brief

PureMail / PureDesktop working draft.

This document records the intended distinction between follow-ups and watchers,
and the interaction model for a generalized watcher builder. It exists because
the current product can make a follow-up and a watcher feel like the same thing:
both default to a delay, both live near the same settings, and the watcher is
currently too narrow to communicate its real future shape.

## Core Model

**A follow-up is a reminder to you.**

It is an unconditional timer. It always fires, regardless of what happens on the
thread, and it lands on your task list. It tracks your own intent: "I owe this",
"revisit this", "check this later". It stays until you clear it.

**A watcher is a rule on the world.**

It is condition-first. It fires only when its condition is true, it disarms
itself when the thread resolves, and it can act outward. It tracks the other
side's behavior, or a change in a linked artifact, not your to-do list.

The product should make the distinction visible in the shape of the UI:

- A follow-up has no condition field. It only has a delay and a result that
  lands on your list.
- A watcher always reads as "when this happens, do this."
- If a watcher is created without a condition, the builder should catch that and
  offer to make it a follow-up instead.

## Watcher Primitive

A watcher is one primitive:

```text
WHEN trigger
IF optional condition
DO THIS action
```

Watchers are evaluated locally. Any outbound message, connector action, or
artifact-changing result is routed through QA before it is sent or saved.

## Trigger Taxonomy

### Time And Silence

- No reply by a deadline.
- A delay passes with no activity.

### Inbound

- Someone replies.
- A reply arrives with an attachment.
- A reply appears to mean yes, no, a date, approval, or rejection.

### Artifacts And Internal Events

- A linked file changes.
- A linked task is completed.
- A linked document is published.

This is where the watcher becomes more than a mail feature. It becomes a local
consistency layer that keeps threads, drafts, documents, and tasks in sync.

### Calendar And Cross-Thread

- A linked event ends.
- Another thread resolves.
- A calendar invite changes.

### External

- A connector status changes, such as invoice paid or build green.
- Future MCP-backed external events.

## Actions

The action copy should stay plain. Avoid exposing implementation labels like
skill, scope, tier, or A2A.

### Built-In Actions

These are local and silent:

- Nudge me.
- Create or update a task.
- Re-file or re-prioritize the thread.
- Update local status metadata.

### Hand It To An Agent

For richer actions, the user writes a prompt in plain words or picks a saved
prompt, then chooses who runs it:

- **PureDesktop assistant**: handles most single-context drafting or summarizing
  tasks.
- **A team of agents**: handles multi-step work that may touch several places.

What used to be described as a skill should be described on screen as **a saved
prompt**. A saved prompt is reusable, contextual, and remembers its usual target.

Examples:

- "Draft a recap" appears on mail threads and targets the assistant.
- "Resolve this thread end-to-end" targets a team of agents.

## Language Rules

An admin who has never seen the product should understand a watcher by reading
one sentence.

Avoid in UI copy:

- scoped skill
- scope
- trust tier
- A2A
- agent dispatch
- evaluate
- disarm

Use:

- "When this happens, do this."
- "Do this"
- "Have it done by"
- "Use a saved prompt"
- "You approve the result in QA"
- "Doesn't touch the web or your connectors"

Every watcher should end in one plain consequence sentence that changes with the
selected action and target.

Examples:

```text
The assistant writes this and puts it in QA for you to approve. It doesn't touch
the web or your connectors.
```

```text
A team works through this and puts the result in QA for you to approve. It may
use the web and your connectors.
```

## Trust And Safety Invariants

### QA Invariant

Any outbound message or artifact-changing result produced by a watcher lands in
QA for approval. Handing work to an agent feeds QA. It never bypasses QA.

### Honest Privacy Copy

The privacy line must match the selected target.

If a local built-in or local assistant only drafts, say that it does not reach
out. If a team run uses a cloud model or touches connectors, say that too.
Claiming "nothing leaves the machine" when something does would break the trust
story.

### Loop Guards

- A watcher cannot re-trigger itself.
- Agent runs have step caps.
- Agent runs have budget caps.
- Runs stop when the cap is reached.
- Every run is traceable.

### Behavior Is Derived, Not Configured

Users should not set abstract trust tiers. The product should derive the
consequence from the selected action and target, then explain it plainly.

## Architecture Implication

Agent-capable watchers turn the feature from a mail convenience into
PureDesktop's local event layer.

The watcher becomes the thing that turns:

```text
a file changed
a reply landed
a task finished
a deadline passed
```

into:

```text
run this local or agent-backed work
put the result in QA
wait for human approval
```

That ties Mail, QA, local events, and the agent runtime into one event-driven
spine. The differentiator is local-first, observable, approval-gated automation,
not a cloud black-box rules engine.

The governance cost is real: once agents are in the loop, the watcher list is no
longer just mail settings. It is the trigger registry for everything agents can
do automatically.

## Surfaces

### Builder

Create or edit a watcher with:

- WHEN
- optional IF
- DO THIS
- plain consequence sentence

The builder should catch no-condition watcher attempts and offer to create a
follow-up instead.

### Inline Thread Surface

The Live Mail card shows armed watchers for the current thread:

- what it watches
- armed or paused state
- pause
- cancel
- add a watcher

There should be one source of truth. Do not show a separate top input and a
second watcher card that describe the same watcher.

### Settings

Follow-up defaults and watcher defaults should be split cleanly.

Follow-up defaults:

- default delay
- behavior
- task list
- status copy

Watcher defaults:

- default condition delay
- default action
- ignore auto-replies
- QA policy copy

### Governance: View All Watchers

This surface is required once watchers can route work to agents.

It should show every armed rule across threads:

- what it watches
- what it does
- who it hands work to
- when it last fired
- whether it touches outbound messages
- whether it touches cloud or connectors
- pause or kill switch

## Defaults

Follow-up defaults:

- 3 days
- snooze plus task
- task list: "Mail follow-ups"
- status copy: "Follow-up applied."
- always fires

Watcher defaults:

- condition required
- default action: "nudge me"
- ignore auto-replies on
- never sends hidden mail
- auto-send only with pre-approved draft text

## Builder Reference Mock

The reference mock is titled "Watcher -> what to do" and centers on a plain
watcher builder card.

### Header

```text
When this happens, do this
```

Supporting copy:

```text
Write what you want done, or pick something you've saved before. Then choose who
does it. You always approve the result before anything is sent or changed.
```

### Trigger Recap

The card starts with a compact recap:

```text
When no reply arrives by Jun 22, 9:30 AM · on this thread
```

### Do This

Primary field label:

```text
Do this - in plain words
```

Example value:

```text
Draft a short recap of this thread from the linked notes.
```

Controls:

- "Use a saved prompt"
- "Save this one for next time"

Saved prompt examples:

- Draft a short recap, target assistant.
- Draft a polite chase, target assistant.
- Summarize what's unresolved, target assistant.
- Copyedit my reply, target assistant.
- Resolve this thread end-to-end, target team.
- Write a new prompt.

Selecting a saved prompt should also set its remembered target.

### Have It Done By

Two segmented choices:

```text
PureDesktop assistant
Handles most things on its own.
```

```text
A team of agents
For multi-step jobs that touch several places.
```

### Consequence Sentence

Assistant selected:

```text
The assistant writes this and puts it in QA for you to approve. It doesn't touch
the web or your connectors.
```

Team selected:

```text
A team works through this and puts the result in QA for you to approve. It may
use the web and your connectors to get it done.
```

Always-visible safety line:

```text
Nothing is sent or changed until you approve it in QA.
```

Primary actions:

- Turn this on.
- Save as my default.

## Done Looks Like

- A first-time user can tell a follow-up from a watcher without explanation.
- No screen shows the words scope, tier, A2A, or skill.
- Every watcher reads back as one plain sentence.
- Anything outbound or artifact-changing always routes to QA.
- The privacy line is accurate for the selected target.
- A watcher cannot loop.
- Agent runs are capped and traced.

## Open Decisions

### Saved Prompts

Light default:

- Saving a prompt silently remembers the target.
- It scopes the prompt to the context where it was made.
- Naming appears only for power users or larger libraries.

Library model:

- User names saved prompts.
- User chooses which contexts they appear in.

Recommendation: start light, revisit once the list grows.

### Budget And Approval Policy

Decide whether watcher-triggered agent runs draw on the same budget and approval
policy as user-initiated runs, or whether they need their own envelope.

This determines how much a watcher can spend while the user is not looking.

### Recursion

Can an agent dispatched by a watcher arm a new watcher?

Options:

- Allow it with trace.
- Require a human approval step for watcher creation.

Recommendation: require human approval for watcher creation in V1.

### Boundary

Decide how far the watcher generalizes before it becomes a rules engine. The
intended differentiator is not "rules engine"; it is local, observable,
QA-gated automation.
