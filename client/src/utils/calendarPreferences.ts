// Calendar UI preferences stored locally (groups, ordering, ribbon mode).
// Calendar visibility is stored server-side on the Calendar record.

import type { Calendar } from '../types';

const KEY_GROUPS = 'calendar.groups';              // CalendarGroup[]
const KEY_UNGROUPED_ORDER = 'calendar.ungroupedOrder'; // string[] of calendar ids
const KEY_EXPANDED_GROUPS = 'calendar.expandedGroups'; // Record<string, boolean>
const KEY_RIBBON_MODE = 'calendar.ribbonMode';     // 'classic' | 'simplified'
const KEY_RIBBON_COLLAPSED = 'calendar.ribbonCollapsed'; // boolean
const KEY_SHOW_SIDEBAR = 'calendar.showSidebar';   // boolean
const KEY_VIEW = 'calendar.view';                  // 'day' | 'workweek' | 'week' | 'month'
const KEY_COLOR_OVERRIDES = 'calendar.colorOverrides'; // Record<id, color>
const KEY_NAME_OVERRIDES = 'calendar.nameOverrides';   // Record<id, name>
const KEY_HIDDEN_LOCALLY = 'calendar.hiddenLocally'; // Record<id, boolean>

export interface CalendarGroup {
  id: string;
  name: string;
  calendarIds: string[];
  builtin?: boolean; // Built-in groups like 'mine' cannot be deleted
}

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

// ── Groups ────────────────────────────────────────────────────
const DEFAULT_GROUPS: CalendarGroup[] = [
  { id: 'mine', name: 'Mes calendriers', calendarIds: [], builtin: true },
];

export function getCalendarGroups(): CalendarGroup[] {
  const g = readJSON<CalendarGroup[]>(KEY_GROUPS, DEFAULT_GROUPS);
  if (!g.find(x => x.id === 'mine')) g.unshift({ id: 'mine', name: 'Mes calendriers', calendarIds: [], builtin: true });
  return g;
}

export function setCalendarGroups(groups: CalendarGroup[]) {
  writeJSON(KEY_GROUPS, groups);
}

export function createGroup(name: string): CalendarGroup {
  const groups = getCalendarGroups();
  const group: CalendarGroup = {
    id: 'g-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: name.trim() || 'Nouveau groupe',
    calendarIds: [],
  };
  groups.push(group);
  setCalendarGroups(groups);
  return group;
}

export function renameGroup(id: string, name: string) {
  const groups = getCalendarGroups();
  const g = groups.find(x => x.id === id);
  if (g) { g.name = name.trim() || g.name; setCalendarGroups(groups); }
}

export function deleteGroup(id: string) {
  const groups = getCalendarGroups().filter(g => g.id !== id || g.builtin);
  setCalendarGroups(groups);
}

export function moveCalendarToGroup(calendarId: string, targetGroupId: string, targetIndex?: number) {
  const groups = getCalendarGroups();
  groups.forEach(g => { g.calendarIds = g.calendarIds.filter(id => id !== calendarId); });
  const target = groups.find(g => g.id === targetGroupId) || groups[0];
  if (typeof targetIndex === 'number' && targetIndex >= 0 && targetIndex <= target.calendarIds.length) {
    target.calendarIds.splice(targetIndex, 0, calendarId);
  } else {
    target.calendarIds.push(calendarId);
  }
  setCalendarGroups(groups);
}

export function reorderGroups(orderedIds: string[]) {
  const groups = getCalendarGroups();
  const sorted = [...groups].sort((a, b) => {
    const ia = orderedIds.indexOf(a.id);
    const ib = orderedIds.indexOf(b.id);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  });
  setCalendarGroups(sorted);
}

