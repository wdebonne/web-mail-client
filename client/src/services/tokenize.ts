/**
 * Tokenisation partagée par l'indexation et la recherche locale.
 *
 * Volontairement sans dépendance au DOM : ce module tourne aussi bien dans le
 * thread principal que dans le Web Worker d'indexation, où `document` n'existe
 * pas.
 *
 * Les mêmes fonctions doivent servir des deux côtés — indexer avec une règle et
 * chercher avec une autre produirait des résultats manquants inexplicables.
 */

/**
 * Incrémenter cette valeur invalide l'index de recherche **sans** invalider les
 * données : les corps sont déjà en cache localement, une ré-indexation les relit
 * sur place au lieu de les retélécharger.
 */
export const TOKENIZER_VERSION = 3; // 3 : ajout du contenu des pièces jointes bureautiques

/**
 * Plafond de termes retenus par message.
 *
 * Porté de 200 à 300 avec l'indexation du contenu des pièces jointes : sans
 * cette marge, un corps un peu long aurait saturé la liste et le texte du
 * document joint n'y serait jamais entré. Le surcoût est d'environ 800 octets
 * d'index par message — négligeable au regard des corps eux-mêmes.
 */
export const MAX_TERMS_PER_MESSAGE = 300;

/**
 * Part du plafond garantie au contenu des documents joints.
 *
 * Sans cette réserve, un corps un peu bavard consommait tout le budget et le
 * texte du document n'entrait jamais dans l'index — la fonction aurait paru
 * marcher sur les messages courts et échouer sur les autres, sans logique
 * apparente. Le reliquat non utilisé revient au corps, et réciproquement.
 */
const ATTACHMENT_TERM_QUOTA = 100;

const MIN_TERM_LENGTH = 2;

/**
 * Quantité de texte réellement indexée par message.
 *
 * Le plafond de termes est déjà à {@link MAX_TERMS_PER_MESSAGE}, mais sans
 * cette borne on normaliserait et découperait quand même un corps entier de
 * plusieurs centaines de Ko pour n'en retenir que 200 termes — des dizaines de
 * millisecondes de thread principal par message, multipliées par des milliers
 * de messages pendant le remplissage. Les premiers 64 Ko d'un mail contiennent
 * de toute façon l'essentiel de ce qu'on y cherche ; au-delà, c'est presque
 * toujours de la citation ou de la signature.
 */
const MAX_INDEXED_CHARS = 64 * 1024;

/**
 * Mots vides français (et quelques anglais courants dans les mails pro).
 * Ils feraient exploser l'index sans jamais discriminer un message.
 */
const STOP_WORDS = new Set([
  'au', 'aux', 'avec', 'ce', 'ces', 'dans', 'de', 'des', 'du', 'elle', 'en', 'et', 'eux', 'il',
  'ils', 'je', 'la', 'le', 'les', 'leur', 'lui', 'ma', 'mais', 'me', 'meme', 'mes', 'moi', 'mon',
  'ne', 'nos', 'notre', 'nous', 'on', 'ou', 'par', 'pas', 'pour', 'qu', 'que', 'qui', 'sa', 'se',
  'ses', 'son', 'sur', 'ta', 'te', 'tes', 'toi', 'ton', 'tu', 'un', 'une', 'vos', 'votre', 'vous',
  'ete', 'etre', 'avoir', 'fait', 'faire', 'plus', 'tout', 'tous', 'toute', 'toutes', 'cette',
  'cet', 'ainsi', 'donc', 'alors', 'comme', 'aussi', 'bien', 'sans', 'sous', 'entre', 'apres',
  'avant', 'depuis', 'pendant', 'the', 'and', 'for', 'you', 'your', 'this', 'that', 'with',
  'from', 'have', 'has', 'are', 'was', 'were', 'will', 'would', 'can', 'not', 'but', 'all',
]);

/**
 * Minuscules + suppression des accents. L'application est francophone :
 * « école » et « ecole » doivent se rejoindre, sinon la recherche paraît cassée
 * à qui tape sans accents (le cas le plus courant).
 */
export function normalizeText(input: string): string {
  return input.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Découpe une chaîne normalisée en termes indexables, dédoublonnés. */
export function tokenize(input: string): string[] {
  if (!input) return [];
  const out = new Set<string>();
  for (const raw of normalizeText(input).split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < MIN_TERM_LENGTH) continue;
    if (STOP_WORDS.has(raw)) continue;
    out.add(raw);
  }
  return [...out];
}

