/**
 * Security settings: manage OpenPGP keys and S/MIME certificates, including
 * generation, import, export, passphrase-based unlock, and default-key selection.
 * All private key material stays inside the browser (IndexedDB + WebCrypto wrap).
 */
import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  KeyRound, Shield, ShieldCheck, Upload, Download, Trash2, Plus, Lock, Unlock, Star, StarOff, Copy,
} from 'lucide-react';
import { keystore, StoredKey } from '../crypto/keystore';
import * as pgp from '../crypto/pgp';
import * as smime from '../crypto/smime';
import { useSecurityStore } from '../stores/securityStore';
import { useAuthStore } from '../stores/authStore';

type Tab = 'pgp' | 'smime';

export default function SecurityPage() {
  const [tab, setTab] = useState<Tab>('pgp');
  const user = useAuthStore(s => s.user);
  const { keys, reloadKeys, unlockPgp, unlockSmime, lock, unlockedPgp, unlockedSmime } = useSecurityStore();

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    const list = await keystore.list();
    reloadKeys(list);
  }

  const pgpKeys = useMemo(() => keys.filter(k => k.kind === 'pgp'), [keys]);
  const smimeKeys = useMemo(() => keys.filter(k => k.kind === 'smime'), [keys]);

  return (
    <div className="h-full flex">
      <aside className="w-56 border-r border-outlook-border bg-outlook-bg-primary flex-shrink-0 py-4">
        <h2 className="text-lg font-semibold px-4 mb-4 text-outlook-text-primary flex items-center gap-2">
          <Shield size={18} /> Sécurité
        </h2>
        <TabButton active={tab === 'pgp'} onClick={() => setTab('pgp')} icon={<KeyRound size={16} />}>OpenPGP</TabButton>
        <TabButton active={tab === 'smime'} onClick={() => setTab('smime')} icon={<ShieldCheck size={16} />}>S/MIME</TabButton>
      </aside>

      <main className="flex-1 overflow-y-auto bg-white">
        <div className="max-w-4xl mx-auto p-6 space-y-6">
          {tab === 'pgp' && (
            <PgpPanel
              keys={pgpKeys}
              unlocked={unlockedPgp}
              defaultEmail={user?.email}
              onChange={refresh}
              onUnlock={unlockPgp}
              onLock={lock}
            />
          )}
          {tab === 'smime' && (
            <SmimePanel
              keys={smimeKeys}
              unlocked={unlockedSmime}
              onChange={refresh}
              onUnlock={unlockSmime}
              onLock={lock}
            />
          )}
        </div>
      </main>
    </div>
  );
}

function TabButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-4 py-2 text-sm text-left transition-colors
        ${active ? 'bg-outlook-blue/10 text-outlook-blue font-medium border-l-2 border-outlook-blue' : 'text-outlook-text-secondary hover:bg-outlook-bg-hover'}`}
    >
      {icon} {children}
    </button>
  );
}

// ---------------- OpenPGP panel ----------------

function PgpPanel({ keys, unlocked, defaultEmail, onChange, onUnlock, onLock }: {
  keys: StoredKey[];
  unlocked: Record<string, any>;
  defaultEmail?: string;
  onChange: () => void;
  onUnlock: (e: any) => void;
  onLock: (id: string) => void;
}) {
  const [mode, setMode] = useState<'list' | 'generate' | 'import'>('list');
  return (
    <>
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-outlook-text-primary">OpenPGP</h1>
          <p className="text-sm text-outlook-text-secondary mt-1">
            Génération, import et gestion de vos clés. Les clés privées sont chiffrées par votre phrase de passe avant stockage local.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setMode('generate')} className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-outlook-blue text-white rounded hover:bg-outlook-blue-dark"><Plus size={14} /> Nouvelle clé</button>
          <button onClick={() => setMode('import')} className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-outlook-border rounded hover:bg-outlook-bg-hover"><Upload size={14} /> Importer</button>
        </div>
      </header>

      {mode === 'generate' && <PgpGenerateForm defaultEmail={defaultEmail} onDone={() => { setMode('list'); onChange(); }} onCancel={() => setMode('list')} />}
      {mode === 'import' && <PgpImportForm onDone={() => { setMode('list'); onChange(); }} onCancel={() => setMode('list')} />}

      <section className="space-y-2">
        {keys.length === 0 && <EmptyState label="Aucune clé OpenPGP enregistrée." />}
        {keys.map(k => (
          <KeyCard
            key={k.id}
            storedKey={k}
            isUnlocked={!!unlocked[k.id]}
            onDelete={async () => {
              if (!confirm('Supprimer cette clé ? Cette action est irréversible.')) return;
              await keystore.delete(k.id);
              onChange();
              toast.success('Clé supprimée');
            }}
            onSetDefault={async () => { await keystore.setDefault(k.id); onChange(); }}
            onExportPublic={() => downloadText(k.publicData, `${safeFileName(k.email)}-public.asc`)}
            onCopyPublic={() => { navigator.clipboard.writeText(k.publicData); toast.success('Clé publique copiée'); }}
            onUnlock={async (passphrase) => {
              try {
                const armored = await keystore.unlockPrivate(k.id, passphrase);
                const privateKey = await pgp.readPrivateKey(armored, passphrase);
                onUnlock({ keyId: k.id, privateKey, publicArmored: k.publicData, email: k.email });
                toast.success('Clé déverrouillée pour cette session');
              } catch (err: any) {
                toast.error(`Phrase de passe incorrecte: ${err?.message || err}`);
              }
            }}
            onLock={() => onLock(k.id)}
          />
        ))}
      </section>
    </>
  );
}

function PgpGenerateForm({ defaultEmail, onDone, onCancel }: { defaultEmail?: string; onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState(defaultEmail || '');
  const [pass1, setPass1] = useState('');
  const [pass2, setPass2] = useState('');
  const [expires, setExpires] = useState('0');
  const [busy, setBusy] = useState(false);
  const [makeDefault, setMakeDefault] = useState(true);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pass1 !== pass2) return toast.error('Les phrases de passe ne correspondent pas.');
    if (pass1.length < 6) return toast.error('Choisissez une phrase de passe d\'au moins 6 caractères.');
    try {
      setBusy(true);
      const gen = await pgp.generateKey({ name, email, passphrase: pass1, expiresInDays: Number(expires) || 0 });
      await keystore.put({
        kind: 'pgp',
        email,
        name,
        publicData: gen.publicKey,
        fingerprint: gen.fingerprint,
        isDefault: makeDefault,
        privatePlaintext: gen.privateKey,
        passphrase: pass1,
      });
      toast.success('Clé OpenPGP générée');
      onDone();
    } catch (err: any) {
      toast.error(`Échec de la génération: ${err?.message || err}`);
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="border border-outlook-border rounded-md p-4 bg-outlook-bg-primary/30 space-y-3">
      <h2 className="font-semibold">Générer une nouvelle paire de clés (ECC — curve25519)</h2>
      <Row label="Nom"><input required value={name} onChange={e => setName(e.target.value)} className="input" /></Row>
      <Row label="Email"><input required type="email" value={email} onChange={e => setEmail(e.target.value)} className="input" /></Row>
      <Row label="Phrase de passe"><input required type="password" value={pass1} onChange={e => setPass1(e.target.value)} className="input" autoComplete="new-password" /></Row>
      <Row label="Confirmer la phrase de passe"><input required type="password" value={pass2} onChange={e => setPass2(e.target.value)} className="input" autoComplete="new-password" /></Row>
      <Row label="Expiration">
        <select value={expires} onChange={e => setExpires(e.target.value)} className="input">
          <option value="0">Jamais</option>
          <option value="365">1 an</option>
          <option value="730">2 ans</option>
          <option value="1825">5 ans</option>
        </select>
      </Row>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={makeDefault} onChange={e => setMakeDefault(e.target.checked)} /> Utiliser comme clé par défaut</label>
      <div className="flex items-center gap-2 pt-1">
        <button type="submit" disabled={busy} className="px-4 py-2 text-sm bg-outlook-blue text-white rounded disabled:opacity-50">{busy ? 'Génération…' : 'Générer'}</button>
        <button type="button" onClick={onCancel} className="px-4 py-2 text-sm border border-outlook-border rounded hover:bg-outlook-bg-hover">Annuler</button>
      </div>
    </form>
  );
}

function PgpImportForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [armored, setArmored] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const isPrivate = /-----BEGIN PGP PRIVATE KEY BLOCK-----/.test(armored);
    const isPublic = /-----BEGIN PGP PUBLIC KEY BLOCK-----/.test(armored);
    if (!isPrivate && !isPublic) return toast.error('Le texte fourni n\'est pas une clé OpenPGP ASCII-armored.');
    try {
      setBusy(true);
      if (isPrivate) {
        if (passphrase.length < 6) return toast.error('Entrez la phrase de passe protégeant la clé.');
        const decrypted = await pgp.readPrivateKey(armored, passphrase);
        const publicArmored = decrypted.toPublic().armor();
        const identity = decrypted.getUserIDs()[0] || '';
        const email = (identity.match(/<([^>]+)>/)?.[1] || '').toLowerCase();
        const name = identity.replace(/<[^>]+>/, '').trim();
        await keystore.put({
          kind: 'pgp',
          email,
          name,
          publicData: publicArmored,
          fingerprint: decrypted.getFingerprint().toUpperCase(),
          privatePlaintext: armored,
          passphrase,
        });
      } else {
        const key = await pgp.readPublicKey(armored);
        const identity = key.getUserIDs()[0] || '';
        const email = (identity.match(/<([^>]+)>/)?.[1] || '').toLowerCase();
        const name = identity.replace(/<[^>]+>/, '').trim();
        await keystore.put({
          kind: 'pgp',
          email,
          name,
          publicData: armored,
          fingerprint: key.getFingerprint().toUpperCase(),
        });
      }
      toast.success('Clé importée');
      onDone();
    } catch (err: any) {
      toast.error(`Échec de l'import: ${err?.message || err}`);
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="border border-outlook-border rounded-md p-4 bg-outlook-bg-primary/30 space-y-3">
      <h2 className="font-semibold">Importer une clé (publique ou privée)</h2>
      <textarea required value={armored} onChange={e => setArmored(e.target.value)} rows={8} className="input font-mono text-xs" placeholder="-----BEGIN PGP PUBLIC KEY BLOCK-----&#10;...&#10;-----END PGP PUBLIC KEY BLOCK-----" />
      <Row label="Phrase de passe (si clé privée)"><input type="password" value={passphrase} onChange={e => setPassphrase(e.target.value)} className="input" /></Row>
      <div className="flex items-center gap-2">
        <button type="submit" disabled={busy} className="px-4 py-2 text-sm bg-outlook-blue text-white rounded disabled:opacity-50">{busy ? 'Import…' : 'Importer'}</button>
        <button type="button" onClick={onCancel} className="px-4 py-2 text-sm border border-outlook-border rounded hover:bg-outlook-bg-hover">Annuler</button>
      </div>
    </form>
  );
}

