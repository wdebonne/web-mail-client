import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { Contact, ContactGroup } from '../types';
import {
  Search, Plus, X, Mail, Phone, Building, Edit2, Trash2,
  Users, User, UserCheck, UserX, Star, Upload, Download,
  Camera, Globe, Calendar as CalIcon, MapPin, Briefcase, FileText,
  Loader2, ChevronDown, ChevronLeft, SortAsc, CheckCircle2, AlertCircle, Cloud,
  Palette, Image as ImageIcon, Move, Maximize2, Minimize2,
  BookOpen, Share2, AtSign, RotateCcw, Shield,
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import toast from 'react-hot-toast';
import {
  parseContactsFile, generateVCard, generateContactsCSV,
  downloadFile, ImportedContact, CsvFormat,
} from '../utils/contactImportExport';

const SENDER_GROUP_ID = '__senders__';
const FAV_GROUP_ID = '__favorites__';
const LOCAL_GROUP_ID = '__registered__';
const NEXTCLOUD_GROUP_ID = '__nextcloud__';
const DIST_LIST_GROUP_ID = '__distribution_lists__';

// Palette de couleurs déterministes pour les avatars
const AVATAR_COLORS = [
  'from-blue-400 to-blue-600',
  'from-emerald-400 to-emerald-600',
  'from-purple-400 to-purple-600',
  'from-pink-400 to-pink-600',
  'from-amber-400 to-amber-600',
  'from-cyan-400 to-cyan-600',
  'from-rose-400 to-rose-600',
  'from-indigo-400 to-indigo-600',
  'from-teal-400 to-teal-600',
  'from-orange-400 to-orange-600',
];

// Couleurs prédéfinies pour la bannière personnalisée (classes Tailwind gradient)
const BANNER_PRESETS: { id: string; label: string; gradient: string }[] = [
  { id: 'auto', label: 'Auto', gradient: '' },
  { id: 'blue', label: 'Bleu', gradient: 'from-blue-400 to-blue-600' },
  { id: 'emerald', label: 'Vert', gradient: 'from-emerald-400 to-emerald-600' },
  { id: 'purple', label: 'Violet', gradient: 'from-purple-400 to-purple-600' },
  { id: 'pink', label: 'Rose', gradient: 'from-pink-400 to-pink-600' },
  { id: 'amber', label: 'Ambre', gradient: 'from-amber-400 to-amber-600' },
  { id: 'cyan', label: 'Cyan', gradient: 'from-cyan-400 to-cyan-600' },
  { id: 'rose', label: 'Corail', gradient: 'from-rose-400 to-rose-600' },
  { id: 'indigo', label: 'Indigo', gradient: 'from-indigo-400 to-indigo-600' },
  { id: 'teal', label: 'Turquoise', gradient: 'from-teal-400 to-teal-600' },
  { id: 'orange', label: 'Orange', gradient: 'from-orange-400 to-orange-600' },
  { id: 'slate', label: 'Ardoise', gradient: 'from-slate-500 to-slate-700' },
  { id: 'sunset', label: 'Coucher de soleil', gradient: 'from-orange-400 via-red-400 to-pink-500' },
  { id: 'ocean', label: 'Océan', gradient: 'from-cyan-400 via-blue-500 to-indigo-600' },
  { id: 'forest', label: 'Forêt', gradient: 'from-green-400 via-emerald-500 to-teal-600' },
];

function bannerGradient(bannerColor: string | undefined, fallbackSeed: string): string {
  if (bannerColor && bannerColor !== 'auto') {
    const preset = BANNER_PRESETS.find(p => p.id === bannerColor);
    if (preset && preset.gradient) return preset.gradient;
  }
  return avatarColor(fallbackSeed);
}

type BannerFit = 'cover' | 'contain' | 'fill';

function bannerImageStyle(
  image: string | undefined,
  fit: BannerFit = 'cover',
  posX: number = 50,
  posY: number = 50
): React.CSSProperties | undefined {
  if (!image) return undefined;
  const sizeMap: Record<BannerFit, string> = {
    cover: 'cover',
    contain: 'contain',
    fill: '100% 100%',
  };
  return {
    backgroundImage: `url(${image})`,
    backgroundSize: sizeMap[fit],
    backgroundPosition: `${posX}% ${posY}%`,
    backgroundRepeat: 'no-repeat',
    backgroundColor: '#1f2937',
  };
}

function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function getInitials(c: Contact): string {
  if (c.first_name && c.last_name) return (c.first_name[0] + c.last_name[0]).toUpperCase();
  const base = c.display_name || c.email || '?';
  const parts = base.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return base.substring(0, 2).toUpperCase();
}

function getFullName(c: Contact): string {
  return c.display_name || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email || '';
}

type SortBy = 'name' | 'recent' | 'company';

export default function ContactsPage() {
  const queryClient = useQueryClient();
  const currentUser = useAuthStore(s => s.user);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<string | undefined>();
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>('name');

  // Distribution list state
  const isDistListView = selectedGroup === DIST_LIST_GROUP_ID;
  const [selectedDistListId, setSelectedDistListId] = useState<string | null>(null);
  const [showDLForm, setShowDLForm] = useState(false);
  const [editingDL, setEditingDL] = useState<any>(null);
  const [showShareDialog, setShowShareDialog] = useState<any>(null);

  // Resizable sidebar
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const stored = parseInt(localStorage.getItem('contacts-sidebar-width') || '0', 10);
    return stored >= 240 && stored <= 600 ? stored : 320;
  });
  const resizing = useRef(false);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizing.current) return;
      const w = Math.min(600, Math.max(240, e.clientX));
      setSidebarWidth(w);
    };
    const onUp = () => {
      if (resizing.current) {
        resizing.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        localStorage.setItem('contacts-sidebar-width', String(sidebarWidth));
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [sidebarWidth]);

  const isSenderView = selectedGroup === SENDER_GROUP_ID;
  const isFavView = selectedGroup === FAV_GROUP_ID;
  const isLocalView = selectedGroup === LOCAL_GROUP_ID;
  const isNextcloudView = selectedGroup === NEXTCLOUD_GROUP_ID;
  const isVirtualView = isSenderView || isFavView || isLocalView || isNextcloudView || isDistListView;

  const sourceFilter = isSenderView ? 'sender'
    : isLocalView ? 'local'
      : isNextcloudView ? 'nextcloud'
        : undefined;

  const { data: contactsData, isLoading } = useQuery({
    queryKey: ['contacts', searchQuery, selectedGroup],
    queryFn: () => api.getContacts({
      search: searchQuery || undefined,
      groupId: isVirtualView ? undefined : selectedGroup,
      source: sourceFilter,
      limit: 500,
    }),
    enabled: !isDistListView,
  });

  const { data: sendersCount } = useQuery({
    queryKey: ['contacts-senders-count'],
    queryFn: () => api.getContacts({ source: 'sender', limit: 1 }),
    staleTime: 60000,
  });

  const { data: allContactsForStats } = useQuery({
    queryKey: ['contacts-all-stats'],
    queryFn: () => api.getContacts({ limit: 500 }),
    staleTime: 60000,
  });

  const { data: groups = [] } = useQuery({
    queryKey: ['contactGroups'],
    queryFn: api.getContactGroups,
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteContact,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      setSelectedContactId(null);
      toast.success('Contact supprimé');
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => editingContact ? api.updateContact(editingContact.id, data) : api.createContact(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      setShowForm(false);
      setEditingContact(null);
      toast.success(editingContact ? 'Contact mis à jour' : 'Contact créé');
    },
    onError: (e: any) => toast.error(e.message || 'Erreur lors de l\'enregistrement'),
  });

  const promoteMutation = useMutation({
    mutationFn: (id: string) => api.promoteContact(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      queryClient.invalidateQueries({ queryKey: ['contacts-senders-count'] });
      toast.success('Contact enregistré comme permanent');
    },
  });

  const favoriteMutation = useMutation({
    mutationFn: ({ id, isFavorite }: { id: string; isFavorite: boolean }) =>
      api.updateContact(id, { isFavorite }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['contacts'] }),
  });

  const importMutation = useMutation({
    mutationFn: ({ contacts, mode }: { contacts: ImportedContact[]; mode: 'merge' | 'skip' | 'replace' }) =>
      api.importContacts(contacts, mode),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      queryClient.invalidateQueries({ queryKey: ['contacts-senders-count'] });
      toast.success(`Import terminé : ${r.imported} créés, ${r.updated} mis à jour, ${r.skipped} ignorés`);
      setShowImport(false);
    },
    onError: (e: any) => toast.error(e.message || 'Erreur d\'import'),
  });

  // Distribution list queries & mutations
  const { data: distributionLists = [] } = useQuery({
    queryKey: ['distributionLists'],
    queryFn: api.getDistributionLists,
    staleTime: 30000,
  });
  const selectedDistList = (distributionLists as any[]).find((dl: any) => dl.id === selectedDistListId) || null;

  const dlSaveMutation = useMutation({
    mutationFn: (data: any) => editingDL
      ? api.updateDistributionList(editingDL.id, data)
      : api.createDistributionList(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['distributionLists'] });
      setShowDLForm(false);
      setEditingDL(null);
      toast.success(editingDL ? 'Liste mise à jour' : 'Liste créée');
    },
    onError: (e: any) => toast.error(e.message || 'Erreur'),
  });
  const dlDeleteMutation = useMutation({
    mutationFn: api.deleteDistributionList,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['distributionLists'] });
      setSelectedDistListId(null);
      toast.success('Liste supprimée');
    },
    onError: (e: any) => toast.error(e.message || 'Erreur'),
  });
  const dlShareMutation = useMutation({
    mutationFn: ({ id, sharedWith }: { id: string; sharedWith: any[] }) =>
      api.shareDistributionList(id, sharedWith),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['distributionLists'] });
      toast.success('Partage mis à jour');
    },
    onError: (e: any) => toast.error(e.message || 'Erreur'),
  });

  const rawContacts = contactsData?.contacts || [];
  const selectedContact = useMemo<Contact | null>(
    () => rawContacts.find((c: Contact) => c.id === selectedContactId) || null,
    [rawContacts, selectedContactId]
  );

  // Filter locally for favorites + sort
  const contacts = useMemo(() => {
    let list = [...rawContacts];
    if (isFavView) list = list.filter((c: Contact) => c.is_favorite);
    switch (sortBy) {
      case 'recent':
        list.sort((a: any, b: any) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime());
        break;
      case 'company':
        list.sort((a: Contact, b: Contact) => (a.company || 'zzz').localeCompare(b.company || 'zzz'));
        break;
      default:
        list.sort((a: Contact, b: Contact) => {
          if (a.is_favorite !== b.is_favorite) return a.is_favorite ? -1 : 1;
          return getFullName(a).localeCompare(getFullName(b));
        });
    }
    return list;
  }, [rawContacts, isFavView, sortBy]);

  // Group contacts alphabetically
  const grouped = useMemo(() => {
    if (sortBy !== 'name') return null;
    const map = new Map<string, Contact[]>();
    for (const c of contacts) {
      const letter = (getFullName(c)[0] || '#').toUpperCase();
      const key = /[A-Z]/.test(letter) ? letter : '#';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [contacts, sortBy]);

  const totalContacts = contactsData?.total ?? 0;
  const allStats = allContactsForStats?.contacts || [];
  const favCount = allStats.filter((c: Contact) => c.is_favorite).length;
  const localCount = allStats.filter((c: Contact) => c.source === 'local' || !c.source).length;
  const nextcloudCount = allStats.filter((c: Contact) => (c as any).nc_managed === true || c.source === 'nextcloud').length;
  const hasNextcloud = nextcloudCount > 0;

  const handleExport = async (format: 'vcf' | 'csv-google' | 'csv-outlook' | 'csv-generic') => {
    setExportMenuOpen(false);
    try {
      const all = await api.getContacts({ limit: 500 });
      const list = (all.contacts || []).filter((c: Contact) => c.source !== 'sender').map((c: Contact) => ({
        firstName: c.first_name,
        lastName: c.last_name,
        displayName: c.display_name,
        email: c.email,
        phone: c.phone,
        mobile: c.mobile,
        company: c.company,
        jobTitle: c.job_title,
        department: c.department,
        notes: c.notes,
        avatarUrl: c.avatar_url,
        website: (c.metadata as any)?.website,
        birthday: (c.metadata as any)?.birthday,
        address: (c.metadata as any)?.address,
      }));
      if (!list.length) { toast.error('Aucun contact à exporter'); return; }
      const date = new Date().toISOString().slice(0, 10);
      if (format === 'vcf') {
        downloadFile(`contacts-${date}.vcf`, generateVCard(list), 'text/vcard;charset=utf-8');
      } else {
        const fmt: CsvFormat = format === 'csv-google' ? 'google' : format === 'csv-outlook' ? 'outlook' : 'generic';
        downloadFile(`contacts-${date}-${fmt}.csv`, generateContactsCSV(list, fmt), 'text/csv;charset=utf-8');
      }
      toast.success(`${list.length} contact${list.length > 1 ? 's' : ''} exporté${list.length > 1 ? 's' : ''}`);
    } catch (e: any) {
      toast.error(e.message || 'Erreur à l\'export');
    }
  };

  return (
    <div className="h-full flex bg-outlook-bg">
      {/* Left sidebar (resizable on desktop, full-width on mobile) */}
      <div
        style={{ width: typeof window !== 'undefined' && window.innerWidth >= 768 ? sidebarWidth : undefined }}
        className={`${selectedContactId ? 'hidden md:flex' : 'flex'} w-full md:w-auto border-r border-outlook-border flex-col flex-shrink-0 bg-outlook-bg-primary`}
      >
        <div className="p-3 border-b border-outlook-border space-y-2">
          {isDistListView ? (
            <button
              onClick={() => { setEditingDL(null); setShowDLForm(true); }}
              className="w-full bg-outlook-blue hover:bg-outlook-blue-hover text-white rounded-md py-2 px-4 text-sm font-medium flex items-center justify-center gap-2 shadow-sm"
            >
              <Plus size={14} /> Nouvelle liste
            </button>
          ) : (
            <button
              onClick={() => { setEditingContact(null); setShowForm(true); }}
              className="w-full bg-outlook-blue hover:bg-outlook-blue-hover text-white rounded-md py-2 px-4 text-sm font-medium flex items-center justify-center gap-2 shadow-sm"
            >
              <Plus size={14} /> Nouveau contact
            </button>
          )}
          <div className="flex gap-1.5">
            <button
              onClick={() => setShowImport(true)}
              className="flex-1 border border-outlook-border hover:bg-outlook-bg-hover rounded-md py-1.5 text-xs font-medium flex items-center justify-center gap-1.5"
              title="Importer depuis Gmail, Outlook, vCard..."
            >
              <Upload size={12} /> Importer
            </button>
            <div className="relative flex-1">
              <button
                onClick={() => setExportMenuOpen(v => !v)}
                className="w-full border border-outlook-border hover:bg-outlook-bg-hover rounded-md py-1.5 text-xs font-medium flex items-center justify-center gap-1.5"
              >
                <Download size={12} /> Exporter <ChevronDown size={10} />
              </button>
              {exportMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setExportMenuOpen(false)} />
                  <div className="absolute right-0 top-full mt-1 bg-white border border-outlook-border rounded-md shadow-lg py-1 w-52 z-50">
                    <button onClick={() => handleExport('vcf')} className="w-full text-left px-3 py-1.5 text-xs hover:bg-outlook-bg-hover">
                      <span className="font-medium">vCard (.vcf)</span>
                      <div className="text-outlook-text-disabled text-[10px]">Apple, Android, iOS</div>
                    </button>
                    <button onClick={() => handleExport('csv-google')} className="w-full text-left px-3 py-1.5 text-xs hover:bg-outlook-bg-hover">
                      <span className="font-medium">CSV Google</span>
                      <div className="text-outlook-text-disabled text-[10px]">Gmail / Google Contacts</div>
                    </button>
                    <button onClick={() => handleExport('csv-outlook')} className="w-full text-left px-3 py-1.5 text-xs hover:bg-outlook-bg-hover">
                      <span className="font-medium">CSV Outlook</span>
                      <div className="text-outlook-text-disabled text-[10px]">Outlook / Microsoft 365</div>
                    </button>
                    <button onClick={() => handleExport('csv-generic')} className="w-full text-left px-3 py-1.5 text-xs hover:bg-outlook-bg-hover">
                      <span className="font-medium">CSV générique</span>
                      <div className="text-outlook-text-disabled text-[10px]">Compatible tableur</div>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-outlook-text-disabled" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Rechercher des contacts..."
              className="w-full pl-9 pr-3 py-1.5 border border-outlook-border rounded text-sm focus:outline-none focus:border-outlook-blue"
            />
          </div>
        </div>

        {/* Categories */}
        <div className="px-2 py-2 border-b border-outlook-border overflow-y-auto max-h-[40%]">
          <NavItem
            label="Tous les contacts"
            icon={<Users size={14} />}
            count={totalContacts}
            active={!selectedGroup}
            onClick={() => setSelectedGroup(undefined)}
          />
          <NavItem
            label="Favoris"
            icon={<Star size={14} />}
            count={favCount}
            active={isFavView}
            onClick={() => { setSelectedGroup(FAV_GROUP_ID); setSelectedContactId(null); }}
            color="amber"
          />
          <NavItem
            label="Enregistrés"
            icon={<UserCheck size={14} />}
            count={localCount}
            active={isLocalView}
            onClick={() => { setSelectedGroup(LOCAL_GROUP_ID); setSelectedContactId(null); }}
            color="green"
          />
          <NavItem
            label="Expéditeurs non enregistrés"
            icon={<UserX size={14} />}
            count={sendersCount?.total ?? 0}
            active={isSenderView}
            onClick={() => { setSelectedGroup(SENDER_GROUP_ID); setSelectedContactId(null); }}
            color="orange"
          />
          {hasNextcloud && (
            <NavItem
              label="NextCloud"
              icon={<Cloud size={14} />}
              count={nextcloudCount}
              active={isNextcloudView}
              onClick={() => { setSelectedGroup(NEXTCLOUD_GROUP_ID); setSelectedContactId(null); }}
              color="blue"
            />
          )}
          <NavItem
            label="Listes de distribution"
            icon={<BookOpen size={14} />}
            count={(distributionLists as any[]).length}
            active={isDistListView}
            onClick={() => { setSelectedGroup(DIST_LIST_GROUP_ID); setSelectedContactId(null); setSelectedDistListId(null); }}
            color="purple"
          />
          {groups.length > 0 && (
            <div className="mt-2 pt-2 border-t border-outlook-border">
              <div className="px-2 text-[10px] font-semibold text-outlook-text-disabled uppercase tracking-wider mb-1">Groupes</div>
              {groups.map((g: ContactGroup) => (
                <NavItem
                  key={g.id}
                  label={g.name}
                  icon={<Users size={14} />}
                  count={g.member_count}
                  active={selectedGroup === g.id}
                  onClick={() => setSelectedGroup(g.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* List header with sort */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-outlook-border text-xs text-outlook-text-secondary">
          {isDistListView ? (
            <span>{(distributionLists as any[]).length} liste{(distributionLists as any[]).length !== 1 ? 's' : ''}</span>
          ) : (
            <>
              <span>{contacts.length} {contacts.length > 1 ? 'contacts' : 'contact'}</span>
              <div className="flex items-center gap-1">
                <SortAsc size={12} />
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortBy)}
                  className="bg-transparent border-0 text-xs focus:outline-none cursor-pointer"
                >
                  <option value="name">Nom</option>
                  <option value="recent">Récent</option>
                  <option value="company">Entreprise</option>
                </select>
              </div>
            </>
          )}
        </div>

        {/* Contact / Distribution list list */}
        <div className="flex-1 overflow-y-auto">
          {isDistListView ? (
            (distributionLists as any[]).length === 0 ? (
              <div className="text-center py-12 text-outlook-text-disabled text-sm">
                <BookOpen size={32} className="mx-auto mb-2 opacity-30" />
                <p>Aucune liste de distribution</p>
                <button
                  onClick={() => { setEditingDL(null); setShowDLForm(true); }}
                  className="mt-3 text-outlook-blue hover:underline text-xs"
                >
                  Créer une liste
                </button>
              </div>
            ) : (
              (distributionLists as any[]).map((dl: any) => (
                <DistListRow
                  key={dl.id}
                  list={dl}
                  selected={selectedDistListId === dl.id}
                  isOwner={dl.user_id === currentUser?.id}
                  onClick={() => setSelectedDistListId(dl.id)}
                />
              ))
            )
          ) : isLoading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2.5 border-b border-outlook-border">
                <div className="skeleton w-10 h-10 rounded-full" />
                <div className="flex-1">
                  <div className="skeleton h-4 w-32 rounded mb-1" />
                  <div className="skeleton h-3 w-40 rounded" />
                </div>
              </div>
            ))
          ) : contacts.length === 0 ? (
            <div className="text-center py-12 text-outlook-text-disabled text-sm">
              <Users size={32} className="mx-auto mb-2 opacity-30" />
              {searchQuery ? 'Aucun résultat' : isSenderView ? 'Aucun expéditeur à enregistrer' : 'Aucun contact'}
            </div>
          ) : grouped ? (
            grouped.map(([letter, list]) => (
              <div key={letter}>
                <div className="sticky top-0 bg-outlook-bg-tertiary text-[10px] font-semibold text-outlook-text-secondary px-3 py-1 border-b border-outlook-border uppercase z-10">
                  {letter}
                </div>
                {list.map(c => (
                  <ContactRow
                    key={c.id}
                    contact={c}
                    selected={selectedContactId === c.id}
                    onClick={() => setSelectedContactId(c.id)}
                    onFav={(val) => favoriteMutation.mutate({ id: c.id, isFavorite: val })}
                  />
                ))}
              </div>
            ))
          ) : (
            contacts.map(c => (
              <ContactRow
                key={c.id}
                contact={c}
                selected={selectedContactId === c.id}
                onClick={() => setSelectedContactId(c.id)}
                onFav={(val) => favoriteMutation.mutate({ id: c.id, isFavorite: val })}
              />
            ))
          )}
        </div>
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={(e) => {
          e.preventDefault();
          resizing.current = true;
          document.body.style.cursor = 'col-resize';
          document.body.style.userSelect = 'none';
        }}
        onDoubleClick={() => {
          setSidebarWidth(320);
          localStorage.setItem('contacts-sidebar-width', '320');
        }}
        title="Glisser pour redimensionner — double-clic pour réinitialiser"
        className="hidden md:block w-1 cursor-col-resize hover:bg-outlook-blue/50 active:bg-outlook-blue transition-colors flex-shrink-0 group relative"
      >
        <div className="absolute inset-y-0 -left-1 -right-1" />
      </div>

      {/* Right panel: detail */}
      <div className={`${(selectedContactId || (isDistListView && selectedDistListId)) ? 'flex' : 'hidden md:flex'} flex-1 flex-col overflow-hidden`}>
        {(selectedContact || (isDistListView && selectedDistList)) && (
          <div className="md:hidden flex items-center px-2 py-1.5 border-b border-outlook-border bg-outlook-bg-primary flex-shrink-0">
            <button
              onClick={() => { setSelectedContactId(null); setSelectedDistListId(null); }}
              className="flex items-center gap-1 px-2 py-1.5 text-sm text-outlook-text-primary hover:bg-outlook-bg-hover rounded"
              aria-label="Retour à la liste"
            >
              <ChevronLeft size={18} /> Retour
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto">
          {isDistListView ? (
            selectedDistList ? (
              <DistListDetail
                list={selectedDistList}
                isOwner={selectedDistList.user_id === currentUser?.id}
                onEdit={() => { setEditingDL(selectedDistList); setShowDLForm(true); }}
                onDelete={() => {
                  if (confirm('Supprimer cette liste ? Elle sera archivée et restera visible par les administrateurs.')) {
                    dlDeleteMutation.mutate(selectedDistList.id);
                  }
                }}
                onShare={() => setShowShareDialog(selectedDistList)}
                isDeleting={dlDeleteMutation.isPending}
              />
            ) : (
              <div className="h-full flex items-center justify-center text-outlook-text-disabled">
                <div className="text-center">
                  <BookOpen size={64} className="mx-auto mb-3 opacity-20" />
                  <p className="text-sm">Sélectionnez une liste pour afficher ses détails</p>
                </div>
              </div>
            )
          ) : selectedContact ? (
            <ContactDetail
              contact={selectedContact}
              onEdit={() => { setEditingContact(selectedContact); setShowForm(true); }}
              onDelete={() => {
                if (confirm('Supprimer ce contact ?')) deleteMutation.mutate(selectedContact.id);
              }}
              onPromote={() => promoteMutation.mutate(selectedContact.id)}
              onToggleFav={() => favoriteMutation.mutate({
                id: selectedContact.id,
                isFavorite: !selectedContact.is_favorite,
              })}
              promoting={promoteMutation.isPending}
            />
          ) : (
            <div className="h-full flex items-center justify-center text-outlook-text-disabled">
              <div className="text-center">
                <User size={64} className="mx-auto mb-3 opacity-20" />
                <p className="text-sm">Sélectionnez un contact pour afficher ses détails</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {showForm && (
        <ContactForm
          contact={editingContact}
          onSubmit={(data) => createMutation.mutate(data)}
          onClose={() => { setShowForm(false); setEditingContact(null); }}
          isSubmitting={createMutation.isPending}
        />
      )}

      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onImport={(contacts, mode) => importMutation.mutate({ contacts, mode })}
          isImporting={importMutation.isPending}
        />
      )}

      {showDLForm && (
        <DistListForm
          list={editingDL}
          onSubmit={(data) => dlSaveMutation.mutate(data)}
          onClose={() => { setShowDLForm(false); setEditingDL(null); }}
          isSubmitting={dlSaveMutation.isPending}
        />
      )}

      {showShareDialog && (
        <ShareDistListDialog
          list={showShareDialog}
          onSave={(sharedWith) => {
            dlShareMutation.mutate({ id: showShareDialog.id, sharedWith });
            setShowShareDialog(null);
          }}
          onClose={() => setShowShareDialog(null)}
          isSaving={dlShareMutation.isPending}
        />
      )}
    </div>
  );
}

// ---------- Components ----------

function NavItem({
  label, icon, count, active, onClick, color,
}: {
  label: string; icon: React.ReactNode; count?: number; active: boolean; onClick: () => void;
  color?: 'orange' | 'amber' | 'green' | 'blue' | 'purple';
}) {
  const activeColor = color === 'orange'
    ? 'bg-orange-50 text-orange-700 font-medium'
    : color === 'amber'
      ? 'bg-amber-50 text-amber-700 font-medium'
      : color === 'green'
        ? 'bg-green-50 text-green-700 font-medium'
        : color === 'blue'
          ? 'bg-blue-50 text-blue-700 font-medium'
          : color === 'purple'
            ? 'bg-purple-50 text-purple-700 font-medium'
            : 'bg-outlook-bg-selected font-medium text-outlook-blue';
  const badgeColor = color === 'orange'
    ? 'bg-orange-100 text-orange-600'
    : color === 'amber'
      ? 'bg-amber-100 text-amber-700'
      : color === 'green'
        ? 'bg-green-100 text-green-700'
        : color === 'blue'
          ? 'bg-blue-100 text-blue-700'
          : color === 'purple'
            ? 'bg-purple-100 text-purple-700'
            : 'bg-gray-100 text-outlook-text-secondary';
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-2 py-1.5 text-sm rounded flex items-center gap-2 transition-colors
        ${active ? activeColor : 'hover:bg-outlook-bg-hover text-outlook-text-primary'}`}
    >
      <span className={active ? '' : 'text-outlook-text-disabled'}>{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {count !== undefined && count > 0 && (
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${active ? badgeColor : 'bg-gray-100 text-outlook-text-secondary'}`}>
          {count}
        </span>
      )}
    </button>
  );
}

function ContactRow({
  contact, selected, onClick, onFav,
}: {
  contact: Contact; selected: boolean; onClick: () => void; onFav: (v: boolean) => void;
}) {
  const isSender = contact.source === 'sender';
  return (
    <div
      onClick={onClick}
      className={`group flex items-center gap-3 px-3 py-2.5 border-b border-outlook-border cursor-pointer transition-colors
        ${selected
          ? 'bg-outlook-bg-selected border-l-2 border-l-outlook-blue text-outlook-text-primary'
          : 'hover:bg-outlook-bg-hover'}`}
    >
      <Avatar contact={contact} size="md" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <div className="text-sm font-medium truncate text-outlook-text-primary">
            {getFullName(contact)}
          </div>
          {isSender && (
            <span className="text-[9px] bg-orange-100 text-orange-600 px-1 rounded flex-shrink-0">Non enr.</span>
          )}
        </div>
        <div className="text-xs text-outlook-text-secondary truncate">{contact.email}</div>
        {contact.company && (
          <div className="text-[11px] text-outlook-text-disabled truncate flex items-center gap-1">
            <Building size={9} /> {contact.company}
          </div>
        )}
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onFav(!contact.is_favorite); }}
        className={`p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-amber-100 ${contact.is_favorite ? '!opacity-100' : ''}`}
        title={contact.is_favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
      >
        <Star size={14} className={contact.is_favorite ? 'text-amber-500 fill-amber-500' : 'text-outlook-text-disabled'} />
      </button>
    </div>
  );
}

