import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import {
  Users, Shield, Plug, Cloud, Settings, Plus, Trash2, X,
  Edit2, CheckCircle, XCircle, RefreshCw, Globe, Mail, UserPlus, TestTube
} from 'lucide-react';
import toast from 'react-hot-toast';

type Tab = 'users' | 'groups' | 'mailaccounts' | 'nextcloud' | 'plugins' | 'system';

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('users');

  const tabs = [
    { id: 'users' as const, icon: Users, label: 'Utilisateurs' },
    { id: 'groups' as const, icon: Shield, label: 'Groupes' },
    { id: 'mailaccounts' as const, icon: Mail, label: 'Comptes mail' },
    { id: 'plugins' as const, icon: Plug, label: 'Plugins' },
    { id: 'nextcloud' as const, icon: Cloud, label: 'NextCloud' },
    { id: 'system' as const, icon: Settings, label: 'Système' },
  ];

  return (
    <div className="h-full flex">
      <div className="w-56 border-r border-outlook-border bg-outlook-bg-primary flex-shrink-0 py-4">
        <h2 className="text-lg font-semibold px-4 mb-4 text-outlook-text-primary">Administration</h2>
        {tabs.map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`w-full flex items-center gap-2 px-4 py-2 text-sm transition-colors
                ${tab === t.id ? 'bg-outlook-bg-selected font-medium text-outlook-text-primary border-l-2 border-l-outlook-blue' : 'text-outlook-text-secondary hover:bg-outlook-bg-hover'}`}
            >
              <Icon size={16} /> {t.label}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl">
          {tab === 'users' && <UserManagement />}
          {tab === 'groups' && <GroupManagement />}
          {tab === 'mailaccounts' && <MailAccountManagement />}
          {tab === 'plugins' && <PluginManagement />}
          {tab === 'nextcloud' && <NextCloudSettings />}
          {tab === 'system' && <SystemSettings />}
        </div>
      </div>
    </div>
  );
}

function UserManagement() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const { data: users = [] } = useQuery({
    queryKey: ['admin-users'],
    queryFn: api.getAdminUsers,
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteAdminUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      toast.success('Utilisateur supprimé');
    },
  });

  const createMutation = useMutation({
    mutationFn: api.createAdminUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      setShowForm(false);
      toast.success('Utilisateur créé');
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold">Utilisateurs ({users.length})</h3>
        <button onClick={() => setShowForm(true)} className="bg-outlook-blue hover:bg-outlook-blue-hover text-white px-3 py-1.5 rounded-md text-sm flex items-center gap-1.5">
          <Plus size={14} /> Nouvel utilisateur
        </button>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-outlook-border text-left">
            <th className="py-2 px-3 font-medium text-outlook-text-secondary">Nom</th>
            <th className="py-2 px-3 font-medium text-outlook-text-secondary">E-mail</th>
            <th className="py-2 px-3 font-medium text-outlook-text-secondary">Rôle</th>
            <th className="py-2 px-3 font-medium text-outlook-text-secondary">Statut</th>
            <th className="py-2 px-3 font-medium text-outlook-text-secondary">Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user: any) => (
            <tr key={user.id} className="border-b border-outlook-border hover:bg-outlook-bg-hover">
              <td className="py-2 px-3 font-medium">{user.display_name}</td>
              <td className="py-2 px-3 text-outlook-text-secondary">{user.email}</td>
              <td className="py-2 px-3">
                <span className={`text-xs px-2 py-0.5 rounded ${user.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-700'}`}>
                  {user.role === 'admin' ? 'Admin' : 'Utilisateur'}
                </span>
              </td>
              <td className="py-2 px-3">
                {user.is_active ? (
                  <span className="text-outlook-success flex items-center gap-1 text-xs"><CheckCircle size={12} /> Actif</span>
                ) : (
                  <span className="text-outlook-danger flex items-center gap-1 text-xs"><XCircle size={12} /> Inactif</span>
                )}
              </td>
              <td className="py-2 px-3">
                <button onClick={() => confirm('Supprimer cet utilisateur ?') && deleteMutation.mutate(user.id)} className="p-1 hover:bg-red-50 rounded text-outlook-text-disabled hover:text-outlook-danger">
                  <Trash2 size={14} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {showForm && (
        <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-lg shadow-xl w-96 p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">Nouvel utilisateur</h3>
            <UserForm onSubmit={(data) => createMutation.mutate(data)} onClose={() => setShowForm(false)} isSubmitting={createMutation.isPending} />
          </div>
        </div>
      )}
    </div>
  );
}

