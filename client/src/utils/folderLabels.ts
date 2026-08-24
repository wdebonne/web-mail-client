// Noms de dossiers IMAP → libellés lisibles en français.
//
// Les dossiers remontés par le serveur portent leur nom technique (« INBOX »,
// « INBOX.Sent »…). Partout où un dossier est montré à l'utilisateur — liste de
// messages, filtres de recherche, fil d'Ariane — on affiche le libellé humain.

const FOLDER_LABELS: Record<string, string> = {
  'INBOX': 'Boîte de réception',
  'Sent': 'Éléments envoyés',
  'Sent Items': 'Éléments envoyés',
  'Drafts': 'Brouillons',
  'Trash': 'Éléments supprimés',
  'Deleted': 'Éléments supprimés',
  'Deleted Items': 'Éléments supprimés',
  'Junk': 'Courrier indésirable',
  'Spam': 'Courrier indésirable',
  'Archive': 'Archives',
};

export function resolveFolderDisplayName(folder: string): string {
  if (!folder) return '';

  // Try leaf segment against common folder names (handles `.` and `/` delimiters).
  const segments = folder.split(/[./]/);
  const leaf = segments[segments.length - 1] || folder;
  const mapped = FOLDER_LABELS[folder] || FOLDER_LABELS[leaf];
  if (mapped) return mapped;

  // For any nested folder, display only the leaf name (e.g. "test sous" instead of "test.test sous").
  if (segments.length > 1) return leaf;

  if (folder.toUpperCase().startsWith('INBOX.')) {
    return folder.substring(6);
  }

  return folder;
}
