import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@aftergame/ui';
import { useT } from '../i18n/LocaleProvider.js';

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
      <RouteErrorFallback
        onRetry={() => {
          this.setState({ error: null });
        }}
      />
    );
  }
}

/**
 * The fallback, as a function component.
 *
 * An error boundary has to be a class — there is no hook equivalent of `getDerivedStateFromError`
 * — and a class cannot call `useT`. Splitting the message out is the whole fix, and it keeps the
 * boundary itself doing one thing: catching.
 */
function RouteErrorFallback({ onRetry }: { onRetry: () => void }) {
  const t = useT();

  return (
    <div className="mx-auto max-w-md px-6 py-16 text-center">
      <h1 className="text-lg font-semibold">{t('shell.errorTitle')}</h1>
      <p className="mt-2 text-sm text-[var(--color-ink-muted)]">{t('shell.errorBody')}</p>

      <Button variant="primary" className="mt-6" onClick={onRetry}>
        {t('shell.tryAgain')}
      </Button>
    </div>
  );
}
