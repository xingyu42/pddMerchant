// R4 render 下沉（task 7.1）快照 case 集：覆盖 colorize 全分支、scoreBar 钳位、
// 维度缺失 '–' 行、issues/hints 字符串与对象两种形态、空数组跳过。
// 基线采集与断言共用本数据，保证逐字节可比。
export const CASES = [
  {
    name: 'single-full-color',
    renderer: 'renderSingleDashboard',
    useColor: true,
    envelope: {
      command: 'diagnose.funnel',
      data: {
        score: 72,
        status: 'yellow',
        issues: ['退款率高于阈值', { dimension: 'funnel', message: '对象形态 issue' }],
        hints: ['检查物流时效', { dimension: 'funnel', message: '对象形态 hint' }],
      },
    },
  },
  {
    name: 'single-full-nocolor',
    renderer: 'renderSingleDashboard',
    useColor: false,
    envelope: {
      command: 'diagnose.funnel',
      data: {
        score: 72,
        status: 'yellow',
        issues: ['退款率高于阈值', { dimension: 'funnel', message: '对象形态 issue' }],
        hints: ['检查物流时效', { dimension: 'funnel', message: '对象形态 hint' }],
      },
    },
  },
  {
    name: 'single-partial-color',
    renderer: 'renderSingleDashboard',
    useColor: true,
    envelope: {
      command: 'diagnose.orders',
      data: { score: null, issues: [], hints: [] },
    },
  },
  {
    name: 'single-partial-nocolor',
    renderer: 'renderSingleDashboard',
    useColor: false,
    envelope: {
      command: 'diagnose.orders',
      data: { score: null, issues: [], hints: [] },
    },
  },
  {
    name: 'shop-full-color',
    renderer: 'renderShopDashboard',
    useColor: true,
    envelope: {
      command: 'diagnose.shop',
      data: {
        score: 67,
        status: 'yellow',
        dimensions: {
          orders: { score: 92, status: 'green' },
          inventory: { score: 35, status: 'red' },
          promo: { score: 61, status: 'yellow' },
        },
        issues: [{ dimension: 'inventory', message: '缺货 SKU 超阈值' }],
        hints: ['优先补货 A 类商品'],
      },
    },
  },
  {
    name: 'shop-full-nocolor',
    renderer: 'renderShopDashboard',
    useColor: false,
    envelope: {
      command: 'diagnose.shop',
      data: {
        score: 67,
        status: 'yellow',
        dimensions: {
          orders: { score: 92, status: 'green' },
          inventory: { score: 35, status: 'red' },
          promo: { score: 61, status: 'yellow' },
        },
        issues: [{ dimension: 'inventory', message: '缺货 SKU 超阈值' }],
        hints: ['优先补货 A 类商品'],
      },
    },
  },
  {
    name: 'shop-empty-color',
    renderer: 'renderShopDashboard',
    useColor: true,
    envelope: {
      command: 'diagnose.shop',
      data: { score: null, dimensions: {} },
    },
  },
  {
    name: 'shop-empty-nocolor',
    renderer: 'renderShopDashboard',
    useColor: false,
    envelope: {
      command: 'diagnose.shop',
      data: { score: null, dimensions: {} },
    },
  },
];
