export type ThemeId = 'munch' | 'pixel' | 'blade' | 'void' | 'paper';
export type DeletionMode = 'trash' | 'permanent';
export type AnimationPhase = 'idle' | 'hover' | 'processing' | 'success' | 'error';

export interface Preferences {
  theme: ThemeId;
  deletionMode: DeletionMode;
  petVisible: boolean;
  petSize: number;
  reduceMotion: boolean;
}

export interface PetStats {
  files: number;
  bytes: number;
  meals: number;
}

export interface AppState {
  preferences: Preferences;
  stats: PetStats;
}

export interface PreparedEntry {
  id: string;
  name: string;
  kind: 'file' | 'directory' | 'symlink';
  fileCount: number;
  bytes: number;
}

export interface RejectedEntry {
  name: string;
  message: string;
}

export interface PreparedBatch {
  token: string;
  entries: PreparedEntry[];
  rejected: RejectedEntry[];
  mode: DeletionMode;
}

export interface BatchItemResult {
  name: string;
  status: 'success' | 'error';
  fileCount: number;
  bytes: number;
  message?: string;
}

export interface BatchResult {
  items: BatchItemResult[];
  cancelled: boolean;
  state: AppState;
  warning?: string;
}

export interface PointerTarget {
  x: number;
  y: number;
}

export interface DesktopApi {
  getState(): Promise<AppState>;
  prepareDrop(files: File[]): Promise<PreparedBatch>;
  choose(kind: 'files' | 'directory'): Promise<PreparedBatch | null>;
  executeBatch(token: string): Promise<BatchResult>;
  updatePreferences(patch: Partial<Preferences>): Promise<AppState>;
  onState(listener: (state: AppState) => void): () => void;
  onGlobalFileDrag(listener: (point: PointerTarget | null) => void): () => void;
  onPetSettingsDismissRequested(listener: (requestId: number) => void): () => void;
  openMain(): Promise<void>;
  openPetSettings(): Promise<void>;
  closePetSettings(): Promise<void>;
  dismissPetSettings(requestId: number): Promise<void>;
  beginPetDrag(): Promise<void>;
  movePetDrag(): void;
  endPetDrag(): Promise<void>;
  quit(): Promise<void>;
}

declare global {
  interface Window {
    shredder?: DesktopApi;
  }
}
