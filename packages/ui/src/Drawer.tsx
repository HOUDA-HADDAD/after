import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from './primitives.js';

/**
 * The mobile navigation drawer.
 *
 * Built on Radix Dialog rather than a hand-rolled panel, because the hard parts of a drawer are
 * invisible: trapping focus while it is open, restoring it to the trigger on close, closing on
 * Escape, marking the rest of the page inert for screen readers, and locking body scroll. Getting
 * those wrong is the single most common accessibility failure in an app shell, and they are not
 * worth re-deriving.
 */
export function Drawer({
  open,
  onOpenChange,
  title,
  closeLabel,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Accessible name for the close button. A prop, because this package holds no dictionary. */
  closeLabel: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            'fixed inset-0 z-40 bg-black/40',
            'data-[state=open]:animate-in data-[state=open]:fade-in',
          )}
        />
        <Dialog.Content
          className={cn(
            'fixed inset-y-0 left-0 z-50 flex w-[18rem] max-w-[85vw] flex-col',
            'border-r border-[var(--color-border)] bg-[var(--color-surface)]',
            'focus:outline-none',
          )}
        >
          <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
            <Dialog.Title className="text-sm font-medium">{title}</Dialog.Title>
            <Dialog.Close
              aria-label={closeLabel}
              className="rounded-[var(--radius-control)] p-1 text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunken)]"
            >
              <X size={18} aria-hidden="true" />
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
