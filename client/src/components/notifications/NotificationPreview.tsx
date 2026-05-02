/**
 * Maquettes en direct des notifications natives, par plateforme.
 *
 * Le rendu est purement visuel — il n'utilise pas l'API Notification du
 * navigateur — afin de pouvoir afficher les boutons d'action et le contenu
 * exactement comme l'OS les présentera (Windows Action Center, Android
 * Heads-up, iOS bannière). Les valeurs sont calculées via le même pipeline
 * que celui utilisé côté serveur (`buildNotificationContent`), ce qui
 * garantit une parité 1:1 entre l'aperçu et la vraie notification.
 */

import { Mail } from 'lucide-react';
import {
  NotificationPlatform, NotificationPrefs,
  buildNotificationContent, NotificationContext,
} from '../../utils/notificationPrefs';

interface Props {
  prefs: NotificationPrefs;
  platform: NotificationPlatform;
  ctx: NotificationContext;
}

/**
 * Limite réelle d'actions affichées par l'OS courant.
 * - Sur Chromium (desktop ET Android), `Notification.maxActions` est
 *   exposé dynamiquement (2 sur Android, 2 sur Windows, jusqu'à 5 ailleurs).
 * - Sur les WebViews iOS/Safari, la propriété n'existe pas → on retombe
 *   sur des plafonds prudents (2 desktop / 2 mobile / 3 tablet) qui
 *   correspondent à ce que ces plateformes affichent réellement dans la
 *   bannière collapsed (vue par défaut sur l'écran de verrouillage).
 */
function getRealMaxActions(platform: NotificationPlatform): number {
  const fallback = platform === 'desktop' ? 2 : platform === 'mobile' ? 2 : 3;
  try {
    const N: any = (globalThis as any).Notification;
    if (N && typeof N.maxActions === 'number' && N.maxActions > 0) {
      return Math.min(N.maxActions, platform === 'desktop' ? 2 : 3);
    }
  } catch { /* noop */ }
  return fallback;
}

/** Rendu commun : liste les boutons d'action selon la plateforme. */
function ActionRow({
  prefs, platform,
}: { prefs: NotificationPrefs; platform: NotificationPlatform }) {
  const actions = prefs[platform].actions;
  if (!actions.length) return null;
  // On reflète exactement ce que l'OS affichera (Notification.maxActions).
  const max = getRealMaxActions(platform);
  const visible = actions.slice(0, max);
  const hidden = actions.length - visible.length;
  return (
    <>
      <div
        className="grid"
        style={{ gridTemplateColumns: `repeat(${visible.length}, 1fr)` }}
      >
        {visible.map((a, i) => (
          <button
            key={a.id + i}
            type="button"
            className="px-3 py-2 text-[13px] text-center text-white/90 hover:bg-white/10 transition-colors border-l border-white/10 first:border-l-0"
          >
            {a.label || a.id}
          </button>
        ))}
      </div>
      {hidden > 0 && (
        <div className="px-3 py-1.5 text-[10.5px] text-amber-300/80 bg-amber-500/10 border-t border-amber-500/20 text-center">
          +{hidden} action{hidden > 1 ? 's' : ''} masquée{hidden > 1 ? 's' : ''} par l'OS (limite Notification.maxActions = {max})
        </div>
      )}
    </>
  );
}

function DesktopMock({ prefs, ctx }: { prefs: NotificationPrefs; ctx: NotificationContext }) {
  const { title, body } = buildNotificationContent(prefs, 'desktop', ctx);
  const lines = body.split('\n').filter(Boolean);
  return (
    <div className="bg-[#1f1f1f] text-white/90 rounded-lg shadow-2xl border border-white/10 overflow-hidden max-w-sm">
      <div className="flex gap-3 p-3">
        <div className="w-10 h-10 rounded bg-outlook-blue flex-shrink-0 flex items-center justify-center">
          <Mail size={20} className="text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[11px] text-white/50">
            <span className="truncate">{prefs.appName || 'WebMail'}</span>
            {prefs.desktop.showSiteUrl && prefs.siteUrl && (
              <span className="truncate">— {prefs.siteUrl}</span>
            )}
            <span className="ml-auto whitespace-nowrap">à l'instant</span>
          </div>
          <div className="text-sm font-semibold truncate mt-0.5">{title}</div>
          {lines.map((l, i) => (
            <div
              key={i}
              className={`text-[12px] text-white/80 ${i === 0 ? 'truncate' : 'line-clamp-2'}`}
            >
              {l}
            </div>
          ))}
        </div>
      </div>
      <ActionRow prefs={prefs} platform="desktop" />
    </div>
  );
}

function MobileMock({
  prefs, ctx, kind,
}: {
  prefs: NotificationPrefs;
  ctx: NotificationContext;
  kind: 'mobile' | 'tablet';
}) {
  const { title, body } = buildNotificationContent(prefs, kind, ctx);
  const lines = body.split('\n').filter(Boolean);
  const widthClass = kind === 'tablet' ? 'max-w-md' : 'max-w-sm';
  return (
    <div className={`bg-black/80 backdrop-blur text-white/90 rounded-2xl border border-white/10 overflow-hidden ${widthClass}`}>
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center gap-2 text-[11px] text-white/60">
          <div className="w-4 h-4 rounded bg-outlook-blue" />
          <span className="truncate">{prefs.appName || 'WebMail'}</span>
          {prefs[kind].showSiteUrl && prefs.siteUrl && (
            <span className="truncate"> · {prefs.siteUrl}</span>
          )}
          <span className="ml-auto">il y a 1 min</span>
        </div>
        <div className="text-[14px] font-semibold mt-1 truncate">{title}</div>
        {lines.map((l, i) => (
          <div
            key={i}
            className={`text-[12.5px] text-white/80 ${i === 0 ? 'line-clamp-1' : 'line-clamp-2'}`}
          >
            {l}
          </div>
        ))}
      </div>
      {prefs[kind].actions.length > 0 && (
        <>
          <div className="h-px bg-white/10" />
          <ActionRow prefs={prefs} platform={kind} />
        </>
      )}
    </div>
  );
}

export default function NotificationPreview({ prefs, platform, ctx }: Props) {
  const wrapper = (mock: JSX.Element, label: string, frame: string) => (
    <div className="flex flex-col items-center gap-3">
      <div className={`p-4 rounded-xl ${frame} w-full flex justify-center`}>
        {mock}
      </div>
      <div className="text-xs text-outlook-text-secondary">{label}</div>
    </div>
  );

  if (platform === 'desktop') {
    return wrapper(
      <DesktopMock prefs={prefs} ctx={ctx} />,
      'Aperçu Bureau (Windows / macOS / Linux)',
      'bg-gradient-to-b from-slate-700 to-slate-900',
    );
  }
  if (platform === 'tablet') {
    return wrapper(
      <MobileMock prefs={prefs} ctx={ctx} kind="tablet" />,
      'Aperçu Tablette (iPad / Android tablet)',
      'bg-gradient-to-b from-indigo-900 to-slate-900',
    );
  }
  return wrapper(
    <MobileMock prefs={prefs} ctx={ctx} kind="mobile" />,
    'Aperçu Mobile (Android / iOS)',
    'bg-gradient-to-b from-zinc-900 to-black',
  );
}
