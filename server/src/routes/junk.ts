import { Router } from 'express';
import { z } from 'zod';
import https from 'https';
import http from 'http';
import net from 'net';
import { AuthRequest, adminMiddleware } from '../middleware/auth';
import { pool } from '../database/connection';
import { logger } from '../utils/logger';
import { MailService } from '../services/mail';
import { getAccountForUser } from './mail';
import { isBlockedAddress, safeLookup } from './imageProxy';
import {
  loadAdminDefaults, getAdminDefaults, getUserConfig, loadLists, applyJunkFilter,
  resolveJunkFolder, normalizeAddress, domainOf, evaluateJunk,
} from '../services/junkFilter';

export const junkRouter = Router();
export const adminJunkRouter = Router();

adminJunkRouter.use(adminMiddleware);

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Normalise une valeur saisie par l'utilisateur en couple (kind, pattern).
 * Accepte « jean@exemple.fr », « @exemple.fr », « exemple.fr » et
 * « Jean Dupont <jean@exemple.fr> ».
 */
function parsePattern(raw: string): { kind: 'address' | 'domain'; pattern: string } | null {
  const value = String(raw || '').trim().toLowerCase();
  if (!value) return null;

  const angle = value.match(/<([^>]+)>/);
  const candidate = (angle ? angle[1] : value).trim();

  if (candidate.startsWith('@')) {
    const domain = candidate.slice(1);
    return isPlausibleDomain(domain) ? { kind: 'domain', pattern: domain } : null;
  }
  if (candidate.includes('@')) {
    const [local, domain] = [candidate.slice(0, candidate.lastIndexOf('@')), candidate.slice(candidate.lastIndexOf('@') + 1)];
    if (!local || !isPlausibleDomain(domain)) return null;
    return { kind: 'address', pattern: candidate };
  }
  return isPlausibleDomain(candidate) ? { kind: 'domain', pattern: candidate } : null;
}

function isPlausibleDomain(domain: string): boolean {
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)
    && domain.length <= 255;
}

function senderRowToDto(row: any) {
  return {
    id: row.id,
    listType: row.list_type as 'blocked' | 'safe',
    kind: row.kind as 'address' | 'domain',
    pattern: row.pattern,
    /** Entrée posée par un administrateur : lecture seule côté utilisateur. */
    global: row.user_id === null,
    note: row.note || null,
    hitCount: Number(row.hit_count) || 0,
    lastHitAt: row.last_hit_at,
    createdAt: row.created_at,
  };
}

/** Insère (ou met à jour) une entrée de liste. `userId` null = entrée globale admin. */
async function upsertSender(
  userId: string | null,
  listType: 'blocked' | 'safe',
  kind: 'address' | 'domain',
  pattern: string,
  note: string | null,
) {
  if (userId === null) {
    const r = await pool.query(
      `INSERT INTO junk_senders (user_id, list_type, kind, pattern, note)
       VALUES (NULL, $1, $2, $3, $4)
       ON CONFLICT (list_type, pattern) WHERE user_id IS NULL
       DO UPDATE SET kind = EXCLUDED.kind, note = EXCLUDED.note
       RETURNING *`,
      [listType, kind, pattern, note],
    );
    return r.rows[0];
  }
  const r = await pool.query(
    `INSERT INTO junk_senders (user_id, list_type, kind, pattern, note)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, list_type, pattern) WHERE user_id IS NOT NULL
     DO UPDATE SET kind = EXCLUDED.kind, note = EXCLUDED.note
     RETURNING *`,
    [userId, listType, kind, pattern, note],
  );
  return r.rows[0];
}

/** Retire un motif d'une liste (entrées personnelles uniquement). */
async function removeSender(userId: string, listType: 'blocked' | 'safe', patterns: string[]) {
  if (patterns.length === 0) return 0;
  const r = await pool.query(
    `DELETE FROM junk_senders
      WHERE user_id = $1 AND list_type = $2 AND pattern = ANY($3::text[])`,
    [userId, listType, patterns],
  );
  return r.rowCount || 0;
}

// ─── Réglages utilisateur ─────────────────────────────────────────────

