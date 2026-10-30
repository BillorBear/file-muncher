import type { DesktopApi } from '../shared/types';

const DRAG_THRESHOLD = 4;
const DIRECTION_IDLE_MS = 140;
const LANDING_DURATION_MS = 350;

interface Gesture {
  pointerId: number;
  x: number;
  y: number;
  previousX: number;
  dragged: boolean;
  ready: boolean;
  started?: Promise<void>;
}

export function bindPetGestures(body: HTMLElement, api: Pick<DesktopApi, 'beginPetDrag' | 'movePetDrag' | 'endPetDrag'>, interact: () => void, reportError: (error: unknown) => void): void {
  let gesture: Gesture | undefined;
  let ending = false;
  let directionTimer: ReturnType<typeof setTimeout> | undefined;
  let landingTimer: ReturnType<typeof setTimeout> | undefined;

  const finish = (reason: 'release' | 'cancel'): void => {
    const current = gesture;
    if (!current) return;
    gesture = undefined;
    clearTimeout(directionTimer);
    body.classList.remove('is-dragging');
    delete body.dataset.dragging;
    body.dataset.dragDirection = 'none';
    if (reason === 'release' && current.dragged) {
      body.dataset.landing = 'true';
      landingTimer = setTimeout(() => { delete body.dataset.landing; }, LANDING_DURATION_MS);
    }
    if (body.hasPointerCapture(current.pointerId)) body.releasePointerCapture(current.pointerId);
    if (current.started) {
      ending = true;
      void current.started.then(() => api.endPetDrag()).catch(reportError).finally(() => { ending = false; });
    }
    if (reason === 'release' && !current.dragged) interact();
  };

  body.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0 || event.ctrlKey || gesture || ending) return;
    clearTimeout(landingTimer);
    delete body.dataset.landing;
    gesture = { pointerId: event.pointerId, x: event.screenX, y: event.screenY, previousX: event.screenX, dragged: false, ready: false };
    body.setPointerCapture(event.pointerId);
    const current = gesture;
    current.started = api.beginPetDrag().then(() => {
      current.ready = true;
      if (gesture === current && current.dragged) api.movePetDrag();
    }).catch(error => { reportError(error); if (gesture === current) finish('cancel'); });
  });
  body.addEventListener('pointermove', event => {
    const current = gesture;
    if (!current || event.pointerId !== current.pointerId) return;
    const horizontalMovement = event.screenX - current.previousX;
    current.previousX = event.screenX;
    if (!current.dragged && Math.hypot(event.screenX - current.x, event.screenY - current.y) > DRAG_THRESHOLD) {
      current.dragged = true;
      body.classList.add('is-dragging');
      body.dataset.dragging = 'true';
    }
    if (current.dragged) {
      body.dataset.dragDirection = horizontalMovement < 0 ? 'left' : horizontalMovement > 0 ? 'right' : 'none';
      clearTimeout(directionTimer);
      directionTimer = setTimeout(() => {
        if (gesture === current) body.dataset.dragDirection = 'none';
      }, DIRECTION_IDLE_MS);
    }
    if (current.dragged && current.ready) {
      api.movePetDrag();
    }
  });
  body.addEventListener('pointerup', event => {
    if (event.pointerId === gesture?.pointerId) finish('release');
  });
  body.addEventListener('pointercancel', event => { if (event.pointerId === gesture?.pointerId) finish('cancel'); });
  body.addEventListener('lostpointercapture', event => { if (event.pointerId === gesture?.pointerId) finish('cancel'); });
  body.addEventListener('contextmenu', () => finish('cancel'));
  window.addEventListener('blur', () => finish('cancel'));
  body.addEventListener('keydown', event => {
    if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) { event.preventDefault(); interact(); }
  });
  body.addEventListener('click', event => { if (event.detail === 0) interact(); });
  body.addEventListener('dragstart', event => event.preventDefault());
}
