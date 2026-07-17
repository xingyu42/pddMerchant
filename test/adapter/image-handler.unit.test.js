import { describe, expect, it } from 'vitest';
import {
  uploadCarouselImages,
  uploadDetailImages,
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
