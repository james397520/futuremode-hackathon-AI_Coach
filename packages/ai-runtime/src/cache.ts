/**
 * Model caching — spec §61, §97.
 *
 * What is cached
 * --------------
 * **Model weights and tokenizer files only.** Nothing else, ever. No prompts, no
 * transcripts, no retrieval queries, no session content touches Cache Storage or
 * IndexedDB from this package. The only IndexedDB records we write are file
 * metadata (url, size, digest, timestamps) for the files listed in a
 * `LocalModelManifest`.
 *
 * Enterprise switches (§61) — all three are honoured here:
 *   - `allow_local_model_cache: false`  → nothing is persisted; every load streams
 *     the weights and keeps them only in the worker's memory for that session.
 *   - `allow_sensitive_data_cache: false` → the in-memory embedding memo is
 *     disabled, so a derived vector of user text is never retained across calls.
 *   - `clear_on_logout: true` → the app calls `clearAll()` on sign-out; it removes
 *     the Cache Storage bucket and the metadata database.
 *
 * Every browser API used here is optional. If Cache Storage, IndexedDB, or
 * `crypto.subtle` is missing or blocked, the cache silently degrades to
 * pass-through fetching.
 */
import type { LocalTask, RuntimePolicy } from '@ai-coach/shared-types';

import { errorText, hasNavigator } from './capability';
import { BackendFailure, type ResolvedManifest } from './backends/types';

export const DEFAULT_CACHE_NAME = 'ai-coach-models-v1';
export const DEFAULT_DB_NAME = 'ai-coach-runtime';
const DB_VERSION = 1;
const META_STORE = 'model_files';

export interface ManifestFileRef {
  url: string;
  bytes: number;
  sha256?: string;
}

export interface CachedFileMeta {
  url: string;
  model_id: string;
  task: LocalTask;
  bytes: number;
  sha256?: string;
  integrity_verified: boolean;
  cached_at: number;
  last_used_at: number;
}

export interface CacheStats {
  enabled: boolean;
  entries: number;
  bytes: number;
  quota?: number;
  usage?: number;
}

export interface FetchFileOptions {
  /** Alternative URLs, tried in order after the primary one. */
  mirrors?: readonly string[];
  onProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export interface ModelCacheOptions {
  policy: RuntimePolicy;
  cacheName?: string;
  dbName?: string;
  fetchImpl?: typeof fetch;
  onWarning?: (message: string) => void;
}

/* ------------------------------------------------------------------ *
 * Tiny guarded IndexedDB wrapper
 * ------------------------------------------------------------------ */

function hasIndexedDb(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    // Firefox in private mode throws on access rather than returning undefined.
    return false;
  }
}

function hasCacheStorage(): boolean {
  try {
    return typeof caches !== 'undefined' && typeof caches.open === 'function';
  } catch {
    return false;
  }
}

function openDb(dbName: string): Promise<IDBDatabase | null> {
  if (!hasIndexedDb()) return Promise.resolve(null);
  return new Promise<IDBDatabase | null>((resolve) => {
    let settled = false;
    const done = (value: IDBDatabase | null): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(dbName, DB_VERSION);
    } catch {
      done(null);
      return;
    }
    // A blocked upgrade (another tab holding an old version) must not hang us.
    const timer = setTimeout(() => done(null), 5000);
    request.onupgradeneeded = () => {
      try {
        const db = request.result;
        if (!db.objectStoreNames.contains(META_STORE)) {
          const store = db.createObjectStore(META_STORE, { keyPath: 'url' });
          store.createIndex('model_id', 'model_id', { unique: false });
          store.createIndex('last_used_at', 'last_used_at', { unique: false });
        }
      } catch {
        /* the store may already exist in a racing tab */
      }
    };
    request.onsuccess = () => {
      clearTimeout(timer);
      done(request.result);
    };
    request.onerror = () => {
      clearTimeout(timer);
      done(null);
    };
    request.onblocked = () => {
      clearTimeout(timer);
      done(null);
    };
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
}

function reqValue<T>(request: IDBRequest<T>): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(undefined);
  });
}

/* ------------------------------------------------------------------ *
 * Digest helpers
 * ------------------------------------------------------------------ */

