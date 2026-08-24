import { Request } from 'express';

/**
 * Adresse IP réelle du client.
 *
 * `app.set('trust proxy', 1)` étant positionné, Express résout déjà `req.ip`
 * sur le dernier saut de `X-Forwarded-For` — celui ajouté par le reverse proxy,
 * le seul qu'un client ne puisse pas écrire.
 *
 * Ne jamais lire le **premier** élément de l'en-tête à la place : le nginx
 * documenté dans DEPLOYMENT.md utilise `$proxy_add_x_forwarded_for`, qui
 * *ajoute* l'IP réelle à la valeur reçue au lieu de la remplacer. Un client
 * émettant `X-Forwarded-For: 10.0.0.5` produit donc `10.0.0.5, <ip réelle>`,
 * et retenir le premier élément revient à laisser l'appelant choisir son
 * adresse — donc contourner la liste noire d'IP et le filtre réseau Kerberos.
 */
export function clientIp(req: Request): string {
  return req.ip || '';
}
