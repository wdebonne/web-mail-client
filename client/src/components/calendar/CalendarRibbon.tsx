import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CalendarPlus, Calendar as CalendarIcon, CalendarDays, CalendarRange, CalendarClock,
  Share2, Printer, ChevronDown, Filter, Columns2, Columns3, Clock,
  Settings, PanelLeftOpen, PanelLeftClose, RefreshCw,
  Save, HelpCircle, Info, Keyboard, Users, Sparkles, List,
} from 'lucide-react';

export type CalendarViewMode = 'day' | 'workweek' | 'week' | 'month' | 'agenda';
export type CalendarRibbonMode = 'classic' | 'simplified';
export type CalendarRibbonTab = 'accueil' | 'afficher' | 'aide';

export interface CalendarFilters {
  appointments: boolean;
  meetings: boolean;
  categories: boolean;
  recurring: boolean;
  inPerson: boolean;
}

interface CalendarRibbonProps {
  onNewEvent: () => void;
  onNewGroupEvent?: () => void;
  onShareCalendar: () => void;
  onPrint: () => void;
  onSync: () => void;

  view: CalendarViewMode;
  onChangeView: (v: CalendarViewMode) => void;
  dayCount: number;
  onChangeDayCount: (n: number) => void;

  splitView: boolean;
  onToggleSplitView: () => void;

  showSidebar: boolean;
  onToggleSidebar: () => void;

  timeScale: number; // minutes per slot: 60, 30, 15, 10, 5
  onChangeTimeScale: (n: number) => void;

  /** Column sizing strategy in Day/Week/WorkWeek views */
  columnSizing?: 'fixed' | 'auto';
  onChangeColumnSizing?: (m: 'fixed' | 'auto') => void;

  filters: CalendarFilters;
  onChangeFilters: (f: CalendarFilters) => void;
  onClearFilters: () => void;

  isCollapsed: boolean;
  onToggleCollapse: () => void;
  ribbonMode: CalendarRibbonMode;
  onChangeRibbonMode: (m: CalendarRibbonMode) => void;

  onOpenSettings: () => void;
  onManageCalendars?: () => void;
  onSaveView?: () => void;
}

function RibbonButton({ icon: Icon, label, onClick, disabled, active, small }: {
  icon: any; label: string; onClick: () => void;
  disabled?: boolean; active?: boolean; small?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex flex-col items-center gap-0.5 rounded transition-colors px-2 py-1 min-w-[48px]
        ${small ? 'px-1.5 py-0.5 min-w-[40px]' : ''}
        ${disabled ? 'opacity-40 cursor-default' : 'hover:bg-outlook-bg-hover cursor-pointer'}
        ${active ? 'bg-outlook-blue/10 text-outlook-blue' : ''}`}
      title={label}
    >
      <Icon size={small ? 16 : 18} />
      <span className={`${small ? 'text-[9px]' : 'text-[10px]'} leading-tight text-center whitespace-nowrap`}>{label}</span>
    </button>
  );
}

function RibbonGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center">
      <div className="flex items-end gap-0.5 px-1 flex-1">{children}</div>
      <span className="text-[9px] text-outlook-text-disabled mt-0.5 leading-none">{label}</span>
    </div>
  );
}

function RibbonSeparator() {
  return <div className="w-px h-10 bg-outlook-border mx-1 self-center" />;
}

function SimplifiedButton({ icon: Icon, label, onClick, disabled, active }: {
  icon: any; label: string; onClick: () => void; disabled?: boolean; active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1 rounded transition-colors px-2 py-1
        ${disabled ? 'opacity-40 cursor-default' : 'hover:bg-outlook-bg-hover cursor-pointer'}
        ${active ? 'bg-outlook-blue/10 text-outlook-blue' : ''}`}
      title={label}
    >
      <Icon size={14} />
      <span className="text-xs whitespace-nowrap">{label}</span>
    </button>
  );
}
function SimplifiedSep() {
  return <div className="w-px h-5 bg-outlook-border mx-0.5 self-center" />;
}

