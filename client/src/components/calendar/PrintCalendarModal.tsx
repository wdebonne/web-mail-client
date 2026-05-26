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
type Orientation = 'portrait' | 'landscape';

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

// Outlook-style lane layout for overlapping events (mirrors CalendarPage layoutDay)
type PrintLaid = { evIdx: number; col: number; cols: number; span: number };
function layoutPrintDay(evs: Array<{ start: number; end: number }>): PrintLaid[] {
  const items = evs
    .map((ev, i) => ({ ...ev, idx: i }))
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const clusters: typeof items[] = [];
  let cur: typeof items = [];
  let curEnd = -Infinity;
  for (const it of items) {
    if (it.start < curEnd) {
      cur.push(it);
      curEnd = Math.max(curEnd, it.end);
    } else {
      if (cur.length) clusters.push(cur);
      cur = [it];
      curEnd = it.end;
    }
  }
  if (cur.length) clusters.push(cur);
  const out: PrintLaid[] = [];
  for (const cluster of clusters) {
    const lanes: number[] = [];
    const assigned: { it: typeof cluster[number]; col: number }[] = [];
    for (const it of cluster) {
      let col = lanes.findIndex(end => end <= it.start);
      if (col === -1) { col = lanes.length; lanes.push(it.end); }
      else { lanes[col] = it.end; }
      assigned.push({ it, col });
    }
    const cols = lanes.length;
    for (const { it, col } of assigned) {
      let span = 1;
      for (let c = col + 1; c < cols; c++) {
        if (assigned.some(o => o.col === c && o.it.start < it.end && o.it.end > it.start)) break;
        span++;
      }
      out.push({ evIdx: it.idx, col, cols, span });
    }
  }
  return out;
}

