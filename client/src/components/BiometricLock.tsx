/**
 * PWA biometric lock.
 *
 * When the user has registered at least one passkey and the app has been
 * inactive for more than `INACTIVITY_DAYS`, show a full-screen overlay that
 * requires a biometric verification before any other interaction. The state
 * is stored locally (`wm_last_active`) — the server is never told when the
 * app was last open, only when the user proves presence.
 */
import { useEffect, useState } from 'react';
import { Fingerprint, Lock, LogOut } from 'lucide-react';
import { motion } from 'motion/react';
import { startAuthentication } from '@simplewebauthn/browser';
import { api } from '../api';
import { useAuthStore } from '../stores/authStore';

const LAST_ACTIVE_KEY = 'wm_last_active';
const LOCKED_KEY = 'wm_locked';
const INACTIVITY_DAYS = 7;
const ACTIVITY_SAVE_INTERVAL_MS = 60_000;

function readLastActive(): number | null {
  const raw = localStorage.getItem(LAST_ACTIVE_KEY);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function markActive() {
  localStorage.setItem(LAST_ACTIVE_KEY, String(Date.now()));
}

export function BiometricLock({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuthStore();
  const [locked, setLocked] = useState<boolean>(false);
  const [hasCredential, setHasCredential] = useState<boolean>(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  // On mount, decide whether to lock based on inactivity + presence of creds.
  useEffect(() => {
    let cancelled = false;
    if (!user) { setChecked(true); return; }
    const force = localStorage.getItem(LOCKED_KEY) === '1';
    const last = readLastActive();
    const elapsedDays = last == null ? 0 : (Date.now() - last) / (1000 * 60 * 60 * 24);
    const shouldLock = force || (last != null && elapsedDays >= INACTIVITY_DAYS);

    if (!shouldLock) {
      markActive();
      setChecked(true);
      return;
    }

    // Only lock if a passkey exists; otherwise there's no way to unlock
    // without a password re-entry, so we fall back to a password prompt
    // (i.e. logout + redirect to login). We leave that to the user's choice.
    (async () => {
      try {
        const creds = await api.webauthnCredentials();
        if (cancelled) return;
        if (creds.length > 0) {
          setHasCredential(true);
          setLocked(true);
        } else {
          markActive();
        }
      } catch {
        // If the API call fails (offline etc.), skip the lock to avoid
        // locking the user out of cached offline content.
      } finally {
        if (!cancelled) setChecked(true);
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // While unlocked, keep `last active` fresh.
  useEffect(() => {
    if (locked || !user) return;
    markActive();
    const id = window.setInterval(markActive, ACTIVITY_SAVE_INTERVAL_MS);
    const onVisibility = () => { if (!document.hidden) markActive(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [locked, user]);

  const unlock = async () => {
    setBusy(true);
    setError(null);
    try {
      const options = await api.webauthnUnlockOptions();
      const response = await startAuthentication({ optionsJSON: options });
      await api.webauthnUnlockVerify(response);
      markActive();
      localStorage.removeItem(LOCKED_KEY);
      setLocked(false);
    } catch (err: any) {
      setError(err?.message || 'Vérification annulée');
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    localStorage.removeItem(LOCKED_KEY);
    await logout();
  };

  if (!user || !checked) return <>{children}</>;

  if (locked && hasCredential) {
    return (
      <div className="fixed inset-0 bg-outlook-bg-primary flex items-center justify-center z-50">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.2 }}
          className="bg-white rounded-lg shadow-xl p-8 max-w-sm w-full text-center"
        >
          <div className="w-16 h-16 bg-outlook-blue rounded-full flex items-center justify-center mx-auto mb-4">
            <Lock size={32} className="text-white" />
          </div>
          <h2 className="text-xl font-semibold text-outlook-text-primary mb-2">
            Application verrouillée
          </h2>
          <p className="text-sm text-outlook-text-secondary mb-6">
            {user.displayName || user.email}, déverrouillez avec votre
            empreinte, Face ID ou Windows Hello pour continuer.
          </p>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-md p-2 text-xs text-red-700 mb-4">
              {error}
            </div>
          )}

          <button
            onClick={unlock}
            disabled={busy}
            className="w-full inline-flex items-center justify-center gap-2 bg-outlook-blue hover:bg-outlook-blue-hover text-white py-2.5 rounded-md text-sm font-medium transition-colors disabled:opacity-50"
          >
            <Fingerprint size={18} />
            {busy ? 'En attente du capteur…' : 'Déverrouiller'}
          </button>

          <button
            onClick={handleLogout}
            className="w-full mt-3 inline-flex items-center justify-center gap-2 text-outlook-text-secondary hover:text-outlook-text-primary text-xs"
          >
            <LogOut size={12} /> Se déconnecter et revenir à l'écran de connexion
          </button>
        </motion.div>
      </div>
    );
  }

  return <>{children}</>;
}

/** Manually lock the app on the next render (e.g. called from a "Lock now" button). */
export function lockAppNow() {
  localStorage.setItem(LOCKED_KEY, '1');
  window.location.reload();
}
