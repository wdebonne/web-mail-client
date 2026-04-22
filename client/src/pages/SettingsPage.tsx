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
  const [supported] = useState(() =>
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'denied'
  );
  const [subscribed, setSubscribed] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [sound, setSound] = useState<boolean>(() => localStorage.getItem('notifications.sound') !== 'false');
  const [calendar, setCalendar] = useState<boolean>(() => localStorage.getItem('notifications.calendar') !== 'false');

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { getExistingSubscription } = await import('../pwa/push');
        const sub = await getExistingSubscription();
        if (mounted) setSubscribed(!!sub);
      } catch {
        /* ignore */
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    localStorage.setItem('notifications.sound', String(sound));
  }, [sound]);
  useEffect(() => {
    localStorage.setItem('notifications.calendar', String(calendar));
  }, [calendar]);

  const toggle = async () => {
    try {
      const mod = await import('../pwa/push');
      if (subscribed) {
        await mod.unsubscribeFromPush();
        setSubscribed(false);
        toast.success('Notifications push désactivées');
      } else {
        await mod.subscribeToPush();
        setSubscribed(true);
        setPermission(Notification.permission);
        toast.success('Notifications push activées');
      }
    } catch (e: any) {
      toast.error(e.message || 'Échec de la mise à jour');
    }
  };

  const test = async () => {
    try {
      const { sendTestPush } = await import('../pwa/push');
      const sent = await sendTestPush();
      toast.success(sent > 0
        ? `Notification envoyée à ${sent} appareil${sent > 1 ? 's' : ''}`
        : 'Aucun appareil enregistré');
    } catch (e: any) {
      toast.error(e.message || 'Échec du test');
    }
  };

  return (
    <div>
      <h3 className="text-base font-semibold mb-3">Notifications</h3>

      {!supported && (
        <div className="mb-4 p-3 rounded border border-amber-300 bg-amber-50 text-amber-900 text-sm">
          Votre navigateur ne prend pas en charge les notifications push natives.
          Sur iPhone / iPad, ajoutez l'application à l'écran d'accueil via Safari pour activer les notifications (iOS 16.4+).
        </div>
      )}

      {supported && permission === 'denied' && (
        <div className="mb-4 p-3 rounded border border-red-300 bg-red-50 text-red-900 text-sm">
          Les notifications sont bloquées dans les paramètres du navigateur. Autorisez-les manuellement pour cette application.
        </div>
      )}

      <div className="space-y-4">
        <div className="flex items-center justify-between p-3 rounded border border-outlook-border bg-outlook-bg-primary">
          <div className="min-w-0">
            <div className="text-sm font-medium">Notifications push natives</div>
            <div className="text-xs text-outlook-text-secondary mt-0.5">
              {subscribed
                ? 'Actives sur cet appareil — les nouveaux messages déclenchent une notification système.'
                : 'Recevez les nouveaux messages directement dans Windows, macOS, Android ou iOS (PWA installée).'}
            </div>
          </div>
          <button
            onClick={toggle}
            disabled={!supported || loading || permission === 'denied'}
            className={`ml-4 px-3 py-1.5 text-sm rounded font-medium transition-colors ${
              subscribed
                ? 'bg-red-600 hover:bg-red-700 text-white'
                : 'bg-outlook-blue hover:brightness-110 text-white'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {subscribed ? 'Désactiver' : 'Activer'}
          </button>
        </div>

        {subscribed && (
          <div className="pl-1">
            <button
              onClick={test}
              className="px-3 py-1.5 text-sm rounded border border-outlook-border hover:bg-outlook-bg-hover"
            >
              Envoyer une notification de test
            </button>
          </div>
        )}

        <label className="flex items-center justify-between">
          <span className="text-sm">Son de notification</span>
          <input
            type="checkbox"
            checked={sound}
            onChange={(e) => setSound(e.target.checked)}
            className="rounded"
          />
        </label>
        <label className="flex items-center justify-between">
          <span className="text-sm">Notifications du calendrier</span>
          <input
            type="checkbox"
            checked={calendar}
            onChange={(e) => setCalendar(e.target.checked)}
            className="rounded"
          />
        </label>
      </div>

      <div className="mt-6 p-3 rounded border border-outlook-border bg-outlook-bg-secondary/40 text-xs text-outlook-text-secondary space-y-1">
        <div><strong>Astuce :</strong></div>
        <div>• <strong>Windows 11</strong> : installez l'application (Chrome/Edge/Vivaldi → icône d'installation <em>⊕</em> dans la barre d'adresse, ou menu → « Installer WebMail… »). Une fois installée, les notifications s'affichent sous le nom « WebMail » (et non plus « Chrome » / « Vivaldi ») avec son, bannière et icône dédiés — comme Outlook.</div>
        <div>• <strong>Vivaldi / Chrome / Edge — pas de son ou notification minuscule ?</strong> Activez les notifications système natives : ouvrez <code>vivaldi://flags/#enable-system-notifications</code> (ou <code>chrome://flags</code> / <code>edge://flags</code>), passez sur <em>Enabled</em> et redémarrez le navigateur.</div>
        <div>• <strong>Windows</strong> : vérifiez <em>Paramètres &gt; Système &gt; Notifications</em> — activez l'app (Vivaldi/Chrome/WebMail) et, en cliquant dessus, réglez <em>Son</em>, <em>Bannière</em> et <em>Priorité : Élevée</em>. Désactivez <em>« Ne pas déranger »</em> / Focus.</div>
        <div>• <strong>macOS</strong> : installez l'app, puis autorisez-la dans <em>Réglages Système &gt; Notifications</em> (style « Alertes » pour qu'elles restent affichées).</div>
        <div>• <strong>Android</strong> : menu « Ajouter à l'écran d'accueil » depuis Chrome.</div>
        <div>• <strong>iOS / iPadOS</strong> : Safari → Partager → « Sur l'écran d'accueil », puis activez les notifications ici (iOS 16.4+).</div>
      </div>
    </div>
  );
}
