import { pool } from '../database/connection';
import { notifyWithPush } from './websocket';
import { logger } from '../utils/logger';

/**
 * Periodically scans calendar_events for upcoming reminders (VALARM) and
 * dispatches a Web Push + WebSocket notification to the calendar owner.
 *
 * Strategy
 * --------
 * - Runs every INTERVAL_MS (default 60s, min 30s) via NEW_MAIL_POLL_INTERVAL_MS
 *   override or its own env CALENDAR_REMINDER_POLL_INTERVAL_MS.
 * - Selects events with `reminder_minutes IS NOT NULL` and
 *   `reminder_sent_at IS NULL` whose trigger time
 *   (start_date - reminder_minutes minutes) is in the past *and* whose
 *   start_date is still within the future or recent past (configurable
 *   GRACE window, default 1h) so we don't spam old events at boot time.
 * - Recurring events (recurrence_rule IS NOT NULL) are intentionally skipped
 *   in this first iteration — proper RRULE expansion would require tracking
 *   per-occurrence delivery state. They can be handled in a follow-up.
 * - On success, `reminder_sent_at` is set to NOW(), preventing repeats.
 */

const INTERVAL_MS = Math.max(
  30_000,
  Number(process.env.CALENDAR_REMINDER_POLL_INTERVAL_MS) || 60_000
);
const GRACE_MS = Math.max(
  60_000,
  Number(process.env.CALENDAR_REMINDER_GRACE_MS) || 60 * 60 * 1000
);

function formatStart(start: Date, allDay: boolean): string {
  try {
    if (allDay) {
      return start.toLocaleDateString('fr-FR', {
        weekday: 'long',
        day: '2-digit',
        month: 'long',
      });
    }
    return start.toLocaleString('fr-FR', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return start.toISOString();
  }
}

function relativeMinutes(reminderMinutes: number): string {
  if (reminderMinutes <= 0) return 'maintenant';
  if (reminderMinutes < 60) return `dans ${reminderMinutes} min`;
  const hours = Math.round(reminderMinutes / 60);
  if (hours < 24) return `dans ${hours} h`;
  const days = Math.round(hours / 24);
  return `dans ${days} j`;
}

async function tick() {
  try {
    const result = await pool.query(
      `SELECT
          ce.id,
          ce.title,
          ce.location,
          ce.start_date,
          ce.all_day,
          ce.reminder_minutes,
          c.user_id,
          c.name AS calendar_name,
          c.color AS calendar_color
         FROM calendar_events ce
         JOIN calendars c ON c.id = ce.calendar_id
        WHERE ce.reminder_minutes IS NOT NULL
          AND ce.reminder_sent_at IS NULL
          AND ce.recurrence_rule IS NULL
          AND c.user_id IS NOT NULL
          AND ce.start_date - (ce.reminder_minutes || ' minutes')::interval <= NOW()
          AND ce.start_date >= NOW() - ($1 || ' milliseconds')::interval
        ORDER BY ce.start_date ASC
        LIMIT 50`,
      [GRACE_MS]
    );

    if (result.rowCount === 0) return;

    for (const row of result.rows) {
      const start: Date = row.start_date instanceof Date ? row.start_date : new Date(row.start_date);
      const reminderMinutes: number = Number(row.reminder_minutes) || 0;
      const title: string = row.title || '(Sans titre)';
      const when = formatStart(start, Boolean(row.all_day));
      const rel = relativeMinutes(reminderMinutes);
      const locationPart = row.location ? `\n📍 ${String(row.location).slice(0, 120)}` : '';

      try {
        await notifyWithPush(
          row.user_id,
          'calendar-reminder',
          {
            eventId: row.id,
            title,
            startDate: start.toISOString(),
            location: row.location || null,
            calendarId: row.calendar_id,
            calendarName: row.calendar_name,
          },
          {
            title: `⏰ ${title}`,
            body: `${when} (${rel})${locationPart}`,
            tag: `calendar-reminder-${row.id}`,
            icon: '/icon-192.png',
            badge: '/icon-192.png',
            url: `/calendar?event=${encodeURIComponent(row.id)}`,
            data: {
              eventId: row.id,
              startDate: start.toISOString(),
              type: 'calendar-reminder',
            },
            requireInteraction: true,
            renotify: true,
            silent: false,
            timestamp: Date.now(),
            vibrate: [200, 100, 200],
            actions: [
              { action: 'open', title: 'Voir' },
              { action: 'dismiss', title: 'Ignorer' },
            ],
          },
          'both'
        );

        await pool.query(
          'UPDATE calendar_events SET reminder_sent_at = NOW() WHERE id = $1',
          [row.id]
        );
      } catch (err) {
        logger.warn(
          { err, eventId: row.id, userId: row.user_id },
          'calendar-reminder notify failed'
        );
      }
    }
  } catch (err) {
    logger.error(err as Error, 'calendar-reminder poll tick failed');
  }
}

let timer: NodeJS.Timeout | null = null;

export function startCalendarReminderPoller() {
  if (timer) return;
  logger.info(`Calendar reminder poller started (interval ${INTERVAL_MS}ms, grace ${GRACE_MS}ms)`);
  // Slight delay so DB migrations complete before first tick.
  setTimeout(() => { tick(); }, 15_000);
  timer = setInterval(tick, INTERVAL_MS);
}

export function stopCalendarReminderPoller() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
