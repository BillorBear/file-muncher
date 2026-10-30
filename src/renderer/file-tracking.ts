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
  reset(): void;
  stop(): void;
}

export function bindFileTracking(options: FileTrackingOptions): FileTracking {
  const { zone, creature, isBusy, onHoverChange, onDrop } = options;
  let fileDragging = false;
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
  };
  const reset = (): void => {
    stop();
    if (isBusy()) return;
    facing = 1;
    for (const property of ['--aim-angle', '--turret-facing', '--tank-travel-y', '--look-x', '--look-y', '--look-tilt']) {
      creature.style.removeProperty(property);
    }
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
  const insideZone = (target: EventTarget | null): boolean => target instanceof Node && zone.contains(target);
  const trackFile = (event: DragEvent): void => {
    event.preventDefault();
    if (!event.dataTransfer?.types.includes('Files')) { reset(); return; }
    if (isBusy()) { event.dataTransfer.dropEffect = 'none'; return; }
    fileDragging = true;
    zone.dataset.tracking = 'true';
    aim({ x: event.clientX, y: event.clientY });
    hover(insideZone(event.target));
    event.dataTransfer.dropEffect = hovered ? 'copy' : 'none';
    clearTimeout(expiry);
    expiry = setTimeout(reset, DRAG_EXPIRY_MS);
  };

  document.addEventListener('dragenter', trackFile);
  document.addEventListener('dragover', trackFile);
  document.addEventListener('dragleave', event => {
    if (!fileDragging) return;
    if (event.relatedTarget instanceof Node) {
      hover(insideZone(event.relatedTarget));
    } else if (event.target === document || event.target === document.documentElement ||
      event.clientX <= 0 || event.clientY <= 0 || event.clientX >= innerWidth || event.clientY >= innerHeight) {
      reset();
    } else if (event.target === zone) {
      hover(false);
    }
  });
  document.addEventListener('drop', event => {
    event.preventDefault();
    const accepted = insideZone(event.target) && !isBusy();
    const files = [...(event.dataTransfer?.files ?? [])];
    if (accepted && files.length) {
      stop();
      onDrop(files);
    } else reset();
  });
  document.addEventListener('dragend', reset);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') reset(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); });
  window.addEventListener('blur', reset);
  window.addEventListener('pagehide', reset);

  return { reset, stop };
}
