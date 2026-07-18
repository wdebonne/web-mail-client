import { pool } from '../database/connection';
import { MailService } from './mail';
import { loadAccount } from './scheduledSendProcessor';
import { logger } from '../utils/logger';
import { markServiceStarted, markServiceStopped, markServiceTick } from './serviceStatus';

const TICK_MS = 30_000; // check every 30 seconds
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 5 * 60_000; // 5 min before retry

let processorInterval: NodeJS.Timeout | null = null;
let isRunning = false;

const SERVICE_NAME = 'bulkSendProcessor';

export function startBulkSendProcessor(): void {
  if (processorInterval) return;
  processorInterval = setInterval(tick, TICK_MS);
  markServiceStarted(SERVICE_NAME, "File d'envoi en masse", TICK_MS);
  logger.info('Bulk send processor started');
}

export function stopBulkSendProcessor(): void {
  if (processorInterval) {
    clearInterval(processorInterval);
    processorInterval = null;
    markServiceStopped(SERVICE_NAME);
  }
}

async function tick(): Promise<void> {
  if (isRunning) return;
  isRunning = true;
  try {
    await processAllUsers();
    markServiceTick(SERVICE_NAME);
  } catch (err) {
    markServiceTick(SERVICE_NAME, err);
    logger.error(err, 'Bulk send processor tick error');
  } finally {
    isRunning = false;
  }
}

async function processAllUsers(): Promise<void> {
  // Find all distinct users with active (pending/running) jobs
  const usersRes = await pool.query(
    `SELECT DISTINCT user_id FROM bulk_send_jobs WHERE status IN ('pending','running')`
  );
  if (!usersRes.rows.length) return;

  for (const { user_id } of usersRes.rows) {
    try {
      await processUser(user_id);
    } catch (err) {
      logger.error({ err, userId: user_id }, 'Bulk send: error processing user');
    }
  }
}

async function getUserRateConfig(userId: string): Promise<{ rateLimit: number; rateWindowMinutes: number }> {
  const [settingsRes, userRes] = await Promise.all([
    pool.query(
      `SELECT key, value FROM admin_settings WHERE key IN
       ('bulk_send_default_rate_limit','bulk_send_default_rate_window')`
    ),
    pool.query(
      'SELECT rate_limit, rate_window_minutes FROM bulk_send_user_settings WHERE user_id = $1',
      [userId]
    ),
  ]);

  const adminMap: Record<string, number> = {};
  for (const row of settingsRes.rows) adminMap[row.key] = Number(row.value);
  const defaults = {
    rateLimit: adminMap['bulk_send_default_rate_limit'] ?? 50,
    rateWindowMinutes: adminMap['bulk_send_default_rate_window'] ?? 5,
  };

  const userRow = userRes.rows[0];
  return {
    rateLimit: userRow?.rate_limit ?? defaults.rateLimit,
    rateWindowMinutes: userRow?.rate_window_minutes ?? defaults.rateWindowMinutes,
  };
}

