import { ReactNode, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useThemeStore } from '../stores/themeStore';
import { useUIStore } from '../stores/uiStore';
import { motion } from 'motion/react';
import {
  Mail, Calendar, Users, Settings, Shield, Search, KeyRound,
  LogOut, Menu, Sun, Moon, Monitor, Check
} from 'lucide-react';
import CacheIndicator from './CacheIndicator';

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const { user, logout } = useAuthStore();
  const themeMode = useThemeStore((s) => s.mode);
  const themeResolved = useThemeStore((s) => s.resolved);
  const setThemeMode = useThemeStore((s) => s.setMode);
  const toggleMobileSidebar = useUIStore((s) => s.toggleMobileSidebar);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');

  // Close the user menu when clicking outside.
  useEffect(() => {
    if (!userMenuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (!userMenuRef.current) return;
      if (!userMenuRef.current.contains(e.target as Node)) setUserMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [userMenuOpen]);

  const navItems = [
    { path: '/mail', icon: Mail, label: 'Courrier' },
    { path: '/calendar', icon: Calendar, label: 'Calendrier' },
    { path: '/contacts', icon: Users, label: 'Contacts' },
  ];

  const bottomItems = [
    { path: '/settings', icon: Settings, label: 'Paramètres' },
    { path: '/security', icon: KeyRound, label: 'Sécurité' },
    ...(user?.isAdmin ? [{ path: '/admin', icon: Shield, label: 'Administration' }] : []),
  ];

  // Items shown in the mobile/tablet bottom navigation bar.
  const mobileNavItems = [
    ...navItems,
    { path: '/settings', icon: Settings, label: 'Paramètres' },
    ...(user?.isAdmin ? [{ path: '/admin', icon: Shield, label: 'Admin' }] : []),
  ];

  // The hamburger button only makes sense on pages that expose a contextual
  // sidebar / master list (mail folders, calendar list, settings sections,
  // admin sections). Hide it elsewhere to avoid suggesting an action that
  // does nothing.
  const hamburgerActive =
    location.pathname.startsWith('/mail')
    || location.pathname.startsWith('/calendar')
    || location.pathname.startsWith('/settings')
    || location.pathname.startsWith('/admin');

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/mail?search=${encodeURIComponent(searchQuery)}`);
    }
  };

  const initials = (user?.displayName?.[0] || user?.email?.[0] || '?').toUpperCase();

  return (
    <div className="h-full flex flex-col">
      {/* Top header bar - Outlook style */}
      <header className="h-12 bg-outlook-blue flex items-center px-3 sm:px-4 flex-shrink-0 gap-2">
        {/* Hamburger — mobile/tablet only */}
        <button
          onClick={() => hamburgerActive && toggleMobileSidebar()}
          className={`text-white p-1.5 rounded lg:hidden ${
            hamburgerActive ? 'hover:bg-white/10' : 'opacity-40 cursor-default'
          }`}
          aria-label="Afficher ou masquer le volet latéral"
          title="Afficher ou masquer le volet latéral"
        >
          <Menu size={20} />
        </button>

        {/* App name — hidden on mobile/tablet to give more room to search */}
        <span className="text-white font-semibold text-sm mr-4 hidden lg:inline">WebMail</span>

        {/* Search bar */}
        <form onSubmit={handleSearch} className="flex-1 max-w-xl">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/60" />
            <input
              type="text"
              placeholder="Rechercher…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white/10 text-white placeholder-white/60 rounded px-3 py-1.5 pl-9 text-sm border border-white/20 focus:bg-white/20 focus:outline-none focus:border-white/40 transition-colors"
            />
          </div>
        </form>

        {/* Cache status indicator + user menu */}
        <div className="ml-auto flex items-center gap-1">
          <CacheIndicator />
          <div className="relative" ref={userMenuRef}>
          <button
            onClick={() => setUserMenuOpen((v) => !v)}
            className="w-9 h-9 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-white text-sm font-semibold transition-colors"
            aria-haspopup="menu"
            aria-expanded={userMenuOpen}
            title={user?.displayName || user?.email || 'Compte'}
          >
            {initials}
          </button>

          {userMenuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full mt-2 z-50 w-64 bg-outlook-bg-secondary text-outlook-text-primary border border-outlook-border rounded-md shadow-lg py-1"
            >
              {/* Account summary */}
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

              {/* Theme switcher */}
              <div className="px-3 py-2 border-b border-outlook-border">
                <div className="text-xs uppercase tracking-wide text-outlook-text-secondary mb-1">Thème</div>
                <div className="flex flex-col">
                  {([
                    { value: 'system', label: 'Système', icon: Monitor },
                    { value: 'light', label: 'Clair', icon: Sun },
                    { value: 'dark', label: 'Sombre', icon: Moon },
                  ] as const).map(({ value, label, icon: Icon }) => (
                    <button
                      key={value}
                      onClick={() => setThemeMode(value)}
                      className={`flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-outlook-bg-hover ${
                        themeMode === value ? 'text-outlook-blue font-medium' : ''
                      }`}
                    >
                      <Icon size={14} />
                      <span>{label}</span>
                      {themeMode === value && <Check size={14} className="ml-auto" />}
                    </button>
                  ))}
                </div>
                <div className="mt-1 text-[11px] text-outlook-text-secondary">
                  Actuellement : {themeResolved === 'dark' ? 'sombre' : 'clair'}
                </div>
              </div>

              {/* Logout */}
              <button
                onClick={() => { setUserMenuOpen(false); logout(); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-outlook-bg-hover"
              >
                <LogOut size={14} />
                <span>Déconnexion</span>
              </button>
            </div>
          )}
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left navigation rail — desktop only (lg+) */}
        <nav className="hidden lg:flex bg-outlook-bg-primary border-r border-outlook-border flex-col items-center py-2 flex-shrink-0 w-14">
          {navItems.map((item) => {
            const isActive = location.pathname.startsWith(item.path);
            const Icon = item.icon;
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={`w-10 h-10 rounded-lg flex items-center justify-center mb-1 transition-colors relative group
                  ${isActive ? 'text-white' : 'text-outlook-text-secondary hover:bg-outlook-bg-hover'}`}
                title={item.label}
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
                  {item.label}
                </span>
              </button>
            );
          })}

          <div className="flex-1" />

          {bottomItems.map((item) => {
            const isActive = location.pathname.startsWith(item.path);
            const Icon = item.icon;
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={`w-10 h-10 rounded-lg flex items-center justify-center mb-1 transition-colors relative group
                  ${isActive ? 'bg-outlook-blue text-white' : 'text-outlook-text-secondary hover:bg-outlook-bg-hover'}`}
                title={item.label}
              >
                <Icon size={20} />
                <span className="absolute left-12 bg-gray-800 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 transition-opacity">
                  {item.label}
                </span>
              </button>
            );
          })}
        </nav>

        {/* Main content area — subtle background gap around children */}
        <main className="flex-1 overflow-hidden bg-outlook-bg-tertiary p-0.5">
          {children}
        </main>
      </div>

      {/* Bottom navigation bar — mobile / tablet only */}
      <nav
        className="lg:hidden flex items-stretch justify-around bg-outlook-bg-primary border-t border-outlook-border flex-shrink-0"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {mobileNavItems.map((item) => {
          const isActive = location.pathname.startsWith(item.path);
          const Icon = item.icon;
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] min-h-[52px] transition-colors
                ${isActive ? 'text-outlook-blue' : 'text-outlook-text-secondary hover:bg-outlook-bg-hover'}`}
              aria-label={item.label}
            >
              <Icon size={20} />
              <span className="leading-tight truncate max-w-full px-1">{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
