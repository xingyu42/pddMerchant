import { mkdirSync, rmSync, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { PddCliError, ExitCodes } from '../../infra/errors.js';

const ALLOWED_DOMAIN = 'pddpic.com';

function isAllowedUrl(urlStr) {
  try {
    const { hostname } = new URL(urlStr);
    return hostname === ALLOWED_DOMAIN || hostname.endsWith(`.${ALLOWED_DOMAIN}`);
  } catch {
    return false;
  }
}

export async function downloadImagesToTemp(urls) {
  const warnings = [];
  const tmpDir = join(tmpdir(), `pdd-img-${randomUUID().slice(0, 8)}`);
  mkdirSync(tmpDir, { recursive: true });

  const filePaths = [];

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];

    if (!isAllowedUrl(url)) {
      warnings.push(`跳过非白名单图片 URL: ${url}`);
      continue;
    }

    const destPath = join(tmpDir, `${i}.jpg`);
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await pipeline(Readable.fromWeb(response.body), createWriteStream(destPath));
      filePaths.push(destPath);
    } catch {
      warnings.push(`图片下载失败，已跳过: ${url}`);
    }
  }

  return {
    filePaths,
    tmpDir,
    warnings,
    cleanup() {
      rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

async function extractUploadedUrls(responses) {
  const urls = [];
  for (const resp of responses) {
    try {
      const json = await resp.json();
      const url = json?.img_url ?? json?.result?.img_url ?? '';
      if (url) urls.push(url);
    } catch { /* ignore parse failures */ }
  }
  return urls;
}

export async function uploadCarouselImages(page, filePaths) {
  const uploadPromises = filePaths.map(() =>
    page.waitForResponse(r => r.url().includes('upload_complete'), { timeout: 30000 })
  );
  const fileInput = page.locator('input[type="file"][accept*="image"]').first();
  await fileInput.setInputFiles(filePaths);

  const responses = await Promise.all(uploadPromises);
  return extractUploadedUrls(responses);
}

export async function uploadDetailImages(page, filePaths) {
  const uploadPromises = filePaths.map(() =>
    page.waitForResponse(r => r.url().includes('upload_complete'), { timeout: 30000 })
  );
  const fileInputs = page.locator('input[type="file"][accept*="image"]');
  const detailInput = fileInputs.nth(7);
  await detailInput.setInputFiles(filePaths);

  const responses = await Promise.all(uploadPromises);
  return extractUploadedUrls(responses);
}
