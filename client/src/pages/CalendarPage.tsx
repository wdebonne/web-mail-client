import { useState, useMemo, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { CalendarEvent, Calendar } from '../types';
import {
  ChevronLeft, ChevronRight, Plus, X, Clock, MapPin, Users,
  Briefcase, Pencil, Trash2,
} from 'lucide-react';
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, isSameMonth, isSameDay, isToday, addMonths,
  subMonths, parseISO, addDays, subDays, differenceInMinutes,
  getWeek, setHours, setMinutes, startOfDay,
} from 'date-fns';
import { fr } from 'date-fns/locale';
import toast from 'react-hot-toast';
import CalendarRibbon, { CalendarViewMode, CalendarFilters } from '../components/calendar/CalendarRibbon';
import CalendarSidebar from '../components/calendar/CalendarSidebar';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { SyncCalendarsDialog } from '../components/calendar/SyncCalendarsDialog';
import { AddCalendarUrlDialog } from '../components/calendar/AddCalendarUrlDialog';
import {
  getCalendarView, setCalendarView,
  getRibbonMode, setRibbonMode,
  getRibbonCollapsed, setRibbonCollapsed,
  getShowSidebar, setShowSidebar,
  getColorOverrides,
  getHiddenLocally,
} from '../utils/calendarPreferences';

const DEFAULT_FILTERS: CalendarFilters = {
  appointments: true, meetings: true, categories: true, recurring: true, inPerson: true,
};

