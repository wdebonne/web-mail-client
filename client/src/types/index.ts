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
  attachments?: Attachment[];
  size: number;
  headers?: {
    inReplyTo?: string;
    references?: string;
  };
  fromCache?: boolean;
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
  reminder_minutes?: number;
  attendees?: EventAttendee[];
  status: string;
  calendar_name?: string;
  calendar_color?: string;
}

export interface EventAttendee {
  email: string;
  name?: string;
  status: string;
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
