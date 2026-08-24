import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

// In-memory store: suits the single-instance deployment. If the app is ever
// scaled to multiple replicas, switch to a shared store (e.g. rate-limit-postgresql).

/**
 * Baseline limiter for the whole /api/auth mount. Generous enough that no
 * legitimate client (boot-time /me + /refresh, SSO redirects, device lists)
 * ever hits it — it only stops unthrottled scripts.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes. Réessayez dans quelques minutes.' },
});

/**
 * Strict limiter for credential-guessing surfaces (login, register,
 * reset-password token consumption, WebAuthn verification). Successful
 * requests are not counted, so real users are never locked out by their
 * own valid logins — only repeated failures from one IP are.
 */
export const credentialLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives. Réessayez dans 15 minutes.' },
});

/**
 * Anti-spam limiter for /forgot-password: every request can trigger an
 * outbound email, and the endpoint always answers 200 (anti-enumeration),
 * so all requests count — not just failures.
 */
export const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de demandes de réinitialisation. Réessayez dans une heure.' },
});

/**
 * Garde-fou pour l'assistant IA. Une génération occupe le GPU (ou tous les
 * cœurs) du serveur Ollama pendant plusieurs secondes : sans plafond, un seul
 * utilisateur qui pilonne le bouton « Résumer » met la file à genoux pour tout
 * le monde. Le décompte est par utilisateur, pas par IP — derrière un proxy
 * d'entreprise, tout le monde partage la même adresse.
 */
export const aiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: any) => req.userId ?? ipKeyGenerator(req.ip ?? ''),
  message: { error: "Trop de requêtes vers l'assistant IA. Patientez quelques minutes." },
});
