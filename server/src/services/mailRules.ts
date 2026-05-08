import { pool } from '../database/connection';
import { logger } from '../utils/logger';
import { MailService } from './mail';

/**
 * Mail rules engine — Outlook-style "Rules" applied to incoming messages.
 *
 * A rule matches when its conditions are satisfied (AND/OR according to
 * `match_type`) AND none of its exceptions match. When matched, every action
 * is executed in declared order. If `stop_processing` is true, no further
 * rule is evaluated for this message.
 *
 * The rules are evaluated by the new-mail poller for each newly observed
 * UID before the per-recipient notification + auto-responder pipeline runs,
 * so any "delete / move / mark read" action correctly silences the badge.
 */

export type RuleConditionType =
  | 'fromContains'
  | 'toContains'
  | 'ccContains'
  | 'subjectContains'
  | 'subjectOrBodyContains'
  | 'bodyContains'
  | 'recipientAddressContains'
  | 'senderAddressContains'
  | 'headerContains'
  | 'hasAttachment'
  | 'importance'
  | 'sensitivity'
  | 'sentOnlyToMe'
  | 'myNameInTo'
  | 'myNameInCc'
  | 'myNameInToOrCc'
  | 'myNameNotInTo'
  | 'flagged'
  | 'sizeAtLeast';

export interface RuleCondition {
  type: RuleConditionType;
  value?: string;
  // For `headerContains` only
  headerName?: string;
  // For `importance` / `sensitivity` only
  level?: string;
  // For `sizeAtLeast` only — bytes
  bytes?: number;
}

export type RuleActionType =
  | 'moveToFolder'
  | 'copyToFolder'
  | 'delete'
  | 'permanentlyDelete'
  | 'markAsRead'
  | 'markAsUnread'
  | 'flag'
  | 'unflag'
  | 'forwardTo'
  | 'redirectTo'
  | 'replyWithTemplate'
  | 'assignCategory'
  | 'stopProcessingMoreRules';

export interface RuleAction {
  type: RuleActionType;
  folder?: string;
  /** comma-separated list of email addresses */
  to?: string;
  templateId?: string;
  /** For `assignCategory` — local category id stored client-side. */
  categoryId?: string;
  /** Human-readable category name, kept as a fallback when the id
   *  is unknown to the device viewing the rule. */
  categoryName?: string;
}

export interface MailRuleRow {
  id: string;
  user_id: string;
  account_id: string | null;
  name: string;
  enabled: boolean;
  position: number;
  match_type: 'all' | 'any';
  stop_processing: boolean;
  conditions: RuleCondition[];
  exceptions: RuleCondition[];
  actions: RuleAction[];
  created_at: string | null;
  updated_at: string | null;
}

export const CONDITION_TYPES: RuleConditionType[] = [
  'fromContains', 'toContains', 'ccContains', 'subjectContains',
  'subjectOrBodyContains', 'bodyContains', 'recipientAddressContains',
  'senderAddressContains', 'headerContains', 'hasAttachment', 'importance',
  'sensitivity', 'sentOnlyToMe', 'myNameInTo', 'myNameInCc',
  'myNameInToOrCc', 'myNameNotInTo', 'flagged', 'sizeAtLeast',
];

export const ACTION_TYPES: RuleActionType[] = [
  'moveToFolder', 'copyToFolder', 'delete', 'permanentlyDelete',
  'markAsRead', 'markAsUnread', 'flag', 'unflag', 'forwardTo',
  'redirectTo', 'replyWithTemplate', 'assignCategory',
  'stopProcessingMoreRules',
];

function lc(v: any): string {
  return v == null ? '' : String(v).toLowerCase();
}

function addressList(arr: any): string {
  if (!arr) return '';
  if (!Array.isArray(arr)) return lc(arr?.address) + ' ' + lc(arr?.name);
  return arr.map((a: any) => `${lc(a?.address)} ${lc(a?.name)}`).join(' ');
}

interface EvalContext {
  msg: any;
  accountEmail: string;
  userDisplayName: string;
  userEmail: string;
}

