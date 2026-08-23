import { Router } from 'express';
import { z } from 'zod';
import sanitizeHtml from 'sanitize-html';
import { AuthRequest } from '../middleware/auth';
import { pool } from '../database/connection';
import { logger } from '../utils/logger';

export const notesRouter = Router();

/**
 * Bloc-notes personnel.
 *
 * Une note appartient à un seul utilisateur (pas de partage : c'est un
 * presse-papier privé, pas un modèle de mail — pour du contenu partagé, les
 * modèles de mail existent déjà, voir routes/mailTemplates.ts).
 *
 * Le corps est stocké deux fois : `content_html` (ce qui est réinjecté dans la
 * fenêtre de composition) et `content_text` (projection texte utilisée par la
 * recherche plein texte et l'aperçu en liste). La projection est calculée ici,
 * jamais côté SQL.
 */

// Même liste blanche que les modèles de mail : du HTML « qualité composition »,
// sans script ni style hors attributs autorisés. Une note finit dans le corps
// d'un e-mail, elle doit donc respecter les mêmes contraintes.
const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'br', 'b', 'i', 'u', 's', 'strong', 'em', 'strike', 'del', 'ins',
    'a', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'span', 'div', 'sub', 'sup',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'hr', 'img',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    span: ['style'],
    div: ['style'],
    p: ['style'],
    table: ['style'],
    td: ['style', 'colspan', 'rowspan'],
    th: ['style', 'colspan', 'rowspan'],
    img: ['src', 'alt', 'title', 'width', 'height', 'style'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'data'],
  allowedSchemesByTag: { img: ['http', 'https', 'data', 'cid'] },
};

const MAX_HTML = 500_000;

const NOTE_COLORS = ['default', 'yellow', 'green', 'blue', 'pink', 'purple', 'orange'] as const;

const upsertSchema = z.object({
  title: z.string().trim().max(255).optional().default(''),
  contentHtml: z.string().max(MAX_HTML).optional().default(''),
  color: z.enum(NOTE_COLORS).optional().default('default'),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional().default([]),
  isPinned: z.boolean().optional().default(false),
  sourcePath: z.string().max(2048).nullable().optional(),
});

// PATCH partiel : tout est optionnel, seules les clés présentes sont écrites.
const patchSchema = upsertSchema.partial();

type NoteRow = {
  id: string;
  user_id: string;
  title: string;
  content_html: string;
  content_text: string;
  color: string;
  tags: string[];
  is_pinned: boolean;
  source_path: string | null;
  created_at: string;
  updated_at: string;
};

function rowToDto(r: NoteRow) {
  return {
    id: r.id,
    title: r.title,
    contentHtml: r.content_html,
    contentText: r.content_text,
    color: r.color,
    tags: Array.isArray(r.tags) ? r.tags : [],
    isPinned: r.is_pinned,
    sourcePath: r.source_path,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * Projection texte du HTML d'une note : sert à la recherche plein texte et à
 * l'extrait affiché en liste. On garde les sauts de ligne implicites des
 * blocs (<br>, </p>, </li>…) pour que l'extrait reste lisible.
 */
function htmlToText(html: string): string {
  return sanitizeHtml(
    html
      .replace(/<\s*br\s*\/?\s*>/gi, '\n')
      .replace(/<\s*\/\s*(p|div|li|tr|h[1-6]|blockquote|pre)\s*>/gi, '\n'),
    { allowedTags: [], allowedAttributes: {} },
  )
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Titre implicite : première ligne non vide du contenu, tronquée. */
function deriveTitle(title: string, text: string): string {
  const explicit = title.trim();
  if (explicit) return explicit.slice(0, 255);
  const firstLine = text.split('\n').map(l => l.trim()).find(Boolean) || '';
  return firstLine.slice(0, 120) || 'Note sans titre';
}

/**
 * GET /api/notes?q=…&limit=…
 *
 * Sans `q`, renvoie les notes de l'utilisateur (épinglées d'abord, puis les
 * plus récemment modifiées). Avec `q`, filtre en plein texte français avec
 * repli ILIKE : websearch_to_tsquery ne matche que des mots entiers, or on veut
 * aussi que « factur » trouve « facture » pendant que l'utilisateur tape.
 */
notesRouter.get('/', async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '200'), 10) || 200, 1), 500);

    if (!q) {
      const r = await pool.query<NoteRow>(
        `SELECT * FROM notes
          WHERE user_id = $1
          ORDER BY is_pinned DESC, updated_at DESC
          LIMIT $2`,
        [userId, limit],
      );
      return res.json(r.rows.map(rowToDto));
    }

    const r = await pool.query<NoteRow>(
      `SELECT * FROM notes
        WHERE user_id = $1
          AND (
            to_tsvector('french', coalesce(title,'') || ' ' || coalesce(content_text,''))
              @@ websearch_to_tsquery('french', $2)
            OR title ILIKE $3
            OR content_text ILIKE $3
          )
        ORDER BY is_pinned DESC, updated_at DESC
        LIMIT $4`,
      [userId, q, `%${q}%`, limit],
    );
    res.json(r.rows.map(rowToDto));
  } catch (error: any) {
    logger.error(error, 'notes list error');
    res.status(500).json({ error: 'Erreur lors du chargement des notes' });
  }
});

