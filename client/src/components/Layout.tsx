import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../stores/authStore';
import { useThemeStore } from '../stores/themeStore';
import { useUIStore } from '../stores/uiStore';
import { useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'motion/react';
import {
  Mail, Calendar, Users, Settings, Shield, Search, KeyRound,
  LogOut, Menu, Sun, Moon, Monitor, Check, RefreshCw,
  X, ChevronRight,
} from 'lucide-react';
import CacheIndicator from './CacheIndicator';
import { api } from '../api';

interface LayoutProps {
  children: ReactNode;
}

const PTR_THRESHOLD = 80;

function getScrollableScrollTop(target: EventTarget | null): number {
  let el = target as Element | null;
  while (el && el !== document.documentElement) {
    const style = getComputedStyle(el);
    const overflow = style.overflowY + style.overflow;
    if (/(auto|scroll)/.test(overflow) && el.scrollHeight > el.clientHeight) {
      return el.scrollTop;
    }
    el = el.parentElement;
  }
  return window.scrollY;
}

export default function Layout({ children }: LayoutProps) {
  const { t } = useTranslation();
  const { user, logout } = useAuthStore();
  const themeMode = useThemeStore((s) => s.mode);
  const themeResolved = useThemeStore((s) => s.resolved);
  const setThemeMode = useThemeStore((s) => s.setMode);
  const toggleMobileSidebar = useUIStore((s) => s.toggleMobileSidebar);
  const queryClient = useQueryClient();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<{ emails: any[]; contacts: any[]; events: any[] }>({ emails: [], contacts: [], events: [] });
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchContainerRef = useRef<HTMLDivElement | null>(null);
  const suggestionDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [ptrState, setPtrState] = useState<'idle' | 'pulling' | 'releasing' | 'refreshing'>('idle');
  const [ptrY, setPtrY] = useState(0);
  const ptrStartY = useRef(0);
  const ptrActive = useRef(false);
  const mainRef = useRef<HTMLElement | null>(null);

  const triggerRefresh = useCallback(async () => {
    setPtrState('refreshing');
    await queryClient.invalidateQueries();
    setTimeout(() => {
      setPtrState('idle');
      setPtrY(0);
    }, 600);
  }, [queryClient]);

  const onTouchStart = useCallback((e: TouchEvent) => {
    if (getScrollableScrollTop(e.target) > 0) return;
    ptrStartY.current = e.touches[0].clientY;
    ptrActive.current = true;
  }, []);

  const onTouchMove = useCallback((e: TouchEvent) => {
    if (!ptrActive.current) return;
    if (getScrollableScrollTop(e.target) > 0) { ptrActive.current = false; return; }
    const dy = e.touches[0].clientY - ptrStartY.current;
    if (dy <= 0) { ptrActive.current = false; return; }
    e.preventDefault();
    const clamped = Math.min(dy * 0.5, PTR_THRESHOLD + 20);
    setPtrY(clamped);
    setPtrState(clamped >= PTR_THRESHOLD * 0.5 ? 'releasing' : 'pulling');
  }, []);

  const onTouchEnd = useCallback(() => {
    if (!ptrActive.current) return;
    ptrActive.current = false;
    if (ptrY >= PTR_THRESHOLD * 0.5) {
      triggerRefresh();
    } else {
      setPtrState('idle');
      setPtrY(0);
    }
  }, [ptrY, triggerRefresh]);

  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, [onTouchStart, onTouchMove, onTouchEnd]);

  useEffect(() => {
    if (!userMenuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (!userMenuRef.current) return;
      if (!userMenuRef.current.contains(e.target as Node)) setUserMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [userMenuOpen]);

  // Ctrl+K / Cmd+K → focus search bar
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
      if (e.key === 'Escape' && showSuggestions) {
        setShowSuggestions(false);
        searchInputRef.current?.blur();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [showSuggestions]);

  // Close suggestions when clicking outside
  useEffect(() => {
    if (!showSuggestions) return;
    const onDocClick = (e: MouseEvent) => {
      if (!searchContainerRef.current?.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [showSuggestions]);

  // Debounced suggestions fetch
  const fetchSuggestions = useCallback((q: string) => {
    if (suggestionDebounceRef.current) clearTimeout(suggestionDebounceRef.current);
    if (q.trim().length < 2) {
      setSuggestions({ emails: [], contacts: [], events: [] });
      return;
    }
    suggestionDebounceRef.current = setTimeout(async () => {
      setSuggestionsLoading(true);
      try {
        const res = await api.search(q, { limit: 5 });
        setSuggestions({
          emails: res.emails?.slice(0, 4) || [],
          contacts: res.contacts?.slice(0, 3) || [],
          events: res.events?.slice(0, 3) || [],
        });
      } catch {
        setSuggestions({ emails: [], contacts: [], events: [] });
      } finally {
        setSuggestionsLoading(false);
      }
    }, 300);
  }, []);

  // Detect search context from current route
  const searchContext = location.pathname.startsWith('/calendar')
    ? 'calendar'
    : location.pathname.startsWith('/contacts')
    ? 'contacts'
    : 'mail';

  const searchPlaceholder =
    searchContext === 'calendar'
      ? 'Rechercher dans les agendas… (Ctrl+K)'
      : searchContext === 'contacts'
      ? 'Rechercher des contacts… (Ctrl+K)'
      : 'Rechercher des e-mails… (Ctrl+K)';

  const primaryNavItems = [
    { path: '/mail', icon: Mail, labelKey: 'nav.mailbox' },
    { path: '/calendar', icon: Calendar, labelKey: 'nav.calendar' },
    { path: '/contacts', icon: Users, labelKey: 'nav.contacts' },
  ];

  const supportNavItems = [
    { path: '/settings', icon: Settings, labelKey: 'nav.settings' },
    { path: '/security', icon: KeyRound, labelKey: 'nav.security' },
    ...(user?.isAdmin ? [{ path: '/admin', icon: Shield, labelKey: 'nav.admin' }] : []),
  ];

  const hamburgerActive =
    location.pathname.startsWith('/mail')
    || location.pathname.startsWith('/calendar')
    || location.pathname.startsWith('/settings')
    || location.pathname.startsWith('/admin');

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;
    setShowSuggestions(false);
    searchInputRef.current?.blur();
    if (searchContext === 'calendar') {
      navigate(`/calendar?search=${encodeURIComponent(q)}`);
    } else if (searchContext === 'contacts') {
      navigate(`/contacts?search=${encodeURIComponent(q)}`);
    } else {
      navigate(`/mail?search=${encodeURIComponent(q)}`);
    }
  };

  const handleGlobalSearch = () => {
    const q = searchQuery.trim();
    if (!q) return;
    setShowSuggestions(false);
    searchInputRef.current?.blur();
    navigate(`/search?q=${encodeURIComponent(q)}`);
  };

  const hasSuggestions =
    suggestions.emails.length > 0 ||
    suggestions.contacts.length > 0 ||
    suggestions.events.length > 0;

  const initials = (user?.displayName?.[0] || user?.email?.[0] || '?').toUpperCase();

  return (
    <div className="h-full flex flex-col">
      <header className="h-12 bg-outlook-blue flex items-center px-3 sm:px-4 flex-shrink-0 gap-2">
        <button
          onClick={() => hamburgerActive && toggleMobileSidebar()}
          className={`text-white p-1.5 rounded lg:hidden ${
            hamburgerActive ? 'hover:bg-white/10' : 'opacity-40 cursor-default'
          }`}
          aria-label={t('layout.show_hide_sidebar')}
          title={t('layout.show_hide_sidebar')}
        >
          <Menu size={20} />
        </button>

        <span className="text-white font-semibold text-sm mr-4 hidden lg:inline">WebMail</span>

        <div ref={searchContainerRef} className="flex-1 max-w-2xl relative">
          <form onSubmit={handleSearch}>
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/60 pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                placeholder={searchPlaceholder}
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  fetchSuggestions(e.target.value);
                  setShowSuggestions(e.target.value.trim().length >= 2);
                }}
                onFocus={() => {
                  if (searchQuery.trim().length >= 2) setShowSuggestions(true);
                }}
                className="w-full bg-white/15 text-white placeholder-white/50 rounded-lg px-3 py-2 pl-9 pr-8 text-sm border border-white/20 focus:bg-white/25 focus:outline-none focus:border-white/50 transition-all shadow-sm"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => { setSearchQuery(''); setSuggestions({ emails: [], contacts: [], events: [] }); setShowSuggestions(false); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-white/50 hover:text-white/90 transition-colors"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </form>

          {/* Suggestions dropdown */}
          <AnimatePresence>
            {showSuggestions && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.15 }}
                className="absolute top-full left-0 right-0 mt-1 bg-outlook-bg-secondary border border-outlook-border rounded-lg shadow-xl z-50 overflow-hidden"
              >
                {suggestionsLoading && (
                  <div className="px-4 py-3 text-sm text-outlook-text-secondary flex items-center gap-2">
                    <div className="w-3 h-3 border border-outlook-blue border-t-transparent rounded-full animate-spin" />
                    Recherche en cours…
                  </div>
                )}

                {!suggestionsLoading && !hasSuggestions && searchQuery.trim().length >= 2 && (
                  <div className="px-4 py-3 text-sm text-outlook-text-secondary">
                    Aucun résultat pour « {searchQuery} »
                  </div>
                )}

                {/* Email suggestions */}
                {suggestions.emails.length > 0 && (
                  <div>
                    <div className="px-3 py-1.5 text-[10px] font-semibold text-outlook-text-disabled uppercase tracking-wide border-b border-outlook-border flex items-center gap-1.5">
                      <Mail size={10} /> E-mails
                    </div>
                    {suggestions.emails.map((email) => (
                      <button
                        key={email.id}
                        className="w-full text-left px-3 py-2 hover:bg-outlook-bg-hover flex items-start gap-2 group"
                        onClick={() => {
                          setShowSuggestions(false);
                          navigate(`/mail?search=${encodeURIComponent(searchQuery)}&openUid=${email.uid}&accountId=${email.account_id}&folder=${encodeURIComponent(email.folder)}`);
                        }}
                      >
                        <div className={`mt-0.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${email.is_read ? 'bg-transparent' : 'bg-outlook-blue'}`} />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate text-outlook-text-primary">{email.subject || '(sans objet)'}</div>
                          <div className="text-xs text-outlook-text-secondary truncate">{email.from_name || email.from_address}</div>
                        </div>
                        <div className="text-[10px] text-outlook-text-disabled flex-shrink-0">
                          {new Date(email.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {/* Contact suggestions */}
                {suggestions.contacts.length > 0 && (
                  <div className={suggestions.emails.length > 0 ? 'border-t border-outlook-border' : ''}>
                    <div className="px-3 py-1.5 text-[10px] font-semibold text-outlook-text-disabled uppercase tracking-wide border-b border-outlook-border flex items-center gap-1.5">
                      <Users size={10} /> Contacts
                    </div>
                    {suggestions.contacts.map((contact) => (
                      <button
                        key={contact.id}
                        className="w-full text-left px-3 py-2 hover:bg-outlook-bg-hover flex items-center gap-2"
                        onClick={() => {
                          setShowSuggestions(false);
                          navigate(`/contacts?search=${encodeURIComponent(searchQuery)}`);
                        }}
                      >
                        <div className="w-6 h-6 rounded-full bg-outlook-blue/20 text-outlook-blue flex items-center justify-center text-[10px] font-semibold flex-shrink-0">
                          {(contact.display_name?.[0] || contact.email?.[0] || '?').toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate text-outlook-text-primary">{contact.display_name || contact.email}</div>
                          {contact.display_name && <div className="text-xs text-outlook-text-secondary truncate">{contact.email}</div>}
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {/* Event suggestions */}
                {suggestions.events.length > 0 && (
                  <div className={(suggestions.emails.length > 0 || suggestions.contacts.length > 0) ? 'border-t border-outlook-border' : ''}>
                    <div className="px-3 py-1.5 text-[10px] font-semibold text-outlook-text-disabled uppercase tracking-wide border-b border-outlook-border flex items-center gap-1.5">
                      <Calendar size={10} /> Événements
                    </div>
                    {suggestions.events.map((event) => (
                      <button
                        key={event.id}
                        className="w-full text-left px-3 py-2 hover:bg-outlook-bg-hover flex items-center gap-2"
                        onClick={() => {
                          setShowSuggestions(false);
                          navigate(`/calendar?search=${encodeURIComponent(searchQuery)}`);
                        }}
                      >
                        <div className="w-2 h-2 rounded-full flex-shrink-0 mt-1" style={{ background: event.calendar_color || '#3b82f6' }} />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate text-outlook-text-primary">{event.title}</div>
                          <div className="text-xs text-outlook-text-secondary truncate">
                            {new Date(event.start_date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}
                            {event.calendar_name && ` · ${event.calendar_name}`}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {/* Footer actions */}
                <div className="border-t border-outlook-border px-3 py-2 flex gap-2">
                  <button
                    onClick={handleSearch}
                    className="flex items-center gap-1.5 text-xs text-outlook-blue hover:text-outlook-blue/80 font-medium"
                  >
                    <Search size={12} />
                    Rechercher « {searchQuery} »
                    {searchContext === 'mail' && ' dans les e-mails'}
                    {searchContext === 'calendar' && ' dans les agendas'}
                    {searchContext === 'contacts' && ' dans les contacts'}
                  </button>
                  <div className="flex-1" />
                  <button
                    onClick={handleGlobalSearch}
                    className="flex items-center gap-1 text-xs text-outlook-text-secondary hover:text-outlook-text-primary"
                  >
                    Chercher partout <ChevronRight size={11} />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="ml-auto flex items-center gap-1">
          <CacheIndicator />
          <div className="relative" ref={userMenuRef}>
            <button
              onClick={() => setUserMenuOpen((v) => !v)}
              className="w-9 h-9 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-white text-sm font-semibold transition-colors"
              aria-haspopup="menu"
              aria-expanded={userMenuOpen}
              title={user?.displayName || user?.email || ''}
            >
              {initials}
            </button>

            {userMenuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full mt-2 z-50 w-64 bg-outlook-bg-secondary text-outlook-text-primary border border-outlook-border rounded-md shadow-lg py-1"
              >
                <div className="px-3 py-2 border-b border-outlook-border flex items-center gap-2">
                  <div className="w-9 h-9 rounded-full bg-outlook-blue text-white flex items-center justify-center text-sm font-semibold">
                    {initials}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{user?.displayName || user?.email}</div>
                    {user?.displayName && user?.email && (
                      <div className="text-xs text-outlook-text-secondary truncate">{user.email}</div>
                    )}
                  </div>
                </div>

                <div className="px-3 py-2 border-b border-outlook-border">
                  <div className="text-xs uppercase tracking-wide text-outlook-text-secondary mb-1">
                    {t('layout.theme')}
                  </div>
                  <div className="flex flex-col">
                    {([
                      { value: 'system', labelKey: 'layout.theme_system', icon: Monitor },
                      { value: 'light', labelKey: 'layout.theme_light', icon: Sun },
                      { value: 'dark', labelKey: 'layout.theme_dark', icon: Moon },
                    ] as const).map(({ value, labelKey, icon: Icon }) => (
                      <button
                        key={value}
                        onClick={() => setThemeMode(value)}
                        className={`flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-outlook-bg-hover ${
                          themeMode === value ? 'text-outlook-blue font-medium' : ''
                        }`}
                      >
                        <Icon size={14} />
                        <span>{t(labelKey)}</span>
                        {themeMode === value && <Check size={14} className="ml-auto" />}
                      </button>
                    ))}
                  </div>
                  <div className="mt-1 text-[11px] text-outlook-text-secondary">
                    {t(themeResolved === 'dark' ? 'layout.theme_current_dark' : 'layout.theme_current_light')}
                  </div>
                </div>

                <button
                  onClick={() => { setUserMenuOpen(false); logout(); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-outlook-bg-hover"
                >
                  <LogOut size={14} />
                  <span>{t('layout.logout')}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <nav className="hidden lg:flex bg-outlook-bg-primary border-r border-outlook-border flex-col items-center py-2 flex-shrink-0 w-14">
          <div>
            {primaryNavItems.map((item) => {
              const isActive = location.pathname.startsWith(item.path);
              const Icon = item.icon;
              const label = t(item.labelKey);
              return (
                <button
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  className={`w-10 h-10 rounded-lg flex items-center justify-center mb-1 transition-colors relative group
                    ${isActive ? 'text-white' : 'text-outlook-text-secondary hover:bg-outlook-bg-hover'}`}
                  title={label}
                >
                  {isActive && (
                    <motion.div
                      layoutId="nav-active"
                      className="absolute inset-0 bg-outlook-blue rounded-lg"
                      transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                    />
                  )}
                  <Icon size={20} className="relative z-10" />
                  <span className="absolute left-12 bg-gray-800 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 transition-opacity">
                    {label}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex-1" />

          <div className="pb-2">
            {supportNavItems.map((item) => {
              const isActive = location.pathname.startsWith(item.path);
              const Icon = item.icon;
              const label = t(item.labelKey);
              return (
                <button
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  className={`w-10 h-10 rounded-lg flex items-center justify-center mb-1 transition-colors relative group
                    ${isActive ? 'bg-outlook-blue text-white' : 'text-outlook-text-secondary hover:bg-outlook-bg-hover'}
                  `}
                  title={label}
                >
                  <Icon size={20} />
                  <span className="absolute left-12 bg-gray-800 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 transition-opacity">
                    {label}
                  </span>
                </button>
              );
            })}
          </div>
        </nav>

        <main ref={mainRef} className="flex-1 overflow-hidden bg-outlook-bg-tertiary p-0.5 relative">
          <AnimatePresence>
            {ptrState !== 'idle' && (
              <motion.div
                key="ptr"
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: Math.max(0, ptrY - 32) }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                className="absolute top-0 left-0 right-0 flex justify-center z-50 pointer-events-none"
              >
                <div className="mt-2 w-9 h-9 rounded-full bg-outlook-blue shadow-lg flex items-center justify-center">
                  <RefreshCw
                    size={18}
                    className={`text-white ${ptrState === 'refreshing' ? 'animate-spin' : ''}`}
                    style={ptrState !== 'refreshing' ? { transform: `rotate(${Math.min(ptrY * 3, 360)}deg)` } : undefined}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          {children}
        </main>
      </div>

      <nav
        className="lg:hidden flex items-stretch justify-around bg-outlook-bg-primary border-t border-outlook-border flex-shrink-0"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {primaryNavItems.map((item) => {
          const isActive = location.pathname.startsWith(item.path);
          const Icon = item.icon;
          const label = t(item.labelKey);
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] min-h-[52px] transition-colors
                ${isActive ? 'text-outlook-blue' : 'text-outlook-text-secondary hover:bg-outlook-bg-hover'}
              `}
              aria-label={label}
            >
              <Icon size={20} />
              <span className="leading-tight truncate max-w-full px-1">{label}</span>
            </button>
          );
        })}

        <button
          onClick={() => navigate('/settings')}
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] min-h-[52px] transition-colors
            ${location.pathname.startsWith('/settings') ? 'text-outlook-blue' : 'text-outlook-text-secondary hover:bg-outlook-bg-hover'}
          `}
          aria-label={t('nav.settings')}
        >
          <Settings size={20} />
          <span className="leading-tight truncate max-w-full px-1">{t('nav.settings')}</span>
        </button>

        {user?.isAdmin && (
          <button
            onClick={() => navigate('/admin')}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] min-h-[52px] transition-colors
              ${location.pathname.startsWith('/admin') ? 'text-outlook-blue' : 'text-outlook-text-secondary hover:bg-outlook-bg-hover'}
            `}
            aria-label={t('nav.admin')}
          >
            <Shield size={20} />
            <span className="leading-tight truncate max-w-full px-1">{t('nav.admin')}</span>
          </button>
        )}
      </nav>
    </div>
  );
}
