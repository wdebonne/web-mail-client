import { ReactNode, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useThemeStore } from '../stores/themeStore';
import { motion } from 'motion/react';
import {
  Mail, Calendar, Users, Settings, Shield, Search, KeyRound,
  ChevronLeft, LogOut, Menu, X, Sun, Moon, Monitor
} from 'lucide-react';

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const { user, logout } = useAuthStore();
  const themeMode = useThemeStore((s) => s.mode);
  const themeResolved = useThemeStore((s) => s.resolved);
  const setThemeMode = useThemeStore((s) => s.setMode);
  const toggleTheme = useThemeStore((s) => s.toggle);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);

  const navItems = [
    { path: '/mail', icon: Mail, label: 'Courrier', color: 'text-outlook-blue' },
    { path: '/calendar', icon: Calendar, label: 'Calendrier', color: 'text-outlook-blue' },
    { path: '/contacts', icon: Users, label: 'Contacts', color: 'text-outlook-blue' },
  ];

  const bottomItems = [
    { path: '/settings', icon: Settings, label: 'Paramètres' },
    { path: '/security', icon: KeyRound, label: 'Sécurité' },
    ...(user?.isAdmin ? [{ path: '/admin', icon: Shield, label: 'Administration' }] : []),
  ];

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/mail?search=${encodeURIComponent(searchQuery)}`);
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Top header bar - Outlook style */}
      <header className="h-12 bg-outlook-blue flex items-center px-4 flex-shrink-0">
        <button
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          className="text-white hover:bg-white/10 p-1.5 rounded mr-2 lg:hidden"
        >
          <Menu size={18} />
        </button>
        
        <span className="text-white font-semibold text-sm mr-6">WebMail</span>
        
        {/* Search bar */}
        <form onSubmit={handleSearch} className="flex-1 max-w-xl">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/60" />
            <input
              type="text"
              placeholder="Rechercher dans le courrier, les contacts, le calendrier..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white/10 text-white placeholder-white/60 rounded px-3 py-1.5 pl-9 text-sm border border-white/20 focus:bg-white/20 focus:outline-none focus:border-white/40 transition-colors"
            />
          </div>
        </form>

        {/* User menu */}
        <div className="ml-auto flex items-center gap-2">
          {/* Theme toggle — click to swap light/dark, long-press (or right-click) opens mode menu */}
          <div className="relative">
            <button
              onClick={toggleTheme}
              onContextMenu={(e) => { e.preventDefault(); setThemeMenuOpen(v => !v); }}
              className="text-white/80 hover:text-white hover:bg-white/10 p-1.5 rounded"
              title={`Thème : ${themeMode === 'system' ? 'Système' : themeMode === 'dark' ? 'Sombre' : 'Clair'} (clic pour basculer, clic droit pour choisir)`}
              aria-label="Basculer le thème"
            >
              {themeResolved === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <button
              onClick={() => setThemeMenuOpen(v => !v)}
              className="text-white/60 hover:text-white hover:bg-white/10 px-0.5 py-1.5 rounded"
              title="Choisir le thème"
              aria-label="Choisir le mode de thème"
            >
              <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor"><path d="M0 2l4 4 4-4z"/></svg>
            </button>
            {themeMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setThemeMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 w-40 bg-outlook-bg-secondary text-outlook-text-primary border border-outlook-border rounded shadow-lg py-1">
                  {([
                    { value: 'system', label: 'Système', icon: Monitor },
                    { value: 'light', label: 'Clair', icon: Sun },
                    { value: 'dark', label: 'Sombre', icon: Moon },
                  ] as const).map(({ value, label, icon: Icon }) => (
                    <button
                      key={value}
                      onClick={() => { setThemeMode(value); setThemeMenuOpen(false); }}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-outlook-bg-hover ${themeMode === value ? 'text-outlook-blue font-medium' : ''}`}
                    >
                      <Icon size={14} />
                      <span>{label}</span>
                      {themeMode === value && <span className="ml-auto text-xs">✓</span>}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <div className="text-white text-sm hidden md:block">
            {user?.displayName || user?.email}
          </div>
          <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-white text-sm font-semibold">
            {user?.displayName?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || '?'}
          </div>
          <button
            onClick={() => logout()}
            className="text-white/80 hover:text-white hover:bg-white/10 p-1.5 rounded"
            title="Déconnexion"
          >
            <LogOut size={16} />
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left navigation rail - Outlook style */}
        <nav className={`bg-outlook-bg-primary border-r border-outlook-border flex flex-col items-center py-2 flex-shrink-0 transition-all
          ${sidebarCollapsed ? 'w-0 overflow-hidden' : 'w-14'} md:w-14 md:overflow-visible`}>
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
                {/* Tooltip */}
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
    </div>
  );
}
