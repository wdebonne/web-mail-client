import type { MailRuleConditionType, MailRuleActionType } from '../api';

export const CONDITION_LABELS: Record<MailRuleConditionType, string> = {
  fromContains: 'De — contient',
  toContains: 'À — contient',
  ccContains: 'Cc — contient',
  subjectContains: "L'objet contient",
  subjectOrBodyContains: "L'objet ou le corps contient",
  bodyContains: 'Le corps du message contient',
  recipientAddressContains: "L'adresse du destinataire contient",
  senderAddressContains: "L'adresse de l'expéditeur contient",
  headerContains: "L'en-tête du message contient",
  hasAttachment: 'Le message contient une pièce jointe',
  importance: 'Importance',
  sensitivity: 'Niveau de confidentialité',
  sentOnlyToMe: 'Je suis le seul destinataire',
  myNameInTo: 'Mon nom figure dans la ligne À',
  myNameInCc: 'Mon nom figure dans la ligne Cc',
  myNameInToOrCc: 'Mon nom figure dans la ligne À ou Cc',
  myNameNotInTo: 'Mon nom ne figure pas dans la ligne À',
  flagged: 'Marqué comme important',
  sizeAtLeast: 'Taille au moins (octets)',
};

export const CONDITION_GROUPS: { label: string; types: MailRuleConditionType[] }[] = [
  { label: 'Contacts', types: ['fromContains', 'toContains', 'ccContains', 'recipientAddressContains', 'senderAddressContains'] },
  { label: 'Mon nom', types: ['myNameInTo', 'myNameInCc', 'myNameInToOrCc', 'myNameNotInTo', 'sentOnlyToMe'] },
  { label: 'Objet', types: ['subjectContains', 'subjectOrBodyContains', 'bodyContains'] },
  { label: 'Mots clés', types: ['headerContains'] },
  { label: 'Marqué avec', types: ['importance', 'sensitivity', 'flagged'] },
  { label: 'Le message contient', types: ['hasAttachment', 'sizeAtLeast'] },
];

export const ACTION_LABELS: Record<MailRuleActionType, string> = {
  moveToFolder: 'Déplacer vers le dossier',
  copyToFolder: 'Copier vers le dossier',
  delete: 'Supprimer (corbeille)',
  permanentlyDelete: 'Supprimer définitivement',
  markAsRead: 'Marquer comme lu',
  markAsUnread: 'Marquer comme non lu',
  flag: 'Marquer comme important',
  unflag: "Retirer l'indicateur",
  forwardTo: 'Transférer à',
  redirectTo: 'Rediriger vers',
  replyWithTemplate: 'Répondre avec un modèle',
  stopProcessingMoreRules: 'Ne plus traiter de règles',
};

export const ACTION_GROUPS: { label: string; types: MailRuleActionType[] }[] = [
  { label: 'Déplacer / supprimer', types: ['moveToFolder', 'copyToFolder', 'delete', 'permanentlyDelete'] },
  { label: 'Marquer', types: ['markAsRead', 'markAsUnread', 'flag', 'unflag'] },
  { label: 'Transférer / répondre', types: ['forwardTo', 'redirectTo', 'replyWithTemplate'] },
  { label: 'Avancé', types: ['stopProcessingMoreRules'] },
];

export const IMPORTANCE_LEVELS = ['high', 'normal', 'low'] as const;
export const SENSITIVITY_LEVELS = ['confidential', 'private', 'personal', 'normal'] as const;

export function conditionNeedsValue(t: MailRuleConditionType): boolean {
  switch (t) {
    case 'hasAttachment':
    case 'sentOnlyToMe':
    case 'myNameInTo':
    case 'myNameInCc':
    case 'myNameInToOrCc':
    case 'myNameNotInTo':
    case 'flagged':
    case 'importance':
    case 'sensitivity':
    case 'sizeAtLeast':
      return false;
    default:
      return true;
  }
}

export function actionNeedsValue(t: MailRuleActionType): 'folder' | 'addresses' | 'template' | null {
  switch (t) {
    case 'moveToFolder':
    case 'copyToFolder':
      return 'folder';
    case 'forwardTo':
    case 'redirectTo':
      return 'addresses';
    case 'replyWithTemplate':
      return 'template';
    default:
      return null;
  }
}

export function summarizeRule(rule: { conditions: { type: MailRuleConditionType; value?: string }[]; actions: { type: MailRuleActionType; folder?: string; to?: string }[] }): string {
  const c = rule.conditions[0];
  const a = rule.actions[0];
  const condLabel = c
    ? `${CONDITION_LABELS[c.type] || c.type}${c.value ? ` « ${c.value} »` : ''}`
    : '(aucune condition)';
  const actLabel = a
    ? `${ACTION_LABELS[a.type] || a.type}${a.folder ? ` → ${a.folder}` : a.to ? ` → ${a.to}` : ''}`
    : '(aucune action)';
  return `Si ${condLabel.toLowerCase()} → ${actLabel}`;
}
