import type { AgentToolHandlerResult, AgentToolInvokeContext } from '@purescience/platform-ui/bridge/react/usePlatformAgentTools'
import {
  createAppOperationsRegistry,
  defineAppTool,
  type AppAtomicToolDefinition,
} from '../lib/appFunctions'
import type { MailAgentToolContext } from './catalog'
import { PUREMAIL_ATOMIC_TOOL_SCHEMAS } from './atomicToolSchemas'
import { PUREMAIL_FUNCTIONS } from './functions'
import {
  addDraftAttachmentsHandler,
  applyFilterRetroactivelyHandler,
  applyMailActionHandler,
  commitReplyDraftHandler,
  composeMessageHandler,
  createBoxHandler,
  createFilterHandler,
  createMailTaskHandler,
  deleteFilterHandler,
  deleteViewHandler,
  discardDraftHandler,
  draftReplyHandler,
  fileThreadHandler,
  getDraftHandler,
  getMailContextHandler,
  getThreadHandler,
  listBoxesHandler,
  listDraftsHandler,
  listFiltersHandler,
  listMailChangesHandler,
  listThreadsHandler,
  listViewsHandler,
  markThreadsReadHandler,
  openThreadHandler,
  removeDraftAttachmentHandler,
  saveViewHandler,
  searchAllMailHandler,
  sendDraftHandler,
  setFilterEnabledHandler,
  showQueryHandler,
  updateDraftHandler,
} from './handlers'
import { saveAttachmentsHandler, saveMessageAsPdfHandler } from './documentHandlers'
import {
  getArchiveSweepHandler,
  listArchiveSweepsHandler,
  nextArchiveBatchHandler,
  readArchiveItemHandler,
  recordArchiveBatchHandler,
  startArchiveSweepHandler,
  stopArchiveSweepHandler,
} from './archiveSweepHandlers'
import {
  getTriageReportHandler,
  nextTriageBatchHandler,
  recordTriageHandler,
} from './aiTriageHandlers'
import {
  addDraftsToRunHandler,
  archiveRunHandler,
  createRunFromDraftsHandler,
  createRunHandler,
  getRunHandler,
  getRunRepliesHandler,
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
} from './runHandlers'
import {
  addMessageNoteHandler,
  getMessageNotesHandler,
  keepAsContextHandler,
  listKeptContextHandler,
  removeKeptContextHandler,
} from './readingRoomHandlers'

type AtomicRunner = (
  ctx: MailAgentToolContext,
  args: Record<string, unknown>,
  invoke: AgentToolInvokeContext,
) => Promise<AgentToolHandlerResult>

