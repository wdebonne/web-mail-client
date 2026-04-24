import { Router } from 'express';
import { pool } from '../database/connection';
import { buildIcs } from '../utils/ical';

export const calendarPublicRouter = Router();

type PublicPermission = 'busy' | 'titles' | 'read';

async function loadPublicShare(token: string) {
  const r = await pool.query(
    `SELECT ecs.calendar_id, ecs.permission, c.name, c.color, c.description, c.user_id
       FROM external_calendar_shares ecs
       JOIN calendars c ON c.id = ecs.calendar_id
      WHERE ecs.public_token = $1 AND ecs.share_type = 'public_link'
        AND (ecs.expires_at IS NULL OR ecs.expires_at > NOW())
      LIMIT 1`,
    [token]
  );
  return r.rows[0] || null;
}

async function loadEvents(calendarId: string) {
  const r = await pool.query(
    `SELECT * FROM calendar_events WHERE calendar_id = $1 ORDER BY start_date ASC`,
    [calendarId]
  );
  return r.rows;
}

/** Strip fields from event rows according to permission. */
function applyPermission(rows: any[], permission: PublicPermission): any[] {
  if (permission === 'read') return rows;
  return rows.map((ev) => {
    const base: any = { ...ev };
    // Always drop ical_data so the serializer rebuilds from the (filtered) fields.
    base.ical_data = null;
    base.attendees = null;
    base.organizer = null;
    base.attachments = null;
    base.url = null;
    base.description = null;
    if (permission === 'busy') {
      base.title = 'Occupé(e)';
      base.location = null;
      base.categories = null;
      base.transparency = 'OPAQUE';
      base.priority = null;
    }
    // 'titles' keeps title + location only
    return base;
  });
}

// .ics feed -------------------------------------------------------------------
calendarPublicRouter.get('/:token.ics', async (req, res) => {
  try {
    const share = await loadPublicShare(req.params.token);
    if (!share) return res.status(404).send('Calendrier introuvable');
    const events = await loadEvents(share.calendar_id);
    const filtered = applyPermission(events, share.permission as PublicPermission);
    const ics = buildIcs(share.name, filtered);
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `inline; filename="${share.name.replace(/[^a-zA-Z0-9_-]+/g, '_')}.ics"`);
    res.send(ics);
  } catch (error: any) {
    res.status(500).send(error.message);
  }
});

