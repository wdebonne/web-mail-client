import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { CalendarEvent, Calendar } from '../types';
import {
  ChevronLeft, ChevronRight, Plus, X, Clock, MapPin, Users
} from 'lucide-react';
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, isSameMonth, isSameDay, isToday, addMonths,
  subMonths, parseISO, addDays
} from 'date-fns';
import { fr } from 'date-fns/locale';
import toast from 'react-hot-toast';

export default function CalendarPage() {
  const queryClient = useQueryClient();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<'month' | 'week' | 'day'>('month');
  const [showEventForm, setShowEventForm] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  const start = format(startOfMonth(subMonths(currentDate, 1)), 'yyyy-MM-dd');
  const end = format(endOfMonth(addMonths(currentDate, 1)), 'yyyy-MM-dd');

  const { data: calendars = [] } = useQuery({
    queryKey: ['calendars'],
    queryFn: api.getCalendars,
  });

  const { data: events = [] } = useQuery({
    queryKey: ['events', start, end],
    queryFn: () => api.getEvents(start, end),
  });

  const createMutation = useMutation({
    mutationFn: api.createEvent,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events'] });
      setShowEventForm(false);
      toast.success('Événement créé');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteEvent(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events'] });
      setSelectedEvent(null);
      toast.success('Événement supprimé');
    },
  });

  // Month view grid
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const calStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: calStart, end: calEnd });

  const getEventsForDay = (day: Date) => {
    return events.filter((event: CalendarEvent) => {
      const eventStart = parseISO(event.start_date);
      const eventEnd = parseISO(event.end_date);
      return isSameDay(eventStart, day) || (day >= eventStart && day <= eventEnd);
    });
  };

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-outlook-border bg-outlook-bg-primary flex-shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowEventForm(true)}
            className="bg-outlook-blue hover:bg-outlook-blue-hover text-white rounded-md px-3 py-1.5 text-sm font-medium flex items-center gap-1.5"
          >
            <Plus size={14} /> Nouvel événement
          </button>

          <div className="flex items-center gap-1 ml-4">
            <button onClick={() => setCurrentDate(subMonths(currentDate, 1))} className="p-1 hover:bg-outlook-bg-hover rounded">
              <ChevronLeft size={18} />
            </button>
            <span className="text-sm font-semibold w-40 text-center capitalize">
              {format(currentDate, 'MMMM yyyy', { locale: fr })}
            </span>
            <button onClick={() => setCurrentDate(addMonths(currentDate, 1))} className="p-1 hover:bg-outlook-bg-hover rounded">
              <ChevronRight size={18} />
            </button>
          </div>

          <button
            onClick={() => setCurrentDate(new Date())}
            className="text-sm text-outlook-blue hover:bg-outlook-bg-hover px-2 py-1 rounded"
          >
            Aujourd'hui
          </button>
        </div>

        <div className="flex items-center bg-outlook-bg-primary border border-outlook-border rounded-md overflow-hidden">
          {(['month', 'week', 'day'] as const).map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1 text-xs ${view === v ? 'bg-outlook-blue text-white' : 'hover:bg-outlook-bg-hover'}`}
            >
              {v === 'month' ? 'Mois' : v === 'week' ? 'Semaine' : 'Jour'}
            </button>
          ))}
        </div>
      </div>

      {/* Calendar grid */}
      <div className="flex-1 overflow-auto">
        {/* Day headers */}
        <div className="grid grid-cols-7 border-b border-outlook-border bg-outlook-bg-primary">
          {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map(day => (
            <div key={day} className="text-xs font-medium text-outlook-text-secondary text-center py-2 border-r border-outlook-border last:border-r-0">
              {day}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7 flex-1" style={{ gridAutoRows: 'minmax(100px, 1fr)' }}>
          {days.map((day) => {
            const dayEvents = getEventsForDay(day);
            const isCurrentMonth = isSameMonth(day, currentDate);
            const isCurrentDay = isToday(day);

            return (
              <div
                key={day.toISOString()}
                onClick={() => { setSelectedDate(day); setShowEventForm(true); }}
                className={`border-r border-b border-outlook-border p-1 cursor-pointer hover:bg-outlook-bg-hover/50 transition-colors
                  ${!isCurrentMonth ? 'bg-outlook-bg-primary/50' : 'bg-white'}`}
              >
                <div className={`text-xs font-medium mb-0.5 w-6 h-6 flex items-center justify-center rounded-full
                  ${isCurrentDay ? 'bg-outlook-blue text-white' : isCurrentMonth ? 'text-outlook-text-primary' : 'text-outlook-text-disabled'}`}>
                  {format(day, 'd')}
                </div>
                {dayEvents.slice(0, 3).map((event: CalendarEvent) => (
                  <button
                    key={event.id}
                    onClick={(e) => { e.stopPropagation(); setSelectedEvent(event); }}
                    className="w-full text-left text-2xs px-1 py-0.5 rounded mb-0.5 truncate transition-opacity hover:opacity-80"
                    style={{
                      backgroundColor: event.calendar_color ? `${event.calendar_color}20` : '#0078D420',
                      color: event.calendar_color || '#0078D4',
                      borderLeft: `2px solid ${event.calendar_color || '#0078D4'}`,
                    }}
                  >
                    {event.all_day ? '' : format(parseISO(event.start_date), 'HH:mm') + ' '}
                    {event.title}
                  </button>
                ))}
                {dayEvents.length > 3 && (
                  <div className="text-2xs text-outlook-text-disabled px-1">
                    +{dayEvents.length - 3} de plus
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Event detail popover */}
      {selectedEvent && (
        <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50" onClick={() => setSelectedEvent(null)}>
          <div className="bg-white rounded-lg shadow-xl w-96 p-4" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-3">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded" style={{ backgroundColor: selectedEvent.calendar_color || '#0078D4' }} />
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
                  <span>{format(parseISO(selectedEvent.start_date), 'EEEE d MMMM yyyy HH:mm', { locale: fr })} - {format(parseISO(selectedEvent.end_date), 'HH:mm', { locale: fr })}</span>
                )}
              </div>
              {selectedEvent.location && (
                <div className="flex items-center gap-2 text-outlook-text-secondary">
                  <MapPin size={14} /> {selectedEvent.location}
                </div>
              )}
              {selectedEvent.description && (
                <p className="text-outlook-text-secondary mt-2">{selectedEvent.description}</p>
              )}
              {selectedEvent.attendees && selectedEvent.attendees.length > 0 && (
                <div className="flex items-start gap-2 text-outlook-text-secondary">
                  <Users size={14} className="mt-0.5" />
                  <div>{selectedEvent.attendees.map(a => a.name || a.email).join(', ')}</div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => deleteMutation.mutate(selectedEvent.id)}
                className="text-outlook-danger hover:bg-red-50 px-3 py-1.5 rounded text-sm"
              >
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Event creation form */}
      {showEventForm && (
        <EventForm
          calendars={calendars}
          initialDate={selectedDate}
          onSubmit={(data) => createMutation.mutate(data)}
          onClose={() => { setShowEventForm(false); setSelectedDate(null); }}
          isSubmitting={createMutation.isPending}
        />
      )}
    </div>
  );
}

function EventForm({
  calendars, initialDate, onSubmit, onClose, isSubmitting,
}: {
  calendars: Calendar[];
  initialDate: Date | null;
  onSubmit: (data: any) => void;
  onClose: () => void;
  isSubmitting: boolean;
}) {
  const date = initialDate || new Date();
  const [title, setTitle] = useState('');
  const [calendarId, setCalendarId] = useState(calendars.find(c => c.is_default)?.id || calendars[0]?.id || '');
  const [startDate, setStartDate] = useState(format(date, "yyyy-MM-dd'T'HH:mm"));
  const [endDate, setEndDate] = useState(format(addDays(date, 0), "yyyy-MM-dd'T'" + format(addDays(date, 0), 'HH') + ':' + '00'));
  const [allDay, setAllDay] = useState(false);
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');

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
          <h2 className="text-lg font-semibold">Nouvel événement</h2>
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
            <select
              value={calendarId}
              onChange={(e) => setCalendarId(e.target.value)}
              className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm"
            >
              {calendars.map(c => (
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
              {isSubmitting ? 'Création...' : 'Créer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
