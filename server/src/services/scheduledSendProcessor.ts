import { pool } from '../database/connection';
import { MailService } from './mail';
import { decrypt } from '../utils/encryption';
import { logger } from '../utils/logger';
import { markServiceStarted, markServiceStopped, markServiceTick } from './serviceStatus';

/**
 * Processeur des messages programmés (envoi différé + « Annuler l'envoi »).
 *
 * Les messages sont enregistrés dans `scheduled_messages` par POST
 * /api/mail/schedule avec une date `scheduled_at` :
 *   - envoi différé choisi par l'utilisateur (« Envoyer plus tard ») ;
 *   - ou délai de grâce de quelques secondes ajouté par le client pour offrir
 *     le bouton « Annuler » après un envoi normal (is_undo_send = true).
 *
 * Tant que `scheduled_at` n'est pas atteint, DELETE /api/mail/scheduled/:id
 * peut annuler le message. Le tick est volontairement court (10 s) pour que
 * l'envoi parte au plus près de l'heure choisie.
 *
 * L'identité d'expéditeur (from/sender/replyTo, y compris le cas
 * send_on_behalf) est figée à l'enregistrement — le processeur n'a plus
 * qu'à charger le compte et envoyer.
 */

const TICK_MS = 10_000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2 * 60_000; // 2 min avant nouvel essai
const BATCH_SIZE = 10;

let processorInterval: NodeJS.Timeout | null = null;
let isRunning = false;

const SERVICE_NAME = 'scheduledSendProcessor';

export function startScheduledSendProcessor(): void {
  if (processorInterval) return;
  processorInterval = setInterval(tick, TICK_MS);
  markServiceStarted(SERVICE_NAME, 'Envois programmés', TICK_MS);
  logger.info('Scheduled send processor started');
}

export function stopScheduledSendProcessor(): void {
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
    await processDueMessages();
    markServiceTick(SERVICE_NAME);
  } catch (err) {
    markServiceTick(SERVICE_NAME, err);
    logger.error(err, 'Scheduled send processor tick error');
  } finally {
    isRunning = false;
  }
}

/** Charge un compte mail prêt à l'emploi (mot de passe déchiffré ou token OAuth frais).
 *  Également utilisé par bulkSendProcessor. */
export async function loadAccount(accountId: string): Promise<any | null> {
  const res = await pool.query('SELECT * FROM mail_accounts WHERE id = $1', [accountId]);
  if (!res.rows.length) return null;
  const account = res.rows[0];
  if (account.oauth_provider) {
    const { ensureFreshAccessToken } = await import('./oauth');
    const accessToken = await ensureFreshAccessToken(account);
    return {
      ...account,
      username: account.username || account.email,
      access_token: accessToken,
      password: '',
    };
  }
  return {
    ...account,
    password: account.password_encrypted ? decrypt(account.password_encrypted) : '',
  };
}

async function processDueMessages(): Promise<void> {
  // Claim atomique : le passage scheduled → sending empêche une annulation
  // concurrente (DELETE exige status='scheduled') et un double envoi.
  const claimed = await pool.query(
    `UPDATE scheduled_messages
        SET status = 'sending', updated_at = NOW()
      WHERE id IN (
        SELECT id FROM scheduled_messages
         WHERE status = 'scheduled' AND scheduled_at <= NOW()
         ORDER BY scheduled_at ASC
         LIMIT $1
      )
      RETURNING *`,
    [BATCH_SIZE]
  );

  for (const msg of claimed.rows) {
    await sendOne(msg).catch((err) => {
      logger.error({ err, messageId: msg.id }, 'Scheduled send: unexpected error');
    });
  }
}

async function sendOne(msg: any): Promise<void> {
  try {
    const account = await loadAccount(msg.account_id);
    if (!account) {
      await markError(msg, 'Compte mail introuvable', /* final */ true);
      return;
    }

    const mailService = new MailService(account);
    await mailService.sendMail({
      from: msg.from_options,
      sender: msg.sender_options || undefined,
      replyTo: msg.reply_to_options || undefined,
      to: msg.to_addresses,
      cc: msg.cc_addresses || undefined,
      bcc: msg.bcc_addresses || undefined,
      subject: msg.subject ?? '',
      html: msg.body_html ?? '',
      text: msg.body_text || undefined,
      attachments: msg.attachments || undefined,
      inReplyTo: msg.in_reply_to || undefined,
      references: msg.references_header || undefined,
    });

    await pool.query(
      `UPDATE scheduled_messages
          SET status = 'sent', sent_at = NOW(), error = NULL, updated_at = NOW()
        WHERE id = $1`,
      [msg.id]
    );

    // Réponse : poser le drapeau \Answered sur le message d'origine (best effort).
    if (msg.in_reply_to_uid && msg.in_reply_to_folder) {
      try {
        await mailService.setFlags(msg.in_reply_to_folder, msg.in_reply_to_uid, { answered: true });
      } catch (err: any) {
        logger.warn(`Scheduled send: unable to flag original as answered (uid=${msg.in_reply_to_uid}): ${err?.message || err}`);
      }
    }
  } catch (err: any) {
    await markError(msg, String(err?.message ?? 'Erreur inconnue'), false);
    logger.warn({ err, messageId: msg.id }, 'Scheduled send: send failed');
  }
}

async function markError(msg: any, error: string, final: boolean): Promise<void> {
  const attempts = (msg.attempts ?? 0) + 1;
  if (final || attempts >= MAX_ATTEMPTS) {
    await pool.query(
      `UPDATE scheduled_messages
          SET status = 'error', error = $2, attempts = $3, updated_at = NOW()
        WHERE id = $1`,
      [msg.id, error, attempts]
    );
  } else {
    // Remise en file : redevient annulable pendant l'attente du retry.
    await pool.query(
      `UPDATE scheduled_messages
          SET status = 'scheduled', error = $2, attempts = $3,
              scheduled_at = NOW() + ($4 || ' milliseconds')::INTERVAL,
              updated_at = NOW()
        WHERE id = $1`,
      [msg.id, error, attempts, RETRY_DELAY_MS]
    );
  }
}