// JSON feed (useful for custom embeds) ---------------------------------------
calendarPublicRouter.get('/:token.json', async (req, res) => {
  try {
    const share = await loadPublicShare(req.params.token);
    if (!share) return res.status(404).json({ error: 'Calendrier introuvable' });
    const events = await loadEvents(share.calendar_id);
    const filtered = applyPermission(events, share.permission as PublicPermission);
    res.json({
      calendar: { name: share.name, color: share.color, description: share.description },
      permission: share.permission,
      events: filtered.map((e: any) => ({
        id: e.id,
        title: e.title,
        location: e.location,
        description: e.description,
        start: e.start_date,
        end: e.end_date,
        allDay: e.all_day,
        status: e.status,
        recurrenceRule: e.recurrence_rule,
      })),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// HTML viewer -----------------------------------------------------------------
function htmlEscape(s: string | null | undefined): string {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtRange(ev: any, locale = 'fr-FR'): string {
  const start = new Date(ev.start_date);
  const end = new Date(ev.end_date);
  if (ev.all_day) {
    const d = start.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    return `${d} — Toute la journée`;
  }
  const sameDay = start.toDateString() === end.toDateString();
  if (sameDay) {
    const d = start.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const hs = start.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    const he = end.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    return `${d} · ${hs} – ${he}`;
  }
  return `${start.toLocaleString(locale)} → ${end.toLocaleString(locale)}`;
}

calendarPublicRouter.get('/:token', async (req, res) => {
  try {
    const share = await loadPublicShare(req.params.token);
    if (!share) {
      res.status(404).send('<!doctype html><meta charset="utf-8"><title>Calendrier introuvable</title><p style="font-family:sans-serif;padding:2rem">Calendrier introuvable ou lien expiré.</p>');
      return;
    }
    const events = await loadEvents(share.calendar_id);
    const filtered = applyPermission(events, share.permission as PublicPermission);

    // Keep only upcoming + a window of past events to keep HTML light
    const now = Date.now();
    const visible = filtered.filter((e: any) => {
      const end = new Date(e.end_date).getTime();
      return end >= now - 30 * 24 * 3600 * 1000; // last 30 days + future
    }).slice(0, 300);

    const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
    const host = (req.headers['x-forwarded-host'] as string) || req.headers.host;
    const icsUrl = `${proto}://${host}/api/public/calendar/${req.params.token}.ics`;

    const permLabel =
      share.permission === 'busy' ? 'disponibilités uniquement'
      : share.permission === 'titles' ? 'titres et lieux'
      : 'tous les détails';

    const color = share.color || '#0078d4';

    const rows = visible.map((ev: any) => {
      const title = htmlEscape(ev.title || '(sans titre)');
      const loc = ev.location ? `<div class="meta">📍 ${htmlEscape(ev.location)}</div>` : '';
      const desc = ev.description ? `<div class="desc">${htmlEscape(ev.description)}</div>` : '';
      return `<li class="event">
        <div class="date">${htmlEscape(fmtRange(ev))}</div>
        <div class="title">${title}</div>
        ${loc}${desc}
      </li>`;
    }).join('');

    const html = `<!doctype html>
<html lang="fr"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${htmlEscape(share.name)} — Calendrier partagé</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; background: #f4f5f7; color: #24292f; }
  @media (prefers-color-scheme: dark) { body { background: #0d1117; color: #e6edf3; } .card { background: #161b22 !important; border-color: #30363d !important; } .event { border-color: #30363d !important; } .meta, .desc, .sub { color: #8b949e !important; } }
  header { background: ${htmlEscape(color)}; color: white; padding: 1.5rem; }
  header h1 { margin: 0; font-size: 1.4rem; }
  header .sub { opacity: .9; margin-top: .25rem; font-size: .85rem; }
  main { max-width: 760px; margin: 1.5rem auto; padding: 0 1rem; }
  .card { background: white; border: 1px solid #d0d7de; border-radius: 10px; overflow: hidden; }
  .toolbar { display: flex; gap: .5rem; padding: .75rem 1rem; border-bottom: 1px solid #d0d7de; background: rgba(0,0,0,.02); flex-wrap: wrap; }
  .btn { display: inline-flex; align-items: center; gap: .35rem; padding: .4rem .75rem; border-radius: 6px; border: 1px solid #d0d7de; text-decoration: none; color: inherit; font-size: .85rem; background: white; }
  .btn.primary { background: ${htmlEscape(color)}; color: white; border-color: transparent; }
  ul.events { list-style: none; margin: 0; padding: 0; }
  .event { padding: .85rem 1rem; border-bottom: 1px solid #eaecef; }
  .event:last-child { border-bottom: none; }
  .date { font-size: .8rem; color: #57606a; margin-bottom: .2rem; }
  .title { font-weight: 600; }
  .meta { font-size: .8rem; color: #57606a; margin-top: .15rem; }
  .desc { font-size: .85rem; color: #57606a; margin-top: .35rem; white-space: pre-wrap; }
  .empty { padding: 2rem; text-align: center; color: #57606a; }
  footer { text-align: center; font-size: .75rem; color: #8b949e; margin: 2rem 0; }
</style>
</head><body>
<header>
  <h1>${htmlEscape(share.name)}</h1>
  <div class="sub">Calendrier partagé en lecture seule — ${htmlEscape(permLabel)}</div>
</header>
<main>
  <div class="card">
    <div class="toolbar">
      <a class="btn primary" href="${htmlEscape(icsUrl)}" download>📥 Télécharger (.ics)</a>
      <a class="btn" href="webcal://${htmlEscape(host + '/api/public/calendar/' + req.params.token + '.ics')}">📅 S'abonner</a>
      <button class="btn" onclick="navigator.clipboard.writeText('${htmlEscape(icsUrl)}'); this.textContent='✔ Copié';">🔗 Copier le lien</button>
    </div>
    ${visible.length === 0
      ? '<div class="empty">Aucun évènement à venir.</div>'
      : `<ul class="events">${rows}</ul>`}
  </div>
  <footer>Calendrier servi par votre messagerie · ${visible.length} évènement(s)</footer>
</main>
</body></html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.send(html);
  } catch (error: any) {
    res.status(500).send(error.message);
  }
});
