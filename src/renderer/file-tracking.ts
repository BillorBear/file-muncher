import { calculatePetGaze } from '../shared/pet-gaze';
import type { PointerTarget } from '../shared/types';

const DRAG_EXPIRY_MS = 900;

interface FileTrackingOptions {
  zone: HTMLElement;
  creature: HTMLElement;
  isBusy(): boolean;
  onHoverChange(hovered: boolean): void;
  onDrop(files: File[]): void;
}

export interface FileTracking {
  trackGlobalFileDrag(point: PointerTarget | null): void;
  reset(): void;
  stop(): void;
}

export function bindFileTracking(options: FileTrackingOptions): FileTracking {
  const { zone, creature, isBusy, onHoverChange, onDrop } = options;
  let fileDragging = false;
  let globalTarget: PointerTarget | null = null;
  let globalSuppressed = false;
  let hovered = false;
  let facing: -1 | 1 = 1;
  let expiry: ReturnType<typeof setTimeout> | undefined;

  const hover = (value: boolean): void => {
    if (hovered === value) return;
    hovered = value;
    onHoverChange(value);
  };
  const stop = (): void => {
    clearTimeout(expiry);
    fileDragging = false;
    delete zone.dataset.tracking;
    delete zone.dataset.looking;
    hover(false);
    if (globalTarget) globalSuppressed = true;
  };
  const resetPose = (): void => {
    if (isBusy()) return;
    facing = 1;
    for (const property of ['--aim-angle', '--turret-facing', '--tank-travel-y', '--look-x', '--look-y', '--look-tilt']) {
      creature.style.removeProperty(property);
    }
  };
  const reset = (): void => {
    stop();
    resetPose();
  };
  const aim = (point: PointerTarget): void => {
    if (isBusy() || zone.dataset.interacting || creature.dataset.dragging) return;
    const matrix = creature.querySelector('svg')?.getScreenCTM();
    if (!matrix) return;
    const local = new DOMPoint(point.x, point.y).matrixTransform(matrix.inverse());
    const gaze = calculatePetGaze(local, facing);
    facing = gaze.turretFacing;
    creature.style.setProperty('--aim-angle', `${gaze.angle}deg`);
    creature.style.setProperty('--turret-facing', String(facing));
    creature.style.setProperty('--tank-travel-y', `${gaze.tankTravelY}px`);
    creature.style.setProperty('--look-x', `${gaze.x}px`);
    creature.style.setProperty('--look-y', `${gaze.y}px`);
    creature.style.setProperty('--look-tilt', `${gaze.tilt}deg`);
    zone.dataset.looking = 'true';
  };
  const clearLocalTracking = (): void => {
    clearTimeout(expiry);
    fileDragging = false;
    delete zone.dataset.tracking;
    hover(false);
    if (globalTarget && !globalSuppressed && !isBusy()) {
      aim(globalTarget);
    } else {
      delete zone.dataset.looking;
      resetPose();
    }
  };
  const trackGlobalFileDrag = (point: PointerTarget | null): void => {
    globalTarget = point;
    if (!point) {
      globalSuppressed = false;
      reset();
      return;
    }
    if (isBusy()) globalSuppressed = true;
    if (!globalSuppressed) aim(point);
  };
  const insideZone = (target: EventTarget | null): boolean => target instanceof Node && zone.contains(target);
  const trackFile = (event: DragEvent): void => {
    event.preventDefault();
    if (!event.dataTransfer?.types.includes('Files')) { reset(); return; }
    if (isBusy() || globalSuppressed) { event.dataTransfer.dropEffect = 'none'; return; }
    fileDragging = true;
    zone.dataset.tracking = 'true';
    aim({ x: event.clientX, y: event.clientY });
    hover(insideZone(event.target));
    event.dataTransfer.dropEffect = hovered ? 'copy' : 'none';
    clearTimeout(expiry);
    expiry = setTimeout(clearLocalTracking, DRAG_EXPIRY_MS);
  };

  document.addEventListener('dragenter', trackFile);
  document.addEventListener('dragover', trackFile);
  document.addEventListener('dragleave', event => {
    if (!fileDragging) return;
    if (event.relatedTarget instanceof Node) {
      hover(insideZone(event.relatedTarget));
    } else if (event.target === document || event.target === document.documentElement ||
      event.clientX <= 0 || event.clientY <= 0 || event.clientX >= innerWidth || event.clientY >= innerHeight) {
      clearLocalTracking();
    } else if (event.target === zone) {
      hover(false);
    }
  });
  document.addEventListener('drop', event => {
    event.preventDefault();
    const accepted = insideZone(event.target) && !isBusy();
    const files = [...(event.dataTransfer?.files ?? [])];
    if (accepted && files.length) {
      aim({ x: event.clientX, y: event.clientY });
      stop();
      onDrop(files);
    } else reset();
  });
  document.addEventListener('dragend', reset);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') reset(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); });
  window.addEventListener('blur', clearLocalTracking);
  window.addEventListener('pagehide', reset);

  return { trackGlobalFileDrag, reset, stop };
}
