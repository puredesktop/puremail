# puremail roadmap

## Scope

Keep account-backed mail, threaded reading, drafts, work tracking and existing send approval. Provider expansion remains separate.

These are proposed, incremental improvements, not a release schedule or a list of missing core features. Keep each change small and preserve existing file formats, user data and app workflows.

## Improvements

1. **Recipient error explanations.** Explain invalid recipient chips on focus as well as hover, and keep the entered address available for correction.

2. **Duplicate recipient feedback.** Flag the same normalized address appearing in multiple recipient fields before sending without silently moving or removing recipients.

3. **Reply audience summary.** Show a compact To and Cc count beside reply-all so the recipient scope is visible before the composer is expanded.

4. **Empty subject reminder.** Give a lightweight confirmation when sending a message with no subject, while still allowing an intentional blank subject.

5. **Attachment size recap.** Show individual attachment sizes and a total in the composer, using existing provider limits to explain any rejected file.

6. **Failed attachment recovery.** Name the attachment that failed, preserve the message draft and let the user remove or retry that attachment explicitly.

7. **Draft save status clarity.** Differentiate locally edited, saving and saved draft states, and retain the text with a visible retry route after failure.

8. **Account identity visibility.** Keep the selected sending account visible when the composer is minimized or restored so users can check the identity before sending.

9. **Scheduled-send timezone hint.** Show the timezone and exact resolved date beside a custom send time, preserving the provider's existing scheduling capabilities.

10. **Quoted history controls.** Include the number of hidden messages and make expand or collapse controls keyboard accessible without changing the quoted content.

11. **Long address wrapping.** Wrap long sender and recipient addresses in thread details without pushing attachments or message actions out of view.

12. **Full timestamp access.** Show the complete received or sent timestamp on focus or hover while keeping short dates in the thread list.

13. **Search coverage explanation.** Label whether results cover locally synchronized messages or a provider search, using the existing search path rather than implying complete coverage.

14. **Search reset action.** Make active query and filter chips removable individually and provide a clear-all action for returning to the mailbox.

15. **Mailbox sync recency.** Show the last successful sync time separately from the current sync attempt and its error state.

16. **Unavailable action explanations.** Explain disabled archive, label, schedule or other actions in terms of the current provider's supported capabilities.

17. **Attachment open errors.** Differentiate download failure from an unavailable app handler, preserving the original message and exposing the attachment filename.

18. **Follow-up date clarity.** Pair relative follow-up dates with exact dates so a thread's next action is clear across day boundaries.

19. **Run progress wording.** Distinguish queued, running, paused and failed mail-run states in existing cards, with the last completed step when available.

20. **Filter destination recap.** Before saving a mail filter, summarize its conditions and target mailbox or label, including whether it skips the inbox.

## References

- [App guide](docs/app-guide.md)
- [Development guide](docs/development.md)
- [Current implementation](src/components/ComposeEditor.tsx)
- [Separate provider roadmap](docs/PROVIDER_ROADMAP.md)
