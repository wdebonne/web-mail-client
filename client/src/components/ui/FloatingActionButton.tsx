import { useEffect, useState, ReactNode } from 'react';
import {
  FabPosition,
  getFabPosition,
  FAB_POSITION_CHANGED_EVENT,
} from '../../utils/mailPreferences';

interface FloatingActionButtonProps {
  /** Click handler — typically opens the compose dialog or new event modal. */
  onClick: () => void;
  /** Accessible label and tooltip text. */
  label: string;
  /** Lucide icon (or any node) rendered inside the circular button. */
  icon: ReactNode;
  /**
   * Show only on mobile/tablet by default. Pass `false` to render at every
   * breakpoint. Desktop typically already has a primary action button.
   */
  mobileOnly?: boolean;
  /** Optional tailwind colour overrides. Default: outlook-blue. */
  className?: string;
}

/**
 * Position-aware floating action button. The position is stored in
 * `ui.fabPosition` (see `mailPreferences.ts`) and synced cross-device
 * via the prefs sync system. Listens for live updates so changing the
 * position in Settings reflects immediately on any open page.
 */
export default function FloatingActionButton({
  onClick, label, icon,
  mobileOnly = true,
  className = '',
}: FloatingActionButtonProps) {
  const [position, setPosition] = useState<FabPosition>(() => getFabPosition());

  useEffect(() => {
    const onChange = (e: any) => {
      const next: FabPosition | undefined = e?.detail?.position;
      if (next) setPosition(next);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'ui.fabPosition') setPosition(getFabPosition());
    };
    window.addEventListener(FAB_POSITION_CHANGED_EVENT, onChange as EventListener);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(FAB_POSITION_CHANGED_EVENT, onChange as EventListener);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  // Map the 9 grid cells to fixed-position Tailwind classes. Bottom positions
  // sit above the mobile bottom navigation (~64 px) so the FAB stays tappable.
  const positionClass = (() => {
    switch (position) {
      case 'top-left':      return 'top-20 left-4';
      case 'top-center':    return 'top-20 left-1/2 -translate-x-1/2';
      case 'top-right':     return 'top-20 right-4';
      case 'middle-left':   return 'top-1/2 left-4 -translate-y-1/2';
      case 'middle-center': return 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2';
      case 'middle-right':  return 'top-1/2 right-4 -translate-y-1/2';
      case 'bottom-left':   return 'bottom-20 left-4';
      case 'bottom-center': return 'bottom-20 left-1/2 -translate-x-1/2';
      case 'bottom-right':
      default:              return 'bottom-20 right-4';
    }
  })();

  const visibility = mobileOnly ? 'flex md:hidden' : 'flex';

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`fixed ${positionClass} ${visibility} z-40 w-14 h-14 rounded-full
        bg-outlook-blue hover:bg-outlook-blue-hover text-white shadow-lg
        items-center justify-center transition-colors active:scale-95 ${className}`}
    >
      {icon}
    </button>
  );
}
