import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, TrendingUp, Sparkles, AlertTriangle, Loader2 } from 'lucide-react';

export interface GifPanelProps {
  open: boolean;
  onClose: () => void;
  /** Called with the GIF URL (the GIF/still image URL). Consumer inserts it into the editor. */
  onSelect: (url: string, alt?: string) => void;
}

type GifItem = {
  id: string;
  title: string;
  /** URL of the animated GIF image. */
  url: string;
  /** URL of a smaller preview image used in the grid. */
  preview: string;
  width: number;
  height: number;
};

type Mode = 'trending' | 'search' | 'stickers';

const DEFAULT_ENDPOINT = 'https://api.giphy.com/v1';
const LOCALSTORAGE_KEY = 'giphyApiKey';

function getApiKey(): string | null {
  // Order of precedence: explicit localStorage value, Vite build-time env var.
  const local = typeof window !== 'undefined' ? window.localStorage.getItem(LOCALSTORAGE_KEY) : null;
  if (local && local.trim()) return local.trim();
  const env = (import.meta as any).env?.VITE_GIPHY_API_KEY as string | undefined;
  return env && env.trim() ? env.trim() : null;
}

type GiphyApiItem = {
  id: string;
  title?: string;
  images: {
    fixed_width?: { url: string; width: string; height: string };
    fixed_width_small?: { url: string; width: string; height: string };
    fixed_height_small?: { url: string; width: string; height: string };
    original?: { url: string; width: string; height: string };
    downsized_medium?: { url: string; width: string; height: string };
  };
};

function normalize(item: GiphyApiItem): GifItem {
  const preview = item.images.fixed_width_small || item.images.fixed_height_small || item.images.fixed_width || item.images.original;
  const full = item.images.downsized_medium || item.images.original || item.images.fixed_width;
  return {
    id: item.id,
    title: item.title || 'GIF',
    url: full?.url || preview?.url || '',
    preview: preview?.url || full?.url || '',
    width: Number(preview?.width || 200),
    height: Number(preview?.height || 150),
  };
}

async function fetchGiphy(path: string, params: Record<string, string>): Promise<GifItem[]> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('NO_KEY');
  const qs = new URLSearchParams({ api_key: apiKey, ...params });
  const res = await fetch(`${DEFAULT_ENDPOINT}${path}?${qs.toString()}`);
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new Error('BAD_KEY');
    throw new Error('NETWORK');
  }
  const json = await res.json();
  const data: GiphyApiItem[] = Array.isArray(json?.data) ? json.data : [];
  return data.map(normalize);
}

