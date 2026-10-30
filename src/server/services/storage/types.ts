/** The only file-storage surface the app may use. Implementations: local (private folder), s3 (later). */
export interface FileStorage {
  readonly name: string;
  /** Stores a file under `key` (e.g. "licences/user-123/front.jpg"), replacing any existing one. */
  put(key: string, body: Uint8Array): Promise<void>;
  /** Returns the file, or null if there is none. */
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}