function ViewButton({ icon: Icon, label, onClick, active }: { icon: any; label: string; onClick: () => void; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-0.5 rounded px-2 py-1 min-w-[56px] transition-colors
        ${active ? 'bg-outlook-blue/10 text-outlook-blue' : 'hover:bg-outlook-bg-hover'}`}
      title={label}
    >
      <Icon size={18} />
      <span className="text-[10px] leading-tight whitespace-nowrap">{label}</span>
    </button>
  );
}

export default function CalendarRibbon({
  onNewEvent, onShareCalendar, onPrint, onSync,
  view, onChangeView, dayCount, onChangeDayCount,
  splitView, onToggleSplitView,
  showSidebar, onToggleSidebar,
  timeScale, onChangeTimeScale,
  columnSizing = 'fixed', onChangeColumnSizing,
  filters, onChangeFilters, onClearFilters,
  isCollapsed, onToggleCollapse,
  ribbonMode, onChangeRibbonMode,
  onOpenSettings, onManageCalendars, onSaveView,
}: CalendarRibbonProps) {
  const [activeTab, setActiveTab] = useState<CalendarRibbonTab>('accueil');
  const ribbonRef = useRef<HTMLDivElement>(null);

  const [dayMenuOpen, setDayMenuOpen] = useState(false);
  const [dayMenuPos, setDayMenuPos] = useState({ top: 0, left: 0 });
  const dayMenuBtnRef = useRef<HTMLButtonElement>(null);

  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [filterMenuPos, setFilterMenuPos] = useState({ top: 0, left: 0 });
  const filterMenuBtnRef = useRef<HTMLButtonElement>(null);

  const [scaleMenuOpen, setScaleMenuOpen] = useState(false);
  const [scaleMenuPos, setScaleMenuPos] = useState({ top: 0, left: 0 });
  const scaleMenuBtnRef = useRef<HTMLButtonElement>(null);

  const [colMenuOpen, setColMenuOpen] = useState(false);
  const [colMenuPos, setColMenuPos] = useState({ top: 0, left: 0 });
  const colMenuBtnRef = useRef<HTMLButtonElement>(null);

  const [savedMenuOpen, setSavedMenuOpen] = useState(false);
  const [savedMenuPos, setSavedMenuPos] = useState({ top: 0, left: 0 });
  const savedMenuBtnRef = useRef<HTMLButtonElement>(null);

  // Auto-switch to simplified when narrow
  useEffect(() => {
    const el = ribbonRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width < 700 && ribbonMode === 'classic') {
          onChangeRibbonMode('simplified');
        }
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ribbonMode, onChangeRibbonMode]);

  const tabs: CalendarRibbonTab[] = ['accueil', 'afficher', 'aide'];
  const tabLabel = (t: CalendarRibbonTab) =>
    t === 'accueil' ? 'Accueil' : t === 'afficher' ? 'Afficher' : 'Aide';

  const openMenu = (
    btnRef: React.RefObject<HTMLButtonElement>,
    setPos: (p: { top: number; left: number }) => void,
    setOpen: (v: boolean | ((p: boolean) => boolean)) => void,
    e?: React.MouseEvent,
  ) => {
    const el = (e?.currentTarget as HTMLElement) || btnRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.left });
    }
    setOpen(v => !v);
  };

  const renderTabBar = (onToggle: () => void, toggleTitle: string, toggleRotated: boolean) => (
    <div className="flex items-center gap-0 px-2 border-b border-outlook-border">
      {tabs.map(tab => (
        <button
          key={tab}
          onClick={() => setActiveTab(tab)}
          className={`px-3 py-1.5 text-xs font-medium transition-colors relative
            ${activeTab === tab
              ? 'text-outlook-blue'
              : 'text-outlook-text-secondary hover:text-outlook-text-primary hover:bg-outlook-bg-hover'
            }`}
        >
          {tabLabel(tab)}
          {activeTab === tab && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-outlook-blue rounded-t" />
          )}
        </button>
      ))}
      <div className="flex-1" />
      <button
        onClick={onToggle}
        className="text-outlook-text-disabled hover:text-outlook-text-secondary p-1 rounded hover:bg-outlook-bg-hover"
        title={toggleTitle}
      >
        <ChevronDown size={12} className={toggleRotated ? 'transition-transform rotate-180' : 'transition-transform'} />
      </button>
    </div>
  );

  const collapsedBar = (
    <div className="flex items-center gap-0 px-2 border-b border-outlook-border bg-white">
      {tabs.map(tab => (
        <button
          key={tab}
          onClick={() => { setActiveTab(tab); onToggleCollapse(); }}
          className="px-3 py-1.5 text-xs font-medium text-outlook-text-secondary hover:text-outlook-text-primary hover:bg-outlook-bg-hover"
        >
          {tabLabel(tab)}
        </button>
      ))}
      <div className="flex-1" />
      <button
        onClick={onToggleCollapse}
        className="text-outlook-text-disabled hover:text-outlook-text-secondary p-1 rounded hover:bg-outlook-bg-hover"
        title="Développer le ruban"
      >
        <ChevronDown size={12} />
      </button>
    </div>
  );

  if (isCollapsed) {
    return <div ref={ribbonRef} className="hidden md:flex flex-col flex-shrink-0 bg-white select-none">{collapsedBar}</div>;
  }

  const popups = (
    <>
      {dayMenuOpen && createPortal(
        <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setDayMenuOpen(false)} />
          <div className="fixed z-[9999] bg-white border border-outlook-border rounded-md shadow-lg py-1 w-36" style={{ top: dayMenuPos.top, left: dayMenuPos.left }}>
            {[1, 2, 3, 4, 5, 6, 7].map(n => (
              <button
                key={n}
                onClick={() => { onChangeDayCount(n); onChangeView('day'); setDayMenuOpen(false); }}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-outlook-bg-hover ${view === 'day' && dayCount === n ? 'text-outlook-blue' : ''}`}
              >
                {n} jour{n > 1 ? 's' : ''}
              </button>
            ))}
          </div>
        </>,
        document.body,
      )}

      {filterMenuOpen && createPortal(
        <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setFilterMenuOpen(false)} />
          <div className="fixed z-[9999] bg-white border border-outlook-border rounded-md shadow-lg py-1 w-56" style={{ top: filterMenuPos.top, left: filterMenuPos.left }}>
            <button onClick={() => { onClearFilters(); setFilterMenuOpen(false); }} className="w-full text-left px-3 py-1.5 text-xs hover:bg-outlook-bg-hover text-outlook-danger">
              Effacer les filtres
            </button>
            <div className="h-px bg-outlook-border my-1" />
            {[
              { key: 'appointments', label: 'Rendez-vous' },
              { key: 'meetings', label: 'Réunions' },
              { key: 'categories', label: 'Catégories' },
              { key: 'recurring', label: 'Périodicité' },
              { key: 'inPerson', label: 'En personne' },
            ].map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-outlook-bg-hover cursor-pointer">
                <input
                  type="checkbox"
                  checked={(filters as any)[key]}
                  onChange={(e) => onChangeFilters({ ...filters, [key]: e.target.checked })}
                />
                {label}
              </label>
            ))}
          </div>
        </>,
        document.body,
      )}

      {scaleMenuOpen && createPortal(
        <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setScaleMenuOpen(false)} />
          <div className="fixed z-[9999] bg-white border border-outlook-border rounded-md shadow-lg py-1 w-40" style={{ top: scaleMenuPos.top, left: scaleMenuPos.left }}>
            {[60, 30, 15, 10, 5].map(n => (
              <button
                key={n}
                onClick={() => { onChangeTimeScale(n); setScaleMenuOpen(false); }}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-outlook-bg-hover ${timeScale === n ? 'text-outlook-blue' : ''}`}
              >
                {n} minutes
              </button>
            ))}
          </div>
        </>,
        document.body,
      )}

      {colMenuOpen && createPortal(
        <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setColMenuOpen(false)} />
          <div className="fixed z-[9999] bg-white border border-outlook-border rounded-md shadow-lg py-1 w-56" style={{ top: colMenuPos.top, left: colMenuPos.left }}>
            <div className="px-3 py-1 text-[10px] uppercase text-outlook-text-disabled">Largeur des colonnes</div>
            {([
              { v: 'fixed', label: 'Fixe', desc: 'Toutes les colonnes ont la même largeur' },
              { v: 'auto', label: 'Automatique', desc: 'Les jours chargés s\'élargissent, les jours vides se réduisent' },
            ] as const).map(opt => (
              <button
                key={opt.v}
                onClick={() => { onChangeColumnSizing?.(opt.v); setColMenuOpen(false); }}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-outlook-bg-hover ${columnSizing === opt.v ? 'text-outlook-blue' : ''}`}
              >
                <div className="font-medium">{opt.label}</div>
                <div className="text-[10px] text-outlook-text-secondary">{opt.desc}</div>
              </button>
            ))}
          </div>
        </>,
        document.body,
      )}

      {savedMenuOpen && createPortal(
        <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setSavedMenuOpen(false)} />
          <div className="fixed z-[9999] bg-white border border-outlook-border rounded-md shadow-lg py-1 w-56" style={{ top: savedMenuPos.top, left: savedMenuPos.left }}>
            <div className="px-3 py-1 text-[10px] uppercase text-outlook-text-disabled">Vues enregistrées</div>
            {(['day', 'workweek', 'week', 'month', 'agenda'] as const).map(v => (
              <button
                key={v}
                onClick={() => { onChangeView(v); setSavedMenuOpen(false); }}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-outlook-bg-hover ${view === v ? 'text-outlook-blue' : ''}`}
              >
                {v === 'day' ? 'Jour' : v === 'workweek' ? 'Semaine de travail' : v === 'week' ? 'Semaine' : v === 'month' ? 'Mois' : 'Agenda'}
              </button>
            ))}
            <div className="h-px bg-outlook-border my-1" />
            <button
              onClick={() => { onSaveView?.(); setSavedMenuOpen(false); }}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-outlook-bg-hover flex items-center gap-2"
            >
              <Save size={12} /> Enregistrer la vue actuelle
            </button>
          </div>
        </>,
        document.body,
      )}
    </>
  );

  // ── Simplified ribbon ────────────────────────────────────────
  if (ribbonMode === 'simplified') {
    return (
      <div ref={ribbonRef} className="hidden md:flex flex-col flex-shrink-0 bg-white select-none">
        {renderTabBar(() => onChangeRibbonMode('classic'), 'Développer le ruban', false)}
        <div className="flex items-center px-2 py-0.5 gap-0.5 overflow-x-auto h-9">
          {activeTab === 'accueil' && (
            <>
              <SimplifiedButton icon={CalendarPlus} label="Nouvel événement" onClick={onNewEvent} />
              <SimplifiedSep />
              <SimplifiedButton icon={CalendarIcon} label="Jour" onClick={() => onChangeView('day')} active={view === 'day'} />
              <SimplifiedButton icon={CalendarDays} label="Semaine travail" onClick={() => onChangeView('workweek')} active={view === 'workweek'} />
              <SimplifiedButton icon={CalendarRange} label="Semaine" onClick={() => onChangeView('week')} active={view === 'week'} />
              <SimplifiedButton icon={CalendarClock} label="Mois" onClick={() => onChangeView('month')} active={view === 'month'} />
              <SimplifiedButton icon={List} label="Agenda" onClick={() => onChangeView('agenda')} active={view === 'agenda'} />
              <SimplifiedSep />
              <SimplifiedButton icon={Columns2} label="Fractionné" onClick={onToggleSplitView} active={splitView} />
              <button
                ref={filterMenuBtnRef}
                onClick={(e) => openMenu(filterMenuBtnRef, setFilterMenuPos, setFilterMenuOpen, e)}
                className={`flex items-center gap-1 rounded px-2 py-1 hover:bg-outlook-bg-hover ${filterMenuOpen ? 'bg-outlook-blue/10 text-outlook-blue' : ''}`}
                title="Filtre"
              >
                <Filter size={14} />
                <span className="text-xs">Filtre</span>
                <ChevronDown size={10} />
              </button>
              <SimplifiedSep />
              <SimplifiedButton icon={Share2} label="Partager" onClick={onShareCalendar} />
              <SimplifiedButton icon={Printer} label="Imprimer" onClick={onPrint} />
              <SimplifiedButton icon={RefreshCw} label="Synchroniser" onClick={onSync} />
            </>
          )}
          {activeTab === 'afficher' && (
            <>
              <SimplifiedButton
                icon={showSidebar ? PanelLeftClose : PanelLeftOpen}
                label="Volet calendriers"
                onClick={onToggleSidebar}
                active={showSidebar}
              />
              <SimplifiedSep />
              <SimplifiedButton icon={CalendarIcon} label="Jour" onClick={() => onChangeView('day')} active={view === 'day'} />
              <SimplifiedButton icon={CalendarDays} label="Semaine travail" onClick={() => onChangeView('workweek')} active={view === 'workweek'} />
              <SimplifiedButton icon={CalendarRange} label="Semaine" onClick={() => onChangeView('week')} active={view === 'week'} />
              <SimplifiedButton icon={CalendarClock} label="Mois" onClick={() => onChangeView('month')} active={view === 'month'} />
              <SimplifiedButton icon={List} label="Agenda" onClick={() => onChangeView('agenda')} active={view === 'agenda'} />
              <button
                ref={savedMenuBtnRef}
                onClick={(e) => openMenu(savedMenuBtnRef, setSavedMenuPos, setSavedMenuOpen, e)}
                className="flex items-center gap-1 rounded px-2 py-1 hover:bg-outlook-bg-hover"
                title="Vues enregistrées"
              >
                <Save size={14} />
                <span className="text-xs">Vues</span>
                <ChevronDown size={10} />
              </button>
              <SimplifiedSep />
              <SimplifiedButton icon={Columns2} label="Fractionné" onClick={onToggleSplitView} active={splitView} />
              <button
                ref={scaleMenuBtnRef}
                onClick={(e) => openMenu(scaleMenuBtnRef, setScaleMenuPos, setScaleMenuOpen, e)}
                className="flex items-center gap-1 rounded px-2 py-1 hover:bg-outlook-bg-hover"
                title="Échelle de temps"
              >
                <Clock size={14} />
                <span className="text-xs">{timeScale}min</span>
                <ChevronDown size={10} />
              </button>
              <button
                ref={colMenuBtnRef}
                onClick={(e) => openMenu(colMenuBtnRef, setColMenuPos, setColMenuOpen, e)}
                className="flex items-center gap-1 rounded px-2 py-1 hover:bg-outlook-bg-hover"
                title="Largeur des colonnes"
              >
                <Columns3 size={14} />
                <span className="text-xs">Colonnes : {columnSizing === 'auto' ? 'Auto' : 'Fixe'}</span>
                <ChevronDown size={10} />
              </button>
              <button
                ref={filterMenuBtnRef}
                onClick={(e) => openMenu(filterMenuBtnRef, setFilterMenuPos, setFilterMenuOpen, e)}
                className="flex items-center gap-1 rounded px-2 py-1 hover:bg-outlook-bg-hover"
                title="Filtre"
              >
                <Filter size={14} />
                <span className="text-xs">Filtre</span>
                <ChevronDown size={10} />
              </button>
              <SimplifiedSep />
              <SimplifiedButton icon={Settings} label="Paramètres" onClick={onOpenSettings} />
            </>
          )}
          {activeTab === 'aide' && (
            <>
              <SimplifiedButton icon={HelpCircle} label="Aide" onClick={() => window.open('/', '_blank')} />
              <SimplifiedButton icon={Keyboard} label="Raccourcis" onClick={onOpenSettings} />
              <SimplifiedButton icon={Info} label="À propos" onClick={onOpenSettings} />
            </>
          )}
        </div>
        {popups}
      </div>
    );
  }

  // ── Classic ribbon ──────────────────────────────────────────
  return (
    <div ref={ribbonRef} className="hidden md:flex flex-col flex-shrink-0 bg-white select-none">
      {renderTabBar(() => onChangeRibbonMode('simplified'), 'Réduire le ruban', true)}
      <div className="flex items-center px-2 py-1 gap-1 overflow-x-auto overflow-y-hidden h-[80px]">
        {activeTab === 'accueil' && (
          <>
            <RibbonGroup label="Nouveau">
              <RibbonButton icon={CalendarPlus} label="Nouvel événement" onClick={onNewEvent} />
            </RibbonGroup>
            <RibbonSeparator />
            <RibbonGroup label="Réorganiser">
              <button
                ref={dayMenuBtnRef}
                onClick={(e) => openMenu(dayMenuBtnRef, setDayMenuPos, setDayMenuOpen, e)}
                className={`flex flex-col items-center gap-0.5 rounded px-2 py-1 min-w-[56px] hover:bg-outlook-bg-hover ${view === 'day' ? 'bg-outlook-blue/10 text-outlook-blue' : ''}`}
                title="Jour"
              >
                <CalendarIcon size={18} />
                <span className="text-[10px] flex items-center gap-0.5">Jour <ChevronDown size={8} /></span>
              </button>
              <ViewButton icon={CalendarDays} label="Semaine de travail" onClick={() => onChangeView('workweek')} active={view === 'workweek'} />
              <ViewButton icon={CalendarRange} label="Semaine" onClick={() => onChangeView('week')} active={view === 'week'} />
              <ViewButton icon={CalendarClock} label="Mois" onClick={() => onChangeView('month')} active={view === 'month'} />
              <ViewButton icon={List} label="Agenda" onClick={() => onChangeView('agenda')} active={view === 'agenda'} />
              <ViewButton icon={Columns2} label="Mode Fractionné" onClick={onToggleSplitView} active={splitView} />
            </RibbonGroup>
            <RibbonSeparator />
            <RibbonGroup label="Filtrer">
              <button
                ref={filterMenuBtnRef}
                onClick={(e) => openMenu(filterMenuBtnRef, setFilterMenuPos, setFilterMenuOpen, e)}
                className={`flex flex-col items-center gap-0.5 rounded px-2 py-1 min-w-[48px] hover:bg-outlook-bg-hover ${filterMenuOpen ? 'bg-outlook-blue/10 text-outlook-blue' : ''}`}
                title="Filtre appliqué"
              >
                <Filter size={18} />
                <span className="text-[10px] flex items-center gap-0.5">Filtre <ChevronDown size={8} /></span>
              </button>
            </RibbonGroup>
            <RibbonSeparator />
            <RibbonGroup label="Partager">
              <RibbonButton icon={Share2} label="Partager le calendrier" onClick={onShareCalendar} />
            </RibbonGroup>
            <RibbonSeparator />
            <RibbonGroup label="Partager">
              <RibbonButton icon={Printer} label="Imprimer" onClick={onPrint} />
            </RibbonGroup>
            <RibbonSeparator />
            <RibbonGroup label="Actions">
              <RibbonButton icon={RefreshCw} label="Synchroniser" onClick={onSync} />
              {onManageCalendars && (
                <RibbonButton icon={Users} label="Calendriers" onClick={onManageCalendars} />
              )}
            </RibbonGroup>
          </>
        )}

        {activeTab === 'afficher' && (
          <>
            <RibbonGroup label="Volets">
              <RibbonButton
                icon={showSidebar ? PanelLeftClose : PanelLeftOpen}
                label="Volet calendriers"
                onClick={onToggleSidebar}
                active={showSidebar}
              />
            </RibbonGroup>
            <RibbonSeparator />
            <RibbonGroup label="Réorganiser">
              <button
                ref={dayMenuBtnRef}
                onClick={(e) => openMenu(dayMenuBtnRef, setDayMenuPos, setDayMenuOpen, e)}
                className={`flex flex-col items-center gap-0.5 rounded px-2 py-1 min-w-[56px] hover:bg-outlook-bg-hover ${view === 'day' ? 'bg-outlook-blue/10 text-outlook-blue' : ''}`}
                title="Jour"
              >
                <CalendarIcon size={18} />
                <span className="text-[10px] flex items-center gap-0.5">Jour <ChevronDown size={8} /></span>
              </button>
              <ViewButton icon={CalendarDays} label="Semaine de travail" onClick={() => onChangeView('workweek')} active={view === 'workweek'} />
              <ViewButton icon={CalendarRange} label="Semaine" onClick={() => onChangeView('week')} active={view === 'week'} />
              <ViewButton icon={CalendarClock} label="Mois" onClick={() => onChangeView('month')} active={view === 'month'} />
              <ViewButton icon={List} label="Agenda" onClick={() => onChangeView('agenda')} active={view === 'agenda'} />
              <button
                ref={savedMenuBtnRef}
                onClick={(e) => openMenu(savedMenuBtnRef, setSavedMenuPos, setSavedMenuOpen, e)}
                className="flex flex-col items-center gap-0.5 rounded px-2 py-1 min-w-[56px] hover:bg-outlook-bg-hover"
                title="Vues enregistrées"
              >
                <Save size={18} />
                <span className="text-[10px] flex items-center gap-0.5">Vues <ChevronDown size={8} /></span>
              </button>
              <ViewButton icon={Columns2} label="Mode Fractionné" onClick={onToggleSplitView} active={splitView} />
              <button
                ref={scaleMenuBtnRef}
                onClick={(e) => openMenu(scaleMenuBtnRef, setScaleMenuPos, setScaleMenuOpen, e)}
                className="flex flex-col items-center gap-0.5 rounded px-2 py-1 min-w-[56px] hover:bg-outlook-bg-hover"
                title="Échelle de temps"
              >
                <Clock size={18} />
                <span className="text-[10px] flex items-center gap-0.5">Échelle <ChevronDown size={8} /></span>
              </button>
            </RibbonGroup>
            <RibbonSeparator />
            <RibbonGroup label="Colonnes">
              <button
                ref={colMenuBtnRef}
                onClick={(e) => openMenu(colMenuBtnRef, setColMenuPos, setColMenuOpen, e)}
                className={`flex flex-col items-center gap-0.5 rounded px-2 py-1 min-w-[64px] hover:bg-outlook-bg-hover ${colMenuOpen ? 'bg-outlook-blue/10 text-outlook-blue' : ''}`}
                title="Largeur des colonnes (jours)"
              >
                <Columns3 size={18} />
                <span className="text-[10px] flex items-center gap-0.5">
                  {columnSizing === 'auto' ? 'Auto' : 'Fixe'} <ChevronDown size={8} />
                </span>
              </button>
            </RibbonGroup>
            <RibbonSeparator />
            <RibbonGroup label="Filtrer">
              <button
                ref={filterMenuBtnRef}
                onClick={(e) => openMenu(filterMenuBtnRef, setFilterMenuPos, setFilterMenuOpen, e)}
                className={`flex flex-col items-center gap-0.5 rounded px-2 py-1 min-w-[48px] hover:bg-outlook-bg-hover ${filterMenuOpen ? 'bg-outlook-blue/10 text-outlook-blue' : ''}`}
                title="Filtre appliqué"
              >
                <Filter size={18} />
                <span className="text-[10px] flex items-center gap-0.5">Filtre <ChevronDown size={8} /></span>
              </button>
            </RibbonGroup>
            <RibbonSeparator />
            <RibbonGroup label="Paramètres">
              <RibbonButton icon={Settings} label="Paramètres du calendrier" onClick={onOpenSettings} />
            </RibbonGroup>
          </>
        )}

        {activeTab === 'aide' && (
          <>
            <RibbonGroup label="Aide">
              <RibbonButton icon={HelpCircle} label="Aide" onClick={() => window.open('/', '_blank')} />
              <RibbonButton icon={Keyboard} label="Raccourcis" onClick={onOpenSettings} />
              <RibbonButton icon={Sparkles} label="Nouveautés" onClick={onOpenSettings} />
              <RibbonButton icon={Info} label="À propos" onClick={onOpenSettings} />
            </RibbonGroup>
          </>
        )}
      </div>
      {popups}
    </div>
  );
}