async function processUser(userId: string): Promise<void> {
  const { rateLimit, rateWindowMinutes } = await getUserRateConfig(userId);

  // Count emails already sent by this user in the last rateWindowMinutes
  const sentRes = await pool.query(
    `SELECT COUNT(*) AS cnt
     FROM bulk_send_recipients r
     JOIN bulk_send_jobs j ON j.id = r.job_id
     WHERE j.user_id = $1
       AND r.status = 'sent'
       AND r.sent_at > NOW() - ($2 || ' minutes')::INTERVAL`,
    [userId, rateWindowMinutes]
  );
  const sentCount = parseInt(sentRes.rows[0].cnt);
  const remaining = rateLimit - sentCount;
  if (remaining <= 0) return;

  // Pick the oldest active jobs for this user
  const jobsRes = await pool.query(
    `SELECT j.id AS job_id, j.account_id
     FROM bulk_send_jobs j
     WHERE j.user_id = $1 AND j.status IN ('pending','running')
     ORDER BY j.created_at ASC`,
    [userId]
  );
  if (!jobsRes.rows.length) return;

  let budget = remaining;

  for (const { job_id, account_id } of jobsRes.rows) {
    if (budget <= 0) break;

    // Mark job as running
    await pool.query(
      `UPDATE bulk_send_jobs SET status = 'running', updated_at = NOW() WHERE id = $1 AND status = 'pending'`,
      [job_id]
    );

    // Fetch recipients that are ready to send
    const recipientsRes = await pool.query(
      `SELECT id, email, display_name, subject, body_html, body_text, attachments
       FROM bulk_send_recipients
       WHERE job_id = $1
         AND status = 'pending'
         AND (next_retry_at IS NULL OR next_retry_at <= NOW())
       ORDER BY created_at ASC
       LIMIT $2`,
      [job_id, budget]
    );

    if (!recipientsRes.rows.length) {
      // No more pending recipients — check if job is done
      await checkJobCompletion(job_id);
      continue;
    }

    // Load mail account (mot de passe déchiffré ou token OAuth frais)
    let account: any;
    let mailService: MailService | null = null;
    try {
      account = await loadAccount(account_id);
      if (!account) continue;
      mailService = new MailService(account);
    } catch (err) {
      logger.error({ err, accountId: account_id }, 'Bulk send: cannot create MailService');
      continue;
    }

    for (const recipient of recipientsRes.rows) {
      if (budget <= 0) break;
      await sendOneRecipient(mailService, job_id, recipient, account);
      budget--;
    }

    await checkJobCompletion(job_id);
  }
}

async function sendOneRecipient(
  mailService: MailService,
  jobId: string,
  recipient: any,
  account: any
): Promise<void> {
  try {
    await mailService.sendMail({
      from: { email: account.email, name: account.name || account.email },
      to: [{ email: recipient.email, name: recipient.display_name || undefined }],
      subject: recipient.subject ?? '',
      html: recipient.body_html ?? '',
      text: recipient.body_text ?? undefined,
      attachments: recipient.attachments ?? undefined,
    });

    await pool.query(
      `UPDATE bulk_send_recipients
       SET status = 'sent', sent_at = NOW(), error = NULL, updated_at = NOW()
       WHERE id = $1`,
      [recipient.id]
    );
    await pool.query(
      `UPDATE bulk_send_jobs SET sent = sent + 1, updated_at = NOW() WHERE id = $1`,
      [jobId]
    );
  } catch (err: any) {
    const attempts = (recipient.attempts ?? 0) + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await pool.query(
        `UPDATE bulk_send_recipients
         SET status = 'error', error = $2, attempts = $3, next_retry_at = NULL, updated_at = NOW()
         WHERE id = $1`,
        [recipient.id, String(err?.message ?? 'Erreur inconnue'), attempts]
      );
      await pool.query(
        `UPDATE bulk_send_jobs SET errors = errors + 1, updated_at = NOW() WHERE id = $1`,
        [jobId]
      );
    } else {
      const nextRetry = new Date(Date.now() + RETRY_DELAY_MS);
      await pool.query(
        `UPDATE bulk_send_recipients
         SET attempts = $2, error = $3, next_retry_at = $4, updated_at = NOW()
         WHERE id = $1`,
        [recipient.id, attempts, String(err?.message ?? 'Erreur inconnue'), nextRetry]
      );
    }
    logger.warn({ err, recipientId: recipient.id, email: recipient.email }, 'Bulk send: failed to send to recipient');
  }
}

async function checkJobCompletion(jobId: string): Promise<void> {
  const res = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'pending') AS pending,
       COUNT(*) FILTER (WHERE status = 'sent') AS sent,
       COUNT(*) FILTER (WHERE status = 'error') AS errors,
       COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled
     FROM bulk_send_recipients WHERE job_id = $1`,
    [jobId]
  );
  const { pending } = res.rows[0];
  if (parseInt(pending) === 0) {
    await pool.query(
      `UPDATE bulk_send_jobs
       SET status = 'completed', completed_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [jobId]
    );
  }
}
