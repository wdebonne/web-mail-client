import { useRef, useState } from 'react';
import { Sparkles, Loader2, ChevronDown, Copy, CornerDownLeft, X } from 'lucide-react';
import { api } from '../../api';
import { useAiStatus } from '../../hooks/useAiStatus';
import toast from 'react-hot-toast';

/**
 * Assistant IA de la fenêtre de rédaction.
 *
 * Le texte généré n'écrase jamais le brouillon sans y avoir été invité : il
 * s'affiche d'abord dans un aperçu, et c'est l'utilisateur qui décide de
 * l'insérer. Un modèle local se trompe, part sur autre chose, ou répond à
 * côté ; perdre un brouillon à cause de ça serait impardonnable.
 */

const TONES = [
  { value: 'professional', label: 'Professionnel' },
  { value: 'formal', label: 'Formel' },
  { value: 'friendly', label: 'Amical' },
  { value: 'concise', label: 'Concis' },
];

export interface AiSource {
  subject?: string;
  from?: string;
  body: string;
}

interface Props {
  /** Message d'origine, présent uniquement sur une réponse ou un transfert. */
  source?: AiSource;
  /** Texte brut du brouillon en cours, lu au moment du clic. */
  getDraftText: () => string;
  /** Insère le texte retenu dans l'éditeur. */
  onInsert: (text: string) => void;
}

export default function AiComposeAssistant({ source, getDraftText, onInsert }: Props) {
  const ai = useAiStatus();
  const [open, setOpen] = useState(false);
  const [tone, setTone] = useState('professional');
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState<'reply' | 'improve' | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const canReply = ai.enabled && ai.features.reply && !!source?.body?.trim();
  const canImprove = ai.enabled && ai.features.improve;
  if (!canReply && !canImprove) return null;

  const run = async (kind: 'reply' | 'improve') => {
    setBusy(kind);
    setError(null);
    setResult(null);
    try {
      const res = kind === 'reply'
        ? await api.aiSuggestReply({
            subject: source!.subject,
            from: source!.from,
            body: source!.body,
            tone,
            instructions,
          })
        : await api.aiImprove({ text: getDraftText(), style: tone });
      setResult(res.result);
      // L'aperçu apparaît sous les boutons : sans ça, sur un écran court, la
      // réponse arrive hors du champ de vision et paraît ne pas être venue.
      requestAnimationFrame(() => resultRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    } catch (e: any) {
      setError(e?.message ?? 'Erreur');
    } finally {
      setBusy(null);
    }
  };

  const handleImprove = () => {
    if (!getDraftText().trim()) {
      toast.error('Écrivez d’abord quelques lignes à réécrire.');
      return;
    }
    run('improve');
  };

  return (
    <div className="border-t border-outlook-border bg-violet-50/40">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-1.5 px-4 py-1.5 text-2xs text-violet-800 hover:bg-violet-50"
      >
        <Sparkles size={12} />
        <span className="font-medium">Assistant IA</span>
        {ai.model && <span className="text-violet-700/70">· {ai.model}</span>}
        <ChevronDown size={12} className={`ml-auto transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="px-4 pb-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={tone}
              onChange={e => setTone(e.target.value)}
              className="px-2 py-1 text-xs border border-outlook-border rounded bg-white focus:outline-none focus:border-outlook-blue"
            >
              {TONES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            {canReply && (
              <button
                type="button"
                onClick={() => run('reply')}
                disabled={busy !== null}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-white border border-violet-300 text-violet-800 rounded hover:bg-violet-100 disabled:opacity-50"
              >
                {busy === 'reply' ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                {busy === 'reply' ? 'Rédaction…' : 'Proposer une réponse'}
              </button>
            )}
            {canImprove && (
              <button
                type="button"
                onClick={handleImprove}
                disabled={busy !== null}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-white border border-violet-300 text-violet-800 rounded hover:bg-violet-100 disabled:opacity-50"
              >
                {busy === 'improve' ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                {busy === 'improve' ? 'Réécriture…' : 'Réécrire mon texte'}
              </button>
            )}
          </div>

          {canReply && (
            <input
              type="text"
              value={instructions}
              onChange={e => setInstructions(e.target.value)}
              placeholder="Consigne facultative : « décline poliment », « propose mardi 14 h »…"
              className="w-full px-2 py-1 text-xs border border-outlook-border rounded bg-white focus:outline-none focus:border-outlook-blue"
            />
          )}

          {error && (
            <div className="px-2 py-1.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded">{error}</div>
          )}

          {result !== null && (
            <div ref={resultRef} className="border border-violet-200 rounded bg-white">
              <pre className="whitespace-pre-wrap text-sm text-outlook-text-primary font-sans p-2.5 max-h-64 overflow-y-auto">{result}</pre>
              <div className="flex flex-wrap items-center gap-1.5 px-2 py-1.5 border-t border-violet-100">
                <button
                  type="button"
                  onClick={() => { onInsert(result); setResult(null); }}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-outlook-blue text-white rounded hover:bg-outlook-blue-hover"
                >
                  <CornerDownLeft size={12} />
                  Insérer dans le message
                </button>
                <button
                  type="button"
                  onClick={() => { navigator.clipboard.writeText(result); toast.success('Copié'); }}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-xs border border-outlook-border rounded hover:bg-outlook-bg-hover"
                >
                  <Copy size={12} />
                  Copier
                </button>
                <button
                  type="button"
                  onClick={() => setResult(null)}
                  className="flex items-center gap-1.5 px-2 py-1 text-xs text-outlook-text-secondary hover:text-outlook-text-primary rounded hover:bg-outlook-bg-hover"
                >
                  <X size={12} />
                  Écarter
                </button>
                <span className="ml-auto text-2xs text-outlook-text-secondary">
                  Relisez avant d'envoyer.
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
