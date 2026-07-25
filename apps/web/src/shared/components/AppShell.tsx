import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Link, useParams } from 'react-router';
import { Drawer, Button } from '@aftergame/ui';
import { Menu, Moon, Sun, LogOut } from 'lucide-react';
import { useSession } from '../../features/auth/SessionProvider.js';
import { useTheme } from '../hooks/useTheme.js';
import { useSocket } from '../realtime/SocketProvider.js';
import { GroupRail } from './GroupRail.js';
import { GroupSidebar } from './GroupSidebar.js';
import { DESKTOP_QUERY, useMediaQuery } from '../hooks/useMediaQuery.js';

/**
 * The application shell.
 *
 * Three regions, Slack-style: a slim rail of groups, a sidebar for the group you are in, and the
 * main panel. Below `md` the rail and sidebar collapse into one drawer and the main panel takes
 * the full width, because on a phone the game *is* the screen.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { groupId } = useParams();
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const wasOpen = useRef(false);

  /**
   * Whether the drawer is *actually* on screen, which is not the same as whether it was opened.
   *
   * Crossing the breakpoint — a phone turned sideways is enough — unmounts the drawer while the
   * state that opened it is still true. Trusting that state alone would leave the background
   * marked `inert` with nothing on top of it: an app that looks perfectly normal and answers no
   * input at all. Deriving it makes that state unrepresentable rather than merely unlikely.
   */
  const drawerVisible = drawerOpen && !isDesktop;

  // Belt and braces: also drop the open state, so widening and narrowing again does not bring
  // back a drawer nobody asked for.
  useEffect(() => {
    if (isDesktop) setDrawerOpen(false);
  }, [isDesktop]);

  /**
   * Put focus back on the button that opened the drawer.
   *
   * Radix does this itself, but only when it can: marking the background `inert` makes the
   * trigger unfocusable at the moment Radix tries, so focus lands on the body and a keyboard user
   * is stranded at the top of the document. Restoring after the re-render — once `inert` is gone —
   * is the price of the stronger background guarantee, and it is four lines.
   */
  useEffect(() => {
    if (wasOpen.current && !drawerVisible) triggerRef.current?.focus();
    wasOpen.current = drawerVisible;
  }, [drawerVisible]);

  const navigation = (
    <div className="flex h-full">
      <GroupRail
        activeGroupId={groupId}
        onNavigate={() => {
          setDrawerOpen(false);
        }}
      />
      <GroupSidebar groupId={groupId} />
    </div>
  );

  return (
    <>
      <div
        className="flex h-dvh flex-col bg-[var(--color-canvas)] text-[var(--color-ink)]"
        // While the drawer is open the rest of the shell is genuinely inert, not merely covered.
        // Radix already traps focus and marks the background `aria-hidden`; `inert` makes that
        // true of the DOM itself, so the background is unreachable by keyboard, pointer and
        // assistive technology rather than by a trap that has to hold.
        inert={drawerVisible}
      >
        {/* Keyboard users should not have to tab through the navigation to reach content. */}
        <a
          href="#main"
          className="sr-only rounded-[var(--radius-control)] bg-[var(--color-accent)] px-4 py-2 text-[var(--color-accent-ink)] focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50"
        >
          Skip to content
        </a>

        <TopBar
          triggerRef={triggerRef}
          showNavigationButton={!isDesktop}
          onOpenNavigation={() => {
            setDrawerOpen(true);
          }}
        />

        <div className="flex min-h-0 flex-1">
          {/* One navigation tree, never two. Above `md` it sits in the layout; below, it lives in
              the drawer. Rendering both and hiding one with CSS leaves a second copy of every
              link in the DOM — invisible to a browser, but not to a focus trap or an audit. */}
          {isDesktop && (
            <nav aria-label="Groups" className="flex">
              {navigation}
            </nav>
          )}

          <main id="main" className="min-w-0 flex-1 overflow-y-auto">
            {children}
          </main>
        </div>
      </div>

      {!isDesktop && (
        <Drawer open={drawerVisible} onOpenChange={setDrawerOpen} title="Groups">
          <nav aria-label="Groups">{navigation}</nav>
        </Drawer>
      )}
    </>
  );
}

function TopBar({
  triggerRef,
  showNavigationButton,
  onOpenNavigation,
}: {
  triggerRef: RefObject<HTMLButtonElement | null>;
  showNavigationButton: boolean;
  onOpenNavigation: () => void;
}) {
  const { state, logout } = useSession();
  const { theme, toggle } = useTheme();
  const { connection } = useSocket();

  return (
    <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
      <div className="flex items-center gap-2">
        {showNavigationButton && (
          <button
            ref={triggerRef}
            type="button"
            onClick={onOpenNavigation}
            aria-label="Open navigation"
            className="rounded-[var(--radius-control)] p-2 hover:bg-[var(--color-surface-sunken)]"
          >
            <Menu size={20} aria-hidden="true" />
          </button>
        )}

        <Link to="/" className="text-base font-semibold tracking-tight">
          Aftergame
        </Link>

        <ConnectionBadge connection={connection} />
      </div>

      <div className="flex items-center gap-1">
        {state.status === 'authenticated' && (
          <span className="hidden text-sm text-[var(--color-ink-muted)] sm:inline">
            {state.user.username}
          </span>
        )}

        <Button
          variant="ghost"
          size="sm"
          onClick={toggle}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          {theme === 'dark' ? (
            <Sun size={16} aria-hidden="true" />
          ) : (
            <Moon size={16} aria-hidden="true" />
          )}
        </Button>

        <Button variant="ghost" size="sm" onClick={() => void logout()} aria-label="Sign out">
          <LogOut size={16} aria-hidden="true" />
        </Button>
      </div>
    </header>
  );
}

/**
 * Connection status.
 *
 * Silent while everything is fine — a permanent green dot is noise. It appears only when the
 * connection is not live, which is the one time it tells the user something they can act on.
 */
function ConnectionBadge({ connection }: { connection: 'connecting' | 'live' | 'offline' }) {
  if (connection === 'live') return null;

  return (
    <span
      role="status"
      className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-xs text-[var(--color-ink-muted)]"
    >
      {connection === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
    </span>
  );
}
