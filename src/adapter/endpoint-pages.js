// 并发采集使用独立页面；仅清理由本次租借创建的页面。
export async function withEndpointPages(page, count, fn) {
  if (typeof page?.context !== 'function') {
    return fn(Array(count).fill(page));
  }

  const context = page.context();
  const pages = [];
  try {
    for (let index = 0; index < count; index += 1) {
      pages.push(await context.newPage());
    }
    return await fn(pages);
  } finally {
    await Promise.allSettled(pages.map(async (leasedPage) => {
      await leasedPage.close();
    }));
  }
}
