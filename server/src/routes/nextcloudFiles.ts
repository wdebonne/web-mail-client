import { Router } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../middleware/auth';
import { getUserClient } from '../services/nextcloudHelper';
import { logger } from '../utils/logger';

export const nextcloudFilesRouter = Router();

/**
 * Per-user NextCloud Files (WebDAV) bridge.
 *
 * Exposes a tiny browser-friendly facade over the user's WebDAV files
 * endpoint so the client can pick a destination folder and save a mail
 * attachment into it. Requires the calling user to have a NextCloud
 * account linked (see services/nextcloudHelper).
 */

// GET /api/nextcloud/files/status — quick check used by the UI to know
// whether to show the "Save to NextCloud" affordance.
nextcloudFilesRouter.get('/status', async (req: AuthRequest, res) => {
  try {
    const client = await getUserClient(req.userId!);
    res.json({ linked: !!client });
  } catch (e) {
    logger.error(e as Error, 'nextcloud-files status error');
    res.json({ linked: false });
  }
});

// GET /api/nextcloud/files/list?path=/foo — list immediate children.
nextcloudFilesRouter.get('/list', async (req: AuthRequest, res) => {
  try {
    const client = await getUserClient(req.userId!);
    if (!client) return res.status(409).json({ error: 'NextCloud not linked' });
    const rawPath = typeof req.query.path === 'string' ? req.query.path : '/';
    // Defence-in-depth: strip any traversal sequences.
    const safePath = rawPath.replace(/\\/g, '/').replace(/\.\.+/g, '').replace(/\/{2,}/g, '/');
    const items = await client.listFiles(safePath);
    res.json({ path: safePath, items });
  } catch (e) {
    logger.error(e as Error, 'nextcloud-files list error');
    res.status(500).json({ error: (e as Error).message });
  }
});

const mkdirSchema = z.object({
  path: z.string().min(1).max(2048),
});

// POST /api/nextcloud/files/mkdir — create a folder hierarchy.
nextcloudFilesRouter.post('/mkdir', async (req: AuthRequest, res) => {
  try {
    const parse = mkdirSchema.safeParse(req.body);
    if (!parse.success) return res.status(400).json({ error: 'Invalid path' });
    const client = await getUserClient(req.userId!);
    if (!client) return res.status(409).json({ error: 'NextCloud not linked' });
    const safe = parse.data.path.replace(/\\/g, '/').replace(/\.\.+/g, '').replace(/\/{2,}/g, '/');
    await client.createFolderRecursive(safe);
    res.json({ ok: true, path: safe });
  } catch (e) {
    logger.error(e as Error, 'nextcloud-files mkdir error');
    res.status(500).json({ error: (e as Error).message });
  }
});

const uploadSchema = z.object({
  folderPath: z.string().max(2048).default('/'),
  filename: z.string().min(1).max(255),
  contentType: z.string().max(255).optional(),
  contentBase64: z.string().min(1),
  /** When true, an existing file with the same name will be replaced. */
  overwrite: z.boolean().optional(),
  /** When true, missing intermediate folders will be created. */
  ensureFolder: z.boolean().optional(),
});

// GET /api/nextcloud/files/get?path=/foo/bar.pdf — download a file (returns base64 + metadata).
nextcloudFilesRouter.get('/get', async (req: AuthRequest, res) => {
  try {
    const client = await getUserClient(req.userId!);
    if (!client) return res.status(409).json({ error: 'NextCloud not linked' });
    const rawPath = typeof req.query.path === 'string' ? req.query.path : '';
    if (!rawPath) return res.status(400).json({ error: 'Missing path' });
    const { buffer, contentType, filename } = await client.getFile(rawPath);
    if (buffer.length > 100 * 1024 * 1024) return res.status(413).json({ error: 'File too large' });
    res.json({ filename, contentType, contentBase64: buffer.toString('base64') });
  } catch (e) {
    logger.error(e as Error, 'nextcloud-files get error');
    res.status(500).json({ error: (e as Error).message });
  }
});

// Cap upload size to avoid memory abuse. Mirrors common attachment limits.
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MB

// POST /api/nextcloud/files/upload — upload a base64-encoded file.
nextcloudFilesRouter.post('/upload', async (req: AuthRequest, res) => {
  try {
    const parse = uploadSchema.safeParse(req.body);
    if (!parse.success) return res.status(400).json({ error: 'Invalid payload' });
    const { folderPath, filename, contentType, contentBase64, overwrite, ensureFolder } = parse.data;

    const client = await getUserClient(req.userId!);
    if (!client) return res.status(409).json({ error: 'NextCloud not linked' });

    let buffer: Buffer;
    try {
      buffer = Buffer.from(contentBase64, 'base64');
    } catch {
      return res.status(400).json({ error: 'Invalid base64 payload' });
    }
    if (buffer.length === 0) return res.status(400).json({ error: 'Empty file' });
    if (buffer.length > MAX_UPLOAD_BYTES) return res.status(413).json({ error: 'File too large' });

    const safeFolder = folderPath.replace(/\\/g, '/').replace(/\.\.+/g, '').replace(/\/{2,}/g, '/');
    if (ensureFolder && safeFolder && safeFolder !== '/') {
      await client.createFolderRecursive(safeFolder);
    }

    const path = await client.uploadFile(safeFolder, filename, buffer, contentType, overwrite === true);
    res.json({ ok: true, path });
  } catch (e) {
    logger.error(e as Error, 'nextcloud-files upload error');
    res.status(500).json({ error: (e as Error).message });
  }
});
