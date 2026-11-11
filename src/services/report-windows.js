import { toLocalDate, SHANGHAI_OFFSET_MS } from '../infra/units.js';

const DAY_SECONDS = 86400;
const DAY_MS = DAY_SECONDS * 1000;

// 平台就绪日为包含在窗口内的截止日；日期运算固定使用 UTC，隔离宿主时区。
export function windowEndingAt(days, endDate) {
  const start = Date.parse(`${endDate}T00:00:00Z`) - (days - 1) * DAY_MS;
  return { start_date: new Date(start).toISOString().slice(0, 10), end_date: endDate, days };
}

export function windowEndingYesterday(days, now = Date.now()) {
  const today = Date.parse(`${toLocalDate(now)}T00:00:00Z`);
  return windowEndingAt(days, new Date(today - DAY_MS).toISOString().slice(0, 10));
}

// 上海今天 00:00:00 的毫秒时间戳；所有上海自然日窗口共用这一处日界计算。
function shanghaiTodayStartMs(nowMs) {
  return Math.floor((nowMs + SHANGHAI_OFFSET_MS) / DAY_MS) * DAY_MS - SHANGHAI_OFFSET_MS;
}

export function completeShanghaiWindow(days, now = Math.floor(Date.now() / 1000)) {
  const end = shanghaiTodayStartMs(now * 1000) / 1000;
  const start = end - days * DAY_SECONDS;
  return { days, start, end, startDate: toLocalDate(start), endDate: toLocalDate(end - 1) };
}

export function rollingSecondsWindow(days, now = Date.now()) {
  const endTime = Math.floor(now / 1000);
  return { startTime: endTime - days * DAY_SECONDS, endTime };
}

// 上海自然日窗口，含今天：[今天减 days-1 天 00:00:00, 今天 23:59:59.999]，毫秒。
export function shanghaiDaysThroughToday(days, now = Date.now()) {
  const todayStart = shanghaiTodayStartMs(now);
  return { days, startMs: todayStart - (days - 1) * DAY_MS, endMs: todayStart + DAY_MS - 1 };
}
