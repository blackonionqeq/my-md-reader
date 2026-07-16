import { IMAGE_CACHE_NAME, IMAGE_CACHE_PREFIX } from './image-cache-contract';

export { IMAGE_CACHE_NAME } from './image-cache-contract';

const IMAGE_MIME_TYPES_BY_EXTENSION = new Map([
  ['avif', 'image/avif'],
  ['bmp', 'image/bmp'],
  ['gif', 'image/gif'],
  ['heic', 'image/heic'],
  ['heif', 'image/heif'],
  ['ico', 'image/x-icon'],
  ['jpeg', 'image/jpeg'],
  ['jpg', 'image/jpeg'],
  ['png', 'image/png'],
  ['svg', 'image/svg+xml'],
  ['tif', 'image/tiff'],
  ['tiff', 'image/tiff'],
  ['webp', 'image/webp']
]);

function requireCacheStorage(): CacheStorage {
  if (!('caches' in globalThis) || !globalThis.caches) {
    throw new Error('Cache API is unavailable.');
  }

  return globalThis.caches;
}

export function normalizeImageMimeType(value: string | undefined): string | undefined {
  const mimeType = value?.split(';', 1)[0]?.trim().toLowerCase();
  return mimeType?.startsWith('image/') ? mimeType : undefined;
}

export function inferImageMimeType(url: string): string | undefined {
  try {
    const pathname = new URL(url).pathname;
    const extension = pathname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
    return extension ? IMAGE_MIME_TYPES_BY_EXTENSION.get(extension) : undefined;
  } catch {
    return undefined;
  }
}

export function createImageRequest(url: string): Request {
  const parsed = new URL(url);
  const currentOrigin = globalThis.location?.origin;
  const crossOrigin = Boolean(currentOrigin && parsed.origin !== currentOrigin);
  return new Request(parsed.toString(), crossOrigin ? { mode: 'no-cors' } : undefined);
}

export function isCacheableImageResponse(response: Response): boolean {
  if (response.type === 'opaqueredirect') {
    return false;
  }

  return response.status === 200 || (response.type === 'opaque' && response.status === 0);
}

export async function matchCachedImage(url: string): Promise<Response | undefined> {
  const cache = await requireCacheStorage().open(IMAGE_CACHE_NAME);
  return cache.match(url);
}

export async function putImageResponse(url: string, response: Response): Promise<Response> {
  if (!isCacheableImageResponse(response)) {
    throw new Error(`Image response is not cacheable (status ${response.status}, type ${response.type}).`);
  }

  const cache = await requireCacheStorage().open(IMAGE_CACHE_NAME);
  await cache.put(url, response.clone());
  const verified = await cache.match(url);
  if (!verified) {
    throw new Error('Image cache verification failed after write.');
  }

  return verified;
}

export async function fetchAndCacheImage(url: string): Promise<Response> {
  const response = await fetch(createImageRequest(url));
  await putImageResponse(url, response);
  return response;
}

export async function migrateLegacyBlobToImageCache(input: {
  url: string;
  blob: Blob;
  mimeType?: string;
}): Promise<Response> {
  const bytes = await input.blob.arrayBuffer();
  const mimeType = normalizeImageMimeType(input.mimeType)
    ?? normalizeImageMimeType(input.blob.type)
    ?? inferImageMimeType(input.url);
  const headers = mimeType ? { 'content-type': mimeType } : undefined;
  const response = new Response(bytes, { status: 200, headers });
  return putImageResponse(input.url, response);
}

export async function deleteCachedImage(url: string): Promise<boolean> {
  if (!('caches' in globalThis) || !globalThis.caches) {
    return false;
  }

  const cache = await globalThis.caches.open(IMAGE_CACHE_NAME);
  return cache.delete(url);
}

export async function deleteImageCache(): Promise<boolean> {
  if (!('caches' in globalThis) || !globalThis.caches) {
    return false;
  }

  return globalThis.caches.delete(IMAGE_CACHE_NAME);
}

export async function deleteObsoleteImageCaches(): Promise<string[]> {
  if (!('caches' in globalThis) || !globalThis.caches) {
    return [];
  }

  const names = await globalThis.caches.keys();
  const obsolete = names.filter((name) => name.startsWith(IMAGE_CACHE_PREFIX) && name !== IMAGE_CACHE_NAME);
  const deleted: string[] = [];
  for (const name of obsolete) {
    if (await globalThis.caches.delete(name)) {
      deleted.push(name);
    }
  }
  return deleted;
}

export async function reconcileImageCache(referencedUrls: ReadonlySet<string>): Promise<string[]> {
  if (!('caches' in globalThis) || !globalThis.caches) {
    return [];
  }

  const cache = await globalThis.caches.open(IMAGE_CACHE_NAME);
  const keys = await cache.keys();
  const deleted: string[] = [];
  for (const request of keys) {
    if (!referencedUrls.has(request.url) && await cache.delete(request)) {
      deleted.push(request.url);
    }
  }
  return deleted;
}

export function isServiceWorkerControllingPage(): boolean {
  return typeof navigator !== 'undefined'
    && 'serviceWorker' in navigator
    && Boolean(navigator.serviceWorker.controller);
}
