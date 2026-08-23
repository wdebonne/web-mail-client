import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Ban, ShieldCheck, Loader2, Plus, Trash2, Sparkles, Lock, Info,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { api, type JunkSettings as JunkSettingsData, type JunkServerFilterLevel, type JunkSender } from '../../api';

/**
 * Réglages « Courrier indésirable » de l'utilisateur.
 *
 * Trois décisions au total, formulées sans jargon : à quel point le filtre est
 * sévère, à qui on fait confiance quoi qu'il arrive, et qui on ne veut plus
 * jamais voir. Tout le reste (en-têtes, scores, dossiers IMAP) reste sous le
 * capot — c'est la condition pour que la page soit utilisable par quelqu'un qui
 * ne sait pas ce qu'est un en-tête SMTP.
 */

const LEVELS: Array<{
  value: JunkServerFilterLevel;
  title: string;
  description: string;
}> = [
  {
    value: 'off',
    title: 'Désactivé',
    description: 'Seuls les expéditeurs que vous avez bloqués vous-même sont écartés.',
  },
  {
    value: 'normal',
    title: 'Normal (recommandé)',
    description: 'Écarte aussi les messages que votre serveur de messagerie a identifiés comme du spam.',
  },
  {
    value: 'strict',
    title: 'Strict',
    description: 'Écarte en plus les messages simplement suspects. Vérifiez le dossier de temps en temps.',
  },
];

const PURGE_CHOICES = [
  { value: 0, label: 'Jamais' },
  { value: 7, label: 'Après 7 jours' },
  { value: 30, label: 'Après 30 jours' },
  { value: 90, label: 'Après 90 jours' },
];

