import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { pool } from '../database/connection';
import { logger } from '../utils/logger';

/**
 * Authentification intégrée Windows (SPNEGO / Kerberos).
 *
 * Le navigateur d'un poste joint au domaine répond tout seul à un
 * `401 WWW-Authenticate: Negotiate` en présentant un ticket de service obtenu
 * auprès du contrôleur de domaine : aucune saisie utilisateur.
 *
 * Valider ce ticket est une opération **hors ligne** — la clé du keytab suffit
 * à le déchiffrer, le serveur ne contacte jamais le KDC. La machine hôte n'a
 * donc pas besoin d'être jointe au domaine ; il suffit d'un keytab généré sur
 * le DC (`ktpass`) et monté en lecture seule dans le conteneur.
 */

export interface KerberosConfig {
  enabled: boolean;
  realm: string;               // DOMAINE.LOCAL (majuscules)
  kdcs: string[];              // dc01.domaine.local, dc02.domaine.local
  servicePrincipal: string;    // HTTP@mail.domaine.local
  keytabPath: string;          // /etc/webmail/webmail.keytab
  userFilter: string;          // filtre LDAP de résolution du principal
  emailDomain: string;         // repli quand LDAP est désactivé
  allowedCidrs: string[];      // réseaux depuis lesquels Negotiate est annoncé
  autoLogin: boolean;          // tentative silencieuse au chargement de la page
}

/**
 * Filtre de résolution du principal Kerberos vers un compte d'annuaire.
 *
 * Le second terme écarte les comptes désactivés (bit `ACCOUNTDISABLE` de
 * `userAccountControl`, via l'OID de comparaison binaire d'Active Directory).
 * Sans lui, désactiver un compte dans l'AD — le geste naturel d'un départ — ne
 * suffit pas : le chemin Kerberos ne fait aucun `bind`, contrairement au login
 * par mot de passe, donc rien ne vérifie l'état du compte. L'accès resterait
 * ouvert le temps que le ticket de service en cache expire (10 h par défaut),
 * et la session d'appareil émise dans cet intervalle vivrait 90 jours.
 *
 * Syntaxe propre à Active Directory : sur un annuaire qui n'expose pas
 * `userAccountControl` (OpenLDAP), remplacer ce filtre par
 * `(sAMAccountName={{sam}})` ou l'équivalent du schéma en place.
 */
const DEFAULT_USER_FILTER =
  '(&(sAMAccountName={{sam}})(!(userAccountControl:1.2.840.113556.1.4.803:=2)))';

/** Découpe une liste saisie en une ligne (virgules, espaces ou retours ligne). */
function parseList(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String).map((v) => v.trim()).filter(Boolean);
  if (typeof raw !== 'string') return [];
  return raw.split(/[\s,;]+/).map((v) => v.trim()).filter(Boolean);
}

export async function getKerberosConfig(): Promise<KerberosConfig> {
  const result = await pool.query(
    `SELECT key, value FROM admin_settings WHERE key LIKE 'kerberos_%'`
  );
  const s: Record<string, any> = {};
  for (const row of result.rows) s[row.key] = row.value;

  return {
    enabled: s['kerberos_enabled'] === true || s['kerberos_enabled'] === 'true',
    realm: typeof s['kerberos_realm'] === 'string' ? s['kerberos_realm'].trim().toUpperCase() : '',
    kdcs: parseList(s['kerberos_kdcs']),
    servicePrincipal: typeof s['kerberos_service_principal'] === 'string'
      ? s['kerberos_service_principal'].trim()
      : '',
    keytabPath: typeof s['kerberos_keytab_path'] === 'string' && s['kerberos_keytab_path'].trim()
      ? s['kerberos_keytab_path'].trim()
      : (process.env.KRB5_KTNAME?.replace(/^FILE:/i, '') ?? ''),
    userFilter: typeof s['kerberos_user_filter'] === 'string' && s['kerberos_user_filter'].trim()
      ? s['kerberos_user_filter'].trim()
      : DEFAULT_USER_FILTER,
    emailDomain: typeof s['kerberos_email_domain'] === 'string' ? s['kerberos_email_domain'].trim() : '',
    allowedCidrs: parseList(s['kerberos_allowed_cidrs']),
    autoLogin: s['kerberos_auto_login'] !== false && s['kerberos_auto_login'] !== 'false',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Chargement paresseux du module natif
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `kerberos` est une dépendance **optionnelle** : elle se compile contre
 * libkrb5 (GSSAPI) et n'est pas toujours disponible (poste de dev sans chaîne
 * de compilation, image sans krb5-dev…). On la charge donc à la demande, et
 * son absence dégrade la seule fonctionnalité concernée au lieu de faire
 * tomber le serveur au démarrage.
 *
 * Attention : le module n'implémente **que le côté client** sous Windows —
 * `initializeServer` y lève « not implemented yet for windows ». Accepter un
 * ticket exige donc un hôte Unix, ce qui est le cas de l'image Docker.
 */
let _module: any | null = null;
let _moduleError: string | null = null;

function loadKerberosModule(): any | null {
  if (_module) return _module;
  if (_moduleError) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    _module = require('kerberos');
    return _module;
  } catch (err: any) {
    _moduleError = err?.message ?? String(err);
    return null;
  }
}