export default function GifPanel({ open, onClose, onSelect }: GifPanelProps) {
  const [mode, setMode] = useState<Mode>('trending');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [items, setItems] = useState<GifItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<null | 'NO_KEY' | 'BAD_KEY' | 'NETWORK'>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [apiKeyVersion, setApiKeyVersion] = useState(0); // re-trigger fetch on save
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounce the search input (300ms).
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  // When the search field has content, switch to search mode automatically.
  useEffect(() => {
    if (debouncedQuery) setMode('search');
    else if (mode === 'search') setMode('trending');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery]);

  const load = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    setError(null);
    try {
      let results: GifItem[] = [];
      if (mode === 'stickers') {
        if (debouncedQuery) {
          results = await fetchGiphy('/stickers/search', { q: debouncedQuery, limit: '40', rating: 'pg-13' });
        } else {
          results = await fetchGiphy('/stickers/trending', { limit: '40', rating: 'pg-13' });
        }
      } else if (mode === 'search' && debouncedQuery) {
        results = await fetchGiphy('/gifs/search', { q: debouncedQuery, limit: '40', rating: 'pg-13' });
      } else {
        results = await fetchGiphy('/gifs/trending', { limit: '40', rating: 'pg-13' });
      }
      setItems(results);
    } catch (e: any) {
      if (e?.message === 'NO_KEY') setError('NO_KEY');
      else if (e?.message === 'BAD_KEY') setError('BAD_KEY');
      else setError('NETWORK');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [open, mode, debouncedQuery]);

  useEffect(() => {
    if (open) load();
  }, [open, load, apiKeyVersion]);

  const saveApiKey = () => {
    const trimmed = apiKeyInput.trim();
    if (!trimmed) return;
    window.localStorage.setItem(LOCALSTORAGE_KEY, trimmed);
    setApiKeyInput('');
    setApiKeyVersion(v => v + 1);
  };

  const clearApiKey = () => {
    window.localStorage.removeItem(LOCALSTORAGE_KEY);
    setApiKeyVersion(v => v + 1);
  };

  // Split items into two columns for a masonry-style layout.
  const columns = useMemo(() => {
    const left: GifItem[] = [];
    const right: GifItem[] = [];
    let leftH = 0;
    let rightH = 0;
    for (const item of items) {
      const ratio = item.width > 0 ? item.height / item.width : 1;
      if (leftH <= rightH) {
        left.push(item);
        leftH += ratio;
      } else {
        right.push(item);
        rightH += ratio;
      }
    }
    return [left, right];
  }, [items]);

  if (!open) return null;

  return (
    <aside
      className="flex-shrink-0 w-80 h-full bg-white rounded-md shadow-sm overflow-hidden flex flex-col border border-outlook-border"
      aria-label="Panneau GIF"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-outlook-border">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-outlook-text-primary">GIF</h3>
          <span className="text-[10px] text-outlook-text-disabled">powered by GIPHY</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-outlook-bg-hover text-outlook-text-secondary"
          title="Fermer"
        >
          <X size={16} />
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-outlook-border">
        <div className="relative">
          <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-outlook-text-disabled pointer-events-none" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher des GIF"
            className="w-full text-xs pl-7 pr-2 py-1.5 bg-outlook-bg-tertiary rounded border border-transparent focus:bg-white focus:border-outlook-blue outline-none"
          />
        </div>
      </div>

      {/* Mode tabs */}
      <div className="flex items-center gap-0.5 px-2 py-1 border-b border-outlook-border flex-shrink-0">
        <button
          onClick={() => setMode('trending')}
          className={`flex items-center gap-1 px-2 py-1 rounded text-xs ${
            mode === 'trending' && !debouncedQuery
              ? 'bg-outlook-blue/10 text-outlook-blue'
              : 'text-outlook-text-secondary hover:bg-outlook-bg-hover'
          }`}
          title="Tendances"
        >
          <TrendingUp size={13} />
          <span>Tendances</span>
        </button>
        <button
          onClick={() => setMode('stickers')}
          className={`flex items-center gap-1 px-2 py-1 rounded text-xs ${
            mode === 'stickers'
              ? 'bg-outlook-blue/10 text-outlook-blue'
              : 'text-outlook-text-secondary hover:bg-outlook-bg-hover'
          }`}
          title="Stickers"
        >
          <Sparkles size={13} />
          <span>Stickers</span>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-2">
        {error === 'NO_KEY' ? (
          <ApiKeyPrompt
            title="Clé GIPHY requise"
            description="Le panneau GIF utilise l'API GIPHY. Obtenez une clé gratuite sur developers.giphy.com puis collez-la ci-dessous."
            input={apiKeyInput}
            onChange={setApiKeyInput}
            onSave={saveApiKey}
          />
        ) : error === 'BAD_KEY' ? (
          <ApiKeyPrompt
            title="Clé GIPHY invalide"
            description="La clé stockée a été refusée par GIPHY. Vérifiez-la ou saisissez-en une nouvelle."
            input={apiKeyInput}
            onChange={setApiKeyInput}
            onSave={saveApiKey}
            onClear={clearApiKey}
          />
        ) : error === 'NETWORK' ? (
          <div className="flex flex-col items-center gap-2 py-8 text-outlook-text-secondary">
            <AlertTriangle size={20} />
            <span className="text-xs">Impossible de contacter GIPHY</span>
            <button onClick={load} className="text-xs px-3 py-1 bg-outlook-blue text-white rounded">Réessayer</button>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-8 text-outlook-text-secondary">
            <Loader2 size={18} className="animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <div className="text-xs text-outlook-text-secondary text-center py-8">
            {debouncedQuery ? 'Aucun résultat' : 'Aucun GIF disponible'}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-1">
            {columns.map((col, i) => (
              <div key={i} className="flex flex-col gap-1">
                {col.map(item => (
                  <button
                    key={item.id}
                    onMouseDown={(e) => { e.preventDefault(); onSelect(item.url, item.title); }}
                    className="relative overflow-hidden rounded bg-outlook-bg-tertiary hover:ring-2 hover:ring-outlook-blue transition-shadow"
                    title={item.title}
                  >
                    <img
                      src={item.preview}
                      alt={item.title}
                      loading="lazy"
                      className="w-full h-auto block"
                    />
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer: API key management shortcut */}
      {!error && (
        <div className="px-3 py-1.5 border-t border-outlook-border flex items-center justify-between text-[10px] text-outlook-text-disabled">
          <span>GIPHY</span>
          <button
            onClick={clearApiKey}
            className="hover:text-outlook-text-secondary"
            title="Réinitialiser la clé GIPHY"
          >
            Changer la clé
          </button>
        </div>
      )}
    </aside>
  );
}

function ApiKeyPrompt({ title, description, input, onChange, onSave, onClear }: {
  title: string;
  description: string;
  input: string;
  onChange: (v: string) => void;
  onSave: () => void;
  onClear?: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 p-2">
      <h4 className="text-sm font-semibold text-outlook-text-primary">{title}</h4>
      <p className="text-xs text-outlook-text-secondary leading-snug">{description}</p>
      <input
        type="text"
        value={input}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onSave(); }}
        placeholder="Clé API GIPHY"
        className="text-xs border border-outlook-border rounded px-2 py-1.5 outline-none focus:border-outlook-blue"
      />
      <div className="flex justify-end gap-1">
        {onClear && (
          <button onClick={onClear} className="text-xs px-2 py-1 rounded hover:bg-outlook-bg-hover">
            Effacer
          </button>
        )}
        <button
          onClick={onSave}
          disabled={!input.trim()}
          className="bg-outlook-blue text-white text-xs px-3 py-1 rounded disabled:opacity-50"
        >
          Enregistrer
        </button>
      </div>
      <a
        href="https://developers.giphy.com/"
        target="_blank"
        rel="noopener noreferrer"
        className="text-[11px] text-outlook-blue hover:underline"
      >
        Obtenir une clé GIPHY →
      </a>
    </div>
  );
}
