import { createHash } from 'node:crypto';

const WINDOWS_RESERVED = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

export const SAFE_STORAGE_SLUG_RE = /^[a-z0-9一-鿿_-]{1,32}$/;

export function slugifyStorageName(displayName, {
  existingSlugs,
  stableId,
  fallback = 'account',
} = {}) {
  let slug = String(displayName ?? '').normalize('NFKC').toLowerCase();
  slug = slug.replace(/[^a-z0-9一-鿿_-]/g, '-');
  slug = slug.replace(/[-_]{2,}/g, '-');
  slug = slug.replace(/^[-_]+|[-_]+$/g, '');
  slug = slug.slice(0, 32);
  if (!slug) slug = fallback;
  if (WINDOWS_RESERVED.has(slug)) slug = `_${slug}`;
  if (existingSlugs instanceof Set && existingSlugs.has(slug)) {
    const hash = createHash('sha256')
      .update(`${displayName ?? ''}:${stableId ?? ''}`)
      .digest('hex')
      .slice(0, 6);
    slug = `${slug.slice(0, 25)}-${hash}`;
  }
  return slug;
}