junkRouter.get('/settings', async (req: AuthRequest, res) => {
  try {
    await loadAdminDefaults();
    const defaults = getAdminDefaults();
    const config = await getUserConfig(req.userId!);
    const explicit = await pool.query('SELECT 1 FROM junk_settings WHERE user_id = $1', [req.userId!]);
    res.json({
      featureEnabled: defaults.featureEnabled,
      /** false = l'utilisateur n'a jamais rien réglé, il hérite des défauts admin. */
      customized: explicit.rowCount! > 0,
      settings: config,
      defaults: {
        enabled: defaults.enabled,
        serverFilter: defaults.serverFilter,
        trustContacts: defaults.trustContacts,
        purgeDays: defaults.purgeDays,
      },
    });
  } catch (error: any) {
    logger.error(error, 'junk: lecture des réglages échouée');
    res.status(500).json({ error: 'Erreur de lecture des réglages' });
  }
});

const settingsSchema = z.object({
  enabled: z.boolean(),
  serverFilter: z.enum(['off', 'normal', 'strict']),
  trustContacts: z.boolean(),
  purgeDays: z.number().int().min(0).max(365),
});

junkRouter.put('/settings', async (req: AuthRequest, res) => {
  try {
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Réglages invalides', details: parsed.error.flatten() });
    }
    const { enabled, serverFilter, trustContacts, purgeDays } = parsed.data;
    await pool.query(
      `INSERT INTO junk_settings (user_id, enabled, server_filter, trust_contacts, purge_days, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (user_id) DO UPDATE
         SET enabled = EXCLUDED.enabled,
             server_filter = EXCLUDED.server_filter,
             trust_contacts = EXCLUDED.trust_contacts,
             purge_days = EXCLUDED.purge_days,
             updated_at = NOW()`,
      [req.userId!, enabled, serverFilter, trustContacts, purgeDays],
    );
    res.json({ success: true, settings: parsed.data });
  } catch (error: any) {
    logger.error(error, 'junk: enregistrement des réglages échoué');
    res.status(500).json({ error: 'Erreur d\'enregistrement des réglages' });
  }
});

// ─── Listes d'expéditeurs ─────────────────────────────────────────────

junkRouter.get('/senders', async (req: AuthRequest, res) => {
  try {
    const listType = req.query.type === 'safe' ? 'safe' : req.query.type === 'blocked' ? 'blocked' : null;
    const params: any[] = [req.userId!];
    let where = '(user_id = $1 OR user_id IS NULL)';
    if (listType) {
      params.push(listType);
      where += ` AND list_type = $${params.length}`;
    }
    const r = await pool.query(
      `SELECT * FROM junk_senders WHERE ${where}
        ORDER BY list_type, (user_id IS NULL), pattern`,
      params,
    );
    res.json(r.rows.map(senderRowToDto));
  } catch (error: any) {
    logger.error(error, 'junk: listage des expéditeurs échoué');
    res.status(500).json({ error: 'Erreur de lecture des listes' });
  }
});

const addSenderSchema = z.object({
  listType: z.enum(['blocked', 'safe']),
  value: z.string().trim().min(3).max(320),
  note: z.string().max(500).optional(),
});

junkRouter.post('/senders', async (req: AuthRequest, res) => {
  try {
    const parsed = addSenderSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Valeur invalide' });

    const target = parsePattern(parsed.data.value);
    if (!target) {
      return res.status(400).json({ error: 'Saisissez une adresse (jean@exemple.fr) ou un domaine (exemple.fr)' });
    }

    // Une même valeur ne peut pas être simultanément bloquée et autorisée :
    // ajouter dans une liste la retire de l'autre, sans quoi la règle
    // « autorisé gagne toujours » rendrait le blocage silencieusement inopérant.
    const opposite = parsed.data.listType === 'blocked' ? 'safe' : 'blocked';
    await removeSender(req.userId!, opposite, [target.pattern]);

    const row = await upsertSender(req.userId!, parsed.data.listType, target.kind, target.pattern, parsed.data.note ?? null);
    res.status(201).json(senderRowToDto(row));
  } catch (error: any) {
    logger.error(error, 'junk: ajout d\'expéditeur échoué');
    res.status(500).json({ error: 'Erreur d\'ajout' });
  }
});

