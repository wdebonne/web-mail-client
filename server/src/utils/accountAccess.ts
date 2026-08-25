/**
 * Prédicat SQL d'accès à une boîte mail.
 *
 * Trois voies donnent accès à un compte, et elles doivent être honorées
 * partout de la même façon :
 *  - la possession directe (`mail_accounts.user_id`) ;
 *  - une attribution de boîte (`mailbox_assignments`) ;
 *  - un partage hérité (`shared_mailbox_access`).
 *
 * `getAccountForUser` (server/src/routes/mail.ts) les applique déjà pour lire
 * un compte. `/api/search`, lui, ne filtrait que sur `user_id` : un utilisateur
 * ne trouvait donc rien dans une boîte partagée à laquelle il avait pourtant
 * accès, alors qu'il pouvait l'ouvrir et la parcourir normalement.
 *
 * Ce fragment existe pour que les deux ne puissent plus diverger.
 */
export function accountAccessPredicate(alias: string, userParam: string): string {
  return `(
    ${alias}.user_id = ${userParam}
    OR EXISTS (
      SELECT 1 FROM mailbox_assignments mba
      WHERE mba.mail_account_id = ${alias}.id AND mba.user_id = ${userParam}
    )
    OR EXISTS (
      SELECT 1 FROM shared_mailbox_access sma
      WHERE sma.mail_account_id = ${alias}.id AND sma.user_id = ${userParam}
    )
  )`;
}
