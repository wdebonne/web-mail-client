import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer';
import { simpleParser } from 'mailparser';
import { logger } from '../utils/logger';

/**
 * Pick the first usable address from an IMAP envelope address array.
 * Returns null if every entry is empty or has neither an address nor a name —
 * this is what the IMAP envelope returns for malformed/group-syntax FROM
 * headers (e.g. "Undisclosed recipients:;") and is the root cause of the
 * "Inconnu" rows the user reports in the message list.
 */
function pickFirstAddress(list?: any[] | null): { address: string; name: string } | null {
  if (!list || !Array.isArray(list)) return null;
  for (const a of list) {
    if (!a) continue;
    const address = (a.address || '').trim();
    const name = (a.name || '').trim();
    if (address || name) return { address, name };
  }
  return null;
}

/**
 * Last-resort sender extraction from raw RFC-2822 headers when the IMAP
 * envelope yielded nothing (some servers return a degraded envelope when the
 * From header has unusual encoding). We try From, then Sender, then Reply-To,
 * then Return-Path, and unfold continuation lines as required by RFC 5322.
 */
function parseAddressFromHeaders(headerBlock: string): { address: string; name: string } | null {
  if (!headerBlock) return null;
  // Unfold: a header value continues on the next line if it starts with WSP.
  const unfolded = headerBlock.replace(/\r?\n[ \t]+/g, ' ');
  const lines = unfolded.split(/\r?\n/);
  const grab = (name: string): string | null => {
    const re = new RegExp(`^${name}\\s*:\\s*(.*)$`, 'i');
    for (const line of lines) {
      const m = line.match(re);
      if (m && m[1]) return m[1].trim();
    }
    return null;
  };
  const candidates = [grab('From'), grab('Sender'), grab('Reply-To'), grab('Return-Path')];
  for (const value of candidates) {
    if (!value) continue;
    // Format: "Display Name" <addr@host>  |  Display Name <addr@host>  |  addr@host
    const angle = value.match(/^(.*?)<([^>]+)>\s*$/);
    if (angle) {
      let name = angle[1].trim().replace(/^"|"$/g, '').trim();
      // RFC 2047 encoded-word decoding is best-effort: leave as-is if present.
      const address = angle[2].trim();
      if (address || name) return { address, name };
    }
    const bare = value.replace(/[<>]/g, '').trim();
    if (bare && /@/.test(bare)) return { address: bare, name: '' };
  }
  return null;
}

interface MailAccount {
  email: string;
  name: string;
  imap_host: string;
  imap_port: number;
  imap_secure: boolean;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  username: string;
  password: string;
  // OAuth2 access token (XOAUTH2). When provided, takes precedence over `password`
  // and the client authenticates via XOAUTH2 (required by Microsoft 365 since
  // Basic Auth was disabled in 2022, and by Google once OAuth is configured).
  access_token?: string;
}

interface SendMailOptions {
  from: { email: string; name: string };
  sender?: { email: string; name: string };
  replyTo?: { email: string; name?: string };
  to: { email: string; name?: string }[];
  cc?: { email: string; name?: string }[];
  bcc?: { email: string; name?: string }[];
  subject: string;
  html: string;
  text?: string;
  attachments?: any[];
  inReplyTo?: string;
  references?: string;
  /** Extra RFC 822 headers (e.g. Auto-Submitted, X-Auto-Response-Suppress, …). */
  headers?: Record<string, string>;
  /** When true, do NOT append the sent message to the IMAP Sent folder.
   *  Used by the auto-responder so vacation replies don't pollute the user's
   *  Sent box (and so they don't show up as "replied by user"). */
  skipSentFolder?: boolean;
}

export class MailService {
  private account: MailAccount;

  constructor(account: MailAccount) {
    this.account = account;
  }

  private createImapClient(): ImapFlow {
    const auth: any = this.account.access_token
      ? { user: this.account.username || this.account.email, accessToken: this.account.access_token }
      : { user: this.account.username, pass: this.account.password };
    return new ImapFlow({
      host: this.account.imap_host,
      port: this.account.imap_port,
      secure: this.account.imap_secure,
      auth,
      logger: false,
    });
  }

