import { ReactNode, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import {
  Mail, Calendar, Users, Settings, Shield, Search,
  ChevronLeft, LogOut, Menu, X
} from 'lucide-react';

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const { user, logout } = useAuthStore();
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
        <nav className={`bg-outlook-bg-primary border-r border-outlook-border flex flex-col items-center py-2 flex-shrink-0 transition-all ${sidebarCollapsed ? 'w-0 overflow-hidden lg:w-14' : 'w-14'}`}>
          {navItems.map((item) => {
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

        {/* Main content area */}
        <main className="flex-1 overflow-hidden bg-outlook-bg-secondary">
          {children}
        </main>
      </div>
    </div>
  );
}
