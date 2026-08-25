/**
 * Entretien du cache serveur `cached_emails`.
 *
 * Ce cache est peuplé en effet de bord d'un listage de dossier. Rien ne l'en
 * retirait quand un message quittait un dossier autrement que par une action de
 * l'utilisateur dans l'interface : un déplacement décidé par le filtre
 * indésirable ou par une règle laissait la ligne en place indéfiniment, et elle
 * continuait de remonter dans les résultats de recherche alors que le message
 * n'était plus là.
 *
 * Une seule implémentation, appelée depuis tous les points de sortie.
 */

import { pool } from '../database/connection';
import { logger } from './logger';

/** Retire du cache un message qui a quitté ce dossier. */
export async function forgetCachedEmail(
  accountId: string,
  folder: string,
  uid: number,
): Promise<void> {
  return forgetCachedEmails(accountId, folder, [uid]);
}

/** Variante par lot — même sémantique. */
export async function forgetCachedEmails(
  accountId: string,
  folder: string,
  uids: number[],
): Promise<void> {
  if (!uids?.length) return;
  try {
    await pool.query(
      'DELETE FROM cached_emails WHERE account_id = $1 AND folder = $2 AND uid = ANY($3::int[])',
      [accountId, folder, uids],
    );
  } catch (err) {
    // Le nettoyage du cache ne doit jamais faire échouer l'action qui l'a
    // provoquée : le message a bien été déplacé, c'est ce qui compte.
    logger.debug({ err, accountId, folder, uids }, '[cache] purge de cached_emails impossible');
  }
}
