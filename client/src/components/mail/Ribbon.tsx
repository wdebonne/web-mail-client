import { useState, useRef, useEffect } from 'react';
import {
  Mail, Reply, ReplyAll, Forward, Trash2, Archive, Flag,
  FolderInput, MailPlus, RefreshCw, ChevronDown, Printer,
  Download, Eye, EyeOff, PanelLeftOpen, PanelLeftClose,
  Columns2, Rows2, LayoutGrid, Settings, Info, FileDown,
  MoreHorizontal,
} from 'lucide-react';

type RibbonTab = 'accueil' | 'afficher';
type RibbonMode = 'classic' | 'simplified';

interface RibbonProps {
  // Accueil actions
  onNewMessage: () => void;
  onReply: () => void;
  onReplyAll: () => void;
  onForward: () => void;
  onDelete: () => void;
  onArchive: () => void;
  onToggleFlag: () => void;
  onMarkRead: () => void;
  onMarkUnread: () => void;
  onSync: () => void;
  hasSelectedMessage: boolean;
  isFlagged: boolean;
  isRead: boolean;

  // Afficher actions
  showFolderPane: boolean;
  onToggleFolderPane: () => void;
  onPrint: () => void;
  onDownloadEml: () => void;

  // Ribbon visibility
  isCollapsed: boolean;
  onToggleCollapse: () => void;

  // Ribbon mode
  ribbonMode: RibbonMode;
  onChangeRibbonMode: (mode: RibbonMode) => void;
}

function RibbonButton({ icon: Icon, label, onClick, disabled, active, danger, small }: {
  icon: any; label: string; onClick: () => void;
  disabled?: boolean; active?: boolean; danger?: boolean; small?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex flex-col items-center gap-0.5 rounded transition-colors px-2 py-1 min-w-[48px]
        ${small ? 'px-1.5 py-0.5 min-w-[40px]' : ''}
        ${disabled ? 'opacity-40 cursor-default' : 'hover:bg-outlook-bg-hover cursor-pointer'}
        ${active ? 'bg-outlook-blue/10 text-outlook-blue' : ''}
        ${danger && !disabled ? 'hover:bg-red-50 hover:text-outlook-danger' : ''}`}
      title={label}
    >
      <Icon size={small ? 16 : 18} />
      <span className={`${small ? 'text-[9px]' : 'text-[10px]'} leading-tight text-center whitespace-nowrap`}>{label}</span>
    </button>
  );
}

function RibbonSeparator() {
  return <div className="w-px h-10 bg-outlook-border mx-1 self-center" />;
}

function SimplifiedButton({ icon: Icon, label, onClick, disabled, active, danger }: {
  icon: any; label: string; onClick: () => void;
  disabled?: boolean; active?: boolean; danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1 rounded transition-colors px-2 py-1
        ${disabled ? 'opacity-40 cursor-default' : 'hover:bg-outlook-bg-hover cursor-pointer'}
        ${active ? 'bg-outlook-blue/10 text-outlook-blue' : ''}
        ${danger && !disabled ? 'hover:bg-red-50 hover:text-outlook-danger' : ''}`}
      title={label}
    >
      <Icon size={14} />
      <span className="text-xs whitespace-nowrap">{label}</span>
    </button>
  );
}

function SimplifiedSep() {
  return <div className="w-px h-5 bg-outlook-border mx-0.5 self-center" />;
}

function RibbonGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center">
      <div className="flex items-end gap-0.5 px-1 flex-1">
        {children}
      </div>
      <span className="text-[9px] text-outlook-text-disabled mt-0.5 leading-none">{label}</span>
    </div>
  );
}

