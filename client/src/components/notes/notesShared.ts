import DOMPurify from 'dompurify';
import type { NoteColor } from '../../api';
import { api } from '../../api';

/**
 * Socle commun au panneau latéral « Notes » (insertion dans un message, façon
 * panneau emoji) et à la grande modale (recherche / création / aperçu).
 *
 * Les deux vues partagent : la palette de couleurs, le classement des fichiers
 * Nextcloud par type, et surtout l'extraction du contenu d'un fichier — c'est
 * elle qui permet de « récupérer les informations d'un fichier » puis de les
 * coller dans le corps du mail.
 */

// ─────────────────────────────────────────────────────────────────────────
// Couleurs de note
// ─────────────────────────────────────────────────────────────────────────

export const NOTE_COLORS: NoteColor[] = [
  'default', 'yellow', 'green', 'blue', 'pink', 'purple', 'orange',
];

export const NOTE_COLOR_LABELS: Record<NoteColor, string> = {
  default: 'Aucune',
  yellow: 'Jaune',
  green: 'Vert',
  blue: 'Bleu',
  pink: 'Rose',
  purple: 'Violet',
  orange: 'Orange',
};

/** Pastille de couleur (bordure gauche de la carte + sélecteur de couleur). */
export const NOTE_COLOR_HEX: Record<NoteColor, string> = {
  default: '#94a3b8',
  yellow: '#eab308',
  green: '#22c55e',
  blue: '#3b82f6',
  pink: '#ec4899',
  purple: '#a855f7',
  orange: '#f97316',
};

// ─────────────────────────────────────────────────────────────────────────
// Fichiers Nextcloud
// ─────────────────────────────────────────────────────────────────────────

export interface NcItem {
  name: string;
  path: string;
  isFolder: boolean;
  size?: number;
  contentType?: string;
}

export type FileKind = 'folder' | 'text' | 'docx' | 'xlsx' | 'image' | 'pdf' | 'other';

/**
 * Au-delà de cette taille on refuse d'extraire : le fichier transite en base64
 * dans une réponse JSON, et l'extraction (mammoth / xlsx) se fait en mémoire
 * dans l'onglet. L'utilisateur garde la possibilité de joindre le fichier.
 */
export const MAX_EXTRACT_BYTES = 8 * 1024 * 1024;

const TEXT_EXTENSIONS = [
  'txt', 'md', 'markdown', 'csv', 'tsv', 'log', 'json', 'xml', 'yml', 'yaml',
  'html', 'htm', 'ics', 'vcf', 'sql', 'ini', 'conf', 'srt',
];

function extensionOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

