import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { bindPetGestures } from '../src/renderer/pet-interactions';
import type { DesktopApi } from '../src/shared/types';

class GestureSurface extends EventTarget {
  readonly dataset: Record<string, string | undefined> = {};
  private readonly classes = new Set<string>();
  private readonly captures = new Set<number>();
  readonly classList = {
    add: (name: string): void => { this.classes.add(name); },
    remove: (name: string): void => { this.classes.delete(name); },
    contains: (name: string): boolean => this.classes.has(name),
  };

  setPointerCapture(pointerId: number): void { this.captures.add(pointerId); }
  hasPointerCapture(pointerId: number): boolean { return this.captures.has(pointerId); }
  releasePointerCapture(pointerId: number): void { this.captures.delete(pointerId); }
}

interface GestureHarness {
  readonly surface: GestureSurface;
  readonly hostWindow: EventTarget;
  readonly calls: { begin: number; move: number; end: number; interactions: number; errors: unknown[] };
  pointer(type: string, x: number, y?: number, pointerId?: number, ctrlKey?: boolean): void;
}

function createHarness(context: TestContext, beginPetDrag?: () => Promise<void>): GestureHarness {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const hostWindow = new EventTarget();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: hostWindow });
  context.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  });
  const calls: GestureHarness['calls'] = { begin: 0, move: 0, end: 0, interactions: 0, errors: [] };
  const api: Pick<DesktopApi, 'beginPetDrag' | 'movePetDrag' | 'endPetDrag'> = {
    beginPetDrag: async (): Promise<void> => { calls.begin++; await beginPetDrag?.(); },
    movePetDrag: (): void => { calls.move++; },
    endPetDrag: async (): Promise<void> => { calls.end++; },
  };
  const surface = new GestureSurface();
  bindPetGestures(surface as unknown as HTMLElement, api, () => { calls.interactions++; }, error => { calls.errors.push(error); });
  return {
    surface,
    hostWindow,
    calls,
    pointer(type: string, x: number, y = 100, pointerId = 1, ctrlKey = false): void {
      surface.dispatchEvent(Object.assign(new Event(type), { pointerId, screenX: x, screenY: y, isPrimary: true, button: 0, ctrlKey }));
    },
  };
}

test('a dragged pet faces the latest horizontal movement when reversing before its starting point', async context => {
  const harness = createHarness(context);
  harness.pointer('pointerdown', 100);
  await Promise.resolve();
  harness.pointer('pointermove', 108);
  assert.equal(harness.surface.dataset.dragging, 'true');
  assert.equal(harness.surface.dataset.dragDirection, 'right');
  harness.pointer('pointermove', 107);
  assert.equal(harness.surface.dataset.dragDirection, 'left');
  assert.equal(harness.calls.interactions, 0);
});

test('pausing a drag stops directional movement without putting the pet down', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const harness = createHarness(context);
  harness.pointer('pointerdown', 100);
  await Promise.resolve();
  harness.pointer('pointermove', 109);
  context.mock.timers.tick(180);
  assert.equal(harness.surface.dataset.dragDirection, 'none');
  assert.equal(harness.surface.dataset.dragging, 'true');
  assert.equal(harness.surface.dataset.landing, undefined);
  assert.equal(harness.calls.end, 0);
  harness.pointer('pointermove', 105);
  assert.equal(harness.surface.dataset.dragDirection, 'left');
});

test('releasing a dragged pet lands briefly without triggering a tap interaction', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const harness = createHarness(context);
  harness.pointer('pointerdown', 100);
  await Promise.resolve();
  harness.pointer('pointermove', 110);
  harness.pointer('pointerup', 110);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.notEqual(harness.surface.dataset.dragging, 'true');
  assert.equal(harness.surface.dataset.dragDirection, 'none');
  assert.equal(harness.surface.dataset.landing, 'true');
  assert.equal(harness.calls.interactions, 0);
  assert.equal(harness.calls.end, 1);
  context.mock.timers.tick(350);
  assert.equal(harness.surface.dataset.landing, undefined);
});

