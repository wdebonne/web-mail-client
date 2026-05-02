/**
 * Éditeur de préférences de notifications avec aperçu en direct.
 *
 * Réutilisé par la page Réglages (utilisateur) et la section Notifications
 * de l'administration. La prop `mode` ne change que l'étiquetage et
 * l'endroit où la valeur est persistée (le composant lui-même reste
 * « controlled »).
 */

import { useMemo, useState } from 'react';
import {
  Monitor, Smartphone, Tablet, Volume2, BellRing, Send, Eye, RotateCcw,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  NotificationPrefs, PlatformNotificationPrefs, NotificationPlatform,
  NotificationContext, NotificationActionConfig, NotificationActionId,
  ACTION_PRESETS, ACTION_LABELS, SOUND_OPTIONS, BuiltinSoundId,
  VibratePresetId, getDefaultNotificationPrefs, playNotificationSound,
  buildNotificationContent, resolveVibratePattern, detectCurrentPlatform,
} from '../../utils/notificationPrefs';
import NotificationPreview from './NotificationPreview';

interface Props {
  value: NotificationPrefs;
  onChange: (next: NotificationPrefs) => void;
  /** « user » : aperçu + bouton « Test sur cet appareil »,
   *  « admin » : indique que la valeur sert de défaut pour les utilisateurs. */
  mode?: 'user' | 'admin';
  /** Lorsqu'il existe, fournit un test push réel via le serveur. */
  onSendServerTest?: (platform: NotificationPlatform) => Promise<void>;
}

const PLATFORMS: { id: NotificationPlatform; label: string; Icon: any }[] = [
  { id: 'desktop', label: 'Bureau', Icon: Monitor },
  { id: 'mobile',  label: 'Mobile', Icon: Smartphone },
  { id: 'tablet',  label: 'Tablette', Icon: Tablet },
];

const VIBRATE_OPTIONS: { id: VibratePresetId; label: string }[] = [
  { id: 'none', label: 'Aucune' },
  { id: 'short', label: 'Courte' },
  { id: 'standard', label: 'Standard' },
  { id: 'long', label: 'Longue' },
  { id: 'double', label: 'Double pulsation' },
  { id: 'custom', label: 'Personnalisée' },
];

const PLACEHOLDERS: { token: string; description: string }[] = [
  { token: '{sender}', description: "Nom de l'expéditeur" },
  { token: '{senderEmail}', description: "Adresse e-mail de l'expéditeur" },
  { token: '{accountEmail}', description: 'Boîte mail destinataire' },
  { token: '{accountName}', description: 'Nom du compte destinataire' },
  { token: '{appName}', description: "Nom de l'application" },
  { token: '{siteUrl}', description: 'Adresse du site' },
  { token: '{subject}', description: 'Objet du mail' },
  { token: '{preview}', description: 'Aperçu du contenu' },
];

function actionsEqual(a: NotificationActionConfig[], b: NotificationActionConfig[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => x.id === b[i].id && (x.label || '') === (b[i].label || ''));
}

function findPresetId(actions: NotificationActionConfig[]): string {
  const match = ACTION_PRESETS.find((p) => actionsEqual(p.actions, actions));
  return match ? match.id : 'custom';
}

