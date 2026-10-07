// 领域视图共用的换算原语（输出契约 v2）：元/分、Asia/Shanghai 时间、百分比、枚举标签。
// 纯函数、无领域知识；无效输入一律返回 null（缺失不补 0），由调用方决定是否报错。

const NUMERIC_TEXT = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
const YUAN_TEXT = /^\d+(?:\.\d{1,2})?$/;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
// 秒级时间戳到公元 5138 年前都 < 1e11；毫秒级自 1973-03 起即 >= 1e11，二者不重叠
const MS_TIMESTAMP_MIN = 1e11;

// number / 数字字符串 → 有限 number；空串、布尔、NaN、Infinity、'0x10' 等 → null
export function toFiniteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!NUMERIC_TEXT.test(text)) return null;
  const num = Number(text);
  return Number.isFinite(num) ? num : null;
}

// 四舍五入（远离零），toPrecision(15) 先消除二进制误差：1.005 → 1.01
export function round(value, digits = 2) {
  const num = toFiniteNumber(value);
  if (num === null) return null;
  const factor = 10 ** digits;
  const scaled = Number((Math.abs(num) * factor).toPrecision(15));
  const rounded = (Math.sign(num) * Math.round(scaled)) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

// 分 → 元（2 位小数）；保留符号（退款等负值）
export function yuanFromFen(fen) {
  const num = toFiniteNumber(fen);
  return num === null ? null : round(num / 100, 2);
}

// 元 → 整数分：字符串精确解析（BigInt，不做浮点乘法）。
// 接受非负、最多 2 位小数；非法输入（负数、>2 位小数、超出安全整数）返回 null。
// 0 合法返回 0 —— 需要「>0」的调用方自行校验。
export function parseYuanToFen(input) {
  if (typeof input !== 'string' && typeof input !== 'number') return null;
  if (typeof input === 'number' && !Number.isFinite(input)) return null;
  const text = String(input).trim();
  if (!YUAN_TEXT.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  if (whole.length > 14) return null;
  const fen = (BigInt(whole) * 100n) + BigInt(fraction.padEnd(2, '0'));
  return fen <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(fen) : null;
}

// unix 时间戳（秒或毫秒，按 MS_TIMESTAMP_MIN 判定）→ 平移到 +08:00 的 ISO 串，不依赖宿主 TZ。
// 非正值视为上游「未设置」哨兵返回 null；超出 4 位年份范围返回 null。
function shanghaiIso(timestamp) {
  const num = toFiniteNumber(timestamp);
  if (num === null || num <= 0) return null;
  const ms = num >= MS_TIMESTAMP_MIN ? num : num * 1000;
  const date = new Date(Math.trunc(ms) + SHANGHAI_OFFSET_MS);
  if (Number.isNaN(date.getTime()) || date.getUTCFullYear() > 9999) return null;
  return date.toISOString();
}

// → 'YYYY-MM-DD HH:mm:ss'（Asia/Shanghai）
export function toLocalDateTime(timestamp) {
  const iso = shanghaiIso(timestamp);
  return iso === null ? null : `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
}

// ISO 8601 时间串（如 registry 的 lastLoginAt）→ 'YYYY-MM-DD HH:mm:ss'（Asia/Shanghai）；无法解析 → null
export function isoToLocalDateTime(iso) {
  if (typeof iso !== 'string' || iso.trim() === '') return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? toLocalDateTime(ms) : null;
}

// → 'YYYY-MM-DD'（Asia/Shanghai）
export function toLocalDate(timestamp) {
  const iso = shanghaiIso(timestamp);
  return iso === null ? null : iso.slice(0, 10);
}

// 0-1 比率 → 0-100 百分数（2 位小数）
export function toPct(ratio) {
  const num = toFiniteNumber(ratio);
  return num === null ? null : round(num * 100, 2);
}

// 枚举码 → 中文标签；未登记码 → '未知(<code>)'；缺失码 → null
export function labelOf(map, code) {
  if (code == null || code === '') return null;
  return Object.hasOwn(map, code) ? map[code] : `未知(${code})`;
}
