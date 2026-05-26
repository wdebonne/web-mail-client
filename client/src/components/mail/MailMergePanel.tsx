import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Cloud, ChevronLeft, ChevronRight, Eye, EyeOff, X, Send,
  Loader2, FileSpreadsheet, ArrowLeftRight,
} from 'lucide-react';
import { api } from '../../api';
import NextcloudFilePicker, { type NextcloudFileItem } from '../ui/NextcloudFilePicker';
import type { ComposeApi } from './ComposeModal';
import toast from 'react-hot-toast';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MailMergeRow {
  [column: string]: string;
}

export interface MailMergeState {
  fileName: string;
  columns: string[];
  rows: MailMergeRow[];
  /** Maps {variable} name to column name */
  mapping: Record<string, string>;
  /** Column whose value is used as the recipient email (overrides compose To) */
  emailColumn: string;
  currentRowIndex: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function detectVariables(subject: string, bodyHtml: string): string[] {
  const combined = subject + ' ' + bodyHtml.replace(/<[^>]*>/g, ' ');
  const matches = [...combined.matchAll(/\{([^}]+)\}/g)];
  return [...new Set(matches.map(m => m[1].trim()))];
}

function applyVars(template: string, row: MailMergeRow, mapping: Record<string, string>): string {
  return template.replace(/\{([^}]+)\}/g, (_, v) => {
    const col = mapping[v.trim()] ?? v.trim();
    return row[col] ?? `{${v}}`;
  });
}

async function parseSpreadsheet(file: File): Promise<{ columns: string[]; rows: MailMergeRow[] }> {
  const XLSX = await import('xlsx');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target?.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
        if (!json.length) { reject(new Error('Fichier vide ou sans données')); return; }
        const columns = Object.keys(json[0]);
        const rows = json.map(r =>
          Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v)]))
        );
        resolve({ columns, rows });
      } catch (err: any) {
        reject(new Error(`Impossible de lire le fichier : ${err?.message}`));
      }
    };
    reader.onerror = () => reject(new Error('Erreur de lecture du fichier'));
    reader.readAsArrayBuffer(file);
  });
}

function guessEmailColumn(columns: string[]): string {
  const candidates = ['email', 'mail', 'e-mail', 'courriel', 'adresse mail', 'adresse email', 'adresse e-mail'];
  return columns.find(c => candidates.includes(c.toLowerCase())) ?? '';
}

function buildAutoMapping(variables: string[], columns: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const v of variables) {
    const match = columns.find(c => c.toLowerCase() === v.toLowerCase()) ?? v;
    mapping[v] = match;
  }
  return mapping;
}

// ─── Local UI primitives (mirrors Ribbon.tsx helpers) ────────────────────────

function MRibbonButton({ icon: Icon, label, onClick, disabled, active, small }: {
  icon: any; label: string; onClick: () => void;
  disabled?: boolean; active?: boolean; small?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={`flex flex-col items-center gap-0.5 rounded transition-colors px-2 py-1 min-w-[48px]
        ${small ? 'px-1.5 py-0.5 min-w-[40px]' : ''}
        ${disabled ? 'opacity-40 cursor-default' : 'hover:bg-outlook-bg-hover cursor-pointer'}
        ${active ? 'bg-outlook-blue/10 text-outlook-blue' : ''}`}
    >
      <Icon size={small ? 16 : 18} />
      <span className={`${small ? 'text-[9px]' : 'text-[10px]'} leading-tight text-center whitespace-nowrap`}>{label}</span>
    </button>
  );
}

function MRibbonSep() {
  return <div className="w-px h-10 bg-outlook-border mx-1 self-center" />;
}

function MRibbonGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center">
      <div className="flex items-end gap-0.5 px-1 flex-1">{children}</div>
      <span className="text-[9px] text-outlook-text-disabled mt-0.5 leading-none">{label}</span>
    </div>
  );
}

function MSimplifiedButton({ icon: Icon, label, onClick, disabled, active }: {
  icon: any; label: string; onClick: () => void;
  disabled?: boolean; active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={`flex items-center gap-1 rounded transition-colors px-2 py-1
        ${disabled ? 'opacity-40 cursor-default' : 'hover:bg-outlook-bg-hover cursor-pointer'}
        ${active ? 'bg-outlook-blue/10 text-outlook-blue' : ''}`}
    >
      <Icon size={14} />
      <span className="text-xs whitespace-nowrap">{label}</span>
    </button>
  );
}

