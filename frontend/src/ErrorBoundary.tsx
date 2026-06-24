import React from 'react'

interface ErrorBoundaryState {
  error: Error | null
  errorInfo: React.ErrorInfo | null
}

export class ErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
  constructor(props: React.PropsWithChildren) {
    super(props)
    this.state = { error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ error, errorInfo })
    console.error('[ErrorBoundary] React crash:', error, errorInfo)
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          background: '#1a1a2e',
          color: '#eee',
          fontFamily: '"JetBrains Mono", monospace',
          padding: 32,
          textAlign: 'center',
        }}>
          <pre style={{
            color: '#ff6b6b',
            fontSize: 14,
            maxWidth: '80vw',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            marginBottom: 16,
          }}>
            {this.state.error?.name}: {this.state.error?.message}
          </pre>
          <pre style={{
            color: '#aaa',
            fontSize: 11,
            maxWidth: '80vw',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: 300,
            overflow: 'auto',
          }}>
            {this.state.error?.stack}
          </pre>
          <button
            onClick={() => {
              this.setState({ error: null, errorInfo: null })
              window.location.reload()
            }}
            style={{
              marginTop: 24,
              padding: '10px 24px',
              background: '#00b4d8',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              fontFamily: 'inherit',
              cursor: 'pointer',
            }}
          >
            Reload Page
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