const ATOMIC_RUNNERS: Record<string, AtomicRunner> = {
  getMailContext: async ctx => getMailContextHandler(ctx),
  getMessageNotes: async (ctx, args) => getMessageNotesHandler(ctx, args),
  addMessageNote: async (ctx, args) => addMessageNoteHandler(ctx, args),
  listKeptContext: async (ctx, args) => listKeptContextHandler(ctx, args),
  keepAsContext: async (ctx, args) => keepAsContextHandler(ctx, args),
  removeKeptContext: async (ctx, args) => removeKeptContextHandler(ctx, args),
  listThreads: async (ctx, args) => listThreadsHandler(ctx, args),
  searchAllMail: async (ctx, args) => searchAllMailHandler(ctx, args),
  getThread: async (ctx, args) => getThreadHandler(ctx, args),
  showQuery: async (ctx, args) => showQueryHandler(ctx, args),
  listViews: async ctx => listViewsHandler(ctx),
  saveView: async (ctx, args) => saveViewHandler(ctx, args),
  deleteView: async (ctx, args) => deleteViewHandler(ctx, args),
  applyMailAction: async (ctx, args) => applyMailActionHandler(ctx, args),
  markThreadsRead: async (ctx, args) => markThreadsReadHandler(ctx, args),
  startArchiveSweep: async (ctx, args) => startArchiveSweepHandler(ctx, args),
  nextArchiveBatch: async (ctx, args) => nextArchiveBatchHandler(ctx, args),
  recordArchiveBatch: async (ctx, args) => recordArchiveBatchHandler(ctx, args),
  readArchiveItem: async (ctx, args) => readArchiveItemHandler(ctx, args),
  getArchiveSweep: async (ctx, args) => getArchiveSweepHandler(ctx, args),
  listArchiveSweeps: async () => listArchiveSweepsHandler(),
  stopArchiveSweep: async (ctx, args) => stopArchiveSweepHandler(ctx, args),
  nextTriageBatch: async (ctx, args) => nextTriageBatchHandler(ctx, args),
  recordTriage: async (ctx, args) => recordTriageHandler(ctx, args),
  getTriageReport: async (ctx, args) => getTriageReportHandler(ctx, args),
  listMailChanges: async (ctx, args) => listMailChangesHandler(ctx, args),
  commitReplyDraft: async (ctx, args) => commitReplyDraftHandler(ctx, args),
  draftReply: async (ctx, args) => draftReplyHandler(ctx, args),
  listDrafts: async (ctx, args) => listDraftsHandler(ctx, args),
  getDraft: async (ctx, args) => getDraftHandler(ctx, args),
  updateDraft: async (ctx, args) => updateDraftHandler(ctx, args),
  discardDraft: async (ctx, args) => discardDraftHandler(ctx, args),
  sendDraft: async (ctx, args) => sendDraftHandler(ctx, args),
  composeMessage: async (ctx, args) => composeMessageHandler(ctx, args),
  addDraftAttachments: async (ctx, args) => addDraftAttachmentsHandler(ctx, args),
  removeDraftAttachment: async (ctx, args) => removeDraftAttachmentHandler(ctx, args),
  saveAttachments: async (ctx, args) => saveAttachmentsHandler(ctx, args),
  saveMessageAsPdf: async (ctx, args) => saveMessageAsPdfHandler(ctx, args),
  createMailTask: async (ctx, args) => createMailTaskHandler(ctx, args),
  listFilters: async ctx => listFiltersHandler(ctx),
  createFilter: async (ctx, args) => createFilterHandler(ctx, args),
  applyFilterRetroactively: async (ctx, args) => applyFilterRetroactivelyHandler(ctx, args),
  createBox: async (ctx, args) => createBoxHandler(ctx, args),
  deleteFilter: async (ctx, args) => deleteFilterHandler(ctx, args),
  setFilterEnabled: async (ctx, args) => setFilterEnabledHandler(ctx, args),
  listBoxes: async ctx => listBoxesHandler(ctx),
  fileThread: async (ctx, args) => fileThreadHandler(ctx, args),
  openThread: async (ctx, args) => openThreadHandler(ctx, args),
  listRuns: async (ctx, args) => listRunsHandler(ctx, args),
  getRun: async (ctx, args) => getRunHandler(ctx, args),
  getRunReplies: async (ctx, args) => getRunRepliesHandler(ctx, args),
  createRun: async (ctx, args) => createRunHandler(ctx, args),
  createRunFromDrafts: async (ctx, args) => createRunFromDraftsHandler(ctx, args),
  renderRun: async (ctx, args) => renderRunHandler(ctx, args),
  setRunNote: async (ctx, args) => setRunNoteHandler(ctx, args),
  sendRunItem: async (ctx, args) => sendRunItemHandler(ctx, args),
  skipRunItem: async (ctx, args) => skipRunItemHandler(ctx, args),
  pauseRun: async (ctx, args) => pauseRunHandler(ctx, args),
  resumeRun: async (ctx, args) => resumeRunHandler(ctx, args),
  setRunRecipients: async (ctx, args) => setRunRecipientsHandler(ctx, args),
  setRunFieldMap: async (ctx, args) => setRunFieldMapHandler(ctx, args),
  setRunTemplate: async (ctx, args) => setRunTemplateHandler(ctx, args),
  insertRunNoteSlot: async (ctx, args) => insertRunNoteSlotHandler(ctx, args),
  previewRunItem: async (ctx, args) => previewRunItemHandler(ctx, args),
  addDraftsToRun: async (ctx, args) => addDraftsToRunHandler(ctx, args),
  archiveRun: async (ctx, args) => archiveRunHandler(ctx, args),
}

const atomicTools: AppAtomicToolDefinition<MailAgentToolContext>[] =
  PUREMAIL_ATOMIC_TOOL_SCHEMAS.map(schema => {
    const runner = ATOMIC_RUNNERS[schema.name]
    if (!runner) {
      throw new Error(`Missing atomic tool runner for "${schema.name}".`)
    }
    return defineAppTool<MailAgentToolContext>({
      ...schema,
      run: runner,
    })
  })

/**
 * PureMail's unified Operations Registry built on the Pure* App Functions primitive:
 *   - 10 composite `function` workflows (always exposed)
 *   - 13 core/release atomic tools (~20% of 66, always exposed)
 *   - 3 universal escape-hatch meta-tools (always exposed)
 *   - 53 extended specialist atomic tools (hidden by default, 100% reachable on demand)
 */
export const PUREMAIL_OPERATIONS_REGISTRY = createAppOperationsRegistry<MailAgentToolContext>({
  appSlug: 'mail',
  appName: 'PureMail',
  functions: PUREMAIL_FUNCTIONS,
  tools: atomicTools,
})
