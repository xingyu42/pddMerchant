import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validateScrapedData } from '../adapter/goods-publish/source-scraper.js';
import {
  buildSkuPreviewPlan,
  normalizeSourceSkuSnapshot,
} from '../adapter/goods-publish/source-sku-normalizer.js';
import { normalizeSourceGoodsProperties } from '../adapter/goods-publish/property-mapper.js';
import { GOODS_PUBLISH_SOURCE_CACHE_DIR } from '../infra/paths.js';

const CACHE_VERSION = 4;
const GOODS_ID_RE = /^\d+$/;

function cacheError(code, reason) {
  const error = new Error(`goods-publish source cache invalid: ${reason}`);
  error.code = code;
  return error;
}

function normalizeGoodsId(goodsId) {
  const normalized = String(goodsId ?? '').trim();
  if (!GOODS_ID_RE.test(normalized)) {
    throw cacheError('E_SOURCE_CACHE_KEY', 'goods_id must contain digits only');
  }
  return normalized;
}

function assertScalar(value, field, { required = false } = {}) {
  if (value == null || value === '') {
    if (required) throw cacheError('E_SOURCE_CACHE_INVALID', `${field} is required`);
    return;
  }
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw cacheError('E_SOURCE_CACHE_INVALID', `${field} must be a string or number`);
  }
}

function assertStringArray(value, field, { required = false } = {}) {
  if (!Array.isArray(value)) {
    throw cacheError('E_SOURCE_CACHE_INVALID', `${field} must be an array`);
  }
  if (required && value.length === 0) {
    throw cacheError('E_SOURCE_CACHE_INVALID', `${field} must not be empty`);
  }
  if (value.some((item) => typeof item !== 'string' || item.trim() === '')) {
    throw cacheError('E_SOURCE_CACHE_INVALID', `${field} must contain non-empty strings`);
  }
}

function normalizeSource(goodsId, source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw cacheError('E_SOURCE_CACHE_INVALID', 'source must be an object');
  }

  const skuSnapshot = normalizeSourceSkuSnapshot(source);
  if (!skuSnapshot.complete) {
    throw cacheError('E_SOURCE_CACHE_INVALID', `structured SKU data is incomplete: ${skuSnapshot.issues.join(',')}`);
  }
  const skuPreviewPlan = buildSkuPreviewPlan(skuSnapshot);
  if (!skuPreviewPlan.ok) {
    throw cacheError('E_SOURCE_CACHE_INVALID', `SKU preview mapping is incomplete: ${skuPreviewPlan.issues.join(',')}`);
  }
  const goodsProperties = normalizeSourceGoodsProperties(source.goodsProperties ?? source.goodsProperty);
  if (goodsProperties.length === 0) {
    throw cacheError('E_SOURCE_CACHE_INVALID', 'structured goods properties are required');
  }

  const normalized = {
    goodsID: source.goodsID == null ? goodsId : String(source.goodsID),
    goodsName: source.goodsName,
    catID: source.catID ?? null,
    catID1: source.catID1 ?? null,
    catID2: source.catID2 ?? null,
    catID3: source.catID3 ?? null,
    price: source.price ?? null,
    sourceReferencePriceCents: skuSnapshot.sourceReferencePriceCents,
    carousel: Array.isArray(source.carousel) ? [...source.carousel] : source.carousel,
    skuText: source.skuText ?? '',
    skuDimensions: skuSnapshot.skuDimensions,
    skus: skuSnapshot.skus,
    goodsProperties,
    properties: source.properties ?? '',
    detailImgs: source.detailImgs === undefined
      ? []
      : (Array.isArray(source.detailImgs) ? [...source.detailImgs] : source.detailImgs),
  };

  if (normalized.goodsID !== goodsId) {
    throw cacheError('E_SOURCE_CACHE_INVALID', 'source goodsID does not match cache key');
  }
  if (typeof normalized.goodsName !== 'string' || normalized.goodsName.trim() === '') {
    throw cacheError('E_SOURCE_CACHE_INVALID', 'goodsName is required');
  }
  assertScalar(normalized.catID, 'catID');
  assertScalar(normalized.catID1, 'catID1');
  assertScalar(normalized.catID2, 'catID2');
  assertScalar(normalized.catID3, 'catID3');
  assertScalar(normalized.price, 'price');
  assertStringArray(normalized.carousel, 'carousel', { required: true });
  assertStringArray(normalized.detailImgs, 'detailImgs');
  if (typeof normalized.skuText !== 'string') {
    throw cacheError('E_SOURCE_CACHE_INVALID', 'skuText must be a string');
  }
  if (typeof normalized.properties !== 'string') {
    throw cacheError('E_SOURCE_CACHE_INVALID', 'properties must be a string');
  }

  try {
    validateScrapedData(normalized);
  } catch (err) {
    const detail = err?.message ? `: ${err.message}` : '';
    const wrapped = cacheError('E_SOURCE_CACHE_INVALID', `source validation failed${detail}`);
    wrapped.cause = err;
    throw wrapped;
  }
  return normalized;
}

function cachePath(cacheDir, goodsId) {
  return join(cacheDir, `${normalizeGoodsId(goodsId)}.json`);
}

export function createSourceGoodsCache({ cacheDir = GOODS_PUBLISH_SOURCE_CACHE_DIR } = {}) {
  return {
    async read(goodsId) {
      const normalizedId = normalizeGoodsId(goodsId);
      let raw;
      try {
        raw = await readFile(cachePath(cacheDir, normalizedId), 'utf8');
      } catch (error) {
        if (error?.code === 'ENOENT') return null;
        throw error;
      }

      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        throw cacheError('E_SOURCE_CACHE_INVALID', 'file is not valid JSON');
      }
      if (payload?.version !== CACHE_VERSION || String(payload?.goods_id ?? '') !== normalizedId) {
        throw cacheError('E_SOURCE_CACHE_INVALID', 'version or goods_id mismatch');
      }
      return normalizeSource(normalizedId, payload.source);
    },

    async write(goodsId, source) {
      const normalizedId = normalizeGoodsId(goodsId);
      const normalizedSource = normalizeSource(normalizedId, source);
      const targetPath = cachePath(cacheDir, normalizedId);
      const temporaryPath = join(cacheDir, `.${normalizedId}.${process.pid}.${randomUUID()}.tmp`);
      const payload = {
        version: CACHE_VERSION,
        goods_id: normalizedId,
        cached_at: new Date().toISOString(),
        source: normalizedSource,
      };

      await mkdir(cacheDir, { recursive: true });
      let renamed = false;
      try {
        await writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, {
          encoding: 'utf8',
          mode: 0o600,
        });
        await rename(temporaryPath, targetPath);
        renamed = true;
        return true;
      } finally {
        if (!renamed) await rm(temporaryPath, { force: true }).catch(() => {});
      }
    },

    async remove(goodsId) {
      try {
        await unlink(cachePath(cacheDir, goodsId));
        return true;
      } catch (error) {
        if (error?.code === 'ENOENT') return false;
        throw error;
      }
    },
  };
}

export const defaultSourceGoodsCache = createSourceGoodsCache();

export { CACHE_VERSION };
