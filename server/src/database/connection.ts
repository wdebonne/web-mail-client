import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';
import { logger } from '../utils/logger';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://webmail:webmail_secure_pwd@localhost:5432/webmail',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Force every session to UTC so that TIMESTAMPTZ round-trips are stable
// regardless of the server's system timezone. Also apply to existing
// (idle) clients, and to every newly-checked-out connection.
pool.on('connect', (client) => {
  client.query("SET TIME ZONE 'UTC'").catch((err) => {
    logger.error(err, 'Failed to set session TIME ZONE to UTC');
  });
});

export const db = drizzle(pool, { schema });

export async function initDatabase() {
  const client = await pool.connect();
  try {
    // Run migrations
    await client.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid VARCHAR NOT NULL PRIMARY KEY,
        sess JSON NOT NULL,
        expire TIMESTAMP(6) NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions (expire);
    `);

    await client.query(`
      -- Users table
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        display_name VARCHAR(255),
        avatar_url TEXT,
        role VARCHAR(50) DEFAULT 'user',
        is_admin BOOLEAN DEFAULT false,
        language VARCHAR(10) DEFAULT 'fr',
        timezone VARCHAR(50) DEFAULT 'Europe/Paris',
        theme VARCHAR(20) DEFAULT 'light',
        attachment_action_mode VARCHAR(20) DEFAULT 'preview',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      ALTER TABLE users ADD COLUMN IF NOT EXISTS attachment_action_mode VARCHAR(20) DEFAULT 'preview';

      -- Per-user UI/preferences key/value store for cross-device sync
      -- (folder/account custom names, ordering, colors, calendar prefs,
      --  signatures, swipe prefs, theme, layout, etc.).
      -- Each row is keyed by (user_id, key); the client synchronises values
      -- using last-write-wins on the updated_at timestamp.
      CREATE TABLE IF NOT EXISTS user_preferences (
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        key VARCHAR(255) NOT NULL,
        value TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, key)
      );
      CREATE INDEX IF NOT EXISTS user_preferences_user_idx ON user_preferences(user_id);

      -- User groups
      CREATE TABLE IF NOT EXISTS groups (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        description TEXT,
        color VARCHAR(7) DEFAULT '#0078D4',
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS user_groups (
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
        PRIMARY KEY (user_id, group_id)
      );

      -- Mail accounts (IMAP/SMTP config per user)
      CREATE TABLE IF NOT EXISTS mail_accounts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        imap_host VARCHAR(255) NOT NULL,
        imap_port INTEGER DEFAULT 993,
        imap_secure BOOLEAN DEFAULT true,
        smtp_host VARCHAR(255) NOT NULL,
        smtp_port INTEGER DEFAULT 465,
        smtp_secure BOOLEAN DEFAULT true,
        username VARCHAR(255) NOT NULL,
        password_encrypted TEXT NOT NULL,
        is_default BOOLEAN DEFAULT false,
        is_shared BOOLEAN DEFAULT false,
        signature_html TEXT,
        signature_text TEXT,
        color VARCHAR(7) DEFAULT '#0078D4',
        sync_interval INTEGER DEFAULT 5,
        last_sync TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      -- Mailbox assignments (admin assigns accounts to users)
      CREATE TABLE IF NOT EXISTS mailbox_assignments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        mail_account_id UUID REFERENCES mail_accounts(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        display_name VARCHAR(255),
        send_permission VARCHAR(20) DEFAULT 'none',
        is_default BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(mail_account_id, user_id)
      );

      -- Shared mailbox access (legacy, kept for compat)
      CREATE TABLE IF NOT EXISTS shared_mailbox_access (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        mail_account_id UUID REFERENCES mail_accounts(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        permission VARCHAR(20) DEFAULT 'read',
        UNIQUE(mail_account_id, user_id)
      );

      -- Cached emails for offline and search
      CREATE TABLE IF NOT EXISTS cached_emails (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id UUID REFERENCES mail_accounts(id) ON DELETE CASCADE,
        message_id VARCHAR(512),
        uid INTEGER,
        folder VARCHAR(255) DEFAULT 'INBOX',
        subject TEXT,
        from_address TEXT,
        from_name TEXT,
        to_addresses JSONB,
        cc_addresses JSONB,
        bcc_addresses JSONB,
        date TIMESTAMP,
        body_text TEXT,
        body_html TEXT,
        snippet TEXT,
        is_read BOOLEAN DEFAULT false,
        is_flagged BOOLEAN DEFAULT false,
        is_draft BOOLEAN DEFAULT false,
        has_attachments BOOLEAN DEFAULT false,
        attachments JSONB,
        headers JSONB,
        size INTEGER,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_cached_emails_account ON cached_emails(account_id);
      CREATE INDEX IF NOT EXISTS idx_cached_emails_folder ON cached_emails(account_id, folder);
      CREATE INDEX IF NOT EXISTS idx_cached_emails_date ON cached_emails(date DESC);
      CREATE INDEX IF NOT EXISTS idx_cached_emails_search ON cached_emails USING GIN(to_tsvector('french', coalesce(subject,'') || ' ' || coalesce(from_name,'') || ' ' || coalesce(body_text,'')));

      -- Remove pre-existing duplicate rows before adding the unique index.
      DELETE FROM cached_emails
      WHERE id NOT IN (
        SELECT DISTINCT ON (account_id, folder, uid) id
        FROM cached_emails
        ORDER BY account_id, folder, uid, created_at ASC
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_cached_emails_unique ON cached_emails(account_id, folder, uid);

      -- Outbox (offline composed emails)
      CREATE TABLE IF NOT EXISTS outbox (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        account_id UUID REFERENCES mail_accounts(id) ON DELETE CASCADE,
        to_addresses JSONB NOT NULL,
        cc_addresses JSONB,
        bcc_addresses JSONB,
        subject TEXT,
        body_html TEXT,
        body_text TEXT,
        attachments JSONB,
        status VARCHAR(20) DEFAULT 'pending',
        error TEXT,
        scheduled_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );

      -- Contacts
      CREATE TABLE IF NOT EXISTS contacts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        email VARCHAR(255),
        first_name VARCHAR(255),
        last_name VARCHAR(255),
        display_name VARCHAR(255),
        phone VARCHAR(50),
        mobile VARCHAR(50),
        company VARCHAR(255),
        job_title VARCHAR(255),
        department VARCHAR(255),
        avatar_url TEXT,
        avatar_data TEXT,
        notes TEXT,
        is_favorite BOOLEAN DEFAULT false,
        source VARCHAR(50) DEFAULT 'local',
        external_id VARCHAR(255),
        vcard TEXT,
        metadata JSONB,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_contacts_user ON contacts(user_id);
      CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);
      CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts(user_id, last_name, first_name);

      -- Contact groups
      CREATE TABLE IF NOT EXISTS contact_groups (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        source VARCHAR(50) DEFAULT 'local',
        external_id VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS contact_group_members (
        contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
        group_id UUID REFERENCES contact_groups(id) ON DELETE CASCADE,
        PRIMARY KEY (contact_id, group_id)
      );

      -- Distribution lists
      CREATE TABLE IF NOT EXISTS distribution_lists (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        members JSONB NOT NULL DEFAULT '[]',
        source VARCHAR(50) DEFAULT 'local',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      -- Calendars
      CREATE TABLE IF NOT EXISTS calendars (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        color VARCHAR(7) DEFAULT '#0078D4',
        is_visible BOOLEAN DEFAULT true,
        is_default BOOLEAN DEFAULT false,
        is_shared BOOLEAN DEFAULT false,
        source VARCHAR(50) DEFAULT 'local',
        caldav_url TEXT,
        external_id VARCHAR(255),
        sync_token TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      -- Calendar events
      CREATE TABLE IF NOT EXISTS calendar_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        calendar_id UUID REFERENCES calendars(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        location TEXT,
        start_date TIMESTAMP NOT NULL,
        end_date TIMESTAMP NOT NULL,
        all_day BOOLEAN DEFAULT false,
        recurrence_rule TEXT,
        reminder_minutes INTEGER,
        attendees JSONB,
        organizer JSONB,
        status VARCHAR(50) DEFAULT 'confirmed',
        ical_uid VARCHAR(255),
        ical_data TEXT,
        is_recurring BOOLEAN DEFAULT false,
        external_id VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_events_calendar ON calendar_events(calendar_id);
      CREATE INDEX IF NOT EXISTS idx_events_dates ON calendar_events(start_date, end_date);

      -- Migrate naive TIMESTAMP columns to TIMESTAMPTZ so that JS ISO strings
      -- round-trip unchanged regardless of the OS timezone of the DB or API
      -- container. Existing naive values are assumed to be UTC (the session
      -- TZ is forced to UTC on every connection in this file).
      DO $mig$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'calendar_events' AND column_name = 'start_date' AND data_type = 'timestamp without time zone'
        ) THEN
          ALTER TABLE calendar_events
            ALTER COLUMN start_date TYPE TIMESTAMPTZ USING start_date AT TIME ZONE 'UTC',
            ALTER COLUMN end_date   TYPE TIMESTAMPTZ USING end_date   AT TIME ZONE 'UTC';
        END IF;
      END
      $mig$;

      -- CalDAV sync settings on mail accounts (added later)
      ALTER TABLE IF EXISTS mail_accounts ADD COLUMN IF NOT EXISTS caldav_url TEXT;
      ALTER TABLE IF EXISTS mail_accounts ADD COLUMN IF NOT EXISTS caldav_username VARCHAR(255);
      ALTER TABLE IF EXISTS mail_accounts ADD COLUMN IF NOT EXISTS caldav_sync_enabled BOOLEAN DEFAULT false;
      ALTER TABLE IF EXISTS mail_accounts ADD COLUMN IF NOT EXISTS caldav_last_sync TIMESTAMP;

      -- CardDAV sync settings on mail accounts
      ALTER TABLE IF EXISTS mail_accounts ADD COLUMN IF NOT EXISTS carddav_url TEXT;
      ALTER TABLE IF EXISTS mail_accounts ADD COLUMN IF NOT EXISTS carddav_username VARCHAR(255);
      ALTER TABLE IF EXISTS mail_accounts ADD COLUMN IF NOT EXISTS carddav_sync_enabled BOOLEAN DEFAULT false;
      ALTER TABLE IF EXISTS mail_accounts ADD COLUMN IF NOT EXISTS carddav_last_sync TIMESTAMP;

      -- Link calendars back to the mail account they were synced from
      ALTER TABLE IF EXISTS calendars ADD COLUMN IF NOT EXISTS mail_account_id UUID REFERENCES mail_accounts(id) ON DELETE CASCADE;
      CREATE INDEX IF NOT EXISTS idx_calendars_mail_account ON calendars(mail_account_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_calendars_caldav_unique
        ON calendars(mail_account_id, external_id)
        WHERE mail_account_id IS NOT NULL AND external_id IS NOT NULL;

      -- Unique index required by CalDAV sync ON CONFLICT on calendar_events
      CREATE UNIQUE INDEX IF NOT EXISTS idx_events_caldav_unique
        ON calendar_events(calendar_id, ical_uid)
        WHERE external_id IS NOT NULL;

      -- Rich RFC 5545 event fields (RoundCube-equivalent)
      ALTER TABLE IF EXISTS calendar_events ADD COLUMN IF NOT EXISTS priority INT;
      ALTER TABLE IF EXISTS calendar_events ADD COLUMN IF NOT EXISTS url TEXT;
      ALTER TABLE IF EXISTS calendar_events ADD COLUMN IF NOT EXISTS categories JSONB DEFAULT '[]'::jsonb;
      ALTER TABLE IF EXISTS calendar_events ADD COLUMN IF NOT EXISTS transparency VARCHAR(20);
      ALTER TABLE IF EXISTS calendar_events ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;
      ALTER TABLE IF EXISTS calendar_events ADD COLUMN IF NOT EXISTS rdates JSONB DEFAULT '[]'::jsonb;

      -- Link contacts back to the mail account + CardDAV item identifiers (for push-back)
      ALTER TABLE IF EXISTS contacts ADD COLUMN IF NOT EXISTS mail_account_id UUID REFERENCES mail_accounts(id) ON DELETE SET NULL;
      ALTER TABLE IF EXISTS contacts ADD COLUMN IF NOT EXISTS carddav_url TEXT;
      ALTER TABLE IF EXISTS contacts ADD COLUMN IF NOT EXISTS carddav_href TEXT;
      ALTER TABLE IF EXISTS contacts ADD COLUMN IF NOT EXISTS carddav_etag TEXT;
      CREATE INDEX IF NOT EXISTS idx_contacts_mail_account ON contacts(mail_account_id);

      -- OAuth2 (Microsoft 365, Google Workspace, …) on mail accounts. When any
      -- of these columns are populated, MailService uses XOAUTH2 instead of
      -- plain IMAP/SMTP LOGIN. password_encrypted is no longer required in
      -- that case (Microsoft 365 refuses Basic Auth by default since 2022).
      ALTER TABLE IF EXISTS mail_accounts ADD COLUMN IF NOT EXISTS oauth_provider VARCHAR(32);
      ALTER TABLE IF EXISTS mail_accounts ADD COLUMN IF NOT EXISTS oauth_refresh_token_encrypted TEXT;
      ALTER TABLE IF EXISTS mail_accounts ADD COLUMN IF NOT EXISTS oauth_access_token_encrypted TEXT;
      ALTER TABLE IF EXISTS mail_accounts ADD COLUMN IF NOT EXISTS oauth_token_expires_at TIMESTAMPTZ;
      ALTER TABLE IF EXISTS mail_accounts ADD COLUMN IF NOT EXISTS oauth_scope TEXT;
      ALTER TABLE IF EXISTS mail_accounts ALTER COLUMN password_encrypted DROP NOT NULL;

      -- Shared calendar access (internal sharing between app users)
      CREATE TABLE IF NOT EXISTS shared_calendar_access (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        calendar_id UUID REFERENCES calendars(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        permission VARCHAR(20) DEFAULT 'read',
        nextcloud_share_id VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(calendar_id, user_id)
      );
      ALTER TABLE IF EXISTS shared_calendar_access ADD COLUMN IF NOT EXISTS nextcloud_share_id VARCHAR(255);
      ALTER TABLE IF EXISTS shared_calendar_access ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();

      -- External calendar shares (public links, guest invitees by email)
      CREATE TABLE IF NOT EXISTS external_calendar_shares (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        calendar_id UUID REFERENCES calendars(id) ON DELETE CASCADE,
        share_type VARCHAR(20) NOT NULL, -- 'public_link' | 'email'
        recipient_email VARCHAR(255),
        public_token VARCHAR(128),
        public_url TEXT,
        permission VARCHAR(20) DEFAULT 'read',
        nextcloud_share_id VARCHAR(255),
        expires_at TIMESTAMP,
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_ext_cal_shares_calendar ON external_calendar_shares(calendar_id);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_ext_cal_shares_public_link
        ON external_calendar_shares(calendar_id) WHERE share_type = 'public_link';

      -- NextCloud per-user provisioning (mapping app user <-> NC account)
      CREATE TABLE IF NOT EXISTS nextcloud_users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        nc_username VARCHAR(255) NOT NULL,
        nc_password_encrypted TEXT NOT NULL, -- app-password or initial password (encrypted)
        nc_display_name VARCHAR(255),
        nc_email VARCHAR(255),
        provisioned_at TIMESTAMP DEFAULT NOW(),
        last_sync_at TIMESTAMP,
        last_sync_error TEXT,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_nc_users_username ON nextcloud_users(nc_username);

      -- NextCloud-managed calendar metadata
      ALTER TABLE IF EXISTS calendars ADD COLUMN IF NOT EXISTS nc_managed BOOLEAN DEFAULT false;
      ALTER TABLE IF EXISTS calendars ADD COLUMN IF NOT EXISTS nc_principal_url TEXT;
      ALTER TABLE IF EXISTS calendars ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMP;

      -- NextCloud-managed contact metadata
      ALTER TABLE IF EXISTS contacts ADD COLUMN IF NOT EXISTS nc_managed BOOLEAN DEFAULT false;
      ALTER TABLE IF EXISTS contacts ADD COLUMN IF NOT EXISTS nc_addressbook_url TEXT;
      ALTER TABLE IF EXISTS contacts ADD COLUMN IF NOT EXISTS nc_etag VARCHAR(255);
      ALTER TABLE IF EXISTS contacts ADD COLUMN IF NOT EXISTS nc_uri VARCHAR(512);

      -- Same for calendar events (for CalDAV sync consistency)
      ALTER TABLE IF EXISTS calendar_events ADD COLUMN IF NOT EXISTS nc_etag VARCHAR(255);
      ALTER TABLE IF EXISTS calendar_events ADD COLUMN IF NOT EXISTS nc_uri VARCHAR(512);

      -- Reminder push delivery tracking (avoids re-sending the same VALARM)
      ALTER TABLE IF EXISTS calendar_events ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;
      CREATE INDEX IF NOT EXISTS idx_events_reminder_pending
        ON calendar_events(start_date)
        WHERE reminder_minutes IS NOT NULL AND reminder_sent_at IS NULL;

      -- Reset reminder_sent_at when the user reschedules the event or
      -- changes the VALARM offset, so the rescheduled reminder fires again.
      CREATE OR REPLACE FUNCTION reset_reminder_sent_at() RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.start_date IS DISTINCT FROM OLD.start_date
           OR NEW.reminder_minutes IS DISTINCT FROM OLD.reminder_minutes THEN
          NEW.reminder_sent_at := NULL;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_reset_reminder_sent_at ON calendar_events;
      CREATE TRIGGER trg_reset_reminder_sent_at
        BEFORE UPDATE ON calendar_events
        FOR EACH ROW
        EXECUTE FUNCTION reset_reminder_sent_at();

      -- Unique partial indexes required by NextCloud sync ON CONFLICT clauses.
      -- Predicates MUST match exactly the WHERE clause used in ON CONFLICT ... WHERE ...
      -- Drop any previous versions of these indexes that may have been created with a
      -- stricter predicate (e.g. AND external_id IS NOT NULL), which would break
      -- ON CONFLICT inference.
      DROP INDEX IF EXISTS idx_contacts_nc_email_unique;
      DROP INDEX IF EXISTS idx_contacts_nc_external_unique;
      DROP INDEX IF EXISTS idx_calendars_nc_external_unique;
      CREATE UNIQUE INDEX idx_contacts_nc_email_unique
        ON contacts(user_id, email)
        WHERE source = 'nextcloud';
      CREATE UNIQUE INDEX idx_contacts_nc_external_unique
        ON contacts(user_id, external_id)
        WHERE source = 'nextcloud';
      CREATE UNIQUE INDEX idx_calendars_nc_external_unique
        ON calendars(user_id, external_id)
        WHERE source = 'nextcloud';

      -- Plugins
      CREATE TABLE IF NOT EXISTS plugins (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL UNIQUE,
        display_name VARCHAR(255),
        description TEXT,
        version VARCHAR(50),
        author VARCHAR(255),
        icon VARCHAR(255),
        entry_point VARCHAR(255),
        config JSONB DEFAULT '{}',
        is_active BOOLEAN DEFAULT false,
        is_system BOOLEAN DEFAULT false,
        permissions JSONB DEFAULT '[]',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      -- Plugin assignments (to users or groups)
      CREATE TABLE IF NOT EXISTS plugin_assignments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        plugin_id UUID REFERENCES plugins(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
        config JSONB DEFAULT '{}',
        CHECK (
          (user_id IS NOT NULL AND group_id IS NULL) OR
          (user_id IS NULL AND group_id IS NOT NULL)
        )
      );

      -- Admin settings
      CREATE TABLE IF NOT EXISTS admin_settings (
        key VARCHAR(255) PRIMARY KEY,
        value JSONB NOT NULL,
        description TEXT,
        updated_at TIMESTAMP DEFAULT NOW()
      );

      -- Admin audit logs
      CREATE TABLE IF NOT EXISTS admin_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        action VARCHAR(100) NOT NULL,
        category VARCHAR(50) NOT NULL DEFAULT 'system',
        target_type VARCHAR(50),
        target_id VARCHAR(255),
        details JSONB DEFAULT '{}',
        ip_address VARCHAR(45),
        user_agent TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_admin_logs_date ON admin_logs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_admin_logs_category ON admin_logs(category);
      CREATE INDEX IF NOT EXISTS idx_admin_logs_user ON admin_logs(user_id);

      -- O2Switch cPanel accounts
      CREATE TABLE IF NOT EXISTS o2switch_accounts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        hostname VARCHAR(255) NOT NULL,
        username VARCHAR(255) NOT NULL,
        api_token_encrypted TEXT NOT NULL,
        label VARCHAR(255),
        is_active BOOLEAN DEFAULT true,
        last_sync TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      -- O2Switch email <-> local mail_account link
      CREATE TABLE IF NOT EXISTS o2switch_email_links (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        o2switch_account_id UUID REFERENCES o2switch_accounts(id) ON DELETE CASCADE,
        remote_email VARCHAR(255) NOT NULL,
        mail_account_id UUID REFERENCES mail_accounts(id) ON DELETE SET NULL,
        auto_synced BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(o2switch_account_id, remote_email)
      );

      -- Insert default admin settings
      INSERT INTO admin_settings (key, value, description) VALUES
        ('nextcloud_enabled', 'false', 'Enable NextCloud integration'),
        ('nextcloud_url', '""', 'NextCloud server URL'),
        ('nextcloud_admin_username', '""', 'NextCloud admin username (for provisioning)'),
        ('nextcloud_admin_password_encrypted', '""', 'Encrypted NextCloud admin password / app-token'),
        ('nextcloud_auto_provision', 'false', 'Automatically provision NC account on user creation'),
        ('nextcloud_auto_create_calendars', 'true', 'Create calendars on NextCloud when created in the app'),
        ('nextcloud_sync_interval', '15', 'Sync interval in minutes'),
        ('max_attachment_size', '25', 'Max attachment size in MB'),
        ('attachment_visibility_min_kb', '10', 'Hide attachments smaller than this size in KB'),
        ('default_language', '"fr"', 'Default language'),
        ('allow_registration', 'false', 'Allow self-registration'),
        ('plugins_enabled', 'true', 'Enable plugin system')
      ON CONFLICT (key) DO NOTHING;

      -- Web Push subscriptions (native notifications)
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        endpoint TEXT NOT NULL UNIQUE,
        p256dh TEXT NOT NULL,
        auth_key TEXT NOT NULL,
        user_agent TEXT,
        platform VARCHAR(50),
        enabled BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        last_used_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);

      -- Device sessions (refresh token rotation for "stay signed in" per device)
      CREATE TABLE IF NOT EXISTS device_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        refresh_token_hash TEXT NOT NULL UNIQUE,
        device_name TEXT,
        user_agent TEXT,
        ip_last_seen VARCHAR(45),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        last_used_at TIMESTAMPTZ DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ,
        replaced_by UUID REFERENCES device_sessions(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_device_sessions_user ON device_sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_device_sessions_hash ON device_sessions(refresh_token_hash);
      CREATE INDEX IF NOT EXISTS idx_device_sessions_expires ON device_sessions(expires_at);

      -- WebAuthn credentials (passkeys / biometric)
      CREATE TABLE IF NOT EXISTS webauthn_credentials (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        credential_id TEXT NOT NULL UNIQUE,
        public_key BYTEA NOT NULL,
        counter BIGINT NOT NULL DEFAULT 0,
        transports TEXT,
        device_type VARCHAR(32),
        backed_up BOOLEAN DEFAULT false,
        nickname TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        last_used_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_webauthn_user ON webauthn_credentials(user_id);

      -- Transient WebAuthn ceremony challenges
      CREATE TABLE IF NOT EXISTS webauthn_challenges (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        challenge TEXT NOT NULL,
        kind VARCHAR(20) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_expires ON webauthn_challenges(expires_at);

      -- Auto-responder (vacation responder) settings, one row per mail account.
      -- A background job in the new-mail poller consults this table when it
      -- detects new incoming messages, and sends an automatic reply when the
      -- responder is enabled and the current time falls within the schedule.
      CREATE TABLE IF NOT EXISTS auto_responders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id UUID NOT NULL UNIQUE REFERENCES mail_accounts(id) ON DELETE CASCADE,
        enabled BOOLEAN NOT NULL DEFAULT false,
        subject TEXT NOT NULL DEFAULT 'Réponse automatique',
        body_html TEXT NOT NULL DEFAULT '',
        body_text TEXT NOT NULL DEFAULT '',
        -- When false, the responder is active as soon as enabled=true (no schedule).
        scheduled BOOLEAN NOT NULL DEFAULT false,
        start_at TIMESTAMPTZ,
        end_at TIMESTAMPTZ,
        only_contacts BOOLEAN NOT NULL DEFAULT false,
        -- Per-recipient cooldown tracking (avoid spamming the same sender).
        -- Shape: { "<email>": "<ISO timestamp of last reply>" }
        replied_log JSONB NOT NULL DEFAULT '{}'::jsonb,
        -- Automatic forwarding addresses applied while the responder is active.
        -- Shape: ["alice@example.com", "bob@example.com"]
        forward_to JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_auto_responders_account ON auto_responders(account_id);
      ALTER TABLE IF EXISTS auto_responders ADD COLUMN IF NOT EXISTS forward_to JSONB NOT NULL DEFAULT '[]'::jsonb;

      -- Mail templates — reusable subject + body presets that users can insert
      -- into a compose window from the ribbon "Insérer > Modèles" picker.
      -- A template is owned by a user (owner_user_id) or marked global by an
      -- admin (is_global=true, owner_user_id=NULL), and can additionally be
      -- shared with specific users / groups via mail_template_shares.
      CREATE TABLE IF NOT EXISTS mail_templates (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        subject VARCHAR(998) NOT NULL DEFAULT '',
        body_html TEXT NOT NULL DEFAULT '',
        is_global BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        CHECK (
          (is_global = true AND owner_user_id IS NULL)
          OR (is_global = false AND owner_user_id IS NOT NULL)
        )
      );
      CREATE INDEX IF NOT EXISTS idx_mail_templates_owner ON mail_templates(owner_user_id);
      CREATE INDEX IF NOT EXISTS idx_mail_templates_global ON mail_templates(is_global) WHERE is_global = true;

      CREATE TABLE IF NOT EXISTS mail_template_shares (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        template_id UUID NOT NULL REFERENCES mail_templates(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        CHECK (
          (user_id IS NOT NULL AND group_id IS NULL) OR
          (user_id IS NULL AND group_id IS NOT NULL)
        )
      );
      CREATE INDEX IF NOT EXISTS idx_mail_template_shares_tpl ON mail_template_shares(template_id);
      CREATE INDEX IF NOT EXISTS idx_mail_template_shares_user ON mail_template_shares(user_id);
      CREATE INDEX IF NOT EXISTS idx_mail_template_shares_group ON mail_template_shares(group_id);

      -- Mail rules — Outlook-like rules engine. Each rule belongs to a user
      -- and is applied to incoming mail by the new-mail poller in declared
      -- order (lowest "position" first). Conditions and actions are stored
      -- as JSONB arrays of typed nodes, see server/src/services/mailRules.ts
      -- for the supported types.
      CREATE TABLE IF NOT EXISTS mail_rules (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        account_id UUID REFERENCES mail_accounts(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT true,
        position INTEGER NOT NULL DEFAULT 0,
        match_type VARCHAR(8) NOT NULL DEFAULT 'all',
        stop_processing BOOLEAN NOT NULL DEFAULT true,
        conditions JSONB NOT NULL DEFAULT '[]'::jsonb,
        exceptions JSONB NOT NULL DEFAULT '[]'::jsonb,
        actions JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_mail_rules_user ON mail_rules(user_id, position);
      CREATE INDEX IF NOT EXISTS idx_mail_rules_account ON mail_rules(account_id);

      CREATE TABLE IF NOT EXISTS mail_rule_shares (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        rule_id UUID NOT NULL REFERENCES mail_rules(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        CHECK (
          (user_id IS NOT NULL AND group_id IS NULL) OR
          (user_id IS NULL AND group_id IS NOT NULL)
        )
      );
      CREATE INDEX IF NOT EXISTS idx_mail_rule_shares_rule ON mail_rule_shares(rule_id);
      CREATE INDEX IF NOT EXISTS idx_mail_rule_shares_user ON mail_rule_shares(user_id);
      CREATE INDEX IF NOT EXISTS idx_mail_rule_shares_group ON mail_rule_shares(group_id);
    `);

    await client.query(`
      ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS password_resets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token VARCHAR(128) NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets(token);
    `);

    await client.query(`
      ALTER TABLE distribution_lists ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;
      ALTER TABLE distribution_lists ADD COLUMN IF NOT EXISTS shared_with JSONB DEFAULT '[]';
      ALTER TABLE distribution_lists ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE distribution_lists ADD COLUMN IF NOT EXISTS avatar_data TEXT;
    `);

    await client.query(`
      -- System email templates (welcome, password reset, alerts, etc.)
      CREATE TABLE IF NOT EXISTS system_email_templates (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        slug VARCHAR(100) NOT NULL UNIQUE,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        subject TEXT NOT NULL DEFAULT '',
        body_html TEXT NOT NULL DEFAULT '',
        body_text TEXT NOT NULL DEFAULT '',
        variables JSONB NOT NULL DEFAULT '[]',
        enabled BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Log alert rules: send an email when matching log events are recorded
      CREATE TABLE IF NOT EXISTS log_alert_rules (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT true,
        categories TEXT[] DEFAULT '{}',
        actions TEXT[] DEFAULT '{}',
        recipient_email VARCHAR(255) NOT NULL,
        subject_template TEXT NOT NULL DEFAULT 'Alerte log : {{action}}',
        throttle_minutes INTEGER NOT NULL DEFAULT 60,
        last_triggered_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_log_alert_rules_enabled ON log_alert_rules(enabled) WHERE enabled = true;
    `);

    await client.query(`
      INSERT INTO admin_settings (key, value, description) VALUES
        ('smtp_host', '""', 'Serveur SMTP pour les emails système'),
        ('smtp_port', '587', 'Port SMTP'),
        ('smtp_secure', '"starttls"', 'Chiffrement SMTP : starttls, ssl, none'),
        ('smtp_username', '""', 'Identifiant SMTP'),
        ('smtp_password_encrypted', '""', 'Mot de passe SMTP chiffré'),
        ('smtp_from_name', '"Mail Client"', 'Nom expéditeur des emails système'),
        ('smtp_from_email', '""', 'Email expéditeur des emails système')
      ON CONFLICT (key) DO NOTHING;
    `);

    await client.query(`
      INSERT INTO system_email_templates (slug, name, description, subject, body_html, body_text, variables) VALUES
        (
          'welcome',
          'Bienvenue',
          'Envoyé lors de la création d''un compte utilisateur',
          'Bienvenue {{user_name}} !',
          '<div style="font-family:sans-serif;max-width:600px;margin:0 auto"><h2 style="color:#1a73e8">Bienvenue {{user_name}} !</h2><p>Votre compte a été créé avec succès.</p><p>Votre adresse email&nbsp;: <strong>{{user_email}}</strong></p>{{#if temp_password}}<p>Mot de passe temporaire&nbsp;: <code>{{temp_password}}</code></p>{{/if}}<p><a href="{{app_url}}" style="background:#1a73e8;color:#fff;padding:10px 20px;border-radius:4px;text-decoration:none">Accéder à la messagerie</a></p></div>',
          'Bienvenue {{user_name}} !\n\nVotre compte a été créé avec succès.\nEmail : {{user_email}}\n{{#if temp_password}}Mot de passe temporaire : {{temp_password}}\n{{/if}}\nConnectez-vous sur : {{app_url}}',
          '[{"key":"user_name","label":"Nom utilisateur","example":"Jean Dupont"},{"key":"user_email","label":"Email utilisateur","example":"jean@example.com"},{"key":"temp_password","label":"Mot de passe temporaire","example":"Abc123!"},{"key":"app_url","label":"URL application","example":"https://mail.example.com"}]'
        ),
        (
          'password_reset',
          'Réinitialisation du mot de passe',
          'Envoyé lorsqu''un utilisateur demande une réinitialisation',
          'Réinitialisation de votre mot de passe',
          '<div style="font-family:sans-serif;max-width:600px;margin:0 auto"><h2 style="color:#1a73e8">Réinitialisation du mot de passe</h2><p>Bonjour {{user_name}},</p><p>Cliquez sur le bouton ci-dessous pour réinitialiser votre mot de passe. Ce lien est valable <strong>{{expiry_hours}} heure(s)</strong>.</p><p><a href="{{reset_link}}" style="background:#1a73e8;color:#fff;padding:10px 20px;border-radius:4px;text-decoration:none">Réinitialiser mon mot de passe</a></p><p style="color:#666;font-size:12px">Si vous n''avez pas fait cette demande, ignorez cet email.</p></div>',
          'Bonjour {{user_name}},\n\nCliquez sur le lien ci-dessous pour réinitialiser votre mot de passe (valable {{expiry_hours}} h) :\n{{reset_link}}\n\nSi vous n''avez pas fait cette demande, ignorez cet email.',
          '[{"key":"user_name","label":"Nom utilisateur","example":"Jean Dupont"},{"key":"user_email","label":"Email utilisateur","example":"jean@example.com"},{"key":"reset_link","label":"Lien de réinitialisation","example":"https://mail.example.com/reset?token=abc"},{"key":"expiry_hours","label":"Durée validité (h)","example":"24"}]'
        ),
        (
          'log_alert',
          'Alerte de log',
          'Envoyé lors du déclenchement d''une règle d''alerte',
          'Alerte : {{action}} ({{category}})',
          '<div style="font-family:sans-serif;max-width:600px;margin:0 auto"><h2 style="color:#e53935">Alerte de sécurité / activité</h2><table style="width:100%;border-collapse:collapse"><tr><td style="padding:6px;font-weight:bold">Date</td><td style="padding:6px">{{date}}</td></tr><tr style="background:#f5f5f5"><td style="padding:6px;font-weight:bold">Catégorie</td><td style="padding:6px">{{category}}</td></tr><tr><td style="padding:6px;font-weight:bold">Action</td><td style="padding:6px">{{action}}</td></tr><tr style="background:#f5f5f5"><td style="padding:6px;font-weight:bold">Utilisateur</td><td style="padding:6px">{{user}}</td></tr><tr><td style="padding:6px;font-weight:bold">IP</td><td style="padding:6px">{{ip}}</td></tr><tr style="background:#f5f5f5"><td style="padding:6px;font-weight:bold">Détails</td><td style="padding:6px">{{details}}</td></tr></table></div>',
          'Alerte log\n\nDate : {{date}}\nCatégorie : {{category}}\nAction : {{action}}\nUtilisateur : {{user}}\nIP : {{ip}}\nDétails : {{details}}',
          '[{"key":"date","label":"Date","example":"2026-01-15 08:30"},{"key":"category","label":"Catégorie","example":"auth"},{"key":"action","label":"Action","example":"user.login_failed"},{"key":"user","label":"Utilisateur","example":"jean@example.com"},{"key":"ip","label":"Adresse IP","example":"192.168.1.1"},{"key":"details","label":"Détails","example":"Tentative #3"}]'
        )
      ON CONFLICT (slug) DO NOTHING;
    `);

    // One-shot data fix: keep `is_admin` aligned with `role`. Older builds
    // of the admin UI submitted `role='admin'` without setting `is_admin`,
    // which left users with admin role but `is_admin=false`, hiding the
    // admin menu in the client. Re-syncing here is idempotent.
    const syncRes = await client.query(
      `UPDATE users SET is_admin = true WHERE role = 'admin' AND is_admin = false`
    );
    if (syncRes.rowCount && syncRes.rowCount > 0) {
      logger.info(`Synced is_admin=true for ${syncRes.rowCount} user(s) with role='admin'`);
    }

    logger.info('Database schema created/updated successfully');
  } finally {
    client.release();
  }
}

export { pool };
