<p><img src="docs/assets/app-icon.svg" width="88" height="88" alt="puremail icon"></p>

# puremail

**Read, write, and organize email with its follow-up work.** An app for [puredesktop](https://puredesktop.ai).

[Get started](#getting-started) · [App guide](docs/app-guide.md) · [Develop](docs/development.md) · [Developer account](https://puredesktop.ai/developers)

## What it does

An email workspace with mailbox navigation, threaded reading, composition, and work tracking. Connect a supported account, manage conversations, and keep related tasks, follow-ups, and mail runs together.

## Requirements

Use a compatible [puredesktop](https://puredesktop.ai) build for desktop integration, storage, and the app drawer. Developer setup is covered in the [development guide](docs/development.md).

A supported mail account must be configured through the host. Sending and synchronization require network access.

## Getting started

1. Connect a supported mail account through the host’s account settings.
2. Select a mailbox and thread to read messages; compose or reply when ready.
3. Use linked tasks and follow-ups to track work associated with a conversation. Sending and synchronization require a configured account and network access.

## App layout

| Area | What you use it for |
| --- | --- |
| **Mailbox sidebar** | Choose accounts, mailboxes, views, and other mail work areas. |
| **Thread list** | Find and select a conversation. |
| **Reader and composer** | Read the selected thread, inspect attachments, and compose or reply. |
| **Work and settings controls** | Manage thread-linked tasks, follow-ups, runs, filters, and account-related options. |

The app also uses the shared [puredesktop](https://puredesktop.ai) shell and drawer agent. Panels can vary with the current view and selection.

## Working with the agent

Open the app’s drawer in [puredesktop](https://puredesktop.ai) and describe what you want to do. For example:

> Summarize this thread.
>
> Draft a reply addressing the open questions.

The app exposes 52 tools, including `getMailContext`, `listThreads`, `searchAllMail`. See [agents.md](agents.md) for workflows and [plugin.json](plugin.json) for the complete tool schemas and approval flags. Some actions apply directly, while approval-marked actions ask first. Check the result in the app after a change.

## Files and data

Threads, drafts, attachments, linked tasks, and mail runs connect to your configured mail account. Sent messages and attachments leave the app through that account.

## Develop and customize

We welcome **developers and vibecoders alike**. Fork puremail, add a feature, or use what you learn to build a new app.

| Develop your way | Workflow |
| --- | --- |
| **Claude Code, Codex, or your editor** | Open the app’s source folder, read `README.md`, `plugin.json`, `package.json`, and `agents.md`, then make changes and run the app’s checks. Test inside [puredesktop](https://puredesktop.ai) with matching shared platform packages. |
| **purefactory** | Choose **Start building** for a new app, or select an available app project to extend it. Use **Open folder** for external tools and **Open app** to test. |
| **App drawer** | Request a local app change where app-development integration is available. Make clear whether you want to change the app itself or its current document. |

Use **Share** in purefactory to create a `.pureapp` package, then **Settings → System → Install an app → Choose package…** to load it in current builds. Source availability and integration vary by host build.

Follow the [development guide](docs/development.md) for Claude Code/Codex commands, app-specific setup and checks, and packaging. A standalone browser preview does not provide every desktop service.

## Documentation and limitations

| Guide | What it covers |
| --- | --- |
| [App guide](docs/app-guide.md) | App overview, source layout, and usage. |
| [Development guide](docs/development.md) | External coding tools, purefactory, checks, and installation. |
| [Agent guide](agents.md) | App-specific agent workflows and constraints. |

Review recipients, attachments, and rendered mail-run items before sending. Account features depend on the connected provider.

## Contributing and marketplace

We welcome **developers and vibecoders alike**. Go to [puredesktop.ai](https://puredesktop.ai) and [create a developer account](https://puredesktop.ai/developers) to join the developer community and submit your app for review.

Bring improvements to this app, develop a fork, or build something entirely new. We welcome **open-source and proprietary projects alike** to the [puredesktop](https://puredesktop.ai) marketplace. Support for **paid apps is coming soon**, so you will be able to charge for your apps if you choose. Forks and redistributed dependencies must follow their applicable licenses.

For developer access, app submissions, or marketplace questions, contact [info@puredesktop.ai](mailto:info@puredesktop.ai).

Anyone may use, study, modify, and share this app under its applicable licenses. We welcome pull requests, bug reports, and documentation improvements. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Credits and license

Read and compose mail in [puredesktop](https://puredesktop.ai).

### License

Original code by pure.science inc is licensed under the [MIT License](LICENSE).
Copyright (c) 2026 pure.science inc. Third-party code, dependencies, and assets retain their own licenses and copyright notices.

### Major open-source projects

| Project / source | Homepage or documentation | Support the maintainers |
| --- | --- | --- |
| [kewisch/ical.js](https://github.com/kewisch/ical.js) | [Homepage / docs](https://kewisch.github.io/ical.js/) | — |
| [react/react](https://github.com/react/react) | [Homepage / docs](https://react.dev) | — |
| [styled-components/styled-components](https://github.com/styled-components/styled-components) | [Homepage / docs](https://styled-components.com) | [GitHub Sponsors](https://github.com/sponsors/quantizor) · [Open Collective](https://opencollective.com/styled-components) |

Thank you to these projects and their contributors. Additional direct dependencies,
upstream links, and asset notices are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