  private createSmtpTransport() {
    const auth: any = this.account.access_token
      ? {
          type: 'OAuth2',
          user: this.account.username || this.account.email,
          accessToken: this.account.access_token,
        }
      : { user: this.account.username, pass: this.account.password };

    // Reconcile the (port, secure) pair to avoid the classic SSL handshake
    // error "wrong version number" produced by nodemailer when the wrong
    // mode is forced on a given port:
    //   - port 465 → implicit TLS (secure=true), MUST NOT use STARTTLS.
    //   - port 587 / 25 / 2525 → STARTTLS (secure=false + requireTLS=true).
    // Anything else falls back to the user-provided `smtp_secure` flag.
    const port = Number(this.account.smtp_port) || 587;
    const userSecure = this.account.smtp_secure;
    let secure: boolean;
    let requireTLS: boolean;
    if (port === 465) {
      secure = true;
      requireTLS = false;
    } else if (port === 587 || port === 25 || port === 2525) {
      secure = false;
      requireTLS = true;
    } else {
      secure = userSecure;
      requireTLS = !userSecure;
    }

    return nodemailer.createTransport({
      host: this.account.smtp_host,
      port,
      secure,
      requireTLS,
      auth,
    });
  }

  /**
   * Renvoie un instantané léger d'un dossier IMAP via la commande STATUS,
   * sans avoir à ouvrir/parser les messages. Utilisé pour calculer la
   * pastille (badge) de l'application (Web App Badging API).
   */
  async getMailboxStatus(folder: string): Promise<{ messages: number; unseen: number; recent: number }> {
    const client = this.createImapClient();
    try {
      await client.connect();
      const s: any = await client.status(folder, {
        messages: true,
        recent: true,
        unseen: true,
      });
      return {
        messages: Number(s?.messages) || 0,
        unseen: Number(s?.unseen) || 0,
        recent: Number(s?.recent) || 0,
      };
    } finally {
      await client.logout();
    }
  }

  async getFolders() {
    const client = this.createImapClient();
    try {
      await client.connect();
      const folders = await client.list();
      
      return folders.map(folder => ({
        path: folder.path,
        name: folder.name,
        delimiter: folder.delimiter,
        specialUse: folder.specialUse,
        flags: folder.flags ? Array.from(folder.flags) : [],
        listed: folder.listed,
        subscribed: folder.subscribed,
      }));
    } finally {
      await client.logout();
    }
  }

  /**
   * Renvoie le STATUS IMAP (messages / unseen / recent) pour chaque dossier
   * sélectionnable du compte, en réutilisant **une seule connexion IMAP**.
   * Utilisé pour afficher les compteurs de mails non lus dans le volet
   * « Dossiers » et les vues unifiées (Favoris).
   */
  async getFoldersStatus(): Promise<Record<string, { messages: number; unseen: number; recent: number }>> {
    const client = this.createImapClient();
    const out: Record<string, { messages: number; unseen: number; recent: number }> = {};
    try {
      await client.connect();
      const folders = await client.list();
      for (const f of folders) {
        // Skip non-selectable mailboxes (containers like "[Gmail]") — STATUS
        // would fail with NO on them.
        const flags = f.flags ? Array.from(f.flags) : [];
        if (flags.includes('\\Noselect') || flags.includes('\\NonExistent')) continue;
        try {
          const s: any = await client.status(f.path, {
            messages: true,
            recent: true,
            unseen: true,
          });
          out[f.path] = {
            messages: Number(s?.messages) || 0,
            unseen: Number(s?.unseen) || 0,
            recent: Number(s?.recent) || 0,
          };
        } catch {
          // Per-folder failure shouldn't break the whole listing.
        }
      }
      return out;
    } finally {
      await client.logout();
    }
  }