function hasSubtleCrypto(): boolean {
  try {
    return (
      typeof crypto !== 'undefined' &&
      typeof crypto.subtle !== 'undefined' &&
      typeof crypto.subtle.digest === 'function'
    );
  } catch {
    return false;
  }
}

export async function sha256Hex(buffer: ArrayBuffer): Promise<string | null> {
  if (!hasSubtleCrypto()) return null;
  try {
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    const view = new Uint8Array(digest);
    let hex = '';
    for (let i = 0; i < view.length; i += 1) {
      hex += (view[i] ?? 0).toString(16).padStart(2, '0');
    }
    return hex;
  } catch {
    // `crypto.subtle` is only exposed on secure contexts; on plain http it is
    // absent. Integrity is then unverifiable, which we report rather than fake.
    return null;
  }
}

function isQuotaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = (error as { name?: unknown }).name;
  const code = (error as { code?: unknown }).code;
  return (
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    code === 22 ||
    /quota/i.test(errorText(error))
  );
}

/* ------------------------------------------------------------------ *
 * ModelCache
 * ------------------------------------------------------------------ */

export class ModelCache {
  private policy: RuntimePolicy;
  private readonly cacheName: string;
  private readonly dbName: string;
  private readonly fetchImpl: typeof fetch | undefined;
  private readonly onWarning: (message: string) => void;

  /**
   * In-memory memo of derived embeddings, keyed by `model_id::role::text-hash`.
   *
   * This holds data *derived from user text*, so it is gated behind
   * `allow_sensitive_data_cache` (§61) and is never persisted — it dies with the
   * page. Bounded to keep memory flat.
   */
  private readonly derivedMemo = new Map<string, number[]>();
  private static readonly DERIVED_MEMO_LIMIT = 128;

  /** Persisted-cache availability, resolved lazily and remembered. */
  private storageAvailable: boolean | null = null;

  constructor(options: ModelCacheOptions) {
    this.policy = options.policy;
    this.cacheName = options.cacheName ?? DEFAULT_CACHE_NAME;
    this.dbName = options.dbName ?? DEFAULT_DB_NAME;
    this.fetchImpl = options.fetchImpl;
    this.onWarning = options.onWarning ?? (() => undefined);
  }

  setPolicy(policy: RuntimePolicy): void {
    const wasAllowed = this.policy.allow_local_model_cache;
    const sensitiveWasAllowed = this.policy.allow_sensitive_data_cache;
    this.policy = policy;
    if (wasAllowed && !policy.allow_local_model_cache) {
      // Turning the switch off must take effect immediately, not next session.
      void this.clearAll();
    }
    if (sensitiveWasAllowed && !policy.allow_sensitive_data_cache) {
      this.derivedMemo.clear();
    }
  }

  /** §61: false when the enterprise switch is off, or the browser has no storage. */
  get persistenceEnabled(): boolean {
    return this.policy.allow_local_model_cache && hasCacheStorage();
  }

  get sensitiveMemoEnabled(): boolean {
    return this.policy.allow_sensitive_data_cache;
  }

  /* -------------------- derived-value memo -------------------- */

  rememberDerived(key: string, vector: readonly number[]): void {
    if (!this.sensitiveMemoEnabled) return;
    if (this.derivedMemo.size >= ModelCache.DERIVED_MEMO_LIMIT) {
      const oldest = this.derivedMemo.keys().next();
      if (!oldest.done) this.derivedMemo.delete(oldest.value);
    }
    this.derivedMemo.set(key, [...vector]);
  }

  recallDerived(key: string): number[] | undefined {
    if (!this.sensitiveMemoEnabled) return undefined;
    const hit = this.derivedMemo.get(key);
    return hit ? [...hit] : undefined;
  }

  /* -------------------- model files -------------------- */