export interface KerberosAvailability {
  available: boolean;
  moduleLoaded: boolean;
  moduleError?: string;
  keytabFound: boolean;
  keytabPath: string;
  reason?: string;
}

export function checkKerberosAvailability(cfg: KerberosConfig): KerberosAvailability {
  const mod = loadKerberosModule();
  const keytabPath = cfg.keytabPath;
  const keytabFound = !!keytabPath && fs.existsSync(keytabPath);

  // Le module se charge sous Windows mais n'y implémente que le côté client :
  // `initializeServer` lève « not implemented yet for windows ». Mieux vaut le
  // dire ici que de laisser un développeur chercher pourquoi chaque handshake
  // échoue — en production l'application tourne sous Linux (image Docker).
  if (process.platform === 'win32') {
    return {
      available: false,
      moduleLoaded: !!mod,
      keytabFound,
      keytabPath,
      reason: "L'acceptation de tickets Kerberos n'est pas disponible sous Windows (le module natif n'y implémente que le côté client). Utilisez le conteneur Docker ou un hôte Linux.",
    };
  }

  if (!mod) {
    return {
      available: false,
      moduleLoaded: false,
      moduleError: _moduleError ?? 'module introuvable',
      keytabFound,
      keytabPath,
      reason: "Le module natif « kerberos » n'est pas installé sur ce serveur.",
    };
  }
  if (!keytabFound) {
    return {
      available: false,
      moduleLoaded: true,
      keytabFound: false,
      keytabPath,
      reason: keytabPath
        ? `Keytab introuvable ou illisible : ${keytabPath}`
        : 'Aucun chemin de keytab configuré.',
    };
  }
  if (!cfg.servicePrincipal) {
    return {
      available: false,
      moduleLoaded: true,
      keytabFound: true,
      keytabPath,
      reason: 'Aucun principal de service (SPN) configuré.',
    };
  }
  return { available: true, moduleLoaded: true, keytabFound: true, keytabPath };
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration krb5 côté conteneur
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Génère un `krb5.conf` minimal depuis les réglages admin et pointe libkrb5
 * dessus, pour éviter à l'exploitant d'aller éditer un fichier dans l'image.
 *
 * Les variables déjà positionnées dans l'environnement gagnent : qui monte son
 * propre `krb5.conf` (domaine avec relations d'approbation, plusieurs realms…)
 * garde la main.
 *
 * libkrb5 lit son profil au premier usage du processus : **un changement de
 * realm ou de KDC ne prend effet qu'après redémarrage du conteneur.** L'aide de
 * l'onglet admin le dit explicitement.
 */
const OPERATOR_KTNAME = process.env.KRB5_KTNAME;
const OPERATOR_KRB5_CONFIG = process.env.KRB5_CONFIG;

export function applyKerberosEnvironment(cfg: KerberosConfig): void {
  // Relu à chaque enregistrement des réglages : `KRB5_KTNAME` est consulté à
  // chaque acquisition de clé de service, un changement de keytab prend donc
  // effet sans redémarrage. On mémorise ce que l'exploitant avait mis dans
  // l'environnement au démarrage pour ne jamais l'écraser.
  if (!OPERATOR_KTNAME && cfg.keytabPath) {
    process.env.KRB5_KTNAME = `FILE:${cfg.keytabPath}`;
  }

  // Le cache anti-rejeu GSSAPI a besoin d'un répertoire inscriptible ; celui
  // par défaut (/var/tmp) n'existe pas toujours dans une image minimale, et
  // l'échec se manifeste par un « Permission denied » parfaitement opaque.
  if (!process.env.KRB5RCACHEDIR) process.env.KRB5RCACHEDIR = os.tmpdir();

  if (OPERATOR_KRB5_CONFIG) return;                 // profil fourni par l'exploitant
  if (!cfg.realm) return;                           // rien d'exploitable à écrire

  const realmLower = cfg.realm.toLowerCase();
  const kdcLines = cfg.kdcs.length > 0
    ? cfg.kdcs.map((kdc) => `        kdc = ${kdc}`).join('\n')
    : '        # aucun KDC declare - resolution par enregistrements SRV';

  const content = [
    "# Genere automatiquement par l'application - ne pas editer.",
    '# Pour fournir votre propre profil, montez-le et definissez KRB5_CONFIG.',
    '[libdefaults]',
    `    default_realm = ${cfg.realm}`,
    '    dns_lookup_realm = false',
    `    dns_lookup_kdc = ${cfg.kdcs.length > 0 ? 'false' : 'true'}`,
    '    # Le SPN doit correspondre au nom tape dans la barre d adresse : on',
    '    # desactive la canonicalisation DNS, qui le reecrirait dans notre dos.',
    '    dns_canonicalize_hostname = false',
    '    rdns = false',
    '    forwardable = true',
    '',
    '[realms]',
    `    ${cfg.realm} = {`,
    kdcLines,
    '    }',
    '',
    '[domain_realm]',
    `    .${realmLower} = ${cfg.realm}`,
    `    ${realmLower} = ${cfg.realm}`,
    '',
  ].join('\n');

  try {
    const target = path.join(os.tmpdir(), 'webmail-krb5.conf');
    fs.writeFileSync(target, content, { mode: 0o644 });
    process.env.KRB5_CONFIG = target;
  } catch (err) {
    logger.error(err as Error, 'Kerberos: ecriture de krb5.conf impossible');
  }
}

/** Appelé une fois au démarrage, avant tout chargement de libkrb5. */
export async function initKerberos(): Promise<void> {
  try {
    const cfg = await getKerberosConfig();
    if (!cfg.enabled) return;

    applyKerberosEnvironment(cfg);
    const status = checkKerberosAvailability(cfg);
    if (status.available) {
      logger.info(
        { spn: cfg.servicePrincipal, realm: cfg.realm, keytab: status.keytabPath },
        'Kerberos (authentification intégrée Windows) actif'
      );
    } else {
      logger.warn(
        { reason: status.reason, moduleError: status.moduleError },
        'Kerberos activé dans les réglages mais indisponible — les autres méthodes de connexion restent utilisables'
      );
    }
  } catch (err) {
    logger.error(err as Error, 'Kerberos: initialisation impossible');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Handshake SPNEGO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `NTLMSSP\0` encodé en base64 commence toujours par « TlRMTVNT ».
 *
 * On refuse NTLM : il est bien plus faible que Kerberos, et son handshake est
 * lié à la connexion TCP — ce qui ne survit pas à un reverse proxy qui
 * multiplexe les connexions amont. Mieux vaut un refus explicite et lisible
 * qu'une authentification qui échoue une fois sur deux.
 */
export function isNtlmToken(tokenB64: string): boolean {
  return tokenB64.startsWith('TlRMTVNT');
}

export class KerberosAuthError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'KerberosAuthError';
  }
}

export interface SpnegoResult {
  /** Principal complet tel que rendu par GSSAPI/SSPI (`user@REALM`). */
  principal: string;
  /** Nom de connexion court, sans realm ni domaine. */
  sam: string;
  /** Jeton à renvoyer au client pour l'authentification mutuelle. */
  responseToken: string;
}

/**
 * GSSAPI attend un SPN en notation `type@fqdn`, alors que `setspn` et `ktpass`
 * l'affichent en `HTTP/fqdn[@REALM]`. On accepte les deux : recopier la sortie
 * de la console Windows est le geste naturel, autant qu'il fonctionne.
 */
export function normalizeServicePrincipal(raw: string): string {
  const trimmed = raw.trim();
  const slashForm = trimmed.match(/^([A-Za-z0-9_-]+)\/([^@/\s]+)(?:@\S+)?$/);
  return slashForm ? `${slashForm[1]}@${slashForm[2]}` : trimmed;
}

/**
 * Vérifie que la clé du SPN est présente dans le keytab, en demandant à GSSAPI
 * la « credential » d'accepteur — exactement ce que fera le handshake. Plus
 * fiable que de décoder le keytab nous-mêmes, et cela remonte le message
 * d'erreur d'origine de la bibliothèque.
 */
export async function verifyServicePrincipal(
  cfg: KerberosConfig
): Promise<{ ok: boolean; message: string }> {
  const mod = loadKerberosModule();
  if (!mod) return { ok: false, message: _moduleError ?? 'Module Kerberos indisponible' };
  if (!cfg.servicePrincipal) return { ok: false, message: 'Aucun principal de service configuré' };

  try {
    await mod.initializeServer(cfg.servicePrincipal);
    return { ok: true, message: `Clé de service trouvée dans le keytab pour ${cfg.servicePrincipal}` };
  } catch (err: any) {
    return { ok: false, message: err?.message ?? 'Erreur inconnue' };
  }
}

/** Extrait le nom court d'un principal `user@REALM` ou `DOMAINE\user`. */
export function extractSamAccountName(principal: string): string {
  const backslash = principal.lastIndexOf('\\');
  if (backslash >= 0) return principal.slice(backslash + 1);
  const at = principal.indexOf('@');
  return at >= 0 ? principal.slice(0, at) : principal;
}

/** Valide un jeton SPNEGO présenté par le navigateur. */
export async function acceptSpnego(cfg: KerberosConfig, tokenB64: string): Promise<SpnegoResult> {
  if (isNtlmToken(tokenB64)) {
    throw new KerberosAuthError(
      "Le navigateur a proposé NTLM au lieu de Kerberos. Vérifiez que le site est joint par son nom DNS complet (FQDN) et qu'il figure dans la zone Intranet local.",
      'ntlm_rejected'
    );
  }

  const mod = loadKerberosModule();
  if (!mod) {
    throw new KerberosAuthError('Module Kerberos indisponible sur ce serveur.', 'module_unavailable');
  }

  const server = await mod.initializeServer(cfg.servicePrincipal);
  const responseToken: string = await server.step(tokenB64);

  // Kerberos se règle en un aller-retour côté accepteur. Un contexte incomplet
  // signale une négociation multi-étapes (typiquement NTLM), qu'on ne peut pas
  // poursuivre sans conserver l'état GSSAPI entre deux requêtes HTTP.
  if (!server.contextComplete) {
    throw new KerberosAuthError(
      "La négociation Kerberos n'a pas abouti en une étape (mécanisme non supporté).",
      'context_incomplete'
    );
  }

  const principal: string = server.username ?? '';
  if (!principal) {
    throw new KerberosAuthError('Le ticket ne porte aucune identité exploitable.', 'no_principal');
  }

  return { principal, sam: extractSamAccountName(principal), responseToken: responseToken ?? '' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Restriction réseau
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalise une adresse avant comparaison : retire la zone d'interface
 * (`fe80::1%eth0`) et ramène les adresses IPv4-mapped (`::ffff:192.168.1.5`,
 * posées par Node quand la socket écoute en dual-stack) à leur forme IPv4.
 */
export function normalizeIp(ip: string): string {
  let cleaned = ip.trim();
  const zone = cleaned.indexOf('%');
  if (zone >= 0) cleaned = cleaned.slice(0, zone);
  if (cleaned.toLowerCase().startsWith('::ffff:') && cleaned.includes('.')) {
    cleaned = cleaned.slice(7);
  }
  return cleaned;
}

/**
 * Adresse → octets : 4 pour IPv4, 16 pour IPv6. Renvoie `null` si la chaîne
 * n'est pas une adresse valide.
 *
 * Travailler sur les octets plutôt que sur un entier 32 bits est ce qui permet
 * de traiter les deux familles avec le même code de comparaison de préfixe —
 * un `/64` IPv6 ne tient pas dans un entier JavaScript.
 */
function ipToBytes(raw: string): Uint8Array | null {
  const ip = normalizeIp(raw);

  if (net.isIPv4(ip)) {
    const parts = ip.split('.');
    const bytes = new Uint8Array(4);
    for (let i = 0; i < 4; i++) {
      const octet = Number(parts[i]);
      if (!/^\d{1,3}$/.test(parts[i]) || octet > 255) return null;
      bytes[i] = octet;
    }
    return bytes;
  }

  if (!net.isIPv6(ip)) return null;

  // Expansion du `::` : au plus une occurrence, et la partie basse peut être
  // écrite en notation IPv4 (`::ffff:10.0.0.1` déjà traité, mais aussi
  // `2001:db8::192.168.1.1`).
  const halves = ip.split('::');
  if (halves.length > 2) return null;

  const expandTail = (groups: string[]): string[] | null => {
    if (groups.length === 0) return [];
    const last = groups[groups.length - 1];
    if (!last.includes('.')) return groups;
    if (!net.isIPv4(last)) return null;
    const o = last.split('.').map(Number);
    return [
      ...groups.slice(0, -1),
      ((o[0] << 8) | o[1]).toString(16),
      ((o[2] << 8) | o[3]).toString(16),
    ];
  };

  const head = expandTail(halves[0] ? halves[0].split(':') : []);
  const tail = expandTail(halves.length === 2 && halves[1] ? halves[1].split(':') : []);
  if (head === null || tail === null) return null;

  let groups: string[];
  if (halves.length === 1) {
    if (head.length !== 8) return null;
    groups = head;
  } else {
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    groups = [...head, ...Array(missing).fill('0'), ...tail];
  }

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    const value = parseInt(groups[i] || '0', 16);
    if (Number.isNaN(value) || value < 0 || value > 0xffff) return null;
    bytes[i * 2] = value >> 8;
    bytes[i * 2 + 1] = value & 0xff;
  }
  return bytes;
}

/**
 * Vrai si `ip` appartient à `cidr`, en IPv4 comme en IPv6. Accepte une IP nue
 * (préfixe implicite : /32 ou /128).
 *
 * Les deux familles ne se croisent pas : une adresse IPv6 n'appartient jamais
 * à un réseau IPv4, et réciproquement. C'est précisément ce qui rendait le
 * filtre silencieusement inopérant sur un domaine Active Directory, où Windows
 * privilégie IPv6 quand il est disponible — d'où l'avertissement émis par
 * `isFromAllowedNetwork`.
 */
export function ipMatchesCidr(ip: string, cidr: string): boolean {
  const [network, bitsRaw] = cidr.trim().split('/');

  const ipBytes = ipToBytes(ip);
  const netBytes = ipToBytes(network);
  if (ipBytes === null || netBytes === null) return false;
  if (ipBytes.length !== netBytes.length) return false;   // familles différentes

  const maxBits = netBytes.length * 8;
  const bits = bitsRaw === undefined ? maxBits : Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > maxBits) return false;

  const fullBytes = bits >> 3;
  for (let i = 0; i < fullBytes; i++) {
    if (ipBytes[i] !== netBytes[i]) return false;
  }

  const remaining = bits & 7;
  if (remaining === 0) return true;
  const mask = (0xff << (8 - remaining)) & 0xff;
  return (ipBytes[fullBytes] & mask) === (netBytes[fullBytes] & mask);
}

/** Familles d'adresses couvertes par une liste de CIDR. */
function cidrFamilies(cidrs: string[]): { v4: boolean; v6: boolean } {
  let v4 = false;
  let v6 = false;
  for (const cidr of cidrs) {
    const bytes = ipToBytes(cidr.trim().split('/')[0]);
    if (bytes?.length === 4) v4 = true;
    else if (bytes?.length === 16) v6 = true;
  }
  return { v4, v6 };
}

/**
 * Une IP par message, pour ne pas noyer les journaux : le poste qui n'arrive
 * pas à se connecter réessaie, et l'exploitant n'a besoin de l'information
 * qu'une fois. Volontairement non borné en taille — le nombre d'adresses
 * distinctes écartées reste de l'ordre du parc, et le processus redémarre.
 */
const _warnedIps = new Set<string>();

/**
 * Une liste vide autorise tout le monde : Kerberos exige de toute façon un
 * ticket valide, l'intérêt du filtre est surtout d'éviter d'annoncer
 * `Negotiate` à des clients qui n'y répondront jamais (accès externe).
 */
export function isFromAllowedNetwork(ip: string, cfg: KerberosConfig): boolean {
  if (cfg.allowedCidrs.length === 0) return true;
  if (cfg.allowedCidrs.some((cidr) => ipMatchesCidr(ip, cidr))) return true;

  // Le cas qui coûte des heures de diagnostic : le poste est bien sur le LAN,
  // mais il joint le serveur en IPv6 alors que tous les réseaux autorisés sont
  // déclarés en IPv4. Kerberos ne s'annonce pas, et rien ne l'explique — la
  // page de connexion est conçue pour échouer en silence.
  const bytes = ipToBytes(ip);
  if (bytes?.length === 16 && !_warnedIps.has(ip)) {
    const families = cidrFamilies(cfg.allowedCidrs);
    if (!families.v6) {
      _warnedIps.add(ip);
      logger.warn(
        { ip, allowedCidrs: cfg.allowedCidrs },
        'Kerberos: client joignant le serveur en IPv6 alors que les reseaux autorises sont tous en IPv4 — ajoutez le prefixe IPv6 correspondant dans Admin > Connexion Windows, sinon la connexion integree ne sera jamais proposee a ce poste'
      );
    }
  }
  return false;
}