junkRouter.delete('/senders/:id', async (req: AuthRequest, res) => {
  try {
    const r = await pool.query(
      'DELETE FROM junk_senders WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId!],
    );
    if (r.rowCount === 0) {
      return res.status(404).json({ error: 'Entrée introuvable (les entrées globales sont gérées par l\'administrateur)' });
    }
    res.json({ success: true });
  } catch (error: any) {
    logger.error(error, 'junk: suppression d\'expéditeur échouée');
    res.status(500).json({ error: 'Erreur de suppression' });
  }
});

// ─── Bloquer / débloquer depuis un message ────────────────────────────

const blockSchema = z.object({
  accountId: z.string().uuid(),
  address: z.string().trim().min(3).max(320),
  scope: z.enum(['address', 'domain']).default('address'),
  /** Déplacer aussi les messages déjà reçus de cet expéditeur. */
  sweep: z.boolean().optional().default(false),
  /** Dossier à balayer (par défaut INBOX). */
  folder: z.string().max(255).optional(),
});

/**
 * Bloque un expéditeur et, si demandé, déplace immédiatement ses messages déjà
 * présents dans le dossier. C'est le seul chemin par lequel des messages
 * anciens sont déplacés : le service de fond, lui, ne touche qu'aux nouveaux.
 */
junkRouter.post('/block', async (req: AuthRequest, res) => {
  try {
    const parsed = blockSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Requête invalide' });
    const { accountId, scope, sweep } = parsed.data;

    const address = normalizeAddress(parsed.data.address);
    if (!address) return res.status(400).json({ error: 'Adresse d\'expéditeur illisible' });

    const pattern = scope === 'domain' ? domainOf(address) : address;
    if (!pattern) return res.status(400).json({ error: 'Domaine illisible' });

    const account = await getAccountForUser(accountId, req.userId!);
    if (!account) return res.status(404).json({ error: 'Compte non trouvé' });

    await removeSender(req.userId!, 'safe', [pattern]);
    const row = await upsertSender(req.userId!, 'blocked', scope, pattern, null);

    let moved = 0;
    let junkFolder: string | null = null;
    if (sweep) {
      const service = new MailService(account);
      const folder = parsed.data.folder || 'INBOX';
      junkFolder = await resolveJunkFolder(service, account.id);
      // Blocage depuis le dossier indésirable lui-même : rien à balayer, les
      // messages y sont déjà (et un déplacement sur place échouerait).
      const uids = folder === junkFolder ? [] : await service.findUidsFromSenders(folder, [pattern]).catch((err) => {
        logger.debug({ err, accountId }, 'junk: recherche des messages à balayer échouée');
        return [] as number[];
      });
      if (uids.length > 0) {
        try {
          await service.moveMessages(folder, uids, junkFolder);
          moved = uids.length;
        } catch (err) {
          logger.warn({ err, accountId }, 'junk: balayage partiel — déplacement groupé refusé');
          // Repli message par message : un seul UID en échec ne doit pas
          // annuler tout le balayage.
          for (const uid of uids) {
            try {
              await service.moveMessage(folder, uid, junkFolder);
              moved += 1;
            } catch { /* message déjà déplacé ou supprimé entre-temps */ }
          }
        }
      }
    }

    res.json({ success: true, entry: senderRowToDto(row), moved, junkFolder });
  } catch (error: any) {
    logger.error(error, 'junk: blocage échoué');
    res.status(500).json({ error: error.message || 'Erreur de blocage' });
  }
});

const notJunkSchema = z.object({
  accountId: z.string().uuid(),
  address: z.string().trim().max(320).optional(),
  /** Message à ramener en boîte de réception (optionnel : on peut se contenter de débloquer). */
  uid: z.number().int().positive().optional(),
  folder: z.string().max(255).optional(),
  /** Ajouter l'expéditeur aux expéditeurs autorisés. */
  addToSafe: z.boolean().optional().default(true),
});

/**
 * « Ce n'est pas indésirable » : débloque l'expéditeur (adresse ET domaine),
 * l'ajoute aux autorisés, et ramène le message en boîte de réception.
 * Le pendant symétrique de /block — la réversibilité en un clic est ce qui
 * rend la fonction utilisable sans crainte.
 */
