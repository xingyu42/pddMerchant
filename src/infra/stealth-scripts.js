/**
 * 基于种子生成确定性伪随机数生成器
 * @param {string} seed - 种子字符串
 * @returns {function(): number} - 返回 [0, 1) 范围的随机数生成器
 */
function createSeededRandom(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(i);
    hash = hash & hash; // Convert to 32bit integer
  }

  // Mulberry32 算法（快速、高质量）
  return function() {
    hash += 0x6D2B79F5;
    let t = hash;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 从种子生成确定性整数
 * @param {string} seed - 种子字符串
 * @param {number} min - 最小值（包含）
 * @param {number} max - 最大值（包含）
 * @returns {number}
 */
function seededInt(seed, min, max) {
  const rng = createSeededRandom(seed);
  return Math.floor(rng() * (max - min + 1)) + min;
}

/**
 * 生成确定性指纹配置
 * @param {string} seed - 种子字符串（默认从环境变量读取）
 * @returns {object} 指纹配置对象
 */
export function generateFingerprintProfile(seed = process.env.PDD_FINGERPRINT_SEED || '') {
  if (!seed) {
    // 无种子时：返回固定配置 + 随机 Canvas 噪声（向后兼容）
    return {
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      languages: ['zh-CN', 'zh', 'en'],
      webglVendor: 'Intel Inc.',
      webglRenderer: 'Intel Iris OpenGL Engine',
      canvasNoise: true,
      canvasNoiseAmount: null, // null = 随机噪声
    };
  }

  // 有种子时：生成确定性配置
  const vendorVariants = ['Intel Inc.', 'NVIDIA Corporation', 'AMD'];
  const rendererPrefixes = [
    'Intel Iris OpenGL Engine',
    'ANGLE (Intel, Intel(R) UHD Graphics',
    'ANGLE (NVIDIA, NVIDIA GeForce GTX',
  ];

  return {
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    languages: ['zh-CN', 'zh', 'en'],
    webglVendor: vendorVariants[seededInt(seed + 'vendor', 0, vendorVariants.length - 1)],
    webglRenderer: `${rendererPrefixes[seededInt(seed + 'renderer', 0, rendererPrefixes.length - 1)]} v${seededInt(seed + 'ver', 10, 99)}`,
    canvasNoise: true,
    canvasNoiseAmount: seededInt(seed + 'canvas', 1, 5), // 确定性噪声强度 1-5
  };
}

// 导出默认配置（保持 API 兼容）
export const DEFAULT_FINGERPRINT_PROFILE = generateFingerprintProfile();

export function buildStealthScript(profile = DEFAULT_FINGERPRINT_PROFILE) {
  const p = { ...DEFAULT_FINGERPRINT_PROFILE, ...profile };

  return `
    // --- webdriver ---
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

    // --- chrome runtime ---
    if (!window.chrome) {
      window.chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}) };
    }

    // --- plugins ---
    Object.defineProperty(navigator, 'plugins', {
      get: () => {
        const arr = [
          { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
          { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
          { name: 'Native Client', filename: 'internal-nacl-plugin' },
        ];
        arr.item = (i) => arr[i];
        arr.namedItem = (n) => arr.find(p => p.name === n);
        arr.refresh = () => {};
        return arr;
      },
    });

    // --- languages ---
    Object.defineProperty(navigator, 'languages', {
      get: () => ${JSON.stringify(p.languages)},
    });

    // --- WebGL ---
    const origGetParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(param) {
      if (param === 37445) return ${JSON.stringify(p.webglVendor)};
      if (param === 37446) return ${JSON.stringify(p.webglRenderer)};
      return origGetParameter.call(this, param);
    };

    // --- WebGL2 ---
    if (typeof WebGL2RenderingContext !== 'undefined') {
      const origGetParameter2 = WebGL2RenderingContext.prototype.getParameter;
      WebGL2RenderingContext.prototype.getParameter = function(param) {
        if (param === 37445) return ${JSON.stringify(p.webglVendor)};
        if (param === 37446) return ${JSON.stringify(p.webglRenderer)};
        return origGetParameter2.call(this, param);
      };
    }

    ${p.canvasNoise ? `
    // --- Canvas 确定性噪声 ---
    const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function(type, quality) {
      const ctx = this.getContext('2d');
      if (ctx) {
        try {
          const imageData = ctx.getImageData(0, 0, Math.min(this.width, 16), Math.min(this.height, 16));
          const noiseAmount = ${p.canvasNoiseAmount !== null ? p.canvasNoiseAmount : 'Math.floor(Math.random() * 5) + 1'};

          for (let i = 0; i < imageData.data.length; i += 4) {
            // 确定性噪声：根据 noiseAmount 调整强度
            imageData.data[i] = (imageData.data[i] + noiseAmount) % 256;
            imageData.data[i + 1] = (imageData.data[i + 1] + noiseAmount) % 256;
            imageData.data[i + 2] = (imageData.data[i + 2] + noiseAmount) % 256;
          }
          ctx.putImageData(imageData, 0, 0);
        } catch (e) {}
      }
      return origToDataURL.call(this, type, quality);
    };
    ` : ''}
  `.trim();
}
