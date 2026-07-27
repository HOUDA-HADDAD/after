import type { SessionPhaseDto, SessionThemeDto } from '@aftergame/shared';
import { Badge } from '@aftergame/ui';
import { useT } from '../../../shared/i18n/LocaleProvider.js';

/** The phase, as a translation key. `usePhaseLabel` turns it into words. */
export function usePhaseLabel(): (phase: SessionPhaseDto) => string {
  const t = useT();

  return (phase) => t(`phase.${phase}`);
}

/**
 * The theme, pinned for the whole game.
 *
 * Required by the brief, and it earns the space: by the answering phase you are reading a
 * stranger's text with no idea what question it was written for. It sticks to the top of the
 * scroll container rather than the viewport, so on a phone it never fights the keyboard.
 */
export function ThemeBanner({
  theme,
  phase,
  children,
}: {
  theme: SessionThemeDto;
  phase: SessionPhaseDto;
  children?: React.ReactNode;
}) {
  const phaseLabel = usePhaseLabel();
  return (
    <div className="sticky top-0 z-10 border-b border-[var(--color-border)] bg-[var(--color-surface)]/95 backdrop-blur">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 sm:px-6">
        <span aria-hidden="true" className="text-lg">
          {theme.icon}
        </span>

        <h1 className="text-base font-semibold tracking-tight">{theme.name}</h1>

        <Badge tone="accent">{phaseLabel(phase)}</Badge>

        <p className="w-full text-sm text-[var(--color-ink-muted)] sm:w-auto sm:flex-1">
          {theme.description}
        </p>

        {children}
      </div>
    </div>
  );
}
