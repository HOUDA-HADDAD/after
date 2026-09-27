import { CircleHelp, Flame, MessageCircleHeart } from 'lucide-react';

/** Built-in themes store icon identifiers; custom themes store an emoji. */
export function ThemeIcon({ icon }: { icon: string }) {
  const Icon =
    icon === 'circle-help'
      ? CircleHelp
      : icon === 'flame'
        ? Flame
        : icon === 'message-circle-heart'
          ? MessageCircleHeart
          : undefined;
  return Icon === undefined ? <>{icon}</> : <Icon size="1em" aria-hidden="true" />;
}
