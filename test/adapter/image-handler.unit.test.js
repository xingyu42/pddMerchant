import { describe, expect, it } from 'vitest';
import {
  uploadCarouselImages,
  uploadDetailImages,
  uploadSkuPreviewImages,
} from '../../src/adapter/goods-publish/image-handler.js';

function response(url, status = 200) {
  return { url: () => url, status: () => status, json: async () => ({ img_url: url }) };
}

describe('uploadDetailImages', () => {
  it('waits for a distinct completion response for every file', async () => {
    const responses = [
      response('https://file.pinduoduo.com/v3/store_image'),
      response('https://file.pinduoduo.com/v3/store_image'),
    ];
    const claimed = [];
    const page = {
      waitForResponse: async (predicate) => {
        const match = responses.find((item) => predicate(item));
        if (!match) throw new Error('timeout');
        claimed.push(match);
        return match;
      },
      locator: (selector) => selector.startsWith('[class*="quick_decoration"]')
        ? {
            count: async () => 1,
            first: () => ({ setInputFiles: async () => {} }),
          }
        : { count: async () => 26 },
    };

    const result = await uploadDetailImages(page, ['a.jpg', 'b.jpg']);
    expect(claimed).toHaveLength(2);
    expect(new Set(claimed).size).toBe(2);
    expect(result).toMatchObject({ requested: 2, completed: 2, warnings: [] });
  });

  it('does not count a failed store-image response as completed', async () => {
    const failed = response('https://file.pinduoduo.com/v3/store_image', 500);
    const page = {
      waitForResponse: async (predicate) => {
        if (predicate(failed)) return failed;
        throw new Error('timeout');
      },
      locator: (selector) => selector.startsWith('[class*="quick_decoration"]')
        ? {
            count: async () => 1,
            first: () => ({ setInputFiles: async () => {} }),
          }
        : { count: async () => 2 },
    };

    await expect(uploadDetailImages(page, ['a.jpg'])).rejects.toMatchObject({
      code: 'E_BUSINESS',
      detail: { requested: 1, completed: 0 },
    });
  });

  it('accepts current store-image responses and keeps carousel responses distinct', async () => {
    const responses = [
      response('https://file.pinduoduo.com/v3/store_image'),
      response('https://file.pinduoduo.com/v3/store_image'),
    ];
    const claimed = [];
    const page = {
      waitForResponse: async (predicate) => {
        const match = responses.find((item) => predicate(item));
        if (!match) throw new Error('timeout');
        claimed.push(match);
        return match;
      },
      locator: () => ({
        first: () => ({ setInputFiles: async () => {} }),
      }),
    };

    await uploadCarouselImages(page, ['a.jpg', 'b.jpg']);
    expect(claimed).toHaveLength(2);
    expect(new Set(claimed).size).toBe(2);
  });

  it('fails before setting files when the detail input is absent', async () => {
    let setFiles = 0;
    const page = {
      locator: (selector) => selector.startsWith('[class*="quick_decoration"]')
        ? {
            count: async () => 0,
            first: () => ({ setInputFiles: async () => { setFiles += 1; } }),
          }
        : { count: async () => 26 },
    };
    await expect(uploadDetailImages(page, ['a.jpg'])).rejects.toMatchObject({
      code: 'E_BUSINESS',
      detail: { image_file_input_count: 26, detail_image_input_count: 0 },
    });
    expect(setFiles).toBe(0);
  });
});

function skuPreviewPage(colors, { previewVisible = true, duplicateColor = null } = {}) {
  const uploads = [];
  const rows = colors.map((color) => ({ color, uploaded: false }));
  if (duplicateColor) rows.push({ color: duplicateColor, uploaded: false });
  const responses = colors.filter(Boolean).map((color) => response(
    'https://file.pinduoduo.com/v3/store_image',
    200,
    color,
  ));
  let responseIndex = 0;
  return {
    uploads,
    page: {
      waitForResponse: async (predicate) => {
        const candidate = responses[responseIndex++];
        if (!candidate || !predicate(candidate)) throw new Error('timeout');
        candidate.json = async () => ({ url: `https://img.pddpic.com/uploaded-${responseIndex}.jpg` });
        return candidate;
      },
      locator: (selector) => {
        if (selector !== '.goods-sku-row.standard-spec .new-spec-single-color') {
          throw new Error(`unexpected selector: ${selector}`);
        }
        return {
          count: async () => rows.length,
          nth: (rowIndex) => ({
            locator: (innerSelector) => {
              if (innerSelector === 'input[placeholder="选择或输入主色"]') return {
                count: async () => 1,
                first: () => ({ inputValue: async () => rows[rowIndex].color }),
              };
              if (innerSelector === 'input[type="file"][accept*="image"]') return {
                count: async () => 1,
                first: () => ({
                  setInputFiles: async (filePath) => {
                    uploads.push([rows[rowIndex].color, filePath]);
                    rows[rowIndex].uploaded = true;
                  },
                }),
              };
              if (innerSelector === 'img[src], [style*="background-image"]') return {
                count: async () => rows[rowIndex].uploaded && previewVisible ? 1 : 0,
              };
              throw new Error(`unexpected inner selector: ${innerSelector}`);
            },
          }),
        };
      },
    },
  };
}

