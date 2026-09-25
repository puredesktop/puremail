import { Button } from '@purescience/platform-ui/components/common/buttons/Button'
import {
  AttachmentPreviewBackdrop,
  AttachmentPreviewBody,
  AttachmentPreviewCard,
  AttachmentPreviewHeader,
  AttachmentPreviewImage,
  AttachmentPreviewText,
  AttachmentPreviewTitle,
} from './mailShellStyles'
import {
  type AttachmentPreviewState,
} from './mailShellHelpers'

export interface AttachmentPreviewOverlayProps {
  attachmentPreview: AttachmentPreviewState
  setAttachmentPreview: React.Dispatch<
    React.SetStateAction<AttachmentPreviewState | null>
  >
}

export function AttachmentPreviewOverlay({
  attachmentPreview,
  setAttachmentPreview,
}: AttachmentPreviewOverlayProps): React.ReactElement {
  return (
    <AttachmentPreviewBackdrop onClick={() => setAttachmentPreview(null)}>
      <AttachmentPreviewCard
        role="dialog"
        aria-modal="true"
        aria-label={`Preview of ${attachmentPreview.name}`}
        onClick={event => event.stopPropagation()}
      >
        <AttachmentPreviewHeader>
          <AttachmentPreviewTitle title={attachmentPreview.name}>
            {attachmentPreview.name}
          </AttachmentPreviewTitle>
          <Button size="sm" onClick={() => setAttachmentPreview(null)}>
            Close
          </Button>
        </AttachmentPreviewHeader>
        <AttachmentPreviewBody>
          {attachmentPreview.kind === 'image' &&
          attachmentPreview.imageUrl ? (
            <AttachmentPreviewImage
              src={attachmentPreview.imageUrl}
              alt={attachmentPreview.name}
            />
          ) : attachmentPreview.kind === 'pdf' && attachmentPreview.pdfUrl ? (
            <object
              data={attachmentPreview.pdfUrl}
              type="application/pdf"
              aria-label={`PDF preview of ${attachmentPreview.name}`}
              style={{ width: '100%', height: '100%', minHeight: 480 }}
            >
              <AttachmentPreviewText>
                This PDF cannot be rendered inline. Save it to disk to view
                it.
              </AttachmentPreviewText>
            </object>
          ) : (
            <AttachmentPreviewText>
              {attachmentPreview.text}
            </AttachmentPreviewText>
          )}
        </AttachmentPreviewBody>
      </AttachmentPreviewCard>
    </AttachmentPreviewBackdrop>
  )
}
