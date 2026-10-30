export interface NativeFileDragSample {
  revision: number;
  leftDown: boolean;
  hasFiles: boolean;
  escapeDown: boolean;
  keyDownRevision: number;
}

export class FileDragSession {
  private revision: number | undefined;
  private keyDownRevision: number | undefined;
  private armed = false;
  private freshDrag = false;

  observe(sample: NativeFileDragSample): boolean {
    const fresh = this.revision !== undefined && sample.revision !== this.revision;
    const keyPressed = this.keyDownRevision !== undefined && sample.keyDownRevision !== this.keyDownRevision;
    this.revision = sample.revision;
    this.keyDownRevision = sample.keyDownRevision;
    if (!sample.leftDown) {
      this.armed = true;
      this.freshDrag = false;
    } else if (sample.escapeDown || keyPressed) {
      this.armed = false;
      this.freshDrag = false;
    } else if (this.armed && fresh) {
      this.freshDrag = true;
    }
    return this.freshDrag && sample.leftDown && sample.hasFiles;
  }

  reset(): void {
    this.revision = undefined;
    this.keyDownRevision = undefined;
    this.armed = false;
    this.freshDrag = false;
  }
}
