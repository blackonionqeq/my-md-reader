import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createImageRequest,
  deleteCachedImage,
  deleteObsoleteImageCaches,
  fetchAndCacheImage,
  IMAGE_CACHE_NAME,
  isCacheableImageResponse,
  migrateLegacyBlobToImageCache,
  putImageResponse,
  reconcileImageCache
} from './image-cache';

class MemoryCache {
  entries = new Map<string, Response>();
  dropWrites = false;

  private key(input: RequestInfo | URL): string {
    return input instanceof Request ? input.url : new URL(String(input), location.href).toString();
  }

  async match(input: RequestInfo | URL): Promise<Response | undefined> {
    return this.entries.get(this.key(input));
  }

  async put(input: RequestInfo | URL, response: Response): Promise<void> {
    if (!this.dropWrites) {
      this.entries.set(this.key(input), response);
    }
  }

  async delete(input: RequestInfo | URL): Promise<boolean> {
    return this.entries.delete(this.key(input));
  }

  async keys(): Promise<Request[]> {
    return Array.from(this.entries.keys(), (url) => new Request(url));
  }
}

class MemoryCacheStorage {
  caches = new Map<string, MemoryCache>();

  async open(name: string): Promise<Cache> {
    let cache = this.caches.get(name);
    if (!cache) {
      cache = new MemoryCache();
      this.caches.set(name, cache);
    }
    return cache as unknown as Cache;
  }

  async delete(name: string): Promise<boolean> {
    return this.caches.delete(name);
  }

  async keys(): Promise<string[]> {
    return Array.from(this.caches.keys());
  }
}

let cacheStorage: MemoryCacheStorage;

beforeEach(() => {
  cacheStorage = new MemoryCacheStorage();
  Object.defineProperty(globalThis, 'caches', {
    configurable: true,
    value: cacheStorage as unknown as CacheStorage
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(globalThis, 'caches');
});

describe('image request and response contract', () => {
  it('uses a normal request for same-origin images and no-cors for cross-origin images', () => {
    expect(createImageRequest(`${location.origin}/cover.png`).mode).toBe('cors');
    expect(createImageRequest('https://cdn.reader.test/cover.png').mode).toBe('no-cors');
  });

  it('accepts 200 and opaque status 0 responses but rejects redirects and errors', () => {
    const opaque = new Response('opaque');
    Object.defineProperties(opaque, {
      status: { configurable: true, value: 0 },
      type: { configurable: true, value: 'opaque' }
    });
    const opaqueRedirect = new Response(null, { status: 200 });
    Object.defineProperty(opaqueRedirect, 'type', { configurable: true, value: 'opaqueredirect' });

    expect(isCacheableImageResponse(new Response('ok', { status: 200 }))).toBe(true);
    expect(isCacheableImageResponse(opaque)).toBe(true);
    expect(isCacheableImageResponse(opaqueRedirect)).toBe(false);
    expect(isCacheableImageResponse(new Response('missing', { status: 404 }))).toBe(false);
  });

  it('fetches cross-origin images with no-cors and verifies the cache write', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('image', { status: 200 }));
    await fetchAndCacheImage('https://cdn.reader.test/cover.png');

    expect(fetchMock).toHaveBeenCalledOnce();
    expect((fetchMock.mock.calls[0]?.[0] as Request).mode).toBe('no-cors');
    const cache = cacheStorage.caches.get(IMAGE_CACHE_NAME)!;
    expect(await cache.match('https://cdn.reader.test/cover.png')).toBeDefined();
  });

  it('rejects a write when cache.match cannot verify it', async () => {
    const cache = await cacheStorage.open(IMAGE_CACHE_NAME) as unknown as MemoryCache;
    cache.dropWrites = true;
    await expect(putImageResponse('https://reader.test/missing.png', new Response('image')))
      .rejects.toThrow('verification failed');
  });
});

describe('legacy migration and cleanup', () => {
  it('rebuilds a legacy blob response with a normalized image MIME type', async () => {
    const cached = await migrateLegacyBlobToImageCache({
      url: 'https://reader.test/cover.bin',
      blob: new NodeBlob(['legacy-image'], { type: 'application/octet-stream' }) as Blob,
      mimeType: 'image/png; charset=binary'
    });

    expect(cached.headers.get('content-type')).toBe('image/png');
    expect(await cached.text()).toBe('legacy-image');
  });

  it('deletes individual, unreferenced, and obsolete cache entries', async () => {
    const current = await cacheStorage.open(IMAGE_CACHE_NAME) as unknown as MemoryCache;
    await current.put('https://reader.test/keep.png', new Response('keep'));
    await current.put('https://reader.test/drop.png', new Response('drop'));
    await current.put('https://reader.test/delete.png', new Response('delete'));
    await cacheStorage.open('md-reader-images-v0');

    expect(await deleteCachedImage('https://reader.test/delete.png')).toBe(true);
    expect(await reconcileImageCache(new Set(['https://reader.test/keep.png']))).toEqual([
      'https://reader.test/drop.png'
    ]);
    expect(await deleteObsoleteImageCaches()).toEqual(['md-reader-images-v0']);
    expect(await cacheStorage.keys()).toEqual([IMAGE_CACHE_NAME]);
  });
});
