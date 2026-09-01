import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console -- surfaces uncaught render errors for diagnostics
    console.error('[ErrorBoundary] Uncaught render error:', error, info.componentStack)
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-8">
          <div className="max-w-lg w-full border border-red-800 bg-zinc-900 rounded p-6 flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
              <span className="text-sm font-bold uppercase tracking-widest text-red-400">Application Error</span>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed">
              An unexpected error occurred. The page needs to be reloaded.
            </p>
            <pre className="text-[10px] font-mono text-zinc-500 bg-zinc-950 border border-zinc-800 rounded p-3 overflow-auto max-h-40 whitespace-pre-wrap break-all">
              {this.state.error.message}
            </pre>
            <button
              onClick={this.handleReload}
              className="self-start px-4 py-1.5 text-xs font-bold uppercase tracking-widest bg-orange-500 text-black rounded hover:bg-orange-400 transition-colors cursor-pointer"
            >
              Reload
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
