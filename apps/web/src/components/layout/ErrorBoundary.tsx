import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Catches render errors so a bug shows a recovery screen instead of a blank page. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Log for developers. Do not log or transmit any meeting content.
    console.error('Unhandled UI error', error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <main className="page page--center">
        <div className="card card--narrow" role="alert">
          <h1 className="card__title">Something went wrong</h1>
          <p className="muted">The app hit an unexpected error. Reloading usually fixes it.</p>
          <div className="stack-row">
            <button type="button" className="btn btn--primary" onClick={() => window.location.reload()}>
              Reload
            </button>
            <a className="btn btn--ghost" href="/">
              Go home
            </a>
          </div>
        </div>
      </main>
    );
  }
}
