import styled from 'styled-components'
import { openExternalUrl } from '../bridge/platformBridge'
import { inviteDescriptionParagraphs } from '../lib/inviteDescription'

const Details = styled.div`
  margin-top: 14px;
  font-size: 14px;
  line-height: 1.6;
  overflow-wrap: anywhere;
  color: var(--platform-colors-text);
  p { margin: 0 0 8px; }
  p:last-child { margin-bottom: 0; }
  a { color: var(--platform-colors-text); text-decoration: underline;
      text-underline-offset: 3px; }
`

export function InviteDescription({ description }: { description: string }) {
  return <Details aria-label="Meeting details">
    {inviteDescriptionParagraphs(description).map((paragraph, index) => <p key={index}>
      {paragraph.map((segment, part) => segment.kind === 'text' ? segment.text :
        <a key={part} href={segment.href} title={segment.href} onClick={event => {
          event.preventDefault()
          void openExternalUrl(segment.href)
        }}>{segment.text}</a>)}
    </p>)}
  </Details>
}
