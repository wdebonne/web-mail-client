// ─────────────────────────────────────────────────────────────────────────────
// imageEditing.ts
//
// Adds interactive editing to <img> elements inside a contenteditable editor:
//   • click on an image to select it (visual outline + corner handles),
//   • drag the bottom-right handle to resize (aspect-ratio preserved),
//   • floating toolbar above the image to align (left / center / right),
//     apply size presets (25% / 50% / 75% / 100%), reset to original size,
//     or delete the image.
//
// Usage (inside a component):
//
//   useEffect(() => {
//     if (!editorRef.current) return;
//     return attachImageEditing(editorRef.current);
//   }, []);
//
// The utility self-contains its DOM (overlay + toolbar are appended to
// document.body) and cleans them up when the returned disposer runs.
// ─────────────────────────────────────────────────────────────────────────────

export interface ImageEditingOptions {
  /** Max width (in px) applied when the image exceeds the editor width. */
  maxWidth?: number;
}

const STYLE_ID = 'mail-image-editing-styles';

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .mail-img-selected {
      outline: 2px solid #2563eb !important;
      outline-offset: 2px;
    }
    .mail-img-toolbar {
      position: absolute;
      z-index: 10000;
      background: #ffffff;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.12);
      padding: 4px;
      display: flex;
      align-items: center;
      gap: 2px;
      font-size: 12px;
      color: #1f2937;
      user-select: none;
    }
    .mail-img-toolbar button {
      background: transparent;
      border: none;
      border-radius: 4px;
      padding: 4px 6px;
      cursor: pointer;
      color: inherit;
      line-height: 1;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 24px;
      height: 24px;
    }
    .mail-img-toolbar button:hover { background: #f3f4f6; }
    .mail-img-toolbar button.active { background: #e0e7ff; color: #1d4ed8; }
    .mail-img-toolbar .sep {
      width: 1px; height: 16px; background: #e5e7eb; margin: 0 2px;
    }
    .mail-img-handle {
      position: absolute;
      width: 10px; height: 10px;
      background: #2563eb;
      border: 2px solid #ffffff;
      border-radius: 50%;
      box-shadow: 0 0 0 1px #2563eb;
      z-index: 10000;
    }
    .mail-img-handle.br { cursor: nwse-resize; }
  `;
  document.head.appendChild(style);
}

function getAlign(img: HTMLImageElement): 'left' | 'center' | 'right' | 'none' {
  const display = img.style.display;
  const ml = img.style.marginLeft;
  const mr = img.style.marginRight;
  const float = img.style.cssFloat || (img.style as any).float;
  if (float === 'left') return 'left';
  if (float === 'right') return 'right';
  if (display === 'block' && ml === 'auto' && mr === 'auto') return 'center';
  return 'none';
}

function setAlign(img: HTMLImageElement, align: 'left' | 'center' | 'right') {
  img.style.cssFloat = '';
  (img.style as any).float = '';
  img.style.display = '';
  img.style.marginLeft = '';
  img.style.marginRight = '';
  if (align === 'left') {
    img.style.cssFloat = 'left';
    img.style.marginRight = '12px';
    img.style.marginBottom = '4px';
  } else if (align === 'right') {
    img.style.cssFloat = 'right';
    img.style.marginLeft = '12px';
    img.style.marginBottom = '4px';
  } else {
    img.style.display = 'block';
    img.style.marginLeft = 'auto';
    img.style.marginRight = 'auto';
  }
}

function applyWidthPercent(img: HTMLImageElement, percent: number, editor: HTMLElement) {
  const editorWidth = editor.clientWidth || img.naturalWidth || 600;
  const natural = img.naturalWidth || editorWidth;
  const target = Math.max(16, Math.min(editorWidth, Math.round((natural * percent) / 100)));
  img.style.width = `${target}px`;
  img.style.height = 'auto';
  img.removeAttribute('width');
  img.removeAttribute('height');
}

function resetSize(img: HTMLImageElement, editor: HTMLElement) {
  img.style.width = '';
  img.style.height = '';
  img.removeAttribute('width');
  img.removeAttribute('height');
  // Cap to editor width if needed.
  const editorWidth = editor.clientWidth;
  if (editorWidth && img.naturalWidth > editorWidth) {
    img.style.width = `${editorWidth}px`;
    img.style.height = 'auto';
  }
}

function notifyInput(editor: HTMLElement) {
  editor.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Attaches interactive resize/align controls on images inside `editor`.
 * Returns a cleanup function that removes all listeners and DOM overlays.
 */
export function attachImageEditing(editor: HTMLElement, _opts: ImageEditingOptions = {}): () => void {
  ensureStyles();

  let selected: HTMLImageElement | null = null;
  const toolbar = document.createElement('div');
  toolbar.className = 'mail-img-toolbar';
  toolbar.style.display = 'none';
  // Prevent the editor from losing focus (which would hide the toolbar) when
  // users click on it.
  toolbar.addEventListener('mousedown', (e) => e.preventDefault());
  document.body.appendChild(toolbar);

  const handleBR = document.createElement('div');
  handleBR.className = 'mail-img-handle br';
  handleBR.style.display = 'none';
  handleBR.addEventListener('mousedown', (e) => e.preventDefault());
  document.body.appendChild(handleBR);

  const btn = (label: string, title: string, onClick: () => void, makeActive?: () => boolean) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.title = title;
    b.innerHTML = label;
    b.addEventListener('mousedown', (e) => { e.preventDefault(); });
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
      if (selected) reposition();
    });
    (b as any).__active = makeActive;
    return b;
  };

  const sep = () => {
    const d = document.createElement('div');
    d.className = 'sep';
    return d;
  };

  // Align group.
  const btnLeft   = btn('⬅', 'Aligner à gauche',  () => { if (selected) { setAlign(selected, 'left');   notifyInput(editor); } }, () => !!selected && getAlign(selected) === 'left');
  const btnCenter = btn('⬌', 'Centrer',            () => { if (selected) { setAlign(selected, 'center'); notifyInput(editor); } }, () => !!selected && getAlign(selected) === 'center');
  const btnRight  = btn('➡', 'Aligner à droite',  () => { if (selected) { setAlign(selected, 'right');  notifyInput(editor); } }, () => !!selected && getAlign(selected) === 'right');

  // Size presets.
  const mkSize = (p: number) => btn(`${p}%`, `Largeur ${p}%`, () => {
    if (selected) { applyWidthPercent(selected, p, editor); notifyInput(editor); }
  });

  const btnOriginal = btn('↺', "Taille d'origine", () => {
    if (selected) { resetSize(selected, editor); notifyInput(editor); }
  });

  const btnDelete = btn('🗑', 'Supprimer', () => {
    if (!selected) return;
    selected.remove();
    selected = null;
    hide();
    notifyInput(editor);
  });

  toolbar.appendChild(btnLeft);
  toolbar.appendChild(btnCenter);
  toolbar.appendChild(btnRight);
  toolbar.appendChild(sep());
  toolbar.appendChild(mkSize(25));
  toolbar.appendChild(mkSize(50));
  toolbar.appendChild(mkSize(75));
  toolbar.appendChild(mkSize(100));
  toolbar.appendChild(btnOriginal);
  toolbar.appendChild(sep());
  toolbar.appendChild(btnDelete);

  const updateActiveStates = () => {
    Array.from(toolbar.querySelectorAll('button')).forEach((b) => {
      const fn = (b as any).__active as (() => boolean) | undefined;
      if (fn) b.classList.toggle('active', !!fn());
    });
  };

  const reposition = () => {
    if (!selected) return;
    const r = selected.getBoundingClientRect();
    // Toolbar: centered above the image, clamped inside the viewport.
    const tbWidth = toolbar.offsetWidth || 280;
    const tbHeight = toolbar.offsetHeight || 32;
    let top = r.top + window.scrollY - tbHeight - 8;
    if (top < window.scrollY + 4) top = r.bottom + window.scrollY + 8;
    let left = r.left + window.scrollX + r.width / 2 - tbWidth / 2;
    left = Math.max(window.scrollX + 4, Math.min(left, window.scrollX + document.documentElement.clientWidth - tbWidth - 4));
    toolbar.style.top = `${top}px`;
    toolbar.style.left = `${left}px`;

    handleBR.style.top = `${r.bottom + window.scrollY - 6}px`;
    handleBR.style.left = `${r.right + window.scrollX - 6}px`;

    updateActiveStates();
  };

  const show = (img: HTMLImageElement) => {
    if (selected && selected !== img) selected.classList.remove('mail-img-selected');
    selected = img;
    img.classList.add('mail-img-selected');
    toolbar.style.display = 'flex';
    handleBR.style.display = 'block';
    reposition();
  };

  const hide = () => {
    if (selected) selected.classList.remove('mail-img-selected');
    selected = null;
    toolbar.style.display = 'none';
    handleBR.style.display = 'none';
  };

  // ── Event handlers ──────────────────────────────────────────────────────
  const onEditorClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    if (target && target.tagName === 'IMG' && editor.contains(target)) {
      e.preventDefault();
      show(target as HTMLImageElement);
    } else {
      hide();
    }
  };

  const onDocMouseDown = (e: MouseEvent) => {
    const t = e.target as Node;
    if (toolbar.contains(t) || handleBR.contains(t)) return;
    if (t instanceof HTMLImageElement && editor.contains(t)) return;
    hide();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!selected) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      // Only hijack when the selection is on/around the selected image.
      const sel = window.getSelection();
      if (sel && sel.isCollapsed && selected.parentNode) {
        e.preventDefault();
        selected.remove();
        selected = null;
        hide();
        notifyInput(editor);
      }
    } else if (e.key === 'Escape') {
      hide();
    }
  };

  const onScrollOrResize = () => {
    if (selected) reposition();
  };

  // ── Corner resize (drag) ─────────────────────────────────────────────────
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let startW = 0;
  let startH = 0;
  let ratio = 1;

  const onHandleDown = (e: MouseEvent) => {
    if (!selected) return;
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    const r = selected.getBoundingClientRect();
    startX = e.clientX;
    startY = e.clientY;
    startW = r.width;
    startH = r.height;
    ratio = startH > 0 ? startW / startH : 1;
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragUp);
  };

  const onDragMove = (e: MouseEvent) => {
    if (!dragging || !selected) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    // Use the larger delta to drive the resize (keeps aspect ratio).
    const delta = Math.abs(dx) >= Math.abs(dy) ? dx : dy * ratio;
    let newW = Math.max(24, startW + delta);
    const maxW = editor.clientWidth || newW;
    if (newW > maxW) newW = maxW;
    selected.style.width = `${Math.round(newW)}px`;
    selected.style.height = 'auto';
    selected.removeAttribute('width');
    selected.removeAttribute('height');
    reposition();
  };

  const onDragUp = () => {
    if (!dragging) return;
    dragging = false;
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragUp);
    notifyInput(editor);
  };

  handleBR.addEventListener('mousedown', onHandleDown);

  editor.addEventListener('click', onEditorClick);
  document.addEventListener('mousedown', onDocMouseDown, true);
  editor.addEventListener('keydown', onKeyDown);
  window.addEventListener('scroll', onScrollOrResize, true);
  window.addEventListener('resize', onScrollOrResize);

  // Make native drag behaviour predictable.
  editor.querySelectorAll('img').forEach((img) => {
    (img as HTMLImageElement).draggable = false;
  });
  const mo = new MutationObserver(() => {
    editor.querySelectorAll('img').forEach((img) => {
      (img as HTMLImageElement).draggable = false;
    });
    if (selected && !editor.contains(selected)) hide();
    else if (selected) reposition();
  });
  mo.observe(editor, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'width', 'height', 'src'] });

  return () => {
    mo.disconnect();
    editor.removeEventListener('click', onEditorClick);
    document.removeEventListener('mousedown', onDocMouseDown, true);
    editor.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('scroll', onScrollOrResize, true);
    window.removeEventListener('resize', onScrollOrResize);
    handleBR.removeEventListener('mousedown', onHandleDown);
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragUp);
    toolbar.remove();
    handleBR.remove();
    if (selected) selected.classList.remove('mail-img-selected');
    selected = null;
  };
}
