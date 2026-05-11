import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Mail, Phone, Building, Briefcase, BookOpen, User, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api';

interface PopupContact {
  id?: string;
  email?: string;
  name?: string;
  company?: string;
  jobTitle?: string;
  phone?: string;
  mobile?: string;
  avatarUrl?: string;
  avatarData?: string;
}

interface PopupDL {
  id?: string;
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
  /** Delay in ms before popup appears (default 450). */
  delay?: number;
}

// ── Global popup singleton ──────────────────────────────────────────────────
let globalClosePopup: (() => void) | null = null;

// ── Main wrapper ────────────────────────────────────────────────────────────
export function HoverCard({ children, email, data, distributionList, delay = 450 }: HoverCardProps) {
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
    setLoading(false);
  }, []);

  const open = useCallback(async () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();

    if (globalClosePopup && globalClosePopup !== close) globalClosePopup();
    globalClosePopup = close;

    if (distributionList) {
      setPopup({ dl: distributionList, rect });
      return;
    }

    if (data?.id) {
      // Pre-filled data with ID → show immediately, fetch full details for avatar
      setPopup({ contact: data, rect });
      try {
        const full = await api.getContact(data.id);
        setPopup({
          rect,
          contact: {
            id: full.id,
            email: full.email,
            name: full.display_name || `${full.first_name || ''} ${full.last_name || ''}`.trim() || full.email,
            company: full.company,
            jobTitle: full.job_title,
            phone: full.phone,
            mobile: full.mobile,
            avatarUrl: full.avatar_url,
            avatarData: full.avatar_data,
          },
        });
      } catch { /* keep pre-filled data */ }
      return;
    }

    if (data) {
      setPopup({ contact: data, rect });
    }

    if (!email) return;

    // Lookup by email
    setLoading(true);
    try {
      const result = await api.searchContacts(email);
      const found = result.contacts.find((c: any) =>
        c.email?.toLowerCase() === email.toLowerCase()
      );
      if (found) {
        // Fetch full contact for avatar_data
        let full: any = found;
        try { full = await api.getContact(found.id); } catch { /* use search result */ }
        setPopup({
          rect,
          contact: {
            id: full.id,
            email: full.email,
            name: full.display_name || `${full.first_name || ''} ${full.last_name || ''}`.trim() || full.email,
            company: full.company,
            jobTitle: full.job_title,
            phone: full.phone,
            mobile: full.mobile,
            avatarUrl: full.avatar_url,
            avatarData: full.avatar_data,
          },
        });
      } else {
        // Not in contacts — show minimal card with just the email
        setPopup({ rect, contact: { email, name: data?.name } });
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
  };

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
  const CARD_W = 290;

  const left = Math.min(
    rect.left + window.scrollX,
    window.innerWidth - CARD_W - 12
  );
  const below = rect.bottom + 8;
  const above = rect.top + window.scrollY - 8;
  const flipUp = rect.bottom + 200 > window.innerHeight;
  const finalTop = flipUp ? above : below + window.scrollY;

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
      style={{ top: finalTop, left, width: CARD_W, zIndex: 9999, transform: flipUp ? 'translateY(-100%)' : undefined }}
      className="fixed bg-white dark:bg-gray-800 border border-outlook-border rounded-xl shadow-2xl overflow-hidden"
      onMouseDown={e => e.stopPropagation()}
    >
      {dl
        ? <DLCard dl={dl} onClose={onClose} />
        : <ContactCard contact={contact} loading={loading} onClose={onClose} />
      }
    </div>
  );
}

// ── Avatar helper ─────────────────────────────────────────────────────────────
function Avatar({ contact }: { contact?: PopupContact }) {
  const src = contact?.avatarData
    ? (contact.avatarData.startsWith('data:') ? contact.avatarData : `data:image/jpeg;base64,${contact.avatarData}`)
    : contact?.avatarUrl || null;
  const displayName = contact?.name || contact?.email || '?';
  const initials = displayName.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';

  if (src) {
    return (
      <img
        src={src}
        className="w-11 h-11 rounded-full object-cover flex-shrink-0 ring-2 ring-white shadow"
        alt={displayName}
        onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
      />
    );
  }
  return (
    <div
      className="w-11 h-11 rounded-full flex items-center justify-center text-white text-sm font-semibold flex-shrink-0 ring-2 ring-white shadow"
      style={{ background: stringToColor(displayName) }}
    >
      {initials}
    </div>
  );
}

function stringToColor(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  return `hsl(${hue},55%,45%)`;
}

