import { pool } from '../database/connection';
import { logger } from '../utils/logger';
import { ensureFreshAccessToken } from './oauth';
import { markServiceStarted, markServiceStopped, markServiceTick } from './serviceStatus';

/**
 * Rafraîchisseur de jetons OAuth (Microsoft 365 / Outlook, …).
 *
 * Sans lui, un jeton n'était renouvelé qu'au moment où une requête en avait
 * besoin. Au redémarrage du serveur, tous les onglets ouverts rechargent en
 * même temps : une dizaine de requêtes tombaient d'un coup sur un access token
 * périmé et lançaient chacune leur propre appel /token avec le même refresh
 * token. Microsoft fait tourner ces jetons et considère un rejeu comme une
 * compromission — il révoque alors toute la famille, et la boîte doit être
 * reliée à la main. C'est précisément le symptôme « mes boîtes Outlook se
 * déconnectent à chaque mise à jour ».
 *
 * Ce service passe donc devant : toutes les 5 minutes, en série, il renouvelle
 * les jetons qui expirent dans moins de 20 minutes. Les requêtes HTTP n'ont
 * plus qu'à lire un jeton déjà frais (leur marge par défaut est de 10 min,
 * volontairement plus courte que celle d'ici). Le verrou par compte de
 * `ensureFreshAccessToken` reste la garantie de dernier recours.
 *
 * Les comptes en `needs_reauth` sont ignorés : rejouer un jeton révoqué
 * n'apporte rien et peut aggraver la révocation côté Microsoft. Ceux en
 * `config_error` restent dans la boucle — le temps de repos exponentiel évite
 * de marteler, et ils se rétablissent seuls dès que le secret Azure est
 * corrigé.
 */

const TICK_MS = 5 * 60_000;
/** Marge de renouvellement — doit rester > à celle des appels à la demande. */
const REFRESH_MARGIN_MS = 20 * 60_000;
/** Laisse le réseau du conteneur s'établir avant le premier appel sortant. */
const FIRST_RUN_DELAY_MS = 20_000;

const SERVICE_NAME = 'oauthTokenRefresher';

let timer: NodeJS.Timeout | null = null;
let isRunning = false;

async function refreshDueAccounts(): Promise<void> {
  const res = await pool.query(
    `SELECT id, email, oauth_provider, oauth_status, oauth_refresh_failures,
            oauth_refresh_token_encrypted, oauth_access_token_encrypted, oauth_token_expires_at
       FROM mail_accounts
      WHERE oauth_provider IS NOT NULL
        AND oauth_refresh_token_encrypted IS NOT NULL
        AND COALESCE(oauth_status, 'ok') <> 'needs_reauth'
        AND (oauth_token_expires_at IS NULL
             OR oauth_token_expires_at < NOW() + make_interval(secs => $1))
      ORDER BY oauth_token_expires_at ASC NULLS FIRST`,
    [REFRESH_MARGIN_MS / 1000],
  );
  if (res.rowCount === 0) return;

  let refreshed = 0;
  let failed = 0;
  // En série : deux appels /token simultanés sur des comptes différents ne se
  // gênent pas, mais rien ne presse et cela reste doux pour Microsoft.
  for (const row of res.rows) {
    try {
      await ensureFreshAccessToken(row, { marginMs: REFRESH_MARGIN_MS });
      refreshed++;
    } catch (err) {
      // Le statut et le message sont déjà persistés par ensureFreshAccessToken,
      // et les incidents remontent par email via services/systemAlerts.ts.
      failed++;
      logger.debug({ err, accountId: row.id }, 'oauth-refresher: échec du renouvellement');
    }
  }
  logger.debug(`oauth-refresher: ${refreshed} jeton(s) renouvelé(s), ${failed} en échec`);
}

function runTick(): void {
  if (isRunning) return;
  isRunning = true;
  refreshDueAccounts()
    .then(() => markServiceTick(SERVICE_NAME))
    .catch((err) => {
      markServiceTick(SERVICE_NAME, err);
      logger.error(err, 'oauth-refresher tick failed');
    })
    .finally(() => { isRunning = false; });
}

export function startOAuthTokenRefresher(): void {
  if (timer) return;
  markServiceStarted(SERVICE_NAME, 'Renouvellement des jetons OAuth', TICK_MS);
  logger.info(`OAuth token refresher started (tick ${TICK_MS}ms, marge ${REFRESH_MARGIN_MS}ms)`);
  setTimeout(runTick, FIRST_RUN_DELAY_MS);
  timer = setInterval(runTick, TICK_MS);
}

export function stopOAuthTokenRefresher(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    markServiceStopped(SERVICE_NAME);
  }
}
