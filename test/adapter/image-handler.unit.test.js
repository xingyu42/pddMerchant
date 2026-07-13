import { describe, expect, it } from 'vitest';
import { uploadDetailImages } from '../../src/adapter/goods-publish/image-handler.js';

function response(url) {
  return { url: () => url, json: async () => ({ img_url: url }) };
}

describe('uploadDetailImages', () => {
  it('waits for a distinct completion response for every file', async () => {
    const responses = [response('https://upload/upload_complete/1'), response('https://upload/upload_complete/2')];
    const claimed = [];
    const page = {
      waitForResponse: async (predicate) => {
        const match = responses.find((item) => predicate(item));
        if (!match) throw new Error('timeout');
        claimed.push(match);
        return match;
      },
      locator: () => ({
        count: async () => 8,
        nth: () => ({ setInputFiles: async () => {} }),
      }),
    };

    const result = await uploadDetailImages(page, ['a.jpg', 'b.jpg']);
    expect(claimed).toHaveLength(2);
    expect(new Set(claimed).size).toBe(2);
    expect(result).toMatchObject({ requested: 2, completed: 2, warnings: [] });
  });

  it('fails before setting files when the detail input is absent', async () => {
    let setFiles = 0;
    const page = {
      locator: () => ({
        count: async () => 7,
        nth: () => ({ setInputFiles: async () => { setFiles += 1; } }),
      }),
    };
    await expect(uploadDetailImages(page, ['a.jpg'])).rejects.toMatchObject({ code: 'E_BUSINESS' });
    expect(setFiles).toBe(0);
  });
});