junkRouter.post('/not-junk', async (req: AuthRequest, res) => {
  try {
    const parsed = notJunkSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Requête invalide' });
    const { accountId, uid, addToSafe } = parsed.data;

    const account = await getAccountForUser(accountId, req.userId!);
    if (!account) return res.status(404).json({ error: 'Compte non trouvé' });

    const address = normalizeAddress(parsed.data.address);
    let unblocked = 0;
    if (address) {
      unblocked = await removeSender(req.userId!, 'blocked', [address, domainOf(address)]);
      if (addToSafe) await upsertSender(req.userId!, 'safe', 'address', address, null);
    }

    let restored = false;
    if (uid) {
      const service = new MailService(account);
      const from = parsed.data.folder || await resolveJunkFolder(service, account.id);
      await service.moveMessage(from, uid, 'INBOX');
      restored = true;
    }

    res.json({ success: true, unblocked, restored, address: address || null });
  } catch (error: any) {
    logger.error(error, 'junk: « pas indésirable » échoué');
    res.status(500).json({ error: error.message || 'Erreur de restauration' });
  }
});

/**
 * Pourquoi ce message serait-il (ou non) classé indésirable ? Utilisé par l'UI
 * pour expliquer le classement en langage clair plutôt que de laisser
 * l'utilisateur devant un dossier dont il ne comprend pas le remplissage.
 */
junkRouter.post('/explain', async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      address: z.string().trim().max(320),
      headers: z.record(z.string()).optional().default({}),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Requête invalide' });

    const config = await getUserConfig(req.userId!);
    const lists = await loadLists(req.userId!);
    const lowered: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed.data.headers)) lowered[k.toLowerCase()] = v;

    const verdict = await evaluateJunk(
      req.userId!,
      { from: { address: normalizeAddress(parsed.data.address) }, headers: lowered },
      config,
      lists,
    );
    res.json(verdict);
  } catch (error: any) {
    logger.error(error, 'junk: explication échouée');
    res.status(500).json({ error: 'Erreur d\'analyse' });
  }
});

// ─── Désabonnement (List-Unsubscribe, RFC 2369 / RFC 8058) ────────────

interface UnsubscribeTargets {
  mailto: { address: string; subject: string } | null;
  http: string | null;
}

/** Découpe un en-tête `List-Unsubscribe` en ses cibles mailto: et https:. */
export function parseUnsubscribeHeader(raw: string): UnsubscribeTargets {
  const out: UnsubscribeTargets = { mailto: null, http: null };
  for (const match of String(raw || '').matchAll(/<([^>]+)>/g)) {
    const target = match[1].trim();
    if (!out.mailto && target.toLowerCase().startsWith('mailto:')) {
      try {
        const url = new URL(target);
        const address = url.pathname.trim();
        if (address.includes('@')) {
          out.mailto = { address, subject: url.searchParams.get('subject') || 'unsubscribe' };
        }
      } catch { /* en-tête malformé — on ignore cette cible */ }
    } else if (!out.http && /^https?:\/\//i.test(target)) {
      out.http = target;
    }
  }
  return out;
}

/**
 * POST « one-click » RFC 8058, avec la même protection anti-SSRF que le proxy
 * d'images : l'URL provient d'un email, donc d'une source non fiable, et le
 * serveur ne doit jamais pouvoir être utilisé pour atteindre le réseau interne.
 */