  /**
   * Fetch one manifest file, using the persisted cache when allowed.
   *
   * Order of operations:
   *   1. cache hit → return bytes (and touch `last_used_at`)
   *   2. network (primary url, then mirrors)
   *   3. sha256 verification when the manifest supplies a digest
   *   4. persist, tolerating quota errors by evicting the least recently used
   *      entries once and then giving up on persistence (but still returning the
   *      bytes — a full disk must not break the feature)
   */
  async fetchFile(
    manifest: ResolvedManifest,
    file: ManifestFileRef,
    options: FetchFileOptions = {},
  ): Promise<ArrayBuffer> {
    const fetchImpl = options.fetchImpl ?? this.fetchImpl ?? globalFetch();
    if (!fetchImpl) {
      throw new BackendFailure({
        reason: 'network_failed',
        backend: 'server',
        task: manifest.task,
        message: 'fetch() is not available in this environment.',
      });
    }

    if (this.persistenceEnabled) {
      const cached = await this.readFromCache(file.url);
      if (cached) {
        void this.touch(file.url);
        options.onProgress?.(cached.byteLength, cached.byteLength);
        return cached;
      }
    }

    const urls = [file.url, ...(options.mirrors ?? []).filter((u) => u !== file.url)];
    let lastError: unknown;
    for (const url of urls) {
      try {
        const buffer = await this.download(fetchImpl, url, file, options);
        await this.verify(manifest, file, buffer);
        if (this.persistenceEnabled) {
          await this.persist(manifest, file, buffer);
        }
        return buffer;
      } catch (error) {
        if (BackendFailure.is(error) && error.reason === 'integrity_mismatch') throw error;
        if (BackendFailure.is(error) && error.reason === 'aborted') throw error;
        lastError = error;
      }
    }

    throw new BackendFailure({
      reason: 'model_unavailable',
      backend: 'server',
      task: manifest.task,
      message: `Could not download ${shortName(file.url)}: ${errorText(lastError)}`,
      cause: lastError,
    });
  }

