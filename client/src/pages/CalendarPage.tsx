import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { CalendarEvent, Calendar } from '../types';
import {
  ChevronLeft, ChevronRight, Plus, X, Clock, MapPin, Users,
  Briefcase, Pencil, Trash2, Repeat, Copy, FolderOpen, FolderInput,
} from 'lucide-react';
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, isSameMonth, isSameDay, isToday, addMonths,
  subMonths, parseISO, addDays, subDays, differenceInMinutes,
  getWeek, setHours, setMinutes, startOfDay,
} from 'date-fns';
import { formatInTimeZone, toZonedTime, fromZonedTime } from 'date-fns-tz';
import { fr } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { useAuthStore } from '../stores/authStore';
import { useUIStore } from '../stores/uiStore';
import CalendarRibbon, { CalendarViewMode, CalendarFilters } from '../components/calendar/CalendarRibbon';
import CalendarSidebar from '../components/calendar/CalendarSidebar';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { SyncCalendarsDialog } from '../components/calendar/SyncCalendarsDialog';
import { AddCalendarUrlDialog } from '../components/calendar/AddCalendarUrlDialog';
import MigrateCalendarDialog from '../components/calendar/MigrateCalendarDialog';
import EventModal from '../components/calendar/EventModal';
import ShareCalendarDialog from '../components/calendar/ShareCalendarDialog';
import ContextMenu, { ContextMenuItem } from '../components/ui/ContextMenu';
import FloatingActionButton from '../components/ui/FloatingActionButton';
import {
  getCalendarView, setCalendarView,
  getRibbonMode, setRibbonMode,
  getRibbonCollapsed, setRibbonCollapsed,
  getShowSidebar, setShowSidebar,
  getColorOverrides,
  getHiddenLocally,
  getColumnSizing, setColumnSizing,
} from '../utils/calendarPreferences';

const DEFAULT_FILTERS: CalendarFilters = {
  appointments: true, meetings: true, categories: true, recurring: true, inPerson: true,
};