function oneClickPost(urlStr: string): Promise<number> {
  return new Promise((resolve, reject) => {
    let target: URL;
    try {
      target = new URL(urlStr);
    } catch {
      return reject(new Error('URL de désabonnement invalide'));
    }
    if (target.protocol !== 'https:' && target.protocol !== 'http:') {
      return reject(new Error('Protocole de désabonnement non autorisé'));
    }
    const literalHost = target.hostname.startsWith('[') && target.hostname.endsWith(']')
      ? target.hostname.slice(1, -1)
      : target.hostname;
    if (net.isIP(literalHost) !== 0 && isBlockedAddress(literalHost)) {
      return reject(new Error('Adresse de désabonnement interdite'));
    }

    const body = 'List-Unsubscribe=One-Click';
    const client = target.protocol === 'https:' ? https : http;
    const request = client.request(
      target.toString(),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
          'User-Agent': 'Mozilla/5.0 (compatible; WebMailClient/1.0)',
        },
        timeout: 10_000,
        lookup: safeLookup as net.LookupFunction,
      },
      (response) => {
        // Le corps ne nous intéresse pas — on le draine pour libérer la socket.
        response.resume();
        resolve(response.statusCode ?? 0);
      },
    );
    request.on('timeout', () => request.destroy(new Error('Délai dépassé')));
    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

const unsubscribeSchema = z.object({
  accountId: z.string().uuid(),
  uid: z.number().int().positive(),
  folder: z.string().max(255).default('INBOX'),
});

/**
 * Désabonnement en un clic. Trois issues possibles, dans cet ordre :
 *   - `done`    : le serveur a effectué la démarche (POST one-click, ou email
 *                 de désabonnement envoyé depuis le compte de l'utilisateur) ;
 *   - `open`    : seule une URL de page web est proposée — le client l'ouvre,
 *                 l'utilisateur termine lui-même (souvent un formulaire) ;
 *   - `none`    : le message ne propose aucun mécanisme de désabonnement.
 */
junkRouter.post('/unsubscribe', async (req: AuthRequest, res) => {
  try {
    const parsed = unsubscribeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Requête invalide' });
    const { accountId, uid, folder } = parsed.data;

    const account = await getAccountForUser(accountId, req.userId!);
    if (!account) return res.status(404).json({ error: 'Compte non trouvé' });

    const service = new MailService(account);
    const message: any = await service.getMessage(folder, uid);
    const header = String(message?.headers?.listUnsubscribe || '');
    if (!header) return res.json({ outcome: 'none' });

    const targets = parseUnsubscribeHeader(header);
    const oneClick = /one-?click/i.test(String(message?.headers?.listUnsubscribePost || ''));

    // 1. One-click RFC 8058 : la voie la plus propre quand elle est annoncée.
    if (oneClick && targets.http) {
      try {
        const status = await oneClickPost(targets.http);
        if (status >= 200 && status < 400) {
          return res.json({ outcome: 'done', method: 'one-click' });
        }
        logger.debug({ status, accountId }, 'junk: one-click refusé, repli sur les autres cibles');
      } catch (err) {
        logger.debug({ err, accountId }, 'junk: one-click impossible, repli sur les autres cibles');
      }
    }

    // 2. mailto: — envoyé depuis le compte concerné, seul expéditeur que le
    //    service de diffusion reconnaîtra comme abonné.
    if (targets.mailto) {
      await service.sendMail({
        from: { email: account.email, name: account.name || account.email },
        to: [{ email: targets.mailto.address }],
        subject: targets.mailto.subject,
        html: '<p>Unsubscribe</p>',
        text: 'Unsubscribe',
        skipSentFolder: true,
      });
      return res.json({ outcome: 'done', method: 'mailto', address: targets.mailto.address });
    }

    // 3. Page web : le client l'ouvre dans un onglet.
    if (targets.http) return res.json({ outcome: 'open', url: targets.http });

    res.json({ outcome: 'none' });
  } catch (error: any) {
    logger.error(error, 'junk: désabonnement échoué');
    res.status(500).json({ error: error.message || 'Erreur de désabonnement' });
  }
});

// ─── Balayage manuel ──────────────────────────────────────────────────

/**
 * Applique le filtre aux N derniers messages de la boîte de réception, à la
 * demande. Sert de bouton « Nettoyer maintenant » : sans lui, un utilisateur
 * qui vient d'activer le filtre ne verrait rien se passer avant le prochain
 * message reçu.
 */
junkRouter.post('/sweep', async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      accountId: z.string().uuid(),
      limit: z.number().int().min(1).max(200).optional().default(100),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Requête invalide' });

    const account = await getAccountForUser(parsed.data.accountId, req.userId!);
    if (!account) return res.status(404).json({ error: 'Compte non trouvé' });

    const config = await getUserConfig(req.userId!);
    const service = new MailService(account);
    const uids = await service.listFolderUids('INBOX');
    const recent = uids.sort((a, b) => a - b).slice(-parsed.data.limit);
    const metas = await service.fetchJunkMeta('INBOX', recent);
    const moved = await applyJunkFilter(
      { id: account.id, user_id: req.userId!, email: account.email },
      metas,
      service,
      // Le balayage est déclenché explicitement : on l'exécute même si le
      // classement automatique est en veille.
      { config: { ...config, enabled: true } },
    );

    res.json({ success: true, examined: metas.length, moved: moved.length });
  } catch (error: any) {
    logger.error(error, 'junk: balayage manuel échoué');
    res.status(500).json({ error: error.message || 'Erreur de balayage' });
  }
});