function evalCondition(c: RuleCondition, ctx: EvalContext): boolean {
  const { msg, accountEmail, userDisplayName, userEmail } = ctx;
  const needle = lc(c.value || '');
  const me = [lc(accountEmail), lc(userEmail)].filter(Boolean);
  const myName = lc(userDisplayName);

  switch (c.type) {
    case 'fromContains':
    case 'senderAddressContains': {
      const hay = `${lc(msg?.from?.address)} ${lc(msg?.from?.name)}`;
      return needle ? hay.includes(needle) : false;
    }
    case 'toContains':
    case 'recipientAddressContains': {
      const hay = addressList(msg?.to);
      return needle ? hay.includes(needle) : false;
    }
    case 'ccContains': {
      const hay = addressList(msg?.cc);
      return needle ? hay.includes(needle) : false;
    }
    case 'subjectContains':
      return needle ? lc(msg?.subject).includes(needle) : false;
    case 'bodyContains':
      return needle
        ? (lc(msg?.bodyText).includes(needle) || lc(msg?.bodyHtml).includes(needle))
        : false;
    case 'subjectOrBodyContains':
      return needle
        ? (lc(msg?.subject).includes(needle)
          || lc(msg?.bodyText).includes(needle)
          || lc(msg?.bodyHtml).includes(needle))
        : false;
    case 'headerContains': {
      if (!c.headerName) return false;
      const headers: any = msg?.headers || {};
      // mailparser returns a Map-like object; some implementations return
      // a plain object. Try both. Also try normalised lowercase.
      const name = c.headerName.toLowerCase();
      let raw = '';
      if (typeof headers.get === 'function') {
        raw = String(headers.get(name) || '');
      } else if (headers && typeof headers === 'object') {
        for (const k of Object.keys(headers)) {
          if (k.toLowerCase() === name) { raw = String(headers[k] || ''); break; }
        }
      }
      return needle ? lc(raw).includes(needle) : !!raw;
    }
    case 'hasAttachment': {
      const atts = msg?.attachments;
      return Array.isArray(atts) ? atts.length > 0 : !!msg?.hasAttachments;
    }
    case 'importance': {
      const want = lc(c.level || 'high');
      const headers: any = msg?.headers || {};
      const get = (n: string) => {
        if (typeof headers.get === 'function') return String(headers.get(n) || '');
        if (headers && typeof headers === 'object') {
          for (const k of Object.keys(headers)) if (k.toLowerCase() === n) return String(headers[k] || '');
        }
        return '';
      };
      const importance = lc(get('importance'));
      const xPriority = lc(get('x-priority'));
      if (want === 'high') return importance === 'high' || /^[12]/.test(xPriority);
      if (want === 'low') return importance === 'low' || /^[45]/.test(xPriority);
      return importance === 'normal' || xPriority === '3' || (!importance && !xPriority);
    }
    case 'sensitivity': {
      const want = lc(c.level || 'confidential');
      const headers: any = msg?.headers || {};
      const get = (n: string) => {
        if (typeof headers.get === 'function') return String(headers.get(n) || '');
        if (headers && typeof headers === 'object') {
          for (const k of Object.keys(headers)) if (k.toLowerCase() === n) return String(headers[k] || '');
        }
        return '';
      };
      return lc(get('sensitivity')) === want;
    }
    case 'sentOnlyToMe': {
      const tos = (msg?.to || []) as any[];
      const ccs = (msg?.cc || []) as any[];
      if (!Array.isArray(tos) || tos.length !== 1) return false;
      if (Array.isArray(ccs) && ccs.length > 0) return false;
      return me.includes(lc(tos[0]?.address));
    }
    case 'myNameInTo': {
      const tos = addressList(msg?.to);
      return me.some((m) => tos.includes(m)) || (myName ? tos.includes(myName) : false);
    }
    case 'myNameInCc': {
      const ccs = addressList(msg?.cc);
      return me.some((m) => ccs.includes(m)) || (myName ? ccs.includes(myName) : false);
    }
    case 'myNameInToOrCc': {
      const all = `${addressList(msg?.to)} ${addressList(msg?.cc)}`;
      return me.some((m) => all.includes(m)) || (myName ? all.includes(myName) : false);
    }
    case 'myNameNotInTo': {
      const tos = addressList(msg?.to);
      const inTo = me.some((m) => tos.includes(m)) || (myName ? tos.includes(myName) : false);
      return !inTo;
    }
    case 'flagged':
      return !!msg?.flags?.flagged;
    case 'sizeAtLeast': {
      const min = Number(c.bytes || 0);
      const size = Number(msg?.size || 0);
      return size >= min;
    }
    default:
      return false;
  }
}

