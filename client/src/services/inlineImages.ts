/**
 * Résolution des images incorporées au corps d'un message (`cid:`).
 *
 * Un message à signature ou en-tête illustré référence ses images par
 * `<img src="cid:identifiant">`. Cette syntaxe ne veut rien dire pour un
 * navigateur : sans la table construite ici, ces images s'affichaient toutes
 * comme des liens morts.
 *
 * Isolé du composant d'affichage pour rester vérifiable : la normalisation des
 * identifiants et l'ordre de préférence des sources sont exactement le genre de
 * détails qui se cassent en silence.
 */

/** Retire les chevrons et l'espace autour d'un Content-ID. */
function normalizeContentId(id: string): string {
  return String(id).replace(/^<|>$/g, '').trim();
}

export interface InlineImageSource {
  contentId?: string | null;
  contentType?: string | null;
  /** Octets en base64. */
  data?: string | null;
}

export interface AttachmentSource {
  contentId?: string | null;
  contentType?: string | null;
  /** Octets en base64, présents seulement sur la réponse d'ouverture. */
  content?: string | null;
}

/**
 * Table `cid:` → URL `data:`.
 *
 * Deux sources, dans cet ordre de préférence :
 *  1. les images incorporées mises en cache — déjà en base64, donc aucune
 *     conversion à faire au moment de l'affichage ;
 *  2. à défaut, les pièces jointes renvoyées par le serveur à l'ouverture.
 *
 * La première l'emporte : c'est le chemin qui permet d'afficher un message
 * complet sans réseau.
 */
export function buildInlineImageMap(message: {
  inlineImages?: InlineImageSource[] | null;
  attachments?: AttachmentSource[] | null;
} | null | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!message) return map;

  for (const img of message.inlineImages || []) {
    if (!img?.contentId || !img?.data) continue;
    const cid = normalizeContentId(img.contentId);
    if (!cid) continue;
    map.set(cid, `data:${img.contentType || 'image/png'};base64,${img.data}`);
  }

  for (const att of message.attachments || []) {
    if (!att?.contentId || !att?.content) continue;
    const cid = normalizeContentId(att.contentId);
    if (!cid || map.has(cid)) continue;
    map.set(cid, `data:${att.contentType || 'application/octet-stream'};base64,${att.content}`);
  }

  return map;
}

/** Un `src` est-il une référence à une image incorporée ? */
export function isCidReference(src: string): boolean {
  return /^cid:/i.test(src.trim());
}

/** Identifiant porté par un `src` en `cid:`, normalisé. */
export function contentIdFromSrc(src: string): string {
  return normalizeContentId(src.trim().slice(4));
}

/**
 * Remplace dans le document les `src="cid:…"` par leur URL `data:`.
 *
 * Une image sans correspondance voit son `src` retiré plutôt que laissé tel
 * quel : mieux vaut un espace vide que l'icône de lien mort du navigateur.
 * Renvoie le nombre d'images résolues.
 */
export function resolveInlineImages(doc: Document, map: Map<string, string>): number {
  let resolved = 0;
  doc.querySelectorAll('img[src]').forEach((el) => {
    const src = el.getAttribute('src') ?? '';
    if (!isCidReference(src)) return;
    const url = map.get(contentIdFromSrc(src));
    if (url) {
      el.setAttribute('src', url);
      resolved += 1;
    } else {
      el.removeAttribute('src');
    }
  });
  return resolved;
}
