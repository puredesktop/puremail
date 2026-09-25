import { Component, type ErrorInfo, type ReactNode } from 'react'
import { EmptyState } from '@purescience/platform-ui/components/common/feedback/EmptyState'

interface AppErrorBoundaryProps {
  children: ReactNode
}

interface AppErrorBoundaryState {
  error: Error | null
  componentStack: string | null
}

export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = {
    error: null,
    componentStack: null,
  }

  static getDerivedStateFromError(
    error: Error,
  ): Partial<AppErrorBoundaryState> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ componentStack: info.componentStack ?? null })
    console.error('[puremail] render failed', error, info.componentStack)
  }

  render(): ReactNode {
    const { error, componentStack } = this.state
    if (!error) return this.props.children

    return (
      <EmptyState
        tone="error"
        title="PureMail could not render"
        message={[
          error.stack ?? error.message,
          componentStack ? `Component stack:${componentStack}` : '',
        ]
          .filter(Boolean)
          .join('\n\n')}
      />
    )
  }
}