// Given a calendars list, return them organised by group, assigning any
// calendar not yet placed to the default "mine" group.
export function arrangeCalendars(calendars: Calendar[]): { group: CalendarGroup; calendars: Calendar[] }[] {
  const groups = getCalendarGroups();
  const byId = new Map(calendars.map(c => [c.id, c] as const));
  const assigned = new Set<string>();
  const out: { group: CalendarGroup; calendars: Calendar[] }[] = [];
  for (const g of groups) {
    const items: Calendar[] = [];
    for (const cid of g.calendarIds) {
      const cal = byId.get(cid);
      if (cal) { items.push(cal); assigned.add(cal.id); }
    }
    out.push({ group: g, calendars: items });
  }
  // Auto-assign new calendars to "mine"
  const newcomers = calendars.filter(c => !assigned.has(c.id));
  if (newcomers.length) {
    const mine = out.find(x => x.group.id === 'mine');
    if (mine) {
      for (const c of newcomers) {
        mine.calendars.push(c);
        mine.group.calendarIds.push(c.id);
      }
      setCalendarGroups(out.map(o => o.group));
    }
  }
  return out;
}

// ── Expanded state ────────────────────────────────────────────
export function getExpandedGroups(): Record<string, boolean> {
  return readJSON<Record<string, boolean>>(KEY_EXPANDED_GROUPS, {});
}

export function setGroupExpanded(id: string, expanded: boolean) {
  const map = getExpandedGroups();
  map[id] = expanded;
  writeJSON(KEY_EXPANDED_GROUPS, map);
}

export function isGroupExpanded(id: string): boolean {
  const map = getExpandedGroups();
  return map[id] !== false; // default expanded
}

// ── Ribbon ────────────────────────────────────────────────────
export function getRibbonMode(): 'classic' | 'simplified' {
  const v = localStorage.getItem(KEY_RIBBON_MODE);
  return v === 'simplified' ? 'simplified' : 'classic';
}
export function setRibbonMode(m: 'classic' | 'simplified') {
  localStorage.setItem(KEY_RIBBON_MODE, m);
}
export function getRibbonCollapsed(): boolean {
  return localStorage.getItem(KEY_RIBBON_COLLAPSED) === 'true';
}
export function setRibbonCollapsed(v: boolean) {
  localStorage.setItem(KEY_RIBBON_COLLAPSED, String(v));
}

// ── Sidebar ───────────────────────────────────────────────────
export function getShowSidebar(): boolean {
  const v = localStorage.getItem(KEY_SHOW_SIDEBAR);
  return v === null ? true : v === 'true';
}
export function setShowSidebar(v: boolean) {
  localStorage.setItem(KEY_SHOW_SIDEBAR, String(v));
}

// ── View ──────────────────────────────────────────────────────
export type CalendarView = 'day' | 'workweek' | 'week' | 'month';
export function getCalendarView(): CalendarView {
  const v = localStorage.getItem(KEY_VIEW);
  return (v === 'day' || v === 'workweek' || v === 'week' || v === 'month') ? v : 'week';
}
export function setCalendarView(v: CalendarView) {
  localStorage.setItem(KEY_VIEW, v);
}

// ── Local name/color overrides (persist even if backend rejects) ──
export function getColorOverrides(): Record<string, string> {
  return readJSON(KEY_COLOR_OVERRIDES, {});
}
export function setColorOverride(id: string, color: string | null) {
  const map = getColorOverrides();
  if (color) map[id] = color; else delete map[id];
  writeJSON(KEY_COLOR_OVERRIDES, map);
}
export function getNameOverrides(): Record<string, string> {
  return readJSON(KEY_NAME_OVERRIDES, {});
}
export function setNameOverride(id: string, name: string | null) {
  const map = getNameOverrides();
  if (name) map[id] = name; else delete map[id];
  writeJSON(KEY_NAME_OVERRIDES, map);
}

// Local-only visibility flag (in addition to server is_visible). Useful for
// "hide this calendar only on this device" or optimistic toggling.
export function getHiddenLocally(): Record<string, boolean> {
  return readJSON(KEY_HIDDEN_LOCALLY, {});
}
export function setHiddenLocally(id: string, hidden: boolean) {
  const map = getHiddenLocally();
  if (hidden) map[id] = true; else delete map[id];
  writeJSON(KEY_HIDDEN_LOCALLY, map);
}

export const CALENDAR_COLORS = [
  '#0078D4', '#0099BC', '#00B294', '#498205', '#107C10',
  '#767676', '#5C2E91', '#8764B8', '#881798', '#B4009E',
  '#E3008C', '#E74856', '#D13438', '#CA5010', '#FF8C00',
  '#FFB900', '#986F0B',
];