function hexToRgba(hex: string, alpha: number): string {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (h.length !== 6) return `rgba(0,120,212,${alpha})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
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

  const [orientation, setOrientation] = useState<Orientation>('landscape');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('00:00');
  const [showMiniMonth, setShowMiniMonth] = useState(false);
  const [detailedAgenda, setDetailedAgenda] = useState(false);
  const [busyMode, setBusyMode] = useState(false);

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

  // ---- Print ---------------------------------------------------------------
  const handlePrint = () => {
    const win = window.open('', '_blank');
    if (!win) return;
    const html = buildPrintHtml({
      days: eachDayOfInterval({ start: printStart, end: printEnd }),
      events: printEvents,
      selectedCalendars,
      colorOverrides,
      sMins: timeToMins(startTime),
      safeMins: endMinsFromTime(endTime),
      periodLabel,
      orientation,
      printView,
      getEventColor,
      printStart,
      printEnd,
      busyMode,
    });
    win.document.write(html);
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
        style={{ width: 940, maxWidth: '96vw', maxHeight: '92vh' }}
      >
        {/* ---- Controls ---- */}
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

          <FieldGroup label="Orientation">
            <div className="flex gap-2">
              {(['portrait', 'landscape'] as Orientation[]).map(o => (
                <button
                  key={o}
                  onClick={() => setOrientation(o)}
                  className={`flex-1 flex flex-col items-center gap-1 py-2 border rounded text-xs transition-colors
                    ${orientation === o ? 'border-outlook-blue bg-blue-50 text-outlook-blue' : 'border-gray-300 hover:bg-gray-50'}`}
                >
                  <div
                    className={`border-2 rounded-sm bg-white ${orientation === o ? 'border-outlook-blue' : 'border-gray-400'}`}
                    style={o === 'portrait' ? { width: 14, height: 20 } : { width: 20, height: 14 }}
                  />
                  {o === 'portrait' ? 'Portrait' : 'Paysage'}
                </button>
              ))}
            </div>
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
            <CheckRow label="Mode occupé (masquer les détails)" checked={busyMode} onChange={setBusyMode} />
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

        {/* ---- Preview ---- */}
        <div className="flex-1 bg-gray-100 overflow-auto relative p-5 flex flex-col items-center">
          <button
            onClick={onClose}
            className="absolute top-3 right-3 p-1.5 hover:bg-gray-200 rounded text-gray-500 z-10"
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
            orientation={orientation}
            getEventColor={getEventColor}
            busyMode={busyMode}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// HTML print generator

interface BuildOpts {
  days: Date[];
  events: CalendarEvent[];
  selectedCalendars: Calendar[];
  colorOverrides: Record<string, string>;
  sMins: number;
  safeMins: number;
  periodLabel: string;
  orientation: Orientation;
  printView: PrintView;
  getEventColor: (ev: CalendarEvent) => string;
  printStart: Date;
  printEnd: Date;
  busyMode: boolean;
}

function buildPrintHtml(opts: BuildOpts): string {
  const { days, events, selectedCalendars, colorOverrides, sMins, safeMins,
          periodLabel, orientation, printView, getEventColor, printStart, printEnd, busyMode } = opts;

  const isLandscape = orientation === 'landscape';
  // A4 content area at 96 dpi (minus 12mm side margins)
  const pageW = isLandscape ? 1028 : 716;
  const pageH = isLandscape ? 696 : 1028;
  const GUTTER = 44;

  const calNamesHtml = selectedCalendars
    .map(c => `<span style="color:${colorOverrides[c.id] || c.color || '#0078D4'};font-weight:700">${c.name}</span>`)
    .join('<span style="color:#9ca3af"> · </span>');

  if (printView === 'month') {
    return buildMonthHtml({ ...opts, pageW, calNamesHtml, isLandscape });
  }

  // ---- Time grid ----
  const totalHours = Math.max(1, (safeMins - sMins) / 60);
  const colW = Math.floor((pageW - GUTTER) / days.length);

  // Fit grid in one page
  const headerH = 62;
  const dayHeaderH = 40;
  // check if any all-day events exist
  const hasAllDay = events.some(ev => ev.all_day);
  const allDayH = hasAllDay ? 26 : 0;
  const availH = pageH - headerH - dayHeaderH - allDayH - 8;
  const HOUR_H = Math.max(32, Math.min(90, Math.floor(availH / totalHours)));
  const totalH = HOUR_H * totalHours;

  // Day header cells
  const dayHeaderCells = days.map(day => {
    const abbr = format(day, 'EEE', { locale: fr }).toUpperCase();
    const num = format(day, 'd');
    const todayNum = isToday(day)
      ? `<span style="background:#0078D4;color:#fff;border-radius:50%;width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;font-size:15px;font-weight:700">${num}</span>`
      : `<span style="font-size:15px;font-weight:700;color:#111827">${num}</span>`;
    return `<div style="flex:1;text-align:center;padding:5px 2px 4px;border-right:1px solid #e5e7eb;">
      <div style="font-size:9px;color:#6b7280;letter-spacing:0.8px;margin-bottom:3px">${abbr}</div>
      ${todayNum}
    </div>`;
  }).join('');

  // All-day row
  let allDayRowHtml = '';
  if (hasAllDay) {
    const cells = days.map(day => {
      const dayEvs = events.filter(ev => ev.all_day && isSameDay(parseISO(ev.start_date), day));
      const evHtml = dayEvs.map(ev => {
        const c = getEventColor(ev);
        return `<div style="background:${hexToRgba(c, 0.75)};border-radius:3px;padding:1px 4px;font-size:8px;font-weight:600;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;margin-bottom:1px;color:#111">${busyMode ? 'Occupé' : ev.title}</div>`;
      }).join('');
      return `<div style="flex:1;border-right:1px solid #e5e7eb;padding:2px 3px;">${evHtml}</div>`;
    }).join('');
    allDayRowHtml = `<div style="display:flex;border-bottom:1px solid #e5e7eb;background:#fafafa;min-height:${allDayH}px">
      <div style="width:${GUTTER}px;flex-shrink:0;border-right:1px solid #e5e7eb;font-size:8px;color:#9ca3af;text-align:right;padding:4px 5px 0 0">Journée</div>
      ${cells}
    </div>`;
  }

  // Hour labels + grid lines (drawn inside the day columns div)
  const hourLinesHtml = Array.from({ length: Math.ceil(totalHours) + 1 }, (_, i) => {
    const top = i * HOUR_H;
    return `<div style="position:absolute;top:${top}px;left:0;right:0;border-top:1px solid #e5e7eb;pointer-events:none"></div>`;
  }).join('');

  const halfLinesHtml = Array.from({ length: Math.ceil(totalHours) }, (_, i) => {
    const top = i * HOUR_H + HOUR_H / 2;
    return `<div style="position:absolute;top:${top}px;left:0;right:0;border-top:1px dashed #f0f0f0;pointer-events:none"></div>`;
  }).join('');

  const hourGutterHtml = Array.from({ length: Math.ceil(totalHours) }, (_, i) => {
    const top = i * HOUR_H;
    const h = Math.floor(sMins / 60) + i;
    return `<div style="position:absolute;top:${top + 2}px;right:5px;font-size:9px;color:#9ca3af;line-height:1">${String(h).padStart(2, '0')}</div>
      <div style="position:absolute;top:${top}px;left:${GUTTER - 1}px;right:0;border-top:1px solid #e5e7eb;"></div>`;
  }).join('');

  // Day columns with events
  const dayColsHtml = days.map((day) => {
    const allDayEvs = events.filter(ev => !ev.all_day && isSameDay(parseISO(ev.start_date), day));
    const visibleEvs = allDayEvs.filter(ev => {
      const s = parseISO(ev.start_date);
      const e = parseISO(ev.end_date);
      const evS = getHours(s) * 60 + getMinutes(s);
      const evE = getHours(e) * 60 + getMinutes(e);
      return evS < safeMins && evE > sMins;
    });
    const layout = layoutPrintDay(visibleEvs.map(ev => {
      const s = parseISO(ev.start_date);
      const e = parseISO(ev.end_date);
      return { start: getHours(s) * 60 + getMinutes(s), end: getHours(e) * 60 + getMinutes(e) };
    }));

    const evHtml = visibleEvs.map((ev, i) => {
      const { col, cols, span } = layout[i];
      const s = parseISO(ev.start_date);
      const e = parseISO(ev.end_date);
      const evS = getHours(s) * 60 + getMinutes(s);
      const evE = getHours(e) * 60 + getMinutes(e);
      const top = Math.max(0, (evS - sMins) / 60) * HOUR_H;
      const height = Math.max(HOUR_H * 0.35, ((Math.min(evE, safeMins) - Math.max(evS, sMins)) / 60) * HOUR_H) - 2;
      const color = getEventColor(ev);
      const showTime = !busyMode && height >= HOUR_H * 0.65;
      const startStr = format(s, 'HH:mm');
      const endStr = format(e, 'HH:mm');
      const EV_GUTTER = 2;
      const EV_OVERLAP = cols > 1 ? 4 : 0;
      const widthPct = (span / cols) * 100;
      const leftPct = (col / cols) * 100;
      const label = busyMode ? 'Occupé' : ev.title;
      return `<div style="
        position:absolute;top:${top + 1}px;
        left:calc(${leftPct}% + ${EV_GUTTER}px);
        width:calc(${widthPct}% - ${EV_GUTTER * 2}px + ${EV_OVERLAP}px);
        height:${height}px;z-index:${10 + col};
        background:${hexToRgba(color, 0.75)};
        border-radius:3px;padding:2px 4px;overflow:hidden;line-height:1.3;
      ">
        <div style="font-weight:700;font-size:8.5px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:#111">${label}</div>
        ${showTime ? `<div style="font-size:7.5px;color:#222;margin-top:1px">${startStr} – ${endStr}</div>` : ''}
      </div>`;
    }).join('');

    return `<div style="flex:1;position:relative;border-right:1px solid #e5e7eb;height:${totalH}px;">${evHtml}</div>`;
  }).join('');

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
<title>Calendrier – ${periodLabel}</title>
<style>
  @page { size: A4 ${orientation}; margin: 10mm 12mm; }
UpdateU  *{box-sizing:border-box;margin:0;padding:0;print-color-adjust:exact;-webkit-print-color-adjust:exact;}
  body{font-family:'Segoe UI',Arial,sans-serif;color:#111827}
  @media print{html,body{width:100%;}}
</style></head><body>
<div style="margin-bottom:10px">
  <div style="font-size:14px;font-weight:800;margin-bottom:4px">📅 ${periodLabel}</div>
  <div style="font-size:10px;line-height:1.8">${calNamesHtml}</div>
</div>
<div style="border:1px solid #d1d5db;border-radius:3px;overflow:hidden">
  <div style="display:flex;border-bottom:2px solid #e5e7eb;background:#f9fafb">
    <div style="width:${GUTTER}px;flex-shrink:0;border-right:1px solid #e5e7eb"></div>
    ${dayHeaderCells}
  </div>
  ${allDayRowHtml}
  <div style="position:relative;height:${totalH}px;display:flex">
    <div style="width:${GUTTER}px;flex-shrink:0;position:relative;border-right:0">${hourGutterHtml}</div>
    <div style="flex:1;display:flex;position:relative">
      ${hourLinesHtml}${halfLinesHtml}
      ${dayColsHtml}
    </div>
  </div>
</div>
</body></html>`;
}