function Avatar({ contact, size }: { contact: Contact; size: 'sm' | 'md' | 'lg' | 'xl' }) {
  const sizes = {
    sm: 'w-8 h-8 text-xs',
    md: 'w-10 h-10 text-sm',
    lg: 'w-16 h-16 text-lg',
    xl: 'w-24 h-24 text-2xl',
  };
  const color = avatarColor(contact.email || contact.id || 'x');
  if (contact.avatar_url) {
    return (
      <div className={`${sizes[size]} rounded-full overflow-hidden flex-shrink-0 ring-2 ring-white shadow-sm`}>
        <img src={contact.avatar_url} alt="" className="w-full h-full object-cover" />
      </div>
    );
  }
  return (
    <div className={`${sizes[size]} rounded-full bg-gradient-to-br ${color} text-white flex items-center justify-center font-semibold flex-shrink-0 ring-2 ring-white shadow-sm`}>
      {getInitials(contact)}
    </div>
  );
}

function ContactDetail({
  contact, onEdit, onDelete, onPromote, onToggleFav, promoting,
}: {
  contact: Contact;
  onEdit: () => void;
  onDelete: () => void;
  onPromote: () => void;
  onToggleFav: () => void;
  promoting: boolean;
}) {
  const meta = (contact.metadata as any) || {};
  const seed = contact.email || contact.id || 'x';
  const gradient = bannerGradient(meta.bannerColor, seed);
  const bannerImage: string | undefined = meta.bannerImage;
  const bannerFit: BannerFit = meta.bannerFit || 'cover';
  const bannerPosX: number = typeof meta.bannerPosX === 'number' ? meta.bannerPosX : 50;
  const bannerPosY: number = typeof meta.bannerPosY === 'number' ? meta.bannerPosY : 50;
  const isSender = contact.source === 'sender';

  return (
    <div>
      {/* Header with gradient banner or custom image */}
      <div
        className={`h-48 relative ${bannerImage ? '' : `bg-gradient-to-br ${gradient}`}`}
        style={bannerImageStyle(bannerImage, bannerFit, bannerPosX, bannerPosY)}
      >
        {bannerImage && <div className="absolute inset-0 bg-black/10" />}
        <div className="absolute top-3 right-3 flex gap-1">
          <button
            onClick={onToggleFav}
            className="p-2 bg-white/20 hover:bg-white/30 backdrop-blur-sm rounded-full text-white transition"
            title={contact.is_favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
          >
            <Star size={16} className={contact.is_favorite ? 'fill-amber-300 text-amber-300' : ''} />
          </button>
          <button
            onClick={onEdit}
            className="p-2 bg-white/20 hover:bg-white/30 backdrop-blur-sm rounded-full text-white transition"
            title="Modifier"
          >
            <Edit2 size={16} />
          </button>
          <button
            onClick={onDelete}
            className="p-2 bg-white/20 hover:bg-red-500/60 backdrop-blur-sm rounded-full text-white transition"
            title="Supprimer"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 pb-8 relative z-10">
        <div className="flex items-end gap-5 mb-6 -mt-14">
          <div className="ring-4 ring-outlook-bg-primary rounded-full flex-shrink-0 relative z-10">
            <Avatar contact={contact} size="xl" />
          </div>
          <div className="flex-1 pb-3">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-semibold text-outlook-text-primary leading-tight">{getFullName(contact)}</h1>
              {isSender && (
                <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-medium">
                  Non enregistré
                </span>
              )}
            </div>
            {contact.job_title && (
              <p className="text-sm text-outlook-text-secondary flex items-center gap-1 mt-1">
                <Briefcase size={12} /> {contact.job_title}
                {contact.company && <span className="text-outlook-text-disabled"> · {contact.company}</span>}
              </p>
            )}
          </div>
          {isSender && (
            <button
              onClick={onPromote}
              disabled={promoting}
              className="bg-green-600 hover:bg-green-700 text-white text-sm px-4 py-2 rounded-md font-medium flex items-center gap-2 disabled:opacity-50 shadow-sm"
            >
              {promoting ? <Loader2 size={14} className="animate-spin" /> : <UserCheck size={14} />}
              Enregistrer
            </button>
          )}
        </div>

        {/* Quick actions */}
        {contact.email && (
          <div className="flex gap-2 mb-5">
            <a
              href={`mailto:${contact.email}`}
              className="flex-1 bg-outlook-blue hover:bg-outlook-blue-hover text-white text-sm px-4 py-2 rounded-md flex items-center justify-center gap-2 shadow-sm"
            >
              <Mail size={14} /> Envoyer un e-mail
            </a>
            {contact.phone && (
              <a
                href={`tel:${contact.phone}`}
                className="px-4 py-2 border border-outlook-border hover:bg-outlook-bg-hover text-sm rounded-md flex items-center gap-2"
              >
                <Phone size={14} /> Appeler
              </a>
            )}
          </div>
        )}

        {/* Sections */}
        <div className="space-y-4">
          <Section title="Coordonnées" icon={<Mail size={14} />}>
            {contact.email && <InfoRow icon={Mail} label="E-mail" value={contact.email} link={`mailto:${contact.email}`} />}
            {contact.phone && <InfoRow icon={Phone} label="Téléphone" value={contact.phone} link={`tel:${contact.phone}`} />}
            {contact.mobile && <InfoRow icon={Phone} label="Mobile" value={contact.mobile} link={`tel:${contact.mobile}`} />}
            {meta.website && <InfoRow icon={Globe} label="Site web" value={meta.website} link={meta.website.startsWith('http') ? meta.website : `https://${meta.website}`} external />}
          </Section>

          {(contact.company || contact.job_title || contact.department) && (
            <Section title="Professionnel" icon={<Briefcase size={14} />}>
              {contact.company && <InfoRow icon={Building} label="Entreprise" value={contact.company} />}
              {contact.job_title && <InfoRow icon={Briefcase} label="Fonction" value={contact.job_title} />}
              {contact.department && <InfoRow icon={Users} label="Service" value={contact.department} />}
            </Section>
          )}

          {(meta.address || meta.birthday) && (
            <Section title="Informations" icon={<CalIcon size={14} />}>
              {meta.birthday && <InfoRow icon={CalIcon} label="Anniversaire" value={meta.birthday} />}
              {meta.address && <InfoRow icon={MapPin} label="Adresse" value={meta.address} />}
            </Section>
          )}

          {contact.notes && (
            <Section title="Notes" icon={<FileText size={14} />}>
              <p className="text-sm text-outlook-text-primary whitespace-pre-wrap sm:col-span-2">{contact.notes}</p>
            </Section>
          )}
        </div>

        <div className="mt-4 text-[11px] text-outlook-text-disabled">
          Source :{' '}
          {contact.source === 'nextcloud' ? 'NextCloud'
            : contact.source === 'sender' ? 'Expéditeur non enregistré'
              : 'Locale'}
        </div>
      </div>
    </div>
  );
}

function Section({
  title, icon, children, className = '',
}: { title: string; icon: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-outlook-bg-primary border border-outlook-border rounded-lg p-5 ${className}`}>
      <h3 className="text-xs font-semibold text-outlook-text-secondary uppercase tracking-wider flex items-center gap-1.5 mb-4">
        {icon} {title}
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">{children}</div>
    </div>
  );
}

function InfoRow({
  icon: Icon, label, value, link, external,
}: { icon: any; label: string; value: string; link?: string; external?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <Icon size={14} className="text-outlook-text-disabled flex-shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-outlook-text-disabled">{label}</div>
        {link ? (
          <a
            href={link}
            target={external ? '_blank' : undefined}
            rel={external ? 'noopener noreferrer' : undefined}
            className="text-sm text-outlook-blue hover:underline break-all"
          >
            {value}
          </a>
        ) : (
          <div className="text-sm text-outlook-text-primary break-words">{value}</div>
        )}
      </div>
    </div>
  );
}

// ---------- Contact Form Modal ----------

function ContactForm({
  contact, onSubmit, onClose, isSubmitting,
}: {
  contact: Contact | null;
  onSubmit: (data: any) => void;
  onClose: () => void;
  isSubmitting: boolean;
}) {
  const meta = (contact?.metadata as any) || {};
  const [firstName, setFirstName] = useState(contact?.first_name || '');
  const [lastName, setLastName] = useState(contact?.last_name || '');
  const [email, setEmail] = useState(contact?.email || '');
  const [phone, setPhone] = useState(contact?.phone || '');
  const [mobile, setMobile] = useState(contact?.mobile || '');
  const [company, setCompany] = useState(contact?.company || '');
  const [jobTitle, setJobTitle] = useState(contact?.job_title || '');
  const [department, setDepartment] = useState(contact?.department || '');
  const [website, setWebsite] = useState(meta.website || '');
  const [birthday, setBirthday] = useState(meta.birthday || '');
  const [address, setAddress] = useState(meta.address || '');
  const [notes, setNotes] = useState(contact?.notes || '');
  const [avatarUrl, setAvatarUrl] = useState(contact?.avatar_url || '');
  const [isFavorite, setIsFavorite] = useState(!!contact?.is_favorite);
  const [bannerColor, setBannerColor] = useState<string>(meta.bannerColor || 'auto');
  const [bannerImage, setBannerImage] = useState<string>(meta.bannerImage || '');
  const [bannerFit, setBannerFit] = useState<BannerFit>(meta.bannerFit || 'cover');
  const [bannerPosX, setBannerPosX] = useState<number>(typeof meta.bannerPosX === 'number' ? meta.bannerPosX : 50);
  const [bannerPosY, setBannerPosY] = useState<number>(typeof meta.bannerPosY === 'number' ? meta.bannerPosY : 50);
  const [tab, setTab] = useState<'general' | 'work' | 'more' | 'appearance'>('general');
  const fileRef = useRef<HTMLInputElement>(null);
  const bannerFileRef = useRef<HTMLInputElement>(null);

  const handleAvatar = (file: File) => {
    if (file.size > 2 * 1024 * 1024) {
      toast.error('L\'image doit faire moins de 2 Mo');
      return;
    }
    // Resize to 256px max, JPEG
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => {
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const max = 256;
        let { width, height } = img;
        if (width > height) { height = (height / width) * max; width = max; }
        else { width = (width / height) * max; height = max; }
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, width, height);
        setAvatarUrl(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleBanner = (file: File) => {
    if (file.size > 3 * 1024 * 1024) {
      toast.error('L\'image doit faire moins de 3 Mo');
      return;
    }
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => {
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxW = 1200;
        let { width, height } = img;
        if (width > maxW) { height = (height / width) * maxW; width = maxW; }
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, width, height);
        setBannerImage(canvas.toDataURL('image/jpeg', 0.8));
        setBannerFit('cover');
        setBannerPosX(50);
        setBannerPosY(50);
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };

  // Drag-to-reposition for banner (only in 'cover' mode)
  const previewRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);

  const onBannerDragStart = (e: React.MouseEvent) => {
    if (!bannerImage || bannerFit !== 'cover') return;
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: bannerPosX, baseY: bannerPosY };
    const handleMove = (ev: MouseEvent) => {
      if (!dragRef.current || !previewRef.current) return;
      const rect = previewRef.current.getBoundingClientRect();
      const dx = ((ev.clientX - dragRef.current.startX) / rect.width) * 100;
      const dy = ((ev.clientY - dragRef.current.startY) / rect.height) * 100;
      // Invert: dragging right should move the image right (so background-position X decreases)
      setBannerPosX(Math.max(0, Math.min(100, dragRef.current.baseX - dx)));
      setBannerPosY(Math.max(0, Math.min(100, dragRef.current.baseY - dy)));
    };
    const handleUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const displayName = [firstName, lastName].filter(Boolean).join(' ').trim() || email;
    onSubmit({
      firstName, lastName, email, phone, mobile,
      company, jobTitle, department, notes,
      displayName,
      avatarUrl: avatarUrl || undefined,
      isFavorite,
      metadata: {
        ...meta,
        website: website || null,
        birthday: birthday || null,
        address: address || null,
        bannerColor: bannerColor !== 'auto' ? bannerColor : null,
        bannerImage: bannerImage || null,
        bannerFit: bannerImage ? bannerFit : null,
        bannerPosX: bannerImage && bannerFit === 'cover' ? bannerPosX : null,
        bannerPosY: bannerImage && bannerFit === 'cover' ? bannerPosY : null,
      },
    });
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header with live preview of banner */}
        <div
          className={`h-28 relative flex-shrink-0 ${bannerImage ? '' : `bg-gradient-to-br ${bannerGradient(bannerColor, email || firstName || 'new')}`}`}
          style={bannerImageStyle(bannerImage, bannerFit, bannerPosX, bannerPosY)}
        >
          {bannerImage && <div className="absolute inset-0 bg-black/20" />}
          <button
            onClick={onClose}
            className="absolute top-3 right-3 text-white/90 hover:text-white bg-white/10 hover:bg-white/20 rounded-full p-1 z-10"
          >
            <X size={18} />
          </button>
          <h2 className="absolute top-3 left-4 text-white font-semibold text-lg drop-shadow z-10">
            {contact ? 'Modifier le contact' : 'Nouveau contact'}
          </h2>
        </div>

        {/* Avatar row (outside the scrollable form to avoid clipping) */}
        <div className="px-6 flex items-end gap-4 pb-3 -mt-12 flex-shrink-0 relative z-10">
          <div className="relative group flex-shrink-0">
            <div className="w-24 h-24 rounded-full ring-4 ring-white bg-white shadow-lg overflow-hidden flex items-center justify-center">
              {avatarUrl ? (
                <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className={`w-full h-full bg-gradient-to-br ${avatarColor(email || 'new')} text-white flex items-center justify-center text-2xl font-semibold`}>
                  {((firstName[0] || '') + (lastName[0] || '')).toUpperCase() || '?'}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="absolute bottom-0 right-0 bg-outlook-blue hover:bg-outlook-blue-hover text-white p-1.5 rounded-full shadow-md"
              title="Changer la photo"
            >
              <Camera size={12} />
            </button>
            {avatarUrl && (
              <button
                type="button"
                onClick={() => setAvatarUrl('')}
                className="absolute top-0 right-0 bg-white hover:bg-red-50 text-red-500 p-1 rounded-full shadow-md border border-outlook-border"
                title="Supprimer la photo"
              >
                <X size={10} />
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleAvatar(e.target.files[0])}
            />
          </div>
          <button
            type="button"
            onClick={() => setIsFavorite(v => !v)}
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border transition pb-2 mb-0.5 ${
              isFavorite
                ? 'bg-amber-50 border-amber-200 text-amber-700'
                : 'border-outlook-border text-outlook-text-secondary hover:bg-outlook-bg-hover'
            }`}
            title={isFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
          >
            <Star size={13} className={isFavorite ? 'text-amber-500 fill-amber-500' : ''} />
            {isFavorite ? 'Favori' : 'Favori'}
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto flex flex-col min-h-0">
          {/* Tabs */}
          <div className="px-6 border-b border-outlook-border flex gap-4 flex-shrink-0 overflow-x-auto">
            {([
              ['general', 'Général'],
              ['work', 'Professionnel'],
              ['more', 'Plus'],
              ['appearance', 'Apparence'],
            ] as const).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k)}
                className={`py-2 text-sm font-medium border-b-2 transition ${
                  tab === k ? 'border-outlook-blue text-outlook-blue' : 'border-transparent text-outlook-text-secondary hover:text-outlook-text-primary'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="px-6 py-4 space-y-3 flex-1">
            {tab === 'general' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <FormField label="Prénom" value={firstName} onChange={setFirstName} autoFocus />
                  <FormField label="Nom" value={lastName} onChange={setLastName} />
                </div>
                <FormField label="E-mail" value={email} onChange={setEmail} type="email" icon={<Mail size={12} />} />
                <div className="grid grid-cols-2 gap-3">
                  <FormField label="Téléphone" value={phone} onChange={setPhone} type="tel" icon={<Phone size={12} />} />
                  <FormField label="Mobile" value={mobile} onChange={setMobile} type="tel" icon={<Phone size={12} />} />
                </div>
              </>
            )}
            {tab === 'work' && (
              <>
                <FormField label="Entreprise" value={company} onChange={setCompany} icon={<Building size={12} />} />
                <div className="grid grid-cols-2 gap-3">
                  <FormField label="Fonction" value={jobTitle} onChange={setJobTitle} icon={<Briefcase size={12} />} />
                  <FormField label="Service" value={department} onChange={setDepartment} />
                </div>
                <FormField label="Site web" value={website} onChange={setWebsite} icon={<Globe size={12} />} placeholder="https://" />
              </>
            )}
            {tab === 'more' && (
              <>
                <FormField label="Anniversaire" value={birthday} onChange={setBirthday} type="date" icon={<CalIcon size={12} />} />
                <FormField label="Adresse" value={address} onChange={setAddress} icon={<MapPin size={12} />} placeholder="Rue, code postal, ville..." />
                <div>
                  <label className="text-xs text-outlook-text-secondary flex items-center gap-1 mb-1">
                    <FileText size={12} /> Notes
                  </label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={4}
                    className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm resize-none focus:outline-none focus:border-outlook-blue focus:ring-1 focus:ring-outlook-blue"
                  />
                </div>
              </>
            )}
            {tab === 'appearance' && (
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-outlook-text-secondary flex items-center gap-1 mb-2 font-medium">
                    <Palette size={12} /> Couleur de la bannière
                  </label>
                  <div className="grid grid-cols-5 gap-2">
                    {BANNER_PRESETS.map(preset => {
                      const isSelected = bannerColor === preset.id && !bannerImage;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => { setBannerColor(preset.id); setBannerImage(''); }}
                          title={preset.label}
                          className={`relative h-12 rounded-md overflow-hidden border-2 transition ${
                            isSelected ? 'border-outlook-blue ring-2 ring-outlook-blue/30' : 'border-outlook-border hover:border-outlook-blue/50'
                          }`}
                        >
                          {preset.id === 'auto' ? (
                            <div className={`w-full h-full bg-gradient-to-br ${avatarColor(email || firstName || 'new')} flex items-center justify-center`}>
                              <span className="text-[10px] text-white font-medium drop-shadow">Auto</span>
                            </div>
                          ) : (
                            <div className={`w-full h-full bg-gradient-to-br ${preset.gradient}`} />
                          )}
                          {isSelected && (
                            <div className="absolute inset-0 flex items-center justify-center">
                              <CheckCircle2 size={16} className="text-white drop-shadow" />
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="text-xs text-outlook-text-secondary flex items-center gap-1 mb-2 font-medium">
                    <ImageIcon size={12} /> Image de la bannière
                  </label>
                  {!bannerImage ? (
                    <div
                      onClick={() => bannerFileRef.current?.click()}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (e.dataTransfer.files[0]) handleBanner(e.dataTransfer.files[0]);
                      }}
                      className="relative h-28 rounded-lg border-2 border-dashed cursor-pointer transition overflow-hidden border-outlook-border hover:border-outlook-blue hover:bg-outlook-bg-hover"
                    >
                      <div className="h-full flex flex-col items-center justify-center text-outlook-text-secondary gap-1">
                        <ImageIcon size={20} />
                        <span className="text-xs">Cliquez ou glissez une image</span>
                        <span className="text-[10px] text-outlook-text-disabled">JPG, PNG · 3 Mo max</span>
                      </div>
                      <input
                        ref={bannerFileRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => e.target.files?.[0] && handleBanner(e.target.files[0])}
                      />
                    </div>
                  ) : (
                    <>
                      {/* Fit mode selector */}
                      <div className="grid grid-cols-3 gap-2 mb-2">
                        {([
                          ['cover', 'Remplir', Maximize2, 'Recadré pour remplir (glisser pour déplacer)'],
                          ['fill', 'Étirer', Move, 'Déformé pour remplir toute la surface'],
                          ['contain', 'Adapter', Minimize2, 'Image entière visible, bandes possibles'],
                        ] as const).map(([value, label, Icon, title]) => {
                          const active = bannerFit === value;
                          return (
                            <button
                              key={value}
                              type="button"
                              title={title}
                              onClick={() => setBannerFit(value)}
                              className={`flex items-center justify-center gap-1.5 px-2 py-2 rounded-md border text-xs font-medium transition ${
                                active
                                  ? 'border-outlook-blue bg-outlook-blue/10 text-outlook-blue'
                                  : 'border-outlook-border text-outlook-text-secondary hover:border-outlook-blue/50 hover:text-outlook-text-primary'
                              }`}
                            >
                              <Icon size={14} />
                              {label}
                            </button>
                          );
                        })}
                      </div>

                      {/* Interactive preview (drag to reposition) */}
                      <div
                        ref={previewRef}
                        onMouseDown={onBannerDragStart}
                        className={`relative h-28 rounded-lg overflow-hidden border-2 border-solid border-outlook-blue ${
                          bannerFit === 'cover' ? 'cursor-move' : 'cursor-default'
                        }`}
                        style={bannerImageStyle(bannerImage, bannerFit, bannerPosX, bannerPosY)}
                      >
                        {bannerFit === 'cover' && (
                          <div className="absolute bottom-1.5 left-1.5 bg-black/60 text-white text-[10px] px-2 py-0.5 rounded flex items-center gap-1 pointer-events-none">
                            <Move size={10} /> Glissez pour recadrer
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setBannerImage(''); setBannerFit('cover'); setBannerPosX(50); setBannerPosY(50); }}
                          className="absolute top-2 right-2 bg-white/90 hover:bg-white text-red-500 p-1 rounded-full shadow"
                          title="Supprimer l'image"
                        >
                          <X size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); bannerFileRef.current?.click(); }}
                          className="absolute top-2 right-10 bg-white/90 hover:bg-white text-outlook-text-secondary p-1 rounded-full shadow"
                          title="Remplacer l'image"
                        >
                          <Upload size={12} />
                        </button>
                      </div>

                      {/* Fine-grained position sliders (cover only) */}
                      {bannerFit === 'cover' && (
                        <div className="grid grid-cols-2 gap-3 mt-2">
                          <label className="text-[10px] text-outlook-text-secondary flex items-center gap-2">
                            <span className="w-3">X</span>
                            <input
                              type="range"
                              min={0}
                              max={100}
                              value={bannerPosX}
                              onChange={(e) => setBannerPosX(Number(e.target.value))}
                              className="flex-1 accent-outlook-blue"
                            />
                            <span className="w-8 text-right tabular-nums">{Math.round(bannerPosX)}%</span>
                          </label>
                          <label className="text-[10px] text-outlook-text-secondary flex items-center gap-2">
                            <span className="w-3">Y</span>
                            <input
                              type="range"
                              min={0}
                              max={100}
                              value={bannerPosY}
                              onChange={(e) => setBannerPosY(Number(e.target.value))}
                              className="flex-1 accent-outlook-blue"
                            />
                            <span className="w-8 text-right tabular-nums">{Math.round(bannerPosY)}%</span>
                          </label>
                        </div>
                      )}

                      <input
                        ref={bannerFileRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => e.target.files?.[0] && handleBanner(e.target.files[0])}
                      />
                    </>
                  )}
                  <p className="text-[10px] text-outlook-text-disabled mt-1">
                    Si une image est définie, elle remplace la couleur choisie.
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="px-6 py-3 border-t border-outlook-border flex justify-end gap-2 bg-gray-50 flex-shrink-0">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-md hover:bg-outlook-bg-hover">
              Annuler
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="bg-outlook-blue hover:bg-outlook-blue-hover text-white px-5 py-2 text-sm rounded-md disabled:opacity-50 flex items-center gap-2 font-medium shadow-sm"
            >
              {isSubmitting && <Loader2 size={14} className="animate-spin" />}
              {isSubmitting ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function FormField({
  label, value, onChange, type = 'text', icon, placeholder, autoFocus,
}: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; icon?: React.ReactNode; placeholder?: string; autoFocus?: boolean;
}) {
  return (
    <div>
      <label className="text-xs text-outlook-text-secondary flex items-center gap-1 mb-1">
        {icon} {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-outlook-blue focus:ring-1 focus:ring-outlook-blue"
      />
    </div>
  );
}

// ---------- Import Modal ----------

function ImportModal({
  onClose, onImport, isImporting,
}: {
  onClose: () => void;
  onImport: (contacts: ImportedContact[], mode: 'merge' | 'skip' | 'replace') => void;
  isImporting: boolean;
}) {
  const [parsed, setParsed] = useState<ImportedContact[] | null>(null);
  const [filename, setFilename] = useState('');
  const [mode, setMode] = useState<'merge' | 'skip' | 'replace'>('merge');
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setError(null);
    try {
      const text = await file.text();
      const items = parseContactsFile(file.name, text);
      if (!items.length) {
        setError('Aucun contact détecté dans ce fichier.');
        return;
      }
      setParsed(items);
      setFilename(file.name);
    } catch (e: any) {
      setError(e.message || 'Impossible de lire le fichier');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-outlook-border flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Upload size={18} /> Importer des contacts
          </h2>
          <button onClick={onClose} className="text-outlook-text-secondary hover:text-outlook-text-primary"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {!parsed ? (
            <>
              <div
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
                }}
                className="border-2 border-dashed border-outlook-border hover:border-outlook-blue hover:bg-blue-50/30 rounded-xl p-8 text-center cursor-pointer transition"
              >
                <Upload size={36} className="mx-auto text-outlook-text-disabled mb-3" />
                <p className="text-sm font-medium text-outlook-text-primary mb-1">
                  Cliquez ou glissez un fichier ici
                </p>
                <p className="text-xs text-outlook-text-secondary">
                  Formats acceptés : .vcf (vCard), .csv (Google, Outlook)
                </p>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".vcf,.vcard,.csv,text/vcard,text/csv"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                />
              </div>

              <div className="text-xs text-outlook-text-secondary space-y-1.5 bg-gray-50 p-3 rounded-md">
                <p className="font-medium text-outlook-text-primary">Logiciels compatibles :</p>
                <ul className="list-disc list-inside space-y-0.5">
                  <li><strong>Gmail / Google Contacts</strong> : exportez en "Google CSV" ou vCard</li>
                  <li><strong>Outlook / Microsoft 365</strong> : exportez en CSV</li>
                  <li><strong>Apple Contacts (iOS/macOS)</strong> : exportez en vCard</li>
                  <li><strong>Thunderbird, Android, Yahoo...</strong> : CSV ou vCard</li>
                </ul>
              </div>

              {error && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3 flex items-start gap-2">
                  <AlertCircle size={16} className="flex-shrink-0 mt-0.5" /> {error}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 text-sm bg-green-50 border border-green-200 text-green-700 rounded-md p-3">
                <CheckCircle2 size={18} />
                <div>
                  <div className="font-medium">{parsed.length} contact{parsed.length > 1 ? 's' : ''} détecté{parsed.length > 1 ? 's' : ''}</div>
                  <div className="text-xs text-green-600">depuis {filename}</div>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-outlook-text-secondary uppercase tracking-wider mb-2 block">
                  En cas de doublon (même e-mail)
                </label>
                <div className="space-y-1">
                  {([
                    ['merge', 'Fusionner', 'Compléter les contacts existants avec les nouvelles données'],
                    ['skip', 'Ignorer', 'Ne pas modifier les contacts déjà présents'],
                    ['replace', 'Remplacer', 'Écraser les champs des contacts existants'],
                  ] as const).map(([val, title, desc]) => (
                    <label key={val} className={`flex items-start gap-2 p-2.5 border rounded-md cursor-pointer transition ${mode === val ? 'border-outlook-blue bg-blue-50' : 'border-outlook-border hover:bg-outlook-bg-hover'}`}>
                      <input type="radio" name="mode" value={val} checked={mode === val} onChange={() => setMode(val)} className="mt-0.5" />
                      <div>
                        <div className="text-sm font-medium">{title}</div>
                        <div className="text-xs text-outlook-text-secondary">{desc}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div className="max-h-48 overflow-y-auto border border-outlook-border rounded-md">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 text-outlook-text-secondary">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">Nom</th>
                      <th className="text-left px-3 py-2 font-medium">E-mail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.slice(0, 50).map((c, i) => (
                      <tr key={i} className="border-t border-outlook-border">
                        <td className="px-3 py-1.5">{c.displayName || [c.firstName, c.lastName].filter(Boolean).join(' ')}</td>
                        <td className="px-3 py-1.5 text-outlook-text-secondary">{c.email}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {parsed.length > 50 && (
                  <div className="text-center text-xs text-outlook-text-disabled py-2 bg-gray-50">
                    + {parsed.length - 50} autre{parsed.length - 50 > 1 ? 's' : ''}...
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="px-6 py-3 border-t border-outlook-border flex justify-between gap-2 bg-gray-50">
          {parsed ? (
            <>
              <button
                type="button"
                onClick={() => { setParsed(null); setFilename(''); }}
                className="px-4 py-2 text-sm rounded-md hover:bg-outlook-bg-hover"
              >
                Changer de fichier
              </button>
              <button
                type="button"
                disabled={isImporting}
                onClick={() => onImport(parsed, mode)}
                className="bg-outlook-blue hover:bg-outlook-blue-hover text-white px-5 py-2 text-sm rounded-md disabled:opacity-50 flex items-center gap-2 font-medium shadow-sm"
              >
                {isImporting && <Loader2 size={14} className="animate-spin" />}
                {isImporting ? 'Import en cours...' : `Importer ${parsed.length} contact${parsed.length > 1 ? 's' : ''}`}
              </button>
            </>
          ) : (
            <button type="button" onClick={onClose} className="ml-auto px-4 py-2 text-sm rounded-md hover:bg-outlook-bg-hover">
              Annuler
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Distribution List Components
// ─────────────────────────────────────────────────────────────────────────────

function DistListRow({ list, selected, isOwner, onClick }: {
  list: any; selected: boolean; isOwner: boolean; onClick: () => void;
}) {
  const memberCount = Array.isArray(list.members) ? list.members.length : 0;
  const sharedCount = Array.isArray(list.shared_with) ? list.shared_with.length : 0;
  return (
    <div
      onClick={onClick}
      className={`group flex items-center gap-3 px-3 py-2.5 border-b border-outlook-border cursor-pointer transition-colors
        ${selected
          ? 'bg-outlook-bg-selected border-l-2 border-l-outlook-blue'
          : 'hover:bg-outlook-bg-hover'}`}
    >
      <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0">
        <BookOpen size={18} className="text-purple-600" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <div className="text-sm font-medium truncate text-outlook-text-primary">{list.name}</div>
          {!isOwner && (
            <span className="text-[9px] bg-blue-100 text-blue-600 px-1 rounded flex-shrink-0">Partagée</span>
          )}
        </div>
        <div className="text-xs text-outlook-text-secondary truncate">
          {memberCount} membre{memberCount !== 1 ? 's' : ''}
          {sharedCount > 0 && ` · partagée avec ${sharedCount}`}
        </div>
        {list.description && (
          <div className="text-[11px] text-outlook-text-disabled truncate">{list.description}</div>
        )}
      </div>
    </div>
  );
}

function DistListDetail({ list, isOwner, onEdit, onDelete, onShare, isDeleting }: {
  list: any; isOwner: boolean;
  onEdit: () => void; onDelete: () => void; onShare: () => void; isDeleting: boolean;
}) {
  const members: { email: string; name?: string }[] = Array.isArray(list.members) ? list.members : [];
  const sharedWith: { type: string; id: string; display?: string }[] = Array.isArray(list.shared_with) ? list.shared_with : [];

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-start gap-4 mb-6">
        <div className="w-16 h-16 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0">
          <BookOpen size={28} className="text-purple-600" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-semibold text-outlook-text-primary">{list.name}</h2>
          {list.description && <p className="text-sm text-outlook-text-secondary mt-1">{list.description}</p>}
          {!isOwner && list.owner_name && (
            <p className="text-xs text-outlook-text-disabled mt-1">Partagée par {list.owner_name || list.owner_email}</p>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {isOwner && (
          <button
            onClick={onEdit}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-outlook-border rounded hover:bg-outlook-bg-hover"
          >
            <Edit2 size={13} /> Modifier
          </button>
        )}
        {isOwner && (
          <button
            onClick={onShare}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-outlook-border rounded hover:bg-outlook-bg-hover text-outlook-blue"
          >
            <Share2 size={13} /> Partager
          </button>
        )}
        {isOwner && (
          <button
            onClick={onDelete}
            disabled={isDeleting}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-red-200 rounded hover:bg-red-50 text-red-600 disabled:opacity-50"
          >
            <Trash2 size={13} /> Supprimer
          </button>
        )}
      </div>

      {/* Members */}
      <div className="mb-6">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-outlook-text-disabled mb-3">
          Membres ({members.length})
        </h3>
        {members.length === 0 ? (
          <p className="text-sm text-outlook-text-disabled">Aucun membre. Modifier la liste pour en ajouter.</p>
        ) : (
          <div className="space-y-1">
            {members.map((m, i) => (
              <div key={i} className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-outlook-bg-hover">
                <div className="w-7 h-7 rounded-full bg-outlook-blue/10 flex items-center justify-center text-outlook-blue text-xs font-semibold flex-shrink-0">
                  {(m.name || m.email || '?')[0].toUpperCase()}
                </div>
                <div className="min-w-0">
                  {m.name && <div className="text-sm text-outlook-text-primary truncate">{m.name}</div>}
                  <div className="text-xs text-outlook-text-secondary truncate">{m.email}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Shared with */}
      {isOwner && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-outlook-text-disabled mb-3">
            Partagée avec ({sharedWith.length})
          </h3>
          {sharedWith.length === 0 ? (
            <p className="text-sm text-outlook-text-disabled">Non partagée. Cliquez sur "Partager" pour la partager.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {sharedWith.map((sw, i) => (
                <span key={i} className="flex items-center gap-1 text-xs bg-blue-50 text-blue-700 border border-blue-200 px-2 py-1 rounded-full">
                  {sw.type === 'group' ? <Shield size={10} /> : <User size={10} />}
                  {sw.display || sw.id}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DistListForm({ list, onSubmit, onClose, isSubmitting }: {
  list: any | null; onSubmit: (data: any) => void; onClose: () => void; isSubmitting: boolean;
}) {
  const [name, setName] = useState(list?.name || '');
  const [description, setDescription] = useState(list?.description || '');
  const [members, setMembers] = useState<{ email: string; name?: string }[]>(
    Array.isArray(list?.members) ? list.members : []
  );
  const [memberInput, setMemberInput] = useState('');
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const searchContacts = useCallback((q: string) => {
    if (searchRef.current) clearTimeout(searchRef.current);
    if (q.length < 1) { setSuggestions([]); return; }
    searchRef.current = setTimeout(async () => {
      try {
        const res = await api.searchContacts(q);
        setSuggestions(res.contacts.filter((c: any) => c.email));
      } catch { setSuggestions([]); }
    }, 200);
  }, []);

  const addMember = (email: string, memberName?: string) => {
    const e = email.trim().toLowerCase();
    if (!e || !e.includes('@')) return;
    if (members.some(m => m.email === e)) return;
    setMembers(prev => [...prev, { email: e, name: memberName }]);
    setMemberInput('');
    setSuggestions([]);
  };

  const handleMemberKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addMember(memberInput);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit({ name: name.trim(), description: description.trim() || null, members });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-outlook-border flex-shrink-0">
          <h2 className="text-lg font-semibold text-outlook-text-primary">
            {list ? 'Modifier la liste' : 'Nouvelle liste de distribution'}
          </h2>
          <button onClick={onClose} className="text-outlook-text-secondary hover:text-outlook-text-primary p-1 rounded">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="p-6 space-y-4 flex-1 overflow-y-auto">
            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-outlook-text-primary mb-1">Nom <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Ex: Restauration Responsable"
                className="w-full px-3 py-2 border border-outlook-border rounded text-sm focus:outline-none focus:border-outlook-blue"
                required
                autoFocus
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-outlook-text-primary mb-1">Description</label>
              <input
                type="text"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Optionnel"
                className="w-full px-3 py-2 border border-outlook-border rounded text-sm focus:outline-none focus:border-outlook-blue"
              />
            </div>

            {/* Members */}
            <div>
              <label className="block text-sm font-medium text-outlook-text-primary mb-1">
                Membres ({members.length})
              </label>
              <p className="text-xs text-outlook-text-disabled mb-2">
                Recherchez des contacts existants ou tapez un email directement puis Entrée.
              </p>
              {/* Member input with autocomplete */}
              <div className="relative mb-2">
                <AtSign size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-outlook-text-disabled" />
                <input
                  type="text"
                  value={memberInput}
                  onChange={e => { setMemberInput(e.target.value); searchContacts(e.target.value); setShowSuggestions(true); }}
                  onKeyDown={handleMemberKeyDown}
                  onFocus={() => { if (memberInput.length > 0) setShowSuggestions(true); }}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                  placeholder="Rechercher ou email@domaine.fr"
                  className="w-full pl-9 pr-3 py-2 border border-outlook-border rounded text-sm focus:outline-none focus:border-outlook-blue"
                />
                {showSuggestions && suggestions.length > 0 && (
                  <div className="absolute left-0 top-full mt-1 bg-white border border-outlook-border rounded shadow-xl z-40 w-full max-h-40 overflow-y-auto">
                    {suggestions.map((s, i) => (
                      <button
                        key={i}
                        type="button"
                        onMouseDown={() => addMember(s.email, s.display_name || s.name)}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-outlook-bg-hover flex items-center gap-2"
                      >
                        <div className="w-6 h-6 rounded-full bg-outlook-blue/10 flex items-center justify-center text-outlook-blue text-xs font-semibold flex-shrink-0">
                          {(s.display_name || s.email || '?')[0].toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium truncate">{s.display_name || s.name || s.email}</div>
                          <div className="text-xs text-outlook-text-disabled truncate">{s.email}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {/* Members list */}
              {members.length > 0 ? (
                <div className="space-y-1 max-h-48 overflow-y-auto border border-outlook-border rounded p-2">
                  {members.map((m, i) => (
                    <div key={i} className="flex items-center gap-2 py-1 px-2 rounded hover:bg-outlook-bg-hover group">
                      <div className="w-6 h-6 rounded-full bg-outlook-blue/10 flex items-center justify-center text-outlook-blue text-xs font-semibold flex-shrink-0">
                        {(m.name || m.email || '?')[0].toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        {m.name && <div className="text-sm truncate">{m.name}</div>}
                        <div className="text-xs text-outlook-text-secondary truncate">{m.email}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setMembers(prev => prev.filter((_, j) => j !== i))}
                        className="opacity-0 group-hover:opacity-100 text-outlook-text-disabled hover:text-red-500 p-0.5 rounded"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-outlook-text-disabled text-center py-4 border border-dashed border-outlook-border rounded">
                  Aucun membre — ajoutez des contacts ci-dessus
                </div>
              )}
            </div>
          </div>

          <div className="px-6 py-3 border-t border-outlook-border flex justify-end gap-2 flex-shrink-0">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded hover:bg-outlook-bg-hover">
              Annuler
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !name.trim()}
              className="bg-outlook-blue hover:bg-outlook-blue-hover text-white px-5 py-2 text-sm rounded font-medium disabled:opacity-50 flex items-center gap-2"
            >
              {isSubmitting && <Loader2 size={13} className="animate-spin" />}
              {list ? 'Enregistrer' : 'Créer la liste'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ShareDistListDialog({ list, onSave, onClose, isSaving }: {
  list: any; onSave: (sharedWith: any[]) => void; onClose: () => void; isSaving: boolean;
}) {
  const [sharedWith, setSharedWith] = useState<any[]>(Array.isArray(list.shared_with) ? list.shared_with : []);
  const [searchQuery, setSearchQuery] = useState('');
  const [userResults, setUserResults] = useState<any[]>([]);
  const [groupResults, setGroupResults] = useState<any[]>([]);
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback((q: string) => {
    if (searchRef.current) clearTimeout(searchRef.current);
    if (q.length < 1) { setUserResults([]); setGroupResults([]); return; }
    searchRef.current = setTimeout(async () => {
      try {
        const [users, groups] = await Promise.all([
          api.listDirectoryUsers(q),
          api.getAdminGroups().catch(() => [] as any[]),
        ]);
        setUserResults((users as any[]).filter((u: any) => !sharedWith.some(s => s.id === u.id)));
        setGroupResults((groups as any[]).filter((g: any) =>
          g.name?.toLowerCase().includes(q.toLowerCase()) && !sharedWith.some(s => s.id === g.id)
        ));
      } catch { setUserResults([]); setGroupResults([]); }
    }, 200);
  }, [sharedWith]);

  const add = (item: any, type: 'user' | 'group') => {
    if (sharedWith.some(s => s.id === item.id)) return;
    setSharedWith(prev => [...prev, {
      type,
      id: item.id,
      display: type === 'user' ? (item.display_name || item.email) : item.name,
    }]);
    setSearchQuery('');
    setUserResults([]);
    setGroupResults([]);
  };

  const remove = (id: string) => setSharedWith(prev => prev.filter(s => s.id !== id));

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-outlook-border flex-shrink-0">
          <h2 className="text-lg font-semibold text-outlook-text-primary">Partager « {list.name} »</h2>
          <button onClick={onClose} className="text-outlook-text-secondary hover:text-outlook-text-primary p-1 rounded">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 flex-1 overflow-y-auto space-y-4">
          <p className="text-sm text-outlook-text-secondary">
            Recherchez des utilisateurs ou des groupes pour leur donner accès à cette liste.
          </p>

          {/* Search */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-outlook-text-disabled" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); search(e.target.value); }}
              placeholder="Rechercher utilisateur ou groupe..."
              className="w-full pl-9 pr-3 py-2 border border-outlook-border rounded text-sm focus:outline-none focus:border-outlook-blue"
              autoFocus
            />
            {(userResults.length > 0 || groupResults.length > 0) && (
              <div className="absolute left-0 top-full mt-1 bg-white border border-outlook-border rounded shadow-xl z-40 w-full max-h-48 overflow-y-auto">
                {userResults.length > 0 && (
                  <>
                    <div className="px-3 py-1 text-[10px] font-semibold uppercase text-outlook-text-disabled bg-gray-50">Utilisateurs</div>
                    {userResults.map((u: any) => (
                      <button
                        key={u.id}
                        type="button"
                        onMouseDown={() => add(u, 'user')}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-outlook-bg-hover flex items-center gap-2"
                      >
                        <User size={14} className="text-outlook-text-disabled flex-shrink-0" />
                        <span className="truncate">{u.display_name || u.email}</span>
                        <span className="text-xs text-outlook-text-disabled truncate ml-auto">{u.email}</span>
                      </button>
                    ))}
                  </>
                )}
                {groupResults.length > 0 && (
                  <>
                    <div className="px-3 py-1 text-[10px] font-semibold uppercase text-outlook-text-disabled bg-gray-50">Groupes</div>
                    {groupResults.map((g: any) => (
                      <button
                        key={g.id}
                        type="button"
                        onMouseDown={() => add(g, 'group')}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-outlook-bg-hover flex items-center gap-2"
                      >
                        <Shield size={14} className="text-outlook-text-disabled flex-shrink-0" />
                        <span className="truncate">{g.name}</span>
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Current shares */}
          <div>
            <div className="text-xs font-semibold text-outlook-text-disabled mb-2">
              Partagée avec ({sharedWith.length})
            </div>
            {sharedWith.length === 0 ? (
              <p className="text-sm text-outlook-text-disabled">Aucun partage — recherchez ci-dessus.</p>
            ) : (
              <div className="space-y-1">
                {sharedWith.map((sw, i) => (
                  <div key={i} className="flex items-center gap-2 py-1.5 px-2 rounded bg-gray-50 border border-outlook-border">
                    {sw.type === 'group' ? <Shield size={14} className="text-purple-500 flex-shrink-0" /> : <User size={14} className="text-outlook-blue flex-shrink-0" />}
                    <span className="flex-1 text-sm truncate">{sw.display || sw.id}</span>
                    <button
                      type="button"
                      onClick={() => remove(sw.id)}
                      className="text-outlook-text-disabled hover:text-red-500 p-0.5 rounded"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="px-6 py-3 border-t border-outlook-border flex justify-end gap-2 flex-shrink-0">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded hover:bg-outlook-bg-hover">
            Annuler
          </button>
          <button
            onClick={() => onSave(sharedWith)}
            disabled={isSaving}
            className="bg-outlook-blue hover:bg-outlook-blue-hover text-white px-5 py-2 text-sm rounded font-medium disabled:opacity-50 flex items-center gap-2"
          >
            {isSaving && <Loader2 size={13} className="animate-spin" />}
            Enregistrer le partage
          </button>
        </div>
      </div>
    </div>
  );
}
