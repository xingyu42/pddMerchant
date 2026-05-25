import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { rewriteTitle, segmentChinese, removeForbidden, applySynonyms } from '../../src/services/title-rewriter.js';

describe('segmentChinese', () => {
  it('segments Chinese text into words', () => {
    const tokens = segmentChinese('夏季纯棉短袖T恤男士');
    assert(tokens.length > 0);
    // Intl.Segmenter may split 纯棉 into 纯+棉; check characters are present
    const joined = tokens.join('');
    assert(joined.includes('纯') || joined.includes('棉'));
    assert(joined.includes('男士'));
  });
});

describe('removeForbidden', () => {
  it('removes forbidden words from tokens', () => {
    const forbidden = new Set(['最', '最好', '独家']);
    const { tokens, removed } = removeForbidden(['最', '好', '纯棉', '独家', 'T恤'], forbidden);
    assert(!tokens.includes('最'));
    assert(!tokens.includes('独家'));
    assert(tokens.includes('纯棉'));
    assert(removed.includes('最'));
    assert(removed.includes('独家'));
  });
});

describe('applySynonyms', () => {
  it('replaces tokens with synonyms', () => {
    const synonyms = { '纯棉': ['全棉', '棉质'] };
    const result = applySynonyms(['纯棉', 'T恤'], synonyms, () => 0);
    assert.equal(result[0], '全棉');
    assert.equal(result[1], 'T恤');
  });

  it('leaves unknown tokens unchanged', () => {
    const result = applySynonyms(['特殊词'], {}, () => 0);
    assert.equal(result[0], '特殊词');
  });
});

describe('rewriteTitle', () => {
  it('rewrites title removing forbidden words', async () => {
    const result = await rewriteTitle(
      { goodsName: '全网独家最好纯棉T恤' },
      { forbiddenWords: ['全网独家', '最好'] }
    );
    assert.equal(result.changed, true);
    assert(!result.title.includes('全网独家'));
    assert(!result.title.includes('最好'));
    assert.equal(result.method, 'local');
    assert(result.removedForbiddenWords.includes('全网独家') || result.removedForbiddenWords.includes('最好'));
  });

  it('handles empty title', async () => {
    const result = await rewriteTitle({ goodsName: '' });
    assert.equal(result.changed, false);
    assert.equal(result.method, 'fallback');
    assert(result.warnings.includes('empty_title'));
  });

  it('respects maxLength', async () => {
    const longTitle = '超长标题'.repeat(20);
    const result = await rewriteTitle({ goodsName: longTitle }, { maxLength: 30 });
    assert(result.title.length <= 30);
  });

  it('uses LLM path when available', async () => {
    const result = await rewriteTitle(
      { goodsName: '原始标题' },
      { llmRewrite: async () => ({ title: 'AI改写标题' }) }
    );
    assert.equal(result.title, 'AI改写标题');
    assert.equal(result.method, 'llm');
  });

  it('falls back to local when LLM fails', async () => {
    const result = await rewriteTitle(
      { goodsName: '测试标题' },
      { llmRewrite: async () => { throw new Error('API error'); } }
    );
    assert.equal(result.method, 'local');
  });

  it('PBT: output never contains forbidden words', async () => {
    const forbidden = ['最', '最好', '独家', '第一', '唯一'];
    for (let i = 0; i < 10; i++) {
      const title = `最好的独家第一纯棉T恤唯一选择${i}`;
      const result = await rewriteTitle(
        { goodsName: title },
        { forbiddenWords: forbidden }
      );
      for (const word of forbidden) {
        assert(!result.title.includes(word), `Output contains forbidden word: ${word}`);
      }
    }
  });
});