export default function CalendarPage() {
  const queryClient = useQueryClient();
  const userTz = useAuthStore((s) => s.user?.timezone) || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris';
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<CalendarViewMode>(() => getCalendarView());
  const [dayCount, setDayCount] = useState(1);
  const [splitView, setSplitView] = useState(false);
  const [timeScale, setTimeScale] = useState(30);
  const [columnSizing, setColumnSizingState] = useState<'fixed' | 'auto'>(() => getColumnSizing());
  const [filters, setFiltersState] = useState<CalendarFilters>(DEFAULT_FILTERS);

  const [showEventForm, setShowEventForm] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [editInitialTab, setEditInitialTab] = useState<'summary' | 'recurrence' | 'attendees' | 'attachments'>('summary');
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [selectedRange, setSelectedRange] = useState<{ start: Date; end: Date } | null>(null);
  const [eventContextMenu, setEventContextMenu] = useState<{ event: CalendarEvent; x: number; y: number } | null>(null);

  const [ribbonCollapsed, setRibbonCollapsedState] = useState(() => getRibbonCollapsed());
  const [ribbonMode, setRibbonModeState] = useState<'classic' | 'simplified'>(() => getRibbonMode());
  const [showSidebar, setShowSidebarState] = useState(() => getShowSidebar());
  const [prefsVersion, setPrefsVersion] = useState(0);
  const bumpPrefs = useCallback(() => setPrefsVersion(n => n + 1), []);

  const [confirmDelete, setConfirmDelete] = useState<Calendar | null>(null);
  const [shareCalendarTarget, setShareCalendarTarget] = useState<Calendar | null>(null);
  const [newCalendarOpen, setNewCalendarOpen] = useState(false);
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [addCalendarUrlOpen, setAddCalendarUrlOpen] = useState(false);
  const [migrateTarget, setMigrateTarget] = useState<{ cal: Calendar; target: 'nextcloud' | 'local' } | null>(null);

  const { data: ncStatusPage } = useQuery({
    queryKey: ['user-nextcloud-status'],
    queryFn: () => api.getUserNextcloudStatus(),
  });
  const nextcloudLinked = !!(ncStatusPage?.enabled && ncStatusPage?.linked);

  const migrateMutation = useMutation({
    mutationFn: async ({ id, target, deleteRemote }: { id: string; target: 'nextcloud' | 'local'; deleteRemote: boolean }) =>
      api.migrateCalendar(id, target, deleteRemote),
    onSuccess: (data: any) => {
      if (data?.target === 'nextcloud') {
        toast.success(`Calendrier migré vers NextCloud (${data.pushed ?? 0}/${data.total ?? 0} événements)`);
      } else {
        toast.success('Calendrier migré en local');
      }
      queryClient.invalidateQueries({ queryKey: ['calendars'] });
      queryClient.invalidateQueries({ queryKey: ['events'] });
      setMigrateTarget(null);
    },
    onError: (err: any) => toast.error(err.message || 'Échec de la migration'),
  });

  const syncAllMutation = useMutation({
    mutationFn: () => api.syncAllCalendars(),
    onSuccess: (data: any) => {
      toast.success(`Synchronisation terminée (${data?.synced ?? 0} compte(s))`);
      queryClient.invalidateQueries({ queryKey: ['calendar-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['calendars'] });
      queryClient.invalidateQueries({ queryKey: ['events'] });
    },
    onError: (err: any) => toast.error(err.message || 'Échec de la synchronisation'),
  });

  useEffect(() => setCalendarView(view), [view]);
  useEffect(() => setRibbonMode(ribbonMode), [ribbonMode]);
  useEffect(() => setRibbonCollapsed(ribbonCollapsed), [ribbonCollapsed]);
  useEffect(() => setShowSidebar(showSidebar), [showSidebar]);

  // Mobile/tablet hamburger: toggle the calendar sidebar visibility.
  const mobileSidebarSignal = useUIStore((s) => s.mobileSidebarSignal);
  const lastSidebarSignalRef = useRef(mobileSidebarSignal);
  useEffect(() => {
    if (lastSidebarSignalRef.current === mobileSidebarSignal) return;
    lastSidebarSignalRef.current = mobileSidebarSignal;
    setShowSidebarState((v) => !v);
  }, [mobileSidebarSignal]);

  // On mobile / tablet (< lg = 1024px), the week / month grids are unreadable,
  // so we force the day view with a single column regardless of the stored
  // user preference (which is preserved for desktop).
  const [isCompact, setIsCompact] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 1023px)').matches : false
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 1023px)');
    const onChange = (e: MediaQueryListEvent) => setIsCompact(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  const effView: CalendarViewMode = isCompact && view !== 'agenda' ? 'day' : view;
  const effDayCount = isCompact ? 1 : dayCount;

  const { rangeStart, rangeEnd } = useMemo(() => {
    let s: Date; let e: Date;
    if (effView === 'month') {
      s = startOfWeek(startOfMonth(currentDate), { weekStartsOn: 1 });
      e = endOfWeek(endOfMonth(currentDate), { weekStartsOn: 1 });
    } else if (effView === 'agenda') {
      // Agenda view: load a wide window centred on currentDate so the user
      // can scroll through both upcoming and recently past events.
      s = subMonths(startOfMonth(currentDate), 1);
      e = endOfMonth(addMonths(currentDate, 2));
    } else if (effView === 'week') {
      s = startOfWeek(currentDate, { weekStartsOn: 1 });
      e = endOfWeek(currentDate, { weekStartsOn: 1 });
    } else if (effView === 'workweek') {
      s = startOfWeek(currentDate, { weekStartsOn: 1 });
      e = addDays(s, 4);
    } else {
      s = startOfDay(currentDate);
      e = addDays(s, Math.max(1, effDayCount) - 1);
    }
    return { rangeStart: s, rangeEnd: e };
  }, [effView, currentDate, effDayCount]);

  const apiStart = format(rangeStart, 'yyyy-MM-dd');
  const apiEnd = format(rangeEnd, 'yyyy-MM-dd');

  const { data: calendars = [] } = useQuery<Calendar[]>({
    queryKey: ['calendars'],
    queryFn: api.getCalendars,
  });

  const { data: events = [] } = useQuery<CalendarEvent[]>({
    queryKey: ['events', apiStart, apiEnd],
    queryFn: () => api.getEvents(apiStart, apiEnd),
  });

  const createEventMutation = useMutation({
    mutationFn: api.createEvent,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events'] });
      setShowEventForm(false);
      setEditingEvent(null);
      toast.success('Événement créé');
    },
  });
  const updateEventMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => api.updateEvent(id, data),
    onMutate: async ({ id, data }) => {
      // Optimistic update for drag-and-drop and in-form edits
      await queryClient.cancelQueries({ queryKey: ['events'] });
      const previous = queryClient.getQueriesData<CalendarEvent[]>({ queryKey: ['events'] });
      queryClient.setQueriesData<CalendarEvent[]>({ queryKey: ['events'] }, (old) => {
        if (!old) return old;
        return old.map((ev) => {
          if (ev.id !== id) return ev;
          const next: any = { ...ev };
          if (data.startDate) next.start_date = data.startDate;
          if (data.endDate) next.end_date = data.endDate;
          if (data.title !== undefined) next.title = data.title;
          if (data.location !== undefined) next.location = data.location;
          if (data.allDay !== undefined) next.all_day = data.allDay;
          return next;
        });
      });
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) {
        for (const [key, data] of ctx.previous) {
          queryClient.setQueryData(key, data);
        }
      }
      toast.error('Échec de la mise à jour');
    },
    onSuccess: (updated: any) => {
      // Patch the cache with the server response. Dates round-trip correctly
      // now that DB columns are TIMESTAMPTZ and both Node process and PG
      // session are forced to UTC (see server/src/database/connection.ts).
      if (updated && updated.id) {
        queryClient.setQueriesData<CalendarEvent[]>({ queryKey: ['events'] }, (old) => {
          if (!old) return old;
          return old.map((ev) => (ev.id === updated.id ? { ...ev, ...updated } : ev));
        });
      }
      setShowEventForm(false);
      setEditingEvent(null);
      toast.success('Événement mis à jour');
    },
  });
  const deleteEventMutation = useMutation({
    mutationFn: (id: string) => api.deleteEvent(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events'] });
      setSelectedEvent(null);
      toast.success('Événement supprimé');
    },
  });
  const updateCalendarMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => api.updateCalendar(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['calendars'] }),
  });
  const createCalendarMutation = useMutation({
    mutationFn: (data: any) => api.createCalendar(data),
    onSuccess: (_r: any, vars: any) => {
      queryClient.invalidateQueries({ queryKey: ['calendars'] });
      if (vars?.mailAccountId) {
        queryClient.invalidateQueries({ queryKey: ['calendar-accounts'] });
        queryClient.invalidateQueries({ queryKey: ['events'] });
      }
      toast.success(vars?.createOnCaldav ? 'Calendrier créé sur le serveur CalDAV' : 'Calendrier créé');
    },
    onError: (e: any) => toast.error(e?.message || 'Création impossible'),
  });
  const deleteCalendarMutation = useMutation({
    mutationFn: (id: string) => api.deleteCalendar(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendars'] });
      setConfirmDelete(null);
      toast.success('Calendrier supprimé');
    },
    onError: (err: any) => toast.error(err.message || 'Suppression impossible'),
  });

  const colorOverrides = getColorOverrides();
  const hiddenLocally = getHiddenLocally();

  const visibleCalendarIds = useMemo(() => new Set(
    calendars.filter((c: Calendar) => c.is_visible && !hiddenLocally[c.id]).map((c: Calendar) => c.id)
  ), [calendars, hiddenLocally, prefsVersion]);

  const filteredEvents = useMemo(() => {
    return (events || []).filter((ev: CalendarEvent) => {
      if (!visibleCalendarIds.has(ev.calendar_id)) return false;
      if (!filters.appointments && (!ev.attendees || ev.attendees.length === 0)) return false;
      if (!filters.meetings && ev.attendees && ev.attendees.length > 0) return false;
      if (!filters.recurring && ev.recurrence_rule) return false;
      return true;
    });
  }, [events, visibleCalendarIds, filters]);

  const eventColor = (ev: CalendarEvent) =>
    colorOverrides[ev.calendar_id] || ev.calendar_color || '#0078D4';

  const goPrev = () => {
    if (effView === 'month' || effView === 'agenda') setCurrentDate(subMonths(currentDate, 1));
    else if (effView === 'day') setCurrentDate(subDays(currentDate, Math.max(1, effDayCount)));
    else setCurrentDate(subDays(currentDate, 7));
  };
  const goNext = () => {
    if (effView === 'month' || effView === 'agenda') setCurrentDate(addMonths(currentDate, 1));
    else if (effView === 'day') setCurrentDate(addDays(currentDate, Math.max(1, effDayCount)));
    else setCurrentDate(addDays(currentDate, 7));
  };
  const goToday = () => setCurrentDate(new Date());

  const periodLabel = useMemo(() => {
    if (effView === 'month') return format(currentDate, 'MMMM yyyy', { locale: fr });
    if (effView === 'agenda') return format(currentDate, 'MMMM yyyy', { locale: fr });
    if (effView === 'week' || effView === 'workweek') {
      const s = startOfWeek(currentDate, { weekStartsOn: 1 });
      const e = effView === 'workweek' ? addDays(s, 4) : addDays(s, 6);
      const weekNum = getWeek(s, { weekStartsOn: 1 });
      return `${format(s, 'yyyy, MMM d', { locale: fr })}-${format(e, 'd', { locale: fr })} (semaine ${weekNum})`;
    }
    if (effView === 'day' && effDayCount > 1) {
      const e = addDays(currentDate, effDayCount - 1);
      return `${format(currentDate, 'd MMM', { locale: fr })} – ${format(e, 'd MMM yyyy', { locale: fr })}`;
    }
    return format(currentDate, 'EEEE d MMMM yyyy', { locale: fr });
  }, [effView, currentDate, effDayCount]);

  const getEventsForDay = useCallback((day: Date) => filteredEvents.filter((event: CalendarEvent) => {
    const s = parseISO(event.start_date);
    const e = parseISO(event.end_date);
    return isSameDay(s, day) || (day >= startOfDay(s) && day <= e);
  }), [filteredEvents]);

  const openCreateEvent = (date?: Date) => {
    setEditingEvent(null);
    setEditInitialTab('summary');
    if (date) setSelectedRange({ start: date, end: date });
    setShowEventForm(true);
  };
  const openEditEvent = (ev: CalendarEvent, tab: 'summary' | 'recurrence' | 'attendees' | 'attachments' = 'summary') => {
    setEditingEvent(ev);
    setEditInitialTab(tab);
    setShowEventForm(true);
  };

  const handleEventContextMenu = (e: React.MouseEvent, ev: CalendarEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setEventContextMenu({ event: ev, x: e.clientX, y: e.clientY });
  };

  const handleEventMove = (ev: CalendarEvent, newStart: Date) => {
    const oldStart = parseISO(ev.start_date);
    const oldEnd = parseISO(ev.end_date);
    const duration = Math.max(0, oldEnd.getTime() - oldStart.getTime());
    // `newStart` carries naive wall-clock components (h/m of the dropped slot).
    // Interpret those components in the user's preferred timezone so a drop
    // on "11:00" is stored as 11:00 in userTz regardless of the browser TZ.
    const absoluteStart = fromZonedTime(newStart, userTz);
    const absoluteEnd = new Date(absoluteStart.getTime() + duration);
    updateEventMutation.mutate({
      id: ev.id,
      data: {
        startDate: absoluteStart.toISOString(),
        endDate: absoluteEnd.toISOString(),
      },
    });
  };

  const duplicateEvent = (ev: CalendarEvent) => {
    createEventMutation.mutate({
      calendarId: ev.calendar_id,
      title: `${ev.title} (copie)`,
      description: ev.description,
      location: ev.location,
      startDate: ev.start_date,
      endDate: ev.end_date,
      allDay: ev.all_day,
      recurrenceRule: ev.recurrence_rule,
      rdates: ev.rdates,
      reminderMinutes: ev.reminder_minutes ?? null,
      attendees: ev.attendees,
      status: ev.status || 'confirmed',
      priority: ev.priority ?? null,
      url: ev.url,
      categories: ev.categories,
      transparency: ev.transparency,
    } as any);
  };

  const eventMenuItems = (ev: CalendarEvent): ContextMenuItem[] => {
    const moveTargets: ContextMenuItem[] = calendars
      .filter((c: Calendar) => c.id !== ev.calendar_id)
      .map((c: Calendar) => ({
        label: c.name,
        icon: (
          <span
            className="inline-block w-3 h-3 rounded-full"
            style={{ backgroundColor: colorOverrides[c.id] || c.color || '#0078D4' }}
          />
        ),
        onClick: () => updateEventMutation.mutate({ id: ev.id, data: { calendarId: c.id } }),
      }));
    if (moveTargets.length === 0) {
      moveTargets.push({ label: 'Aucun autre calendrier disponible', disabled: true, onClick: () => {} });
    }
    return [
      { label: 'Ouvrir', icon: <FolderOpen size={14} />, onClick: () => openEditEvent(ev, 'summary') },
      { label: 'Modifier', icon: <Pencil size={14} />, onClick: () => openEditEvent(ev, 'summary') },
      { label: ev.recurrence_rule || ev.rdates?.length ? 'Modifier la récurrence' : 'Répéter', icon: <Repeat size={14} />, onClick: () => openEditEvent(ev, 'recurrence') },
      { label: 'Participants', icon: <Users size={14} />, onClick: () => openEditEvent(ev, 'attendees') },
      { label: '', separator: true, onClick: () => {} },
      {
        label: 'Déplacer vers…',
        icon: <FolderInput size={14} />,
        onClick: () => {},
        submenu: moveTargets,
        submenuSearchable: calendars.length > 6,
      },
      { label: "Dupliquer l'événement", icon: <Copy size={14} />, onClick: () => duplicateEvent(ev) },
      { label: '', separator: true, onClick: () => {} },
      { label: 'Supprimer', icon: <Trash2 size={14} />, danger: true, onClick: () => deleteEventMutation.mutate(ev.id) },
    ];
  };

  const handleToggleVisibility = (id: string, visible: boolean) => {
    updateCalendarMutation.mutate({ id, data: { isVisible: visible } });
  };
  const handleRenameCalendar = (id: string, name: string) => {
    updateCalendarMutation.mutate({ id, data: { name } });
  };
  const handleChangeColor = (id: string, color: string) => {
    updateCalendarMutation.mutate({ id, data: { color } });
  };
  const handleDeleteCalendar = (id: string) => {
    const cal = calendars.find((c: Calendar) => c.id === id);
    if (cal) setConfirmDelete(cal);
  };
  const handleShareCalendar = (id: string) => {
    const cal = calendars.find((c: Calendar) => c.id === id);
    if (cal) setShareCalendarTarget(cal);
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-outlook-bg-tertiary">
      <div className="flex-shrink-0 mx-1.5 mt-1.5 mb-1.5 rounded-md shadow-sm overflow-hidden">
        <CalendarRibbon
          onNewEvent={() => openCreateEvent(currentDate)}
          onShareCalendar={() => { if (calendars[0]) handleShareCalendar(calendars[0].id); }}
          onPrint={() => window.print()}
          onSync={() => syncAllMutation.mutate()}
          view={effView}
          onChangeView={(v) => { if (!isCompact) setView(v); }}
          dayCount={effDayCount}
          onChangeDayCount={(n) => { if (!isCompact) setDayCount(n); }}
          splitView={splitView}
          onToggleSplitView={() => setSplitView(v => !v)}
          showSidebar={showSidebar}
          onToggleSidebar={() => setShowSidebarState(v => !v)}
          timeScale={timeScale}
          onChangeTimeScale={setTimeScale}
          columnSizing={columnSizing}
          onChangeColumnSizing={(m) => { setColumnSizing(m); setColumnSizingState(m); }}
          filters={filters}
          onChangeFilters={setFiltersState}
          onClearFilters={() => setFiltersState(DEFAULT_FILTERS)}
          isCollapsed={ribbonCollapsed}
          onToggleCollapse={() => setRibbonCollapsedState(v => !v)}
          ribbonMode={ribbonMode}
          onChangeRibbonMode={setRibbonModeState}
          onOpenSettings={() => setSyncDialogOpen(true)}
          onManageCalendars={() => setNewCalendarOpen(true)}
        />
      </div>

      <div className="flex-1 flex overflow-hidden min-h-0 gap-1 px-1.5 pb-1.5 relative">
        {showSidebar && (
          <>
            {/* Mobile/tablet backdrop — tap to close the sidebar overlay. */}
            <div
              className="lg:hidden absolute inset-0 bg-black/30 z-20"
              onClick={() => setShowSidebarState(false)}
            />
            <div
              className="
                absolute inset-y-0 left-0 z-30 max-w-[85%] flex
                lg:static lg:inset-auto lg:z-auto lg:max-w-none
              "
            >
              <CalendarSidebar
                calendars={calendars}
                currentDate={currentDate}
                onChangeCurrentDate={(d) => {
                  setCurrentDate(d);
                  if (typeof window !== 'undefined' && window.innerWidth < 1024) {
                    setShowSidebarState(false);
                  }
                }}
                selectedRange={selectedRange}
                onNewCalendar={() => setNewCalendarOpen(true)}
                onSubscribeCalendar={() => setAddCalendarUrlOpen(true)}
                onToggleCalendarVisibility={handleToggleVisibility}
                onRenameCalendar={handleRenameCalendar}
                onChangeColor={handleChangeColor}
                onDeleteCalendar={handleDeleteCalendar}
                onShareCalendar={handleShareCalendar}
                onMigrateCalendar={(cal, target) => setMigrateTarget({ cal, target })}
                nextcloudLinked={nextcloudLinked}
                refreshKey={prefsVersion}
                onChangeRefreshKey={bumpPrefs}
              />
            </div>
          </>
        )}

        <div className="flex-1 flex flex-col bg-white rounded-md shadow-sm overflow-hidden min-w-0">
          <div className="flex items-center justify-between px-3 py-2 border-b border-outlook-border flex-shrink-0">
            <div className="flex items-center gap-2">
              <button onClick={goToday} className="text-xs border border-outlook-border rounded px-2.5 py-1 hover:bg-outlook-bg-hover flex items-center gap-1">
                <Briefcase size={12} /> Aujourd'hui
              </button>
              <button onClick={goPrev} className="p-1 hover:bg-outlook-bg-hover rounded" title="Précédent">
                <ChevronLeft size={16} />
              </button>
              <button onClick={goNext} className="p-1 hover:bg-outlook-bg-hover rounded" title="Suivant">
                <ChevronRight size={16} />
              </button>
              <span className="text-sm font-semibold capitalize">{periodLabel}</span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => openCreateEvent(currentDate)} className="bg-outlook-blue hover:bg-outlook-blue-hover text-white rounded-md px-3 py-1 text-xs font-medium flex items-center gap-1.5">
                <Plus size={12} /> Nouvel événement
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-auto">
            {effView === 'month' && (
              <MonthView
                currentDate={currentDate}
                getEventsForDay={getEventsForDay}
                onDayClick={(d) => openCreateEvent(d)}
                onEventClick={(ev) => setSelectedEvent(ev)}
                onEventContextMenu={handleEventContextMenu}
                eventColor={eventColor}
                userTz={userTz}
              />
            )}
            {(effView === 'week' || effView === 'workweek') && (
              <WeekView
                currentDate={currentDate}
                workWeek={effView === 'workweek'}
                timeScale={timeScale}
                events={filteredEvents}
                onSlotClick={(d) => openCreateEvent(d)}
                onEventClick={(ev) => setSelectedEvent(ev)}
                onEventContextMenu={handleEventContextMenu}
                eventColor={eventColor}
                onEventMove={handleEventMove}
                userTz={userTz}
                columnSizing={columnSizing}
              />
            )}
            {effView === 'day' && (
              <DayView
                currentDate={currentDate}
                dayCount={Math.max(1, effDayCount)}
                timeScale={timeScale}
                events={filteredEvents}
                onSlotClick={(d) => openCreateEvent(d)}
                onEventClick={(ev) => setSelectedEvent(ev)}
                onEventContextMenu={handleEventContextMenu}
                eventColor={eventColor}
                onEventMove={handleEventMove}
                userTz={userTz}
                columnSizing={columnSizing}
              />
            )}
            {effView === 'agenda' && (
              <AgendaView
                events={filteredEvents}
                rangeStart={rangeStart}
                rangeEnd={rangeEnd}
                onEventClick={(ev) => setSelectedEvent(ev)}
                onEventContextMenu={handleEventContextMenu}
                onCreateEvent={(d) => openCreateEvent(d)}
                eventColor={eventColor}
                userTz={userTz}
              />
            )}
          </div>
        </div>
      </div>

      {selectedEvent && (
        <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50" onClick={() => setSelectedEvent(null)}>
          <div className="bg-white rounded-lg shadow-xl w-96 p-4" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-3">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded" style={{ backgroundColor: eventColor(selectedEvent) }} />
                <h3 className="font-semibold">{selectedEvent.title}</h3>
              </div>
              <button onClick={() => setSelectedEvent(null)} className="text-outlook-text-disabled hover:text-outlook-text-primary">
                <X size={16} />
              </button>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2 text-outlook-text-secondary">
                <Clock size={14} />
                {selectedEvent.all_day ? 'Toute la journée' : (
                  <span>{formatInTimeZone(parseISO(selectedEvent.start_date), userTz, 'EEEE d MMMM yyyy HH:mm', { locale: fr })} – {formatInTimeZone(parseISO(selectedEvent.end_date), userTz, 'HH:mm', { locale: fr })}</span>
                )}
              </div>
              {selectedEvent.location && (
                <div className="flex items-center gap-2 text-outlook-text-secondary">
                  <MapPin size={14} /> {selectedEvent.location}
                </div>
              )}
              {selectedEvent.description && (
                <p className="text-outlook-text-secondary mt-2 whitespace-pre-wrap">{selectedEvent.description}</p>
              )}
              {selectedEvent.attendees && selectedEvent.attendees.length > 0 && (
                <div className="flex items-start gap-2 text-outlook-text-secondary">
                  <Users size={14} className="mt-0.5" />
                  <div>{selectedEvent.attendees.map(a => a.name || a.email).join(', ')}</div>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => { openEditEvent(selectedEvent); setSelectedEvent(null); }} className="text-outlook-text-primary hover:bg-outlook-bg-hover px-3 py-1.5 rounded text-sm flex items-center gap-1.5">
                <Pencil size={14} /> Modifier
              </button>
              <button onClick={() => deleteEventMutation.mutate(selectedEvent.id)} className="text-outlook-danger hover:bg-red-50 px-3 py-1.5 rounded text-sm flex items-center gap-1.5">
                <Trash2 size={14} /> Supprimer
              </button>
            </div>
          </div>
        </div>
      )}

      {showEventForm && (
        <EventModal
          calendars={calendars}
          initialDate={selectedRange?.start || currentDate}
          editingEvent={editingEvent}
          initialTab={editInitialTab}
          defaultDurationMinutes={timeScale}
          onSubmit={(data) => {
            if (editingEvent) {
              updateEventMutation.mutate({ id: editingEvent.id, data });
            } else {
              createEventMutation.mutate(data);
            }
          }}
          onClose={() => { setShowEventForm(false); setEditingEvent(null); setSelectedRange(null); setEditInitialTab('summary'); }}
          isSubmitting={createEventMutation.isPending || updateEventMutation.isPending}
        />
      )}

      {eventContextMenu && (
        <ContextMenu
          x={eventContextMenu.x}
          y={eventContextMenu.y}
          items={eventMenuItems(eventContextMenu.event)}
          onClose={() => setEventContextMenu(null)}
        />
      )}

      {newCalendarOpen && (
        <NewCalendarForm
          onCreate={(data) => {
            createCalendarMutation.mutate(data, { onSuccess: () => setNewCalendarOpen(false) });
          }}
          onClose={() => setNewCalendarOpen(false)}
          isSubmitting={createCalendarMutation.isPending}
        />
      )}

      <SyncCalendarsDialog open={syncDialogOpen} onClose={() => setSyncDialogOpen(false)} />
      <AddCalendarUrlDialog open={addCalendarUrlOpen} onClose={() => setAddCalendarUrlOpen(false)} />

      {migrateTarget && (
        <MigrateCalendarDialog
          calendar={migrateTarget.cal}
          target={migrateTarget.target}
          onClose={() => setMigrateTarget(null)}
          onConfirm={async (deleteRemote) => {
            await migrateMutation.mutateAsync({ id: migrateTarget.cal.id, target: migrateTarget.target, deleteRemote });
          }}
        />
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        title={`Supprimer « ${confirmDelete?.name} » ?`}
        description="Les événements de ce calendrier seront également supprimés."
        confirmLabel="Supprimer"
        danger
        icon="trash"
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && deleteCalendarMutation.mutate(confirmDelete.id)}
      />

      {shareCalendarTarget && (
        <ShareCalendarDialog
          calendar={shareCalendarTarget}
          onClose={() => setShareCalendarTarget(null)}
        />
      )}

      {/* Floating action button — mobile/tablet only */}
      <FloatingActionButton
        onClick={() => openCreateEvent(new Date())}
        label="Nouvel événement"
        icon={<Plus size={24} />}
      />
    </div>
  );
}

