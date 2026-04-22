import { useEffect, useRef, useState } from 'react';
import { ChevronRight, Search } from 'lucide-react';

export interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;
  submenu?: ContextMenuItem[];
  /** Show a search box at the top of the submenu */
  submenuSearchable?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export default function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // Close on page scroll, but NOT when the scroll happens inside the menu
    // itself (e.g. the user scrolling a submenu such as the colour list).
    const handleScroll = (e: Event) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) {
        return;
      }
      onClose();
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    document.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
      document.removeEventListener('scroll', handleScroll, true);
    };
  }, [onClose]);

  // Adjust position to stay within viewport
  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      if (rect.right > vw) {
        menuRef.current.style.left = `${x - rect.width}px`;
      }
      if (rect.bottom > vh) {
        menuRef.current.style.top = `${Math.max(4, y - rect.height)}px`;
      }
    }
  }, [x, y]);

  return (
    <div
      ref={menuRef}
      className="fixed z-[100] bg-white rounded-lg shadow-xl border border-gray-200 py-1 min-w-[200px] animate-in fade-in zoom-in-95 duration-100"
      style={{ left: x, top: y }}
    >
      {items.map((item, index) => (
        <MenuItem key={index} item={item} onClose={onClose} />
      ))}
    </div>
  );
}

function MenuItem({ item, onClose }: { item: ContextMenuItem; onClose: () => void }) {
  const [showSubmenu, setShowSubmenu] = useState(false);
  const itemRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const [submenuSearch, setSubmenuSearch] = useState('');

  if (item.separator) {
    return <div className="my-1 border-t border-gray-200" />;
  }

  const hasSubmenu = item.submenu && item.submenu.length > 0;

  const handleMouseEnter = () => {
    if (hasSubmenu) {
      clearTimeout(timeoutRef.current);
      setShowSubmenu(true);
    }
  };

  const handleMouseLeave = () => {
    if (hasSubmenu) {
      timeoutRef.current = setTimeout(() => setShowSubmenu(false), 150);
    }
  };

  const handleClick = () => {
    if (hasSubmenu) {
      setShowSubmenu(!showSubmenu);
      return;
    }
    if (!item.disabled) {
      item.onClick();
      onClose();
    }
  };

  // Filter submenu items by search
  const filteredSubmenu = hasSubmenu
    ? submenuSearch
      ? item.submenu!.filter(sub =>
          !sub.separator && sub.label.toLowerCase().includes(submenuSearch.toLowerCase())
        )
      : item.submenu!
    : [];

  // Calculate submenu position
  const getSubmenuStyle = (): React.CSSProperties => {
    if (!itemRef.current) return { top: 0, left: '100%' };
    const rect = itemRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const submenuWidth = 240;

    // Open left if not enough space on the right
    const openLeft = rect.right + submenuWidth > vw;

    return {
      top: 0,
      ...(openLeft ? { right: '100%' } : { left: '100%' }),
    };
  };

  return (
    <div
      ref={itemRef}
      className="relative"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        onClick={handleClick}
        disabled={item.disabled && !hasSubmenu}
        className={`w-full flex items-center gap-3 px-3 py-1.5 text-sm text-left transition-colors
          ${item.disabled && !hasSubmenu
            ? 'text-gray-300 cursor-not-allowed'
            : item.danger
              ? 'text-red-600 hover:bg-red-50'
              : 'text-gray-700 hover:bg-outlook-bg-hover'
          }`}
      >
        {item.icon && <span className="w-4 h-4 flex items-center justify-center flex-shrink-0">{item.icon}</span>}
        <span className="flex-1">{item.label}</span>
        {hasSubmenu && <ChevronRight size={12} className="text-gray-400 flex-shrink-0" />}
      </button>

      {/* Submenu */}
      {hasSubmenu && showSubmenu && (
        <div
          ref={submenuRef}
          className="absolute z-[101] bg-white rounded-lg shadow-xl border border-gray-200 py-1 min-w-[220px] max-w-[280px] animate-in fade-in zoom-in-95 duration-100"
          style={getSubmenuStyle()}
          onMouseEnter={() => clearTimeout(timeoutRef.current)}
          onMouseLeave={handleMouseLeave}
        >
          {/* Search box */}
          {item.submenuSearchable && (
            <div className="px-2 pb-1 pt-1">
              <div className="flex items-center gap-2 px-2 py-1.5 border border-outlook-blue rounded bg-white">
                <Search size={12} className="text-gray-400 flex-shrink-0" />
                <input
                  type="text"
                  value={submenuSearch}
                  onChange={e => setSubmenuSearch(e.target.value)}
                  placeholder="Rechercher un dossier"
                  className="text-xs bg-transparent outline-none w-full text-gray-700 placeholder-gray-400"
                  autoFocus
                  onClick={e => e.stopPropagation()}
                />
                {submenuSearch && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setSubmenuSearch(''); }}
                    className="text-gray-400 hover:text-gray-600 text-xs"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Submenu items */}
          <div className="max-h-[300px] overflow-y-auto">
            {filteredSubmenu.length === 0 ? (
              <div className="px-3 py-2 text-xs text-gray-400">Aucun résultat</div>
            ) : (
              filteredSubmenu.map((sub, i) => {
                if (sub.separator) {
                  return <div key={i} className="my-1 border-t border-gray-200" />;
                }
                return (
                  <button
                    key={i}
                    onClick={() => {
                      if (!sub.disabled) {
                        sub.onClick();
                        onClose();
                      }
                    }}
                    disabled={sub.disabled}
                    className={`w-full flex items-center gap-3 px-3 py-1.5 text-sm text-left transition-colors
                      ${sub.disabled
                        ? 'text-gray-300 cursor-not-allowed'
                        : sub.danger
                          ? 'text-red-600 hover:bg-red-50'
                          : 'text-gray-700 hover:bg-outlook-bg-hover'
                      }`}
                  >
                    {sub.icon && <span className="w-4 h-4 flex items-center justify-center flex-shrink-0">{sub.icon}</span>}
                    <span className="truncate">{sub.label}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