describe('uploadSkuPreviewImages', () => {
  const plan = [
    { merchantColor: '灰色', sourceImageUrl: 'https://img.pddpic.com/gray.jpg' },
    { merchantColor: '蓝色', sourceImageUrl: 'https://img.pddpic.com/blue.jpg' },
    { merchantColor: '黄色', sourceImageUrl: 'https://img.pddpic.com/yellow.jpg' },
  ];
  const completeDownload = async () => ({
    filePaths: ['gray.jpg', 'blue.jpg', 'yellow.jpg'],
    warnings: [],
    cleanup: () => {},
  });

  it('uploads by exact color container, ignores the blank row, and returns only uploaded URLs', async () => {
    const { page, uploads } = skuPreviewPage(['灰色', '蓝色', '黄色', '']);
    const result = await uploadSkuPreviewImages(page, plan, { downloadImages: completeDownload });

    expect(uploads).toEqual([['灰色', 'gray.jpg'], ['蓝色', 'blue.jpg'], ['黄色', 'yellow.jpg']]);
    expect(result).toEqual([
      { merchantColor: '灰色', uploadedImageUrl: 'https://img.pddpic.com/uploaded-1.jpg' },
      { merchantColor: '蓝色', uploadedImageUrl: 'https://img.pddpic.com/uploaded-2.jpg' },
      { merchantColor: '黄色', uploadedImageUrl: 'https://img.pddpic.com/uploaded-3.jpg' },
    ]);
  });

  it('fails before upload when downloads are incomplete or color rows are ambiguous', async () => {
    const incomplete = skuPreviewPage(['灰色', '蓝色', '黄色', '']);
    await expect(uploadSkuPreviewImages(incomplete.page, plan, {
      downloadImages: async () => ({ filePaths: ['gray.jpg'], warnings: ['failed'], cleanup: () => {} }),
    })).rejects.toMatchObject({
      code: 'E_BUSINESS',
      detail: { issue: 'sku_preview_download_incomplete', expected_count: 3, downloaded_count: 1 },
    });
    expect(incomplete.uploads).toEqual([]);

    const ambiguous = skuPreviewPage(['灰色', '蓝色', '黄色', ''], { duplicateColor: '灰色' });
    await expect(uploadSkuPreviewImages(ambiguous.page, plan, { downloadImages: completeDownload }))
      .rejects.toMatchObject({ code: 'E_BUSINESS', detail: { issue: 'sku_preview_color_row_unmapped' } });
    expect(ambiguous.uploads).toEqual([]);
  });

  it('fails when the uploaded preview cannot be read back and never exposes source URLs', async () => {
    const { page } = skuPreviewPage(['灰色', '蓝色', '黄色', ''], { previewVisible: false });
    let error;
    try {
      await uploadSkuPreviewImages(page, plan, { downloadImages: completeDownload });
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ code: 'E_BUSINESS', detail: { issue: 'sku_preview_readback_mismatch' } });
    expect(JSON.stringify(error?.detail)).not.toContain('gray.jpg');
  });

  it('maps upload transport failure to a stable URL-free business error', async () => {
    const { page } = skuPreviewPage(['灰色', '蓝色', '黄色', '']);
    page.waitForResponse = async () => { throw new Error('transport failed for a private URL'); };

    await expect(uploadSkuPreviewImages(page, plan, { downloadImages: completeDownload }))
      .rejects.toMatchObject({ code: 'E_BUSINESS', detail: { issue: 'sku_preview_upload_incomplete' } });
  });
});