// -----------------------------------------------------------------------------
// AgendaView — flat list of events grouped by day, similar to the Outlook
// Mobile "Agenda" view. Each day shows its date header followed by the events
// occurring that day, sorted chronologically. All-day events display "Toute
// la journée"; timed events show start–end. Clicking an event opens its
// detail card; right-click triggers the standard event context menu.
// -----------------------------------------------------------------------------
function AgendaView({
  events, rangeStart, rangeEnd, onEventClick, onEventContextMenu,
  onCreateEvent, eventColor, userTz,
}: {
  events: CalendarEvent[];
  rangeStart: Date;
  rangeEnd: Date;
  onEventClick: (ev: CalendarEvent) => void;
  onEventContextMenu: (e: React.MouseEvent, ev: CalendarEvent) => void;
  onCreateEvent: (date: Date) => void;
  eventColor: (ev: CalendarEvent) => string;
  userTz: string;
}) {
  // Build a map: ymd → events on that day, including multi-day events
  // expanded across each day they intersect with the visible range.
  const grouped = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    const days = eachDayOfInterval({ start: startOfDay(rangeStart), end: startOfDay(rangeEnd) });
    for (const day of days) {
      const dayKey = format(day, 'yyyy-MM-dd');
      const dayEvents = events.filter((ev) => {
        const s = parseISO(ev.start_date);
        const e = parseISO(ev.end_date);
        return isSameDay(s, day) || (day >= startOfDay(s) && day <= e);
      });
      if (dayEvents.length > 0) {
        // Sort: all-day first, then by start time
        dayEvents.sort((a, b) => {
          if (a.all_day && !b.all_day) return -1;
          if (!a.all_day && b.all_day) return 1;
          return parseISO(a.start_date).getTime() - parseISO(b.start_date).getTime();
        });
        map.set(dayKey, dayEvents);
      }
    }
    return Array.from(map.entries());
  }, [events, rangeStart, rangeEnd]);

  if (grouped.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-outlook-text-secondary p-8">
        <p className="text-sm">Aucun événement sur cette période.</p>
        <button
          onClick={() => onCreateEvent(new Date())}
          className="mt-3 text-outlook-blue hover:underline text-sm"
        >
          Créer un nouvel événement
        </button>
      </div>
    );
  }

  return (
    <div className="px-2 sm:px-4 py-2 max-w-3xl mx-auto">
      {grouped.map(([dayKey, dayEvents]) => {
        const day = parseISO(dayKey);
        const today = isToday(day);
        return (
          <div key={dayKey} className="mb-4">
            <div className={`sticky top-0 z-10 bg-white py-1.5 mb-1 flex items-baseline gap-2 border-b border-outlook-border ${today ? 'text-outlook-blue' : 'text-outlook-text-primary'}`}>
              <span className="text-xs uppercase tracking-wide font-semibold">
                {format(day, 'EEEE', { locale: fr })}
              </span>
              <span className="text-base font-bold">{format(day, 'd', { locale: fr })}</span>
              <span className="text-xs text-outlook-text-secondary">
                {format(day, 'MMMM', { locale: fr })}
              </span>
              {today && <span className="ml-auto text-[10px] uppercase font-semibold">Aujourd'hui</span>}
            </div>
            <div className="space-y-1">
              {dayEvents.map((ev) => {
                const color = eventColor(ev);
                const sameStartDay = isSameDay(parseISO(ev.start_date), day);
                return (
                  <button
                    key={`${ev.id}-${dayKey}`}
                    onClick={() => onEventClick(ev)}
                    onContextMenu={(e) => onEventContextMenu(e, ev)}
                    className="w-full flex items-start gap-3 text-left px-3 py-2 rounded-md hover:bg-outlook-bg-hover transition-colors"
                  >
                    <span
                      className="w-1 self-stretch rounded flex-shrink-0 mt-0.5"
                      style={{ backgroundColor: color }}
                    />
                    <span className="flex-shrink-0 w-20 text-xs text-outlook-text-secondary pt-0.5">
                      {ev.all_day || !sameStartDay
                        ? 'Toute la journée'
                        : formatInTimeZone(parseISO(ev.start_date), userTz, 'HH:mm')}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium text-outlook-text-primary truncate">
                        {ev.title || '(Sans titre)'}
                      </span>
                      {ev.location && (
                        <span className="block text-xs text-outlook-text-secondary truncate">
                          {ev.location}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MonthView({ currentDate, getEventsForDay, onDayClick, onEventClick, onEventContextMenu, eventColor, userTz }: {
  currentDate: Date;
  getEventsForDay: (d: Date) => CalendarEvent[];
  onDayClick: (d: Date) => void;
  onEventClick: (ev: CalendarEvent) => void;
  onEventContextMenu: (e: React.MouseEvent, ev: CalendarEvent) => void;
  eventColor: (ev: CalendarEvent) => string;
  userTz: string;
}) {
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const calStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: calStart, end: calEnd });

  return (
    <div className="h-full flex flex-col">
      <div className="grid grid-cols-7 border-b border-outlook-border bg-outlook-bg-primary flex-shrink-0">
        {['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'].map(day => (
          <div key={day} className="text-xs font-medium text-outlook-text-secondary text-center py-2 border-r border-outlook-border last:border-r-0">
            {day}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 flex-1" style={{ gridAutoRows: 'minmax(100px, 1fr)' }}>
        {days.map((day) => {
          const dayEvents = getEventsForDay(day);
          const inMonth = isSameMonth(day, currentDate);
          const today = isToday(day);
          return (
            <div
              key={day.toISOString()}
              onClick={() => onDayClick(day)}
              className={`border-r border-b border-outlook-border p-1 cursor-pointer hover:bg-outlook-bg-hover/50 transition-colors ${!inMonth ? 'bg-outlook-bg-primary/50' : 'bg-white'}`}
            >
              <div className={`text-xs font-medium mb-0.5 w-6 h-6 flex items-center justify-center rounded-full ${today ? 'bg-outlook-blue text-white' : inMonth ? 'text-outlook-text-primary' : 'text-outlook-text-disabled'}`}>
                {format(day, 'd')}
              </div>
              {dayEvents.slice(0, 3).map((event) => (
                <button
                  key={event.id}
                  onContextMenu={(e) => onEventContextMenu(e, event)}
                  onClick={(e) => { e.stopPropagation(); onEventClick(event); }}
                  className="w-full text-left text-[10px] px-1 py-0.5 rounded mb-0.5 truncate transition-opacity hover:opacity-80"
                  style={{ backgroundColor: `${eventColor(event)}20`, color: eventColor(event), borderLeft: `2px solid ${eventColor(event)}` }}
                >
                  {event.all_day ? '' : formatInTimeZone(parseISO(event.start_date), userTz, 'HH:mm') + ' '}
                  {event.title}
                </button>
              ))}
              {dayEvents.length > 3 && (
                <div className="text-[10px] text-outlook-text-disabled px-1">
                  +{dayEvents.length - 3} de plus
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekView({ currentDate, workWeek, timeScale, events, onSlotClick, onEventClick, onEventContextMenu, eventColor, onEventMove, userTz, columnSizing }: {
  currentDate: Date;
  workWeek: boolean;
  timeScale: number;
  events: CalendarEvent[];
  onSlotClick: (d: Date) => void;
  onEventClick: (ev: CalendarEvent) => void;
  onEventContextMenu: (e: React.MouseEvent, ev: CalendarEvent) => void;
  eventColor: (ev: CalendarEvent) => string;
  onEventMove?: (ev: CalendarEvent, newStart: Date) => void;
  userTz: string;
  columnSizing?: 'fixed' | 'auto';
}) {
  const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
  const weekDays = workWeek ? [0, 1, 2, 3, 4] : [0, 1, 2, 3, 4, 5, 6];
  const days = weekDays.map(i => addDays(weekStart, i));
  return (
    <TimeGridView days={days} timeScale={timeScale} events={events} onSlotClick={onSlotClick} onEventClick={onEventClick} onEventContextMenu={onEventContextMenu} eventColor={eventColor} onEventMove={onEventMove} userTz={userTz} columnSizing={columnSizing} />
  );
}

function DayView({ currentDate, dayCount, timeScale, events, onSlotClick, onEventClick, onEventContextMenu, eventColor, onEventMove, userTz, columnSizing }: {
  currentDate: Date;
  dayCount: number;
  timeScale: number;
  events: CalendarEvent[];
  onSlotClick: (d: Date) => void;
  onEventClick: (ev: CalendarEvent) => void;
  onEventContextMenu: (e: React.MouseEvent, ev: CalendarEvent) => void;
  eventColor: (ev: CalendarEvent) => string;
  onEventMove?: (ev: CalendarEvent, newStart: Date) => void;
  userTz: string;
  columnSizing?: 'fixed' | 'auto';
}) {
  const days = Array.from({ length: dayCount }, (_, i) => addDays(startOfDay(currentDate), i));
  return (
    <TimeGridView days={days} timeScale={timeScale} events={events} onSlotClick={onSlotClick} onEventClick={onEventClick} onEventContextMenu={onEventContextMenu} eventColor={eventColor} onEventMove={onEventMove} userTz={userTz} columnSizing={columnSizing} />
  );
}

function TimeGridView({ days, timeScale, events, onSlotClick, onEventClick, onEventContextMenu, eventColor, onEventMove, userTz, columnSizing = 'fixed' }: {
  days: Date[];
  timeScale: number;
  events: CalendarEvent[];
  onSlotClick: (d: Date) => void;
  onEventClick: (ev: CalendarEvent) => void;
  onEventContextMenu: (e: React.MouseEvent, ev: CalendarEvent) => void;
  eventColor: (ev: CalendarEvent) => string;
  onEventMove?: (ev: CalendarEvent, newStart: Date) => void;
  userTz: string;
  columnSizing?: 'fixed' | 'auto';
}) {
  const HOUR_HEIGHT = 48;
  const slotsPerHour = Math.max(1, Math.round(60 / timeScale));
  const slotHeight = HOUR_HEIGHT / slotsPerHour;

  const [dragHover, setDragHover] = useState<{ dayKey: string; slotIdx: number } | null>(null);
  const dragOffsetRef = useRef<number>(0);
  // Latest drop target computed during dragover. Drop uses this so the event
  // always lands exactly where the highlight was just shown.
  const lastHoverRef = useRef<{ day: Date; slotIdx: number } | null>(null);

  const getEventsForDay = (day: Date) => events.filter((ev) => {
    // Interpret event start in the user's preferred TZ before comparing to
    // the (browser-local) day grid so events land on the correct column
    // even when the browser TZ differs from the user preference.
    const s = toZonedTime(parseISO(ev.start_date), userTz);
    return isSameDay(s, day);
  });

  /**
   * Outlook-style overlap layout.
   *
   * Splits overlapping events into vertical "lanes" (columns). Inside a cluster
   * of mutually overlapping events, each event gets its own lane and its width
   * is `1 / columns` of the day column. An event that is free to expand to
   * the right (no neighbour in later lanes at the same time) is allowed to
   * span the remaining free lanes so it stays readable when alone.
   */
  type Laid = { ev: CalendarEvent; start: Date; end: Date; col: number; cols: number; span: number };
  const layoutDay = (dayEvents: CalendarEvent[]): Laid[] => {
    const items = dayEvents
      .map((ev) => ({
        ev,
        start: toZonedTime(parseISO(ev.start_date), userTz),
        end: toZonedTime(parseISO(ev.end_date), userTz),
      }))
      .sort((a, b) => a.start.getTime() - b.start.getTime() || b.end.getTime() - a.end.getTime());

    // Group into clusters of overlap
    const clusters: typeof items[] = [];
    let cur: typeof items = [];
    let curEnd = -Infinity;
    for (const it of items) {
      if (it.start.getTime() < curEnd) {
        cur.push(it);
        curEnd = Math.max(curEnd, it.end.getTime());
      } else {
        if (cur.length) clusters.push(cur);
        cur = [it];
        curEnd = it.end.getTime();
      }
    }
    if (cur.length) clusters.push(cur);

    const out: Laid[] = [];
    for (const cluster of clusters) {
      // Assign each event to the first lane where it fits
      const lanes: number[] = []; // lane end-time
      const assigned: { it: typeof cluster[number]; col: number }[] = [];
      for (const it of cluster) {
        let col = lanes.findIndex((endTime) => endTime <= it.start.getTime());
        if (col === -1) { col = lanes.length; lanes.push(it.end.getTime()); }
        else { lanes[col] = it.end.getTime(); }
        assigned.push({ it, col });
      }
      const cols = lanes.length;
      // Compute how far each event can expand to the right
      for (const { it, col } of assigned) {
        let span = 1;
        for (let c = col + 1; c < cols; c++) {
          const conflict = assigned.some(
            (o) => o.col === c
              && o.it.start.getTime() < it.end.getTime()
              && o.it.end.getTime() > it.start.getTime()
          );
          if (conflict) break;
          span++;
        }
        out.push({ ev: it.ev, start: it.start, end: it.end, col, cols, span });
      }
    }
    return out;
  };

  const renderEvent = (laid: Laid) => {
    const { ev, start: sz, end: ez, col, cols, span } = laid;
    const s = parseISO(ev.start_date);
    const e = parseISO(ev.end_date);
    const startMinutes = sz.getHours() * 60 + sz.getMinutes();
    const duration = Math.max(15, differenceInMinutes(ez, sz));
    const top = (startMinutes / 60) * HOUR_HEIGHT;
    const height = (duration / 60) * HOUR_HEIGHT;
    // Leave a tiny 2px inset so adjacent events don't touch. When multiple
    // lanes exist, slightly overlap by 4px for the Outlook cascaded look.
    const GUTTER = 2;
    const OVERLAP = cols > 1 ? 4 : 0;
    const widthPct = (span / cols) * 100;
    const leftPct = (col / cols) * 100;
    return (
      <button
        key={ev.id}
        draggable={!!onEventMove}
        onDragStart={(dragEvt) => {
          if (!onEventMove) return;
          dragEvt.dataTransfer.effectAllowed = 'move';
          dragEvt.dataTransfer.setData('text/event-id', ev.id);
          const rect = (dragEvt.currentTarget as HTMLElement).getBoundingClientRect();
          dragOffsetRef.current = dragEvt.clientY - rect.top;
        }}
        onDragEnd={() => { setDragHover(null); }}
        onClick={(clickEvt) => { clickEvt.stopPropagation(); onEventClick(ev); }}
        onContextMenu={(clickEvt) => onEventContextMenu(clickEvt, ev)}
        className="absolute rounded px-1.5 py-0.5 text-[11px] text-left overflow-hidden hover:opacity-90 hover:z-20 transition-opacity shadow-sm cursor-grab active:cursor-grabbing"
        style={{
          top,
          height,
          left: `calc(${leftPct}% + ${GUTTER}px)`,
          width: `calc(${widthPct}% - ${GUTTER * 2}px + ${OVERLAP}px)`,
          zIndex: 10 + col,
          backgroundColor: `${eventColor(ev)}20`,
          color: eventColor(ev),
          borderLeft: `3px solid ${eventColor(ev)}`,
        }}
        title={`${ev.title} — ${formatInTimeZone(s, userTz, 'HH:mm')}–${formatInTimeZone(e, userTz, 'HH:mm')}${ev.location ? ` · ${ev.location}` : ''}`}
      >
        <div className="font-medium truncate">{ev.title}</div>
        <div className="text-[10px] opacity-80 truncate">
          {formatInTimeZone(s, userTz, 'HH:mm')}–{formatInTimeZone(e, userTz, 'HH:mm')}{ev.location ? ` · ${ev.location}` : ''}
        </div>
      </button>
    );
  };

  const slotFromPointer = (container: HTMLElement, clientY: number) => {
    const rect = container.getBoundingClientRect();
    const y = clientY - rect.top - dragOffsetRef.current;
    const totalSlots = 24 * slotsPerHour;
    const idx = Math.max(0, Math.min(totalSlots - 1, Math.round(y / slotHeight)));
    return idx;
  };

  // Column weights — "auto" mode shrinks empty days and grows busy ones.
  // The weight of a day is the maximum number of overlapping events at any
  // moment of the day (i.e. the number of lanes its `layoutDay` will need),
  // clamped to a sensible range so even an empty day stays clickable.
  const dayWeights = days.map(day => {
    if (columnSizing !== 'auto') return 1;
    const dayEvents = getEventsForDay(day);
    if (dayEvents.length === 0) return 0.5; // smallest
    const laid = layoutDay(dayEvents);
    const maxLanes = laid.reduce((m, l) => Math.max(m, l.cols), 1);
    // Soft growth: 1 event = 1, 2 = 1.4, 3 = 1.7, 4 = 1.9, plateau ~2.4
    return 1 + Math.min(1.4, Math.log2(1 + maxLanes) * 0.7);
  });
  const gridCols = `48px ${dayWeights.map(w => `minmax(0, ${w}fr)`).join(' ')}`;

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-auto" style={{ scrollbarGutter: 'stable' }}>
        {/* Sticky day header — kept inside the same scroll container so it
            shares the exact column widths with the grid below, even when
            the vertical scrollbar is displayed. */}
        <div className="grid border-b border-outlook-border bg-outlook-bg-primary sticky top-0 z-10" style={{ gridTemplateColumns: gridCols }}>
          <div />
          {days.map(day => {
            const today = isToday(day);
            return (
              <div key={day.toISOString()} className="text-center py-2 border-l border-outlook-border">
                <div className={`text-xs uppercase ${today ? 'text-outlook-blue' : 'text-outlook-text-secondary'}`}>
                  {format(day, 'EEEE', { locale: fr })}
                </div>
                <div className={`text-lg font-semibold ${today ? 'text-outlook-blue' : ''}`}>
                  {format(day, 'd')}
                </div>
              </div>
            );
          })}
        </div>
        <div className="grid" style={{ gridTemplateColumns: gridCols }}>
          <div>
            {Array.from({ length: 24 }).map((_, h) => (
              <div key={h} style={{ height: HOUR_HEIGHT }} className="text-[10px] text-outlook-text-disabled text-right pr-1 border-b border-outlook-border">
                {h === 0 ? '' : `${h}`}
              </div>
            ))}
          </div>
          {days.map(day => {
            const dayEvents = getEventsForDay(day);
            const dayKey = day.toISOString();
            return (
              <div
                key={dayKey}
                className="relative border-l border-outlook-border"
                onDragOver={(e) => {
                  if (!onEventMove) return;
                  if (!e.dataTransfer.types.includes('text/event-id')) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  const idx = slotFromPointer(e.currentTarget as HTMLElement, e.clientY);
                  lastHoverRef.current = { day, slotIdx: idx };
                  setDragHover({ dayKey, slotIdx: idx });
                }}
                onDragLeave={(e) => {
                  // only clear when leaving the column entirely
                  const related = e.relatedTarget as Node | null;
                  if (!related || !(e.currentTarget as HTMLElement).contains(related)) {
                    setDragHover((prev) => (prev && prev.dayKey === dayKey ? null : prev));
                  }
                }}
                onDrop={(e) => {
                  if (!onEventMove) return;
                  const id = e.dataTransfer.getData('text/event-id');
                  if (!id) return;
                  e.preventDefault();
                  const ev = events.find(x => x.id === id);
                  if (!ev) { setDragHover(null); lastHoverRef.current = null; return; }
                  // Prefer the last slot computed during dragover — it is what
                  // the user saw highlighted and guarantees drop == highlight.
                  const target = lastHoverRef.current || {
                    day,
                    slotIdx: slotFromPointer(e.currentTarget as HTMLElement, e.clientY),
                  };
                  const h = Math.floor(target.slotIdx / slotsPerHour);
                  const m = (target.slotIdx % slotsPerHour) * timeScale;
                  const newStart = setMinutes(setHours(target.day, h), m);
                  onEventMove(ev, newStart);
                  setDragHover(null);
                  lastHoverRef.current = null;
                }}
              >
                {Array.from({ length: 24 * slotsPerHour }).map((_, idx) => {
                  const h = Math.floor(idx / slotsPerHour);
                  const m = (idx % slotsPerHour) * timeScale;
                  const slotDate = setMinutes(setHours(day, h), m);
                  const isHour = m === 0;
                  const isHoverSlot = dragHover?.dayKey === dayKey && dragHover.slotIdx === idx;
                  return (
                    <div
                      key={idx}
                      onClick={() => onSlotClick(slotDate)}
                      style={{ height: slotHeight }}
                      className={`hover:bg-outlook-bg-hover/40 cursor-pointer ${isHoverSlot ? 'bg-outlook-blue/15 ring-1 ring-inset ring-outlook-blue' : ''} ${isHour ? 'border-b border-outlook-border' : 'border-b border-outlook-border/30'}`}
                    />
                  );
                })}
                <div className="absolute inset-0 pointer-events-none">
                  <div className="relative w-full h-full">
                    {layoutDay(dayEvents).map(laid => (
                      <div key={laid.ev.id} className="pointer-events-auto">
                        {renderEvent(laid)}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function NewCalendarForm({ onCreate, onClose, isSubmitting }: {
  onCreate: (data: { name: string; color: string; mailAccountId?: string; createOnCaldav?: boolean }) => void;
  onClose: () => void;
  isSubmitting: boolean;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#0078D4');
  const palette = ['#0078D4', '#107C10', '#B4009E', '#E3008C', '#E74856', '#CA5010', '#FFB900', '#5C2E91'];

  const { data: ncStatus } = useQuery({
    queryKey: ['user-nextcloud-status'],
    queryFn: () => api.getUserNextcloudStatus(),
  });

  // Un vrai compte Nextcloud (provisionné via l'admin) sera utilisé automatiquement par le serveur.
  // Sinon, on crée un simple calendrier local — on ne touche pas au CalDAV de la boîte mail
  // (ex: cPanel ne supporte qu'un seul calendrier et ne permet pas MKCALENDAR).
  const useNextcloud = !!(ncStatus?.enabled && ncStatus?.linked && ncStatus?.autoCreateCalendars);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    // Dans tous les cas, on envoie uniquement name + color.
    // Le serveur se charge d'auto-créer sur Nextcloud si l'utilisateur est provisionné.
    onCreate({ name: name.trim(), color });
  };

  return (
    <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-[28rem] p-6" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">Nouveau calendrier</h2>
          <button onClick={onClose} className="text-outlook-text-disabled hover:text-outlook-text-primary">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="text-xs text-outlook-text-secondary mb-1 block">Nom</label>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nom du calendrier"
              required
              className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-outlook-blue"
            />
          </div>

          <div>
            <label className="text-xs text-outlook-text-secondary mb-1 block">Emplacement</label>
            <div className="p-3 rounded-md border border-outlook-border bg-outlook-bg-hover/30 text-sm">
              {useNextcloud ? (
                <>
                  <div className="font-medium">Nextcloud</div>
                  <div className="text-xs text-outlook-text-secondary">
                    Créé sur Nextcloud{ncStatus?.ncEmail ? ` (${ncStatus.ncEmail})` : ''} et synchronisé automatiquement.
                  </div>
                </>
              ) : (
                <>
                  <div className="font-medium">Local</div>
                  <div className="text-xs text-outlook-text-secondary">
                    Aucun compte Nextcloud lié : visible uniquement ici.
                  </div>
                </>
              )}
            </div>
          </div>

          <div>
            <label className="text-xs text-outlook-text-secondary mb-1 block">Couleur</label>
            <div className="flex gap-2">
              {palette.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-7 h-7 rounded-full border-2 ${color === c ? 'border-outlook-text-primary' : 'border-transparent'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-md hover:bg-outlook-bg-hover">Annuler</button>
            <button
              type="submit"
              disabled={isSubmitting || !name.trim()}
              className="bg-outlook-blue hover:bg-outlook-blue-hover text-white px-4 py-2 text-sm rounded-md disabled:opacity-50"
            >
              {isSubmitting ? 'Création...' : 'Créer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}