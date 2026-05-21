import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronDown } from 'lucide-react';
import {
  format, startOfWeek, endOfWeek, addDays, startOfDay,
  startOfMonth, endOfMonth, eachDayOfInterval, parseISO,
  isSameDay, getHours, getMinutes, isToday,
} from 'date-fns';
import { fr } from 'date-fns/locale';
import { CalendarEvent, Calendar } from '../../types';
import { CalendarViewMode } from './CalendarRibbon';

type PrintView = 'day' | 'week' | 'workweek' | 'month';

const VIEW_OPTIONS: { value: PrintView; label: string }[] = [
  { value: 'day', label: 'Jour' },
  { value: 'week', label: 'Semaine' },
  { value: 'workweek', label: 'Semaine de travail' },
  { value: 'month', label: 'Mois' },
];

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => {
  const label = `${String(i).padStart(2, '0')}:00`;
  return { value: label, label };
});

function timeToMins(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

function endMinsFromTime(t: string): number {
  return t === '00:00' ? 1440 : timeToMins(t);
}

// ---------------------------------------------------------------------------

export interface PrintCalendarModalProps {
  calendars: Calendar[];
  visibleCalendarIds: Set<string>;
  events: CalendarEvent[];
  currentDate: Date;
  currentView: CalendarViewMode;
  colorOverrides: Record<string, string>;
  onClose: () => void;
}

export default function PrintCalendarModal({
  calendars, visibleCalendarIds, events, currentDate, currentView,
  colorOverrides, onClose,
}: PrintCalendarModalProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(visibleCalendarIds));
  const [calDropOpen, setCalDropOpen] = useState(false);

  const initPrintView: PrintView = currentView === 'agenda' ? 'week' : currentView as PrintView;
  const [printView, setPrintView] = useState<PrintView>(initPrintView);
  const [viewDropOpen, setViewDropOpen] = useState(false);

  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('00:00');
  const [showMiniMonth, setShowMiniMonth] = useState(false);
  const [detailedAgenda, setDetailedAgenda] = useState(false);

  const { printStart, printEnd } = useMemo(() => {
    if (printView === 'month') {
      return { printStart: startOfMonth(currentDate), printEnd: endOfMonth(currentDate) };
    } else if (printView === 'week') {
      const s = startOfWeek(currentDate, { weekStartsOn: 1 });
      return { printStart: s, printEnd: endOfWeek(currentDate, { weekStartsOn: 1 }) };
    } else if (printView === 'workweek') {
      const s = startOfWeek(currentDate, { weekStartsOn: 1 });
      return { printStart: s, printEnd: addDays(s, 4) };
    } else {
      const d = startOfDay(currentDate);
      return { printStart: d, printEnd: d };
    }
  }, [printView, currentDate]);

  const periodLabel = useMemo(() => {
    if (printView === 'month') return format(currentDate, 'MMMM yyyy', { locale: fr });
    if (printView === 'day') return format(currentDate, 'EEEE d MMMM yyyy', { locale: fr });
    return `${format(printStart, 'yyyy-MM-dd')} à ${format(printEnd, 'yyyy-MM-dd')}`;
  }, [printView, currentDate, printStart, printEnd]);

  const printEvents = useMemo(() => events.filter(ev => {
    if (!selectedIds.has(ev.calendar_id)) return false;
    const s = parseISO(ev.start_date);
    const e = parseISO(ev.end_date);
    return s <= printEnd && e >= printStart;
  }), [events, selectedIds, printStart, printEnd]);

  const getEventColor = (ev: CalendarEvent) => {
    const cal = calendars.find(c => c.id === ev.calendar_id);
    return colorOverrides[ev.calendar_id] || cal?.color || '#0078D4';
  };

  const selectedCalendars = useMemo(
    () => calendars.filter(c => selectedIds.has(c.id)),
    [calendars, selectedIds],
  );

  const calLabel =
    selectedIds.size === 0 ? 'Aucun calendrier'
    : selectedIds.size === calendars.length ? 'Calendriers sélectionnés'
    : selectedIds.size === 1 ? (selectedCalendars[0]?.name || '1 calendrier')
    : `${selectedIds.size} calendriers`;

  // ---- Print to new window ------------------------------------------------
  const handlePrint = () => {
    const win = window.open('', '_blank');
    if (!win) return;

    const sMins = timeToMins(startTime);
    const eMins = endMinsFromTime(endTime);
    const safeMins = eMins > sMins ? eMins : 1440;
    const days = eachDayOfInterval({ start: printStart, end: printEnd });
    const HOUR_H = 52;
    const LABEL_W = 48;
    const colW = Math.floor((740 - LABEL_W) / days.length);
    const totalH = ((safeMins - sMins) / 60) * HOUR_H;

    const calNamesHtml = selectedCalendars
      .map(c => `<span style="color:${colorOverrides[c.id] || c.color || '#0078D4'};margin-right:8px">${c.name}</span>`)
      .join('');

    let body = '';

    if (printView === 'month') {
      const gridStart = startOfWeek(printStart, { weekStartsOn: 1 });
      const gridEnd = endOfWeek(printEnd, { weekStartsOn: 1 });
      const allDays = eachDayOfInterval({ start: gridStart, end: gridEnd });
      const dayNames = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
      const weeks: Date[][] = [];
      for (let i = 0; i < allDays.length; i += 7) weeks.push(allDays.slice(i, i + 7));

      const headers = dayNames.map(d =>
        `<th style="border:1px solid #ddd;padding:4px;font-size:11px;background:#f3f4f6;text-align:center">${d}</th>`
      ).join('');

      const rows = weeks.map(week => {
        const cells = week.map(day => {
          const dayEvs = printEvents.filter(ev => isSameDay(parseISO(ev.start_date), day));
          const inMonth = day >= printStart && day <= printEnd;
          const evHtml = dayEvs.slice(0, 3).map(ev => {
            const color = getEventColor(ev);
            return `<div style="background:${color}22;border-left:2px solid ${color};padding:1px 3px;font-size:8px;margin:1px 0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${ev.title}</div>`;
          }).join('') + (dayEvs.length > 3 ? `<div style="font-size:8px;color:#6b7280">+${dayEvs.length - 3} autres</div>` : '');
          return `<td style="border:1px solid #ddd;padding:3px;vertical-align:top;height:70px;${!inMonth ? 'background:#f9fafb;color:#9ca3af' : ''}">
            <div style="font-size:10px;font-weight:${isToday(day) ? 'bold' : 'normal'};color:${isToday(day) ? '#0078D4' : 'inherit'}">${format(day, 'd')}</div>
            ${evHtml}
          </td>`;
        }).join('');
        return `<tr>${cells}</tr>`;
      }).join('');

      body = `<table style="width:100%;border-collapse:collapse"><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
    } else {
      const hourLines: string[] = [];
      for (let m = sMins; m < safeMins; m += 60) {
        const top = ((m - sMins) / 60) * HOUR_H;
        const h = Math.floor(m / 60);
        hourLines.push(`<div style="position:absolute;top:${top}px;left:0;width:${LABEL_W - 4}px;text-align:right;font-size:9px;color:#6b7280">${String(h).padStart(2, '0')}:00</div>`);
        hourLines.push(`<div style="position:absolute;top:${top}px;left:${LABEL_W - 1}px;right:0;border-top:1px solid #e5e7eb"></div>`);
      }

      const dayHeaders = days.map((day, i) => {
        const left = LABEL_W + i * colW;
        const today = isToday(day) ? 'font-weight:bold;color:#0078D4' : '';
        return `<div style="position:absolute;left:${left}px;width:${colW}px;text-align:center;font-size:10px;${today}">${format(day, 'EEE', { locale: fr })} <strong>${format(day, 'd')}</strong></div>`;
      }).join('');

      const dayEventsHtml = days.map((day, i) => {
        const left = LABEL_W + i * colW;
        const dayEvs = printEvents.filter(ev => !ev.all_day && isSameDay(parseISO(ev.start_date), day));
        const evHtml = dayEvs.map(ev => {
          const s = parseISO(ev.start_date);
          const e = parseISO(ev.end_date);
          const evS = getHours(s) * 60 + getMinutes(s);
          const evE = getHours(e) * 60 + getMinutes(e);
          if (evS >= safeMins || evE <= sMins) return '';
          const top = Math.max(0, ((evS - sMins) / 60)) * HOUR_H;
          const height = Math.max(16, ((Math.min(evE, safeMins) - Math.max(evS, sMins)) / 60) * HOUR_H);
          const color = getEventColor(ev);
          return `<div style="position:absolute;top:${top}px;left:2px;right:2px;height:${height - 2}px;background:${color}30;border-left:3px solid ${color};padding:2px 4px;font-size:8px;overflow:hidden;line-height:1.3;border-radius:2px">${ev.title}</div>`;
        }).join('');
        return `<div style="position:absolute;left:${left}px;width:${colW}px;top:0;height:${totalH}px;border-right:1px solid #e5e7eb">${evHtml}</div>`;
      }).join('');

      body = `
        <div style="position:relative;height:28px;border-bottom:2px solid #e5e7eb;">${dayHeaders}</div>
        <div style="position:relative;height:${totalH}px;overflow:hidden">${hourLines.join('')}${dayEventsHtml}</div>
      `;
    }

    win.document.write(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
      <title>Calendrier – ${periodLabel}</title>
      <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Segoe UI',Arial,sans-serif;padding:16px}@page{size:A4 landscape;margin:12mm}</style>
    </head><body>
      <div style="margin-bottom:10px">
        <div style="font-size:13px;font-weight:600">${periodLabel}</div>
        <div style="font-size:10px;margin-top:3px">${calNamesHtml}</div>
      </div>
      ${body}
    </body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 400);
  };

  // ---- Render ---------------------------------------------------------------
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="bg-white rounded-lg shadow-2xl flex overflow-hidden"
        style={{ width: 900, maxWidth: '95vw', maxHeight: '90vh' }}
      >
        {/* ---- Left: controls ---- */}
        <div className="w-[270px] flex-shrink-0 border-r border-gray-200 flex flex-col p-5 gap-4 overflow-y-auto">
          <h2 className="text-base font-semibold text-gray-900">Imprimer</h2>

          <FieldGroup label="Calendrier">
            <DropButton
              label={calLabel}
              open={calDropOpen}
              onToggle={() => { setCalDropOpen(v => !v); setViewDropOpen(false); }}
            >
              {calendars.map(cal => (
                <label key={cal.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer">
                  <input
                    type="checkbox"
                    className="w-3.5 h-3.5 accent-outlook-blue"
                    checked={selectedIds.has(cal.id)}
                    onChange={e => {
                      setSelectedIds(prev => {
                        const next = new Set(prev);
                        e.target.checked ? next.add(cal.id) : next.delete(cal.id);
                        return next;
                      });
                    }}
                  />
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ background: colorOverrides[cal.id] || cal.color || '#0078D4' }}
                  />
                  <span className="text-sm truncate">{cal.name}</span>
                </label>
              ))}
            </DropButton>
          </FieldGroup>

          <FieldGroup label="Afficher">
            <DropButton
              label={VIEW_OPTIONS.find(v => v.value === printView)?.label ?? ''}
              open={viewDropOpen}
              onToggle={() => { setViewDropOpen(v => !v); setCalDropOpen(false); }}
            >
              {VIEW_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => { setPrintView(opt.value); setViewDropOpen(false); }}
                  className={`w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 ${printView === opt.value ? 'bg-blue-50 text-outlook-blue font-medium' : ''}`}
                >
                  {opt.label}
                </button>
              ))}
            </DropButton>
          </FieldGroup>

          <FieldGroup label="Disposition">
            <button
              disabled
              className="w-full flex items-center justify-between px-3 py-2 border border-gray-300 rounded bg-white text-sm text-gray-500 cursor-default"
            >
              <span>Standard</span>
              <ChevronDown size={13} className="opacity-50" />
            </button>
          </FieldGroup>

          <FieldGroup label="Intervalle de temps">
            <div className="flex items-center gap-2">
              <TimeSelect value={startTime} onChange={setStartTime} />
              <span className="text-sm text-gray-500 flex-shrink-0">à</span>
              <TimeSelect value={endTime} onChange={setEndTime} />
            </div>
          </FieldGroup>

          <div className="space-y-2">
            <CheckRow label="Afficher le mini-mois" checked={showMiniMonth} onChange={setShowMiniMonth} />
            <CheckRow label="Imprimer l'agenda détaillé" checked={detailedAgenda} onChange={setDetailedAgenda} />
          </div>

          <div className="flex-1" />

          <div className="flex flex-col gap-2 pt-2 border-t border-gray-100">
            <button
              onClick={handlePrint}
              className="w-full py-2 bg-outlook-blue text-white rounded text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              Imprimer
            </button>
            <button
              onClick={onClose}
              className="w-full py-2 border border-gray-300 rounded text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              Annuler
            </button>
          </div>
        </div>

        {/* ---- Right: preview ---- */}
        <div className="flex-1 bg-gray-100 overflow-auto relative p-5 flex flex-col items-center">
          <button
            onClick={onClose}
            className="absolute top-3 right-3 p-1.5 hover:bg-gray-200 rounded text-gray-500"
          >
            <X size={16} />
          </button>
          <CalendarPrintPreview
            printView={printView}
            printStart={printStart}
            printEnd={printEnd}
            periodLabel={periodLabel}
            events={printEvents}
            selectedCalendars={selectedCalendars}
            colorOverrides={colorOverrides}
            startTime={startTime}
            endTime={endTime}
            getEventColor={getEventColor}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Small shared UI helpers

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-sm font-medium text-gray-700">{label}</div>
      {children}
    </div>
  );
}

function DropButton({
  label, open, onToggle, children,
}: {
  label: string; open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2 border border-gray-300 rounded bg-white text-sm hover:bg-gray-50 text-left"
      >
        <span className="truncate">{label}</span>
        <ChevronDown size={13} className="flex-shrink-0 ml-1 text-gray-500" />
      </button>
      {open && (
        <div className="absolute z-20 top-full left-0 right-0 mt-0.5 bg-white border border-gray-200 rounded shadow-lg py-1 max-h-52 overflow-y-auto">
          {children}
        </div>
      )}
    </div>
  );
}

function TimeSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative flex-1">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full appearance-none px-2 py-1.5 pr-6 border border-gray-300 rounded bg-white text-sm"
      >
        {HOUR_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500" />
    </div>
  );
}

function CheckRow({
  label, checked, onChange,
}: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        className="w-3.5 h-3.5 accent-outlook-blue"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
      />
      <span className="text-sm text-gray-700">{label}</span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Print preview

interface PreviewProps {
  printView: PrintView;
  printStart: Date;
  printEnd: Date;
  periodLabel: string;
  events: CalendarEvent[];
  selectedCalendars: Calendar[];
  colorOverrides: Record<string, string>;
  startTime: string;
  endTime: string;
  getEventColor: (ev: CalendarEvent) => string;
}

function CalendarPrintPreview({
  printView, printStart, printEnd, periodLabel,
  events, selectedCalendars, colorOverrides,
  startTime, endTime, getEventColor,
}: PreviewProps) {
  const days = useMemo(
    () => eachDayOfInterval({ start: printStart, end: printEnd }),
    [printStart, printEnd],
  );
  const sMins = timeToMins(startTime);
  const eMins = endMinsFromTime(endTime);
  const safeMins = eMins > sMins ? eMins : 1440;

  const HOUR_H = 22;
  const LABEL_W = 28;
  const colW = printView === 'month' ? 0 : Math.max(1, Math.floor((460 - LABEL_W) / days.length));
  const totalH = ((safeMins - sMins) / 60) * HOUR_H;

  return (
    <div className="bg-white shadow-md rounded" style={{ width: 490, minWidth: 490 }}>
      <div className="px-3 py-2 border-b border-gray-200">
        <div className="font-semibold text-blue-600" style={{ fontSize: 11 }}>{periodLabel}</div>
        <div className="flex flex-wrap gap-x-2 mt-1" style={{ fontSize: 9 }}>
          {selectedCalendars.map(cal => (
            <span key={cal.id} style={{ color: colorOverrides[cal.id] || cal.color || '#0078D4' }}>
              {cal.name}
            </span>
          ))}
        </div>
      </div>

      <div className="px-2 pb-2 pt-1" style={{ fontSize: 9 }}>
        {printView === 'month' ? (
          <MonthGrid events={events} monthStart={printStart} getEventColor={getEventColor} />
        ) : (
          <TimeGrid
            days={days}
            events={events}
            sMins={sMins}
            safeMins={safeMins}
            hourH={HOUR_H}
            labelW={LABEL_W}
            colW={colW}
            totalH={totalH}
            getEventColor={getEventColor}
          />
        )}
      </div>
    </div>
  );
}

function TimeGrid({
  days, events, sMins, safeMins, hourH, labelW, colW, totalH, getEventColor,
}: {
  days: Date[]; events: CalendarEvent[];
  sMins: number; safeMins: number;
  hourH: number; labelW: number; colW: number; totalH: number;
  getEventColor: (ev: CalendarEvent) => string;
}) {
  const hours = useMemo(() => {
    const res: number[] = [];
    for (let m = sMins; m < safeMins; m += 60) res.push(m);
    return res;
  }, [sMins, safeMins]);

  return (
    <div style={{ fontSize: 8 }}>
      {/* Day header row */}
      <div className="flex border-b border-gray-200 mb-0.5" style={{ paddingLeft: labelW }}>
        {days.map(day => (
          <div key={day.toISOString()} style={{ width: colW, flexShrink: 0, textAlign: 'center' }}>
            <span className={isToday(day) ? 'font-bold text-blue-600' : ''}>
              {format(day, 'EEE', { locale: fr })} {format(day, 'd')}
            </span>
          </div>
        ))}
      </div>

      {/* Grid body */}
      <div className="relative" style={{ height: totalH }}>
        {hours.map((m, i) => {
          const top = i * hourH;
          return (
            <div key={m} style={{ position: 'absolute', top, left: 0, right: 0 }}>
              <div style={{ position: 'absolute', left: 0, width: labelW - 2, textAlign: 'right', color: '#9ca3af', fontSize: 7, top: 1 }}>
                {String(Math.floor(m / 60)).padStart(2, '0')}
              </div>
              <div style={{ position: 'absolute', left: labelW, right: 0, borderTop: '1px solid #e5e7eb' }} />
            </div>
          );
        })}

        {days.map((day, di) => {
          const dayEvs = events.filter(ev => !ev.all_day && isSameDay(parseISO(ev.start_date), day));
          return (
            <div
              key={day.toISOString()}
              style={{
                position: 'absolute',
                left: labelW + di * colW,
                width: colW,
                top: 0,
                height: totalH,
                borderRight: '1px solid #e5e7eb',
              }}
            >
              {dayEvs.map(ev => {
                const s = parseISO(ev.start_date);
                const e = parseISO(ev.end_date);
                const evS = getHours(s) * 60 + getMinutes(s);
                const evE = getHours(e) * 60 + getMinutes(e);
                if (evS >= safeMins || evE <= sMins) return null;
                const top = Math.max(0, (evS - sMins) / 60) * hourH;
                const height = Math.max(10, ((Math.min(evE, safeMins) - Math.max(evS, sMins)) / 60) * hourH - 1);
                const color = getEventColor(ev);
                return (
                  <div
                    key={ev.id}
                    style={{
                      position: 'absolute', top, left: 1, right: 1, height,
                      background: color + '33',
                      borderLeft: `2px solid ${color}`,
                      padding: '1px 2px',
                      overflow: 'hidden',
                      borderRadius: 2,
                      lineHeight: 1.2,
                      fontSize: 7,
                    }}
                  >
                    {ev.title}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MonthGrid({
  events, monthStart, getEventColor,
}: {
  events: CalendarEvent[];
  monthStart: Date;
  getEventColor: (ev: CalendarEvent) => string;
}) {
  const monthEnd = endOfMonth(monthStart);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  const DAY_NAMES = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

  return (
    <div style={{ fontSize: 8 }}>
      <div className="grid grid-cols-7">
        {DAY_NAMES.map((d, i) => (
          <div key={i} className="text-center font-medium text-gray-500 py-0.5">{d}</div>
        ))}
      </div>
      {weeks.map((week, wi) => (
        <div key={wi} className="grid grid-cols-7 border-t border-gray-100">
          {week.map(day => {
            const dayEvs = events.filter(ev => isSameDay(parseISO(ev.start_date), day));
            const inMonth = day >= monthStart && day <= monthEnd;
            return (
              <div
                key={day.toISOString()}
                className="border-r border-gray-100 py-0.5 px-0.5"
                style={{ minHeight: 42, opacity: inMonth ? 1 : 0.4 }}
              >
                <div
                  className={`text-center ${isToday(day) ? 'text-blue-600 font-bold' : ''}`}
                  style={{ fontSize: 8 }}
                >
                  {format(day, 'd')}
                </div>
                {dayEvs.slice(0, 2).map(ev => {
                  const color = getEventColor(ev);
                  return (
                    <div
                      key={ev.id}
                      style={{
                        background: color + '30',
                        borderLeft: `2px solid ${color}`,
                        padding: '1px 2px',
                        marginBottom: 1,
                        fontSize: 7,
                        overflow: 'hidden',
                        whiteSpace: 'nowrap',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {ev.title}
                    </div>
                  );
                })}
                {dayEvs.length > 2 && (
                  <div style={{ fontSize: 7, color: '#6b7280' }}>+{dayEvs.length - 2}</div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
