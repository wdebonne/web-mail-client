export interface User {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  role: string;
  isAdmin: boolean;
  language: string;
  timezone: string;
  theme: string;
}

export interface MailAccount {
  id: string;
  name: string;
  email: string;
  imap_host: string;
  imap_port: number;
  smtp_host: string;
  smtp_port: number;
  is_default: boolean;
  is_shared: boolean;
  signature_html?: string;
  signature_text?: string;
  color: string;
  sync_interval: number;
  last_sync?: string;
  assigned_display_name?: string;
  send_permission?: 'none' | 'send_as' | 'send_on_behalf';
  assigned_default?: boolean;
  /** Renseigné pour les boîtes liées en OAuth (Outlook / Microsoft 365). */
  oauth_provider?: string | null;
  /** Santé du lien OAuth — voir OAuthAccountStatus côté serveur. */
  oauth_status?: 'ok' | 'degraded' | 'needs_reauth' | 'config_error';
}

export interface MailFolder {
  path: string;
  name: string;
  delimiter: string;
  specialUse?: string;
  flags: string[];
}

export interface EmailAddress {
  address: string;
  name?: string;
  /** Present only when this recipient is a distribution list (not yet expanded) */
  _dl?: {
    id: string;
    name: string;
    description?: string;
    members: { email: string; name?: string }[];
  };
}

export interface Email {
  uid: number;
  messageId: string;
  subject: string;
  from: EmailAddress | null;
  to: EmailAddress[];
  cc?: EmailAddress[];
  date: string;
  bodyHtml?: string;
  bodyText?: string;
  snippet?: string;
  flags: {
    seen: boolean;
    flagged: boolean;
    answered: boolean;
    draft: boolean;
  };
  hasAttachments: boolean;
  largestAttachmentSize?: number;
  attachments?: Attachment[];
  /**
   * Images incorporées au corps, référencées par `cid:` dans le HTML.
   * Rapatriées avec le corps et conservées en base64 : un message à signature
   * illustrée s'affiche donc complet dès la lecture du cache.
   */
  inlineImages?: Array<{
    contentId: string;
    contentType: string;
    data: string;
    size: number;
  }>;
  size: number;
  headers?: {
    inReplyTo?: string;
    references?: string;
    /** Mécanisme de désabonnement annoncé par l'expéditeur (RFC 2369). */
    listUnsubscribe?: string;
    /** `List-Unsubscribe=One-Click` quand l'expéditeur gère le RFC 8058. */
    listUnsubscribePost?: string;
    listId?: string;
    /** Verdict du filtre antispam du serveur (SpamAssassin, Rspamd…). */
    xSpamFlag?: string;
    xSpamStatus?: string;
    xSpamLevel?: string;
    xSpamScore?: string;
  };
  fromCache?: boolean;
  /** Origin account id — set when message is displayed in a virtual/unified view. */
  _accountId?: string;
  /** Origin folder path — set when message is displayed in a virtual/unified view. */
  _folder?: string;
}

export interface Attachment {
  filename: string;
  contentType: string;
  size: number;
  contentId?: string;
  content?: string;
}

export interface Contact {
  id: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  display_name?: string;
  phone?: string;
  mobile?: string;
  company?: string;
  job_title?: string;
  department?: string;
  avatar_url?: string;
  avatar_data?: string;
  notes?: string;
  is_favorite: boolean;
  source: string;
  group_names?: string[];
  metadata?: Record<string, any>;
}

export interface ContactGroup {
  id: string;
  name: string;
  member_count: number;
  source: string;
}

export interface DistributionList {
  id: string;
  name: string;
  description?: string;
  members: EmailAddress[];
}

export interface Calendar {
  id: string;
  name: string;
  color: string;
  is_visible: boolean;
  is_default: boolean;
  is_shared: boolean;
  source: string;
  nc_managed?: boolean;
  caldav_url?: string | null;
}

export interface CalendarEvent {
  id: string;
  calendar_id: string;
  title: string;
  description?: string;
  location?: string;
  start_date: string;
  end_date: string;
  all_day: boolean;
  recurrence_rule?: string;
  rdates?: string[];
  reminder_minutes?: number | null;
  attendees?: EventAttendee[];
  organizer?: { email: string; name?: string };
  status: string;
  priority?: number | null;
  url?: string;
  categories?: string[];
  transparency?: 'OPAQUE' | 'TRANSPARENT';
  attachments?: Array<{ name: string; mime?: string; size?: number; data?: string; url?: string }>;
  calendar_name?: string;
  calendar_color?: string;
}

export interface EventAttendee {
  email: string;
  name?: string;
  role?: 'CHAIR' | 'REQ-PARTICIPANT' | 'OPT-PARTICIPANT' | 'NON-PARTICIPANT';
  status: string;
  rsvp?: boolean;
  comment?: string;
}

export interface Plugin {
  id: string;
  name: string;
  display_name: string;
  description?: string;
  version: string;
  author?: string;
  icon?: string;
  config: Record<string, any>;
  is_active: boolean;
  is_system: boolean;
}

export interface Group {
  id: string;
  name: string;
  description?: string;
  color: string;
  member_count: number;
}