export default function JunkSettings() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['junk-settings'],
    queryFn: api.getJunkSettings,
    staleTime: 30_000,
  });

  const { data: senders = [], isLoading: sendersLoading } = useQuery({
    queryKey: ['junk-senders'],
    queryFn: () => api.listJunkSenders(),
    staleTime: 30_000,
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: api.getAccounts,
    staleTime: 1000 * 60 * 10,
  });

  const [form, setForm] = useState<JunkSettingsData | null>(null);
  useEffect(() => { if (data?.settings) setForm(data.settings); }, [data?.settings]);

  const saveMutation = useMutation({
    mutationFn: (next: JunkSettingsData) => api.updateJunkSettings(next),
    onSuccess: (_r, next) => {
      setForm(next);
      queryClient.invalidateQueries({ queryKey: ['junk-settings'] });
      toast.success('Réglages enregistrés');
    },
    onError: (e: any) => toast.error(e?.message || 'Enregistrement impossible'),
  });

  /** Applique un changement et l'enregistre immédiatement — pas de bouton « Enregistrer »
   *  à ne pas oublier, comme partout ailleurs dans les préférences. */
  const patch = (changes: Partial<JunkSettingsData>) => {
    if (!form) return;
    saveMutation.mutate({ ...form, ...changes });
  };

  const blocked = useMemo(() => senders.filter((s) => s.listType === 'blocked'), [senders]);
  const safe = useMemo(() => senders.filter((s) => s.listType === 'safe'), [senders]);

  if (isLoading || !form) {
    return (
      <div className="flex items-center gap-2 text-sm text-outlook-text-secondary">
        <Loader2 size={16} className="animate-spin" /> Chargement…
      </div>
    );
  }

  if (data && !data.featureEnabled) {
    return (
      <div>
        <h3 className="text-base font-semibold mb-3">Courrier indésirable</h3>
        <div className="flex items-start gap-2 p-3 rounded border border-outlook-border bg-outlook-bg-primary">
          <Lock size={16} className="text-outlook-text-secondary flex-shrink-0 mt-0.5" />
          <p className="text-sm text-outlook-text-secondary">
            La gestion du courrier indésirable a été désactivée par votre administrateur.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h3 className="text-base font-semibold mb-1">Courrier indésirable</h3>
      <p className="text-xs text-outlook-text-secondary mb-4">
        Les messages écartés ne sont jamais supprimés : ils sont rangés dans le dossier
        <strong> Courrier indésirable</strong>, où vous pouvez les retrouver et les récupérer.
      </p>

      <div className="space-y-6">
        {/* Interrupteur général */}
        <label className="flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => patch({ enabled: e.target.checked })}
            className="mt-0.5"
          />
          <span>
            <span className="block text-sm text-outlook-text-primary font-medium">
              Trier automatiquement le courrier indésirable
            </span>
            <span className="block text-xs text-outlook-text-secondary">
              Décochez pour tout laisser arriver en boîte de réception. Vos listes sont conservées.
            </span>
          </span>
        </label>

        {/* Niveau */}
        <div className={form.enabled ? '' : 'opacity-50 pointer-events-none'}>
          <label className="text-sm font-medium text-outlook-text-primary">Niveau de protection</label>
          <div className="mt-2 space-y-2">
            {LEVELS.map((level) => (
              <label
                key={level.value}
                className={`flex items-start gap-2.5 p-2.5 rounded border cursor-pointer transition-colors
                  ${form.serverFilter === level.value
                    ? 'border-outlook-blue bg-blue-50'
                    : 'border-outlook-border hover:bg-outlook-bg-hover'}`}
              >
                <input
                  type="radio"
                  name="junk-level"
                  checked={form.serverFilter === level.value}
                  onChange={() => patch({ serverFilter: level.value })}
                  className="mt-0.5"
                />
                <span>
                  <span className="block text-sm text-outlook-text-primary font-medium">{level.title}</span>
                  <span className="block text-xs text-outlook-text-secondary">{level.description}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="flex items-start gap-2 mt-2 text-xs text-outlook-text-secondary">
            <Info size={13} className="flex-shrink-0 mt-0.5" />
            <p>
              Au-delà de « Désactivé », le tri s'appuie sur le verdict rendu par votre serveur de
              messagerie. Si votre serveur n'analyse pas le spam, seuls vos expéditeurs bloqués
              seront écartés.
            </p>
          </div>
        </div>

        {/* Contacts de confiance */}
        <label className="flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={form.trustContacts}
            onChange={(e) => patch({ trustContacts: e.target.checked })}
            className="mt-0.5"
          />
          <span>
            <span className="block text-sm text-outlook-text-primary font-medium">
              Toujours faire confiance à mes contacts
            </span>
            <span className="block text-xs text-outlook-text-secondary">
              Un message venant d'une personne de votre carnet d'adresses n'est jamais écarté.
            </span>
          </span>
        </label>

        {/* Vidage automatique */}
        <div>
          <label className="text-sm font-medium text-outlook-text-primary">
            Vider le dossier Courrier indésirable
          </label>
          <select
            value={form.purgeDays}
            onChange={(e) => patch({ purgeDays: Number(e.target.value) })}
            className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm mt-1"
          >
            {PURGE_CHOICES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          <p className="text-xs text-outlook-text-disabled mt-1">
            Les messages plus anciens sont supprimés définitivement. Choisissez « Jamais » pour
            tout garder.
          </p>
        </div>

        {/* Nettoyage manuel */}
        {accounts.length > 0 && (
          <SweepButton accounts={accounts} />
        )}

        {/* Listes */}
        <SenderList
          title="Expéditeurs bloqués"
          emptyLabel="Aucun expéditeur bloqué. Utilisez « Bloquer l'expéditeur… » depuis un message."
          icon={<Ban size={15} className="text-red-600" />}
          listType="blocked"
          entries={blocked}
          loading={sendersLoading}
        />

        <SenderList
          title="Expéditeurs autorisés"
          emptyLabel="Aucun expéditeur autorisé. Ceux-ci ne sont jamais classés en indésirable."
          icon={<ShieldCheck size={15} className="text-green-600" />}
          listType="safe"
          entries={safe}
          loading={sendersLoading}
        />
      </div>
    </div>
  );
}

/**
 * « Nettoyer maintenant » : applique le filtre aux messages déjà présents.
 * Sans ce bouton, un utilisateur qui vient de régler son niveau ne verrait
 * rien se produire avant le prochain message reçu — et conclurait que ça ne
 * marche pas.
 */
function SweepButton({ accounts }: { accounts: any[] }) {
  const queryClient = useQueryClient();
  const [accountId, setAccountId] = useState(accounts[0]?.id || '');

  const sweep = useMutation({
    mutationFn: () => api.sweepJunk({ accountId, limit: 100 }),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ['messages'], refetchType: 'active' });
      queryClient.invalidateQueries({ queryKey: ['folders'], refetchType: 'active' });
      toast.success(
        r.moved > 0
          ? `${r.moved} message${r.moved > 1 ? 's' : ''} déplacé${r.moved > 1 ? 's' : ''} sur ${r.examined} examiné${r.examined > 1 ? 's' : ''}`
          : `Rien à déplacer sur ${r.examined} message${r.examined > 1 ? 's' : ''} examiné${r.examined > 1 ? 's' : ''}`,
      );
    },
    onError: (e: any) => toast.error(e?.message || 'Le nettoyage a échoué'),
  });

  return (
    <div className="p-3 rounded border border-outlook-border bg-outlook-bg-primary">
      <div className="flex items-center gap-2 mb-1">
        <Sparkles size={15} className="text-outlook-blue" />
        <span className="text-sm font-medium text-outlook-text-primary">Nettoyer maintenant</span>
      </div>
      <p className="text-xs text-outlook-text-secondary mb-2">
        Applique vos réglages aux 100 derniers messages de la boîte de réception.
      </p>
      <div className="flex items-center gap-2 flex-wrap">
        {accounts.length > 1 && (
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="border border-outlook-border rounded-md px-2 py-1.5 text-sm"
          >
            {accounts.map((a: any) => (
              <option key={a.id} value={a.id}>{a.email}</option>
            ))}
          </select>
        )}
        <button
          onClick={() => sweep.mutate()}
          disabled={sweep.isPending || !accountId}
          className="px-3 py-1.5 text-sm rounded bg-outlook-blue text-white hover:bg-outlook-blue-hover disabled:opacity-50 flex items-center gap-1.5"
        >
          {sweep.isPending && <Loader2 size={14} className="animate-spin" />}
          Nettoyer
        </button>
      </div>
    </div>
  );
}

function SenderList({
  title, emptyLabel, icon, listType, entries, loading,
}: {
  title: string;
  emptyLabel: string;
  icon: React.ReactNode;
  listType: 'blocked' | 'safe';
  entries: JunkSender[];
  loading: boolean;
}) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState('');

  const add = useMutation({
    mutationFn: () => api.addJunkSender({ listType, value: value.trim() }),
    onSuccess: () => {
      setValue('');
      queryClient.invalidateQueries({ queryKey: ['junk-senders'] });
    },
    onError: (e: any) => toast.error(e?.message || 'Ajout impossible'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteJunkSender(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['junk-senders'] }),
    onError: (e: any) => toast.error(e?.message || 'Suppression impossible'),
  });

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-sm font-medium text-outlook-text-primary">{title}</span>
        <span className="text-xs text-outlook-text-disabled">({entries.length})</span>
      </div>

      <div className="flex items-center gap-2 mb-2">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && value.trim()) { e.preventDefault(); add.mutate(); }
          }}
          placeholder="jean@exemple.fr ou exemple.fr"
          className="flex-1 border border-outlook-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-outlook-blue"
        />
        <button
          onClick={() => add.mutate()}
          disabled={add.isPending || !value.trim()}
          className="px-2.5 py-1.5 text-sm rounded border border-outlook-border hover:bg-outlook-bg-hover disabled:opacity-50 flex items-center gap-1"
        >
          {add.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          Ajouter
        </button>
      </div>

      {loading ? (
        <p className="text-xs text-outlook-text-disabled">Chargement…</p>
      ) : entries.length === 0 ? (
        <p className="text-xs text-outlook-text-disabled">{emptyLabel}</p>
      ) : (
        <ul className="border border-outlook-border rounded-md divide-y divide-outlook-border max-h-64 overflow-y-auto">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-center gap-2 px-3 py-1.5">
              <span className="flex-1 min-w-0 text-sm text-outlook-text-primary truncate" title={entry.pattern}>
                {entry.kind === 'domain' ? `@${entry.pattern}` : entry.pattern}
              </span>
              {entry.hitCount > 0 && (
                <span className="text-2xs text-outlook-text-disabled whitespace-nowrap">
                  {entry.hitCount} message{entry.hitCount > 1 ? 's' : ''}
                </span>
              )}
              {entry.global ? (
                <span
                  className="text-2xs text-outlook-text-disabled flex items-center gap-1 whitespace-nowrap"
                  title="Entrée définie par votre administrateur"
                >
                  <Lock size={11} /> Admin
                </span>
              ) : (
                <button
                  onClick={() => remove.mutate(entry.id)}
                  disabled={remove.isPending}
                  className="p-1 rounded text-outlook-text-secondary hover:bg-outlook-bg-hover hover:text-red-600 disabled:opacity-40"
                  aria-label={`Retirer ${entry.pattern}`}
                >
                  <Trash2 size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
