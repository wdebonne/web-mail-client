import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Share2, Trash2, Link2, Copy, Globe, X, Mail, Users, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../api';
import type { Calendar } from '../../types';

type SharePermission = 'busy' | 'titles' | 'read' | 'write';

const PERMISSION_OPTIONS: { value: SharePermission; label: string; hint: string }[] = [
  { value: 'busy', label: 'Peut voir lorsque je suis occupé(e)', hint: 'Seule la disponibilité est partagée.' },
  { value: 'titles', label: 'Peut afficher les titres et les lieux', hint: 'Pas le contenu détaillé.' },
  { value: 'read', label: 'Peut afficher tous les détails', hint: 'Lecture seule, tous les champs visibles.' },
  { value: 'write', label: 'Peut modifier', hint: 'Lecture et écriture.' },
];

const normalizePerm = (raw?: string | null): SharePermission => {
  if (raw === 'write' || raw === 'edit' || raw === 'read-write') return 'write';
  if (raw === 'titles' || raw === 'titles_locations') return 'titles';
  if (raw === 'busy' || raw === 'free_busy') return 'busy';
  return 'read';
};

type Tab = 'internal' | 'email' | 'public';

export default function ShareCalendarDialog({
  calendar,
  onClose,
}: {
  calendar: Calendar;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('internal');

  // ── Shared state ────────────────────────────────────────────────────────
  const { data: shares, refetch } = useQuery({
    queryKey: ['calendar-shares', calendar.id],
    queryFn: () => api.listCalendarShares(calendar.id),
  });

  const shareMutation = useMutation({
    mutationFn: (payload: { userId?: string; email?: string; permission: SharePermission }) =>
      api.shareCalendar(calendar.id, payload),
    onSuccess: () => {
      toast.success('Partage enregistré');
      refetch();
      queryClient.invalidateQueries({ queryKey: ['calendars'] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const revokeMutation = useMutation({
    mutationFn: (payload: { userId?: string; email?: string }) => api.revokeShareCalendar(calendar.id, payload),
    onSuccess: () => { toast.success('Partage révoqué'); refetch(); },
    onError: (e: any) => toast.error(e.message),
  });

  const publishMutation = useMutation({
    mutationFn: () => api.publishCalendar(calendar.id),
    onSuccess: (r: any) => {
      toast.success('Lien public créé');
      if (r?.publicUrl) navigator.clipboard?.writeText(r.publicUrl).catch(() => {});
      refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const unpublishMutation = useMutation({
    mutationFn: () => api.unpublishCalendar(calendar.id),
    onSuccess: () => { toast.success('Lien public supprimé'); refetch(); },
    onError: (e: any) => toast.error(e.message),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const publicLink = shares?.external?.find((s: any) => s.share_type === 'public_link');
  const ncManaged = Boolean((calendar as any).nc_managed);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-[640px] max-w-[96vw]" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-outlook-border">
          <div>
            <h3 className="font-semibold flex items-center gap-2">
              <Share2 size={18} className="text-outlook-blue" />
              Partage et autorisations
            </h3>
            <div className="text-xs text-outlook-text-secondary mt-0.5 truncate max-w-[520px]">{calendar.name}</div>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded"><X size={16} /></button>
        </div>

        {/* Tabs */}
        <div className="px-5 pt-3 border-b border-outlook-border flex gap-1">
          <TabButton active={tab === 'internal'} onClick={() => setTab('internal')} icon={<Users size={14} />}>
            Au sein de votre organisation
          </TabButton>
          <TabButton active={tab === 'email'} onClick={() => setTab('email')} icon={<Mail size={14} />}>
            Invitations par email
          </TabButton>
          <TabButton active={tab === 'public'} onClick={() => setTab('public')} icon={<Globe size={14} />}>
            Lien public
          </TabButton>
        </div>

        <div className="p-5 max-h-[70vh] overflow-y-auto">
          {tab === 'internal' && (
            <InternalTab
              calendar={calendar}
              shares={shares}
              ncManaged={ncManaged}
              onShare={(userId, permission) => shareMutation.mutate({ userId, permission })}
              onUpdate={(userId, permission) => shareMutation.mutate({ userId, permission })}
              onRevoke={(userId) => revokeMutation.mutate({ userId })}
              isSharing={shareMutation.isPending}
            />
          )}

          {tab === 'email' && (
            <EmailTab
              shares={shares}
              ncManaged={ncManaged}
              onShare={(email, permission) => shareMutation.mutate({ email, permission })}
              onUpdate={(email, permission) => shareMutation.mutate({ email, permission })}
              onRevoke={(email) => revokeMutation.mutate({ email })}
              isSharing={shareMutation.isPending}
            />
          )}

          {tab === 'public' && (
            <PublicTab
              ncManaged={ncManaged}
              publicLink={publicLink}
              onPublish={() => publishMutation.mutate()}
              onUnpublish={() => unpublishMutation.mutate()}
              isPublishing={publishMutation.isPending}
            />
          )}
        </div>

        <div className="px-5 py-3 border-t border-outlook-border flex justify-end">
          <button onClick={onClose} className="px-4 py-1.5 text-sm rounded hover:bg-gray-100">Fermer</button>
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active, onClick, icon, children,
}: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 text-sm font-medium flex items-center gap-1.5 border-b-2 transition-colors ${
        active
          ? 'border-outlook-blue text-outlook-blue'
          : 'border-transparent text-outlook-text-secondary hover:text-outlook-text-primary'
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

// ── Permission dropdown ────────────────────────────────────────────────────
function PermissionSelect({
  value, onChange, small,
}: { value: SharePermission; onChange: (v: SharePermission) => void; small?: boolean }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as SharePermission)}
      title={PERMISSION_OPTIONS.find(o => o.value === value)?.hint}
      className={`border border-outlook-border rounded-md bg-white text-outlook-text-primary ${small ? 'px-2 py-1 text-xs' : 'px-2 py-2 text-sm'}`}
    >
      {PERMISSION_OPTIONS.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

// ── Internal tab ───────────────────────────────────────────────────────────
function InternalTab({
  calendar, shares, ncManaged, onShare, onUpdate, onRevoke, isSharing,
}: {
  calendar: Calendar;
  shares: any;
  ncManaged: boolean;
  onShare: (userId: string, permission: SharePermission) => void;
  onUpdate: (userId: string, permission: SharePermission) => void;
  onRevoke: (userId: string) => void;
  isSharing: boolean;
}) {
  const [search, setSearch] = useState('');
  const [permission, setPermission] = useState<SharePermission>('read');

  const { data: users = [] } = useQuery({
    queryKey: ['org-users', search],
    queryFn: () => api.listDirectoryUsers(search || undefined),
  });

  const internalShares = (shares?.internal || []) as any[];
  const sharedUserIds = new Set(internalShares.map((s: any) => s.user_id));

  const candidates = useMemo(
    () => users.filter((u: any) => !sharedUserIds.has(u.id)),
    [users, sharedUserIds]
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-outlook-text-secondary">
        Invitez d'autres membres de votre organisation à accéder à « {calendar.name} ».
      </p>

      {/* Search + add */}
      <div className="space-y-2">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-outlook-text-disabled" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un utilisateur…"
            className="w-full border border-outlook-border rounded-md pl-8 pr-3 py-2 text-sm"
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <PermissionSelect value={permission} onChange={setPermission} />
        </div>
        <div className="border border-outlook-border rounded max-h-64 overflow-y-auto divide-y">
          {candidates.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-outlook-text-secondary">
              {search ? 'Aucun utilisateur trouvé' : 'Aucun autre utilisateur disponible'}
            </div>
          ) : candidates.map((u: any) => (
            <button
              key={u.id}
              disabled={isSharing}
              onClick={() => onShare(u.id, permission)}
              className="w-full px-3 py-2 flex items-center gap-3 text-sm text-left hover:bg-outlook-bg-hover/40 disabled:opacity-50"
            >
              <Avatar email={u.email} name={u.display_name} url={u.avatar_url} />
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{u.display_name || u.email}</div>
                <div className="text-xs text-outlook-text-secondary truncate">{u.email}</div>
              </div>
              <span className="text-xs text-outlook-blue">Ajouter</span>
            </button>
          ))}
        </div>
      </div>

      {/* Existing internal shares */}
      <div>
        <h4 className="text-xs font-semibold text-outlook-text-secondary mb-2">PARTAGES ACTIFS</h4>
        <div className="border border-outlook-border rounded divide-y">
          {internalShares.length === 0 && (
            <div className="px-3 py-4 text-center text-xs text-outlook-text-secondary">Aucun partage interne</div>
          )}
          {internalShares.map((s: any) => (
            <div key={s.user_id} className="px-3 py-2 flex items-center gap-2 text-sm">
              <Avatar email={s.email} name={s.display_name} />
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{s.display_name || s.email}</div>
                <div className="text-xs text-outlook-text-secondary truncate">{s.email}</div>
              </div>
              <PermissionSelect
                small
                value={normalizePerm(s.permission)}
                onChange={(v) => onUpdate(s.user_id, v)}
              />
              <button
                onClick={() => onRevoke(s.user_id)}
                className="p-1.5 hover:bg-red-50 rounded text-red-600"
                title="Révoquer"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {!ncManaged && (
        <p className="text-[11px] text-amber-600">
          Ce calendrier n'est pas sur NextCloud : le partage reste interne à l'application.
        </p>
      )}
    </div>
  );
}

// ── Email tab ──────────────────────────────────────────────────────────────
function EmailTab({
  shares, ncManaged, onShare, onUpdate, onRevoke, isSharing,
}: {
  shares: any;
  ncManaged: boolean;
  onShare: (email: string, permission: SharePermission) => void;
  onUpdate: (email: string, permission: SharePermission) => void;
  onRevoke: (email: string) => void;
  isSharing: boolean;
}) {
  const [input, setInput] = useState('');
  const [permission, setPermission] = useState<SharePermission>('read');
  const [openList, setOpenList] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const { data: autoData } = useQuery({
    queryKey: ['share-contact-ac', input],
    queryFn: () => api.searchContacts(input),
    enabled: input.length >= 2,
    staleTime: 30_000,
  });

  const autoSuggestions = useMemo(() => {
    const list = (autoData?.contacts || []) as any[];
    return list.filter((c: any) => !!c.email);
  }, [autoData]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpenList(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const externalEmailShares = ((shares?.external as any[]) || []).filter((s: any) => s.share_type === 'email');

  const submit = (email: string) => {
    const clean = email.trim().toLowerCase();
    if (!clean || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
      toast.error('Adresse email invalide');
      return;
    }
    onShare(clean, permission);
    setInput('');
    setOpenList(false);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-outlook-text-secondary">
        Envoyer une invitation par email. Les adresses inconnues seront automatiquement ajoutées à vos contacts.
      </p>

      <div ref={wrapRef} className="relative">
        <div className="flex items-center gap-2">
          <div className="flex-1 relative">
            <input
              type="text"
              value={input}
              onChange={(e) => { setInput(e.target.value); setOpenList(true); }}
              onFocus={() => setOpenList(true)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(input); } }}
              placeholder="Entrez une adresse ou le nom d'un contact"
              className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm"
            />
            {openList && autoSuggestions.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-outlook-border rounded-md shadow-lg z-10 max-h-64 overflow-y-auto">
                {autoSuggestions.map((c: any) => (
                  <button
                    key={c.id}
                    onClick={() => submit(c.email)}
                    className="w-full px-3 py-2 flex items-center gap-2 text-left text-sm hover:bg-outlook-bg-hover/40"
                  >
                    <Avatar email={c.email} name={c.display_name} />
                    <div className="flex-1 min-w-0">
                      <div className="truncate">{c.display_name || `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.email}</div>
                      <div className="text-xs text-outlook-text-secondary truncate">{c.email}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <PermissionSelect value={permission} onChange={setPermission} />
          <button
            onClick={() => submit(input)}
            disabled={!input || isSharing}
            className="bg-outlook-blue hover:bg-outlook-blue-hover text-white px-4 py-2 rounded-md text-sm disabled:opacity-50"
          >
            Partager
          </button>
        </div>
      </div>

      {/* Existing email shares */}
      <div>
        <h4 className="text-xs font-semibold text-outlook-text-secondary mb-2">INVITATIONS ENVOYÉES</h4>
        <div className="border border-outlook-border rounded divide-y">
          {externalEmailShares.length === 0 && (
            <div className="px-3 py-4 text-center text-xs text-outlook-text-secondary">Aucune invitation par email</div>
          )}
          {externalEmailShares.map((s: any) => (
            <div key={s.id} className="px-3 py-2 flex items-center gap-2 text-sm">
              <Avatar email={s.recipient_email} />
              <div className="flex-1 min-w-0 truncate">{s.recipient_email}</div>
              <PermissionSelect
                small
                value={normalizePerm(s.permission)}
                onChange={(v) => onUpdate(s.recipient_email, v)}
              />
              <button
                onClick={() => onRevoke(s.recipient_email)}
                className="p-1.5 hover:bg-red-50 rounded text-red-600"
                title="Révoquer"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {!ncManaged && (
        <p className="text-[11px] text-amber-600">
          Ce calendrier n'est pas sur NextCloud : l'invitation sera enregistrée mais aucun email ne sera envoyé.
        </p>
      )}
    </div>
  );
}

// ── Public link tab ────────────────────────────────────────────────────────
function PublicTab({
  ncManaged, publicLink, onPublish, onUnpublish, isPublishing,
}: {
  ncManaged: boolean;
  publicLink: any;
  onPublish: () => void;
  onUnpublish: () => void;
  isPublishing: boolean;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-outlook-text-secondary">
        Publiez ce calendrier via un lien accessible publiquement en lecture seule. Utile pour l'intégrer dans
        un site ou l'envoyer à une personne sans compte NextCloud.
      </p>

      {publicLink ? (
        <div className="border border-outlook-border rounded p-3 flex items-center gap-2">
          <Link2 size={14} className="text-outlook-blue" />
          <input
            type="text"
            readOnly
            value={publicLink.public_url || ''}
            className="flex-1 text-xs bg-gray-50 border border-outlook-border rounded px-2 py-1 font-mono"
          />
          <button
            onClick={() => { navigator.clipboard?.writeText(publicLink.public_url || ''); toast.success('Lien copié'); }}
            className="p-1.5 hover:bg-gray-100 rounded" title="Copier"
          ><Copy size={14} /></button>
          <button
            onClick={() => confirm('Supprimer le lien public ?') && onUnpublish()}
            className="p-1.5 hover:bg-red-50 rounded text-red-600" title="Supprimer"
          ><Trash2 size={14} /></button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2 border border-dashed border-outlook-border rounded p-4">
          <span className="text-xs text-outlook-text-secondary">
            {ncManaged
              ? 'Aucun lien public actif.'
              : 'Disponible uniquement pour les calendriers NextCloud.'}
          </span>
          <button
            onClick={onPublish}
            disabled={!ncManaged || isPublishing}
            className="bg-outlook-blue hover:bg-outlook-blue-hover text-white px-3 py-1.5 rounded-md text-xs disabled:opacity-50"
          >
            {isPublishing ? 'Publication…' : 'Publier'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Avatar helper ──────────────────────────────────────────────────────────
function Avatar({ email, name, url }: { email?: string | null; name?: string | null; url?: string | null }) {
  const initials = ((name || email || '?')
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(s => s[0]?.toUpperCase())
    .join('')) || '?';
  if (url) {
    return <img src={url} alt="" className="w-7 h-7 rounded-full object-cover flex-shrink-0" />;
  }
  return (
    <div className="w-7 h-7 rounded-full bg-outlook-blue/15 text-outlook-blue text-xs font-semibold flex items-center justify-center flex-shrink-0">
      {initials}
    </div>
  );
}
