import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Coloris from '@melloware/coloris';
import '@melloware/coloris/dist/coloris.css';
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths,
  getWeek, isWithinInterval, startOfDay, endOfDay,
} from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  ChevronRight, ChevronDown, ChevronUp, Plus, CalendarPlus, FolderPlus,
  Pencil, Palette, Trash2, Share2, Copy, Eye, EyeOff, FolderOpen,
  GripVertical, MoreHorizontal, CloudDownload,
} from 'lucide-react';
import type { Calendar } from '../../types';
import ContextMenu, { ContextMenuItem } from '../ui/ContextMenu';
import {
  arrangeCalendars, CalendarGroup, createGroup, renameGroup, deleteGroup,
  moveCalendarToGroup, reorderGroups, isGroupExpanded, setGroupExpanded,
  getNameOverrides, setNameOverride,
  getColorOverrides, setColorOverride,
} from '../../utils/calendarPreferences';

/** Named base colors exposed in the calendar colour submenu / popover. */
const BASE_COLORS: { label: string; value: string }[] = [
  { label: 'Rouge', value: '#E81123' },
  { label: 'Orange', value: '#F7630C' },
  { label: 'Jaune', value: '#FFB900' },
  { label: 'Vert', value: '#107C10' },
  { label: 'Turquoise', value: '#00B294' },
  { label: 'Bleu', value: '#0078D4' },
  { label: 'Violet', value: '#744DA9' },
  { label: 'Rose', value: '#E3008C' },
  { label: 'Gris', value: '#767676' },
  { label: 'Noir', value: '#000000' },
];

let colorisReady = false;
function ensureColoris() {
  if (colorisReady) return;
  colorisReady = true;
  Coloris.init();
  Coloris({
    el: '.coloris-calendar',
    themeMode: 'auto',
    alpha: false,
    format: 'hex',
    swatches: BASE_COLORS.map(c => c.value),
    swatchesOnly: false,
  });
}

interface CalendarSidebarProps {
  calendars: Calendar[];
  currentDate: Date;
  onChangeCurrentDate: (d: Date) => void;
  selectedRange?: { start: Date; end: Date } | null;
  onNewCalendar: () => void;
  onSubscribeCalendar?: () => void;
  onToggleCalendarVisibility: (id: string, visible: boolean) => void;
  onRenameCalendar: (id: string, name: string) => void;
  onChangeColor: (id: string, color: string) => void;
  onDeleteCalendar: (id: string) => void;
  onShareCalendar: (id: string) => void;
  /** Bump when local overrides or groups change so the UI refreshes. */
  refreshKey?: number;
  onChangeRefreshKey?: () => void;
}

