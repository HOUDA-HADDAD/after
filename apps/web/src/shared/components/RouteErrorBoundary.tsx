import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@aftergame/ui';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * A per-route error boundary.
 *
 * Scoped to the route rather than the whole app on purpose: a screen that throws should not take
 * the shell with it, so the navigation stays usable and the user can go somewhere else instead of
 * reloading. React has no hook equivalent for this, which is why it is still a class.
 */
export class RouteErrorBoundary extends Component<Props, State> {
  public override state: State = { error: null };

  public static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  public override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Never silently swallowed: without this the boundary hides the bug it is containing.
    console.error('Route crashed', error, info.componentStack);
  }

  public override render(): ReactNode {
    const { error } = this.state;

    if (error === null) return this.props.children;

    return (
      <div className="mx-auto max-w-md px-6 py-16 text-center">
        <h1 className="text-lg font-semibold">Something went wrong on this screen</h1>
        <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
          The rest of the app is still working. Try again, or pick another group.
        </p>

        <Button
          variant="primary"
          className="mt-6"
          onClick={() => {
            this.setState({ error: null });
          }}
        >
          Try again
        </Button>
      </div>
    );
  }
}
