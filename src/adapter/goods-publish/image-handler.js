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

function isUploadCompletionResponse(response) {
  try {
    const { hostname, pathname } = new URL(response.url());
    const isCompletionPath = pathname.includes('upload_complete')
      || (hostname === 'file.pinduoduo.com' && pathname === '/v3/store_image');
    const status = typeof response.status === 'function' ? response.status() : 200;
    return isCompletionPath && status >= 200 && status < 300;
  } catch {
    return false;
  }
}

function waitForDistinctUploadResponses(page, count) {
  // 同一次批量上传的每个 waiter 必须认领不同响应，否则第一条完成响应会被
  // 所有 waiter 同时消费，尚未完成的图片也会被误报为成功。
  const seenResponses = new WeakSet();
  return Array.from({ length: count }, () =>
    page.waitForResponse((response) => {
      if (!isUploadCompletionResponse(response) || seenResponses.has(response)) return false;
      seenResponses.add(response);
      return true;
    }, { timeout: 30000 })
  );
}

export async function uploadCarouselImages(page, filePaths) {
  const uploadPromises = waitForDistinctUploadResponses(page, filePaths.length);
  const fileInput = page.locator('input[type="file"][accept*="image"]').first();
  await fileInput.setInputFiles(filePaths);

  const responses = await Promise.all(uploadPromises);
  return extractUploadedUrls(responses);
}

export async function uploadDetailImages(page, filePaths) {
  const fileInputs = page.locator('input[type="file"][accept*="image"]');
  const inputCount = await fileInputs.count();
  // 详情图位于“快捷编辑”区域。不能再按全页第 8 个文件输入框定位：
  // 多 SKU 表格会为每行增加预览图输入框，使全页索引随规格数量变化。
  const detailInputs = page.locator(
    '[class*="quick_decoration"] input[type="file"][accept*="image"]',
  );
  const detailInputCount = await detailInputs.count();
  if (detailInputCount !== 1) {
    throw new PddCliError({
      code: 'E_BUSINESS',
      message: '详情图上传区域未找到',
      hint: '商家后台表单结构可能已变化，已停止保存以避免把图片上传到错误区域',
      detail: {
        image_file_input_count: inputCount,
        detail_image_input_count: detailInputCount,
      },
      exitCode: ExitCodes.BUSINESS,
    });
  }

  const uploadPromises = waitForDistinctUploadResponses(page, filePaths.length);
  const detailInput = detailInputs.first();
  await detailInput.setInputFiles(filePaths);

  const settled = await Promise.allSettled(uploadPromises);
  const responses = settled.filter((item) => item.status === 'fulfilled').map((item) => item.value);
  const uploadedUrls = await extractUploadedUrls(responses);
  const completed = responses.length;
  if (completed === 0) {
    throw new PddCliError({
      code: 'E_BUSINESS',
      message: '详情图全部上传失败',
      hint: '未确认任何上传完成响应，已停止保存草稿',
      detail: { requested: filePaths.length, completed: 0 },
      exitCode: ExitCodes.BUSINESS,
    });
  }
  return {
    uploadedUrls,
    requested: filePaths.length,
    completed,
    warnings: completed < filePaths.length ? ['detail_image_upload_partial'] : [],
  };
}
