import assert from 'node:assert/strict';
import test from 'node:test';
import { FileDragSession, type NativeFileDragSample } from '../src/main/file-drag-session';

const idle: NativeFileDragSample = { revision: 10, leftDown: false, hasFiles: true, escapeDown: false, keyDownRevision: 5 };

test('old file pasteboard data never activates ordinary clicks or mouse drags', () => {
  const session = new FileDragSession();
  assert.equal(session.observe(idle), false);
  assert.equal(session.observe({ ...idle, leftDown: true }), false);
  assert.equal(session.observe(idle), false);
  assert.equal(session.observe({ ...idle, leftDown: true }), false);
});

test('a fresh file drag activates even when the press and pasteboard update occur between samples', () => {
  const session = new FileDragSession();
  session.observe(idle);
  const dragging = { ...idle, revision: 11, leftDown: true };
  assert.equal(session.observe(dragging), true);
  assert.equal(session.observe(dragging), true);
  assert.equal(session.observe({ ...dragging, leftDown: false }), false);
  assert.equal(session.observe(dragging), false, 'A later ordinary press must not revive the completed drag.');
});

test('text drag revisions and file data updated while the mouse is up are not file drags', () => {
  const session = new FileDragSession();
  session.observe(idle);
  assert.equal(session.observe({ ...idle, revision: 11, leftDown: true, hasFiles: false }), false);
  assert.equal(session.observe({ ...idle, revision: 12 }), false);
  assert.equal(session.observe({ ...idle, revision: 12, leftDown: true }), false);
  assert.equal(session.observe({ ...idle, revision: 13, leftDown: true }), true);
});

test('starting or resuming observation in the middle of a press waits for release', () => {
  const session = new FileDragSession();
  assert.equal(session.observe({ ...idle, leftDown: true }), false);
  assert.equal(session.observe({ ...idle, revision: 11, leftDown: true }), false);
  session.observe(idle);
  assert.equal(session.observe({ ...idle, revision: 12, leftDown: true }), true);
  session.reset();
  assert.equal(session.observe({ ...idle, revision: 12, leftDown: true }), false);
});

test('Escape cancels a file drag until release even if the pasteboard changes again', () => {
  const session = new FileDragSession();
  session.observe(idle);
  const dragging = { ...idle, revision: 11, leftDown: true };
  assert.equal(session.observe(dragging), true);
  assert.equal(session.observe({ ...dragging, escapeDown: true }), false);
  assert.equal(session.observe({ ...dragging, revision: 12 }), false);
  session.observe({ ...dragging, leftDown: false });
  assert.equal(session.observe({ ...dragging, revision: 13 }), true);
});

test('losing file types during a session clears the file gaze', () => {
  const session = new FileDragSession();
  session.observe(idle);
  const dragging = { ...idle, revision: 11, leftDown: true };
  assert.equal(session.observe(dragging), true);
  assert.equal(session.observe({ ...dragging, revision: 12, hasFiles: false }), false);
});

test('a short cancellation key press between samples cannot leave the drag active', () => {
  const session = new FileDragSession();
  session.observe(idle);
  const dragging = { ...idle, revision: 11, leftDown: true };
  assert.equal(session.observe(dragging), true);
  assert.equal(session.observe({ ...dragging, keyDownRevision: 6 }), false);
  assert.equal(session.observe({ ...dragging, revision: 12, keyDownRevision: 6 }), false);
});

test('file formats may arrive after a fresh drag revision without changing it again', () => {
  const session = new FileDragSession();
  session.observe(idle);
  const dragging = { ...idle, revision: 11, leftDown: true };
  assert.equal(session.observe({ ...dragging, hasFiles: false }), false);
  assert.equal(session.observe(dragging), true);
  session.observe({ ...dragging, leftDown: false });
  assert.equal(session.observe(dragging), false);
});
