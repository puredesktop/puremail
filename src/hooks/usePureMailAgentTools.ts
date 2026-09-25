import { useRef } from 'react'
import { usePlatformAgentTools } from '@purescience/platform-ui/bridge/react/usePlatformAgentTools'
import {
  AgentMailToolError,
  PUREMAIL_AGENT_LOG_LABEL,
  PUREMAIL_AGENT_TOOL_NAMES,
  type MailAgentToolContext,
} from '../agents/catalog'
import {
  addDraftAttachmentsHandler,
  removeDraftAttachmentHandler,
  applyFilterRetroactivelyHandler,
  createBoxHandler,
  createFilterHandler,
  listFiltersHandler,
  createMailTaskHandler,
  deleteViewHandler,
  composeMessageHandler,
  discardDraftHandler,
  draftReplyHandler,
  commitReplyDraftHandler,
  getDraftHandler,
  listDraftsHandler,
  updateDraftHandler,
  deleteFilterHandler,
  setFilterEnabledHandler,
  listBoxesHandler,
  fileThreadHandler,
  openThreadHandler,
  getMailContextHandler,
  getThreadHandler,
  listThreadsHandler,
  listViewsHandler,
  applyMailActionHandler,
  markThreadsReadHandler,
  listMailChangesHandler,
  saveViewHandler,
  searchAllMailHandler,
  showQueryHandler,
} from '../agents/handlers'
import {
  saveAttachmentsHandler,
  saveMessageAsPdfHandler,
} from '../agents/documentHandlers'
import {
  getTriageReportHandler,
  nextTriageBatchHandler,
  recordTriageHandler,
} from '../agents/aiTriageHandlers'
import {
  addDraftsToRunHandler,
  archiveRunHandler,
  createRunFromDraftsHandler,
  createRunHandler,
  getRunHandler,
  insertRunNoteSlotHandler,
  listRunsHandler,
  pauseRunHandler,
  previewRunItemHandler,
  renderRunHandler,
  resumeRunHandler,
  sendRunItemHandler,
  setRunFieldMapHandler,
  setRunNoteHandler,
  setRunRecipientsHandler,
  setRunTemplateHandler,
  skipRunItemHandler,
} from '../agents/runHandlers'

/**
 * Registers PureMail's agent tools with the shell. Without this the tools
 * declared in plugin.json are still shown to the model but every call times
 * out — the platform routes an invoke to the app tab and waits for a handler
 * that never registered.
 */
