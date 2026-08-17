import { Component, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Rendered instead of `children` once an error is caught. Receives the
   * caught error and a `retry` callback that clears the boundary's error
   * state — pair `retry` with a `key` change on the boundary's children
   * (or on the boundary itself) upstream if the failure needs a full
   * remount to actually recover, not just a re-render. */
  fallback: (error: Error, retry: () => void) => ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Minimal, reusable class-based error boundary (React only supports these
 * via `componentDidCatch`/`getDerivedStateFromError` — no hook equivalent
 * exists). Generic on purpose: every subtree that needs one (map, feed,
 * Catalog) supplies its own themed/i18n'd `fallback` render prop rather
 * than this component owning any UI opinion.
 *
 * Guards a subtree from crashing the whole screen on an unexpected render
 * error — e.g. `expo-sqlite`'s web engine rethrows database-open failures
 * (WebKit/OPFS storage-quota errors, in particular) as an uncaught React
 * render error when no `onError` handler intercepts them first.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  retry = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error) {
      return this.props.fallback(this.state.error, this.retry);
    }
    return this.props.children;
  }
}
