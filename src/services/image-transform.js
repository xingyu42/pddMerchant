import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

let _sharp = null;
async function getSharp() {
  if (!_sharp) _sharp = (await import('sharp')).default;
  return _sharp;
}

const DEFAULTS = {
  cropRange: [0.01, 0.03],
  brightnessRange: [-0.05, 0.05],
  saturationRange: [-0.1, 0.1],
  hueRange: [-10, 10],
  jpegQualityRange: [92, 96],
};

function randInRange(min, max, random = Math.random) {
  return min + random() * (max - min);
}

async function transformSingle(inputPath, outputPath, opts) {
  const sharp = await getSharp();
  const metadata = await sharp(inputPath).metadata();
  const w = metadata.width || 800;
  const h = metadata.height || 800;
  const cropPct = randInRange(...opts.cropRange, opts.random);
  const cropPx = Math.max(1, Math.round(Math.min(w, h) * cropPct));
  const brightnessShift = randInRange(...opts.brightnessRange, opts.random);
  const saturationShift = randInRange(...opts.saturationRange, opts.random);
  const hueShift = Math.round(randInRange(...opts.hueRange, opts.random));
  const jpegQuality = Math.round(randInRange(...opts.jpegQualityRange, opts.random));

  await sharp(inputPath)
    .rotate()
    .extract({
      left: cropPx,
      top: cropPx,
      width: Math.max(1, w - cropPx * 2),
      height: Math.max(1, h - cropPx * 2),
    })
    .modulate({
      brightness: 1 + brightnessShift,
      saturation: 1 + saturationShift,
      hue: hueShift,
    })
    .jpeg({ quality: jpegQuality })
    .toFile(outputPath);

  return { inputPath, outputPath, cropPct, brightnessShift, saturationShift, hueShift, jpegQuality };
}

export async function transformImages(filePaths, options = {}) {
  const opts = {
    cropRange: options.cropRange ?? DEFAULTS.cropRange,
    brightnessRange: options.brightnessRange ?? DEFAULTS.brightnessRange,
    saturationRange: options.saturationRange ?? DEFAULTS.saturationRange,
    hueRange: options.hueRange ?? DEFAULTS.hueRange,
    jpegQualityRange: options.jpegQualityRange ?? DEFAULTS.jpegQualityRange,
    random: options.random ?? Math.random,
  };

  const tmpDir = join(tmpdir(), `pdd-img-transform-${randomUUID().slice(0, 8)}`);
  mkdirSync(tmpDir, { recursive: true });

  const warnings = [];
  const stats = [];
  const outputPaths = [];

  for (let i = 0; i < filePaths.length; i++) {
    const outputPath = join(tmpDir, `${i}.jpg`);
    try {
      const stat = await transformSingle(filePaths[i], outputPath, opts);
      stats.push(stat);
      outputPaths.push(outputPath);
    } catch (err) {
      warnings.push(`image_transform_failed: ${filePaths[i]} — ${err.message}`);
      outputPaths.push(filePaths[i]);
    }
  }

  return {
    filePaths: outputPaths,
    tmpDir,
    warnings,
    stats,
    cleanup() {
      rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}
