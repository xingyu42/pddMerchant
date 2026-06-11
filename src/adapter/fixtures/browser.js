// fixture browser provider（design D-4）：mock 浏览器三元组与关闭 no-op。
export function mockLaunchBrowser() {
  const page = { __mock: true };
  const context = { __mock: true };
  const browser = { __mock: true };
  return { browser, context, page };
}

export async function mockCloseBrowser() {
  // no-op
}