// ---------------- S/MIME panel ----------------

function SmimePanel({ keys, unlocked, onChange, onUnlock, onLock }: {
  keys: StoredKey[];
  unlocked: Record<string, any>;
  onChange: () => void;
  onUnlock: (e: any) => void;
  onLock: (id: string) => void;
}) {
  const [mode, setMode] = useState<'list' | 'import'>('list');
  return (
    <>
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-outlook-text-primary">S/MIME</h1>
          <p className="text-sm text-outlook-text-secondary mt-1">
            Importez un certificat X.509 au format PKCS#12 (.p12 / .pfx) délivré par une autorité de certification.
          </p>
        </div>
        <button onClick={() => setMode('import')} className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-outlook-blue text-white rounded hover:bg-outlook-blue-dark"><Upload size={14} /> Importer .p12</button>
      </header>

      {mode === 'import' && <SmimeImportForm onDone={() => { setMode('list'); onChange(); }} onCancel={() => setMode('list')} />}

      <section className="space-y-2">
        {keys.length === 0 && <EmptyState label="Aucun certificat S/MIME enregistré." />}
        {keys.map(k => (
          <KeyCard
            key={k.id}
            storedKey={k}
            isUnlocked={!!unlocked[k.id]}
            onDelete={async () => {
              if (!confirm('Supprimer ce certificat ?')) return;
              await keystore.delete(k.id);
              onChange();
              toast.success('Certificat supprimé');
            }}
            onSetDefault={async () => { await keystore.setDefault(k.id); onChange(); }}
            onExportPublic={() => downloadText(k.publicData, `${safeFileName(k.email)}.crt`)}
            onCopyPublic={() => { navigator.clipboard.writeText(k.publicData); toast.success('Certificat copié'); }}
            onUnlock={async (passphrase) => {
              try {
                const pkcs8 = await keystore.unlockPrivate(k.id, passphrase);
                onUnlock({ keyId: k.id, certificatePem: k.publicData, privateKeyPkcs8Pem: pkcs8, email: k.email });
                toast.success('Certificat déverrouillé pour cette session');
              } catch (err: any) {
                toast.error(`Phrase de passe incorrecte: ${err?.message || err}`);
              }
            }}
            onLock={() => onLock(k.id)}
          />
        ))}
      </section>
    </>
  );
}

function SmimeImportForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [storePass, setStorePass] = useState('');
  const [busy, setBusy] = useState(false);
  const [makeDefault, setMakeDefault] = useState(true);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return toast.error('Sélectionnez un fichier .p12/.pfx');
    if (storePass.length < 6) return toast.error('Choisissez une phrase de passe locale (≥ 6 caractères) pour protéger le stockage.');
    try {
      setBusy(true);
      const data = await file.arrayBuffer();
      const parsed = await smime.importP12(data, passphrase);
      await keystore.put({
        kind: 'smime',
        email: parsed.subjectEmail || '',
        name: parsed.subjectCN,
        publicData: parsed.certificatePem,
        fingerprint: parsed.serialNumberHex,
        isDefault: makeDefault,
        privatePlaintext: parsed.privateKeyPkcs8Pem,
        passphrase: storePass,
      });
      toast.success('Certificat importé');
      onDone();
    } catch (err: any) {
      toast.error(`Échec de l'import: ${err?.message || err}`);
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="border border-outlook-border rounded-md p-4 bg-outlook-bg-primary/30 space-y-3">
      <h2 className="font-semibold">Importer un certificat S/MIME (.p12 / .pfx)</h2>
      <Row label="Fichier">
        <input required type="file" accept=".p12,.pfx,application/x-pkcs12" onChange={e => setFile(e.target.files?.[0] || null)} className="input" />
      </Row>
      <Row label="Phrase de passe du fichier .p12"><input required type="password" value={passphrase} onChange={e => setPassphrase(e.target.value)} className="input" /></Row>
      <Row label="Phrase de passe locale (stockage IndexedDB)"><input required type="password" value={storePass} onChange={e => setStorePass(e.target.value)} className="input" autoComplete="new-password" /></Row>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={makeDefault} onChange={e => setMakeDefault(e.target.checked)} /> Définir comme certificat par défaut</label>
      <div className="flex items-center gap-2">
        <button type="submit" disabled={busy} className="px-4 py-2 text-sm bg-outlook-blue text-white rounded disabled:opacity-50">{busy ? 'Import…' : 'Importer'}</button>
        <button type="button" onClick={onCancel} className="px-4 py-2 text-sm border border-outlook-border rounded hover:bg-outlook-bg-hover">Annuler</button>
      </div>
    </form>
  );
}

