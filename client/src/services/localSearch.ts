/**
 * Recherche locale, servie depuis IndexedDB.
 *
 * Le cache du poste contient les en-têtes **et** les corps : la recherche n'a
 * donc plus besoin d'aller au serveur, et elle couvre le contenu des messages —
 * ce que la recherche serveur ne pouvait pas faire, `cached_emails.body_text`
 * n'étant jamais renseigné.
 *
 * Le repli sur `/api/search` n'est pas supprimé pour autant : tant qu'un dossier
 * de la portée demandée n'est pas entièrement rapatrié, annoncer un résultat
 * local comme exhaustif serait mentir. `complete` dit lequel des deux fait foi.
 */

import { offlineDB, type FolderSyncRecord } from '../pwa/offlineDB';
import { tokenize } from './tokenize';

export type SearchScope = 'current-folder' | 'mailbox' | 'all-folders';

export interface LocalSearchOptions {
  scope: SearchScope;
  /** Compte concerné pour les portées « dossier courant » et « cette boîte ». */
  accountId?: string;
  /** Dossier concerné pour la portée « dossier courant ». */
  folder?: string;
  limit?: number;
}

export interface LocalSearchResult {
  messages: any[];
  /**
   * Vrai quand le cache local couvre entièrement la portée demandée —
   * en-têtes *et* corps. Faux, l'appelant doit compléter par le serveur.
   */
  complete: boolean;
}

/** États de synchro pertinents pour une portée donnée. */
function statesInScope(states: FolderSyncRecord[], opts: LocalSearchOptions): FolderSyncRecord[] {
  if (opts.scope === 'current-folder') {
    if (!opts.accountId || !opts.folder) return [];
    return states.filter((s) => s.accountId === opts.accountId && s.folder === opts.folder);
  }
  if (opts.scope === 'mailbox') {
    if (!opts.accountId) return [];
    return states.filter((s) => s.accountId === opts.accountId);
  }
  return states;
}

/**
 * Le cache couvre-t-il entièrement cette portée ?
 *
 * Deux conditions, et il faut les deux : tous les en-têtes sont descendus
 * (`backfillDone`), et chaque message a son corps. Un dossier dont les en-têtes
 * sont complets mais les corps encore en cours donnerait une recherche
 * silencieusement partielle sur le contenu.
 */
export async function isScopeComplete(opts: LocalSearchOptions): Promise<boolean> {
  const states = statesInScope(await offlineDB.getAllSyncStates(), opts);
  if (!states.length) return false;
  if (states.some((s) => !s.backfillDone)) return false;

  for (const state of states) {
    const [total, withBody] = await Promise.all([
      offlineDB.countFolder(state.accountId, state.folder),
      offlineDB.countFolderBodies(state.accountId, state.folder),
    ]);
    if (withBody < total) return false;
  }
  return true;
}

/**
 * Cherche dans le cache local. Sémantique ET entre les termes, avec correspondance
 * par préfixe sur chacun — « fact rou » trouve « facture Roussel ».
 */
export async function searchLocal(
  query: string,
  opts: LocalSearchOptions,
): Promise<LocalSearchResult> {
  const terms = tokenize(query);
  if (!terms.length) return { messages: [], complete: false };

  const complete = await isScopeComplete(opts);

  const messages = await offlineDB.searchByTerms(terms, {
    accountId: opts.scope === 'all-folders' ? undefined : opts.accountId,
    folder: opts.scope === 'current-folder' ? opts.folder : undefined,
    limit: opts.limit ?? 200,
  });

  // Les résultats portent déjà la forme d'un message de liste ; on complète
  // seulement les deux champs que les vues unifiées attendent.
  return {
    messages: messages.map((m) => ({ ...m, _accountId: m.accountId, _folder: m.folder })),
    complete,
  };
}