  async getMessages(folder: string, page: number = 1, limit: number = 50) {
    const client = this.createImapClient();
    try {
      await client.connect();
      const lock = await client.getMailboxLock(folder);
      
      try {
        const mailbox = client.mailbox;
        const total = mailbox ? (mailbox as any).exists || 0 : 0;
        const start = Math.max(1, total - (page * limit) + 1);
        const end = Math.max(1, total - ((page - 1) * limit));

        if (total === 0) return { messages: [], total: 0, page, limit };

        const messages: any[] = [];
        const range = `${start}:${end}`;

        // Track UIDs whose envelope did not yield a usable sender — we'll fetch
        // the raw From/Sender/Reply-To headers in a second pass to fill them in.
        const missingFromUids: number[] = [];

        for await (const msg of client.fetch(range, {
          uid: true,
          flags: true,
          envelope: true,
          bodyStructure: true,
          size: true,
        })) {
          const envelope = msg.envelope!;
          const from = pickFirstAddress(envelope.from)
            || pickFirstAddress((envelope as any).sender)
            || pickFirstAddress((envelope as any).replyTo);
          if (!from) missingFromUids.push(msg.uid);
          messages.push({
            uid: msg.uid,
            messageId: envelope.messageId,
            subject: envelope.subject,
            from,
            to: envelope.to?.map((addr: any) => ({
              address: addr.address,
              name: addr.name,
            })),
            cc: envelope.cc?.map((addr: any) => ({
              address: addr.address,
              name: addr.name,
            })),
            date: envelope.date,
            flags: {
              seen: msg.flags!.has('\\Seen'),
              flagged: msg.flags!.has('\\Flagged'),
              answered: msg.flags!.has('\\Answered'),
              draft: msg.flags!.has('\\Draft'),
            },
            hasAttachments: this.hasAttachments(msg.bodyStructure),
            largestAttachmentSize: this.getLargestAttachmentSize(msg.bodyStructure),
            size: msg.size,
            snippet: '',
          });
        }

        // Second pass: for messages whose IMAP envelope had no usable address
        // (malformed RFC-2822 group syntax, missing FROM, etc.), parse the raw
        // From/Sender/Reply-To headers so the UI no longer shows "Inconnu".
        if (missingFromUids.length > 0) {
          try {
            const uidSet = missingFromUids.join(',');
            for await (const hMsg of client.fetch(uidSet, {
              uid: true,
              headers: ['from', 'sender', 'reply-to', 'return-path'],
            } as any, { uid: true })) {
              const raw = (hMsg as any).headers;
              if (!raw) continue;
              const headerText = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
              const addr = parseAddressFromHeaders(headerText);
              if (!addr) continue;
              const target = messages.find((m) => m.uid === hMsg.uid);
              if (target && !target.from) target.from = addr;
            }
          } catch (err) {
            logger.warn({ err }, '[mail] header fallback fetch failed');
          }
        }

        return {
          messages: messages.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
          total,
          page,
          limit,
        };
      } finally {
        lock.release();
      }
    } finally {
      await client.logout();
    }
  }

  async getMessage(folder: string, uid: number) {
    const client = this.createImapClient();
    try {
      await client.connect();
      const lock = await client.getMailboxLock(folder);
      
      try {
        const message = await client.fetchOne(`${uid}`, {
          uid: true,
          flags: true,
          envelope: true,
          source: true,
          bodyStructure: true,
          size: true,
        }, { uid: true }) as any;

        if (!message?.source) {
          throw new Error('Message non trouvé');
        }

        const parsed = await simpleParser(message.source);
        const envelope = message.envelope;

        return {
          uid: message.uid,
          messageId: envelope.messageId,
          subject: parsed.subject,
          from: parsed.from?.value?.[0] ? {
            address: parsed.from.value[0].address,
            name: parsed.from.value[0].name,
          } : (pickFirstAddress(envelope.from)
            || pickFirstAddress((envelope as any).sender)
            || pickFirstAddress((envelope as any).replyTo)
            || (parsed.headers ? parseAddressFromHeaders(
                ['from','sender','reply-to','return-path']
                  .map((h) => {
                    const v = parsed.headers.get(h);
                    return v ? `${h}: ${typeof v === 'string' ? v : (Array.isArray((v as any).value) ? (v as any).text || '' : ((v as any).text || ''))}` : '';
                  })
                  .filter(Boolean)
                  .join('\r\n')
              ) : null)),
          to: parsed.to ? (Array.isArray(parsed.to) ? parsed.to : [parsed.to]).flatMap((t: any) => t.value.map((v: any) => ({
            address: v.address,
            name: v.name,
          }))) : [],
          cc: parsed.cc ? (Array.isArray(parsed.cc) ? parsed.cc : [parsed.cc]).flatMap((t: any) => t.value.map((v: any) => ({
            address: v.address,
            name: v.name,
          }))) : [],
          date: parsed.date,
          bodyHtml: parsed.html || '',
          bodyText: parsed.text || '',
          flags: {
            seen: message.flags.has('\\Seen'),
            flagged: message.flags.has('\\Flagged'),
            answered: message.flags.has('\\Answered'),
            draft: message.flags.has('\\Draft'),
          },
          attachments: parsed.attachments?.map((att: any) => ({
            filename: att.filename,
            contentType: att.contentType,
            size: att.size,
            contentId: att.contentId,
            content: att.content.toString('base64'),
          })) || [],
          headers: {
            inReplyTo: Array.isArray(parsed.inReplyTo)
              ? parsed.inReplyTo.join(' ')
              : (typeof parsed.inReplyTo === 'string' ? parsed.inReplyTo : undefined),
            references: Array.isArray(parsed.references)
              ? parsed.references.join(' ')
              : (typeof parsed.references === 'string' ? parsed.references : undefined),
            // Subset of headers used by the auto-responder loop guard.
            autoSubmitted: (parsed.headers as any)?.get?.('auto-submitted') as string | undefined,
            precedence: (parsed.headers as any)?.get?.('precedence') as string | undefined,
            listId: (parsed.headers as any)?.get?.('list-id') as string | undefined,
            listUnsubscribe: (parsed.headers as any)?.get?.('list-unsubscribe') as string | undefined,
            returnPath: (parsed.headers as any)?.get?.('return-path') as string | undefined,
            xAutoResponseSuppress: (parsed.headers as any)?.get?.('x-auto-response-suppress') as string | undefined,
            xAutorespond: (parsed.headers as any)?.get?.('x-autorespond') as string | undefined,
            xLoop: (parsed.headers as any)?.get?.('x-loop') as string | undefined,
          },
          size: message.size,
        };
      } finally {
        lock.release();
      }
    } finally {
      await client.logout();
    }
  }

