async function redeem() {
  const message = document.querySelector('p');
  try {
    const token = decodeURIComponent(location.pathname.split('/').at(-1));
    const response = await fetch('/api/redeem', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-PDD-Console': '1' },
      body: JSON.stringify({ token }),
    });
    if (response.status === 410) { message.textContent = '链接已失效，请重新获取控制台链接'; return; }
    if (!response.ok) throw new Error();
    const { location: destination } = await response.json();
    location.replace(destination);
  } catch { message.textContent = '进入控制台失败，请稍后重新打开链接'; }
}

void redeem();
