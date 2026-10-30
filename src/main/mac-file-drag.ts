import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { FileDragSession, type NativeFileDragSample } from './file-drag-session';
import { MAC_FILE_DRAG_SCRIPT } from './mac-file-drag-script';

const SAMPLE_EXPIRY_MS = 500;
const STARTUP_TIMEOUT_MS = 5000;
const MAX_DIAGNOSTIC_LENGTH = 1000;

interface TimedFileDragSample extends NativeFileDragSample {
  sampledAt: number;
}

function parseSample(line: string): TimedFileDragSample {
  const sample: unknown = JSON.parse(line);
  if (typeof sample !== 'object' || sample === null ||
    !('revision' in sample) || !Number.isSafeInteger(sample.revision) ||
    !('keyDownRevision' in sample) || !Number.isSafeInteger(sample.keyDownRevision) ||
    !('leftDown' in sample) || typeof sample.leftDown !== 'boolean' ||
    !('hasFiles' in sample) || typeof sample.hasFiles !== 'boolean' ||
    !('escapeDown' in sample) || typeof sample.escapeDown !== 'boolean' ||
    !('sampledAt' in sample) || typeof sample.sampledAt !== 'number' || !Number.isFinite(sample.sampledAt)) {
    throw new Error('Invalid native file-drag sample.');
  }
  return sample as TimedFileDragSample;
}

export function observeMacFileDrag(onActivity: (active: boolean) => void, onError: (message: string) => void,
  onStopped: () => void): () => void {
  const observer = spawn('/usr/bin/osascript', ['-l', 'JavaScript', '-e', MAC_FILE_DRAG_SCRIPT],
    { stdio: ['ignore', 'pipe', 'pipe'] });
  const lines = createInterface({ input: observer.stdout });
  const session = new FileDragSession();
  let stopped = false;
  let active = false;
  let diagnostic = '';
  let timeout: ReturnType<typeof setTimeout>;

  const publish = (value: boolean): void => {
    if (!value && !active) return;
    active = value;
    onActivity(value);
  };
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timeout);
    session.reset();
    publish(false);
    lines.close();
    observer.kill();
    onStopped();
  };
  const fail = (message: string): void => {
    if (stopped) return;
    onError(message);
    stop();
  };
  const expire = (): void => {
    session.reset();
    publish(false);
    onError('Native file-drag samples paused; waiting for fresh samples.');
  };
  timeout = setTimeout(() => fail('Native file-drag observer did not start.'), STARTUP_TIMEOUT_MS);
  lines.on('line', line => {
    if (stopped) return;
    let sample: TimedFileDragSample;
    try { sample = parseSample(line); }
    catch (error) { fail(error instanceof Error ? error.message : 'Could not read native file-drag state.'); return; }
    clearTimeout(timeout);
    const age = Date.now() - sample.sampledAt;
    if (age > SAMPLE_EXPIRY_MS || age < -SAMPLE_EXPIRY_MS) {
      session.reset();
      publish(false);
    } else {
      publish(session.observe(sample));
    }
    timeout = setTimeout(expire, SAMPLE_EXPIRY_MS);
  });
  observer.stderr.setEncoding('utf8');
  observer.stderr.on('data', (chunk: string) => { diagnostic = (diagnostic + chunk).slice(-MAX_DIAGNOSTIC_LENGTH); });
  observer.once('error', error => fail(error.message));
  observer.once('exit', (code, signal) => fail(diagnostic.trim() || `Native file-drag observer exited (${code ?? signal}).`));
  return stop;
}
