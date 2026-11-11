import { toLocalDate, toLocalDateTime } from '../infra/units.js';

// 报表 today 区块的共用采集：上游不返回快照时间，snapshot_at 取 CLI 抓取时间（上海时区）。
// 各来源刷新时点不同，任一失败整体为 null 并写入报表登记的 today_unavailable 提示，历史数据照常输出。
export async function collectToday(report, collect) {
  const now = Date.now();
  const sources = await report.optional('today_unavailable', () => collect({ date: toLocalDate(now) }));
  return sources === null ? null : { snapshotAt: toLocalDateTime(now), sources };
}
