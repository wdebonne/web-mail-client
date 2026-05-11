import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Mail, Phone, Building, Briefcase, Users, BookOpen, User } from 'lucide-react';
import { api } from '../../api';

interface PopupContact {
  email?: string;
  name?: string;
  company?: string;
  jobTitle?: string;
  phone?: string;
  mobile?: string;
  avatarUrl?: string;
}

interface PopupDL {
  name: string;
  description?: string;
  members: { email: string; name?: string }[];
}

interface HoverCardProps {
  children: React.ReactNode;
  /** Contact email to look up (for received emails). Ignored if `data` is provided. */
  email?: string;
  /** Pre-filled contact data (for compose chips where we already have it). */
  data?: PopupContact;
  /** Distribution list data — renders a list card instead of a contact card. */
  distributionList?: PopupDL;
  /** Delay in ms before popup appears (default 400). */
  delay?: number;
}

// ── Global popup singleton ──────────────────────────────────────────────────
let globalClosePopup: (() => void) | null = null;

// ── Main wrapper ────────────────────────────────────────────────────────────
export function HoverCard({ children, email, data, distributionList, delay = 400 }: HoverCardProps) {
  const [popup, setPopup] = useState<{
    contact?: PopupContact;
    dl?: PopupDL;
    rect: DOMRect;
  } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const [loading, setLoading] = useState(false);

  const close = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setPopup(null);
  }, []);

  const open = useCallback(async () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();

    // Close any other open popup
    if (globalClosePopup && globalClosePopup !== close) globalClosePopup();
    globalClosePopup = close;

    if (distributionList) {
      setPopup({ dl: distributionList, rect });
      return;
    }

    if (data) {
      setPopup({ contact: data, rect });
      return;
    }

    if (!email) return;

    // Fetch contact by email
    setLoading(true);
    setPopup({ contact: { email, name: undefined }, rect });
    try {
      const result = await api.searchContacts(email);
      const found = result.contacts.find((c: any) =>
        c.email?.toLowerCase() === email.toLowerCase()
      );
      if (found) {
        setPopup({
          rect,
          contact: {
            email: found.email,
            name: found.display_name || `${found.first_name || ''} ${found.last_name || ''}`.trim() || found.email,
            company: found.company,
            jobTitle: found.job_title,
            phone: found.phone,
            mobile: found.mobile,
            avatarUrl: found.avatar_url,
          },
        });
      }
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }, [email, data, distributionList, close]);

  const handleMouseEnter = () => {
    timerRef.current = setTimeout(open, delay);
  };

  const handleMouseLeave = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    // Keep popup open if mouse moved to it
  };

  // Clean up on unmount
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (globalClosePopup === close) globalClosePopup = null;
  }, [close]);

  return (
    <>
      <span
        ref={triggerRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className="cursor-default"
      >
        {children}
      </span>
      {popup && createPortal(
        <PopupCard
          contact={popup.contact}
          dl={popup.dl}
          rect={popup.rect}
          loading={loading}
          onClose={close}
        />,
        document.body
      )}
    </>
  );
}

// ── Popup card ───────────────────────────────────────────────────────────────
function PopupCard({ contact, dl, rect, loading, onClose }: {
  contact?: PopupContact;
  dl?: PopupDL;
  rect: DOMRect;
  loading: boolean;
  onClose: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const CARD_H = dl ? 240 : 160;
  const CARD_W = 280;

  // Position: below or above trigger
  const top = rect.bottom + window.scrollY + 8;
  const left = Math.min(
    rect.left + window.scrollX,
    window.innerWidth - CARD_W - 12
  );
  const flipUp = rect.bottom + CARD_H + 12 > window.innerHeight;
  const finalTop = flipUp
    ? rect.top + window.scrollY - CARD_H - 8
    : top;

  // Close when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div
      ref={cardRef}
      onMouseLeave={onClose}
      style={{ top: finalTop, left, width: CARD_W, zIndex: 9999 }}
      className="fixed bg-white border border-outlook-border rounded-lg shadow-2xl overflow-hidden"
      onMouseDown={e => e.stopPropagation()}
    >
      {dl ? <DLCard dl={dl} /> : <ContactCard contact={contact} loading={loading} />}
    </div>
  );
}

// ── Contact card body ────────────────────────────────────────────────────────
function ContactCard({ contact, loading }: { contact?: PopupContact; loading: boolean }) {
  const displayName = contact?.name || contact?.email || '…';
  const initials = displayName.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';

  return (
    <div className="p-4">
      <div className="flex items-center gap-3 mb-3">
        {contact?.avatarUrl ? (
          <img src={contact.avatarUrl} className="w-10 h-10 rounded-full object-cover flex-shrink-0" alt="" />
        ) : (
          <div className="w-10 h-10 rounded-full bg-outlook-blue flex items-center justify-center text-white text-sm font-semibold flex-shrink-0">
            {initials}
          </div>
        )}
        <div className="min-w-0">
          <div className="font-semibold text-outlook-text-primary truncate text-sm">{displayName}</div>
          {contact?.jobTitle && (
            <div className="text-xs text-outlook-text-secondary truncate">{contact.jobTitle}</div>
          )}
        </div>
      </div>
      {loading && <div className="text-xs text-outlook-text-disabled">Chargement…</div>}
      <div className="space-y-1.5">
        {contact?.email && (
          <div className="flex items-center gap-2 text-xs text-outlook-text-secondary">
            <Mail size={11} className="flex-shrink-0 text-outlook-text-disabled" />
            <a href={`mailto:${contact.email}`} className="text-outlook-blue hover:underline truncate">{contact.email}</a>
          </div>
        )}
        {contact?.company && (
          <div className="flex items-center gap-2 text-xs text-outlook-text-secondary">
            <Building size={11} className="flex-shrink-0 text-outlook-text-disabled" />
            <span className="truncate">{contact.company}</span>
          </div>
        )}
        {(contact?.phone || contact?.mobile) && (
          <div className="flex items-center gap-2 text-xs text-outlook-text-secondary">
            <Phone size={11} className="flex-shrink-0 text-outlook-text-disabled" />
            <span className="truncate">{contact.phone || contact.mobile}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Distribution list card body ──────────────────────────────────────────────
function DLCard({ dl }: { dl: PopupDL }) {
  return (
    <div className="p-4">
      <div className="flex items-center gap-2.5 mb-2">
        <div className="w-9 h-9 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0">
          <BookOpen size={16} className="text-purple-600" />
        </div>
        <div className="min-w-0">
          <div className="font-semibold text-outlook-text-primary text-sm truncate">{dl.name}</div>
          <div className="text-xs text-purple-600">{dl.members.length} membre{dl.members.length !== 1 ? 's' : ''}</div>
        </div>
      </div>
      {dl.description && (
        <p className="text-xs text-outlook-text-secondary mb-2 truncate">{dl.description}</p>
      )}
      <div className="space-y-1 max-h-28 overflow-y-auto">
        {dl.members.map((m, i) => (
          <div key={i} className="flex items-center gap-1.5 text-xs">
            <User size={10} className="text-outlook-text-disabled flex-shrink-0" />
            <span className="text-outlook-text-primary truncate">{m.name || m.email}</span>
            {m.name && <span className="text-outlook-text-disabled truncate">&lt;{m.email}&gt;</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
