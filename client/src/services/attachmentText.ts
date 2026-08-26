/**
 * Extraction du texte des pièces jointes bureautiques, pour l'indexation.
 *
 * Appelé **à l'ouverture d'un message**, jamais pendant le remplissage du
 * cache. La raison tient en une ligne : `getMessage` a déjà téléchargé les
 * octets des pièces jointes pour les afficher, donc les indexer à ce moment-là
 * ne coûte **aucun octet de réseau supplémentaire**. Les extraire pendant le
 * remplissage imposerait au contraire de rapatrier toutes les pièces jointes de
 * la boîte — plusieurs giga-octets — et détruirait précisément ce qui rend un
 * cache complet abordable.
 *
 * Les bibliothèques utilisées (`mammoth`, `xlsx`) sont déjà des dépendances du
 * projet et servent à l'aperçu des pièces jointes ; elles sont chargées en
 * import dynamique, donc absentes du bundle principal.
 *
 * Le PDF est traité pour sa **couche texte** uniquement. Les multifonctions
 * récentes océrisent à la numérisation, si bien qu'un PDF scanné en possède une
 * dans la grande majorité des cas ; celui qui n'en a pas ressort simplement
 * vide, sans erreur. Aucun OCR n'est fait ici : il coûterait une dizaine de Mo
 * de bibliothèque et plusieurs secondes par page.
 *
 * PDF.js est utilisé en version corrigée de l'avis GHSA-hq66-cqwq-w95j
 * (exécution de JavaScript à l'ouverture d'un PDF malveillant), et configuré
 * pour n'extraire que du texte : ni script, ni rendu, ni `eval`. Dans un client
 * mail, les pièces jointes viennent d'expéditeurs quelconques — c'est le seul
 * réglage défendable.
 */

// Le worker est référencé par URL : Vite l'émet comme fichier séparé, il n'est
// téléchargé qu'au premier PDF rencontré.
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

/** Fichiers plus gros que cela : le coût d'extraction dépasse le bénéfice. */
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

/** Texte retenu par pièce jointe. */
const MAX_TEXT_PER_ATTACHMENT = 128 * 1024;

/** Texte cumulé retenu pour un message, toutes pièces jointes confondues. */
const MAX_TEXT_PER_MESSAGE = 256 * 1024;

/** Nombre de feuilles parcourues dans un classeur — au-delà, on plafonne. */
const MAX_SHEETS = 10;

/** Pages de PDF parcourues. Un rapport de 400 pages n'apporte rien de plus
 *  à l'index que ses premières dizaines, et coûterait des secondes. */
const MAX_PDF_PAGES = 50;

export interface IndexableAttachment {
  filename?: string;
  contentType?: string;
  /** Contenu en base64, tel que `getMessage` le renvoie. */
  content?: string;
  size?: number;
}

function extensionOf(filename?: string): string {
  if (!filename) return '';
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot + 1).toLowerCase();
}

type Kind = 'docx' | 'sheet' | 'pdf' | 'plain' | null;

/**
 * Format reconnu, d'après le type MIME **et** l'extension : les serveurs de
 * messagerie étiquettent très souvent les pièces jointes en
 * `application/octet-stream`, l'extension est alors le seul indice.
 */
export function kindOf(contentType?: string, filename?: string): Kind {
  const type = (contentType || '').toLowerCase();
  const ext = extensionOf(filename);

  if (type.includes('wordprocessingml.document') || ext === 'docx') return 'docx';
  if (
    type.includes('spreadsheetml.sheet')
    || type.includes('ms-excel')
    || ext === 'xlsx'
    || ext === 'xls'
    || ext === 'csv'
  ) {
    return 'sheet';
  }
  if (type.includes('pdf') || ext === 'pdf') return 'pdf';
  if (type.startsWith('text/') || ext === 'txt' || ext === 'md' || ext === 'log') return 'plain';
  return null;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function extractOne(att: IndexableAttachment, kind: Kind): Promise<string> {
  if (!att.content) return '';

  const bytes = base64ToBytes(att.content);
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) return '';

  if (kind === 'plain') {
    return new TextDecoder().decode(bytes).slice(0, MAX_TEXT_PER_ATTACHMENT);
  }

  if (kind === 'docx') {
    const mammoth = await import('mammoth');
    // Le tampon est alloué juste au-dessus par `base64ToBytes` : c'est
    // toujours un ArrayBuffer simple, jamais un SharedArrayBuffer.
    const arrayBuffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    // `extractRawText` plutôt que `convertToHtml` : on indexe du texte, et le
    // balisage ne ferait que gonfler l'index sans rien apporter.
    const { value } = await mammoth.extractRawText({ arrayBuffer });
    return (value || '').slice(0, MAX_TEXT_PER_ATTACHMENT);
  }

  if (kind === 'pdf') return extractPdf(bytes);

  if (kind === 'sheet') {
    const XLSX = await import('xlsx');
    const workbook = XLSX.read(bytes, { type: 'array' });
    const parts: string[] = [];
    let total = 0;
    for (const name of workbook.SheetNames.slice(0, MAX_SHEETS)) {
      const sheet = workbook.Sheets[name];
      if (!sheet) continue;
      // Le nom de la feuille est souvent parlant (« Devis », « 2026 »).
      const csv = `${name}\n${XLSX.utils.sheet_to_csv(sheet)}`;
      parts.push(csv);
      total += csv.length;
      if (total >= MAX_TEXT_PER_ATTACHMENT) break;
    }
    return parts.join('\n').slice(0, MAX_TEXT_PER_ATTACHMENT);
  }

  return '';
}