export default function CalendarPage() {
  const queryClient = useQueryClient();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<CalendarViewMode>(() => getCalendarView());
  const [dayCount, setDayCount] = useState(1);
  const [splitView, setSplitView] = useState(false);
  const [timeScale, setTimeScale] = useState(30);
  const [filters, setFiltersState] = useState<CalendarFilters>(DEFAULT_FILTERS);

  const [showEventForm, setShowEventForm] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [selectedRange, setSelectedRange] = useState<{ start: Date; end: Date } | null>(null);

  const [ribbonCollapsed, setRibbonCollapsedState] = useState(() => getRibbonCollapsed());
  const [ribbonMode, setRibbonModeState] = useState<'classic' | 'simplified'>(() => getRibbonMode());
  const [showSidebar, setShowSidebarState] = useState(() => getShowSidebar());
  const [prefsVersion, setPrefsVersion] = useState(0);
  const bumpPrefs = useCallback(() => setPrefsVersion(n => n + 1), []);

  const [confirmDelete, setConfirmDelete] = useState<Calendar | null>(null);
  const [newCalendarOpen, setNewCalendarOpen] = useState(false);
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [addCalendarUrlOpen, setAddCalendarUrlOpen] = useState(false);

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

  const { rangeStart, rangeEnd } = useMemo(() => {
    let s: Date; let e: Date;
    if (view === 'month') {
      s = startOfWeek(startOfMonth(currentDate), { weekStartsOn: 1 });
      e = endOfWeek(endOfMonth(currentDate), { weekStartsOn: 1 });
    } else if (view === 'week') {
      s = startOfWeek(currentDate, { weekStartsOn: 1 });
      e = endOfWeek(currentDate, { weekStartsOn: 1 });
    } else if (view === 'workweek') {
      s = startOfWeek(currentDate, { weekStartsOn: 1 });
      e = addDays(s, 4);
    } else {
      s = startOfDay(currentDate);
      e = addDays(s, Math.max(1, dayCount) - 1);
    }
    return { rangeStart: s, rangeEnd: e };
  }, [view, currentDate, dayCount]);

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events'] });
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendars'] });
      toast.success('Calendrier créé');
    },
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
    if (view === 'month') setCurrentDate(subMonths(currentDate, 1));
    else if (view === 'day') setCurrentDate(subDays(currentDate, Math.max(1, dayCount)));
    else setCurrentDate(subDays(currentDate, 7));
  };
  const goNext = () => {
    if (view === 'month') setCurrentDate(addMonths(currentDate, 1));
    else if (view === 'day') setCurrentDate(addDays(currentDate, Math.max(1, dayCount)));
    else setCurrentDate(addDays(currentDate, 7));
  };
  const goToday = () => setCurrentDate(new Date());

  const periodLabel = useMemo(() => {
    if (view === 'month') return format(currentDate, 'MMMM yyyy', { locale: fr });
    if (view === 'week' || view === 'workweek') {
      const s = startOfWeek(currentDate, { weekStartsOn: 1 });
      const e = view === 'workweek' ? addDays(s, 4) : addDays(s, 6);
      const weekNum = getWeek(s, { weekStartsOn: 1 });
      return `${format(s, 'yyyy, MMM d', { locale: fr })}-${format(e, 'd', { locale: fr })} (semaine ${weekNum})`;
    }
    if (view === 'day' && dayCount > 1) {
      const e = addDays(currentDate, dayCount - 1);
      return `${format(currentDate, 'd MMM', { locale: fr })} – ${format(e, 'd MMM yyyy', { locale: fr })}`;
    }
    return format(currentDate, 'EEEE d MMMM yyyy', { locale: fr });
  }, [view, currentDate, dayCount]);

  const getEventsForDay = useCallback((day: Date) => filteredEvents.filter((event: CalendarEvent) => {
    const s = parseISO(event.start_date);
    const e = parseISO(event.end_date);
    return isSameDay(s, day) || (day >= startOfDay(s) && day <= e);
  }), [filteredEvents]);

  const openCreateEvent = (date?: Date) => {
    setEditingEvent(null);
    if (date) setSelectedRange({ start: date, end: date });
    setShowEventForm(true);
  };
  const openEditEvent = (ev: CalendarEvent) => {
    setEditingEvent(ev);
    setShowEventForm(true);
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
    const email = window.prompt("Email de l'utilisateur avec qui partager (lecture) :");
    if (!email) return;
    api.shareCalendar(id, email, 'read')
      .then(() => toast.success('Calendrier partagé'))
      .catch((err) => toast.error(err.message || 'Partage impossible'));
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-outlook-bg-tertiary">
      <div className="flex-shrink-0 mx-1.5 mt-1.5 mb-1.5 rounded-md shadow-sm overflow-hidden">
        <CalendarRibbon
          onNewEvent={() => openCreateEvent(currentDate)}
          onShareCalendar={() => { if (calendars[0]) handleShareCalendar(calendars[0].id); }}
          onPrint={() => window.print()}
          onSync={() => syncAllMutation.mutate()}
          view={view}
          onChangeView={setView}
          dayCount={dayCount}
          onChangeDayCount={setDayCount}
          splitView={splitView}
          onToggleSplitView={() => setSplitView(v => !v)}
          showSidebar={showSidebar}
          onToggleSidebar={() => setShowSidebarState(v => !v)}
          timeScale={timeScale}
          onChangeTimeScale={setTimeScale}
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

      <div className="flex-1 flex overflow-hidden min-h-0 gap-1 px-1.5 pb-1.5">
        {showSidebar && (
          <CalendarSidebar
            calendars={calendars}
            currentDate={currentDate}
            onChangeCurrentDate={setCurrentDate}
            selectedRange={selectedRange}
            onNewCalendar={() => setNewCalendarOpen(true)}
            onSubscribeCalendar={() => setAddCalendarUrlOpen(true)}
            onToggleCalendarVisibility={handleToggleVisibility}
            onRenameCalendar={handleRenameCalendar}
            onChangeColor={handleChangeColor}
            onDeleteCalendar={handleDeleteCalendar}
            onShareCalendar={handleShareCalendar}
            refreshKey={prefsVersion}
            onChangeRefreshKey={bumpPrefs}
          />
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
            {view === 'month' && (
              <MonthView
                currentDate={currentDate}
                getEventsForDay={getEventsForDay}
                onDayClick={(d) => openCreateEvent(d)}
                onEventClick={(ev) => setSelectedEvent(ev)}
                eventColor={eventColor}
              />
            )}
            {(view === 'week' || view === 'workweek') && (
              <WeekView
                currentDate={currentDate}
                workWeek={view === 'workweek'}
                timeScale={timeScale}
                events={filteredEvents}
                onSlotClick={(d) => openCreateEvent(d)}
                onEventClick={(ev) => setSelectedEvent(ev)}
                eventColor={eventColor}
              />
            )}
            {view === 'day' && (
              <DayView
                currentDate={currentDate}
                dayCount={Math.max(1, dayCount)}
                timeScale={timeScale}
                events={filteredEvents}
                onSlotClick={(d) => openCreateEvent(d)}
                onEventClick={(ev) => setSelectedEvent(ev)}
                eventColor={eventColor}
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
                  <span>{format(parseISO(selectedEvent.start_date), 'EEEE d MMMM yyyy HH:mm', { locale: fr })} – {format(parseISO(selectedEvent.end_date), 'HH:mm', { locale: fr })}</span>
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
        <EventForm
          calendars={calendars}
          initialDate={selectedRange?.start || currentDate}
          editingEvent={editingEvent}
          onSubmit={(data) => {
            if (editingEvent) {
              updateEventMutation.mutate({ id: editingEvent.id, data });
            } else {
              createEventMutation.mutate(data);
            }
          }}
          onClose={() => { setShowEventForm(false); setEditingEvent(null); setSelectedRange(null); }}
          isSubmitting={createEventMutation.isPending || updateEventMutation.isPending}
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
    </div>
  );
}

function MonthView({ currentDate, getEventsForDay, onDayClick, onEventClick, eventColor }: {
  currentDate: Date;
  getEventsForDay: (d: Date) => CalendarEvent[];
  onDayClick: (d: Date) => void;
  onEventClick: (ev: CalendarEvent) => void;
  eventColor: (ev: CalendarEvent) => string;
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
                  onClick={(e) => { e.stopPropagation(); onEventClick(event); }}
                  className="w-full text-left text-[10px] px-1 py-0.5 rounded mb-0.5 truncate transition-opacity hover:opacity-80"
                  style={{ backgroundColor: `${eventColor(event)}20`, color: eventColor(event), borderLeft: `2px solid ${eventColor(event)}` }}
                >
                  {event.all_day ? '' : format(parseISO(event.start_date), 'HH:mm') + ' '}
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

function WeekView({ currentDate, workWeek, timeScale, events, onSlotClick, onEventClick, eventColor }: {
  currentDate: Date;
  workWeek: boolean;
  timeScale: number;
  events: CalendarEvent[];
  onSlotClick: (d: Date) => void;
  onEventClick: (ev: CalendarEvent) => void;
  eventColor: (ev: CalendarEvent) => string;
}) {
  const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
  const weekDays = workWeek ? [0, 1, 2, 3, 4] : [0, 1, 2, 3, 4, 5, 6];
  const days = weekDays.map(i => addDays(weekStart, i));
  return (
    <TimeGridView days={days} timeScale={timeScale} events={events} onSlotClick={onSlotClick} onEventClick={onEventClick} eventColor={eventColor} />
  );
}

function DayView({ currentDate, dayCount, timeScale, events, onSlotClick, onEventClick, eventColor }: {
  currentDate: Date;
  dayCount: number;
  timeScale: number;
  events: CalendarEvent[];
  onSlotClick: (d: Date) => void;
  onEventClick: (ev: CalendarEvent) => void;
  eventColor: (ev: CalendarEvent) => string;
}) {
  const days = Array.from({ length: dayCount }, (_, i) => addDays(startOfDay(currentDate), i));
  return (
    <TimeGridView days={days} timeScale={timeScale} events={events} onSlotClick={onSlotClick} onEventClick={onEventClick} eventColor={eventColor} />
  );
}

function TimeGridView({ days, timeScale, events, onSlotClick, onEventClick, eventColor }: {
  days: Date[];
  timeScale: number;
  events: CalendarEvent[];
  onSlotClick: (d: Date) => void;
  onEventClick: (ev: CalendarEvent) => void;
  eventColor: (ev: CalendarEvent) => string;
}) {
  const HOUR_HEIGHT = 48;
  const slotsPerHour = Math.max(1, Math.round(60 / timeScale));
  const slotHeight = HOUR_HEIGHT / slotsPerHour;

  const getEventsForDay = (day: Date) => events.filter((ev) => {
    const s = parseISO(ev.start_date);
    return isSameDay(s, day);
  });

  const renderEvent = (ev: CalendarEvent) => {
    const s = parseISO(ev.start_date);
    const e = parseISO(ev.end_date);
    const startMinutes = s.getHours() * 60 + s.getMinutes();
    const duration = Math.max(15, differenceInMinutes(e, s));
    const top = (startMinutes / 60) * HOUR_HEIGHT;
    const height = (duration / 60) * HOUR_HEIGHT;
    return (
      <button
        key={ev.id}
        onClick={(clickEvt) => { clickEvt.stopPropagation(); onEventClick(ev); }}
        className="absolute left-0.5 right-0.5 rounded px-1.5 py-0.5 text-[11px] text-left truncate hover:opacity-90 transition-opacity shadow-sm"
        style={{ top, height, backgroundColor: `${eventColor(ev)}20`, color: eventColor(ev), borderLeft: `3px solid ${eventColor(ev)}` }}
        title={ev.title}
      >
        <div className="font-medium truncate">{ev.title}</div>
        <div className="text-[10px] opacity-80 truncate">
          {format(s, 'HH:mm')}–{format(e, 'HH:mm')}{ev.location ? ` · ${ev.location}` : ''}
        </div>
      </button>
    );
  };

  return (
    <div className="h-full flex flex-col">
      <div className="grid border-b border-outlook-border bg-outlook-bg-primary flex-shrink-0" style={{ gridTemplateColumns: `48px repeat(${days.length}, minmax(0, 1fr))` }}>
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
      <div className="flex-1 overflow-auto">
        <div className="grid" style={{ gridTemplateColumns: `48px repeat(${days.length}, minmax(0, 1fr))` }}>
          <div>
            {Array.from({ length: 24 }).map((_, h) => (
              <div key={h} style={{ height: HOUR_HEIGHT }} className="text-[10px] text-outlook-text-disabled text-right pr-1 border-b border-outlook-border">
                {h === 0 ? '' : `${h}`}
              </div>
            ))}
          </div>
          {days.map(day => {
            const dayEvents = getEventsForDay(day);
            return (
              <div key={day.toISOString()} className="relative border-l border-outlook-border">
                {Array.from({ length: 24 * slotsPerHour }).map((_, idx) => {
                  const h = Math.floor(idx / slotsPerHour);
                  const m = (idx % slotsPerHour) * timeScale;
                  const slotDate = setMinutes(setHours(day, h), m);
                  const isHour = m === 0;
                  return (
                    <div
                      key={idx}
                      onClick={() => onSlotClick(slotDate)}
                      style={{ height: slotHeight }}
                      className={`hover:bg-outlook-bg-hover/40 cursor-pointer ${isHour ? 'border-b border-outlook-border' : 'border-b border-outlook-border/30'}`}
                    />
                  );
                })}
                <div className="absolute inset-0 pointer-events-none">
                  <div className="relative w-full h-full">
                    {dayEvents.map(ev => (
                      <div key={ev.id} className="pointer-events-auto">
                        {renderEvent(ev)}
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

function EventForm({ calendars, initialDate, editingEvent, onSubmit, onClose, isSubmitting }: {
  calendars: Calendar[];
  initialDate: Date;
  editingEvent: CalendarEvent | null;
  onSubmit: (data: any) => void;
  onClose: () => void;
  isSubmitting: boolean;
}) {
  const seedStart = editingEvent ? parseISO(editingEvent.start_date) : initialDate;
  const seedEnd = editingEvent ? parseISO(editingEvent.end_date) : initialDate;

  const [title, setTitle] = useState(editingEvent?.title || '');
  const [calendarId, setCalendarId] = useState(editingEvent?.calendar_id || calendars.find((c: Calendar) => c.is_default)?.id || calendars[0]?.id || '');
  const [startDate, setStartDate] = useState(format(seedStart, "yyyy-MM-dd'T'HH:mm"));
  const [endDate, setEndDate] = useState(format(seedEnd, "yyyy-MM-dd'T'HH:mm"));
  const [allDay, setAllDay] = useState(!!editingEvent?.all_day);
  const [location, setLocation] = useState(editingEvent?.location || '');
  const [description, setDescription] = useState(editingEvent?.description || '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      calendarId,
      title,
      startDate: allDay ? format(parseISO(startDate), 'yyyy-MM-dd') + 'T00:00:00' : startDate,
      endDate: allDay ? format(parseISO(endDate || startDate), 'yyyy-MM-dd') + 'T23:59:59' : endDate,
      allDay,
      location,
      description,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-[480px] p-6" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">{editingEvent ? "Modifier l'événement" : 'Nouvel événement'}</h2>
          <button onClick={onClose} className="text-outlook-text-disabled hover:text-outlook-text-primary">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Titre de l'événement"
            required
            className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-outlook-blue"
          />
          {calendars.length > 1 && (
            <select value={calendarId} onChange={(e) => setCalendarId(e.target.value)} className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm">
              {calendars.map((c: Calendar) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="rounded" />
            Toute la journée
          </label>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-outlook-text-secondary">Début</label>
              <input
                type={allDay ? 'date' : 'datetime-local'}
                value={allDay ? startDate.split('T')[0] : startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-outlook-text-secondary">Fin</label>
              <input
                type={allDay ? 'date' : 'datetime-local'}
                value={allDay ? (endDate?.split('T')[0] || startDate.split('T')[0]) : endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm"
              />
            </div>
          </div>
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Lieu"
            className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description"
            rows={3}
            className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm resize-none"
          />
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-md hover:bg-outlook-bg-hover">
              Annuler
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !title}
              className="bg-outlook-blue hover:bg-outlook-blue-hover text-white px-4 py-2 text-sm rounded-md disabled:opacity-50"
            >
              {isSubmitting ? 'Enregistrement...' : editingEvent ? 'Enregistrer' : 'Créer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function NewCalendarForm({ onCreate, onClose, isSubmitting }: {
  onCreate: (data: { name: string; color: string }) => void;
  onClose: () => void;
  isSubmitting: boolean;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#0078D4');
  const palette = ['#0078D4', '#107C10', '#B4009E', '#E3008C', '#E74856', '#CA5010', '#FFB900', '#5C2E91'];

  return (
    <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-96 p-6" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">Nouveau calendrier</h2>
          <button onClick={onClose} className="text-outlook-text-disabled hover:text-outlook-text-primary">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) onCreate({ name: name.trim(), color }); }} className="space-y-3">
          <input
            autoFocus
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nom du calendrier"
            required
            className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-outlook-blue"
          />
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