export default function NotificationPreferencesEditor({
  value, onChange, mode = 'user', onSendServerTest,
}: Props) {
  const [platform, setPlatform] = useState<NotificationPlatform>(() => detectCurrentPlatform());

  const platformPrefs = value[platform];

  const updatePlatform = (patch: Partial<PlatformNotificationPrefs>) => {
    onChange({
      ...value,
      [platform]: { ...platformPrefs, ...patch },
    });
  };

  const sampleCtx: NotificationContext = useMemo(() => ({
    sender: 'Frédéric Debonne',
    senderEmail: 'frederic@example.com',
    accountEmail: 'wdebonne@hotmail.com',
    accountName: 'Pro',
    appName: value.appName || 'WebMail',
    siteUrl: value.siteUrl || (typeof window !== 'undefined' ? window.location.host : ''),
    subject: 'Test objet',
    preview: 'Test Corp message Envoyé à partir de Outlook pour Android',
  }), [value.appName, value.siteUrl]);

  // ---------- Tests --------------------------------------------------------
  const playSoundOnly = async () => {
    await playNotificationSound(platformPrefs.sound, platformPrefs.soundVolume, platformPrefs.customSoundUrl);
  };

  const localBrowserTest = async () => {
    try {
      if (typeof Notification === 'undefined') {
        toast.error('Notifications non supportées par ce navigateur');
        return;
      }
      let perm = Notification.permission;
      if (perm === 'default') perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        toast.error('Autorisez les notifications pour ce site');
        return;
      }
      const { title, body } = buildNotificationContent(value, platform, sampleCtx);
      const reg = await navigator.serviceWorker?.ready;
      const opts: NotificationOptions & { actions?: any[]; vibrate?: number[] } = {
        body,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        silent: platformPrefs.silent || platformPrefs.sound === 'none',
        requireInteraction: platformPrefs.requireInteraction,
        tag: 'notif-preview',
        data: { url: '/mail', preview: true },
      };
      if (platform !== 'desktop') opts.vibrate = resolveVibratePattern(platformPrefs);
      // Les `actions` ne sont supportées qu'à travers le ServiceWorker.
      if (reg && platformPrefs.actions.length) {
        (opts as any).actions = platformPrefs.actions.map((a) => ({
          action: a.id,
          title: a.label || ACTION_LABELS[a.id] || a.id,
        }));
        await reg.showNotification(title, opts);
      } else {
        // Fallback Notification API (sans actions).
        new Notification(title, opts);
      }
      // Joue aussi le son personnalisé en parallèle (lorsque l'app est
      // ouverte, le son OS est souvent muet — nous reproduisons donc le
      // rendu attendu de manière audible).
      void playSoundOnly();
    } catch (e: any) {
      toast.error(e?.message || 'Test impossible');
    }
  };

  const serverTest = async () => {
    if (!onSendServerTest) return;
    try {
      await onSendServerTest(platform);
      toast.success('Notification envoyée — surveillez votre appareil');
    } catch (e: any) {
      toast.error(e?.message || 'Échec du test serveur');
    }
  };

  const reset = () => {
    const def = getDefaultNotificationPrefs();
    onChange({ ...value, [platform]: def[platform] });
    toast.success('Plateforme réinitialisée');
  };

  const presetId = findPresetId(platformPrefs.actions);

  // ---------- Render -------------------------------------------------------
  return (
    <div className="space-y-6">
      {mode === 'admin' && (
        <div className="text-xs text-outlook-text-secondary p-3 rounded border border-outlook-border bg-outlook-bg-secondary/40">
          Ces valeurs servent de <strong>défaut serveur</strong> pour tous les utilisateurs
          n'ayant pas personnalisé leurs notifications dans <em>Réglages → Notifications</em>.
        </div>
      )}

      {/* Toggle global + identité */}
      <div className="grid sm:grid-cols-3 gap-3">
        <label className="flex items-center gap-2 p-3 border border-outlook-border rounded-md">
          <input
            type="checkbox"
            checked={value.enabled}
            onChange={(e) => onChange({ ...value, enabled: e.target.checked })}
          />
          <span className="text-sm font-medium">Notifications activées</span>
        </label>
        <div className="p-3 border border-outlook-border rounded-md">
          <label className="text-xs text-outlook-text-secondary">Nom de l'application</label>
          <input
            type="text" value={value.appName}
            onChange={(e) => onChange({ ...value, appName: e.target.value })}
            className="w-full mt-1 px-2 py-1 text-sm border border-outlook-border rounded"
          />
        </div>
        <div className="p-3 border border-outlook-border rounded-md">
          <label className="text-xs text-outlook-text-secondary">Adresse du site</label>
          <input
            type="text" value={value.siteUrl} placeholder="ex. mail.exemple.com"
            onChange={(e) => onChange({ ...value, siteUrl: e.target.value })}
            className="w-full mt-1 px-2 py-1 text-sm border border-outlook-border rounded"
          />
        </div>
      </div>

      {/* Sélecteur de plateforme */}
      <div className="flex flex-wrap gap-2">
        {PLATFORMS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setPlatform(id)}
            className={`flex items-center gap-2 px-3 py-2 rounded border text-sm transition-colors ${
              platform === id
                ? 'border-outlook-blue bg-outlook-blue/10 text-outlook-blue'
                : 'border-outlook-border hover:bg-outlook-bg-hover'
            }`}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
        <button
          type="button"
          onClick={reset}
          className="ml-auto flex items-center gap-1 px-3 py-2 text-xs text-outlook-text-secondary hover:bg-outlook-bg-hover rounded border border-outlook-border"
          title="Réinitialiser cette plateforme"
        >
          <RotateCcw size={12} /> Réinitialiser
        </button>
      </div>

      <div className="grid lg:grid-cols-[1fr_minmax(280px,360px)] gap-6">
        {/* Colonne édition */}
        <div className="space-y-5">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={platformPrefs.enabled}
              onChange={(e) => updatePlatform({ enabled: e.target.checked })}
            />
            <span className="text-sm font-medium">Activer sur ce support</span>
          </label>

          {/* Templates */}
          <section className="space-y-2">
            <div className="text-sm font-semibold flex items-center gap-2">
              <Eye size={14} /> Modèle de la notification
            </div>
            <div>
              <label className="text-xs text-outlook-text-secondary">Titre</label>
              <input
                type="text" value={platformPrefs.titleTemplate}
                onChange={(e) => updatePlatform({ titleTemplate: e.target.value })}
                className="w-full mt-1 px-2 py-1 text-sm border border-outlook-border rounded font-mono"
              />
            </div>
            <div>
              <label className="text-xs text-outlook-text-secondary">Corps</label>
              <textarea
                rows={3}
                value={platformPrefs.bodyTemplate}
                onChange={(e) => updatePlatform({ bodyTemplate: e.target.value })}
                className="w-full mt-1 px-2 py-1 text-sm border border-outlook-border rounded font-mono"
              />
            </div>
            <details className="text-xs text-outlook-text-secondary">
              <summary className="cursor-pointer hover:text-outlook-text-primary">
                Variables disponibles
              </summary>
              <div className="mt-2 grid sm:grid-cols-2 gap-1">
                {PLACEHOLDERS.map((p) => (
                  <div key={p.token}>
                    <code className="px-1 py-0.5 rounded bg-outlook-bg-hover">{p.token}</code>
                    <span className="ml-2">{p.description}</span>
                  </div>
                ))}
              </div>
            </details>
          </section>

          {/* Visibilité */}
          <section className="space-y-1">
            <div className="text-sm font-semibold">Informations affichées</div>
            <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1">
              {([
                ['showSender', "Nom de l'expéditeur"],
                ['showSenderEmail', "E-mail de l'expéditeur"],
                ['showAccountEmail', 'Boîte destinataire'],
                ['showAccountName', 'Nom du compte'],
                ['showSubject', 'Objet'],
                ['showPreview', 'Aperçu du message'],
                ['showAppName', "Nom de l'application"],
                ['showSiteUrl', 'Adresse du site'],
              ] as const).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={(platformPrefs as any)[key]}
                    onChange={(e) => updatePlatform({ [key]: e.target.checked } as any)}
                  />
                  {label}
                </label>
              ))}
            </div>
            <div className="grid sm:grid-cols-2 gap-3 pt-2">
              <div>
                <label className="text-xs text-outlook-text-secondary">Longueur max. de l'objet</label>
                <input
                  type="number" min={20} max={300}
                  value={platformPrefs.subjectMaxLength}
                  onChange={(e) => updatePlatform({ subjectMaxLength: Math.max(10, Number(e.target.value) || 140) })}
                  className="w-full mt-1 px-2 py-1 text-sm border border-outlook-border rounded"
                />
              </div>
              <div>
                <label className="text-xs text-outlook-text-secondary">Longueur max. de l'aperçu</label>
                <input
                  type="number" min={0} max={500}
                  value={platformPrefs.previewMaxLength}
                  onChange={(e) => updatePlatform({ previewMaxLength: Math.max(0, Number(e.target.value) || 0) })}
                  className="w-full mt-1 px-2 py-1 text-sm border border-outlook-border rounded"
                />
              </div>
            </div>
          </section>

          {/* Actions */}
          <section className="space-y-2">
            <div className="text-sm font-semibold">Boutons d'action</div>
            <select
              value={presetId}
              onChange={(e) => {
                const preset = ACTION_PRESETS.find((p) => p.id === e.target.value);
                if (preset) updatePlatform({ actions: preset.actions.map((a) => ({ ...a })) });
              }}
              className="w-full px-2 py-1 text-sm border border-outlook-border rounded"
            >
              {ACTION_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
              <option value="custom" disabled={presetId !== 'custom'}>Personnalisé</option>
            </select>
            <div className="space-y-1">
              {platformPrefs.actions.map((a, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select
                    value={a.id}
                    onChange={(e) => {
                      const next = [...platformPrefs.actions];
                      next[i] = { ...next[i], id: e.target.value as NotificationActionId };
                      updatePlatform({ actions: next });
                    }}
                    className="text-sm border border-outlook-border rounded px-1 py-1"
                  >
                    {Object.entries(ACTION_LABELS).map(([id, label]) => (
                      <option key={id} value={id}>{label}</option>
                    ))}
                  </select>
                  <input
                    type="text"
                    placeholder={ACTION_LABELS[a.id]}
                    value={a.label || ''}
                    onChange={(e) => {
                      const next = [...platformPrefs.actions];
                      next[i] = { ...next[i], label: e.target.value };
                      updatePlatform({ actions: next });
                    }}
                    className="flex-1 text-sm border border-outlook-border rounded px-2 py-1"
                  />
                  <button
                    type="button"
                    onClick={() => updatePlatform({ actions: platformPrefs.actions.filter((_, j) => j !== i) })}
                    className="text-xs text-red-600 hover:underline"
                  >Retirer</button>
                </div>
              ))}
              {platformPrefs.actions.length < (platform === 'desktop' ? 2 : 3) && (
                <button
                  type="button"
                  onClick={() => updatePlatform({
                    actions: [...platformPrefs.actions, { id: 'open' as NotificationActionId, label: '' }],
                  })}
                  className="text-xs text-outlook-blue hover:underline"
                >+ Ajouter une action</button>
              )}
            </div>
            <p className="text-[11px] text-outlook-text-disabled">
              Les boutons exécutent l'action serveur correspondante (archiver, supprimer,
              répondre, marquer comme lu) sans ouvrir l'application — comme dans Outlook mobile.
            </p>
          </section>

          {/* Apparence native */}
          <section className="grid sm:grid-cols-2 gap-3">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={platformPrefs.requireInteraction}
                onChange={(e) => updatePlatform({ requireInteraction: e.target.checked })}
              />
              <span>
                Reste affichée jusqu'à action
                <span className="block text-[11px] text-outlook-text-disabled">
                  Empêche la disparition automatique au bout de 5s.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={platformPrefs.silent}
                onChange={(e) => updatePlatform({ silent: e.target.checked })}
              />
              <span>
                Mode silencieux
                <span className="block text-[11px] text-outlook-text-disabled">
                  Aucun son OS — utile la nuit ou en réunion.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={platformPrefs.renotify}
                onChange={(e) => updatePlatform({ renotify: e.target.checked })}
              />
              <span>
                Re-notifier en cas de remplacement
                <span className="block text-[11px] text-outlook-text-disabled">
                  Sonne à nouveau si une notification du même fil est mise à jour.
                </span>
              </span>
            </label>
            <div>
              <label className="text-xs text-outlook-text-secondary">Stratégie de regroupement</label>
              <select
                value={platformPrefs.tagStrategy}
                onChange={(e) => updatePlatform({ tagStrategy: e.target.value as any })}
                className="w-full mt-1 px-2 py-1 text-sm border border-outlook-border rounded"
              >
                <option value="per-message">Une notif par message</option>
                <option value="per-account">Une notif par boîte mail</option>
                <option value="global">Une seule notif visible</option>
              </select>
            </div>
          </section>

          {/* Son */}
          <section className="space-y-2">
            <div className="text-sm font-semibold flex items-center gap-2">
              <Volume2 size={14} /> Son
            </div>
            <div className="grid sm:grid-cols-[1fr_auto] gap-2 items-end">
              <div>
                <select
                  value={platformPrefs.sound}
                  onChange={(e) => updatePlatform({ sound: e.target.value as BuiltinSoundId })}
                  className="w-full px-2 py-1 text-sm border border-outlook-border rounded"
                >
                  {SOUND_OPTIONS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}{s.description ? ` — ${s.description}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={playSoundOnly}
                className="px-3 py-1 text-sm rounded border border-outlook-border hover:bg-outlook-bg-hover flex items-center gap-1"
              >
                <Volume2 size={12} /> Écouter
              </button>
            </div>
            {platformPrefs.sound === 'custom' && (
              <input
                type="url"
                placeholder="https://exemple.com/son.mp3"
                value={platformPrefs.customSoundUrl}
                onChange={(e) => updatePlatform({ customSoundUrl: e.target.value })}
                className="w-full px-2 py-1 text-sm border border-outlook-border rounded"
              />
            )}
            <div className="flex items-center gap-2">
              <span className="text-xs text-outlook-text-secondary w-16">Volume</span>
              <input
                type="range" min={0} max={1} step={0.05}
                value={platformPrefs.soundVolume}
                onChange={(e) => updatePlatform({ soundVolume: Number(e.target.value) })}
                className="flex-1"
              />
              <span className="text-xs w-10 text-right">{Math.round(platformPrefs.soundVolume * 100)}%</span>
            </div>
          </section>

          {/* Vibration (mobile/tablette) */}
          {platform !== 'desktop' && (
            <section className="space-y-2">
              <div className="text-sm font-semibold">Vibration</div>
              <select
                value={platformPrefs.vibrate}
                onChange={(e) => updatePlatform({ vibrate: e.target.value as VibratePresetId })}
                className="w-full px-2 py-1 text-sm border border-outlook-border rounded"
              >
                {VIBRATE_OPTIONS.map((v) => (
                  <option key={v.id} value={v.id}>{v.label}</option>
                ))}
              </select>
              {platformPrefs.vibrate === 'custom' && (
                <input
                  type="text"
                  placeholder="ex. 100, 50, 100"
                  value={platformPrefs.customVibratePattern.join(', ')}
                  onChange={(e) => {
                    const parts = e.target.value
                      .split(',')
                      .map((s) => Number(s.trim()))
                      .filter((n) => Number.isFinite(n) && n >= 0 && n <= 5000)
                      .slice(0, 8);
                    updatePlatform({ customVibratePattern: parts });
                  }}
                  className="w-full px-2 py-1 text-sm border border-outlook-border rounded font-mono"
                />
              )}
              <button
                type="button"
                onClick={() => navigator.vibrate?.(resolveVibratePattern(platformPrefs))}
                className="px-3 py-1 text-sm rounded border border-outlook-border hover:bg-outlook-bg-hover"
              >
                Tester la vibration
              </button>
            </section>
          )}
        </div>

        {/* Colonne aperçu + tests */}
        <div className="space-y-3">
          <NotificationPreview prefs={value} platform={platform} ctx={sampleCtx} />
          <div className="space-y-2">
            <button
              type="button"
              onClick={localBrowserTest}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm rounded bg-outlook-blue text-white hover:brightness-110"
            >
              <BellRing size={14} /> Tester le rendu sur cet appareil
            </button>
            {onSendServerTest && (
              <button
                type="button"
                onClick={serverTest}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm rounded border border-outlook-border hover:bg-outlook-bg-hover"
              >
                <Send size={14} /> Envoyer un push de test (serveur)
              </button>
            )}
            <p className="text-[11px] text-outlook-text-disabled">
              L'aperçu reproduit fidèlement l'apparence native du système.
              Le test « cet appareil » utilise l'API Notification du navigateur ;
              le test serveur déclenche un véritable Web Push.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
