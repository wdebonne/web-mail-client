/**
 * Registre en mémoire de l'état des services de fond (pollers, processeurs,
 * planificateurs). Chaque service s'enregistre à son démarrage puis signale
 * chaque tick (avec l'erreur éventuelle). La route admin `/system-status`
 * expose ces informations pour la page « État du système ».
 *
 * Volontairement en mémoire : ces états n'ont de sens que pour le processus
 * en cours — après un redémarrage, un service non enregistré est un service
 * qui n'a pas démarré.
 */

export interface ServiceStatus {
  name: string;
  /** Libellé humain affiché dans l'admin. */
  label: string;
  /** Intervalle nominal entre deux ticks (ms) — sert à détecter un service bloqué. */
  intervalMs: number | null;
  startedAt: string | null;
  lastTickAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
}

const services = new Map<string, ServiceStatus>();

export function markServiceStarted(name: string, label: string, intervalMs?: number): void {
  const existing = services.get(name);
  services.set(name, {
    name,
    label,
    intervalMs: intervalMs ?? existing?.intervalMs ?? null,
    startedAt: new Date().toISOString(),
    lastTickAt: existing?.lastTickAt ?? null,
    lastErrorAt: existing?.lastErrorAt ?? null,
    lastError: existing?.lastError ?? null,
  });
}

export function markServiceStopped(name: string): void {
  services.delete(name);
}

export function markServiceTick(name: string, error?: unknown): void {
  const s = services.get(name);
  if (!s) return;
  s.lastTickAt = new Date().toISOString();
  if (error) {
    s.lastErrorAt = s.lastTickAt;
    s.lastError = String((error as any)?.message ?? error).slice(0, 500);
  }
}

export function getServicesStatus(): ServiceStatus[] {
  return [...services.values()].sort((a, b) => a.label.localeCompare(b.label, 'fr'));
}
