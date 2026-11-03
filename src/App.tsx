import { useEffect } from 'react'
import { AppFrame } from '@purescience/platform-bridge/components/AppFrame'
import { assignHandoff } from './lib/assignHandoff'
import { EmptyState } from '@purescience/platform-ui/components/common/feedback/EmptyState'
import { usePlatformBridge } from '@purescience/platform-ui/bridge/react/usePlatformBridge'
import { usePlatformViewportResource } from '@purescience/platform-ui/bridge/react/usePlatformViewportResource'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import { PureMailShell } from './components/PureMailShell'
import { usePureMailBoot } from './hooks/usePureMailBoot'
import { useCopyKnown } from './hooks/useCopyKnown'

function isStandaloneDevMode(): boolean {
  return import.meta.env.DEV && window.parent === window
}

export function App(): React.ReactElement {
  const { bridge, error: bridgeError, ready, meta } = usePlatformBridge()
  const standalone = isStandaloneDevMode()
  const appReady = ready || standalone
  // Whether this copy is held in a page comes first: the shell mounts knowing, so nothing starts on a guess.
  const copyKnown = useCopyKnown(appReady)
  const { boot, bootError, rebootMail } = usePureMailBoot(appReady && copyKnown)
  // A document opened in Mail (Open with → Mail): it becomes an attachment
  // on a new message once the mail shell is up.
  const { resource, clearResource } = usePlatformViewportResource(
    ready && !standalone,
    meta,
  )

  // Release the shell's viewport loader the moment we show FINAL UI — the
  // mail shell, or an error screen (an error hidden behind the loader for
  // its 20s timeout would read as a hang).
  const showsFinalUi = Boolean(
    (bridgeError && !standalone) || bootError || (appReady && copyKnown && boot),
  )
  useEffect(() => {
    if (showsFinalUi) bridge.viewportReady()
  }, [bridge, showsFinalUi])

  if (bridgeError && !standalone) {
    return (
      <AppFrame>
        <EmptyState
          tone="error"
          title="Bridge unavailable"
          message={bridgeError.message}
        />
      </AppFrame>
    )
  }

  if (bootError) {
    return (
      <AppFrame>
        <EmptyState
          tone="error"
          title="Mail could not open"
          message={bootError.message}
          action={{ label: 'Try again', onClick: rebootMail }}
        />
      </AppFrame>
    )
  }

  if (!appReady || !copyKnown || !boot) {
    // Visually silent: the shell's global loader is still on screen at this
    // point, and a second branded "PureMail / Loading…" splash behind it
    // reads as a flash of a different loading screen. Errors above stay
    // loud; the happy path renders only the frame's own background.
    return <AppFrame>{null}</AppFrame>
  }

  return (
    <AppFrame
      data-puremail-standalone={standalone ? 'true' : undefined}
      // New mission… in the header: the open conversation and its documents.
      assign={() => assignHandoff.current?.() ?? null}
    >
      <AppErrorBoundary>
        <PureMailShell
          // Remount when a NEW boot lands: the shell seeds its state from
          // these props once, so a fresh boot needs a fresh instance. Keyed
          // on boot.bootId (stamped when the boot completes), NOT on the
          // reboot request counter — the counter bumps in the same commit as
          // the caller's own setStore, and remounting right then destroyed
          // that state before it was ever persisted (the saved IMAP account
          // vanished this way).
          key={`${boot.provider}-${boot.bootId}`}
          initialProvider={boot.provider}
          mailProvider={boot.mailProvider}
          initialStore={boot.store}
          initialNotice={boot.notice}
          initialSyncPending={boot.syncOnMount ?? false}
          onGoogleConnected={rebootMail}
          // The drawer session bound to this tab: where the setup prompt
          // box hands a template brief to the drawer agent.
          drawerSessionId={meta?.viewport?.sessionId ?? null}
          openedFile={resource}
          onOpenedFileHandled={clearResource}
        />
      </AppErrorBoundary>
    </AppFrame>
  )
}