function UserForm({ onSubmit, onClose, isSubmitting }: { onSubmit: (data: any) => void; onClose: () => void; isSubmitting: boolean }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState('user');

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit({ email, password, displayName, role }); }} className="space-y-3">
      <div><label className="text-xs text-outlook-text-secondary">Nom</label><input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm" /></div>
      <div><label className="text-xs text-outlook-text-secondary">E-mail</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm" /></div>
      <div><label className="text-xs text-outlook-text-secondary">Mot de passe</label><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm" /></div>
      <div><label className="text-xs text-outlook-text-secondary">Rôle</label><select value={role} onChange={(e) => setRole(e.target.value)} className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm"><option value="user">Utilisateur</option><option value="admin">Administrateur</option></select></div>
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-md hover:bg-outlook-bg-hover">Annuler</button>
        <button type="submit" disabled={isSubmitting} className="bg-outlook-blue hover:bg-outlook-blue-hover text-white px-4 py-2 text-sm rounded-md disabled:opacity-50">{isSubmitting ? 'Création...' : 'Créer'}</button>
      </div>
    </form>
  );
}

function GroupManagement() {
  const queryClient = useQueryClient();
  const { data: groups = [] } = useQuery({ queryKey: ['admin-groups'], queryFn: api.getAdminGroups });
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('#0078D4');

  const createMutation = useMutation({
    mutationFn: api.createAdminGroup,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin-groups'] }); setShowForm(false); setName(''); toast.success('Groupe créé'); },
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteAdminGroup,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin-groups'] }); toast.success('Groupe supprimé'); },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold">Groupes ({groups.length})</h3>
        <button onClick={() => setShowForm(!showForm)} className="bg-outlook-blue hover:bg-outlook-blue-hover text-white px-3 py-1.5 rounded-md text-sm flex items-center gap-1.5">
          <Plus size={14} /> Nouveau groupe
        </button>
      </div>

      {showForm && (
        <form onSubmit={(e) => { e.preventDefault(); createMutation.mutate({ name, description, color }); }} className="mb-4 p-4 border border-outlook-border rounded-lg flex items-end gap-3">
          <div className="flex-1"><label className="text-xs text-outlook-text-secondary">Nom</label><input type="text" value={name} onChange={(e) => setName(e.target.value)} required className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm" /></div>
          <div className="flex-1"><label className="text-xs text-outlook-text-secondary">Description</label><input type="text" value={description} onChange={(e) => setDescription(e.target.value)} className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm" /></div>
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="w-10 h-10 border-0" />
          <button type="submit" className="bg-outlook-blue text-white px-4 py-2 rounded-md text-sm">Créer</button>
        </form>
      )}

      <div className="space-y-2">
        {groups.map((group: any) => (
          <div key={group.id} className="flex items-center justify-between p-3 border border-outlook-border rounded-lg">
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 rounded" style={{ backgroundColor: group.color }} />
              <div>
                <div className="font-medium text-sm">{group.name}</div>
                {group.description && <div className="text-xs text-outlook-text-secondary">{group.description}</div>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-outlook-text-disabled">{group.member_count || 0} membres</span>
              <button onClick={() => confirm('Supprimer ce groupe ?') && deleteMutation.mutate(group.id)} className="p-1 hover:bg-red-50 rounded text-outlook-text-disabled hover:text-outlook-danger">
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MailAccountManagement() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [assigningAccount, setAssigningAccount] = useState<any>(null);

  const { data: accounts = [] } = useQuery({
    queryKey: ['admin-mail-accounts'],
    queryFn: api.getAdminMailAccounts,
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteAdminMailAccount,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-mail-accounts'] });
      toast.success('Compte mail supprimé');
    },
  });

  const testMutation = useMutation({
    mutationFn: api.testAdminMailAccount,
    onSuccess: (result) => {
      if (result.success) toast.success('Connexion réussie');
      else toast.error(`Erreur: ${result.error}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold">Comptes mail ({accounts.length})</h3>
        <button onClick={() => { setEditing(null); setShowForm(true); }} className="bg-outlook-blue hover:bg-outlook-blue-hover text-white px-3 py-1.5 rounded-md text-sm flex items-center gap-1.5">
          <Plus size={14} /> Nouveau compte
        </button>
      </div>

      <div className="space-y-3">
        {accounts.map((account: any) => (
          <div key={account.id} className="border border-outlook-border rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: account.color }} />
                <div>
                  <div className="font-medium text-sm">{account.name}</div>
                  <div className="text-xs text-outlook-text-secondary">{account.email}</div>
                  <div className="text-xs text-outlook-text-disabled">{account.imap_host} / {account.smtp_host}</div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {account.is_shared && (
                  <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded mr-2">Partagé</span>
                )}
                <span className="text-xs text-outlook-text-disabled mr-2">{account.assignment_count || 0} utilisateur(s)</span>
                <button onClick={() => setAssigningAccount(account)} className="p-1.5 hover:bg-outlook-bg-hover rounded text-outlook-text-secondary" title="Gérer les attributions">
                  <UserPlus size={14} />
                </button>
                <button onClick={() => testMutation.mutate(account.id)} className="p-1.5 hover:bg-outlook-bg-hover rounded text-outlook-text-secondary" title="Tester">
                  <TestTube size={14} />
                </button>
                <button onClick={() => { setEditing(account); setShowForm(true); }} className="p-1.5 hover:bg-outlook-bg-hover rounded text-outlook-text-secondary" title="Modifier">
                  <Edit2 size={14} />
                </button>
                <button onClick={() => confirm('Supprimer ce compte mail ?') && deleteMutation.mutate(account.id)} className="p-1.5 hover:bg-red-50 rounded text-outlook-text-secondary hover:text-outlook-danger" title="Supprimer">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </div>
        ))}
        {accounts.length === 0 && (
          <div className="text-center py-8 text-outlook-text-disabled text-sm">Aucun compte mail configuré</div>
        )}
      </div>

      {showForm && (
        <AdminMailAccountForm
          account={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
        />
      )}

      {assigningAccount && (
        <AssignmentManager
          account={assigningAccount}
          onClose={() => setAssigningAccount(null)}
        />
      )}
    </div>
  );
}

function AdminMailAccountForm({ account, onClose }: { account: any; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(account?.name || '');
  const [email, setEmail] = useState(account?.email || '');
  const [imapHost, setImapHost] = useState(account?.imap_host || '');
  const [imapPort, setImapPort] = useState(account?.imap_port || 993);
  const [smtpHost, setSmtpHost] = useState(account?.smtp_host || '');
  const [smtpPort, setSmtpPort] = useState(account?.smtp_port || 465);
  const [username, setUsername] = useState(account?.username || '');
  const [password, setPassword] = useState('');
  const [isShared, setIsShared] = useState(account?.is_shared || false);
  const [color, setColor] = useState(account?.color || '#0078D4');
  const [signatureHtml, setSignatureHtml] = useState(account?.signature_html || '');

  const mutation = useMutation({
    mutationFn: (data: any) => account ? api.updateAdminMailAccount(account.id, data) : api.createAdminMailAccount(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-mail-accounts'] });
      onClose();
      toast.success(account ? 'Compte mis à jour' : 'Compte créé');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate({
      name, email, imapHost, imapPort, smtpHost, smtpPort,
      username: username || email, password: password || undefined,
      isShared, color, signatureHtml,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-[560px] max-h-[85vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">{account ? 'Modifier le compte' : 'Nouveau compte mail'}</h2>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-outlook-text-secondary">Nom du compte</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} required className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-outlook-text-secondary">Adresse e-mail</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-outlook-text-secondary">Serveur IMAP</label>
              <input type="text" value={imapHost} onChange={(e) => setImapHost(e.target.value)} required placeholder="imap.example.com" className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-outlook-text-secondary">Port IMAP</label>
              <input type="number" value={imapPort} onChange={(e) => setImapPort(parseInt(e.target.value))} className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-outlook-text-secondary">Serveur SMTP</label>
              <input type="text" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} required placeholder="smtp.example.com" className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-outlook-text-secondary">Port SMTP</label>
              <input type="number" value={smtpPort} onChange={(e) => setSmtpPort(parseInt(e.target.value))} className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-outlook-text-secondary">Identifiant</label>
              <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder={email || 'email@example.com'} className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-outlook-text-secondary">Mot de passe</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required={!account} className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={isShared} onChange={(e) => setIsShared(e.target.checked)} className="rounded" />
              Boîte partagée
            </label>
            <div className="flex items-center gap-2">
              <label className="text-xs text-outlook-text-secondary">Couleur</label>
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="w-8 h-8 border-0 cursor-pointer" />
            </div>
          </div>
          <div>
            <label className="text-xs text-outlook-text-secondary">Signature (HTML)</label>
            <textarea value={signatureHtml} onChange={(e) => setSignatureHtml(e.target.value)} rows={3} placeholder="<p>Cordialement,<br/>Nom</p>" className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm resize-none font-mono" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-md hover:bg-outlook-bg-hover">Annuler</button>
            <button type="submit" disabled={mutation.isPending} className="bg-outlook-blue hover:bg-outlook-blue-hover text-white px-4 py-2 text-sm rounded-md disabled:opacity-50">
              {mutation.isPending ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AssignmentManager({ account, onClose }: { account: any; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [sendPermission, setSendPermission] = useState('none');
  const [isDefault, setIsDefault] = useState(false);

  const { data: assignments = [] } = useQuery({
    queryKey: ['mail-assignments', account.id],
    queryFn: () => api.getMailAccountAssignments(account.id),
  });

  const { data: users = [] } = useQuery({
    queryKey: ['admin-users'],
    queryFn: api.getAdminUsers,
  });

  const assignMutation = useMutation({
    mutationFn: (data: any) => api.createMailAccountAssignment(account.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mail-assignments', account.id] });
      queryClient.invalidateQueries({ queryKey: ['admin-mail-accounts'] });
      setUserId('');
      setDisplayName('');
      setSendPermission('none');
      setIsDefault(false);
      toast.success('Attribution créée');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ assignmentId, data }: { assignmentId: string; data: any }) =>
      api.updateMailAccountAssignment(account.id, assignmentId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mail-assignments', account.id] });
      toast.success('Attribution mise à jour');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (assignmentId: string) => api.deleteMailAccountAssignment(account.id, assignmentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mail-assignments', account.id] });
      queryClient.invalidateQueries({ queryKey: ['admin-mail-accounts'] });
      toast.success('Attribution supprimée');
    },
  });

  const assignedUserIds = new Set(assignments.map((a: any) => a.user_id));
  const availableUsers = users.filter((u: any) => !assignedUserIds.has(u.id));

  const PERM_LABELS: Record<string, string> = {
    none: 'Lecture seule',
    send_as: 'Envoyer de (send as)',
    send_on_behalf: 'Envoyer de la part de',
  };

  return (
    <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-[600px] max-h-[85vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <div>
            <h2 className="text-lg font-semibold">Attributions - {account.name}</h2>
            <p className="text-xs text-outlook-text-secondary">{account.email}</p>
          </div>
          <button onClick={onClose}><X size={18} /></button>
        </div>

        {/* Add assignment form */}
        <div className="border border-outlook-border rounded-lg p-3 mb-4">
          <h4 className="text-sm font-medium mb-2">Nouvelle attribution</h4>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-outlook-text-secondary">Utilisateur</label>
              <select value={userId} onChange={(e) => setUserId(e.target.value)} className="w-full border border-outlook-border rounded-md px-2 py-1.5 text-sm">
                <option value="">Sélectionner...</option>
                {availableUsers.map((u: any) => (
                  <option key={u.id} value={u.id}>{u.display_name} ({u.email})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-outlook-text-secondary">Nom affiché (navigation)</label>
              <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={account.name} className="w-full border border-outlook-border rounded-md px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="text-xs text-outlook-text-secondary">Permission d'envoi</label>
              <select value={sendPermission} onChange={(e) => setSendPermission(e.target.value)} className="w-full border border-outlook-border rounded-md px-2 py-1.5 text-sm">
                <option value="none">Lecture seule</option>
                <option value="send_as">Envoyer de (send as)</option>
                <option value="send_on_behalf">Envoyer de la part de</option>
              </select>
            </div>
            <div className="flex items-end gap-2">
              <label className="flex items-center gap-2 text-sm pb-1.5">
                <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} className="rounded" />
                Par défaut
              </label>
              <button
                onClick={() => userId && assignMutation.mutate({ userId, displayName: displayName || null, sendPermission, isDefault })}
                disabled={!userId || assignMutation.isPending}
                className="bg-outlook-blue hover:bg-outlook-blue-hover text-white px-3 py-1.5 rounded-md text-sm disabled:opacity-50"
              >
                Attribuer
              </button>
            </div>
          </div>
        </div>

        {/* Current assignments */}
        <h4 className="text-sm font-medium mb-2">Utilisateurs assignés ({assignments.length})</h4>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-outlook-border text-left">
              <th className="py-1.5 px-2 font-medium text-outlook-text-secondary text-xs">Utilisateur</th>
              <th className="py-1.5 px-2 font-medium text-outlook-text-secondary text-xs">Nom affiché</th>
              <th className="py-1.5 px-2 font-medium text-outlook-text-secondary text-xs">Permission</th>
              <th className="py-1.5 px-2 font-medium text-outlook-text-secondary text-xs">Actions</th>
            </tr>
          </thead>
          <tbody>
            {assignments.map((a: any) => (
              <tr key={a.id} className="border-b border-outlook-border hover:bg-outlook-bg-hover">
                <td className="py-1.5 px-2">
                  <div className="font-medium">{a.user_display_name}</div>
                  <div className="text-xs text-outlook-text-secondary">{a.user_email}</div>
                </td>
                <td className="py-1.5 px-2 text-outlook-text-secondary">{a.display_name || account.name}</td>
                <td className="py-1.5 px-2">
                  <select
                    value={a.send_permission}
                    onChange={(e) => updateMutation.mutate({ assignmentId: a.id, data: { sendPermission: e.target.value } })}
                    className="text-xs border border-outlook-border rounded px-1.5 py-0.5"
                  >
                    <option value="none">Lecture seule</option>
                    <option value="send_as">Send as</option>
                    <option value="send_on_behalf">De la part de</option>
                  </select>
                </td>
                <td className="py-1.5 px-2">
                  <button onClick={() => confirm('Retirer cette attribution ?') && deleteMutation.mutate(a.id)} className="p-1 hover:bg-red-50 rounded text-outlook-text-disabled hover:text-outlook-danger">
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {assignments.length === 0 && (
          <div className="text-center py-4 text-outlook-text-disabled text-sm">Aucun utilisateur assigné</div>
        )}
      </div>
    </div>
  );
}

function PluginManagement() {
  const queryClient = useQueryClient();
  const { data: plugins = [] } = useQuery({ queryKey: ['admin-plugins'], queryFn: api.getAllPlugins });

  const toggleMutation = useMutation({
    mutationFn: api.togglePlugin,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin-plugins'] }); toast.success('Plugin mis à jour'); },
  });

  const deleteMutation = useMutation({
    mutationFn: api.deletePlugin,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin-plugins'] }); toast.success('Plugin supprimé'); },
  });

  return (
    <div>
      <h3 className="text-base font-semibold mb-4">Plugins ({plugins.length})</h3>
      <div className="space-y-3">
        {plugins.map((plugin: any) => (
          <div key={plugin.id} className="border border-outlook-border rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-outlook-blue/10 rounded-lg flex items-center justify-center text-outlook-blue">
                  <Plug size={20} />
                </div>
                <div>
                  <div className="font-medium">{plugin.display_name || plugin.name}</div>
                  <div className="text-xs text-outlook-text-secondary">{plugin.description}</div>
                  <div className="text-xs text-outlook-text-disabled">v{plugin.version} {plugin.author && `par ${plugin.author}`}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => toggleMutation.mutate(plugin.id)}
                  className={`text-xs px-3 py-1 rounded-full ${plugin.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}
                >
                  {plugin.is_active ? 'Actif' : 'Inactif'}
                </button>
                {!plugin.is_system && (
                  <button onClick={() => confirm('Supprimer ce plugin ?') && deleteMutation.mutate(plugin.id)} className="p-1 hover:bg-red-50 rounded text-outlook-text-disabled hover:text-outlook-danger">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
        {plugins.length === 0 && (
          <div className="text-center py-8 text-outlook-text-disabled text-sm">Aucun plugin installé</div>
        )}
      </div>
    </div>
  );
}

function NextCloudSettings() {
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const { data: settings } = useQuery({
    queryKey: ['admin-settings'],
    queryFn: api.getAdminSettings,
  });

  const updateMutation = useMutation({
    mutationFn: api.updateAdminSettings,
    onSuccess: () => toast.success('Paramètres NextCloud sauvegardés'),
  });

  const testMutation = useMutation({
    mutationFn: () => api.testNextcloud(url || settings?.nextcloud_url, username || settings?.nextcloud_username, password),
    onSuccess: (result: any) => {
      if (result.success) toast.success('Connexion NextCloud réussie');
      else toast.error(`Erreur: ${result.error}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div>
      <h3 className="text-base font-semibold mb-4 flex items-center gap-2">
        <Cloud size={20} className="text-outlook-blue" /> Intégration NextCloud
      </h3>
      <p className="text-sm text-outlook-text-secondary mb-4">
        Connectez une instance NextCloud pour synchroniser les calendriers, contacts et images de profil.
      </p>

      <div className="space-y-3">
        <div>
          <label className="text-xs text-outlook-text-secondary">URL NextCloud</label>
          <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={settings?.nextcloud_url || 'https://cloud.example.com'}
            className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm mt-1" />
        </div>
        <div>
          <label className="text-xs text-outlook-text-secondary">Identifiant</label>
          <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder={settings?.nextcloud_username || 'admin'}
            className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm mt-1" />
        </div>
        <div>
          <label className="text-xs text-outlook-text-secondary">Mot de passe / Token</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"
            className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm mt-1" />
        </div>

        <div className="flex gap-2 pt-2">
          <button onClick={() => testMutation.mutate()} className="bg-gray-100 hover:bg-gray-200 px-4 py-2 rounded-md text-sm flex items-center gap-2">
            <RefreshCw size={14} /> Tester la connexion
          </button>
          <button
            onClick={() => updateMutation.mutate({ nextcloud_url: url, nextcloud_username: username, nextcloud_password: password })}
            className="bg-outlook-blue hover:bg-outlook-blue-hover text-white px-4 py-2 rounded-md text-sm"
          >
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
}

function SystemSettings() {
  const { data: settings } = useQuery({ queryKey: ['admin-settings'], queryFn: api.getAdminSettings });
  const updateMutation = useMutation({
    mutationFn: api.updateAdminSettings,
    onSuccess: () => toast.success('Paramètres système sauvegardés'),
  });

  return (
    <div>
      <h3 className="text-base font-semibold mb-4">Paramètres système</h3>
      <div className="space-y-4">
        <div>
          <label className="text-sm text-outlook-text-secondary">Nom de l'application</label>
          <input type="text" defaultValue={settings?.app_name || 'WebMail'} className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm mt-1" />
        </div>
        <div>
          <label className="text-sm text-outlook-text-secondary">Inscription ouverte</label>
          <select defaultValue={settings?.allow_registration ? 'true' : 'false'} className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm mt-1">
            <option value="true">Oui</option>
            <option value="false">Non (admin seulement)</option>
          </select>
        </div>
        <div>
          <label className="text-sm text-outlook-text-secondary">Taille max des pièces jointes (Mo)</label>
          <input type="number" defaultValue={settings?.max_attachment_size || 25} className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm mt-1" />
        </div>
      </div>
    </div>
  );
}
