import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import {
  Mail, Save, TestTube, Plus, Edit2, Trash2, X, Eye, EyeOff,
  CheckCircle, XCircle, Send, Code, ChevronDown, ToggleLeft, ToggleRight,
  RefreshCw,
} from 'lucide-react';
import toast from 'react-hot-toast';

// ── Types ──────────────────────────────────────────────────────────────────────

interface SystemTemplate {
  id: string;
  slug: string;
  name: string;
  description: string;
  subject: string;
  body_html: string;
  body_text: string;
  variables: Array<{ key: string; label: string; example: string }>;
  enabled: boolean;
  updated_at: string;
}

interface SmtpConfig {
  host: string;
  port: number;
  secure: 'starttls' | 'ssl' | 'none';
  username: string;
  hasPassword: boolean;
  fromName: string;
  fromEmail: string;
}

// ── Variable chip ──────────────────────────────────────────────────────────────

function VarChip({ varKey, label, onInsert }: { varKey: string; label: string; onInsert: (key: string) => void }) {
  return (
    <button type="button" onClick={() => onInsert(`{{${varKey}}}`)}
      title={`Insérer {{${varKey}}}`}
      className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 cursor-pointer font-mono">
      {`{{${varKey}}}`}
      <span className="text-blue-400 font-sans text-[10px] normal-case">— {label}</span>
    </button>
  );
}

// ── Live preview (renders HTML in iframe sandbox) ──────────────────────────────

function LivePreview({ html, vars }: { html: string; vars: Record<string, string> }) {
  const rendered = html.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `<span style="background:#ffe;color:#a60">{{${k}}}</span>`);
  return (
    <iframe
      title="preview"
      sandbox="allow-same-origin"
      srcDoc={`<!DOCTYPE html><html><body style="margin:16px;font-family:sans-serif">${rendered}</body></html>`}
      className="w-full h-full border-0 rounded"
    />
  );
}

// ── Template Editor Modal ──────────────────────────────────────────────────────

interface EditorProps {
  template: Partial<SystemTemplate> | null;
  onClose: () => void;
  onSaved: () => void;
}