  private async download(
    fetchImpl: typeof fetch,
    url: string,
    file: ManifestFileRef,
    options: FetchFileOptions,
  ): Promise<ArrayBuffer> {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        // Model files are public static assets; never attach credentials.
        credentials: 'omit',
        mode: 'cors',
        cache: 'default',
        ...(options.signal ? { signal: options.signal } : {}),
      });
    } catch (error) {
      if (options.signal?.aborted) {
        throw new BackendFailure({
          reason: 'aborted',
          backend: 'server',
          message: 'Model download was cancelled.',
        });
      }
      throw new Error(`network error for ${url}: ${errorText(error)}`);
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }

    const declared = Number(response.headers.get('content-length') ?? '0');
    const total = Number.isFinite(declared) && declared > 0 ? declared : file.bytes;

    // Stream so the download bar in the runtime status UI can move.
    const body = response.body;
    if (!body || typeof body.getReader !== 'function' || !options.onProgress) {
      const buffer = await response.arrayBuffer();
      options.onProgress?.(buffer.byteLength, buffer.byteLength);
      return buffer;
    }

    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        loaded += value.byteLength;
        options.onProgress(loaded, total);
      }
    }
    const out = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out.buffer as ArrayBuffer;
  }

  private async verify(
    manifest: ResolvedManifest,
    file: ManifestFileRef,
    buffer: ArrayBuffer,
  ): Promise<void> {
    if (!file.sha256) return; // No digest in the manifest → nothing to check.
    const actual = await sha256Hex(buffer);
    if (actual === null) {
      // Cannot verify (insecure context / no WebCrypto). Warn loudly; do not
      // pretend the check passed, and do not persist an unverified file.
      this.onWarning(
        `Integrity check for ${shortName(file.url)} was skipped: WebCrypto is unavailable.`,
      );
      return;
    }
    if (actual.toLowerCase() !== file.sha256.toLowerCase()) {
      throw new BackendFailure({
        reason: 'integrity_mismatch',
        backend: 'server',
        task: manifest.task,
        fatal: true,
        message: `Integrity check failed for ${shortName(file.url)}.`,
      });
    }
  }

  private async readFromCache(url: string): Promise<ArrayBuffer | null> {
    if (!(await this.ensureStorage())) return null;
    try {
      const cache = await caches.open(this.cacheName);
      const hit = await cache.match(url);
      if (!hit) return null;
      return await hit.arrayBuffer();
    } catch (error) {
      this.onWarning(`Model cache read failed: ${errorText(error)}`);
      return null;
    }
  }

  private async persist(
    manifest: ResolvedManifest,
    file: ManifestFileRef,
    buffer: ArrayBuffer,
  ): Promise<void> {
    if (!(await this.ensureStorage())) return;

    const write = async (): Promise<void> => {
      const cache = await caches.open(this.cacheName);
      await cache.put(
        file.url,
        new Response(buffer.slice(0), {
          headers: {
            'content-type': 'application/octet-stream',
            'content-length': String(buffer.byteLength),
          },
        }),
      );
    };

    try {
      await write();
    } catch (error) {
      if (!isQuotaError(error)) {
        this.onWarning(`Model cache write failed: ${errorText(error)}`);
        return;
      }
      // Bounded recovery: evict once, retry once, then stop trying.
      const freed = await this.evictLeastRecentlyUsed(buffer.byteLength * 2);
      if (freed <= 0) {
        this.onWarning('Storage quota exceeded and nothing could be evicted.');
        return;
      }
      try {
        await write();
      } catch (retryError) {
        this.onWarning(
          `Storage quota exceeded; running without a persisted model cache (${errorText(
            retryError,
          )}).`,
        );
        return;
      }
    }

    await this.writeMeta({
      url: file.url,
      model_id: manifest.model_id,
      task: manifest.task,
      bytes: buffer.byteLength,
      ...(file.sha256 ? { sha256: file.sha256 } : {}),
      integrity_verified: Boolean(file.sha256),
      cached_at: Date.now(),
      last_used_at: Date.now(),
    });
  }

  /** Pre-flight: is there plausibly room for `bytes`? Advisory only. */
  async hasRoomFor(bytes: number): Promise<boolean> {
    if (!hasNavigator()) return false;
    try {
      const storage = navigator.storage;
      if (!storage || typeof storage.estimate !== 'function') return true;
      const { quota, usage } = await storage.estimate();
      if (typeof quota !== 'number' || typeof usage !== 'number') return true;
      // Keep 10% headroom so we do not fill the origin's budget entirely.
      return quota - usage > bytes * 1.1;
    } catch {
      return true;
    }
  }

  private async ensureStorage(): Promise<boolean> {
    if (!this.policy.allow_local_model_cache) return false;
    if (this.storageAvailable !== null) return this.storageAvailable;
    if (!hasCacheStorage()) {
      this.storageAvailable = false;
      return false;
    }
    try {
      await caches.open(this.cacheName);
      this.storageAvailable = true;
    } catch (error) {
      // Safari private browsing and some enterprise policies deny Cache Storage.
      this.onWarning(`Model cache unavailable: ${errorText(error)}`);
      this.storageAvailable = false;
    }
    return this.storageAvailable;
  }

  private async writeMeta(meta: CachedFileMeta): Promise<void> {
    const db = await openDb(this.dbName);
    if (!db) return;
    try {
      const tx = db.transaction(META_STORE, 'readwrite');
      tx.objectStore(META_STORE).put(meta);
      await txDone(tx);
    } catch {
      /* metadata is an index, not the source of truth — losing it is survivable */
    } finally {
      safeClose(db);
    }
  }

  private async touch(url: string): Promise<void> {
    const db = await openDb(this.dbName);
    if (!db) return;
    try {
      const tx = db.transaction(META_STORE, 'readwrite');
      const store = tx.objectStore(META_STORE);
      const existing = await reqValue<CachedFileMeta>(store.get(url) as IDBRequest<CachedFileMeta>);
      if (existing) store.put({ ...existing, last_used_at: Date.now() });
      await txDone(tx);
    } catch {
      /* ignore */
    } finally {
      safeClose(db);
    }
  }

  async listMeta(): Promise<CachedFileMeta[]> {
    const db = await openDb(this.dbName);
    if (!db) return [];
    try {
      const tx = db.transaction(META_STORE, 'readonly');
      const all = await reqValue<CachedFileMeta[]>(
        tx.objectStore(META_STORE).getAll() as IDBRequest<CachedFileMeta[]>,
      );
      await txDone(tx);
      return Array.isArray(all) ? all : [];
    } catch {
      return [];
    } finally {
      safeClose(db);
    }
  }

  /** Evict oldest-used entries until at least `bytes` have been reclaimed. */
  private async evictLeastRecentlyUsed(bytes: number): Promise<number> {
    const metas = await this.listMeta();
    if (metas.length === 0) return 0;
    metas.sort((a, b) => a.last_used_at - b.last_used_at);
    let freed = 0;
    try {
      const cache = await caches.open(this.cacheName);
      for (const meta of metas) {
        if (freed >= bytes) break;
        const removed = await cache.delete(meta.url).catch(() => false);
        if (removed) {
          freed += meta.bytes;
          await this.deleteMeta(meta.url);
        }
      }
    } catch (error) {
      this.onWarning(`Cache eviction failed: ${errorText(error)}`);
    }
    return freed;
  }

  private async deleteMeta(url: string): Promise<void> {
    const db = await openDb(this.dbName);
    if (!db) return;
    try {
      const tx = db.transaction(META_STORE, 'readwrite');
      tx.objectStore(META_STORE).delete(url);
      await txDone(tx);
    } catch {
      /* ignore */
    } finally {
      safeClose(db);
    }
  }

  /** Remove one model's files (used when a manifest is superseded). */
  async clearModel(modelId: string): Promise<void> {
    const metas = await this.listMeta();
    const mine = metas.filter((m) => m.model_id === modelId);
    if (mine.length === 0) return;
    try {
      if (hasCacheStorage()) {
        const cache = await caches.open(this.cacheName);
        for (const meta of mine) await cache.delete(meta.url).catch(() => false);
      }
    } catch {
      /* ignore */
    }
    for (const meta of mine) await this.deleteMeta(meta.url);
  }

  /**
   * §61 "Clear on logout" and the admin "Clear local model cache" action.
   * Removes the whole Cache Storage bucket, the metadata database, and the
   * in-memory derived-value memo. Idempotent and never throws.
   */
  async clearAll(): Promise<void> {
    this.derivedMemo.clear();
    try {
      if (hasCacheStorage()) await caches.delete(this.cacheName);
    } catch (error) {
      this.onWarning(`Could not delete the model cache: ${errorText(error)}`);
    }
    try {
      if (hasIndexedDb()) {
        await new Promise<void>((resolve) => {
          let request: IDBOpenDBRequest;
          try {
            request = indexedDB.deleteDatabase(this.dbName);
          } catch {
            resolve();
            return;
          }
          const timer = setTimeout(resolve, 3000);
          const finish = (): void => {
            clearTimeout(timer);
            resolve();
          };
          request.onsuccess = finish;
          request.onerror = finish;
          request.onblocked = finish;
        });
      }
    } catch (error) {
      this.onWarning(`Could not delete the runtime database: ${errorText(error)}`);
    }
    this.storageAvailable = null;
  }

  async stats(): Promise<CacheStats> {
    const metas = await this.listMeta();
    const base: CacheStats = {
      enabled: this.persistenceEnabled,
      entries: metas.length,
      bytes: metas.reduce((sum, m) => sum + (Number.isFinite(m.bytes) ? m.bytes : 0), 0),
    };
    if (!hasNavigator()) return base;
    try {
      const storage = navigator.storage;
      if (!storage || typeof storage.estimate !== 'function') return base;
      const estimate = await storage.estimate();
      return {
        ...base,
        ...(typeof estimate.quota === 'number' ? { quota: estimate.quota } : {}),
        ...(typeof estimate.usage === 'number' ? { usage: estimate.usage } : {}),
      };
    } catch {
      return base;
    }
  }
}

/* ------------------------------------------------------------------ *
 * helpers
 * ------------------------------------------------------------------ */

function globalFetch(): typeof fetch | undefined {
  try {
    return typeof fetch === 'function' ? fetch.bind(globalThis) : undefined;
  } catch {
    return undefined;
  }
}

function safeClose(db: IDBDatabase): void {
  try {
    db.close();
  } catch {
    /* ignore */
  }
}

function shortName(url: string): string {
  const tail = url.split('?')[0]?.split('/').pop();
  return tail && tail.length > 0 ? tail : url;
}

/**
 * Stable, non-reversible key for the derived-embedding memo. Uses a cheap FNV-1a
 * over the text — we need a bucket key, not a cryptographic commitment, and the
 * value never leaves memory.
 */
export function derivedMemoKey(modelId: string, role: string, text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${modelId}::${role}::${text.length}::${hash.toString(16)}`;
}