export default function Ribbon({
  onNewMessage, onReply, onReplyAll, onForward, onDelete, onArchive,
  onToggleFlag, onMarkRead, onMarkUnread, onSync,
  hasSelectedMessage, isFlagged, isRead,
  showFolderPane, onToggleFolderPane, onPrint, onDownloadEml,
  isCollapsed, onToggleCollapse,
  ribbonMode, onChangeRibbonMode,
}: RibbonProps) {
  const [activeTab, setActiveTab] = useState<RibbonTab>('accueil');
  const ribbonRef = useRef<HTMLDivElement>(null);

  // Auto-switch between classic and simplified based on width
  useEffect(() => {
    const el = ribbonRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        if (width < 700 && ribbonMode === 'classic') {
          onChangeRibbonMode('simplified');
        } else if (width >= 700 && ribbonMode === 'simplified') {
          onChangeRibbonMode('classic');
        }
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ribbonMode, onChangeRibbonMode]);

  // ─── Simplified ribbon ─────────────────────────────────────
  if (ribbonMode === 'simplified') {
    return (
      <div ref={ribbonRef} className="hidden md:flex items-center flex-shrink-0 bg-white select-none px-2 py-1 gap-0.5 overflow-x-auto">
        {/* Nouveau message */}
        <SimplifiedButton icon={MailPlus} label="Nouveau" onClick={onNewMessage} />
        <SimplifiedSep />

        {/* Répondre group */}
        <SimplifiedButton icon={Reply} label="Répondre" onClick={onReply} disabled={!hasSelectedMessage} />
        <SimplifiedButton icon={ReplyAll} label="Répondre à tous" onClick={onReplyAll} disabled={!hasSelectedMessage} />
        <SimplifiedButton icon={Forward} label="Transférer" onClick={onForward} disabled={!hasSelectedMessage} />
        <SimplifiedSep />

        {/* Actions */}
        <SimplifiedButton icon={Trash2} label="Supprimer" onClick={onDelete} disabled={!hasSelectedMessage} danger />
        <SimplifiedButton icon={Archive} label="Archiver" onClick={onArchive} disabled={!hasSelectedMessage} />
        <SimplifiedButton
          icon={Flag}
          label="Indicateur"
          onClick={onToggleFlag}
          disabled={!hasSelectedMessage}
          active={isFlagged}
        />
        <SimplifiedSep />

        {/* Marquer lu/non lu */}
        <SimplifiedButton
          icon={isRead ? EyeOff : Eye}
          label={isRead ? 'Non lu' : 'Lu'}
          onClick={isRead ? onMarkUnread : onMarkRead}
          disabled={!hasSelectedMessage}
        />
        <SimplifiedSep />

        {/* Synchroniser */}
        <SimplifiedButton icon={RefreshCw} label="Synchroniser" onClick={onSync} />
        <SimplifiedSep />

        {/* Volet dossiers */}
        <SimplifiedButton
          icon={showFolderPane ? PanelLeftClose : PanelLeftOpen}
          label="Volet Dossiers"
          onClick={onToggleFolderPane}
          active={showFolderPane}
        />
        <SimplifiedSep />

        {/* Imprimer / Télécharger */}
        <SimplifiedButton icon={Printer} label="Imprimer" onClick={onPrint} disabled={!hasSelectedMessage} />
        <SimplifiedButton icon={FileDown} label="Télécharger" onClick={onDownloadEml} disabled={!hasSelectedMessage} />
      </div>
    );
  }

  // ─── Classic ribbon ─────────────────────────────────────────

  return (
    <div ref={ribbonRef} className="hidden md:flex flex-col flex-shrink-0 bg-white select-none">
      {/* Tab bar */}
      <div className="flex items-center gap-0 px-2 border-b border-outlook-border">
        {(['accueil', 'afficher'] as RibbonTab[]).map(tab => (
          <button
            key={tab}
            onClick={() => {
              setActiveTab(tab);
              if (isCollapsed) onToggleCollapse();
            }}
            className={`px-3 py-1.5 text-xs font-medium capitalize transition-colors relative
              ${activeTab === tab
                ? 'text-outlook-blue'
                : 'text-outlook-text-secondary hover:text-outlook-text-primary hover:bg-outlook-bg-hover'
              }`}
          >
            {tab === 'accueil' ? 'Accueil' : 'Afficher'}
            {activeTab === tab && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-outlook-blue rounded-t" />
            )}
          </button>
        ))}
        <div className="flex-1" />
        <button
          onClick={onToggleCollapse}
          className="text-outlook-text-disabled hover:text-outlook-text-secondary p-1 rounded hover:bg-outlook-bg-hover"
          title={isCollapsed ? 'Développer le ruban' : 'Réduire le ruban'}
        >
          <ChevronDown size={12} className={`transition-transform ${isCollapsed ? '' : 'rotate-180'}`} />
        </button>
      </div>

      {/* Ribbon content */}
      {!isCollapsed && (
        <div className="flex items-stretch px-2 py-1 gap-1 overflow-x-auto">
          {activeTab === 'accueil' && (
            <>
              {/* Nouveau */}
              <RibbonGroup label="Nouveau">
                <RibbonButton icon={MailPlus} label="Nouveau message" onClick={onNewMessage} />
              </RibbonGroup>
              <RibbonSeparator />

              {/* Répondre */}
              <RibbonGroup label="Répondre">
                <RibbonButton icon={Reply} label="Répondre" onClick={onReply} disabled={!hasSelectedMessage} />
                <RibbonButton icon={ReplyAll} label="Répondre à tous" onClick={onReplyAll} disabled={!hasSelectedMessage} />
                <RibbonButton icon={Forward} label="Transférer" onClick={onForward} disabled={!hasSelectedMessage} />
              </RibbonGroup>
              <RibbonSeparator />

              {/* Actions */}
              <RibbonGroup label="Actions">
                <RibbonButton icon={Trash2} label="Supprimer" onClick={onDelete} disabled={!hasSelectedMessage} danger />
                <RibbonButton icon={Archive} label="Archiver" onClick={onArchive} disabled={!hasSelectedMessage} />
                <RibbonButton
                  icon={Flag}
                  label={isFlagged ? 'Désindiquer' : 'Indicateur'}
                  onClick={onToggleFlag}
                  disabled={!hasSelectedMessage}
                  active={isFlagged}
                />
              </RibbonGroup>
              <RibbonSeparator />

              {/* Marquer */}
              <RibbonGroup label="Marquer">
                <RibbonButton
                  icon={isRead ? EyeOff : Eye}
                  label={isRead ? 'Non lu' : 'Lu'}
                  onClick={isRead ? onMarkUnread : onMarkRead}
                  disabled={!hasSelectedMessage}
                />
              </RibbonGroup>
              <RibbonSeparator />

              {/* Synchroniser */}
              <RibbonGroup label="Messages">
                <RibbonButton icon={RefreshCw} label="Synchroniser" onClick={onSync} />
              </RibbonGroup>
            </>
          )}

          {activeTab === 'afficher' && (
            <>
              {/* Disposition */}
              <RibbonGroup label="Disposition">
                <RibbonButton
                  icon={showFolderPane ? PanelLeftClose : PanelLeftOpen}
                  label="Volet Dossiers"
                  onClick={onToggleFolderPane}
                  active={showFolderPane}
                />
              </RibbonGroup>
              <RibbonSeparator />

              {/* Actions sur le message */}
              <RibbonGroup label="Actions">
                <RibbonButton icon={Printer} label="Imprimer" onClick={onPrint} disabled={!hasSelectedMessage} />
                <RibbonButton icon={FileDown} label="Télécharger" onClick={onDownloadEml} disabled={!hasSelectedMessage} />
              </RibbonGroup>
              <RibbonSeparator />

              {/* Synchroniser */}
              <RibbonGroup label="Messages">
                <RibbonButton icon={RefreshCw} label="Synchroniser" onClick={onSync} />
              </RibbonGroup>
            </>
          )}
        </div>
      )}
    </div>
  );
}