// ---------------- Shared pieces ----------------

function KeyCard({ storedKey, isUnlocked, onDelete, onSetDefault, onExportPublic, onCopyPublic, onUnlock, onLock }: {
  storedKey: StoredKey;
  isUnlocked: boolean;
  onDelete: () => void;
  onSetDefault: () => void;
  onExportPublic: () => void;
  onCopyPublic: () => void;
  onUnlock: (pass: string) => void;
  onLock: () => void;
}) {
  const [pass, setPass] = useState('');
  const [showUnlock, setShowUnlock] = useState(false);
  const hasPrivate = !!storedKey.privateCiphertext;

  return (
    <div className="border border-outlook-border rounded-md p-4 bg-white">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm">{storedKey.name || storedKey.email || '—'}</span>
            {storedKey.isDefault && <span className="text-2xs uppercase tracking-wider bg-outlook-blue/10 text-outlook-blue px-1.5 py-0.5 rounded">Par défaut</span>}
            {hasPrivate
              ? <span className="text-2xs uppercase tracking-wider bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">Privée</span>
              : <span className="text-2xs uppercase tracking-wider bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">Publique</span>}
            {isUnlocked && <span className="text-2xs uppercase tracking-wider bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">Déverrouillée</span>}
          </div>
          <div className="text-xs text-outlook-text-secondary mt-0.5">{storedKey.email || '—'}</div>
          {storedKey.fingerprint && (
            <div className="text-2xs font-mono text-outlook-text-disabled mt-1 break-all">{storedKey.fingerprint}</div>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <IconBtn title={storedKey.isDefault ? 'Par défaut' : 'Définir par défaut'} onClick={onSetDefault}>
            {storedKey.isDefault ? <Star size={14} className="text-outlook-warning" /> : <StarOff size={14} />}
          </IconBtn>
          <IconBtn title="Copier la partie publique" onClick={onCopyPublic}><Copy size={14} /></IconBtn>
          <IconBtn title="Télécharger la partie publique" onClick={onExportPublic}><Download size={14} /></IconBtn>
          {hasPrivate && (
            isUnlocked
              ? <IconBtn title="Verrouiller" onClick={onLock}><Lock size={14} /></IconBtn>
              : <IconBtn title="Déverrouiller" onClick={() => setShowUnlock(s => !s)}><Unlock size={14} /></IconBtn>
          )}
          <IconBtn title="Supprimer" onClick={onDelete} danger><Trash2 size={14} /></IconBtn>
        </div>
      </div>

      {showUnlock && hasPrivate && !isUnlocked && (
        <form
          onSubmit={(e) => { e.preventDefault(); onUnlock(pass); setPass(''); setShowUnlock(false); }}
          className="mt-3 flex items-center gap-2"
        >
          <input type="password" required placeholder="Phrase de passe" value={pass} onChange={e => setPass(e.target.value)} className="input flex-1" autoFocus />
          <button type="submit" className="px-3 py-1.5 text-sm bg-outlook-blue text-white rounded">Déverrouiller</button>
        </form>
      )}
    </div>
  );
}

function IconBtn({ title, onClick, danger, children }: { title: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" title={title} onClick={onClick}
      className={`p-1.5 rounded transition-colors ${danger ? 'hover:bg-red-50 text-outlook-danger' : 'hover:bg-outlook-bg-hover text-outlook-text-secondary'}`}>
      {children}
    </button>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-outlook-text-secondary mb-1">{label}</span>
      {children}
    </label>
  );
}

function EmptyState({ label }: { label: string }) {
  return <div className="text-center text-sm text-outlook-text-disabled py-8 border border-dashed border-outlook-border rounded">{label}</div>;
}

function downloadText(text: string, filename: string) {
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function safeFileName(s: string | undefined) {
  return (s || 'key').replace(/[^a-z0-9_.-]+/gi, '-').toLowerCase();
}