export function usePureMailAgentTools(
  ready: boolean,
  context: MailAgentToolContext,
): void {
  // Handlers close over a ref so a tool invoked mid-render always sees the
  // current store and query rather than the values from registration time.
  const contextRef = useRef(context)
  contextRef.current = context

  usePlatformAgentTools({
    ready,
    tools: PUREMAIL_AGENT_TOOL_NAMES,
    logLabel: PUREMAIL_AGENT_LOG_LABEL,
    errorType: AgentMailToolError,
    handlers: {
      getMailContext: async () => getMailContextHandler(contextRef.current),
      listThreads: async invoke =>
        listThreadsHandler(contextRef.current, invoke.arguments),
      searchAllMail: async invoke =>
        searchAllMailHandler(contextRef.current, invoke.arguments),
      getThread: async invoke =>
        getThreadHandler(contextRef.current, invoke.arguments),
      showQuery: async invoke =>
        showQueryHandler(contextRef.current, invoke.arguments),
      listViews: async () => listViewsHandler(contextRef.current),
      saveView: async invoke =>
        saveViewHandler(contextRef.current, invoke.arguments),
      deleteView: async invoke =>
        deleteViewHandler(contextRef.current, invoke.arguments),
      applyMailAction: async invoke =>
        applyMailActionHandler(contextRef.current, invoke.arguments),
      markThreadsRead: async invoke =>
        markThreadsReadHandler(contextRef.current, invoke.arguments),
      nextTriageBatch: async invoke =>
        nextTriageBatchHandler(contextRef.current, invoke.arguments ?? {}),
      recordTriage: async invoke =>
        recordTriageHandler(contextRef.current, invoke.arguments ?? {}),
      getTriageReport: async invoke =>
        getTriageReportHandler(contextRef.current, invoke.arguments ?? {}),
      listMailChanges: async invoke =>
        listMailChangesHandler(contextRef.current, invoke.arguments ?? {}),
      commitReplyDraft: async invoke => commitReplyDraftHandler(contextRef.current, invoke.arguments),
      draftReply: async invoke =>
        draftReplyHandler(contextRef.current, invoke.arguments),
      listDrafts: async invoke =>
        listDraftsHandler(contextRef.current, invoke.arguments),
      getDraft: async invoke =>
        getDraftHandler(contextRef.current, invoke.arguments),
      updateDraft: async invoke =>
        updateDraftHandler(contextRef.current, invoke.arguments),
      discardDraft: async invoke =>
        discardDraftHandler(contextRef.current, invoke.arguments),
      composeMessage: async invoke =>
        composeMessageHandler(contextRef.current, invoke.arguments),
      addDraftAttachments: async invoke =>
        addDraftAttachmentsHandler(contextRef.current, invoke.arguments),
      removeDraftAttachment: async invoke =>
        removeDraftAttachmentHandler(contextRef.current, invoke.arguments),
      saveAttachments: async invoke =>
        saveAttachmentsHandler(contextRef.current, invoke.arguments),
      saveMessageAsPdf: async invoke =>
        saveMessageAsPdfHandler(contextRef.current, invoke.arguments),
      createMailTask: async invoke =>
        createMailTaskHandler(contextRef.current, invoke.arguments),
      listFilters: async () => listFiltersHandler(contextRef.current),
      createFilter: async invoke =>
        createFilterHandler(contextRef.current, invoke.arguments),
      applyFilterRetroactively: async invoke =>
        applyFilterRetroactivelyHandler(contextRef.current, invoke.arguments),
      createBox: async invoke =>
        createBoxHandler(contextRef.current, invoke.arguments),
      deleteFilter: async invoke =>
        deleteFilterHandler(contextRef.current, invoke.arguments),
      setFilterEnabled: async invoke =>
        setFilterEnabledHandler(contextRef.current, invoke.arguments),
      listBoxes: async () => listBoxesHandler(contextRef.current),
      fileThread: async invoke =>
        fileThreadHandler(contextRef.current, invoke.arguments),
      openThread: async invoke =>
        openThreadHandler(contextRef.current, invoke.arguments),
      listRuns: async invoke =>
        listRunsHandler(contextRef.current, invoke.arguments ?? {}),
      getRun: async invoke => getRunHandler(contextRef.current, invoke.arguments),
      createRun: async invoke =>
        createRunHandler(contextRef.current, invoke.arguments),
      createRunFromDrafts: async invoke =>
        createRunFromDraftsHandler(contextRef.current, invoke.arguments),
      renderRun: async invoke =>
        renderRunHandler(contextRef.current, invoke.arguments),
      setRunNote: async invoke =>
        setRunNoteHandler(contextRef.current, invoke.arguments),
      sendRunItem: async invoke =>
        sendRunItemHandler(contextRef.current, invoke.arguments),
      skipRunItem: async invoke =>
        skipRunItemHandler(contextRef.current, invoke.arguments),
      pauseRun: async invoke =>
        pauseRunHandler(contextRef.current, invoke.arguments),
      resumeRun: async invoke =>
        resumeRunHandler(contextRef.current, invoke.arguments),
      setRunRecipients: async invoke =>
        setRunRecipientsHandler(contextRef.current, invoke.arguments),
      setRunFieldMap: async invoke =>
        setRunFieldMapHandler(contextRef.current, invoke.arguments),
      setRunTemplate: async invoke =>
        setRunTemplateHandler(contextRef.current, invoke.arguments),
      insertRunNoteSlot: async invoke =>
        insertRunNoteSlotHandler(contextRef.current, invoke.arguments),
      previewRunItem: async invoke =>
        previewRunItemHandler(contextRef.current, invoke.arguments),
      addDraftsToRun: async invoke =>
        addDraftsToRunHandler(contextRef.current, invoke.arguments),
      archiveRun: async invoke =>
        archiveRunHandler(contextRef.current, invoke.arguments),
    },
  })
}
