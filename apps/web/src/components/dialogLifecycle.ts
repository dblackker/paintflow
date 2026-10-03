interface DialogSession {
  layer: HTMLElement;
  panel: HTMLElement;
  initialFocus?: HTMLElement | null;
  onEscape: () => void;
}

interface InertSnapshot {
  inert: boolean;
  ariaHidden: string | null;
}

const dialogs: Array<DialogSession & { previousFocus: HTMLElement | null }> = [];
const inertSnapshots = new Map<HTMLElement, InertSnapshot>();
let portalRoot: HTMLElement | null = null;
let restoreScroll: (() => void) | null = null;
let bodyObserver: MutationObserver | null = null;

const focusableSelector = [
  'a[href]', 'button', 'input:not([type="hidden"])', 'select', 'textarea',
  '[tabindex]', '[contenteditable="true"]',
].join(',');

function focusableElements(panel: HTMLElement) {
  return Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector)).filter((element) => (
    element.tabIndex >= 0
    && !element.matches(':disabled, [aria-disabled="true"]')
    && !element.closest('[inert], [hidden], [aria-hidden="true"]')
    && element.getClientRects().length > 0
    && getComputedStyle(element).visibility !== 'hidden'
  ));
}

function focusInside(dialog: DialogSession, preferInitial = false) {
  const initial = dialog.initialFocus;
  const preferred = dialog.panel.querySelector<HTMLElement>('[autofocus], [data-dialog-autofocus]');
  const controls = focusableElements(dialog.panel);
  const firstControl = controls.find((element) => element.matches('input, select, textarea, [contenteditable="true"]'))
    || controls.find((element) => !element.classList.contains('pf-dialog-close'));
  const target = preferInitial && initial && dialog.panel.contains(initial)
    ? initial
    : (preferInitial ? preferred || firstControl : null) || controls[0] || dialog.panel;
  target.focus({ preventScroll: true });
}

function setInert(element: HTMLElement) {
  if (!inertSnapshots.has(element)) {
    inertSnapshots.set(element, { inert: element.inert, ariaHidden: element.getAttribute('aria-hidden') });
  }
  element.inert = true;
  element.setAttribute('aria-hidden', 'true');
}

function restoreInert(element: HTMLElement) {
  const snapshot = inertSnapshots.get(element);
  if (!snapshot) return;
  element.inert = snapshot.inert;
  if (snapshot.ariaHidden === null) element.removeAttribute('aria-hidden');
  else element.setAttribute('aria-hidden', snapshot.ariaHidden);
  inertSnapshots.delete(element);
}

function syncInertBackground() {
  if (!dialogs.length || !portalRoot) return;
  for (const child of Array.from(document.body.children)) {
    if (child instanceof HTMLElement && child !== portalRoot) setInert(child);
  }
  const top = dialogs[dialogs.length - 1];
  for (const dialog of dialogs) {
    if (dialog === top) restoreInert(dialog.layer);
    else setInert(dialog.layer);
  }
}

function lockDocumentScroll() {
  const body = document.body;
  const html = document.documentElement;
  const x = window.scrollX;
  const y = window.scrollY;
  const styles = {
    position: body.style.position, top: body.style.top, left: body.style.left,
    width: body.style.width, overflow: body.style.overflow, paddingRight: body.style.paddingRight,
    touchAction: body.style.touchAction,
  };
  const htmlOverflow = html.style.overflow;
  const hadClass = body.classList.contains('pf-modal-open');
  const scrollbarWidth = Math.max(0, window.innerWidth - html.clientWidth);
  const previousPadding = parseFloat(getComputedStyle(body).paddingRight) || 0;
  body.classList.add('pf-modal-open');
  Object.assign(body.style, {
    position: 'fixed', top: `-${y}px`, left: `-${x}px`, width: '100%', overflow: 'hidden', touchAction: 'auto',
    paddingRight: scrollbarWidth ? `${previousPadding + scrollbarWidth}px` : styles.paddingRight,
  });
  html.style.overflow = 'hidden';
  return () => {
    Object.assign(body.style, styles);
    html.style.overflow = htmlOverflow;
    if (!hadClass) body.classList.remove('pf-modal-open');
    const behavior = html.style.scrollBehavior;
    html.style.scrollBehavior = 'auto';
    window.scrollTo(x, y);
    html.style.scrollBehavior = behavior;
  };
}

