import { pgTable, uuid, varchar, text, boolean, integer, timestamp, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';

// Users
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  displayName: varchar('display_name', { length: 255 }),
  avatarUrl: text('avatar_url'),
  role: varchar('role', { length: 50 }).default('user'),
  isAdmin: boolean('is_admin').default(false),
  language: varchar('language', { length: 10 }).default('fr'),
  timezone: varchar('timezone', { length: 50 }).default('Europe/Paris'),
  theme: varchar('theme', { length: 20 }).default('light'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Groups
export const groups = pgTable('groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  color: varchar('color', { length: 7 }).default('#0078D4'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const userGroups = pgTable('user_groups', {
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  groupId: uuid('group_id').references(() => groups.id, { onDelete: 'cascade' }),
});

// Mail accounts
export const mailAccounts = pgTable('mail_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull(),
  imapHost: varchar('imap_host', { length: 255 }).notNull(),
  imapPort: integer('imap_port').default(993),
  imapSecure: boolean('imap_secure').default(true),
  smtpHost: varchar('smtp_host', { length: 255 }).notNull(),
  smtpPort: integer('smtp_port').default(465),
  smtpSecure: boolean('smtp_secure').default(true),
  username: varchar('username', { length: 255 }).notNull(),
  passwordEncrypted: text('password_encrypted').notNull(),
  isDefault: boolean('is_default').default(false),
  isShared: boolean('is_shared').default(false),
  signatureHtml: text('signature_html'),
  signatureText: text('signature_text'),
  color: varchar('color', { length: 7 }).default('#0078D4'),
  syncInterval: integer('sync_interval').default(5),
  lastSync: timestamp('last_sync'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Mailbox assignments (admin assigns accounts to users with permissions)
export const mailboxAssignments = pgTable('mailbox_assignments', {
  id: uuid('id').primaryKey().defaultRandom(),
  mailAccountId: uuid('mail_account_id').references(() => mailAccounts.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  displayName: varchar('display_name', { length: 255 }),
  sendPermission: varchar('send_permission', { length: 20 }).default('none'),
  isDefault: boolean('is_default').default(false),
  createdAt: timestamp('created_at').defaultNow(),
});

// Cached emails
export const cachedEmails = pgTable('cached_emails', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').references(() => mailAccounts.id, { onDelete: 'cascade' }),
  messageId: varchar('message_id', { length: 512 }),
  uid: integer('uid'),
  folder: varchar('folder', { length: 255 }).default('INBOX'),
  subject: text('subject'),
  fromAddress: text('from_address'),
  fromName: text('from_name'),
  toAddresses: jsonb('to_addresses'),
  ccAddresses: jsonb('cc_addresses'),
  bccAddresses: jsonb('bcc_addresses'),
  date: timestamp('date'),
  bodyText: text('body_text'),
  bodyHtml: text('body_html'),
  snippet: text('snippet'),
  isRead: boolean('is_read').default(false),
  isFlagged: boolean('is_flagged').default(false),
  isDraft: boolean('is_draft').default(false),
  hasAttachments: boolean('has_attachments').default(false),
  attachments: jsonb('attachments'),
  headers: jsonb('headers'),
  size: integer('size'),
  createdAt: timestamp('created_at').defaultNow(),
});

// Outbox
export const outbox = pgTable('outbox', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  accountId: uuid('account_id').references(() => mailAccounts.id, { onDelete: 'cascade' }),
  toAddresses: jsonb('to_addresses').notNull(),
  ccAddresses: jsonb('cc_addresses'),
  bccAddresses: jsonb('bcc_addresses'),
  subject: text('subject'),
  bodyHtml: text('body_html'),
  bodyText: text('body_text'),
  attachments: jsonb('attachments'),
  status: varchar('status', { length: 20 }).default('pending'),
  error: text('error'),
  scheduledAt: timestamp('scheduled_at'),
  createdAt: timestamp('created_at').defaultNow(),
});

// Contacts
export const contacts = pgTable('contacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  email: varchar('email', { length: 255 }),
  firstName: varchar('first_name', { length: 255 }),
  lastName: varchar('last_name', { length: 255 }),
  displayName: varchar('display_name', { length: 255 }),
  phone: varchar('phone', { length: 50 }),
  mobile: varchar('mobile', { length: 50 }),
  company: varchar('company', { length: 255 }),
  jobTitle: varchar('job_title', { length: 255 }),
  department: varchar('department', { length: 255 }),
  avatarUrl: text('avatar_url'),
  avatarData: text('avatar_data'),
  notes: text('notes'),
  isFavorite: boolean('is_favorite').default(false),
  source: varchar('source', { length: 50 }).default('local'),
  externalId: varchar('external_id', { length: 255 }),
  vcard: text('vcard'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Contact groups
export const contactGroups = pgTable('contact_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  source: varchar('source', { length: 50 }).default('local'),
  externalId: varchar('external_id', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow(),
});

export const contactGroupMembers = pgTable('contact_group_members', {
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'cascade' }),
  groupId: uuid('group_id').references(() => contactGroups.id, { onDelete: 'cascade' }),
});

// Distribution lists
export const distributionLists = pgTable('distribution_lists', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  members: jsonb('members').notNull().default([]),
  source: varchar('source', { length: 50 }).default('local'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Calendars
export const calendars = pgTable('calendars', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  color: varchar('color', { length: 7 }).default('#0078D4'),
  isVisible: boolean('is_visible').default(true),
  isDefault: boolean('is_default').default(false),
  isShared: boolean('is_shared').default(false),
  source: varchar('source', { length: 50 }).default('local'),
  caldavUrl: text('caldav_url'),
  externalId: varchar('external_id', { length: 255 }),
  syncToken: text('sync_token'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Calendar events
export const calendarEvents = pgTable('calendar_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  calendarId: uuid('calendar_id').references(() => calendars.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  location: text('location'),
  startDate: timestamp('start_date').notNull(),
  endDate: timestamp('end_date').notNull(),
  allDay: boolean('all_day').default(false),
  recurrenceRule: text('recurrence_rule'),
  reminderMinutes: integer('reminder_minutes'),
  attendees: jsonb('attendees'),
  organizer: jsonb('organizer'),
  status: varchar('status', { length: 50 }).default('confirmed'),
  icalUid: varchar('ical_uid', { length: 255 }),
  icalData: text('ical_data'),
  isRecurring: boolean('is_recurring').default(false),
  externalId: varchar('external_id', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Plugins
export const plugins = pgTable('plugins', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull().unique(),
  displayName: varchar('display_name', { length: 255 }),
  description: text('description'),
  version: varchar('version', { length: 50 }),
  author: varchar('author', { length: 255 }),
  icon: varchar('icon', { length: 255 }),
  entryPoint: varchar('entry_point', { length: 255 }),
  config: jsonb('config').default({}),
  isActive: boolean('is_active').default(false),
  isSystem: boolean('is_system').default(false),
  permissions: jsonb('permissions').default([]),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Plugin assignments
export const pluginAssignments = pgTable('plugin_assignments', {
  id: uuid('id').primaryKey().defaultRandom(),
  pluginId: uuid('plugin_id').references(() => plugins.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  groupId: uuid('group_id').references(() => groups.id, { onDelete: 'cascade' }),
  config: jsonb('config').default({}),
});

// Admin settings
export const adminSettings = pgTable('admin_settings', {
  key: varchar('key', { length: 255 }).primaryKey(),
  value: jsonb('value').notNull(),
  description: text('description'),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Web Push subscriptions (native push notifications)
export const pushSubscriptions = pgTable('push_subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  authKey: text('auth_key').notNull(),
  userAgent: text('user_agent'),
  platform: varchar('platform', { length: 50 }),
  enabled: boolean('enabled').default(true),
  createdAt: timestamp('created_at').defaultNow(),
  lastUsedAt: timestamp('last_used_at').defaultNow(),
});
