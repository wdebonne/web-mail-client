import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ban, ShieldCheck, Loader2, Plus, Trash2, Info } from 'lucide-react';
import toast from 'react-hot-toast';
import { api, type JunkSettings, type JunkServerFilterLevel, type JunkSender } from '../../api';

/**
 * Administration du courrier indésirable.
 *
 * Deux choses seulement, et il faut les distinguer clairement :
 *   - les **valeurs par défaut**, qui ne s'appliquent qu'aux utilisateurs
 *     n'ayant jamais touché à leurs propres réglages (modifier un défaut ne
 *     réécrit donc pas les choix déjà faits) ;
 *   - les **listes globales**, qui s'ajoutent à celles de chaque utilisateur
 *     sans que celui-ci puisse les retirer.
 */

const LEVEL_LABELS: Record<JunkServerFilterLevel, string> = {
  off: 'Désactivé — seules les listes d\'expéditeurs s\'appliquent',
  normal: 'Normal — suit le verdict du serveur (score ≥ 5)',
  strict: 'Strict — écarte aussi les messages suspects (score ≥ 3)',
};

export default function AdminJunkPanel() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['admin-junk-settings'],
    queryFn: api.adminGetJunkSettings,
  });

  const { data: senders = [], isLoading: sendersLoading } = useQuery({
    queryKey: ['admin-junk-senders'],
    queryFn: api.adminListJunkSenders,
  });

  const [featureEnabled, setFeatureEnabled] = useState(true);
  const [defaults, setDefaults] = useState<JunkSettings | null>(null);

  useEffect(() => {
    if (!data) return;
    setFeatureEnabled(data.featureEnabled);
    setDefaults(data.defaults);
  }, [data]);

  const save = useMutation({
    mutationFn: (payload: { featureEnabled: boolean; defaults: JunkSettings }) =>
      api.adminUpdateJunkSettings(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-junk-settings'] });
      toast.success('Réglages enregistrés');
    },
    onError: (e: any) => toast.error(e?.message || 'Enregistrement impossible'),
  });

  const blocked = useMemo(() => senders.filter((s) => s.listType === 'blocked'), [senders]);
  const safe = useMemo(() => senders.filter((s) => s.listType === 'safe'), [senders]);

  if (isLoading || !defaults) {
    return (
      <div className="flex items-center gap-2 text-sm text-outlook-text-secondary">
        <Loader2 size={16} className="animate-spin" /> Chargement…
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <h3 className="text-lg font-semibold mb-1">Courrier indésirable</h3>
      <p className="text-sm text-outlook-text-secondary mb-5">
        Le filtre s'appuie sur les listes d'expéditeurs et sur le verdict rendu par votre serveur
        de messagerie (en-têtes <code className="text-xs">X-Spam-*</code>). Aucun message n'est
        supprimé&nbsp;: ils sont rangés dans le dossier <strong>Courrier indésirable</strong> de
        chaque boîte.
      </p>

      {/* Réglages généraux */}
      <div className="border border-outlook-border rounded-lg p-4 mb-4">
        <label className="flex items-start gap-2.5 cursor-pointer mb-4">
          <input
            type="checkbox"
            checked={featureEnabled}
            onChange={(e) => setFeatureEnabled(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            <span className="block text-sm font-medium text-outlook-text-primary">
              Activer la gestion du courrier indésirable
            </span>
            <span className="block text-xs text-outlook-text-secondary">
              Décoché, l'onglet disparaît des préférences et plus aucun message n'est classé
              automatiquement, quels que soient les réglages individuels.
            </span>
          </span>
        </label>

        <div className={`space-y-4 ${featureEnabled ? '' : 'opacity-50 pointer-events-none'}`}>
          <div className="flex items-start gap-2 p-2.5 rounded bg-blue-50 border border-blue-200">
            <Info size={15} className="text-outlook-blue flex-shrink-0 mt-0.5" />
            <p className="text-xs text-outlook-text-primary">
              Ces valeurs ne s'appliquent qu'aux utilisateurs n'ayant jamais modifié leurs propres
              réglages. Les choix déjà faits ne sont pas écrasés.
            </p>
          </div>

          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={defaults.enabled}
              onChange={(e) => setDefaults({ ...defaults, enabled: e.target.checked })}
              className="mt-0.5"
            />
            <span className="text-sm text-outlook-text-primary">
              Classement automatique actif par défaut
            </span>
          </label>

          <div>
            <label className="text-sm text-outlook-text-secondary block mb-1">
              Niveau de filtrage par défaut
            </label>
            <select
              value={defaults.serverFilter}
              onChange={(e) => setDefaults({ ...defaults, serverFilter: e.target.value as JunkServerFilterLevel })}
              className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm"
            >
              {(Object.keys(LEVEL_LABELS) as JunkServerFilterLevel[]).map((level) => (
                <option key={level} value={level}>{LEVEL_LABELS[level]}</option>
              ))}
            </select>
          </div>

          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={defaults.trustContacts}
              onChange={(e) => setDefaults({ ...defaults, trustContacts: e.target.checked })}
              className="mt-0.5"
            />
            <span className="text-sm text-outlook-text-primary">
              Ne jamais classer en indésirable un expéditeur présent dans les contacts
            </span>
          </label>

          <div>
            <label className="text-sm text-outlook-text-secondary block mb-1">
              Vidage automatique du dossier Indésirables (jours, 0 = jamais)
            </label>
            <input
              type="number"
              min={0}
              max={365}
              value={defaults.purgeDays}
              onChange={(e) => setDefaults({ ...defaults, purgeDays: Math.max(0, Math.min(365, Number(e.target.value) || 0)) })}
              className="w-32 border border-outlook-border rounded-md px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <button
            onClick={() => save.mutate({ featureEnabled, defaults })}
            disabled={save.isPending}
            className="px-4 py-2 text-sm rounded bg-outlook-blue text-white hover:bg-outlook-blue-hover disabled:opacity-50 flex items-center gap-2"
          >
            {save.isPending && <Loader2 size={14} className="animate-spin" />}
            Enregistrer
          </button>
        </div>
      </div>

      {/* Listes globales */}
      <div className="border border-outlook-border rounded-lg p-4 space-y-5">
        <div>
          <h4 className="text-sm font-semibold text-outlook-text-primary">Listes globales</h4>
          <p className="text-xs text-outlook-text-secondary">
            Appliquées à tous les utilisateurs, en plus de leurs propres listes. Elles apparaissent
            en lecture seule dans leurs préférences.
          </p>
        </div>

        <GlobalSenderList
          title="Bloqués pour tout le monde"
          icon={<Ban size={15} className="text-red-600" />}
          listType="blocked"
          entries={blocked}
          loading={sendersLoading}
        />

        <GlobalSenderList
          title="Toujours autorisés"
          icon={<ShieldCheck size={15} className="text-green-600" />}
          listType="safe"
          entries={safe}
          loading={sendersLoading}
          hint="Utile pour garantir la réception des expéditeurs internes ou d'un prestataire."
        />
      </div>
    </div>
  );
}

function GlobalSenderList({
  title, icon, listType, entries, loading, hint,
}: {
  title: string;
  icon: React.ReactNode;
  listType: 'blocked' | 'safe';
  entries: JunkSender[];
  loading: boolean;
  hint?: string;
}) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState('');

  const add = useMutation({
    mutationFn: () => api.adminAddJunkSender({ listType, value: value.trim() }),
    onSuccess: () => {
      setValue('');
      queryClient.invalidateQueries({ queryKey: ['admin-junk-senders'] });
      queryClient.invalidateQueries({ queryKey: ['admin-junk-settings'] });
    },
    onError: (e: any) => toast.error(e?.message || 'Ajout impossible'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.adminDeleteJunkSender(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-junk-senders'] });
      queryClient.invalidateQueries({ queryKey: ['admin-junk-settings'] });
    },
    onError: (e: any) => toast.error(e?.message || 'Suppression impossible'),
  });

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-sm font-medium text-outlook-text-primary">{title}</span>
        <span className="text-xs text-outlook-text-disabled">({entries.length})</span>
      </div>
      {hint && <p className="text-xs text-outlook-text-secondary mb-2">{hint}</p>}

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
        <p className="text-xs text-outlook-text-disabled">Aucune entrée.</p>
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
              <button
                onClick={() => remove.mutate(entry.id)}
                disabled={remove.isPending}
                className="p-1 rounded text-outlook-text-secondary hover:bg-outlook-bg-hover hover:text-red-600 disabled:opacity-40"
                aria-label={`Retirer ${entry.pattern}`}
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