// ─── Administration ───────────────────────────────────────────────────

adminJunkRouter.get('/settings', async (_req: AuthRequest, res) => {
  try {
    await loadAdminDefaults();
    const d = getAdminDefaults();
    const counts = await pool.query(
      `SELECT list_type, COUNT(*)::int AS n FROM junk_senders WHERE user_id IS NULL GROUP BY list_type`,
    );
    const globalCounts = { blocked: 0, safe: 0 };
    for (const row of counts.rows) {
      if (row.list_type === 'blocked') globalCounts.blocked = row.n;
      else globalCounts.safe = row.n;
    }
    res.json({
      featureEnabled: d.featureEnabled,
      defaults: {
        enabled: d.enabled,
        serverFilter: d.serverFilter,
        trustContacts: d.trustContacts,
        purgeDays: d.purgeDays,
      },
      globalCounts,
    });
  } catch (error: any) {
    logger.error(error, 'junk: lecture des réglages admin échouée');
    res.status(500).json({ error: 'Erreur de lecture' });
  }
});

const adminSettingsSchema = z.object({
  featureEnabled: z.boolean(),
  defaults: settingsSchema,
});

adminJunkRouter.put('/settings', async (req: AuthRequest, res) => {
  try {
    const parsed = adminSettingsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Réglages invalides' });
    const { featureEnabled, defaults } = parsed.data;

    const entries: Array<[string, string]> = [
      ['junk_enabled', String(featureEnabled)],
      ['junk_default_enabled', String(defaults.enabled)],
      ['junk_default_server_filter', JSON.stringify(defaults.serverFilter)],
      ['junk_default_trust_contacts', String(defaults.trustContacts)],
      ['junk_default_purge_days', String(defaults.purgeDays)],
    ];
    for (const [key, value] of entries) {
      await pool.query(
        `INSERT INTO admin_settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [key, value],
      );
    }
    await loadAdminDefaults();
    res.json({ success: true });
  } catch (error: any) {
    logger.error(error, 'junk: enregistrement des réglages admin échoué');
    res.status(500).json({ error: 'Erreur d\'enregistrement' });
  }
});

adminJunkRouter.get('/senders', async (_req: AuthRequest, res) => {
  try {
    const r = await pool.query(
      `SELECT * FROM junk_senders WHERE user_id IS NULL ORDER BY list_type, pattern`,
    );
    res.json(r.rows.map(senderRowToDto));
  } catch (error: any) {
    logger.error(error, 'junk: listage global échoué');
    res.status(500).json({ error: 'Erreur de lecture' });
  }
});

adminJunkRouter.post('/senders', async (req: AuthRequest, res) => {
  try {
    const parsed = addSenderSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Valeur invalide' });
    const target = parsePattern(parsed.data.value);
    if (!target) {
      return res.status(400).json({ error: 'Saisissez une adresse (jean@exemple.fr) ou un domaine (exemple.fr)' });
    }
    const row = await upsertSender(null, parsed.data.listType, target.kind, target.pattern, parsed.data.note ?? null);
    res.status(201).json(senderRowToDto(row));
  } catch (error: any) {
    logger.error(error, 'junk: ajout global échoué');
    res.status(500).json({ error: 'Erreur d\'ajout' });
  }
});

adminJunkRouter.delete('/senders/:id', async (req: AuthRequest, res) => {
  try {
    const r = await pool.query(
      'DELETE FROM junk_senders WHERE id = $1 AND user_id IS NULL',
      [req.params.id],
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Entrée introuvable' });
    res.json({ success: true });
  } catch (error: any) {
    logger.error(error, 'junk: suppression globale échouée');
    res.status(500).json({ error: 'Erreur de suppression' });
  }
});