function buildMonthHtml({ days: _days, events, selectedCalendars, colorOverrides, periodLabel,
  orientation, getEventColor, printStart, printEnd, pageW, calNamesHtml, isLandscape: _iL }: BuildOpts & {
    pageW: number; calNamesHtml: string; isLandscape: boolean;
  }): string {
  const gridStart = startOfWeek(printStart, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(printEnd, { weekStartsOn: 1 });
  const allDays = eachDayOfInterval({ start: gridStart, end: gridEnd });
  const weeks: Date[][] = [];
  for (let i = 0; i < allDays.length; i += 7) weeks.push(allDays.slice(i, i + 7));

  const DAY_NAMES = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  const headers = DAY_NAMES.map(d =>
    `<th style="border:1px solid #e5e7eb;padding:5px 3px;font-size:10px;background:#f9fafb;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px">${d}</th>`
  ).join('');

  const rows = weeks.map(week => {
    const cells = week.map(day => {
      const dayEvs = events.filter(ev => isSameDay(parseISO(ev.start_date), day));
      const inMonth = day >= printStart && day <= printEnd;
      const todayStyle = isToday(day)
        ? 'background:#0078D4;color:#fff;border-radius:50%;width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;'
        : '';
      const evHtml = dayEvs.slice(0, 4).map(ev => {
        const c = getEventColor(ev);
        return `<div style="background:${hexToRgba(c, 0.75)};border-radius:3px;padding:1px 3px;font-size:7.5px;font-weight:600;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;margin-bottom:1px;color:#111">${ev.title}</div>`;
      }).join('') + (dayEvs.length > 4 ? `<div style="font-size:7px;color:#6b7280;padding:0 3px">+${dayEvs.length - 4}</div>` : '');
      return `<td style="border:1px solid #e5e7eb;padding:3px;vertical-align:top;height:80px;${!inMonth ? 'background:#f9fafb;' : ''}">
        <div style="font-size:10px;font-weight:${isToday(day) ? '700' : '500'};margin-bottom:2px;${!inMonth ? 'color:#d1d5db' : ''}">
          <span style="${todayStyle}">${format(day, 'd')}</span>
        </div>
        ${evHtml}
      </td>`;
    }).join('');
    return `<tr>${cells}</tr>`;
  }).join('');

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
<title>Calendrier – ${periodLabel}</title>
<style>
  @page { size: A4 ${orientation}; margin: 10mm 12mm; }
  *{box-sizing:border-box;margin:0;padding:0;print-color-adjust:exact;-webkit-print-color-adjust:exact;}
  body{font-family:'Segoe UI',Arial,sans-serif}
</style></head><body>
<div style="margin-bottom:10px">
  <div style="font-size:14px;font-weight:800;margin-bottom:4px">📅 ${periodLabel}</div>
  <div style="font-size:10px;line-height:1.8">${calNamesHtml}</div>
</div>
<table style="width:100%;border-collapse:collapse">
  <thead><tr>${headers}</tr></thead>
  <tbody>${rows}</tbody>
</table>
</body></html>`;
}

// ---------------------------------------------------------------------------
// Live preview (React, scaled to fit)

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
  orientation: Orientation;
  getEventColor: (ev: CalendarEvent) => string;
  busyMode: boolean;
}

// Logical render width for each orientation (mirrors print layout)
const PRINT_W: Record<Orientation, number> = { portrait: 716, landscape: 1028 };

function CalendarPrintPreview(props: PreviewProps) {
  const { orientation } = props;
  const AVAILABLE = 560; // width of preview pane
  const printW = PRINT_W[orientation];
  const scale = AVAILABLE / printW;

  return (
    <div style={{ width: AVAILABLE, overflow: 'hidden' }}>
      <div
        style={{
          transformOrigin: 'top left',
          transform: `scale(${scale})`,
          width: printW,
        }}
      >
        <PreviewContent {...props} printW={printW} />
      </div>
    </div>
  );
}

function PreviewContent({ printView, printStart, printEnd, periodLabel, events, selectedCalendars,
  colorOverrides, startTime, endTime, getEventColor, printW, busyMode }: PreviewProps & { printW: number }) {
  const days = useMemo(
    () => eachDayOfInterval({ start: printStart, end: printEnd }),
    [printStart, printEnd],
  );
  const sMins = timeToMins(startTime);
  const safeMins = endMinsFromTime(endTime);
  const totalHours = Math.max(1, (safeMins - sMins) / 60);
  const GUTTER = 44;
  const colW = Math.floor((printW - GUTTER) / days.length);

  // Same hour height as print
  const hasAllDay = events.some(ev => ev.all_day);
  const HOUR_H = Math.max(32, Math.min(90, Math.floor((650 - (hasAllDay ? 26 : 0)) / totalHours)));
  const totalH = HOUR_H * totalHours;

  const calNamesLine = (
    <span>
      {selectedCalendars.map((c, i) => (
        <span key={c.id}>
          {i > 0 && <span style={{ color: '#9ca3af' }}> · </span>}
          <span style={{ color: colorOverrides[c.id] || c.color || '#0078D4', fontWeight: 700 }}>{c.name}</span>
        </span>
      ))}
    </span>
  );

  if (printView === 'month') {
    return (
      <div style={{ fontFamily: 'Segoe UI, Arial, sans-serif', fontSize: 12 }}>
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>📅 {periodLabel}</div>
          <div style={{ fontSize: 10, lineHeight: 1.8 }}>{calNamesLine}</div>
        </div>
        <PreviewMonthGrid events={events} monthStart={printStart} getEventColor={getEventColor} />
      </div>
    );
  }

  return (
    <div style={{ fontFamily: 'Segoe UI, Arial, sans-serif', fontSize: 12 }}>
      {/* Header */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>📅 {periodLabel}</div>
        <div style={{ fontSize: 10, lineHeight: 1.8 }}>{calNamesLine}</div>
      </div>

      {/* Grid */}
      <div style={{ border: '1px solid #d1d5db', borderRadius: 3, overflow: 'hidden' }}>
        {/* Day headers */}
        <div style={{ display: 'flex', borderBottom: '2px solid #e5e7eb', background: '#f9fafb' }}>
          <div style={{ width: GUTTER, flexShrink: 0, borderRight: '1px solid #e5e7eb' }} />
          {days.map(day => (
            <div key={day.toISOString()} style={{ flex: 1, textAlign: 'center', padding: '5px 2px 4px', borderRight: '1px solid #e5e7eb' }}>
              <div style={{ fontSize: 9, color: '#6b7280', letterSpacing: 0.8, marginBottom: 3, textTransform: 'uppercase' }}>
                {format(day, 'EEE', { locale: fr })}
              </div>
              <div style={isToday(day)
                ? { background: '#0078D4', color: '#fff', borderRadius: '50%', width: 24, height: 24, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700 }
                : { fontSize: 15, fontWeight: 700, color: '#111827' }}>
                {format(day, 'd')}
              </div>
            </div>
          ))}
        </div>

        {/* All-day row */}
        {hasAllDay && (
          <div style={{ display: 'flex', borderBottom: '1px solid #e5e7eb', background: '#fafafa', minHeight: 26 }}>
            <div style={{ width: GUTTER, flexShrink: 0, borderRight: '1px solid #e5e7eb', fontSize: 8, color: '#9ca3af', textAlign: 'right', padding: '4px 5px 0 0' }}>Journée</div>
            {days.map(day => {
              const dayEvs = events.filter(ev => ev.all_day && isSameDay(parseISO(ev.start_date), day));
              return (
                <div key={day.toISOString()} style={{ flex: 1, borderRight: '1px solid #e5e7eb', padding: '2px 3px' }}>
                  {dayEvs.map(ev => {
                    const c = getEventColor(ev);
                    return (
                      <div key={ev.id} style={{ background: hexToRgba(c, 0.75), borderRadius: 3, padding: '1px 4px', fontSize: 8, fontWeight: 700, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', marginBottom: 1, color: '#111' }}>
                        {busyMode ? 'Occupé' : ev.title}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}

        {/* Time grid */}
        <div style={{ position: 'relative', height: totalH, display: 'flex' }}>
          {/* Gutter */}
          <div style={{ width: GUTTER, flexShrink: 0, position: 'relative', borderRight: '1px solid #e5e7eb' }}>
            {Array.from({ length: Math.ceil(totalHours) }, (_, i) => (
              <div key={i} style={{ position: 'absolute', top: i * HOUR_H + 2, right: 5, fontSize: 9, color: '#9ca3af', lineHeight: 1 }}>
                {String(Math.floor(sMins / 60) + i).padStart(2, '0')}
              </div>
            ))}
          </div>

          {/* Columns */}
          <div style={{ flex: 1, display: 'flex', position: 'relative' }}>
            {/* Hour lines */}
            {Array.from({ length: Math.ceil(totalHours) + 1 }, (_, i) => (
              <div key={i} style={{ position: 'absolute', top: i * HOUR_H, left: 0, right: 0, borderTop: '1px solid #e5e7eb', pointerEvents: 'none' }} />
            ))}
            {/* Half-hour lines */}
            {Array.from({ length: Math.ceil(totalHours) }, (_, i) => (
              <div key={i} style={{ position: 'absolute', top: i * HOUR_H + HOUR_H / 2, left: 0, right: 0, borderTop: '1px dashed #f0f0f0', pointerEvents: 'none' }} />
            ))}

            {days.map((day) => {
              const allDayEvs = events.filter(ev => !ev.all_day && isSameDay(parseISO(ev.start_date), day));
              const visibleEvs = allDayEvs.filter(ev => {
                const s = parseISO(ev.start_date);
                const e = parseISO(ev.end_date);
                const evS = getHours(s) * 60 + getMinutes(s);
                const evE = getHours(e) * 60 + getMinutes(e);
                return evS < safeMins && evE > sMins;
              });
              const layout = layoutPrintDay(visibleEvs.map(ev => {
                const s = parseISO(ev.start_date);
                const e = parseISO(ev.end_date);
                return { start: getHours(s) * 60 + getMinutes(s), end: getHours(e) * 60 + getMinutes(e) };
              }));
              return (
                <div key={day.toISOString()} style={{ flex: 1, position: 'relative', height: totalH, borderRight: '1px solid #e5e7eb' }}>
                  {visibleEvs.map((ev, i) => {
                    const { col, cols, span } = layout[i];
                    const s = parseISO(ev.start_date);
                    const e = parseISO(ev.end_date);
                    const evS = getHours(s) * 60 + getMinutes(s);
                    const evE = getHours(e) * 60 + getMinutes(e);
                    const top = Math.max(0, (evS - sMins) / 60) * HOUR_H + 1;
                    const height = Math.max(HOUR_H * 0.35, ((Math.min(evE, safeMins) - Math.max(evS, sMins)) / 60) * HOUR_H) - 2;
                    const color = getEventColor(ev);
                    const showTime = !busyMode && height >= HOUR_H * 0.65;
                    const EV_GUTTER = 2;
                    const EV_OVERLAP = cols > 1 ? 4 : 0;
                    const widthPct = (span / cols) * 100;
                    const leftPct = (col / cols) * 100;
                    return (
                      <div key={ev.id} style={{
                        position: 'absolute', top,
                        left: `calc(${leftPct}% + ${EV_GUTTER}px)`,
                        width: `calc(${widthPct}% - ${EV_GUTTER * 2}px + ${EV_OVERLAP}px)`,
                        height, zIndex: 10 + col,
                        background: hexToRgba(color, 0.75),
                        borderRadius: 3, padding: '2px 4px', overflow: 'hidden', lineHeight: 1.3,
                      }}>
                        <div style={{ fontWeight: 700, fontSize: 8.5, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', color: '#111' }}>
                          {busyMode ? 'Occupé' : ev.title}
                        </div>
                        {showTime && (
                          <div style={{ fontSize: 7.5, color: '#222', marginTop: 1 }}>
                            {format(s, 'HH:mm')} – {format(e, 'HH:mm')}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewMonthGrid({ events, monthStart, getEventColor }: {
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
  const DAY_NAMES = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          {DAY_NAMES.map(d => (
            <th key={d} style={{ border: '1px solid #e5e7eb', padding: '5px 3px', fontSize: 10, background: '#f9fafb', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {d}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {weeks.map((week, wi) => (
          <tr key={wi}>
            {week.map(day => {
              const dayEvs = events.filter(ev => isSameDay(parseISO(ev.start_date), day));
              const inMonth = day >= monthStart && day <= monthEnd;
              return (
                <td key={day.toISOString()} style={{ border: '1px solid #e5e7eb', padding: 3, verticalAlign: 'top', height: 80, background: inMonth ? undefined : '#f9fafb' }}>
                  <div style={{ fontSize: 10, fontWeight: isToday(day) ? 700 : 500, marginBottom: 2, color: inMonth ? (isToday(day) ? '#0078D4' : undefined) : '#d1d5db' }}>
                    {isToday(day)
                      ? <span style={{ background: '#0078D4', color: '#fff', borderRadius: '50%', width: 20, height: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{format(day, 'd')}</span>
                      : format(day, 'd')}
                  </div>
                  {dayEvs.slice(0, 4).map(ev => {
                    const c = getEventColor(ev);
                    return (
                      <div key={ev.id} style={{ background: hexToRgba(c, 0.75), borderRadius: 3, padding: '1px 3px', fontSize: 7.5, fontWeight: 600, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', marginBottom: 1, color: '#111' }}>
                        {ev.title}
                      </div>
                    );
                  })}
                  {dayEvs.length > 4 && <div style={{ fontSize: 7, color: '#6b7280' }}>+{dayEvs.length - 4}</div>}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// Shared small helpers

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-sm font-medium text-gray-700">{label}</div>
      {children}
    </div>
  );
}

function DropButton({ label, open, onToggle, children }: {
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

function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
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
