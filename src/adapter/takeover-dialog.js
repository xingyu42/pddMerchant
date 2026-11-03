// 接管画面只转播验证码弹窗：定位弹窗区域并按区域截图。选择器来自登录页前端调研（captcha-wrapper 与各题型容器 id）。
// 这里只决定画面取景，不参与登录结果判定；定位不到时画面为空。
const DIALOG_SCALE = 2;
const DIALOG_EXPRESSION = `(() => {
  const selectors = ['.captcha-wrapper', '#slide-captcha-dialog', '#slidemove-captcha-dialog', '#SmartCaptcha'];
  const pad = 24;
  for (const selector of selectors) {
    for (const element of document.querySelectorAll(selector)) {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const rect = element.getBoundingClientRect();
      const x = Math.max(0, rect.left - pad);
      const y = Math.max(0, rect.top - pad);
      const width = Math.min(innerWidth, rect.right + pad) - x;
      const height = Math.min(innerHeight, rect.bottom + pad) - y;
      if (rect.width >= 40 && rect.height >= 40 && width > 0 && height > 0) {
        return { x, y, width, height, scrollX, scrollY };
      }
    }
  }
  return null;
})()`;

function validDialog(value) {
  if (!value || typeof value !== 'object') return null;
  const { x, y, width, height, scrollX, scrollY } = value;
  if (![x, y, width, height, scrollX, scrollY].every(Number.isFinite)) return null;
  if (x < 0 || y < 0 || width <= 0 || height <= 0) return null;
  return { x, y, width, height, scrollX, scrollY };
}

export async function readDialog(cdp) {
  try {
    const response = await cdp.send('Runtime.evaluate', { expression: DIALOG_EXPRESSION, returnByValue: true });
    return response?.exceptionDetails ? null : validDialog(response?.result?.value);
  } catch { return null; }
}

// 截图 clip 使用文档坐标，弹窗位置是视口坐标，需加上滚动偏移。
export async function captureDialog(cdp, dialog) {
  try {
    const response = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 80, clip: {
      x: dialog.x + dialog.scrollX, y: dialog.y + dialog.scrollY,
      width: dialog.width, height: dialog.height, scale: DIALOG_SCALE,
    } });
    return typeof response?.data === 'string' && response.data ? response.data : null;
  } catch { return null; }
}