function TemplateEditorModal({ template, onClose, onSaved }: EditorProps) {
  const isNew = !template?.id;
  const [activeTab, setActiveTab] = useState<'html' | 'text' | 'preview'>('html');
  const [form, setForm] = useState({
    slug: template?.slug ?? '',
    name: template?.name ?? '',
    description: template?.description ?? '',
    subject: template?.subject ?? '',
    bodyHtml: template?.body_html ?? '',
    bodyText: template?.body_text ?? '',
    variables: template?.variables ?? [] as Array<{ key: string; label: string; example: string }>,
    enabled: template?.enabled !== false,
  });
  const [testTo, setTestTo] = useState('');
  const [testVars, setTestVars] = useState<Record<string, string>>({});
  const [showTestPanel, setShowTestPanel] = useState(false);
  const [newVar, setNewVar] = useState({ key: '', label: '', example: '' });
  const [showVarForm, setShowVarForm] = useState(false);

  // Build preview vars from form.variables examples
  const previewVars: Record<string, string> = {};
  for (const v of form.variables) previewVars[v.key] = testVars[v.key] ?? v.example;

  const saveMutation = useMutation({
    mutationFn: (data: any) => isNew ? api.createSystemTemplate(data) : api.updateSystemTemplate(template!.id!, data),
    onSuccess: () => { toast.success(isNew ? 'Template créé' : 'Template mis à jour'); onSaved(); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });

  const testMutation = useMutation({
    mutationFn: () => api.testSystemTemplate(template!.id!, { testTo, variables: previewVars }),
    onSuccess: (r: any) => toast.success(r.message),
    onError: (e: any) => toast.error(e.message),
  });

  function insertVar(snippet: string) {
    // Insert at cursor — simple append when no ref available
    if (activeTab === 'html') setForm(f => ({ ...f, bodyHtml: f.bodyHtml + snippet }));
    else if (activeTab === 'text') setForm(f => ({ ...f, bodyText: f.bodyText + snippet }));
    else setForm(f => ({ ...f, subject: f.subject + snippet }));
  }

  function addVariable() {
    if (!newVar.key) return;
    setForm(f => ({ ...f, variables: [...f.variables, { ...newVar }] }));
    setNewVar({ key: '', label: '', example: '' });
    setShowVarForm(false);
  }

  function removeVar(key: string) {
    setForm(f => ({ ...f, variables: f.variables.filter(v => v.key !== key) }));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-outlook-bg-primary border border-outlook-border rounded-xl shadow-2xl w-full max-w-5xl h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-outlook-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <Mail size={16} className="text-outlook-blue" />
            <h3 className="font-semibold text-sm">{isNew ? 'Nouveau template' : `Éditer : ${template?.name}`}</h3>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs cursor-pointer text-outlook-text-secondary">
              {form.enabled ? <ToggleRight size={18} className="text-green-500" /> : <ToggleLeft size={18} />}
              {form.enabled ? 'Actif' : 'Inactif'}
              <input type="checkbox" className="sr-only" checked={form.enabled} onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))} />
            </label>
            <button onClick={onClose} className="p-1 hover:text-red-500"><X size={16} /></button>
          </div>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Left: settings + editor */}
          <div className="flex-1 flex flex-col min-w-0 border-r border-outlook-border">
            {/* Metadata */}
            <div className="px-5 py-3 border-b border-outlook-border space-y-2 flex-shrink-0">
              <div className="grid grid-cols-2 gap-3">
                {isNew && (
                  <div>
                    <label className="text-[10px] text-outlook-text-disabled uppercase tracking-wide mb-0.5 block">Slug (identifiant unique)</label>
                    <input type="text" value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/\s+/g, '_') }))}
                      placeholder="mon_template" className="w-full text-sm border border-outlook-border rounded px-2 py-1.5 bg-outlook-bg-primary focus:outline-none focus:ring-1 focus:ring-outlook-blue" />
                  </div>
                )}
                <div>
                  <label className="text-[10px] text-outlook-text-disabled uppercase tracking-wide mb-0.5 block">Nom</label>
                  <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full text-sm border border-outlook-border rounded px-2 py-1.5 bg-outlook-bg-primary focus:outline-none focus:ring-1 focus:ring-outlook-blue" />
                </div>
                <div>
                  <label className="text-[10px] text-outlook-text-disabled uppercase tracking-wide mb-0.5 block">Sujet</label>
                  <input type="text" value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} placeholder="Objet de l'email"
                    className="w-full text-sm border border-outlook-border rounded px-2 py-1.5 bg-outlook-bg-primary focus:outline-none focus:ring-1 focus:ring-outlook-blue" />
                </div>
              </div>
              <div>
                <label className="text-[10px] text-outlook-text-disabled uppercase tracking-wide mb-0.5 block">Description</label>
                <input type="text" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  className="w-full text-sm border border-outlook-border rounded px-2 py-1.5 bg-outlook-bg-primary focus:outline-none focus:ring-1 focus:ring-outlook-blue" />
              </div>
            </div>

            {/* Variables bar */}
            <div className="px-5 py-2 border-b border-outlook-border bg-outlook-bg-hover flex-shrink-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] text-outlook-text-disabled uppercase tracking-wide mr-1">Variables :</span>
                {form.variables.map(v => <VarChip key={v.key} varKey={v.key} label={v.label} onInsert={insertVar} />)}
                <button type="button" onClick={() => setShowVarForm(v => !v)}
                  className="text-[11px] px-2 py-0.5 rounded border border-dashed border-outlook-border text-outlook-text-secondary hover:border-outlook-blue hover:text-outlook-blue flex items-center gap-1">
                  <Plus size={10} /> Variable
                </button>
              </div>
              {showVarForm && (
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <input type="text" placeholder="clé" value={newVar.key} onChange={e => setNewVar(v => ({ ...v, key: e.target.value }))}
                    className="text-xs border border-outlook-border rounded px-2 py-1 w-28 bg-outlook-bg-primary focus:outline-none" />
                  <input type="text" placeholder="label affiché" value={newVar.label} onChange={e => setNewVar(v => ({ ...v, label: e.target.value }))}
                    className="text-xs border border-outlook-border rounded px-2 py-1 w-32 bg-outlook-bg-primary focus:outline-none" />
                  <input type="text" placeholder="exemple" value={newVar.example} onChange={e => setNewVar(v => ({ ...v, example: e.target.value }))}
                    className="text-xs border border-outlook-border rounded px-2 py-1 w-32 bg-outlook-bg-primary focus:outline-none" />
                  <button onClick={addVariable} className="text-xs px-2 py-1 bg-outlook-blue text-white rounded">Ajouter</button>
                  <button onClick={() => setShowVarForm(false)} className="text-xs text-outlook-text-secondary">Annuler</button>
                </div>
              )}
              {form.variables.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {form.variables.map(v => (
                    <span key={v.key} className="inline-flex items-center gap-1 text-[10px] bg-outlook-bg-primary border border-outlook-border rounded px-1.5 py-0.5">
                      {v.key}
                      <button onClick={() => removeVar(v.key)} className="text-outlook-text-disabled hover:text-red-500"><X size={9} /></button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Editor tabs */}
            <div className="flex border-b border-outlook-border flex-shrink-0">
              {(['html', 'text', 'preview'] as const).map(t => (
                <button key={t} onClick={() => setActiveTab(t)}
                  className={`px-4 py-2 text-xs font-medium transition-colors ${activeTab === t ? 'border-b-2 border-outlook-blue text-outlook-blue' : 'text-outlook-text-secondary hover:text-outlook-text-primary'}`}>
                  {t === 'html' ? 'HTML' : t === 'text' ? 'Texte brut' : 'Aperçu'}
                </button>
              ))}
            </div>

            {/* Editor content */}
            <div className="flex-1 min-h-0 p-0">
              {activeTab === 'html' && (
                <textarea value={form.bodyHtml} onChange={e => setForm(f => ({ ...f, bodyHtml: e.target.value }))}
                  className="w-full h-full p-4 text-xs font-mono resize-none focus:outline-none bg-outlook-bg-primary text-outlook-text-primary border-0"
                  placeholder="<p>Corps HTML de l'email...</p>" spellCheck={false} />
              )}
              {activeTab === 'text' && (
                <textarea value={form.bodyText} onChange={e => setForm(f => ({ ...f, bodyText: e.target.value }))}
                  className="w-full h-full p-4 text-xs font-mono resize-none focus:outline-none bg-outlook-bg-primary text-outlook-text-primary border-0"
                  placeholder="Corps texte brut de l'email..." spellCheck={false} />
              )}
              {activeTab === 'preview' && (
                <div className="h-full">
                  <LivePreview html={form.bodyHtml} vars={previewVars} />
                </div>
              )}
            </div>
          </div>

          {/* Right: variable values for preview + test */}
          <div className="w-72 flex flex-col flex-shrink-0 overflow-y-auto">
            <div className="px-4 py-3 border-b border-outlook-border">
              <h4 className="text-xs font-semibold text-outlook-text-secondary uppercase tracking-wide">Valeurs de prévisualisation</h4>
            </div>
            <div className="flex-1 px-4 py-3 space-y-2">
              {form.variables.length === 0 ? (
                <p className="text-xs text-outlook-text-disabled">Ajoutez des variables pour les tester ici.</p>
              ) : (
                form.variables.map(v => (
                  <div key={v.key}>
                    <label className="text-[10px] text-outlook-text-disabled mb-0.5 block font-mono">{`{{${v.key}}}`} — {v.label}</label>
                    <input type="text" placeholder={v.example}
                      value={testVars[v.key] ?? ''}
                      onChange={e => setTestVars(prev => ({ ...prev, [v.key]: e.target.value }))}
                      className="w-full text-xs border border-outlook-border rounded px-2 py-1.5 bg-outlook-bg-primary focus:outline-none focus:ring-1 focus:ring-outlook-blue" />
                  </div>
                ))
              )}
            </div>

            {/* Test send */}
            {!isNew && (
              <div className="px-4 py-3 border-t border-outlook-border space-y-2">
                <h4 className="text-xs font-semibold text-outlook-text-secondary uppercase tracking-wide">Envoyer un test</h4>
                <input type="email" value={testTo} onChange={e => setTestTo(e.target.value)} placeholder="email@exemple.com"
                  className="w-full text-xs border border-outlook-border rounded px-2 py-1.5 bg-outlook-bg-primary focus:outline-none focus:ring-1 focus:ring-outlook-blue" />
                <button onClick={() => testMutation.mutate()} disabled={!testTo || testMutation.isPending}
                  className="w-full flex items-center justify-center gap-1 text-xs bg-outlook-blue text-white px-3 py-1.5 rounded hover:bg-blue-700 disabled:opacity-50">
                  <Send size={12} /> {testMutation.isPending ? 'Envoi...' : 'Envoyer le test'}
                </button>
                <p className="text-[10px] text-outlook-text-disabled">Les valeurs de prévisualisation ci-dessus seront utilisées.</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-outlook-border flex-shrink-0">
          <button onClick={onClose} className="px-3 py-1.5 text-sm border border-outlook-border rounded hover:bg-outlook-bg-hover">Annuler</button>
          <button onClick={() => saveMutation.mutate(form)} disabled={saveMutation.isPending || !form.name || !form.subject}
            className="px-4 py-1.5 text-sm bg-outlook-blue text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1">
            <Save size={13} /> {saveMutation.isPending ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function AdminSmtpSettings() {
  const queryClient = useQueryClient();
  const [smtpTab, setSmtpTab] = useState<'smtp' | 'templates'>('smtp');
  const [showPassword, setShowPassword] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [editingTemplate, setEditingTemplate] = useState<Partial<SystemTemplate> | null | false>(false);
  const [smtpForm, setSmtpForm] = useState<SmtpConfig & { password?: string }>({
    host: '', port: 587, secure: 'starttls', username: '', hasPassword: false, fromName: '', fromEmail: '',
  });

  const { data: smtpData, isLoading: smtpLoading } = useQuery({
    queryKey: ['admin-smtp'],
    queryFn: api.getSmtpConfig,
  });

  useEffect(() => {
    if (smtpData) setSmtpForm(prev => ({ ...prev, ...smtpData }));
  }, [smtpData]);

  const { data: templates = [], isLoading: tplLoading } = useQuery({
    queryKey: ['system-templates'],
    queryFn: api.getSystemTemplates,
  });

  const saveMutation = useMutation({
    mutationFn: (data: any) => api.updateSmtpConfig(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin-smtp'] }); toast.success('Configuration SMTP enregistrée'); },
    onError: (e: any) => toast.error(e.message),
  });

  const testMutation = useMutation({
    mutationFn: (data: any) => api.testSmtpConfig(data),
    onSuccess: (r: any) => toast.success(r.message),
    onError: (e: any) => toast.error(e.message),
  });

  const toggleTplMutation = useMutation({
    mutationFn: ({ id, enabled, ...rest }: any) => api.updateSystemTemplate(id, { ...rest, enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['system-templates'] }),
    onError: (e: any) => toast.error(e.message),
  });

  const deleteTplMutation = useMutation({
    mutationFn: api.deleteSystemTemplate,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['system-templates'] }); toast.success('Template supprimé'); },
    onError: (e: any) => toast.error(e.message),
  });

  function handleSaveSmtp() {
    const data: any = { ...smtpForm };
    if (!smtpForm.password) delete data.password;
    saveMutation.mutate(data);
  }

  function handleTest() {
    testMutation.mutate({ ...smtpForm, testTo: testEmail || undefined });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold">SMTP & Emails système</h3>
        <div className="flex gap-1">
          <button onClick={() => setSmtpTab('smtp')}
            className={`px-3 py-1.5 text-xs rounded ${smtpTab === 'smtp' ? 'bg-outlook-blue text-white' : 'border border-outlook-border hover:bg-outlook-bg-hover'}`}>
            Configuration SMTP
          </button>
          <button onClick={() => setSmtpTab('templates')}
            className={`px-3 py-1.5 text-xs rounded ${smtpTab === 'templates' ? 'bg-outlook-blue text-white' : 'border border-outlook-border hover:bg-outlook-bg-hover'}`}>
            Templates ({(templates as SystemTemplate[]).length})
          </button>
        </div>
      </div>

      {smtpTab === 'smtp' && (
        <div className="space-y-6">
          {smtpLoading ? (
            <div className="text-sm text-outlook-text-secondary">Chargement...</div>
          ) : (
            <>
              {/* Connection settings */}
              <div className="border border-outlook-border rounded-lg p-5 space-y-4">
                <h4 className="text-sm font-medium flex items-center gap-2">
                  <Mail size={15} className="text-outlook-blue" /> Serveur SMTP
                </h4>
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2 sm:col-span-1">
                    <label className="text-xs text-outlook-text-secondary mb-1 block">Hôte SMTP</label>
                    <input type="text" value={smtpForm.host} onChange={e => setSmtpForm(f => ({ ...f, host: e.target.value }))}
                      placeholder="smtp.gmail.com"
                      className="w-full text-sm border border-outlook-border rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-outlook-blue bg-outlook-bg-primary" />
                  </div>
                  <div>
                    <label className="text-xs text-outlook-text-secondary mb-1 block">Port</label>
                    <input type="number" value={smtpForm.port} onChange={e => setSmtpForm(f => ({ ...f, port: Number(e.target.value) }))}
                      className="w-full text-sm border border-outlook-border rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-outlook-blue bg-outlook-bg-primary" />
                  </div>
                  <div>
                    <label className="text-xs text-outlook-text-secondary mb-1 block">Chiffrement</label>
                    <select value={smtpForm.secure} onChange={e => setSmtpForm(f => ({ ...f, secure: e.target.value as any }))}
                      className="w-full text-sm border border-outlook-border rounded px-3 py-2 bg-outlook-bg-primary">
                      <option value="starttls">STARTTLS (port 587)</option>
                      <option value="ssl">SSL/TLS (port 465)</option>
                      <option value="none">Aucun (non recommandé)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-outlook-text-secondary mb-1 block">Identifiant</label>
                    <input type="text" value={smtpForm.username} onChange={e => setSmtpForm(f => ({ ...f, username: e.target.value }))}
                      placeholder="user@example.com"
                      className="w-full text-sm border border-outlook-border rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-outlook-blue bg-outlook-bg-primary" />
                  </div>
                  <div>
                    <label className="text-xs text-outlook-text-secondary mb-1 block">
                      Mot de passe {smtpForm.hasPassword && <span className="text-green-600">(déjà enregistré)</span>}
                    </label>
                    <div className="relative">
                      <input type={showPassword ? 'text' : 'password'} value={smtpForm.password ?? ''} onChange={e => setSmtpForm(f => ({ ...f, password: e.target.value }))}
                        placeholder={smtpForm.hasPassword ? '••••••••' : 'Mot de passe SMTP'}
                        className="w-full text-sm border border-outlook-border rounded px-3 py-2 pr-9 focus:outline-none focus:ring-1 focus:ring-outlook-blue bg-outlook-bg-primary" />
                      <button type="button" onClick={() => setShowPassword(v => !v)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-outlook-text-disabled hover:text-outlook-text-primary">
                        {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Sender identity */}
              <div className="border border-outlook-border rounded-lg p-5 space-y-4">
                <h4 className="text-sm font-medium">Identité expéditeur</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-outlook-text-secondary mb-1 block">Nom affiché</label>
                    <input type="text" value={smtpForm.fromName} onChange={e => setSmtpForm(f => ({ ...f, fromName: e.target.value }))}
                      placeholder="Mon Application"
                      className="w-full text-sm border border-outlook-border rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-outlook-blue bg-outlook-bg-primary" />
                  </div>
                  <div>
                    <label className="text-xs text-outlook-text-secondary mb-1 block">Email expéditeur</label>
                    <input type="email" value={smtpForm.fromEmail} onChange={e => setSmtpForm(f => ({ ...f, fromEmail: e.target.value }))}
                      placeholder="noreply@example.com"
                      className="w-full text-sm border border-outlook-border rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-outlook-blue bg-outlook-bg-primary" />
                  </div>
                </div>
              </div>

              {/* Test + save */}
              <div className="border border-outlook-border rounded-lg p-5 space-y-3">
                <h4 className="text-sm font-medium flex items-center gap-2"><TestTube size={15} className="text-outlook-blue" /> Tester la connexion</h4>
                <div className="flex gap-2">
                  <input type="email" value={testEmail} onChange={e => setTestEmail(e.target.value)} placeholder="Envoyer un email de test à... (optionnel)"
                    className="flex-1 text-sm border border-outlook-border rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-outlook-blue bg-outlook-bg-primary" />
                  <button onClick={handleTest} disabled={testMutation.isPending || !smtpForm.host}
                    className="flex items-center gap-1 px-4 py-2 text-sm border border-outlook-border rounded hover:bg-outlook-bg-hover disabled:opacity-50">
                    {testMutation.isPending ? <RefreshCw size={13} className="animate-spin" /> : <TestTube size={13} />}
                    {testMutation.isPending ? 'Test...' : 'Tester'}
                  </button>
                </div>
                {testMutation.isSuccess && (
                  <div className="flex items-center gap-2 text-sm text-green-600">
                    <CheckCircle size={14} /> Connexion réussie
                  </div>
                )}
                {testMutation.isError && (
                  <div className="flex items-center gap-2 text-sm text-red-600">
                    <XCircle size={14} /> Échec de la connexion
                  </div>
                )}
              </div>

              <div className="flex justify-end">
                <button onClick={handleSaveSmtp} disabled={saveMutation.isPending}
                  className="flex items-center gap-1 px-5 py-2 text-sm bg-outlook-blue text-white rounded hover:bg-blue-700 disabled:opacity-50">
                  <Save size={13} /> {saveMutation.isPending ? 'Enregistrement...' : 'Enregistrer la configuration'}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {smtpTab === 'templates' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-outlook-text-secondary">Gérez les emails envoyés automatiquement par l'application.</p>
            <button onClick={() => setEditingTemplate({})}
              className="flex items-center gap-1 text-sm bg-outlook-blue text-white px-3 py-1.5 rounded hover:bg-blue-700">
              <Plus size={14} /> Nouveau template
            </button>
          </div>

          {tplLoading ? (
            <div className="text-sm text-outlook-text-secondary">Chargement...</div>
          ) : (
            <div className="space-y-2">
              {(templates as SystemTemplate[]).map(tpl => (
                <div key={tpl.id} className="border border-outlook-border rounded-lg p-4 flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`w-2 h-2 rounded-full ${tpl.enabled ? 'bg-green-500' : 'bg-gray-400'}`} />
                      <span className="font-medium text-sm">{tpl.name}</span>
                      <span className="text-xs text-outlook-text-disabled font-mono">/{tpl.slug}</span>
                    </div>
                    {tpl.description && <div className="text-xs text-outlook-text-secondary mb-1">{tpl.description}</div>}
                    <div className="text-xs text-outlook-text-disabled">Sujet : {tpl.subject}</div>
                    {tpl.variables?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {tpl.variables.map(v => (
                          <span key={v.key} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-100">
                            {'{{' + v.key + '}}'}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => toggleTplMutation.mutate({ ...tpl, enabled: !tpl.enabled })}
                      title={tpl.enabled ? 'Désactiver' : 'Activer'}
                      className={`p-1.5 rounded border ${tpl.enabled ? 'text-green-600 border-green-200 hover:bg-green-50' : 'text-gray-400 border-outlook-border hover:bg-outlook-bg-hover'}`}>
                      {tpl.enabled ? <ToggleRight size={15} /> : <ToggleLeft size={15} />}
                    </button>
                    <button onClick={() => setEditingTemplate(tpl)}
                      className="p-1.5 text-outlook-text-secondary hover:text-outlook-text-primary border border-outlook-border rounded">
                      <Edit2 size={13} />
                    </button>
                    <button onClick={() => { if (confirm('Supprimer ce template ?')) deleteTplMutation.mutate(tpl.id); }}
                      className="p-1.5 text-outlook-text-secondary hover:text-red-600 border border-outlook-border rounded">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
              {(templates as SystemTemplate[]).length === 0 && (
                <div className="py-12 text-center text-sm text-outlook-text-disabled">
                  <Mail size={32} className="mx-auto mb-2 opacity-30" />
                  Aucun template configuré
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {editingTemplate !== false && (
        <TemplateEditorModal
          template={editingTemplate}
          onClose={() => setEditingTemplate(false)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['system-templates'] })}
        />
      )}
    </div>
  );
}