export default function CalendarSidebar({
  calendars, currentDate, onChangeCurrentDate, selectedRange,
  onNewCalendar, onSubscribeCalendar, onToggleCalendarVisibility, onRenameCalendar,
  onChangeColor, onDeleteCalendar, onShareCalendar,
  refreshKey = 0, onChangeRefreshKey,
}: CalendarSidebarProps) {
  const [miniDate, setMiniDate] = useState(() => startOfMonth(currentDate));

  useEffect(() => {
    // Keep mini picker in sync when the main date moves to another month.
    if (!isSameMonth(miniDate, currentDate)) {
      setMiniDate(startOfMonth(currentDate));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDate]);

  const nameOverrides = getNameOverrides();
  const colorOverrides = getColorOverrides();

  const arranged = useMemo(
    () => arrangeCalendars(calendars),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [calendars, refreshKey],
  );

  // Context menus
  const [calMenu, setCalMenu] = useState<{ x: number; y: number; cal: Calendar } | null>(null);
  const [groupMenu, setGroupMenu] = useState<{ x: number; y: number; group: CalendarGroup } | null>(null);
  const [colorPicker, setColorPicker] = useState<{ x: number; y: number; cal: Calendar } | null>(null);
  const [renamingCal, setRenamingCal] = useState<string | null>(null);
  const [renamingGroup, setRenamingGroup] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');

  // Drag & drop state
  const [dragCalId, setDragCalId] = useState<string | null>(null);
  const [dragGroupId, setDragGroupId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ groupId: string; index: number } | null>(null);
  const [dropGroupTarget, setDropGroupTarget] = useState<string | null>(null);

  const bump = () => onChangeRefreshKey?.();

  // ── Coloris custom color picker ───────────────────────────
  const colorisInputRef = useRef<HTMLInputElement>(null);
  const colorisTargetRef = useRef<Calendar | null>(null);
  useEffect(() => { ensureColoris(); }, []);

  const openCustomColorPicker = (cal: Calendar, currentColor: string) => {
    const input = colorisInputRef.current;
    if (!input) return;
    colorisTargetRef.current = cal;
    input.value = currentColor;
    // Close any open menus so the picker isn't clipped
    setCalMenu(null);
    setColorPicker(null);
    // Defer to next tick so state updates don't steal focus back
    setTimeout(() => input.click(), 0);
  };

  // ── Mini date picker ──────────────────────────────────────
  const monthStart = startOfMonth(miniDate);
  const monthEnd = endOfMonth(miniDate);
  const calStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const miniDays = eachDayOfInterval({ start: calStart, end: calEnd });
  // Group days into weeks (rows of 7)
  const miniWeeks: Date[][] = [];
  for (let i = 0; i < miniDays.length; i += 7) miniWeeks.push(miniDays.slice(i, i + 7));

  const isInRange = (d: Date) =>
    selectedRange && isWithinInterval(d, { start: startOfDay(selectedRange.start), end: endOfDay(selectedRange.end) });

  // ── Handlers ──────────────────────────────────────────────
  const startRenameCalendar = (c: Calendar) => {
    setRenamingCal(c.id);
    setRenameValue(nameOverrides[c.id] || c.name);
  };
  const commitRenameCalendar = (c: Calendar) => {
    const v = renameValue.trim();
    if (v && v !== c.name) {
      setNameOverride(c.id, v);
      onRenameCalendar(c.id, v);
    }
    setRenamingCal(null);
    bump();
  };
  const startRenameGroup = (g: CalendarGroup) => {
    setRenamingGroup(g.id);
    setRenameValue(g.name);
  };
  const commitRenameGroup = (g: CalendarGroup) => {
    const v = renameValue.trim();
    if (v && v !== g.name) renameGroup(g.id, v);
    setRenamingGroup(null);
    bump();
  };

  const handlePickColor = (c: Calendar, color: string) => {
    setColorOverride(c.id, color);
    onChangeColor(c.id, color);
    setColorPicker(null);
    bump();
  };

  // DnD on calendar rows
  const onCalDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData('text/calendar', id);
    e.dataTransfer.effectAllowed = 'move';
    setDragCalId(id);
  };
  const onCalDragEnd = () => { setDragCalId(null); setDropTarget(null); };
  const onCalDragOver = (e: React.DragEvent, groupId: string, index: number) => {
    if (!dragCalId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTarget({ groupId, index });
  };
  const onCalDrop = (e: React.DragEvent, groupId: string, index: number) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/calendar');
    if (!id) { setDropTarget(null); return; }
    moveCalendarToGroup(id, groupId, index);
    setDropTarget(null);
    setDragCalId(null);
    bump();
  };
  const onGroupDropZone = (e: React.DragEvent, groupId: string) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/calendar');
    if (!id) return;
    moveCalendarToGroup(id, groupId);
    setDropTarget(null);
    bump();
  };

  // DnD on group headers (reorder groups)
  const onGroupDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData('text/group', id);
    e.dataTransfer.effectAllowed = 'move';
    setDragGroupId(id);
  };
  const onGroupDragOver = (e: React.DragEvent, id: string) => {
    if (!dragGroupId) return;
    e.preventDefault();
    setDropGroupTarget(id);
  };
  const onGroupDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/group');
    if (!id || id === targetId) { setDropGroupTarget(null); setDragGroupId(null); return; }
    const order = arranged.map(x => x.group.id);
    const fromIdx = order.indexOf(id);
    const toIdx = order.indexOf(targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    order.splice(fromIdx, 1);
    order.splice(toIdx, 0, id);
    reorderGroups(order);
    setDropGroupTarget(null);
    setDragGroupId(null);
    bump();
  };

  // ── Context menu items ────────────────────────────────────
  const calMenuItems = (c: Calendar): ContextMenuItem[] => {
    const locallyHidden = !c.is_visible;
    return [
      { label: locallyHidden ? 'Afficher le calendrier' : 'Masquer le calendrier', icon: locallyHidden ? <Eye size={14} /> : <EyeOff size={14} />, onClick: () => onToggleCalendarVisibility(c.id, !c.is_visible) },
      { separator: true, label: '', onClick: () => {} },
      { label: 'Renommer', icon: <Pencil size={14} />, onClick: () => startRenameCalendar(c) },
      {
        label: 'Couleur',
        icon: <Palette size={14} />,
        onClick: () => {},
        submenu: [
          ...BASE_COLORS.map(col => ({
            label: col.label,
            icon: <span className="inline-block w-3 h-3 rounded-sm border border-outlook-border" style={{ backgroundColor: col.value }} />,
            onClick: () => handlePickColor(c, col.value),
          })),
          { separator: true, label: '', onClick: () => {} },
          {
            label: 'Personnaliser…',
            icon: <Palette size={14} />,
            onClick: () => openCustomColorPicker(c, displayColor(c)),
          },
        ],
      },
      { label: 'Dupliquer', icon: <Copy size={14} />, onClick: () => {
          // fire through parent by calling create via existing handler
          onNewCalendar();
      }, disabled: true },
      { separator: true, label: '', onClick: () => {} },
      { label: 'Partager', icon: <Share2 size={14} />, onClick: () => onShareCalendar(c.id) },
      { separator: true, label: '', onClick: () => {} },
      { label: 'Supprimer', icon: <Trash2 size={14} />, onClick: () => onDeleteCalendar(c.id), danger: true, disabled: c.is_default },
    ];
  };

  const groupMenuItems = (g: CalendarGroup): ContextMenuItem[] => [
    { label: 'Renommer le groupe', icon: <Pencil size={14} />, onClick: () => startRenameGroup(g), disabled: !!g.builtin },
    { label: 'Nouveau calendrier ici', icon: <CalendarPlus size={14} />, onClick: () => onNewCalendar() },
    { separator: true, label: '', onClick: () => {} },
    {
      label: isGroupExpanded(g.id) ? 'Réduire' : 'Développer',
      icon: isGroupExpanded(g.id) ? <ChevronUp size={14} /> : <ChevronDown size={14} />,
      onClick: () => { setGroupExpanded(g.id, !isGroupExpanded(g.id)); bump(); },
    },
    { separator: true, label: '', onClick: () => {} },
    { label: 'Supprimer le groupe', icon: <Trash2 size={14} />, onClick: () => { deleteGroup(g.id); bump(); }, danger: true, disabled: !!g.builtin },
  ];

  // ── Render ────────────────────────────────────────────────
  const displayName = (c: Calendar) => nameOverrides[c.id] || c.name;
  const displayColor = (c: Calendar) => colorOverrides[c.id] || c.color || '#0078D4';

  return (
    <div className="w-64 flex-shrink-0 flex flex-col bg-white rounded-md shadow-sm overflow-hidden h-full">
      {/* Mini date picker */}
      <div className="p-2 border-b border-outlook-border flex-shrink-0">
        <div className="flex items-center justify-between mb-1">
          <button
            onClick={() => { const d = subMonths(miniDate, 1); setMiniDate(d); }}
            className="p-1 hover:bg-outlook-bg-hover rounded"
            title="Mois précédent"
          >
            <ChevronRight size={14} className="rotate-180" />
          </button>
          <button
            onClick={() => onChangeCurrentDate(miniDate)}
            className="text-xs font-semibold capitalize hover:bg-outlook-bg-hover px-2 py-0.5 rounded"
          >
            {format(miniDate, 'yyyy MMMM', { locale: fr })}
          </button>
          <div className="flex items-center">
            <button
              onClick={() => { const d = addMonths(miniDate, 1); setMiniDate(d); }}
              className="p-1 hover:bg-outlook-bg-hover rounded"
              title="Mois suivant"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
        <div className="grid grid-cols-8 gap-0.5 text-[10px] text-outlook-text-disabled">
          <div className="w-5" />
          {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((d, i) => (
            <div key={i} className="text-center">{d}</div>
          ))}
        </div>
        <div className="mt-0.5 space-y-0.5">
          {miniWeeks.map((week) => (
            <div key={week[0].toISOString()} className="grid grid-cols-8 gap-0.5 text-[11px]">
              <div className="text-outlook-text-disabled text-center leading-6">
                {getWeek(week[0], { weekStartsOn: 1 })}
              </div>
              {week.map(day => {
                const current = isSameDay(day, currentDate);
                const inMonth = isSameMonth(day, miniDate);
                const ranged = !!isInRange(day);
                return (
                  <button
                    key={day.toISOString()}
                    onClick={() => onChangeCurrentDate(day)}
                    className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors
                      ${current ? 'bg-outlook-blue text-white'
                        : ranged ? 'bg-outlook-blue/10 text-outlook-text-primary'
                        : inMonth ? 'text-outlook-text-primary hover:bg-outlook-bg-hover'
                        : 'text-outlook-text-disabled hover:bg-outlook-bg-hover'}`}
                  >
                    {format(day, 'd')}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Toolbar for calendar list */}
      <div className="flex items-center justify-between px-2 py-1 border-b border-outlook-border flex-shrink-0">
        <span className="text-[11px] font-semibold text-outlook-text-secondary uppercase tracking-wide">Calendriers</span>
        <div className="flex items-center gap-0.5">
          {onSubscribeCalendar && (
            <button
              onClick={onSubscribeCalendar}
              className="p-1 hover:bg-outlook-bg-hover rounded text-outlook-text-secondary"
              title="Ajouter un calendrier (CalDAV)"
            >
              <CloudDownload size={14} />
            </button>
          )}
          <button
            onClick={onNewCalendar}
            className="p-1 hover:bg-outlook-bg-hover rounded text-outlook-text-secondary"
            title="Nouveau calendrier"
          >
            <CalendarPlus size={14} />
          </button>
          <button
            onClick={() => setCreatingGroup(v => !v)}
            className="p-1 hover:bg-outlook-bg-hover rounded text-outlook-text-secondary"
            title="Nouveau groupe"
          >
            <FolderPlus size={14} />
          </button>
        </div>
      </div>

      {creatingGroup && (
        <div className="px-2 py-1 border-b border-outlook-border flex-shrink-0 flex items-center gap-1">
          <input
            autoFocus
            type="text"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (newGroupName.trim()) { createGroup(newGroupName.trim()); bump(); }
                setNewGroupName(''); setCreatingGroup(false);
              } else if (e.key === 'Escape') {
                setNewGroupName(''); setCreatingGroup(false);
              }
            }}
            placeholder="Nom du groupe"
            className="flex-1 text-xs border border-outlook-border rounded px-2 py-1 focus:outline-none focus:border-outlook-blue"
          />
          <button
            onClick={() => {
              if (newGroupName.trim()) { createGroup(newGroupName.trim()); bump(); }
              setNewGroupName(''); setCreatingGroup(false);
            }}
            className="p-1 hover:bg-outlook-bg-hover rounded"
            title="Créer"
          >
            <Plus size={14} />
          </button>
        </div>
      )}

      {/* Groups / Calendars list */}
      <div className="flex-1 overflow-y-auto text-sm">
        {arranged.map(({ group, calendars: groupCals }) => {
          const expanded = isGroupExpanded(group.id);
          const isDropGroup = dropGroupTarget === group.id;
          return (
            <div key={group.id}>
              <div
                draggable={!group.builtin}
                onDragStart={(e) => !group.builtin && onGroupDragStart(e, group.id)}
                onDragOver={(e) => onGroupDragOver(e, group.id)}
                onDrop={(e) => {
                  // If we're dragging a calendar, drop into this group
                  if (e.dataTransfer.types.includes('text/calendar')) {
                    onGroupDropZone(e, group.id);
                  } else {
                    onGroupDrop(e, group.id);
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setGroupMenu({ x: e.clientX, y: e.clientY, group });
                }}
                className={`flex items-center gap-1 px-2 py-1 hover:bg-outlook-bg-hover cursor-pointer
                  ${isDropGroup ? 'bg-outlook-blue/10' : ''}`}
              >
                <button
                  onClick={() => { setGroupExpanded(group.id, !expanded); bump(); }}
                  className="p-0.5 hover:bg-outlook-bg-hover rounded"
                >
                  {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </button>
                {renamingGroup === group.id ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => commitRenameGroup(group)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRenameGroup(group);
                      else if (e.key === 'Escape') setRenamingGroup(null);
                    }}
                    className="flex-1 text-xs border border-outlook-border rounded px-1 py-0.5"
                  />
                ) : (
                  <span
                    className="flex-1 text-xs font-semibold text-outlook-text-primary truncate"
                    onDoubleClick={() => !group.builtin && startRenameGroup(group)}
                  >
                    {group.name}
                  </span>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); setGroupMenu({ x: e.clientX, y: e.clientY, group }); }}
                  className="p-0.5 hover:bg-outlook-bg-hover rounded opacity-0 group-hover:opacity-100"
                  title="Options"
                >
                  <MoreHorizontal size={12} />
                </button>
              </div>

              {expanded && (
                <div>
                  {groupCals.length === 0 && (
                    <div
                      onDragOver={(e) => onCalDragOver(e, group.id, 0)}
                      onDrop={(e) => onCalDrop(e, group.id, 0)}
                      className={`mx-2 my-0.5 py-2 text-center text-[11px] rounded border border-dashed
                        ${dropTarget?.groupId === group.id ? 'border-outlook-blue bg-outlook-blue/5 text-outlook-blue' : 'border-outlook-border text-outlook-text-disabled'}`}
                    >
                      <FolderOpen size={12} className="inline mr-1" /> Déposez un calendrier ici
                    </div>
                  )}
                  {groupCals.map((cal, idx) => {
                    const isDropHere = dropTarget?.groupId === group.id && dropTarget.index === idx;
                    return (
                      <div key={cal.id}>
                        {isDropHere && <div className="h-0.5 bg-outlook-blue mx-4" />}
                        <div
                          draggable
                          onDragStart={(e) => onCalDragStart(e, cal.id)}
                          onDragEnd={onCalDragEnd}
                          onDragOver={(e) => onCalDragOver(e, group.id, idx)}
                          onDrop={(e) => onCalDrop(e, group.id, idx)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setCalMenu({ x: e.clientX, y: e.clientY, cal });
                          }}
                          className={`flex items-center gap-1 px-2 py-1 pl-5 hover:bg-outlook-bg-hover cursor-pointer group
                            ${dragCalId === cal.id ? 'opacity-40' : ''}`}
                        >
                          <GripVertical size={10} className="text-outlook-text-disabled opacity-0 group-hover:opacity-100" />
                          <button
                            onClick={(e) => { e.stopPropagation(); onToggleCalendarVisibility(cal.id, !cal.is_visible); }}
                            className="w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors"
                            style={{
                              borderColor: displayColor(cal),
                              backgroundColor: cal.is_visible ? displayColor(cal) : 'transparent',
                            }}
                            title={cal.is_visible ? 'Masquer' : 'Afficher'}
                          />
                          {renamingCal === cal.id ? (
                            <input
                              autoFocus
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onBlur={() => commitRenameCalendar(cal)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') commitRenameCalendar(cal);
                                else if (e.key === 'Escape') setRenamingCal(null);
                              }}
                              className="flex-1 text-xs border border-outlook-border rounded px-1 py-0.5"
                            />
                          ) : (
                            <span
                              className={`flex-1 text-xs truncate ${cal.is_visible ? 'text-outlook-text-primary' : 'text-outlook-text-disabled'}`}
                              onDoubleClick={() => startRenameCalendar(cal)}
                            >
                              {displayName(cal)}
                            </span>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setColorPicker({ x: e.clientX, y: e.clientY, cal });
                            }}
                            className="p-0.5 hover:bg-outlook-bg-hover rounded opacity-0 group-hover:opacity-100"
                            title="Changer la couleur"
                          >
                            <Palette size={12} />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setCalMenu({ x: e.clientX, y: e.clientY, cal });
                            }}
                            className="p-0.5 hover:bg-outlook-bg-hover rounded opacity-0 group-hover:opacity-100"
                            title="Options"
                          >
                            <MoreHorizontal size={12} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {/* Tail drop zone at end of group */}
                  <div
                    onDragOver={(e) => onCalDragOver(e, group.id, groupCals.length)}
                    onDrop={(e) => onCalDrop(e, group.id, groupCals.length)}
                    className={`h-1.5 mx-2 rounded ${dropTarget?.groupId === group.id && dropTarget.index === groupCals.length ? 'bg-outlook-blue' : ''}`}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Context menus */}
      {calMenu && (
        <ContextMenu
          x={calMenu.x}
          y={calMenu.y}
          items={calMenuItems(calMenu.cal)}
          onClose={() => setCalMenu(null)}
        />
      )}
      {groupMenu && (
        <ContextMenu
          x={groupMenu.x}
          y={groupMenu.y}
          items={groupMenuItems(groupMenu.group)}
          onClose={() => setGroupMenu(null)}
        />
      )}

      {/* Inline color picker popover */}
      {colorPicker && createPortal(
        <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setColorPicker(null)} />
          <div
            className="fixed z-[9999] bg-white border border-outlook-border rounded-md shadow-lg p-2 w-52"
            style={{ top: colorPicker.y + 4, left: colorPicker.x + 4 }}
          >
            <div className="grid grid-cols-5 gap-1">
              {BASE_COLORS.map(col => (
                <button
                  key={col.value}
                  onClick={() => handlePickColor(colorPicker.cal, col.value)}
                  className="w-6 h-6 rounded-full border border-outlook-border hover:scale-110 transition-transform"
                  style={{ backgroundColor: col.value }}
                  title={col.label}
                />
              ))}
            </div>
            <button
              onClick={() => openCustomColorPicker(colorPicker.cal, displayColor(colorPicker.cal))}
              className="mt-2 w-full flex items-center justify-center gap-1 text-xs border border-outlook-border rounded px-2 py-1 hover:bg-outlook-bg-hover"
            >
              <Palette size={12} /> Personnaliser…
            </button>
          </div>
        </>,
        document.body,
      )}

      {/* Hidden Coloris input used by the "Personnaliser…" flow */}
      <input
        ref={colorisInputRef}
        type="text"
        className="coloris-calendar"
        aria-hidden="true"
        tabIndex={-1}
        style={{ position: 'fixed', width: 1, height: 1, opacity: 0, pointerEvents: 'none', left: -9999, top: -9999 }}
        defaultValue="#0078D4"
        onChange={(e) => {
          const target = colorisTargetRef.current;
          const value = e.currentTarget.value;
          if (target && value) handlePickColor(target, value);
        }}
      />
    </div>
  );
}
