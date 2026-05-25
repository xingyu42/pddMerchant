export const DEFAULT_FINGERPRINT_PROFILE = Object.freeze({
  locale: 'zh-CN',
  timezoneId: 'Asia/Shanghai',
  languages: ['zh-CN', 'zh', 'en'],
  webglVendor: 'Intel Inc.',
  webglRenderer: 'Intel Iris OpenGL Engine',
  canvasNoise: true,
});

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
    // --- Canvas noise ---
    const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function(type, quality) {
      const ctx = this.getContext('2d');
      if (ctx) {
        try {
          const imageData = ctx.getImageData(0, 0, Math.min(this.width, 16), Math.min(this.height, 16));
          for (let i = 0; i < imageData.data.length; i += 4) {
            imageData.data[i] = imageData.data[i] ^ 1;
          }
          ctx.putImageData(imageData, 0, 0);
        } catch (e) {}
      }
      return origToDataURL.call(this, type, quality);
    };
    ` : ''}
  `.trim();
}