notesRouter.get('/:id', async (req: AuthRequest, res) => {
  try {
    const r = await pool.query<NoteRow>(
      `SELECT * FROM notes WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.userId!],
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Note introuvable' });
    res.json(rowToDto(r.rows[0]));
  } catch (error: any) {
    logger.error(error, 'notes get error');
    res.status(500).json({ error: 'Erreur lors du chargement de la note' });
  }
});

notesRouter.post('/', async (req: AuthRequest, res) => {
  try {
    const parse = upsertSchema.safeParse(req.body);
    if (!parse.success) return res.status(400).json({ error: 'Note invalide' });
    const { title, contentHtml, color, tags, isPinned, sourcePath } = parse.data;

    const safeHtml = sanitizeHtml(contentHtml, SANITIZE_OPTIONS);
    const text = htmlToText(safeHtml);

    const r = await pool.query<NoteRow>(
      `INSERT INTO notes (user_id, title, content_html, content_text, color, tags, is_pinned, source_path)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
       RETURNING *`,
      [
        req.userId!,
        deriveTitle(title, text),
        safeHtml,
        text,
        color,
        JSON.stringify(tags),
        isPinned,
        sourcePath ?? null,
      ],
    );
    res.status(201).json(rowToDto(r.rows[0]));
  } catch (error: any) {
    logger.error(error, 'notes create error');
    res.status(500).json({ error: 'Erreur lors de la création de la note' });
  }
});

notesRouter.put('/:id', async (req: AuthRequest, res) => {
  try {
    const parse = patchSchema.safeParse(req.body);
    if (!parse.success) return res.status(400).json({ error: 'Note invalide' });
    const d = parse.data;

    const existing = await pool.query<NoteRow>(
      `SELECT * FROM notes WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.userId!],
    );
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Note introuvable' });
    const cur = existing.rows[0];

    // Le HTML n'est re-nettoyé (et le texte reprojeté) que s'il est fourni :
    // un simple « épingler » ne doit pas repasser le corps au sanitizer.
    const safeHtml = d.contentHtml !== undefined
      ? sanitizeHtml(d.contentHtml, SANITIZE_OPTIONS)
      : cur.content_html;
    const text = d.contentHtml !== undefined ? htmlToText(safeHtml) : cur.content_text;
    const nextTitle = d.title !== undefined || d.contentHtml !== undefined
      ? deriveTitle(d.title ?? cur.title, text)
      : cur.title;

    const r = await pool.query<NoteRow>(
      `UPDATE notes
          SET title = $1, content_html = $2, content_text = $3,
              color = $4, tags = $5::jsonb, is_pinned = $6, source_path = $7,
              updated_at = NOW()
        WHERE id = $8 AND user_id = $9
        RETURNING *`,
      [
        nextTitle,
        safeHtml,
        text,
        d.color ?? cur.color,
        JSON.stringify(d.tags ?? (Array.isArray(cur.tags) ? cur.tags : [])),
        d.isPinned ?? cur.is_pinned,
        d.sourcePath !== undefined ? d.sourcePath : cur.source_path,
        req.params.id,
        req.userId!,
      ],
    );
    res.json(rowToDto(r.rows[0]));
  } catch (error: any) {
    logger.error(error, 'notes update error');
    res.status(500).json({ error: 'Erreur lors de l\'enregistrement de la note' });
  }
});

notesRouter.delete('/:id', async (req: AuthRequest, res) => {
  try {
    const r = await pool.query(
      `DELETE FROM notes WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.userId!],
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Note introuvable' });
    res.json({ ok: true });
  } catch (error: any) {
    logger.error(error, 'notes delete error');
    res.status(500).json({ error: 'Erreur lors de la suppression de la note' });
  }
});