  async sendMail(options: SendMailOptions) {
    const transport = this.createSmtpTransport();

    const mailOptions: any = {
      from: `"${options.from.name}" <${options.from.email}>`,
      to: options.to.map(a => a.name ? `"${a.name}" <${a.email}>` : a.email).join(', '),
      subject: options.subject,
      html: options.html,
      text: options.text,
    };

    // Add sender header for "send on behalf of"
    if (options.sender) {
      mailOptions.sender = `"${options.sender.name}" <${options.sender.email}>`;
    }

    if (options.replyTo?.email) {
      mailOptions.replyTo = options.replyTo.name
        ? `"${options.replyTo.name}" <${options.replyTo.email}>`
        : options.replyTo.email;
    }

    if (options.cc?.length) {
      mailOptions.cc = options.cc.map(a => a.name ? `"${a.name}" <${a.email}>` : a.email).join(', ');
    }

    if (options.bcc?.length) {
      mailOptions.bcc = options.bcc.map(a => a.name ? `"${a.name}" <${a.email}>` : a.email).join(', ');
    }

    if (options.inReplyTo) {
      mailOptions.inReplyTo = options.inReplyTo;
    }

    if (options.references) {
      mailOptions.references = options.references;
    }

    if (options.headers && Object.keys(options.headers).length > 0) {
      mailOptions.headers = options.headers;
    }

    if (options.attachments?.length) {
      mailOptions.attachments = options.attachments.map((att: any) => ({
        filename: att.filename,
        content: Buffer.from(att.content, 'base64'),
        contentType: att.contentType,
      }));
    }

    const result = await transport.sendMail(mailOptions);

    // Ensure a copy is present in IMAP "Sent" folder regardless of provider behavior.
    if (!options.skipSentFolder) {
      await this.appendToSentFolder(options, result.messageId).catch((error) => {
        logger.warn(`Unable to append message to Sent folder: ${error?.message || error}`);
      });
    }

    logger.info(`Email sent: ${result.messageId}`);
    return result;
  }

  /**
   * Relay a pre-built RFC 822 MIME message (for example a client-side S/MIME or PGP/MIME
   * payload) to the SMTP server without modification. The same message is also appended
   * to the IMAP Sent folder so the user can see it in their outbox.
   */
  async sendRaw(params: {
    rawMime: string;
    envelopeFrom: string;
    envelopeTo: string[];
    envelopeCc?: string[];
    envelopeBcc?: string[];
  }) {
    const transport = this.createSmtpTransport();
    const result = await transport.sendMail({
      envelope: {
        from: params.envelopeFrom,
        to: [...(params.envelopeTo || []), ...(params.envelopeCc || []), ...(params.envelopeBcc || [])],
      },
      raw: params.rawMime,
    } as any);

    await this.appendRawToSent(params.rawMime).catch((error) => {
      logger.warn(`Unable to append raw message to Sent folder: ${error?.message || error}`);
    });

    logger.info(`Raw email sent: ${result.messageId || '(no id)'}`);
    return result;
  }