function onKeyDown(event: KeyboardEvent) {
  const top = dialogs[dialogs.length - 1];
  if (!top || event.defaultPrevented || event.isComposing) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    top.onEscape();
  } else if (event.key === 'Tab') {
    const controls = focusableElements(top.panel);
    const first = controls[0];
    const last = controls[controls.length - 1];
    const active = document.activeElement;
    if (!first) {
      event.preventDefault();
      top.panel.focus({ preventScroll: true });
    } else if (event.shiftKey && (active === first || !controls.includes(active as HTMLElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !controls.includes(active as HTMLElement))) {
      event.preventDefault();
      first.focus();
    }
  }
}

function onFocusIn(event: FocusEvent) {
  const top = dialogs[dialogs.length - 1];
  if (top && event.target instanceof Node && !top.panel.contains(event.target)) focusInside(top);
}

function bindVisualViewport(layer: HTMLElement) {
  const viewport = window.visualViewport;
  if (!viewport) return () => undefined;
  const update = () => {
    layer.style.setProperty('--pf-dialog-viewport-height', `${viewport.height}px`);
    layer.style.setProperty('--pf-dialog-viewport-top', `${viewport.offsetTop}px`);
    layer.style.setProperty('--pf-dialog-viewport-left', `${viewport.offsetLeft}px`);
    layer.style.setProperty('--pf-dialog-viewport-width', `${viewport.width}px`);
  };
  update();
  viewport.addEventListener('resize', update);
  viewport.addEventListener('scroll', update);
  return () => {
    viewport.removeEventListener('resize', update);
    viewport.removeEventListener('scroll', update);
  };
}

export function isTopDialog(layer: HTMLElement) {
  return dialogs[dialogs.length - 1]?.layer === layer;
}

export function activateDialog(session: DialogSession) {
  if (!portalRoot) {
    portalRoot = document.createElement('div');
    portalRoot.className = 'pf-dialog-root';
    document.body.append(portalRoot);
  }
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  portalRoot.append(session.layer);
  if (!dialogs.length) {
    restoreScroll = lockDocumentScroll();
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocusIn);
    bodyObserver = new MutationObserver(syncInertBackground);
    bodyObserver.observe(document.body, { childList: true });
  }
  const dialog = { ...session, previousFocus };
  dialogs.push(dialog);
  const releaseViewport = bindVisualViewport(session.layer);
  // Move focus before hiding the old surface to avoid hiding its active element.
  focusInside(dialog, true);
  syncInertBackground();

  return () => {
    const wasTop = isTopDialog(session.layer);
    const index = dialogs.indexOf(dialog);
    if (index < 0) return;
    dialogs.splice(index, 1);
    releaseViewport();
    restoreInert(session.layer);
    session.layer.remove();
    if (!dialogs.length) {
      bodyObserver?.disconnect();
      bodyObserver = null;
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', onFocusIn);
      for (const element of Array.from(inertSnapshots.keys())) restoreInert(element);
      restoreScroll?.();
      restoreScroll = null;
      portalRoot?.remove();
      portalRoot = null;
    } else {
      syncInertBackground();
    }
    if (wasTop) {
      const top = dialogs[dialogs.length - 1];
      if (previousFocus?.isConnected && !previousFocus.closest('[inert]') && (!top || top.panel.contains(previousFocus))) {
        previousFocus.focus({ preventScroll: true });
      } else if (top) focusInside(top);
    }
  };
}