/**
 * Couche texte d'un PDF.
 *
 * Rien n'est rendu et aucun script n'est exécuté : on ouvre le document, on
 * demande le contenu textuel de chaque page, et on referme. `isEvalSupported`
 * est désactivé, le moteur de scripting n'est jamais chargé, et les polices ne
 * sont pas résolues — autant de surface d'attaque en moins face à un PDF venu
 * d'un expéditeur inconnu.
 *
 * Un PDF sans couche texte (numérisation non océrisée) renvoie une chaîne vide.
 * Ce n'est pas une erreur : le message reste trouvable par son objet, ses
 * correspondants, son corps et le nom du fichier.
 */
async function extractPdf(bytes: Uint8Array): Promise<string> {
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

  const task = pdfjs.getDocument({
    data: bytes,
    isEvalSupported: false,
    disableAutoFetch: true,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  });

  try {
    const doc = await task.promise;
    const pageCount = Math.min(Number(doc.numPages) || 0, MAX_PDF_PAGES);
    const parts: string[] = [];
    let total = 0;

    for (let i = 1; i <= pageCount; i += 1) {
      const page = await doc.getPage(i);
      try {
        const content = await page.getTextContent();
        const text = (content.items || [])
          .map((item: any) => (typeof item?.str === 'string' ? item.str : ''))
          .join(' ');
        if (text.trim()) {
          parts.push(text);
          total += text.length;
        }
      } finally {
        page.cleanup();
      }
      if (total >= MAX_TEXT_PER_ATTACHMENT) break;
    }

    return parts.join('\n').slice(0, MAX_TEXT_PER_ATTACHMENT);
  } finally {
    // Toujours par la tâche de chargement : `PDFDocumentProxy` n'expose plus de
    // `destroy()` depuis PDF.js 6, seulement `cleanup()`. Sans cet appel, le
    // worker garde le document en mémoire — rédhibitoire quand on enchaîne les
    // pièces jointes d'une boîte entière.
    try {
      await task.destroy();
    } catch {
      /* le document n'a jamais été ouvert */
    }
  }
}

/**
 * Texte indexable de toutes les pièces jointes exploitables d'un message.
 *
 * Ne rejette jamais : une pièce jointe corrompue ou dans un format inattendu
 * est simplement ignorée. L'indexation est un confort, elle ne doit jamais
 * empêcher la mise en cache du message lui-même.
 */
export async function extractAttachmentText(
  attachments: IndexableAttachment[] | null | undefined,
): Promise<string> {
  if (!attachments?.length) return '';

  const parts: string[] = [];
  let total = 0;

  for (const att of attachments) {
    if (total >= MAX_TEXT_PER_MESSAGE) break;
    const kind = kindOf(att.contentType, att.filename);
    if (!kind) continue;

    try {
      const text = await extractOne(att, kind);
      if (!text) continue;
      parts.push(text);
      total += text.length;
    } catch {
      // Format inattendu, fichier tronqué, mémoire insuffisante — on passe.
    }
  }

  return parts.join('\n').slice(0, MAX_TEXT_PER_MESSAGE);
}

/** Y a-t-il au moins une pièce jointe dont on saurait extraire du texte ? */
export function hasExtractableAttachment(
  attachments: IndexableAttachment[] | null | undefined,
): boolean {
  return (attachments || []).some((a) => kindOf(a.contentType, a.filename) !== null);
}
