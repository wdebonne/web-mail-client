/**
 * Primitives de synchronisation incrémentale.
 *
 * Ces routes sont délibérément **sans état** : le serveur n'enregistre rien et
 * n'acquiert aucune table. C'est le client qui conserve, pour chaque dossier,
 * le dernier UIDVALIDITY/UIDNEXT observé et la liste des UID qu'il détient — et
 * qui calcule donc le delta, puisque c'est lui qui connaît l'état précédent.
 *
 * Ce partage a trois conséquences voulues : le serveur reste léger (aucune
 * table de synchro par utilisateur à maintenir ni à purger), la progression
 * d'une longue première synchro survit naturellement à une interruption
 * puisqu'elle vit dans IndexedDB, et deux appareils du même utilisateur peuvent
 * se synchroniser à des rythmes différents sans se marcher dessus.
 *
 * Le contrôle d'accès passe systématiquement par `getAccountForUser`, qui
 * honore les attributions de boîte et les partages — un simple `user_id` ne le
 * ferait pas.
 */

import { Router } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../middleware/auth';
import { MailService } from '../services/mail';
import { getAccountForUser } from './mail';
import { logger } from '../utils/logger';

export const syncRouter = Router();

/** Les enveloppes restent largement sous les limites de ligne de commande IMAP. */
const MAX_ENVELOPE_UIDS = 500;
/** Les corps se téléchargent partie par partie : un lot plus petit garde la latence raisonnable. */
const MAX_BODY_UIDS = 25;

const uidBatchSchema = (max: number) =>
  z.object({
    folder: z.string().min(1),
    uids: z.array(z.number().int().positive()).min(1).max(max),
  });

/**
 * Résout le compte et vérifie les droits. Renvoie `null` après avoir répondu
 * 404 — l'appelant n'a plus qu'à sortir.
 */
async function resolveAccount(req: AuthRequest, res: any) {
  const account = await getAccountForUser(req.params.accountId, req.userId!);
  if (!account) {
    res.status(404).json({ error: 'Compte non trouvé' });
    return null;
  }
  return account;
}

/**
 * POST /accounts/:accountId/state
 *
 * Sonde bon marché : un STATUS par dossier, sur une seule connexion IMAP.
 * Le client compare le résultat à son propre état et n'appelle les routes
 * suivantes que pour les dossiers réellement modifiés — dans le cas courant où
 * rien n'a bougé, un cycle de synchronisation s'arrête ici.
 *
 * `folders` restreint le balayage ; omis, tous les dossiers sélectionnables
 * sont renvoyés (ce qui permet aussi de découvrir un nouveau dossier).
 */
syncRouter.post('/accounts/:accountId/state', async (req: AuthRequest, res) => {
  try {
    const { folders } = z
      .object({ folders: z.array(z.string()).optional() })
      .parse(req.body ?? {});

    const account = await resolveAccount(req, res);
    if (!account) return;

    const mailService = new MailService(account);
    const state = await mailService.getFoldersSyncState(folders);
    res.json({ folders: state });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Données invalides', details: error.errors });
    }
    logger.error({ err: error }, '[sync] state failed');
    res.status(500).json({ error: error.message || 'Erreur de lecture de l\'état des dossiers' });
  }
});

/**
 * GET /accounts/:accountId/uidflags?folder=X
 *
 * UID + drapeaux de tout le dossier, en masque binaire (1 Seen, 2 Flagged,
 * 4 Answered, 8 Draft). Le client en déduit par arithmétique d'ensembles ce qui
 * a été ajouté, supprimé ou relu ailleurs — sans que le serveur ait à savoir ce
 * qu'il détenait auparavant.
 */
syncRouter.get('/accounts/:accountId/uidflags', async (req: AuthRequest, res) => {
  try {
    const folder = (req.query.folder as string) || 'INBOX';

    const account = await resolveAccount(req, res);
    if (!account) return;

    const mailService = new MailService(account);
    const result = await mailService.listFolderUidFlags(folder);
    res.json(result);
  } catch (error: any) {
    logger.error({ err: error }, '[sync] uidflags failed');
    res.status(500).json({ error: error.message || 'Erreur de lecture des UID' });
  }
});

/**
 * POST /accounts/:accountId/envelopes
 *
 * En-têtes d'un lot d'UID précis. La forme renvoyée est strictement celle de
 * `GET /api/mail/accounts/:id/messages` : un message issu du cache local et un
 * message issu d'un listage direct doivent être indiscernables dans la liste.
 */
syncRouter.post('/accounts/:accountId/envelopes', async (req: AuthRequest, res) => {
  try {
    const { folder, uids } = uidBatchSchema(MAX_ENVELOPE_UIDS).parse(req.body);

    const account = await resolveAccount(req, res);
    if (!account) return;

    const mailService = new MailService(account);
    const messages = await mailService.fetchEnvelopes(folder, uids);
    res.json({ folder, messages });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Données invalides', details: error.errors });
    }
    logger.error({ err: error }, '[sync] envelopes failed');
    res.status(500).json({ error: error.message || 'Erreur de récupération des en-têtes' });
  }
});

/**
 * POST /accounts/:accountId/bodies
 *
 * Corps texte + HTML d'un lot d'UID, **sans les octets des pièces jointes** —
 * seulement leurs métadonnées. C'est ce qui rend le cache complet abordable :
 * un message de 8 Mo dont le corps fait 12 Ko ne coûte que 12 Ko.
 */
syncRouter.post('/accounts/:accountId/bodies', async (req: AuthRequest, res) => {
  try {
    const { folder, uids } = uidBatchSchema(MAX_BODY_UIDS).parse(req.body);

    const account = await resolveAccount(req, res);
    if (!account) return;

    const mailService = new MailService(account);
    const bodies = await mailService.fetchBodies(folder, uids);
    res.json({ folder, bodies });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Données invalides', details: error.errors });
    }
    logger.error({ err: error }, '[sync] bodies failed');
    res.status(500).json({ error: error.message || 'Erreur de récupération des corps' });
  }
});