export function classifyFile(item: { name: string; isFolder?: boolean; contentType?: string }): FileKind {
  if (item.isFolder) return 'folder';
  const ext = extensionOf(item.name);
  const type = (item.contentType || '').toLowerCase();

  if (ext === 'docx' || type.includes('wordprocessingml')) return 'docx';
  if (['xlsx', 'xlsm', 'xls', 'ods'].includes(ext) || type.includes('spreadsheetml') || type.includes('ms-excel')) return 'xlsx';
  if (ext === 'pdf' || type.includes('pdf')) return 'pdf';
  if (type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return 'image';
  if (TEXT_EXTENSIONS.includes(ext) || type.startsWith('text/') || type.includes('json') || type.includes('xml')) return 'text';
  return 'other';
}

export function formatSize(bytes?: number): string {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export function parentPath(path: string): string {
  const segs = path.split('/').filter(Boolean);
  segs.pop();
  return '/' + segs.join('/');
}

function base64ToBytes(b64: string) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Texte brut → HTML de composition : paragraphes séparés par les lignes vides. */
export function textToHtml(text: string): string {
  const blocks = text.replace(/\r\n/g, '\n').split(/\n{2,}/);
  return blocks
    .map(b => `<p>${escapeHtml(b.trim()).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/** HTML → texte lisible (extrait de liste, copie dans le presse-papier). */
export function htmlToPlainText(html: string): string {
  const doc = new DOMParser().parseFromString(
    html
      .replace(/<\s*br\s*\/?\s*>/gi, '\n')
      .replace(/<\s*\/\s*(p|div|li|tr|h[1-6]|blockquote|pre)\s*>/gi, '\n'),
    'text/html',
  );
  return (doc.body.textContent || '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface ExtractedFile {
  kind: FileKind;
  /** HTML prêt à être inséré dans le corps du message (déjà assaini). */
  html: string;
  /** Équivalent texte, pour la copie presse-papier et l'enregistrement en note. */
  text: string;
  /** Object URL pour les types qu'on ne sait qu'afficher (PDF, images). */
  objectUrl?: string;
  /** Message explicatif quand le contenu n'est pas extractible en texte. */
  notice?: string;
}

/**
 * Télécharge un fichier Nextcloud et en extrait un contenu réutilisable.
 *
 * - texte / markdown / csv / json… : décodé en UTF-8 puis mis en paragraphes ;
 * - .docx : converti en HTML via mammoth (même chemin que l'aperçu des pièces
 *   jointes dans MessageView) ;
 * - .xlsx / .ods : première feuille rendue en tableau HTML via xlsx ;
 * - images : balise <img> en data URI, insérable telle quelle ;
 * - PDF et binaires : pas d'extraction texte possible sans dépendance
 *   supplémentaire — on renvoie un object URL pour l'aperçu natif du
 *   navigateur, où le texte reste sélectionnable et copiable.
 *
 * L'appelant est responsable de révoquer `objectUrl`.
 */
export async function extractNextcloudFile(item: NcItem): Promise<ExtractedFile> {
  const kind = classifyFile(item);

  if (item.size != null && item.size > MAX_EXTRACT_BYTES) {
    return {
      kind,
      html: '',
      text: '',
      notice: `Fichier trop volumineux pour être lu ici (${formatSize(item.size)}, limite ${formatSize(MAX_EXTRACT_BYTES)}). Vous pouvez le joindre au message.`,
    };
  }

  const res = await api.nextcloudFilesGet(item.path);
  const bytes = base64ToBytes(res.contentBase64);
  const mime = (res.contentType || item.contentType || '').split(';')[0].trim();

  if (kind === 'docx') {
    const mammoth = await import('mammoth');
    const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const { value } = await mammoth.convertToHtml({ arrayBuffer });
    const html = DOMPurify.sanitize(value);
    return { kind, html, text: htmlToPlainText(html) };
  }

  if (kind === 'xlsx') {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(bytes, { type: 'array' });
    const sheetName = wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    if (!sheet) return { kind, html: '', text: '', notice: 'Classeur vide.' };
    // `editable: false` produit une table simple ; on la borde pour qu'elle
    // reste lisible une fois collée dans un e-mail.
    const raw = XLSX.utils.sheet_to_html(sheet, { editable: false });
    const html = DOMPurify.sanitize(raw)
      .replace(/<table/i, '<table style="border-collapse:collapse;border:1px solid #d0d0d0"')
      .replace(/<td/gi, '<td style="border:1px solid #d0d0d0;padding:4px 6px"');
    return { kind, html, text: XLSX.utils.sheet_to_csv(sheet) };
  }

  if (kind === 'image') {
    const dataUri = `data:${mime || 'image/png'};base64,${res.contentBase64}`;
    return {
      kind,
      html: `<img src="${dataUri}" alt="${escapeHtml(item.name)}" style="max-width:100%;height:auto;" />`,
      text: '',
      objectUrl: dataUri,
      notice: 'Image : insérée telle quelle dans le message.',
    };
  }

  if (kind === 'text') {
    const decoded = new TextDecoder('utf-8').decode(bytes);
    // Un fichier HTML est déjà du balisage : on l'assainit au lieu de
    // l'échapper, sinon l'utilisateur colle du code source dans son mail.
    const ext = extensionOf(item.name);
    if (ext === 'html' || ext === 'htm') {
      const html = DOMPurify.sanitize(decoded);
      return { kind, html, text: htmlToPlainText(html) };
    }
    return { kind, html: textToHtml(decoded), text: decoded };
  }

  const blob = new Blob([bytes], { type: mime || 'application/octet-stream' });
  const objectUrl = URL.createObjectURL(blob);
  return {
    kind,
    html: '',
    text: '',
    objectUrl,
    notice: kind === 'pdf'
      ? 'PDF : le texte n\'est pas extrait automatiquement. Sélectionnez-le dans l\'aperçu pour le copier, ou joignez le fichier au message.'
      : 'Type de fichier non convertible en texte. Vous pouvez le joindre au message.',
  };
}

/** Télécharge un fichier Nextcloud sous forme de File, prêt à être joint. */
export async function nextcloudItemToFile(item: NcItem): Promise<File> {
  const res = await api.nextcloudFilesGet(item.path);
  const mime = (res.contentType || '').split(';')[0].trim() || 'application/octet-stream';
  const bytes = base64ToBytes(res.contentBase64);
  return new File([new Blob([bytes], { type: mime })], res.filename || item.name, { type: mime });
}

/** Extrait court d'une note pour l'affichage en liste. */
export function noteExcerpt(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** Date relative courte (« il y a 3 h ») utilisée dans les listes. */
export function relativeDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const days = Math.floor(h / 24);
  if (days < 7) return `il y a ${days} j`;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}