test('a macOS control-click opens its context menu without starting a drag or tapping the pet', async context => {
  const harness = createHarness(context);
  harness.pointer('pointerdown', 100, 100, 1, true);
  harness.surface.dispatchEvent(new Event('contextmenu'));
  harness.pointer('pointerup', 100, 100, 1, true);
  await Promise.resolve();
  assert.equal(harness.calls.begin, 0);
  assert.equal(harness.calls.interactions, 0);
  assert.notEqual(harness.surface.dataset.dragging, 'true');
});

test('opening a context menu cancels an active drag without a landing or interaction', async context => {
  const harness = createHarness(context);
  harness.pointer('pointerdown', 100);
  await Promise.resolve();
  harness.pointer('pointermove', 110);
  harness.surface.dispatchEvent(new Event('contextmenu'));
  harness.pointer('pointerup', 110);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(harness.calls.interactions, 0);
  assert.equal(harness.surface.dataset.landing, undefined);
  assert.equal(harness.surface.dataset.dragDirection, 'none');
  assert.notEqual(harness.surface.dataset.dragging, 'true');
  assert.equal(harness.calls.end, 1);
});

test('movement within four pixels stays a tap and does not lift or land the pet', async context => {
  const harness = createHarness(context);
  harness.pointer('pointerdown', 100);
  await Promise.resolve();
  harness.pointer('pointermove', 104);
  assert.notEqual(harness.surface.dataset.dragging, 'true');
  harness.pointer('pointerup', 104);
  assert.equal(harness.calls.interactions, 1);
  assert.equal(harness.surface.dataset.landing, undefined);
});

test('another pointer being cancelled does not interrupt the captured drag', async context => {
  const harness = createHarness(context);
  harness.pointer('pointerdown', 100);
  await Promise.resolve();
  harness.pointer('pointermove', 110);
  harness.pointer('pointercancel', 110, 100, 2);
  assert.equal(harness.surface.dataset.dragging, 'true');
  assert.equal(harness.surface.dataset.dragDirection, 'right');
});

for (const cancellation of ['pointercancel', 'lostpointercapture', 'blur'] as const) {
  test(`${cancellation} puts down a dragged pet without tapping or playing a landing`, async context => {
    context.mock.timers.enable({ apis: ['setTimeout'] });
    const harness = createHarness(context);
    harness.pointer('pointerdown', 100);
    await Promise.resolve();
    harness.pointer('pointermove', 90);
    if (cancellation === 'blur') harness.hostWindow.dispatchEvent(new Event('blur'));
    else harness.pointer(cancellation, 90);
    harness.pointer('pointerup', 90);
    await new Promise<void>(resolve => setImmediate(resolve));
    context.mock.timers.tick(500);
    assert.notEqual(harness.surface.dataset.dragging, 'true');
    assert.equal(harness.surface.dataset.dragDirection, 'none');
    assert.equal(harness.surface.dataset.landing, undefined);
    assert.equal(harness.calls.interactions, 0);
    assert.equal(harness.calls.end, 1);
  });
}

test('a vertical drag stays lifted without pretending to move left or right', async context => {
  const harness = createHarness(context);
  harness.pointer('pointerdown', 100, 100);
  await Promise.resolve();
  harness.pointer('pointermove', 100, 108);
  assert.equal(harness.surface.dataset.dragging, 'true');
  assert.equal(harness.surface.dataset.dragDirection, 'none');
});

test('a drag released before the host is ready still ends once and never becomes a tap', async context => {
  let startHost: (() => void) | undefined;
  const hostReady = new Promise<void>(resolve => { startHost = resolve; });
  const harness = createHarness(context, () => hostReady);
  harness.pointer('pointerdown', 100);
  harness.pointer('pointermove', 110);
  harness.pointer('pointerup', 110);
  assert.equal(harness.surface.dataset.landing, 'true');
  assert.equal(harness.calls.end, 0);
  assert.equal(harness.calls.interactions, 0);
  startHost?.();
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(harness.calls.end, 1);
  assert.equal(harness.calls.move, 0);
});
