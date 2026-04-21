import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useAuthStore } from '../stores/authStore';
import {
  User, Mail, Lock, Palette, Globe, Bell, Plug,
  Eye, EyeOff, Save, Paperclip
} from 'lucide-react';
import toast from 'react-hot-toast';

type Tab = 'profile' | 'accounts' | 'mail' | 'appearance' | 'notifications';

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('profile');

  const tabs = [
    { id: 'profile' as const, icon: User, label: 'Profil' },
    { id: 'accounts' as const, icon: Mail, label: 'Mes boîtes mail' },
    { id: 'mail' as const, icon: Paperclip, label: 'Messagerie' },
    { id: 'appearance' as const, icon: Palette, label: 'Apparence' },
    { id: 'notifications' as const, icon: Bell, label: 'Notifications' },
  ];

  return (
    <div className="h-full flex">
      {/* Sidebar */}
      <div className="w-56 border-r border-outlook-border bg-outlook-bg-primary flex-shrink-0 py-4">
        <h2 className="text-lg font-semibold px-4 mb-4 text-outlook-text-primary">Paramètres</h2>
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

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl">
          {tab === 'profile' && <ProfileSettings />}
          {tab === 'accounts' && <AccountSettings />}
          {tab === 'mail' && <MailBehaviorSettings />}
          {tab === 'appearance' && <AppearanceSettings />}
          {tab === 'notifications' && <NotificationSettings />}
        </div>
      </div>
    </div>
  );
}

