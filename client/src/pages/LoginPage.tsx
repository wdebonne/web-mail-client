import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';
import { api } from '../api';
import { Mail, Lock, User, AlertCircle, Fingerprint, KeyRound } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { startAuthentication } from '@simplewebauthn/browser';

/**
 * Login page.
 *
 * Features:
 *   • Classic email/password sign-in (with optional WebAuthn 2FA step-up).
 *   • One-click **passkey** sign-in using a discoverable (resident) credential:
 *     no email/password required — the browser shows an account picker.
 *   • Appearance (background image + blur, colors, labels) is fetched from
 *     `/api/branding` and can be configured by administrators in the admin
 *     panel → "Apparence connexion".
 */
export default function LoginPage() {
  const { login, register, finalizeLogin, isLoading } = useAuthStore();
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);

  const { data: branding } = useQuery({
    queryKey: ['branding-public'],
    queryFn: api.getBranding,
    staleTime: 60_000,
  });

  const appearance = branding?.login_appearance;
  const appName = branding?.app_name || 'WebMail';

  const hasBackgroundImage = !!appearance?.backgroundImage;
  const rootStyle = useMemo<React.CSSProperties>(() => {
    const bg = appearance?.backgroundColor;
    if (hasBackgroundImage) return {};
    if (bg) return { background: bg };
    return {};
  }, [appearance, hasBackgroundImage]);

  const cardStyle = useMemo<React.CSSProperties>(() => {
    const s: React.CSSProperties = {};
    if (appearance?.cardBgColor) s.backgroundColor = appearance.cardBgColor;
    if (appearance?.cardTextColor) s.color = appearance.cardTextColor;
    return s;
  }, [appearance]);

  const primaryBtnStyle = useMemo<React.CSSProperties>(() => {
    if (!appearance?.accentColor) return {};
    return { backgroundColor: appearance.accentColor };
  }, [appearance]);

  const run2FA = async (token: string) => {
    setError('');
    setVerifying(true);
    try {
      const options = await api.webauthnLoginOptions(token);
      const response = await startAuthentication({ optionsJSON: options });
      const result = await api.webauthnLoginVerify(token, response);
      finalizeLogin(result.token, result.user);
    } catch (err: any) {
      setError(err?.message || 'Authentification biométrique annulée');
    } finally {
      setVerifying(false);
    }
  };

  const handlePasskeyLogin = async () => {
    setError('');
    setPasskeyLoading(true);
    try {
      const options = await api.webauthnPasskeyOptions();
      const response = await startAuthentication({ optionsJSON: options });
      const result = await api.webauthnPasskeyVerify(response);
      finalizeLogin(result.token, result.user);
    } catch (err: any) {
      setError(err?.message || 'Connexion par clé d\'accès annulée');
    } finally {
      setPasskeyLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      if (isRegister) {
        await register(email, password, displayName);
      } else {
        const result = await login(email, password);
        if (result.requires2FA && result.pendingToken) {
          setPendingToken(result.pendingToken);
          await run2FA(result.pendingToken);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Une erreur est survenue');
    }
  };

  const [webauthnSupported, setWebauthnSupported] = useState(false);
  useEffect(() => {
    setWebauthnSupported(typeof window !== 'undefined' && !!window.PublicKeyCredential);
  }, []);

  const showPasskey = webauthnSupported && (appearance?.showPasskeyButton ?? true);
  const showRegister = appearance?.showRegister ?? true;

  return (
    <div
      className={`h-full flex items-center justify-center relative overflow-hidden ${hasBackgroundImage ? '' : 'bg-gradient-to-br from-outlook-blue to-outlook-blue-dark'}`}
      style={rootStyle}
    >
      {hasBackgroundImage && (
        <div
          aria-hidden
          className="absolute inset-0 bg-center bg-cover"
          style={{
            backgroundImage: `url(${appearance!.backgroundImage})`,
            filter: appearance!.backgroundBlur > 0 ? `blur(${appearance!.backgroundBlur}px)` : undefined,
            transform: appearance!.backgroundBlur > 0 ? 'scale(1.1)' : undefined,
          }}
        />
      )}
      {hasBackgroundImage && appearance?.backgroundOverlay && (
        <div aria-hidden className="absolute inset-0" style={{ background: appearance.backgroundOverlay }} />
      )}

      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="relative bg-white rounded-lg shadow-2xl w-full max-w-md p-8"
        style={cardStyle}
      >
        <div className="text-center mb-8">
          <div
            className="w-16 h-16 bg-outlook-blue rounded-xl flex items-center justify-center mx-auto mb-4"
            style={primaryBtnStyle}
          >
            <Mail size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-semibold text-outlook-text-primary" style={cardStyle.color ? { color: cardStyle.color } : undefined}>
            {appearance?.title || appName}
          </h1>
          <p className="text-outlook-text-secondary text-sm mt-1">
            {appearance?.subtitle || (isRegister ? 'Créer un compte' : 'Connectez-vous à votre messagerie')}
          </p>
        </div>

        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0, marginBottom: 0 }}
              animate={{ opacity: 1, height: 'auto', marginBottom: 16 }}
              exit={{ opacity: 0, height: 0, marginBottom: 0 }}
              transition={{ duration: 0.2 }}
              className="bg-red-50 border border-red-200 rounded-md p-3 flex items-center gap-2 overflow-hidden"
            >
              <AlertCircle size={16} className="text-red-500 flex-shrink-0" />
              <span className="text-red-700 text-sm">{error}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {pendingToken && (
          <div className="bg-blue-50 border border-blue-200 rounded-md p-4 mb-4 flex flex-col items-center text-center">
            <Fingerprint size={32} className="text-outlook-blue mb-2" />
            <p className="text-sm text-outlook-text-primary font-medium mb-1">
              Vérification biométrique
            </p>
            <p className="text-xs text-outlook-text-secondary mb-3">
              Confirmez votre identité avec Touch ID, Face ID ou Windows Hello.
            </p>
            <button
              type="button"
              onClick={() => run2FA(pendingToken)}
              disabled={verifying}
              className="bg-outlook-blue hover:bg-outlook-blue-hover text-white text-sm px-4 py-2 rounded-md disabled:opacity-50"
              style={primaryBtnStyle}
            >
              {verifying ? 'En attente…' : 'Réessayer'}
            </button>
          </div>
        )}

        {showPasskey && !pendingToken && !isRegister && (
          <>
            <button
              type="button"
              onClick={handlePasskeyLogin}
              disabled={passkeyLoading}
              className="w-full border border-outlook-border hover:border-outlook-blue hover:bg-outlook-bg-hover text-outlook-text-primary py-2.5 rounded-md text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2 mb-4"
            >
              <KeyRound size={18} />
              {passkeyLoading ? 'Détection de la clé d\'accès…' : 'Se connecter avec une clé d\'accès'}
            </button>
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-1 h-px bg-outlook-border" />
              <span className="text-xs text-outlook-text-disabled uppercase tracking-wide">ou</span>
              <div className="flex-1 h-px bg-outlook-border" />
            </div>
          </>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {isRegister && (
            <div>
              <label className="block text-sm font-medium text-outlook-text-primary mb-1">
                Nom d'affichage
              </label>
              <div className="relative">
                <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-outlook-text-disabled" />
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Votre nom"
                  required
                  className="w-full pl-10 pr-4 py-2.5 border border-outlook-border rounded-md text-sm focus:outline-none focus:border-outlook-blue focus:ring-1 focus:ring-outlook-blue"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-outlook-text-primary mb-1">
              Adresse e-mail
            </label>
            <div className="relative">
              <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-outlook-text-disabled" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="votre@email.com"
                required
                autoComplete="email webauthn"
                className="w-full pl-10 pr-4 py-2.5 border border-outlook-border rounded-md text-sm focus:outline-none focus:border-outlook-blue focus:ring-1 focus:ring-outlook-blue"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-outlook-text-primary mb-1">
              Mot de passe
            </label>
            <div className="relative">
              <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-outlook-text-disabled" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={isRegister ? 8 : 6}
                autoComplete={isRegister ? 'new-password' : 'current-password webauthn'}
                className="w-full pl-10 pr-4 py-2.5 border border-outlook-border rounded-md text-sm focus:outline-none focus:border-outlook-blue focus:ring-1 focus:ring-outlook-blue"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-outlook-blue hover:bg-outlook-blue-hover text-white py-2.5 rounded-md text-sm font-medium transition-colors disabled:opacity-50"
            style={primaryBtnStyle}
          >
            {isLoading ? 'Chargement...' : isRegister ? 'Créer le compte' : 'Se connecter'}
          </button>
        </form>

        {showRegister && (
          <div className="text-center mt-6">
            <button
              onClick={() => { setIsRegister(!isRegister); setError(''); }}
              className="text-outlook-blue hover:text-outlook-blue-hover text-sm"
              style={appearance?.accentColor ? { color: appearance.accentColor } : undefined}
            >
              {isRegister ? 'Déjà un compte ? Se connecter' : 'Créer un compte'}
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}
