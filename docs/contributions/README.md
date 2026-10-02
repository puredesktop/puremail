# puremail contribution roadmap

[View roadmap issues](https://github.com/puredesktop/puremail/issues?q=is%3Aissue%20label%3Aroadmap)

Build something you can see and try in the app. The first five items are **good first contributions**: bounded changes with a concrete demonstration. Choose a feature below, fix a bug, or propose your own improvement.

## Scope

Keep account-backed mail, threaded reading, drafts, work tracking and existing send approval. Provider expansion remains separate.

Size describes scope, not a promised completion time: **Small** = one focused interface change; **Medium** = coordinated interface/state work; **Large** = a feature across several flows, storage or export paths. All items are proposals, not claims that existing features are absent. Check the current code and extend what is there. Maintainers review code and tests before merging. Attribution is your choice.

## Good first contributions

1. **[See the audience before replying to everyone.](https://github.com/puredesktop/puremail/issues/8)** Show a compact To and Cc count beside reply-all so the recipient scope is visible before the composer is expanded.
   <!-- contribution: {"id": "reply-audience-summary", "size": "small", "goodFirstIssue": true, "guide": "docs/contributions/reply-audience-summary.md"} -->
   [Small · Good first contribution · Implementation brief](https://github.com/puredesktop/puremail/blob/main/docs/contributions/reply-audience-summary.md)

2. **[See the total size of attachments.](https://github.com/puredesktop/puremail/issues/9)** Show individual attachment sizes and a total in the composer, using existing provider limits to explain any rejected file.
   <!-- contribution: {"id": "attachment-size-recap", "size": "small", "goodFirstIssue": true, "guide": "docs/contributions/attachment-size-recap.md"} -->
   [Small · Good first contribution · Implementation brief](https://github.com/puredesktop/puremail/blob/main/docs/contributions/attachment-size-recap.md)

3. **[Read a message’s exact timestamp.](https://github.com/puredesktop/puremail/issues/10)** Show the complete received or sent timestamp on focus or hover while keeping short dates in the thread list.
   <!-- contribution: {"id": "full-timestamp-access", "size": "small", "goodFirstIssue": true, "guide": "docs/contributions/full-timestamp-access.md"} -->
   [Small · Good first contribution · Implementation brief](https://github.com/puredesktop/puremail/blob/main/docs/contributions/full-timestamp-access.md)

4. **[See the exact date of a follow-up.](https://github.com/puredesktop/puremail/issues/11)** Pair relative follow-up dates with exact dates so a thread's next action is clear across day boundaries.
   <!-- contribution: {"id": "follow-up-date-clarity", "size": "small", "goodFirstIssue": true, "guide": "docs/contributions/follow-up-date-clarity.md"} -->
   [Small · Good first contribution · Implementation brief](https://github.com/puredesktop/puremail/blob/main/docs/contributions/follow-up-date-clarity.md)

5. **[Read long email addresses without losing actions.](https://github.com/puredesktop/puremail/issues/12)** Wrap long sender and recipient addresses in thread details without pushing attachments or message actions out of view.
   <!-- contribution: {"id": "long-address-wrapping", "size": "small", "goodFirstIssue": true, "guide": "docs/contributions/long-address-wrapping.md"} -->
   [Small · Good first contribution · Implementation brief](https://github.com/puredesktop/puremail/blob/main/docs/contributions/long-address-wrapping.md)

## More improvements

6. **[Correct an invalid recipient with the keyboard.](https://github.com/puredesktop/puremail/issues/13)** Explain invalid recipient chips on focus as well as hover, and keep the entered address available for correction.
   <!-- contribution: {"id": "recipient-error-explanations", "size": "small", "goodFirstIssue": false, "guide": "docs/contributions/recipient-error-explanations.md"} -->
   [Small · Implementation brief](https://github.com/puredesktop/puremail/blob/main/docs/contributions/recipient-error-explanations.md)

7. **[Spot an address repeated across recipient fields.](https://github.com/puredesktop/puremail/issues/14)** Flag the same normalized address appearing in multiple recipient fields before sending without silently moving or removing recipients.
   <!-- contribution: {"id": "duplicate-recipient-feedback", "size": "medium", "goodFirstIssue": false, "guide": "docs/contributions/duplicate-recipient-feedback.md"} -->
   [Medium · Implementation brief](https://github.com/puredesktop/puremail/blob/main/docs/contributions/duplicate-recipient-feedback.md)

8. **[Confirm an intentionally blank subject.](https://github.com/puredesktop/puremail/issues/15)** Give a lightweight confirmation when sending a message with no subject, while still allowing an intentional blank subject.
   <!-- contribution: {"id": "empty-subject-reminder", "size": "medium", "goodFirstIssue": false, "guide": "docs/contributions/empty-subject-reminder.md"} -->
   [Medium · Implementation brief](https://github.com/puredesktop/puremail/blob/main/docs/contributions/empty-subject-reminder.md)

9. **[Retry a failed attachment without losing the message.](https://github.com/puredesktop/puremail/issues/16)** Name the attachment that failed, preserve the message draft and let the user remove or retry that attachment explicitly.
   <!-- contribution: {"id": "failed-attachment-recovery", "size": "medium", "goodFirstIssue": false, "guide": "docs/contributions/failed-attachment-recovery.md"} -->
   [Medium · Implementation brief](https://github.com/puredesktop/puremail/blob/main/docs/contributions/failed-attachment-recovery.md)

10. **[Know whether a draft has saved.](https://github.com/puredesktop/puremail/issues/17)** Differentiate locally edited, saving and saved draft states, and retain the text with a visible retry route after failure.
   <!-- contribution: {"id": "draft-save-status-clarity", "size": "medium", "goodFirstIssue": false, "guide": "docs/contributions/draft-save-status-clarity.md"} -->
   [Medium · Implementation brief](https://github.com/puredesktop/puremail/blob/main/docs/contributions/draft-save-status-clarity.md)

11. **[Keep the sending account visible.](https://github.com/puredesktop/puremail/issues/18)** Keep the selected sending account visible when the composer is minimized or restored so users can check the identity before sending.
   <!-- contribution: {"id": "account-identity-visibility", "size": "small", "goodFirstIssue": false, "guide": "docs/contributions/account-identity-visibility.md"} -->
   [Small · Implementation brief](https://github.com/puredesktop/puremail/blob/main/docs/contributions/account-identity-visibility.md)

12. **[Check the timezone of a scheduled send.](https://github.com/puredesktop/puremail/issues/19)** Show the timezone and exact resolved date beside a custom send time, preserving the provider's existing scheduling capabilities.
   <!-- contribution: {"id": "scheduled-send-timezone-hint", "size": "medium", "goodFirstIssue": false, "guide": "docs/contributions/scheduled-send-timezone-hint.md"} -->
   [Medium · Implementation brief](https://github.com/puredesktop/puremail/blob/main/docs/contributions/scheduled-send-timezone-hint.md)

13. **[Expand quoted messages with the keyboard.](https://github.com/puredesktop/puremail/issues/20)** Include the number of hidden messages and make expand or collapse controls keyboard accessible without changing the quoted content.
   <!-- contribution: {"id": "quoted-history-controls", "size": "medium", "goodFirstIssue": false, "guide": "docs/contributions/quoted-history-controls.md"} -->
   [Medium · Implementation brief](https://github.com/puredesktop/puremail/blob/main/docs/contributions/quoted-history-controls.md)

14. **[Understand which mail a search covers.](https://github.com/puredesktop/puremail/issues/21)** Label whether results cover locally synchronized messages or a provider search, using the existing search path rather than implying complete coverage.
   <!-- contribution: {"id": "search-coverage-explanation", "size": "medium", "goodFirstIssue": false, "guide": "docs/contributions/search-coverage-explanation.md"} -->
   [Medium · Implementation brief](https://github.com/puredesktop/puremail/blob/main/docs/contributions/search-coverage-explanation.md)

15. **[Remove active mailbox filters.](https://github.com/puredesktop/puremail/issues/22)** Make active query and filter chips removable individually and provide a clear-all action for returning to the mailbox.
   <!-- contribution: {"id": "search-reset-action", "size": "medium", "goodFirstIssue": false, "guide": "docs/contributions/search-reset-action.md"} -->
   [Medium · Implementation brief](https://github.com/puredesktop/puremail/blob/main/docs/contributions/search-reset-action.md)

16. **[See when mail last synced successfully.](https://github.com/puredesktop/puremail/issues/23)** Show the last successful sync time separately from the current sync attempt and its error state.
   <!-- contribution: {"id": "mailbox-sync-recency", "size": "medium", "goodFirstIssue": false, "guide": "docs/contributions/mailbox-sync-recency.md"} -->
   [Medium · Implementation brief](https://github.com/puredesktop/puremail/blob/main/docs/contributions/mailbox-sync-recency.md)

17. **[Understand actions this account cannot perform.](https://github.com/puredesktop/puremail/issues/24)** Explain disabled archive, label, schedule or other actions in terms of the current provider's supported capabilities.
   <!-- contribution: {"id": "unavailable-action-explanations", "size": "medium", "goodFirstIssue": false, "guide": "docs/contributions/unavailable-action-explanations.md"} -->
   [Medium · Implementation brief](https://github.com/puredesktop/puremail/blob/main/docs/contributions/unavailable-action-explanations.md)

18. **[Find out why an attachment will not open.](https://github.com/puredesktop/puremail/issues/25)** Differentiate download failure from an unavailable app handler, preserving the original message and exposing the attachment filename.
   <!-- contribution: {"id": "attachment-open-errors", "size": "medium", "goodFirstIssue": false, "guide": "docs/contributions/attachment-open-errors.md"} -->
   [Medium · Implementation brief](https://github.com/puredesktop/puremail/blob/main/docs/contributions/attachment-open-errors.md)

19. **[Follow the actual state of a mail run.](https://github.com/puredesktop/puremail/issues/26)** Distinguish queued, running, paused and failed mail-run states in existing cards, with the last completed step when available.
   <!-- contribution: {"id": "run-progress-wording", "size": "medium", "goodFirstIssue": false, "guide": "docs/contributions/run-progress-wording.md"} -->
   [Medium · Implementation brief](https://github.com/puredesktop/puremail/blob/main/docs/contributions/run-progress-wording.md)

20. **[Check what a mail filter will do.](https://github.com/puredesktop/puremail/issues/27)** Before saving a mail filter, summarize its conditions and target mailbox or label, including whether it skips the inbox.
   <!-- contribution: {"id": "filter-destination-recap", "size": "medium", "goodFirstIssue": false, "guide": "docs/contributions/filter-destination-recap.md"} -->
   [Medium · Implementation brief](https://github.com/puredesktop/puremail/blob/main/docs/contributions/filter-destination-recap.md)

21. **[Browse attachments across the current mailbox.](https://github.com/puredesktop/puremail/issues/28)** Add a local attachment view with filename/type filtering and an open-thread action. Clearly show that it covers synchronized mail only and fetch attachment bytes only on explicit open.
   <!-- contribution: {"id": "browse-attachments-across-the-current-mailbox", "size": "large", "goodFirstIssue": false, "guide": "docs/contributions/browse-attachments-across-the-current-mailbox.md"} -->
   [Large · Implementation brief](https://github.com/puredesktop/puremail/blob/main/docs/contributions/browse-attachments-across-the-current-mailbox.md)

## References

- [App guide](https://github.com/puredesktop/puremail/blob/main/docs/app-guide.md)
- [Development guide](https://github.com/puredesktop/puremail/blob/main/docs/development.md)
- [Contributing](https://github.com/puredesktop/puremail/blob/main/CONTRIBUTING.md)
