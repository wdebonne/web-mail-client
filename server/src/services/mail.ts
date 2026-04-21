import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import { simpleParser } from 'mailparser';
import { logger } from '../utils/logger';

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
}

export class MailService {
  private account: MailAccount;

  constructor(account: MailAccount) {
    this.account = account;
  }

  private createImapClient(): ImapFlow {
    return new ImapFlow({
      host: this.account.imap_host,
      port: this.account.imap_port,
      secure: this.account.imap_secure,
      auth: {
        user: this.account.username,
        pass: this.account.password,
      },
      logger: false,
    });
  }

  private createSmtpTransport() {
    return nodemailer.createTransport({
      host: this.account.smtp_host,
      port: this.account.smtp_port,
      secure: this.account.smtp_secure,
      auth: {
        user: this.account.username,
        pass: this.account.password,
      },
    });
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

        for await (const msg of client.fetch(range, {
          uid: true,
          flags: true,
          envelope: true,
          bodyStructure: true,
          size: true,
        })) {
          const envelope = msg.envelope!;
          messages.push({
            uid: msg.uid,
            messageId: envelope.messageId,
            subject: envelope.subject,
            from: envelope.from?.[0] ? {
              address: envelope.from[0].address,
              name: envelope.from[0].name,
            } : null,
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
          } : null,
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
            inReplyTo: parsed.inReplyTo,
            references: parsed.references,
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

    if (options.attachments?.length) {
      mailOptions.attachments = options.attachments.map((att: any) => ({
        filename: att.filename,
        content: Buffer.from(att.content, 'base64'),
        contentType: att.contentType,
      }));
    }

    const result = await transport.sendMail(mailOptions);

    // Ensure a copy is present in IMAP "Sent" folder regardless of provider behavior.
    await this.appendToSentFolder(options, result.messageId).catch((error) => {
      logger.warn(`Unable to append message to Sent folder: ${error?.message || error}`);
    });

    logger.info(`Email sent: ${result.messageId}`);
    return result;
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

      const toHeader = options.to.map((a) => this.formatAddress(a)).join(', ');
      const ccHeader = options.cc?.length ? options.cc.map((a) => this.formatAddress(a)).join(', ') : '';
      const body = options.text || this.plainTextFromHtml(options.html) || '';

      const lines = [
        `From: ${this.formatAddress(options.from)}`,
        options.sender ? `Sender: ${this.formatAddress(options.sender)}` : '',
        `To: ${toHeader}`,
        ccHeader ? `Cc: ${ccHeader}` : '',
        `Subject: ${options.subject}`,
        `Date: ${new Date().toUTCString()}`,
        `Message-ID: ${messageId || `<${Date.now()}@${this.account.smtp_host}>`}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        'Content-Transfer-Encoding: 8bit',
        '',
        body,
      ].filter(Boolean);

      const rawMessage = Buffer.from(lines.join('\r\n'), 'utf8');
      await client.append(sentPath, rawMessage, ['\\Seen']);
    } finally {
      await client.logout();
    }
  }

  async setFlags(folder: string, uid: number, flags: { seen?: boolean; flagged?: boolean }) {
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
      const lock = await client.getMailboxLock(fromFolder);
      try {
        await client.messageMove(`${uid}`, toFolder, { uid: true });
      } finally {
        lock.release();
      }
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
    } finally {
      await client.logout();
    }
  }

  async renameFolder(oldPath: string, newPath: string) {
    const client = this.createImapClient();
    try {
      await client.connect();
      await client.mailboxRename(oldPath, newPath);
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
}
