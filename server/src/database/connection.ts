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

      -- Shared calendar access
      CREATE TABLE IF NOT EXISTS shared_calendar_access (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        calendar_id UUID REFERENCES calendars(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        permission VARCHAR(20) DEFAULT 'read',
        UNIQUE(calendar_id, user_id)
      );

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
    `);

    logger.info('Database schema created/updated successfully');
  } finally {
    client.release();
  }
}

export { pool };
