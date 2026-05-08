// Client-side rule evaluator — limited subset used to apply the
// `assignCategory` action locally (categories live in localStorage).
//
// The full rule engine runs server-side (server/src/services/mailRules.ts)
// for IMAP-side actions: move, delete, mark read, forward, …
// Categorisation cannot run server-side, so the web app re-evaluates each
// rule against the messages it just fetched and stores the assignment in
// the local categories map.

import type { Email } from '../types';
import type { MailRule, MailRuleCondition, MailRuleAction } from '../api';
import {
  getMessageCategories,
  setMessageCategories,
  getCategories,
} from './categories';

function lc(v: any): string {
  return v == null ? '' : String(v).toLowerCase();
}

function addressList(arr: any): string {
  if (!arr) return '';
  if (!Array.isArray(arr)) return `${lc(arr?.address)} ${lc(arr?.name)}`;
  return arr.map((a: any) => `${lc(a?.address)} ${lc(a?.name)}`).join(' ');
}

interface EvalContext {
  msg: Email;
  accountEmail: string;
  userDisplayName: string;
  userEmail: string;
}

function evalCondition(c: MailRuleCondition, ctx: EvalContext): boolean {
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
    case 'recipientAddressContains':
      return needle ? addressList(msg?.to).includes(needle) : false;
    case 'ccContains':
      return needle ? addressList(msg?.cc).includes(needle) : false;
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
    case 'hasAttachment':
      return !!msg?.hasAttachments
        || (Array.isArray(msg?.attachments) && msg!.attachments!.length > 0);
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
      const size = Number((msg as any)?.size || 0);
      return size >= min;
    }
    // Conditions that need server-side data we don't have on the client
    // (raw headers, importance/sensitivity headers): skip — treat as false
    // so the rule simply doesn't match for categorisation purposes.
    case 'headerContains':
    case 'importance':
    case 'sensitivity':
    default:
      return false;
  }
}

function ruleMatches(rule: MailRule, ctx: EvalContext): boolean {
  const conds = Array.isArray(rule.conditions) ? rule.conditions : [];
  const excs = Array.isArray(rule.exceptions) ? rule.exceptions : [];

  if (conds.length > 0) {
    const checks = conds.map((c) => evalCondition(c, ctx));
    const ok = rule.matchType === 'any' ? checks.some(Boolean) : checks.every(Boolean);
    if (!ok) return false;
  }

  if (excs.length > 0 && excs.some((c) => evalCondition(c, ctx))) return false;
  return true;
}

/** Resolve the local category id for an `assignCategory` action.
 *  Falls back to matching by name when the id is unknown on this device. */
function resolveCategoryId(action: MailRuleAction): string | null {
  const cats = getCategories();
  if (action.categoryId && cats.some((c) => c.id === action.categoryId)) {
    return action.categoryId;
  }
  if (action.categoryName) {
    const wanted = action.categoryName.trim().toLowerCase();
    const match = cats.find((c) => c.name.trim().toLowerCase() === wanted);
    if (match) return match.id;
  }
  return null;
}

export interface ApplyOptions {
  accountId: string;
  folder: string;
  accountEmail: string;
  userEmail: string;
  userDisplayName: string;
}

/**
 * Iterates `messages` and, for each enabled rule scoped to the account,
 * evaluates conditions and applies any `assignCategory` action by appending
 * the category to the local assignment map. Pre-existing assignments on a
 * message are preserved (the rule only ADDS categories, never removes).
 *
 * Returns the number of (message, category) assignments performed so the
 * caller can decide whether to refresh the UI.
 */
export function applyCategoryRules(
  messages: Email[],
  rules: MailRule[],
  opts: ApplyOptions,
): number {
  if (!messages.length || !rules.length) return 0;
  const enabled = rules.filter(
    (r) => r.enabled && (!r.accountId || r.accountId === opts.accountId),
  );
  if (!enabled.length) return 0;

  let assigned = 0;
  for (const msg of messages) {
    const ctx: EvalContext = {
      msg,
      accountEmail: opts.accountEmail,
      userDisplayName: opts.userDisplayName,
      userEmail: opts.userEmail,
    };
    for (const rule of enabled) {
      if (!ruleMatches(rule, ctx)) continue;
      for (const action of rule.actions || []) {
        if (action.type !== 'assignCategory') continue;
        const catId = resolveCategoryId(action);
        if (!catId) continue;
        const current = getMessageCategories(msg, opts.accountId, opts.folder);
        if (current.includes(catId)) continue;
        setMessageCategories(
          msg,
          [...current, catId],
          opts.accountId,
          opts.folder,
        );
        assigned++;
      }
      if (rule.stopProcessing) break;
    }
  }
  return assigned;
}