function MSimplifiedSep() {
  return <div className="w-px h-5 bg-outlook-border mx-0.5 self-center" />;
}

// ─── Mapping Modal ────────────────────────────────────────────────────────────

function MappingModal({
  variables, columns, mapping, emailColumn,
  onSave, onClose,
}: {
  variables: string[];
  columns: string[];
  mapping: Record<string, string>;
  emailColumn: string;
  onSave: (mapping: Record<string, string>, emailColumn: string) => void;
  onClose: () => void;
}) {
  const [localMapping, setLocalMapping] = useState<Record<string, string>>(mapping);
  const [localEmail, setLocalEmail] = useState(emailColumn);

  const save = () => { onSave(localMapping, localEmail); onClose(); };

  return createPortal(
    <div className="fixed inset-0 z-[9500] flex items-center justify-center">
      <div className="fixed inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white rounded-lg shadow-xl w-[520px] max-h-[80vh] flex flex-col border border-outlook-border">
        <div className="flex items-center justify-between px-4 py-3 border-b border-outlook-border">
          <h2 className="text-sm font-semibold text-outlook-text-primary">Correspondance des variables</h2>
          <button onClick={onClose} className="text-outlook-text-secondary hover:text-outlook-text-primary p-0.5 rounded">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Recipient email column */}
          <div>
            <p className="text-[11px] font-medium text-outlook-text-secondary uppercase tracking-wide mb-2">Destinataire</p>
            <div className="flex items-center gap-3">
              <span className="text-sm text-outlook-text-secondary w-40 shrink-0">Colonne e-mail destinataire</span>
              <select
                value={localEmail}
                onChange={e => setLocalEmail(e.target.value)}
                className="flex-1 text-sm border border-outlook-border rounded px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-outlook-blue"
              >
                <option value="">— Utiliser les destinataires du message —</option>
                {columns.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {/* Variable → column mapping */}
          {variables.length > 0 && (
            <div>
              <p className="text-[11px] font-medium text-outlook-text-secondary uppercase tracking-wide mb-2">
                Variables → Colonnes du fichier
              </p>
              <div className="space-y-2">
                {variables.map(v => (
                  <div key={v} className="flex items-center gap-3">
                    <span className="text-sm font-mono bg-blue-50 text-outlook-blue px-2 py-0.5 rounded w-40 shrink-0 truncate" title={`{${v}}`}>
                      {`{${v}}`}
                    </span>
                    <ArrowLeftRight size={12} className="text-outlook-text-disabled shrink-0" />
                    <select
                      value={localMapping[v] ?? v}
                      onChange={e => setLocalMapping(prev => ({ ...prev, [v]: e.target.value }))}
                      className="flex-1 text-sm border border-outlook-border rounded px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-outlook-blue"
                    >
                      {columns.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {variables.length === 0 && (
            <p className="text-sm text-outlook-text-secondary text-center py-6">
              Aucune variable détectée dans le sujet ou le corps du message.
              <br />
              <span className="text-xs">Utilisez la syntaxe <code className="bg-outlook-bg-hover px-1 rounded">&#123;NomColonne&#125;</code> dans votre message.</span>
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-outlook-border">
          <button onClick={onClose} className="text-sm px-3 py-1.5 border border-outlook-border rounded hover:bg-outlook-bg-hover text-outlook-text-secondary transition-colors">
            Annuler
          </button>
          <button onClick={save} className="text-sm px-3 py-1.5 bg-outlook-blue text-white rounded hover:bg-outlook-blue/90 transition-colors">
            Enregistrer
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── Send All helper ──────────────────────────────────────────────────────────

async function sendAll(
  mergeState: MailMergeState,
  snapshot: ReturnType<ComposeApi['getComposeSnapshot']>,
  template: { subject: string; bodyHtml: string },
  onProgress: (done: number, total: number) => void,
): Promise<{ success: number; errors: number }> {
  const { rows, mapping, emailColumn } = mergeState;
  let success = 0;
  let errors = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    // Always resolve from the saved template, not from the (possibly previewed) compose state
    const resolvedSubject = applyVars(template.subject, row, mapping);
    const resolvedBody    = applyVars(template.bodyHtml, row, mapping);
    const toRecipients    = emailColumn && row[emailColumn]
      ? [{ address: row[emailColumn], name: '' }]
      : snapshot.to;

    if (!toRecipients.length) { errors++; onProgress(i + 1, rows.length); continue; }

    try {
      await api.sendMail({
        accountId: snapshot.accountId,
        subject:   resolvedSubject,
        bodyHtml:  resolvedBody,
        to:        toRecipients,
        cc:        snapshot.cc,
        bcc:       snapshot.bcc,
        attachments: snapshot.attachments,
      });
      success++;
    } catch {
      errors++;
    }
    onProgress(i + 1, rows.length);
  }
  return { success, errors };
}

// ─── Tab Content ──────────────────────────────────────────────────────────────

export function PublipostageTabContent({
  composeApiRef,
  compact = false,
}: {
  composeApiRef?: React.MutableRefObject<ComposeApi | null>;
  compact?: boolean;
}) {
  const [mergeState, setMergeState] = useState<MailMergeState | null>(null);
  const [ncLinked, setNcLinked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showNcPicker, setShowNcPicker] = useState(false);
  const [showMapping, setShowMapping] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendProgress, setSendProgress] = useState<{ done: number; total: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Inline preview state ────────────────────────────────────────────────────
  // When previewMode is true, the compose editor shows resolved values for the
  // current row. savedTemplate holds the original {variable} content so it can
  // be restored when preview is toggled off.
  const [previewMode, setPreviewMode] = useState(false);
  const [savedTemplate, setSavedTemplate] = useState<{ subject: string; bodyHtml: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getUserNextcloudStatus()
      .then(s => { if (!cancelled) setNcLinked(!!(s.enabled && s.linked)); })
      .catch(() => { if (!cancelled) setNcLinked(false); });
    return () => { cancelled = true; };
  }, []);

  // Apply resolved content for a given row index into the compose editor
  const applyPreviewRow = useCallback((
    rowIndex: number,
    state: MailMergeState,
    template: { subject: string; bodyHtml: string },
  ) => {
    const row = state.rows[rowIndex] ?? {};
    const resolvedSubject = applyVars(template.subject, row, state.mapping);
    const resolvedBody    = applyVars(template.bodyHtml, row, state.mapping);
    composeApiRef?.current?.applyTemplate(resolvedSubject, resolvedBody);
  }, [composeApiRef]);

  // Exit preview mode and restore the original template
  const exitPreview = useCallback((template: { subject: string; bodyHtml: string } | null) => {
    if (template) {
      composeApiRef?.current?.applyTemplate(template.subject, template.bodyHtml);
    }
    setPreviewMode(false);
    setSavedTemplate(null);
  }, [composeApiRef]);

  // Toggle preview on/off
  const togglePreview = () => {
    if (!mergeState) return;
    if (!previewMode) {
      // Capture the current template content before we overwrite it
      const snapshot = composeApiRef?.current?.getComposeSnapshot();
      if (!snapshot) return;
      const tpl = { subject: snapshot.subject, bodyHtml: snapshot.bodyHtml };
      setSavedTemplate(tpl);
      setPreviewMode(true);
      applyPreviewRow(mergeState.currentRowIndex, mergeState, tpl);
    } else {
      exitPreview(savedTemplate);
    }
  };

  const loadFile = async (file: File) => {
    // Exit preview before loading a new file
    if (previewMode) exitPreview(savedTemplate);

    setLoading(true);
    try {
      const { columns, rows } = await parseSpreadsheet(file);
      const snapshot = composeApiRef?.current?.getComposeSnapshot();
      const variables = snapshot ? detectVariables(snapshot.subject, snapshot.bodyHtml) : [];
      setMergeState({
        fileName: file.name,
        columns,
        rows,
        mapping: buildAutoMapping(variables, columns),
        emailColumn: guessEmailColumn(columns),
        currentRowIndex: 0,
      });
      toast.success(`${rows.length} ligne${rows.length > 1 ? 's' : ''} chargée${rows.length > 1 ? 's' : ''} depuis "${file.name}"`);
    } catch (e: any) {
      toast.error(e?.message ?? 'Erreur lors du chargement du fichier');
    } finally {
      setLoading(false);
    }
  };

  const handleLocalFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) loadFile(file);
    e.target.value = '';
  };

  const handleNcPick = async (files: NextcloudFileItem[]) => {
    setShowNcPicker(false);
    if (!files.length) return;
    setLoading(true);
    try {
      const item = files[0];
      const res = await api.nextcloudFilesGet(item.path);
      const mimeType = (res.contentType || '').split(';')[0].trim() || 'application/octet-stream';
      const bytes = Uint8Array.from(atob(res.contentBase64), c => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: mimeType });
      await loadFile(new File([blob], res.filename || item.name, { type: mimeType }));
    } catch (e: any) {
      toast.error(`Erreur Nextcloud : ${e?.message ?? 'Échec du téléchargement'}`);
      setLoading(false);
    }
  };

  // Navigate between rows; if in preview mode, update the compose editor immediately
  const updateRow = (delta: number) => {
    if (!mergeState) return;
    const newIndex = Math.max(0, Math.min(mergeState.rows.length - 1, mergeState.currentRowIndex + delta));
    if (newIndex === mergeState.currentRowIndex) return;
    const nextState = { ...mergeState, currentRowIndex: newIndex };
    setMergeState(nextState);
    if (previewMode && savedTemplate) {
      applyPreviewRow(newIndex, nextState, savedTemplate);
    }
  };

  // Save mapping — if in preview mode, re-resolve immediately with the new mapping
  const handleSaveMapping = (m: Record<string, string>, emailCol: string) => {
    const nextState = mergeState ? { ...mergeState, mapping: m, emailColumn: emailCol } : null;
    setMergeState(nextState);
    if (previewMode && savedTemplate && nextState) {
      applyPreviewRow(nextState.currentRowIndex, nextState, savedTemplate);
    }
  };

  const handleSendAll = async () => {
    if (!mergeState) return;
    // When in preview mode the compose holds resolved content, so use savedTemplate.
    // Otherwise read the current compose snapshot as the template.
    const tpl = savedTemplate ?? (() => {
      const snap = composeApiRef?.current?.getComposeSnapshot();
      return snap ? { subject: snap.subject, bodyHtml: snap.bodyHtml } : null;
    })();
    const snapshot = composeApiRef?.current?.getComposeSnapshot();
    if (!tpl || !snapshot) { toast.error('Impossible d\'accéder aux données du message'); return; }

    setSending(true);
    setSendProgress({ done: 0, total: mergeState.rows.length });
    const { success, errors } = await sendAll(mergeState, snapshot, tpl, (done, total) =>
      setSendProgress({ done, total })
    );
    setSending(false);
    setSendProgress(null);
    if (errors === 0) {
      toast.success(`${success} message${success > 1 ? 's' : ''} envoyé${success > 1 ? 's' : ''}`);
    } else {
      toast(`${success} envoyé${success > 1 ? 's' : ''}, ${errors} échec${errors > 1 ? 's' : ''}`, { icon: '⚠️' });
    }
  };

  const getVariables = () => {
    // When in preview mode, variables come from the saved template, not the resolved compose
    const src = savedTemplate ?? (() => {
      const snap = composeApiRef?.current?.getComposeSnapshot();
      return snap ? { subject: snap.subject, bodyHtml: snap.bodyHtml } : null;
    })();
    return src ? detectVariables(src.subject, src.bodyHtml) : [];
  };

  const totalRows = mergeState?.rows.length ?? 0;
  const currentRow = mergeState?.currentRowIndex ?? 0;
  const sendLabel = sending
    ? `${sendProgress?.done ?? 0}/${sendProgress?.total ?? totalRows}`
    : `Envoyer (${totalRows})`;

  const modals = (
    <>
      {showNcPicker && (
        <NextcloudFilePicker
          open={showNcPicker}
          onPick={handleNcPick}
          onClose={() => setShowNcPicker(false)}
        />
      )}
      {showMapping && mergeState && (
        <MappingModal
          variables={getVariables()}
          columns={mergeState.columns}
          mapping={mergeState.mapping}
          emailColumn={mergeState.emailColumn}
          onSave={handleSaveMapping}
          onClose={() => setShowMapping(false)}
        />
      )}
    </>
  );

  // ── Compact (simplified ribbon) ──────────────────────────────────────────
  if (compact) {
    return (
      <>
        <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls,.ods" className="hidden" onChange={handleLocalFile} />
        <MSimplifiedButton
          icon={loading ? Loader2 : FileSpreadsheet}
          label={mergeState ? mergeState.fileName.slice(0, 16) + (mergeState.fileName.length > 16 ? '…' : '') : 'Charger fichier'}
          onClick={() => fileInputRef.current?.click()}
          disabled={loading}
        />
        {ncLinked && (
          <MSimplifiedButton icon={Cloud} label="Nextcloud" onClick={() => setShowNcPicker(true)} disabled={loading} />
        )}
        {mergeState && (
          <>
            <MSimplifiedSep />
            <button
              onClick={() => updateRow(-1)}
              disabled={currentRow === 0}
              className="p-1 rounded hover:bg-outlook-bg-hover disabled:opacity-30 text-outlook-text-secondary transition-colors"
              title="Ligne précédente"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="text-xs tabular-nums text-outlook-text-primary px-1 min-w-[40px] text-center">
              {currentRow + 1}/{totalRows}
            </span>
            <button
              onClick={() => updateRow(1)}
              disabled={currentRow >= totalRows - 1}
              className="p-1 rounded hover:bg-outlook-bg-hover disabled:opacity-30 text-outlook-text-secondary transition-colors"
              title="Ligne suivante"
            >
              <ChevronRight size={14} />
            </button>
            <MSimplifiedSep />
            <MSimplifiedButton
              icon={previewMode ? EyeOff : Eye}
              label={previewMode ? 'Quitter aperçu' : 'Aperçu'}
              onClick={togglePreview}
              active={previewMode}
            />
            <MSimplifiedButton icon={ArrowLeftRight} label="Variables" onClick={() => setShowMapping(true)} />
            <MSimplifiedSep />
            <MSimplifiedButton
              icon={sending ? Loader2 : Send}
              label={sendLabel}
              onClick={handleSendAll}
              disabled={sending}
            />
          </>
        )}
        {modals}
      </>
    );
  }

  // ── Classic (full-height ribbon) ─────────────────────────────────────────
  return (
    <>
      <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls,.ods" className="hidden" onChange={handleLocalFile} />

      {/* Fichier source */}
      <MRibbonGroup label="Fichier source">
        <MRibbonButton
          icon={loading ? Loader2 : FileSpreadsheet}
          label="Charger..."
          onClick={() => fileInputRef.current?.click()}
          disabled={loading}
        />
        {ncLinked && (
          <MRibbonButton
            icon={Cloud}
            label="Nextcloud"
            onClick={() => setShowNcPicker(true)}
            disabled={loading}
            small
          />
        )}
        {mergeState && (
          <div className="flex flex-col justify-center ml-1 max-w-[96px]">
            <span className="text-[10px] text-outlook-text-primary font-medium truncate leading-tight" title={mergeState.fileName}>
              {mergeState.fileName}
            </span>
            <span className="text-[9px] text-outlook-text-disabled leading-tight">
              {totalRows} ligne{totalRows > 1 ? 's' : ''}
            </span>
          </div>
        )}
      </MRibbonGroup>

      {mergeState && (
        <>
          <MRibbonSep />

          {/* Navigation */}
          <MRibbonGroup label="Navigation">
            <div className="flex items-center gap-0.5 self-center">
              <button
                onClick={() => updateRow(-1)}
                disabled={currentRow === 0}
                className="p-1.5 rounded hover:bg-outlook-bg-hover disabled:opacity-30 text-outlook-text-secondary transition-colors"
                title="Ligne précédente"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="text-xs font-medium tabular-nums text-outlook-text-primary px-1 min-w-[52px] text-center">
                {currentRow + 1} / {totalRows}
              </span>
              <button
                onClick={() => updateRow(1)}
                disabled={currentRow >= totalRows - 1}
                className="p-1.5 rounded hover:bg-outlook-bg-hover disabled:opacity-30 text-outlook-text-secondary transition-colors"
                title="Ligne suivante"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </MRibbonGroup>
          <MRibbonSep />

          {/* Aperçu & Variables */}
          <MRibbonGroup label="Aperçu">
            <MRibbonButton
              icon={previewMode ? EyeOff : Eye}
              label={previewMode ? 'Quitter' : 'Aperçu'}
              onClick={togglePreview}
              active={previewMode}
            />
            <MRibbonButton icon={ArrowLeftRight} label="Variables" onClick={() => setShowMapping(true)} />
          </MRibbonGroup>
          <MRibbonSep />

          {/* Envoi */}
          <MRibbonGroup label="Envoi">
            <MRibbonButton
              icon={sending ? Loader2 : Send}
              label={sendLabel}
              onClick={handleSendAll}
              disabled={sending}
            />
          </MRibbonGroup>
        </>
      )}

      {modals}
    </>
  );
}