/**
 * Extrait le texte d'un corps HTML sans passer par le DOM.
 *
 * Les blocs `<script>` et `<style>` sont retirés en premier : leur contenu
 * n'est pas du texte lisible et pollue lourdement l'index (un seul mail avec du
 * CSS inline suffirait à saturer le plafond de termes).
 */
export function stripHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(Number(d)))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Le texte lisible d'un message, quel que soit le format disponible. */
export function readableBody(bodyText?: string | null, bodyHtml?: string | null): string {
  const text = (bodyText || '').trim();
  // Le HTML n'est dépouillé que si le texte brut manque : indexer du balisage
  // gonfle l'index sans rien apporter.
  if (text) return text;
  return stripHtml(bodyHtml || '');
}

type Recipient = { address?: string | null; name?: string | null };

export interface TermSource {
  subject?: string | null;
  fromName?: string | null;
  fromAddress?: string | null;
  to?: Recipient[] | null;
  /** Les personnes en copie sont des destinataires comme les autres : on
   *  cherche « le mail où Paul était en copie » exactement comme les autres. */
  cc?: Recipient[] | null;
  bodyText?: string | null;
  bodyHtml?: string | null;
  /** Noms de fichiers joints — « retrouve-moi le mail avec le devis ». */
  attachmentNames?: Array<string | null | undefined> | null;
  /**
   * Texte extrait des pièces jointes bureautiques (docx, xlsx…), rempli à
   * l'ouverture du message. Voir `services/attachmentText.ts`.
   */
  attachmentText?: string | null;
}

/**
 * Construit la liste de termes d'un message.
 *
 * Le sujet et l'expéditeur passent en premier : quand le plafond tronque, ce
 * sont eux qu'il faut garder, parce que ce sont eux que les gens tapent.
 */
export function buildTerms(source: TermSource): string[] {
  const head: string[] = [
    ...tokenize(source.subject || ''),
    ...tokenize(source.fromName || ''),
    ...tokenize(source.fromAddress || ''),
  ];

  for (const addr of [...(source.to || []), ...(source.cc || [])]) {
    head.push(...tokenize(addr?.name || ''), ...tokenize(addr?.address || ''));
  }

  // Les noms de fichiers joints vont dans l'en-tête, pas dans le corps : ils
  // sont courts, très discriminants, et c'est souvent par eux qu'on se souvient
  // d'un message. Les laisser en fin de liste les exposerait à la troncature.
  for (const name of source.attachmentNames || []) {
    head.push(...tokenize(name || ''));
  }

  const body = tokenize(readableBody(source.bodyText, source.bodyHtml).slice(0, MAX_INDEXED_CHARS));

  // Le contenu des documents joints est tokenisé à part plutôt que concaténé au
  // corps : chacun voit son temps de calcul borné, et la répartition du plafond
  // ci-dessous peut alors réserver une part à chacun.
  const attached = tokenize((source.attachmentText || '').slice(0, MAX_INDEXED_CHARS));

  const seen = new Set<string>();
  const out: string[] = [];

  /** Ajoute jusqu'à `limit` termes inédits, sans dépasser le plafond global. */
  const take = (terms: string[], limit: number) => {
    let added = 0;
    for (const term of terms) {
      if (out.length >= MAX_TERMS_PER_MESSAGE || added >= limit) return;
      if (seen.has(term)) continue;
      seen.add(term);
      out.push(term);
      added += 1;
    }
  };

  // 1. L'identité du message d'abord : objet, correspondants, noms de fichiers.
  //    Court, et c'est ce que les gens tapent en premier.
  take(head, MAX_TERMS_PER_MESSAGE);

  // 2. Le corps, amputé de la part réservée aux documents joints.
  const remaining = MAX_TERMS_PER_MESSAGE - out.length;
  const reserved = Math.min(attached.length, ATTACHMENT_TERM_QUOTA, remaining);
  take(body, remaining - reserved);

  // 3. Les documents joints, qui récupèrent aussi ce que le corps n'a pas pris.
  take(attached, MAX_TERMS_PER_MESSAGE);

  // 4. Et le corps reprend l'éventuel reliquat.
  take(body, MAX_TERMS_PER_MESSAGE);

  return out;
}

/**
 * Aperçu affiché dans la liste. Stocké sur l'enregistrement d'en-tête, jamais
 * sur le corps : afficher une liste ne doit jamais désérialiser de corps.
 */
export function makeSnippet(
  bodyText?: string | null,
  bodyHtml?: string | null,
  max = 200,
): string {
  const text = readableBody(bodyText, bodyHtml).replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  // Couper au dernier espace pour ne pas trancher un mot en deux.
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut}…`;
}
