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
    logger.info(`Email sent: ${result.messageId}`);
    return result;
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
}
