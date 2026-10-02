// Read-only local preview probe. No wallet, cookies, keys, or writes are used.
const web = new URL(process.env.MANDATE_PREVIEW_WEB_URL || 'http://127.0.0.1:3110');
const api = new URL(process.env.MANDATE_PREVIEW_API_URL || 'http://127.0.0.1:4110');

for (const [name, url] of [['web', web], ['api', api]]) {
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`${name} origin must be a plain loopback HTTP origin`);
  }
}

async function read(url) {
  const response = await fetch(url, {
    method: 'GET',
    redirect: 'manual',
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  return {status: response.status, contentType: response.headers.get('content-type') || '', body: await response.text()};
}

function requireStatus(result, expected, label) {
  if (result.status !== expected) throw new Error(`${label}: expected HTTP ${expected}, got ${result.status}`);
}

function requireHealth(result, label) {
  requireStatus(result, 200, label);
  let value;
  try { value = JSON.parse(result.body); } catch { throw new Error(`${label}: invalid JSON`); }
  if (value.service !== 'mandate' || value.status !== 'ok' || value.executionEnabled !== false || typeof value.schemaVersion !== 'string') {
    throw new Error(`${label}: unexpected health response`);
  }
  return value.schemaVersion;
}

try {
  const direct = requireHealth(await read(new URL('/v1/health', api)), 'direct API health');
  const proxied = requireHealth(await read(new URL('/api/v1/health', web)), 'web-to-API health');
  if (direct !== proxied) throw new Error('API and web proxy report different schema versions');

  const page = await read(web);
  requireStatus(page, 200, 'web root');
  if (!page.contentType.toLowerCase().includes('text/html') || !page.body.includes('Mandate')) {
    throw new Error('web root did not return the Mandate HTML shell');
  }

  const privateApi = await read(new URL('/v1/capital/recurring', api));
  const privateWeb = await read(new URL('/api/v1/capital/recurring', web));
  requireStatus(privateApi, 401, 'direct private route without wallet session');
  requireStatus(privateWeb, 401, 'proxied private route without wallet session');

  console.log(JSON.stringify({
    passed: true,
    mode: 'read-only loopback preview',
    schemaVersion: direct,
    checks: ['API health', 'web proxy to API', 'web HTML shell', 'private route denies unsigned access'],
    executionEnabled: false,
    workerAndDatabase: 'not established by HTTP health; run the isolated restart proof',
  }, null, 2));
} catch (error) {
  console.error(`Local preview check failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