function ruleMatches(rule: MailRuleRow, ctx: EvalContext): boolean {
  const conds = Array.isArray(rule.conditions) ? rule.conditions : [];
  const excs = Array.isArray(rule.exceptions) ? rule.exceptions : [];

  if (conds.length > 0) {
    const checks = conds.map((c) => evalCondition(c, ctx));
    const ok = rule.match_type === 'any' ? checks.some(Boolean) : checks.every(Boolean);
    if (!ok) return false;
  }

  if (excs.length > 0) {
    const anyExc = excs.some((c) => evalCondition(c, ctx));
    if (anyExc) return false;
  }

  return true;
}

interface RuleApplyResult {
  /** true when at least one action moved/deleted the message away from INBOX. */
  removed: boolean;
  /** true when at least one action changed read state to "seen". */
  markedRead: boolean;
  /** true when the engine asked to halt the new-mail pipeline (notify/responder). */
  silence: boolean;
  matched: number;
}

/**
 * Loads all enabled rules for an account+user, evaluates them against the
 * given message and runs the actions on the IMAP server. Errors are logged
 * but never thrown so the new-mail poller stays resilient.
 */
export async function applyRulesToIncoming(
  accountRow: { id: string; user_id: string; email: string; name: string | null },
  uid: number,
  msg: any,
  service: MailService,
): Promise<RuleApplyResult> {
  const result: RuleApplyResult = { removed: false, markedRead: false, silence: false, matched: 0 };

  let rules: MailRuleRow[] = [];
  try {
    const r = await pool.query(
      `SELECT mr.*, COALESCE(u.display_name, u.email) AS user_display, u.email AS user_email
         FROM mail_rules mr
         JOIN users u ON u.id = mr.user_id
        WHERE mr.user_id = $1
          AND mr.enabled = true
          AND (mr.account_id IS NULL OR mr.account_id = $2)
        ORDER BY mr.position ASC, mr.created_at ASC`,
      [accountRow.user_id, accountRow.id],
    );
    rules = r.rows as any[];
  } catch (err) {
    logger.debug({ err, accountId: accountRow.id }, 'mail-rules: load failed');
    return result;
  }

  if (rules.length === 0) return result;

  // Resolve user identity once (used for "my name is …" conditions).
  let userDisplayName = '';
  let userEmail = '';
  try {
    const u = await pool.query(
      `SELECT display_name, email FROM users WHERE id = $1`,
      [accountRow.user_id],
    );
    if (u.rowCount! > 0) {
      userDisplayName = u.rows[0].display_name || '';
      userEmail = u.rows[0].email || '';
    }
  } catch { /* best-effort */ }

  const ctx: EvalContext = {
    msg,
    accountEmail: accountRow.email,
    userDisplayName,
    userEmail,
  };

  for (const rule of rules) {
    if (!ruleMatches(rule, ctx)) continue;
    result.matched++;

    let stop = !!rule.stop_processing;
    let removedHere = false;

    for (const action of (Array.isArray(rule.actions) ? rule.actions : [])) {
      try {
        await runAction(action, accountRow, uid, msg, service, result);
        if (action.type === 'moveToFolder' || action.type === 'delete' || action.type === 'permanentlyDelete') {
          removedHere = true;
        }
        if (action.type === 'stopProcessingMoreRules') {
          stop = true;
        }
      } catch (err) {
        logger.error({ err, ruleId: rule.id, action: action.type }, 'mail-rules: action failed');
      }
      // Once the message has been moved/deleted, further IMAP actions on the
      // same UID would fail. Keep going in-memory only for "stop processing".
      if (removedHere && action !== rule.actions[rule.actions.length - 1]) {
        break;
      }
    }

    if (removedHere) result.removed = true;
    if (removedHere) {
      // The message no longer exists in INBOX — silence notifications & responder.
      result.silence = true;
      // No further rules can act on it.
      return result;
    }
    if (stop) return result;
  }

  return result;
}

