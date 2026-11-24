import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GOODS_PUBLISH_SOURCE_CACHE_DIR } from '../infra/paths.js';
import {
  normalizeCacheGoodsId,
  parseSourceCachePayload,
  serializeSourceCachePayload,
} from './goods-publish/source-normalizer.js';

function cachePath(cacheDir, goodsId) {
  return join(cacheDir, `${normalizeCacheGoodsId(goodsId)}.json`);
}

export function createSourceGoodsCache({ cacheDir = GOODS_PUBLISH_SOURCE_CACHE_DIR } = {}) {
  return {
    async read(goodsId) {
      const normalizedId = normalizeCacheGoodsId(goodsId);
      let raw;
      try {
        raw = await readFile(cachePath(cacheDir, normalizedId), 'utf8');
      } catch (error) {
        if (error?.code === 'ENOENT') return null;
        throw error;
      }
      return parseSourceCachePayload(normalizedId, raw);
    },

    async write(goodsId, source) {
      const normalizedId = normalizeCacheGoodsId(goodsId);
      const serialized = serializeSourceCachePayload(normalizedId, source);
      const targetPath = cachePath(cacheDir, normalizedId);
      const temporaryPath = join(cacheDir, `.${normalizedId}.${process.pid}.${randomUUID()}.tmp`);

      await mkdir(cacheDir, { recursive: true });
      let renamed = false;
      try {
        await writeFile(temporaryPath, serialized, {
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
