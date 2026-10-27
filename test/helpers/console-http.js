import { createServer, request } from 'node:http';

export async function freeConsolePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

export function consoleRequest(port, path, { method = 'GET', headers = {}, body, hostname = '127.0.0.1' } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname, port, method, path, headers, agent: false }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8') }));
      response.on('error', reject);
    });
    req.once('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('Console HTTP request timed out')));
    req.end(body);
  });
}