async function runAction(
  action: RuleAction,
  accountRow: { id: string; user_id: string; email: string; name: string | null },
  uid: number,
  msg: any,
  service: MailService,
  result: RuleApplyResult,
): Promise<void> {
  switch (action.type) {
    case 'moveToFolder': {
      if (!action.folder) return;
      await service.moveMessage('INBOX', uid, action.folder);
      return;
    }
    case 'copyToFolder': {
      if (!action.folder) return;
      await service.copyMessage('INBOX', uid, action.folder);
      return;
    }
    case 'delete': {
      // "Soft" delete — move to Trash if available, otherwise mark deleted.
      try {
        await service.moveMessage('INBOX', uid, 'Trash');
      } catch {
        await service.deleteMessage('INBOX', uid);
      }
      return;
    }
    case 'permanentlyDelete': {
      await service.deleteMessage('INBOX', uid);
      return;
    }
    case 'markAsRead': {
      await service.setFlags('INBOX', uid, { seen: true });
      result.markedRead = true;
      return;
    }
    case 'markAsUnread': {
      await service.setFlags('INBOX', uid, { seen: false });
      return;
    }
    case 'flag': {
      await service.setFlags('INBOX', uid, { flagged: true });
      return;
    }
    case 'unflag': {
      await service.setFlags('INBOX', uid, { flagged: false });
      return;
    }
    case 'forwardTo':
    case 'redirectTo': {
      const list = String(action.to || '').split(/[,;\s]+/).filter(Boolean);
      if (list.length === 0) return;
      const subject = (msg?.subject || '').toString();
      const html = msg?.bodyHtml || msg?.bodyText || '';
      const text = msg?.bodyText || '';
      try {
        await service.sendMail({
          from: { email: accountRow.email, name: accountRow.name || accountRow.email },
          to: list.map((email) => ({ email })),
          subject: action.type === 'forwardTo' ? `Fwd: ${subject}` : subject,
          html,
          text,
          headers: {
            'Auto-Submitted': 'auto-forwarded',
            'X-Forwarded-By-Rule': 'mail-rules',
          },
          skipSentFolder: true,
        });
      } catch (err) {
        logger.error({ err }, 'mail-rules: forward failed');
      }
      return;
    }
    case 'replyWithTemplate': {
      if (!action.templateId) return;
      try {
        const r = await pool.query(
          `SELECT subject, body_html FROM mail_templates WHERE id = $1`,
          [action.templateId],
        );
        if (r.rowCount === 0) return;
        const tpl = r.rows[0];
        const fromAddr = msg?.from?.address;
        if (!fromAddr) return;
        await service.sendMail({
          from: { email: accountRow.email, name: accountRow.name || accountRow.email },
          to: [{ email: fromAddr }],
          subject: tpl.subject || `Re: ${msg?.subject || ''}`,
          html: tpl.body_html || '',
          inReplyTo: msg?.messageId,
          references: msg?.messageId,
          headers: {
            'Auto-Submitted': 'auto-replied',
            'X-Generated-By': 'mail-rules',
          },
          skipSentFolder: true,
        });
      } catch (err) {
        logger.error({ err }, 'mail-rules: reply template failed');
      }
      return;
    }
    case 'assignCategory':
      // Categories are stored client-side (localStorage) — the engine has
      // nothing to do here. The action is persisted on the rule and applied
      // by the web app after fetching the message list.
      return;
    case 'stopProcessingMoreRules':
      return;
    default:
      return;
  }
}
