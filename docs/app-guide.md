# puremail app guide

An email workspace with mailbox navigation, threaded reading, composition, and work tracking. Connect a supported account, manage conversations, and keep related tasks, follow-ups, and mail runs together.

## Workspace layout

| Area | What you use it for |
| --- | --- |
| **Mailbox sidebar** | Choose accounts, mailboxes, views, and other mail work areas. |
| **Thread list** | Find and select a conversation. |
| **Reader and composer** | Read the selected thread, inspect attachments, and compose or reply. |
| **Work and settings controls** | Manage thread-linked tasks, follow-ups, runs, filters, and account-related options. |

## Working with puremail

1. Connect a supported mail account through the host’s account settings.
2. Select a mailbox and thread to read messages; compose or reply when ready.
3. Use linked tasks and follow-ups to track work associated with a conversation. Sending and synchronization require a configured account and network access.

## Development and loading

We welcome **developers and vibecoders alike**. [Create a developer account on puredesktop.ai](https://puredesktop.ai/developers), then use Claude Code, Codex, your own editor, or purefactory to develop this app or create a new one.

The [development guide](development.md) covers preparing this repository's shared dependencies, starting a coding agent, adding features in purefactory, and checking the result in the desktop. It includes the commands available in this repository.

Use **Open folder** in purefactory to edit a project externally, and **Open app** to test it. Use **Share** to create a `.pureapp` package, then **Settings → System → Install an app → Choose package…** in current builds to install it. Older versions may provide **File → Install App…**. A development server URL alone does not install an app.

To extend this app in purefactory, select its editable project when available. Source development builds can expose the suite's own apps; packaged installations do not expose every built-in app's source. See [create or extend an app](development.md#create-or-extend-an-app-with-purefactory) for that distinction and the app drawer workflow.

## Source layout

| Path | Purpose |
| --- | --- |
| [plugin.json](../plugin.json) | App identity, entry point, permissions, supported documents, and agent-tool declarations. |
| [package.json](../package.json) | Dependencies and development, build, and validation scripts. |
| [src/App.tsx](../src/App.tsx) | App entry and workspace composition. |
| [src/components](../src/components) | Workspace views, panels, and controls. |
| [src/hooks](../src/hooks) | Boot, state, and interaction hooks. |
| [src/lib](../src/lib) | App data models, document handling, and domain logic. |
| [src/agents](../src/agents) | Agent-tool declarations and handlers. |
| [src/bridge](../src/bridge) | Integration with the desktop’s services. |
| [agents.md](../agents.md) | Instructions and capabilities for the app’s agent. |
| [docs](../docs) | Usage and technical documentation. |

## Developer accounts and the marketplace

We welcome **developers and vibecoders alike**. Go to [puredesktop.ai](https://puredesktop.ai) and [create a developer account](https://puredesktop.ai/developers) to join the developer community and submit your app for review.

Bring improvements to this app, develop a fork, or build something entirely new. We welcome **open-source and proprietary projects alike** to the [puredesktop](https://puredesktop.ai) marketplace. Support for **paid apps is coming soon**, so you will be able to charge for your apps if you choose. Forks and redistributed dependencies must follow their applicable licenses.

For developer access, app submissions, or marketplace questions, contact [info@puredesktop.ai](mailto:info@puredesktop.ai).

## Contributing

We welcome pull requests, bug reports, new features, and documentation improvements. You may modify and distribute this app under its applicable licenses. See [CONTRIBUTING.md](../CONTRIBUTING.md), [LICENSE](../LICENSE), and [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).