  private async appendRawToSent(rawMime: string) {
    const client = this.createImapClient();
    try {
      await client.connect();
      const sentPath = await this.resolveSentMailboxPath(client);
      if (!sentPath) return;
      const buf = Buffer.from(rawMime, 'utf8');
      await client.append(sentPath, buf, ['\\Seen']);
    } finally {
      await client.logout();
    }
  }

  private formatAddress(address: { email: string; name?: string }) {
    return address.name ? `"${address.name}" <${address.email}>` : address.email;
  }

  private plainTextFromHtml(html?: string) {
    if (!html) return '';
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\n\s+\n/g, '\n\n')
      .replace(/[ \t]+/g, ' ')
      .trim();
  }

  private async resolveSentMailboxPath(client: ImapFlow): Promise<string | null> {
    const folders = await client.list();

    const specialUse = folders.find((f: any) => (f?.specialUse || '').toLowerCase() === '\\sent');
    if (specialUse?.path) return specialUse.path;

    const candidates = new Set([
      'sent',
      'sent items',
      'inbox.sent',
      'envoyes',
      'envoyés',
      'elements envoyes',
      'éléments envoyés',
      'inbox.envoyes',
      'inbox.envoyés',
    ]);

    const normalized = (value?: string) => (value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

    const found = folders.find((f: any) => {
      const path = normalized(f?.path);
      const name = normalized(f?.name);
      return candidates.has(path) || candidates.has(name);
    });

    return found?.path || null;
  }

  private async appendToSentFolder(options: SendMailOptions, messageId?: string) {
    const client = this.createImapClient();
    try {
      await client.connect();
      const sentPath = await this.resolveSentMailboxPath(client);
      if (!sentPath) return;

      // Build a full RFC822 MIME representation (HTML + text alternative, attachments, threading
      // headers) using nodemailer's MailComposer so the copy in Sent matches what the recipient
      // actually got. This also preserves `In-Reply-To` and `References` which are required for
      // conversation threading.
      const composer = new MailComposer({
        from: this.formatAddress(options.from),
        sender: options.sender ? this.formatAddress(options.sender) : undefined,
        replyTo: options.replyTo?.email
          ? (options.replyTo.name ? `"${options.replyTo.name}" <${options.replyTo.email}>` : options.replyTo.email)
          : undefined,
        to: options.to.map(a => this.formatAddress(a)),
        cc: options.cc?.length ? options.cc.map(a => this.formatAddress(a)) : undefined,
        // Intentionally omit Bcc in the stored copy (matches most MUAs).
        subject: options.subject,
        text: options.text || this.plainTextFromHtml(options.html) || undefined,
        html: options.html || undefined,
        inReplyTo: options.inReplyTo,
        references: options.references,
        messageId: messageId || `<${Date.now()}@${this.account.smtp_host}>`,
        date: new Date(),
        attachments: options.attachments?.length
          ? options.attachments.map((att: any) => ({
              filename: att.filename,
              content: Buffer.from(att.content, 'base64'),
              contentType: att.contentType,
            }))
          : undefined,
      });

      const rawMessage: Buffer = await new Promise((resolve, reject) => {
        composer.compile().build((err, message) => {
          if (err) reject(err); else resolve(message);
        });
      });

      await client.append(sentPath, rawMessage, ['\\Seen']);
    } finally {
      await client.logout();
    }
  }

  async setFlags(folder: string, uid: number, flags: { seen?: boolean; flagged?: boolean; answered?: boolean }) {
    const client = this.createImapClient();
    try {
      await client.connect();
      const lock = await client.getMailboxLock(folder);
      try {
        const flagsToAdd: string[] = [];
        const flagsToRemove: string[] = [];

        if (flags.seen === true) flagsToAdd.push('\\Seen');
        if (flags.seen === false) flagsToRemove.push('\\Seen');
        if (flags.flagged === true) flagsToAdd.push('\\Flagged');
        if (flags.flagged === false) flagsToRemove.push('\\Flagged');
        if (flags.answered === true) flagsToAdd.push('\\Answered');
        if (flags.answered === false) flagsToRemove.push('\\Answered');

        if (flagsToAdd.length) {
          await client.messageFlagsAdd(`${uid}`, flagsToAdd, { uid: true });
        }
        if (flagsToRemove.length) {
          await client.messageFlagsRemove(`${uid}`, flagsToRemove, { uid: true });
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout();
    }
  }

  async moveMessage(fromFolder: string, uid: number, toFolder: string) {
    const client = this.createImapClient();
    try {
      await client.connect();

      // Ensure the destination mailbox exists. Some IMAP servers (e.g. o2switch
      // / Dovecot) return a vague NO/BAD when moving to a missing folder; we
      // pre-create it (no-op if it already exists) so the move can proceed.
      // mailboxCreate throws "ALREADYEXISTS" when the path is already there —
      // which we silently swallow.
      try {
        await client.mailboxCreate(toFolder);
      } catch (e: any) {
        const msg = String(e?.message || e?.code || '').toLowerCase();
        if (!msg.includes('exist')) {
          // Not an "already exists" error — log and continue; the move will
          // surface the real reason if the folder genuinely cannot be used.
          console.warn(`[mail] mailboxCreate(${toFolder}) failed before move:`, e?.message || e);
        }
      }

      const lock = await client.getMailboxLock(fromFolder);
      try {
        const result: any = await client.messageMove(`${uid}`, toFolder, { uid: true });
        // ImapFlow returns an object with `uidMap` on success. When the source
        // UID does not exist, some servers respond with success + empty map
        // instead of an error, so we detect the no-op and surface a useful
        // message to the client.
        if (result && typeof result === 'object' && 'uidMap' in result && result.uidMap?.size === 0) {
          throw new Error(`Le message UID ${uid} est introuvable dans ${fromFolder}`);
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout();
    }
  }

  /**
   * Archive a message into a hierarchical folder computed from the message's
   * reception date (internalDate/envelope date). Creates any missing folder
   * along the way. Returns the final destination path.
   *
   * @param rootFolder     Root archive folder name (e.g. "Archives").
   * @param subfolderPattern Pattern joined with "/" between segments, using tokens:
   *                       {YYYY} {YY} {MM} {M} {MMMM} (French month name) {MMM}.
   *                       Example: "{YYYY}/{MM} - {MMMM}".
   */
  async archiveMessage(
    fromFolder: string,
    uid: number,
    rootFolder: string,
    subfolderPattern: string,
  ): Promise<{ destFolder: string }> {
    const client = this.createImapClient();
    try {
      await client.connect();

      // Determine the server's folder delimiter (fallback to '/').
      let delimiter = '/';
      try {
        const list = await client.list();
        const rootMatch = list.find(f => f.path === rootFolder || f.name === rootFolder);
        const first = list[0];
        delimiter = rootMatch?.delimiter || first?.delimiter || '/';
      } catch {
        // keep default
      }

      // Fetch the message's reception date from the source folder.
      let receivedAt: Date = new Date();
      const srcLock = await client.getMailboxLock(fromFolder);
      try {
        const msg = await client.fetchOne(`${uid}`, {
          uid: true,
          internalDate: true,
          envelope: true,
        }, { uid: true }) as any;
        const d = msg?.internalDate || msg?.envelope?.date;
        if (d) receivedAt = new Date(d);
      } catch {
        // keep default: "now"
      } finally {
        srcLock.release();
      }

      const destFolder = buildArchiveFolderPath(rootFolder, subfolderPattern, receivedAt, delimiter);

      // Create each ancestor folder if missing (mailboxCreate is not guaranteed
      // to create intermediate paths on every server, so we walk the segments).
      const segments = destFolder.split(delimiter).filter(Boolean);
      for (let i = 1; i <= segments.length; i++) {
        const partial = segments.slice(0, i).join(delimiter);
        try {
          await client.mailboxCreate(partial);
          try { await (client as any).mailboxSubscribe?.(partial); } catch {}
        } catch (err: any) {
          // Ignore "already exists" errors; rethrow anything else.
          const msg = (err?.message || '').toLowerCase();
          if (!msg.includes('already exists') && !msg.includes('exists')) {
            // Some servers return an unhelpful message; try listing to decide.
            try {
              const list = await client.list();
              if (!list.some(f => f.path === partial)) throw err;
            } catch {
              throw err;
            }
          }
        }
      }

      // Now move the message into the deepest folder.
      const moveLock = await client.getMailboxLock(fromFolder);
      try {
        await client.messageMove(`${uid}`, destFolder, { uid: true });
      } finally {
        moveLock.release();
      }

      return { destFolder };
    } finally {
      await client.logout();
    }
  }

  async copyMessage(fromFolder: string, uid: number, toFolder: string) {
    const client = this.createImapClient();
    try {
      await client.connect();
      const lock = await client.getMailboxLock(fromFolder);
      try {
        await client.messageCopy(`${uid}`, toFolder, { uid: true });
      } finally {
        lock.release();
      }
    } finally {
      await client.logout();
    }
  }

  async deleteMessage(folder: string, uid: number) {
    const client = this.createImapClient();
    try {
      await client.connect();
      const lock = await client.getMailboxLock(folder);
      try {
        await client.messageDelete(`${uid}`, { uid: true });
      } finally {
        lock.release();
      }
    } finally {
      await client.logout();
    }
  }

  async deleteMessages(folder: string, uids: number[]) {
    if (uids.length === 0) return;
    const client = this.createImapClient();
    try {
      await client.connect();
      const lock = await client.getMailboxLock(folder);
      try {
        await client.messageDelete(uids.join(','), { uid: true });
      } finally {
        lock.release();
      }
    } finally {
      await client.logout();
    }
  }

  async moveMessages(fromFolder: string, uids: number[], toFolder: string) {
    if (uids.length === 0) return;
    const client = this.createImapClient();
    try {
      await client.connect();
      try { await client.mailboxCreate(toFolder); } catch {}
      const lock = await client.getMailboxLock(fromFolder);
      try {
        await client.messageMove(uids.join(','), toFolder, { uid: true });
      } finally {
        lock.release();
      }
    } finally {
      await client.logout();
    }
  }

  async searchMessages(folder: string, query: string) {
    const client = this.createImapClient();
    try {
      await client.connect();
      const lock = await client.getMailboxLock(folder);
      try {
        const results = await client.search({
          or: [
            { subject: query },
            { from: query },
            { to: query },
            { body: query },
          ],
        });
        return results;
      } finally {
        lock.release();
      }
    } finally {
      await client.logout();
    }
  }

  private hasAttachments(bodyStructure: any): boolean {
    if (!bodyStructure) return false;
    if (bodyStructure.disposition === 'attachment') return true;
    if (bodyStructure.childNodes) {
      return bodyStructure.childNodes.some((child: any) => this.hasAttachments(child));
    }
    return false;
  }

  private getLargestAttachmentSize(bodyStructure: any): number {
    if (!bodyStructure) return 0;

    let largest = 0;
    if (bodyStructure.disposition === 'attachment') {
      largest = Math.max(largest, Number(bodyStructure.size) || 0);
    }

    if (bodyStructure.childNodes?.length) {
      for (const child of bodyStructure.childNodes) {
        largest = Math.max(largest, this.getLargestAttachmentSize(child));
      }
    }

    return largest;
  }

  async createFolder(path: string) {
    const client = this.createImapClient();
    try {
      await client.connect();
      await client.mailboxCreate(path);
      try {
        await (client as any).mailboxSubscribe?.(path);
      } catch {}
    } finally {
      await client.logout();
    }
  }

  async renameFolder(oldPath: string, newPath: string) {
    const client = this.createImapClient();
    try {
      await client.connect();
      await client.mailboxRename(oldPath, newPath);
      // Ensure the renamed folder is subscribed so other clients (Roundcube, Thunderbird, …) still list it.
      try {
        await (client as any).mailboxSubscribe?.(newPath);
      } catch {}
      // Best-effort: remove any lingering subscription on the old path.
      try {
        await (client as any).mailboxUnsubscribe?.(oldPath);
      } catch {}
    } finally {
      await client.logout();
    }
  }

  async deleteFolder(path: string) {
    const client = this.createImapClient();
    try {
      await client.connect();
      await client.mailboxDelete(path);
    } finally {
      await client.logout();
    }
  }

  /**
   * Fetches the raw RFC822 source of a single message.
   * Returned as Node Buffer to be appended elsewhere.
   */
  async fetchRawMessage(folder: string, uid: number): Promise<{ source: Buffer; flags: string[]; internalDate?: Date }> {
    const client = this.createImapClient();
    try {
      await client.connect();
      const lock = await client.getMailboxLock(folder);
      try {
        const message = await client.fetchOne(`${uid}`, {
          uid: true,
          flags: true,
          source: true,
          internalDate: true,
        }, { uid: true }) as any;

        if (!message?.source) throw new Error('Message source indisponible');

        const flagsSet: Set<string> = message.flags || new Set();
        const flags = Array.from(flagsSet).filter((f: string) => f !== '\\Recent');

        return {
          source: Buffer.isBuffer(message.source) ? message.source : Buffer.from(message.source),
          flags,
          internalDate: message.internalDate,
        };
      } finally {
        lock.release();
      }
    } finally {
      await client.logout();
    }
  }

  /**
   * Appends a raw RFC822 message to the given folder.
   * Creates the folder if it does not exist.
   */
  async appendRawMessage(folder: string, source: Buffer, flags: string[] = [], internalDate?: Date) {
    const client = this.createImapClient();
    try {
      await client.connect();
      // Ensure target folder exists (create is idempotent: we silently ignore "already exists")
      await client.mailboxCreate(folder).catch(() => {});
      await client.append(folder, source, flags, internalDate);
    } finally {
      await client.logout();
    }
  }

  /**
   * Returns the UIDs of all messages present in a folder.
   */
  async listFolderUids(folder: string): Promise<number[]> {
    const client = this.createImapClient();
    try {
      await client.connect();
      const lock = await client.getMailboxLock(folder);
      try {
        const uids = await client.search({ all: true }, { uid: true });
        return Array.isArray(uids) ? uids.map((u) => Number(u)) : [];
      } finally {
        lock.release();
      }
    } finally {
      await client.logout();
    }
  }

  /**
   * Returns UIDs of messages whose INTERNALDATE is on or after `since`.
   * Used by the auto-responder to recover messages that arrived between the
   * moment the responder was activated and the poller's first observation
   * for this account (otherwise the baseline-only logic in newMailPoller
   * would silently swallow them).
   */
  async listFolderUidsSince(folder: string, since: Date): Promise<number[]> {
    const client = this.createImapClient();
    try {
      await client.connect();
      const lock = await client.getMailboxLock(folder);
      try {
        const uids = await client.search({ since }, { uid: true });
        return Array.isArray(uids) ? uids.map((u) => Number(u)) : [];
      } finally {
        lock.release();
      }
    } finally {
      await client.logout();
    }
  }
}

// French month names used by the archive subfolder pattern.
const ARCHIVE_MONTH_NAMES_FR = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];
const ARCHIVE_MONTH_SHORT_FR = [
  'Janv.', 'Févr.', 'Mars', 'Avr.', 'Mai', 'Juin',
  'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.',
];

/**
 * Build the IMAP folder path used to archive a message.
 * The pattern uses '/' as segment separator (regardless of IMAP delimiter)
 * and supports tokens: {YYYY} {YY} {MM} {M} {MMMM} {MMM}.
 */
export function buildArchiveFolderPath(
  rootFolder: string,
  subfolderPattern: string,
  receivedAt: Date,
  delimiter: string,
): string {
  const year = receivedAt.getFullYear();
  const monthIdx = receivedAt.getMonth(); // 0..11
  const tokens: Record<string, string> = {
    '{YYYY}': String(year),
    '{YY}': String(year).slice(-2),
    '{MM}': String(monthIdx + 1).padStart(2, '0'),
    '{M}': String(monthIdx + 1),
    '{MMMM}': ARCHIVE_MONTH_NAMES_FR[monthIdx],
    '{MMM}': ARCHIVE_MONTH_SHORT_FR[monthIdx],
  };

  let pattern = subfolderPattern || '';
  for (const [k, v] of Object.entries(tokens)) {
    pattern = pattern.split(k).join(v);
  }

  const root = (rootFolder || 'Archives').trim();
  const segments = [root, ...pattern.split('/')]
    .map(s => s.trim())
    .filter(Boolean);

  return segments.join(delimiter);
}