// ── Contact card body ─────────────────────────────────────────────────────────
function ContactCard({ contact, loading, onClose }: {
  contact?: PopupContact; loading: boolean; onClose: () => void;
}) {
  const navigate = useNavigate();
  const displayName = contact?.name || contact?.email || '…';

  const goToContact = () => {
    onClose();
    navigate('/contacts', { state: { contactId: contact?.id } });
  };

  return (
    <div className="p-4">
      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        <Avatar contact={contact} />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-outlook-text-primary text-sm leading-tight truncate">
            {displayName}
          </div>
          {contact?.jobTitle && (
            <div className="text-xs text-outlook-text-secondary truncate mt-0.5">{contact.jobTitle}</div>
          )}
          {contact?.company && (
            <div className="text-xs text-outlook-text-disabled flex items-center gap-1 mt-0.5 truncate">
              <Building size={10} className="flex-shrink-0" />{contact.company}
            </div>
          )}
        </div>
        {contact?.id && (
          <button
            onMouseDown={e => { e.preventDefault(); goToContact(); }}
            title="Ouvrir la fiche contact"
            className="flex-shrink-0 p-1 rounded hover:bg-outlook-bg-hover text-outlook-text-disabled hover:text-outlook-blue transition-colors"
          >
            <ExternalLink size={13} />
          </button>
        )}
      </div>

      {loading && <div className="text-xs text-outlook-text-disabled mb-2 animate-pulse">Chargement…</div>}

      {/* Details */}
      <div className="space-y-1.5 border-t border-outlook-border pt-2.5">
        {contact?.email && (
          <div className="flex items-center gap-2 text-xs">
            <Mail size={11} className="flex-shrink-0 text-outlook-text-disabled" />
            <a
              href={`mailto:${contact.email}`}
              className="text-outlook-blue hover:underline truncate"
              onMouseDown={e => e.stopPropagation()}
            >
              {contact.email}
            </a>
          </div>
        )}
        {contact?.phone && (
          <div className="flex items-center gap-2 text-xs text-outlook-text-secondary">
            <Phone size={11} className="flex-shrink-0 text-outlook-text-disabled" />
            <span className="truncate">{contact.phone}</span>
          </div>
        )}
        {contact?.mobile && contact.mobile !== contact.phone && (
          <div className="flex items-center gap-2 text-xs text-outlook-text-secondary">
            <Phone size={11} className="flex-shrink-0 text-outlook-text-disabled" />
            <span className="truncate">{contact.mobile}</span>
          </div>
        )}
        {!contact?.id && !loading && (
          <div className="text-xs text-outlook-text-disabled italic">Contact non enregistré</div>
        )}
      </div>

    </div>
  );
}

// ── Distribution list card body ───────────────────────────────────────────────
function DLCard({ dl, onClose }: { dl: PopupDL; onClose: () => void }) {
  const navigate = useNavigate();

  const goToList = () => {
    onClose();
    navigate('/contacts', { state: { dlId: dl.id } });
  };

  return (
    <div className="p-4">
      {/* Header */}
      <div className="flex items-start gap-2.5 mb-2">
        <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0">
          <BookOpen size={17} className="text-purple-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-outlook-text-primary text-sm truncate">{dl.name}</div>
          <div className="text-xs text-purple-600">{dl.members.length} membre{dl.members.length !== 1 ? 's' : ''}</div>
        </div>
        {dl.id && (
          <button
            onMouseDown={e => { e.preventDefault(); goToList(); }}
            title="Ouvrir la liste"
            className="flex-shrink-0 p-1 rounded hover:bg-outlook-bg-hover text-outlook-text-disabled hover:text-purple-600 transition-colors"
          >
            <ExternalLink size={13} />
          </button>
        )}
      </div>

      {dl.description && (
        <p className="text-xs text-outlook-text-secondary mb-2 truncate">{dl.description}</p>
      )}

      {/* Members list */}
      <div className="space-y-1 max-h-32 overflow-y-auto border-t border-outlook-border pt-2">
        {dl.members.length === 0 ? (
          <div className="text-xs text-outlook-text-disabled italic">Aucun membre</div>
        ) : dl.members.map((m, i) => (
          <div key={i} className="flex items-center gap-1.5 text-xs min-w-0">
            <User size={10} className="text-outlook-text-disabled flex-shrink-0" />
            <span className="text-outlook-text-primary font-medium truncate">{m.name || m.email}</span>
            {m.name && <span className="text-outlook-text-disabled truncate">&lt;{m.email}&gt;</span>}
          </div>
        ))}
      </div>

    </div>
  );
}
