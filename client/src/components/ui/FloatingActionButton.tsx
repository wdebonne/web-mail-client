import { useEffect, useState, useRef, useCallback, ReactNode } from 'react';
import {
  FabPosition,
  getFabPosition,
  FAB_POSITION_CHANGED_EVENT,
} from '../../utils/mailPreferences';

export interface FabMenuItem {
  id: string;
  label: string;
  icon: ReactNode;
}

interface FloatingActionButtonProps {
  onClick: () => void;
  label: string;
  icon: ReactNode;
  mobileOnly?: boolean;
  className?: string;
  longPressItems?: FabMenuItem[];
  onLongPressAction?: (id: string) => void;
}

const LONG_PRESS_MS = 500;

export default function FloatingActionButton({
  onClick, label, icon,
  mobileOnly = true,
  className = '',
  longPressItems = [],
  onLongPressAction,
}: FloatingActionButtonProps) {
  const [position, setPosition] = useState<FabPosition>(() => getFabPosition());
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const [activeId, setActiveId] = useState<string | null>(null);

  const fabRef = useRef<HTMLButtonElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClickRef = useRef(false);
  const itemRefs = useRef<Map<string, HTMLElement>>(new Map());

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

  // Dismiss menu on outside tap
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (fabRef.current?.contains(target)) return;
      const menuEl = document.getElementById('fab-long-press-menu');
      if (menuEl?.contains(target)) return;
      setMenuOpen(false);
      setActiveId(null);
    };
    window.addEventListener('pointerdown', onDown, { capture: true });
    return () => window.removeEventListener('pointerdown', onDown, { capture: true });
  }, [menuOpen]);

  const openMenu = useCallback(() => {
    if (!fabRef.current) return;
    const rect = fabRef.current.getBoundingClientRect();
    setMenuStyle({
      right: Math.round(window.innerWidth - rect.right),
      bottom: Math.round(window.innerHeight - rect.top + 12),
    });
    setMenuOpen(true);
    suppressClickRef.current = true;
  }, []);

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    setActiveId(null);
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!longPressItems.length) return;
    fabRef.current?.setPointerCapture(e.pointerId);
    timerRef.current = setTimeout(openMenu, LONG_PRESS_MS);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!menuOpen) return;
    const { clientX: x, clientY: y } = e;
    let found: string | null = null;
    itemRefs.current.forEach((el, id) => {
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) found = id;
    });
    setActiveId(found);
  };

  const handlePointerUp = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (menuOpen) {
      if (activeId) onLongPressAction?.(activeId);
      closeMenu();
    }
  };

  const handlePointerCancel = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    suppressClickRef.current = false;
    closeMenu();
  };

  const handleClick = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onClick();
  };

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
    <>
      <button
        ref={fabRef}
        type="button"
        onClick={handleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        aria-label={label}
        title={label}
        className={`fixed ${positionClass} ${visibility} z-40 w-14 h-14 rounded-full
          bg-outlook-blue hover:bg-outlook-blue-hover text-white shadow-lg
          items-center justify-center transition-all duration-150
          ${menuOpen ? 'scale-110 shadow-xl' : 'active:scale-95'} ${className}`}
      >
        {icon}
      </button>

      {/* Long-press slide-out menu — fixed card above the FAB */}
      {menuOpen && longPressItems.length > 0 && (
        <div
          id="fab-long-press-menu"
          className={`fixed z-50 flex flex-col gap-2 items-end pointer-events-none ${mobileOnly ? 'md:hidden' : ''}`}
          style={menuStyle}
        >
          {longPressItems.map((item, i) => (
            <div
              key={item.id}
              ref={(el) => {
                if (el) itemRefs.current.set(item.id, el);
                else itemRefs.current.delete(item.id);
              }}
              style={{
                animationDelay: `${i * 60}ms`,
                pointerEvents: 'auto',
              }}
              className={`flex items-center gap-2.5 px-4 py-3 rounded-full shadow-lg border
                select-none transition-all duration-150 animate-fab-item
                ${activeId === item.id
                  ? 'bg-outlook-blue text-white border-outlook-blue scale-105 shadow-xl'
                  : 'bg-white text-outlook-text-primary border-outlook-border'
                }`}
            >
              {item.icon}
              <span className="text-sm font-medium whitespace-nowrap">{item.label}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
