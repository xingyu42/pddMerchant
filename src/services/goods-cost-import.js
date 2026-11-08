import { open } from 'node:fs/promises';
import { extname } from 'node:path';
import { PddCliError, ExitCodes } from '../infra/errors.js';
import { validateCostEntry } from './goods-cost-input.js';

const MAX_BYTES = 1024 * 1024;
function importInvalid(rowErrors) {
  return new PddCliError({ code: 'E_COST_IMPORT_INVALID', message: '成本导入文件校验失败',
    detail: { row_errors: rowErrors }, exitCode: ExitCodes.USAGE });
}

function fileInvalid(message) {
  return importInvalid([{ row: null, field: null, message }]);
}

async function readBounded(handle) {
  const buffer = Buffer.alloc(MAX_BYTES + 1);
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  if (offset > MAX_BYTES) throw fileInvalid('文件最多 1 MiB');
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, offset)); }
  catch { throw fileInvalid('需要 UTF-8 编码的 JSON 文件'); }
}

async function readImport(file) {
  if (typeof file !== 'string' || extname(file).toLowerCase() !== '.json') throw fileInvalid('需要 JSON 文件');
  let handle;
  try {
    handle = await open(file, 'r');
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_BYTES) throw fileInvalid('文件需要普通文件且最多 1 MiB');
    return await readBounded(handle);
  } catch (error) {
    if (error instanceof PddCliError) throw error;
    throw new PddCliError({ code: 'E_COST_IMPORT_IO', message: '无法读取成本导入文件，请检查格式及访问权限', exitCode: ExitCodes.USAGE });
  } finally { if (handle) await handle.close(); }
}

function parseRows(text) {
  let rows;
  try { rows = JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch { throw fileInvalid('JSON 语法错误'); }
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 5000) throw fileInvalid('需要 1–5000 条成本记录的数组');
  return rows;
}

export async function parseCostImport(file) {
  const rows = parseRows(await readImport(file));
  const entries = [];
  const errors = [];
  const keys = new Map();
  for (const [index, input] of rows.entries()) {
    try {
      const entry = validateCostEntry(input);
      const key = JSON.stringify([entry.goods_id, entry.spec]);
      if (keys.has(key)) {
        errors.push({ row: index + 1, field: 'goods_id', message: `与第 ${keys.get(key)} 条记录重复` });
      } else {
        keys.set(key, index + 1);
        entries.push(entry);
      }
    } catch (error) {
      if (!(error instanceof PddCliError) || error.code !== 'E_USAGE') throw error;
      errors.push({ row: index + 1, field: error.detail?.field ?? null, message: error.message });
    }
  }
  if (errors.length) throw importInvalid(errors);
  return entries;
}
