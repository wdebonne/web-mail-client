import { ImapFlow } from 'imapflow';
import { logger } from '../utils/logger';
import { notifyUser } from './websocket';

export interface MigrationSource {
  host: string;
  port: number;
  secure: boolean;
  email: string;
  password: string;
}

export interface MigrationDestination {
  host: string;
  port: number;
  secure: boolean;
  email: string;
  password: string;
}

export interface FolderInfo {
  path: string;
  name: string;
  messageCount: number;
}

export interface MigrationProgress {
  status: 'running' | 'done' | 'error';
  currentFolder: string;
  currentFolderIndex: number;
  totalFolders: number;
  messagesProcessed: number;
  messagesTotal: number;
  errors: { folder: string; message: string }[];
  report?: MigrationReport;
}

export interface MigrationReport {
  totalFolders: number;
  totalMessages: number;
  migratedMessages: number;
  skippedMessages: number;
  failedFolders: { folder: string; error: string }[];
  durationSeconds: number;
}

function buildClient(cfg: MigrationSource | MigrationDestination): ImapFlow {
  return new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.email, pass: cfg.password },
    logger: false,
    tls: { rejectUnauthorized: false },
  });
}

export async function testConnection(cfg: MigrationSource): Promise<{ ok: boolean; error?: string }> {
  const client = buildClient(cfg);
  try {
    await client.connect();
    await client.logout();
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function listFolders(cfg: MigrationSource): Promise<FolderInfo[]> {
  const client = buildClient(cfg);
  const folders: FolderInfo[] = [];
  try {
    await client.connect();
    const list = await client.list();
    for (const folder of list) {
      if (folder.flags?.has('\\Noselect')) continue;
      try {
        const status = await client.status(folder.path, { messages: true });
        folders.push({
          path: folder.path,
          name: folder.name,
          messageCount: status.messages ?? 0,
        });
      } catch {
        folders.push({ path: folder.path, name: folder.name, messageCount: 0 });
      }
    }
    await client.logout();
  } catch (err) {
    await client.logout().catch(() => {});
    throw err;
  }
  return folders;
}

export async function runMigration(
  userId: string,
  source: MigrationSource,
  destination: MigrationDestination,
  selectedFolders: string[]
): Promise<MigrationReport> {
  const startedAt = Date.now();
  const failedFolders: { folder: string; error: string }[] = [];
  let totalMessages = 0;
  let migratedMessages = 0;
  let skippedMessages = 0;

  const sendProgress = (p: MigrationProgress) => {
    notifyUser(userId, 'migration_progress', p);
  };

  const srcClient = buildClient(source);
  const dstClient = buildClient(destination);

  try {
    await srcClient.connect();
    await dstClient.connect();
  } catch (err: any) {
    await srcClient.logout().catch(() => {});
    await dstClient.logout().catch(() => {});
    throw new Error(`Impossible de se connecter: ${err.message}`);
  }

  const folders = selectedFolders;

  // Count total messages upfront for progress
  for (const folderPath of folders) {
    try {
      const status = await srcClient.status(folderPath, { messages: true });
      totalMessages += status.messages ?? 0;
    } catch {
      // non-blocking
    }
  }

  let messagesProcessed = 0;

  for (let i = 0; i < folders.length; i++) {
    const folderPath = folders[i];

    sendProgress({
      status: 'running',
      currentFolder: folderPath,
      currentFolderIndex: i,
      totalFolders: folders.length,
      messagesProcessed,
      messagesTotal: totalMessages,
      errors: failedFolders,
    });

    try {
      // Open source folder
      const mailbox = await srcClient.mailboxOpen(folderPath, { readOnly: true });
      const folderCount = mailbox.exists ?? 0;

      if (folderCount === 0) {
        skippedMessages += 0;
        continue;
      }

      // Ensure destination folder exists
      try {
        await dstClient.mailboxCreate(folderPath);
      } catch {
        // already exists, ignore
      }

      // Fetch messages in batches of 50
      const BATCH = 50;
      for (let seq = 1; seq <= folderCount; seq += BATCH) {
        const to = Math.min(seq + BATCH - 1, folderCount);
        const range = `${seq}:${to}`;

        try {
          for await (const msg of srcClient.fetch(range, { source: true, flags: true, internalDate: true })) {
            if (!msg.source) {
              skippedMessages++;
              messagesProcessed++;
              continue;
            }

            try {
              await dstClient.append(folderPath, msg.source, msg.flags, msg.internalDate);
              migratedMessages++;
            } catch (appendErr: any) {
              logger.warn({ folder: folderPath, err: appendErr.message }, 'Migration: append failed');
              skippedMessages++;
            }
            messagesProcessed++;
          }
        } catch (fetchErr: any) {
          logger.warn({ folder: folderPath, range, err: fetchErr.message }, 'Migration: fetch batch failed');
          skippedMessages += to - seq + 1;
          messagesProcessed += to - seq + 1;
        }

        sendProgress({
          status: 'running',
          currentFolder: folderPath,
          currentFolderIndex: i,
          totalFolders: folders.length,
          messagesProcessed,
          messagesTotal: totalMessages,
          errors: failedFolders,
        });
      }
    } catch (err: any) {
      logger.error({ folder: folderPath, err: err.message }, 'Migration: folder failed');
      failedFolders.push({ folder: folderPath, error: err.message });
    }
  }

  await srcClient.logout().catch(() => {});
  await dstClient.logout().catch(() => {});

  const report: MigrationReport = {
    totalFolders: folders.length,
    totalMessages,
    migratedMessages,
    skippedMessages,
    failedFolders,
    durationSeconds: Math.round((Date.now() - startedAt) / 1000),
  };

  sendProgress({
    status: 'done',
    currentFolder: '',
    currentFolderIndex: folders.length,
    totalFolders: folders.length,
    messagesProcessed: migratedMessages + skippedMessages,
    messagesTotal: totalMessages,
    errors: failedFolders,
    report,
  });

  return report;
}