function MailBehaviorSettings() {
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: api.getSettings,
  });

  const [attachmentActionMode, setAttachmentActionMode] = useState<'preview' | 'download' | 'menu'>('preview');

  const updateMutation = useMutation({
    mutationFn: api.updateSettings,
    onSuccess: () => toast.success('Préférences de messagerie sauvegardées'),
    onError: (e: any) => toast.error(e.message),
  });

  useEffect(() => {
    const mode = settings?.attachment_action_mode;
    if (mode === 'preview' || mode === 'download' || mode === 'menu') {
      setAttachmentActionMode(mode);
    }
  }, [settings?.attachment_action_mode]);

  return (
    <div>
      <h3 className="text-base font-semibold mb-3">Messagerie</h3>
      <div className="space-y-4">
        <div>
          <label className="text-sm text-outlook-text-secondary">Ouverture des pièces jointes</label>
          <select
            value={attachmentActionMode}
            onChange={(e) => setAttachmentActionMode(e.target.value as 'preview' | 'download' | 'menu')}
            className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm mt-1"
          >
            <option value="preview">Aperçu</option>
            <option value="download">Téléchargement</option>
            <option value="menu">Menu (Aperçu / Télécharger)</option>
          </select>
          <p className="text-xs text-outlook-text-disabled mt-1">
            Cette préférence est identique à l'option du ruban Afficher &gt; Pièce jointe.
          </p>
        </div>

        <div>
          <button
            onClick={() => updateMutation.mutate({ attachmentActionMode })}
            disabled={updateMutation.isPending}
            className="bg-outlook-blue hover:bg-outlook-blue-hover text-white px-4 py-2 rounded-md text-sm flex items-center gap-2 disabled:opacity-50"
          >
            <Save size={14} />
            {updateMutation.isPending ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ProfileSettings() {
  const { user, updateUser } = useAuthStore();
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const updateMutation = useMutation({
    mutationFn: (data: any) => api.updateSettings(data),
    onSuccess: () => {
      updateUser({ displayName });
      toast.success('Profil mis à jour');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const passwordMutation = useMutation({
    mutationFn: () => api.changePassword(currentPassword, newPassword),
    onSuccess: () => {
      setCurrentPassword('');
      setNewPassword('');
      toast.success('Mot de passe modifié');
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-base font-semibold mb-3">Profil</h3>
        <div className="space-y-3">
          <div>
            <label className="text-sm text-outlook-text-secondary">Nom d'affichage</label>
            <input
              type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)}
              className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm mt-1 focus:outline-none focus:border-outlook-blue"
            />
          </div>
          <div>
            <label className="text-sm text-outlook-text-secondary">E-mail</label>
            <input type="email" value={user?.email || ''} disabled className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm mt-1 bg-gray-50" />
          </div>
          <button
            onClick={() => updateMutation.mutate({ displayName })}
            className="bg-outlook-blue hover:bg-outlook-blue-hover text-white px-4 py-2 rounded-md text-sm flex items-center gap-2"
          >
            <Save size={14} /> Enregistrer
          </button>
        </div>
      </section>

      <section className="border-t border-outlook-border pt-6">
        <h3 className="text-base font-semibold mb-3">Changer le mot de passe</h3>
        <div className="space-y-3">
          <div>
            <label className="text-sm text-outlook-text-secondary">Mot de passe actuel</label>
            <div className="relative mt-1">
              <input
                type={showPassword ? 'text' : 'password'} value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm pr-10 focus:outline-none focus:border-outlook-blue"
              />
              <button onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-outlook-text-disabled">
                {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
          <div>
            <label className="text-sm text-outlook-text-secondary">Nouveau mot de passe</label>
            <input
              type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={8}
              className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm mt-1 focus:outline-none focus:border-outlook-blue"
            />
          </div>
          <button
            onClick={() => passwordMutation.mutate()}
            disabled={!currentPassword || !newPassword || newPassword.length < 8}
            className="bg-outlook-blue hover:bg-outlook-blue-hover text-white px-4 py-2 rounded-md text-sm disabled:opacity-50 flex items-center gap-2"
          >
            <Lock size={14} /> Modifier le mot de passe
          </button>
        </div>
      </section>
    </div>
  );
}

function AccountSettings() {
  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: api.getAccounts,
  });

  const PERM_LABELS: Record<string, string> = {
    none: 'Lecture seule',
    send_as: 'Envoyer de (send as)',
    send_on_behalf: 'Envoyer de la part de',
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold">Mes boîtes mail</h3>
      </div>
      <p className="text-sm text-outlook-text-secondary mb-4">
        Les comptes mail sont gérés par l'administrateur. Contactez-le pour modifier vos accès.
      </p>

      <div className="space-y-3">
        {accounts.map((account: any) => (
          <div key={account.id} className="border border-outlook-border rounded-lg p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: account.color }} />
              <div>
                <div className="font-medium text-sm">{account.assigned_display_name || account.name}</div>
                <div className="text-xs text-outlook-text-secondary">{account.email}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {account.assigned_default && (
                <span className="text-xs bg-outlook-blue/10 text-outlook-blue px-2 py-0.5 rounded">Par défaut</span>
              )}
              <span className={`text-xs px-2 py-0.5 rounded ${
                account.send_permission === 'send_as' ? 'bg-green-50 text-green-700' :
                account.send_permission === 'send_on_behalf' ? 'bg-orange-50 text-orange-700' :
                'bg-gray-100 text-gray-600'
              }`}>
                {PERM_LABELS[account.send_permission] || 'Lecture seule'}
              </span>
            </div>
          </div>
        ))}
        {accounts.length === 0 && (
          <div className="text-center py-8 text-outlook-text-disabled text-sm">Aucun compte mail attribué</div>
        )}
      </div>
    </div>
  );
}

function AppearanceSettings() {
  const updateMutation = useMutation({
    mutationFn: api.updateSettings,
    onSuccess: () => toast.success('Préférences sauvegardées'),
  });

  return (
    <div>
      <h3 className="text-base font-semibold mb-3">Apparence</h3>
      <div className="space-y-4">
        <div>
          <label className="text-sm text-outlook-text-secondary">Thème</label>
          <select className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm mt-1">
            <option value="light">Clair</option>
            <option value="dark">Sombre</option>
            <option value="system">Système</option>
          </select>
        </div>
        <div>
          <label className="text-sm text-outlook-text-secondary">Langue</label>
          <select className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm mt-1">
            <option value="fr">Français</option>
            <option value="en">English</option>
          </select>
        </div>
        <div>
          <label className="text-sm text-outlook-text-secondary">Fuseau horaire</label>
          <select className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm mt-1">
            <option value="Europe/Paris">Europe/Paris (UTC+1/+2)</option>
            <option value="Europe/London">Europe/London (UTC+0/+1)</option>
          </select>
        </div>
      </div>
    </div>
  );
}

function NotificationSettings() {
  return (
    <div>
      <h3 className="text-base font-semibold mb-3">Notifications</h3>
      <div className="space-y-3">
        <label className="flex items-center justify-between">
          <span className="text-sm">Notifications de nouveaux messages</span>
          <input type="checkbox" defaultChecked className="rounded" />
        </label>
        <label className="flex items-center justify-between">
          <span className="text-sm">Son de notification</span>
          <input type="checkbox" defaultChecked className="rounded" />
        </label>
        <label className="flex items-center justify-between">
          <span className="text-sm">Notifications du calendrier</span>
          <input type="checkbox" defaultChecked className="rounded" />
        </label>
      </div>
    </div>
  );
}
