// Localhost bridge between the extension and the user's CLI.
import { createServer } from 'node:http';
import { complete, detectProviders, pickProvider, httpError } from './providers.js';
import { cardsPrompt, cardPrompt, repairPrompt, explorePrompt } from './prompts.js';

const MAX_BODY = 2_000_000;
const CONCURRENCY = 3;

const TIMEOUTS = { cards: 240_000, card: 150_000, repair: 90_000, explore: 480_000 };
const BUILDERS = { cards: cardsPrompt, card: cardPrompt, repair: repairPrompt, explore: explorePrompt };

// Small FIFO so a 20-section page can't fork 20 CLIs at once.
let active = 0;
const waiting = [];
async function limited(fn) {
  if (active >= CONCURRENCY) await new Promise((r) => waiting.push(r));
  active++;
  try { return await fn(); } finally {
    active--;
    waiting.shift()?.();
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(httpError(413, 'Request too large')); req.destroy(); }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(httpError(400, 'Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

export function startServer({ host, port, token, provider: defaultProvider, model: defaultModel, log }) {
  const available = detectProviders();

  const server = createServer(async (req, res) => {
    const origin = req.headers.origin;
    // Browsers attach Origin to cross-site requests; only the extension may talk to us.
    if (origin && !origin.startsWith('chrome-extension://')) {
      res.writeHead(403).end();
      return;
    }
    const send = (status, body) => {
      const headers = { 'content-type': 'application/json' };
      if (origin) Object.assign(headers, {
        'access-control-allow-origin': origin,
        'access-control-allow-headers': 'content-type, x-docviz-token',
        'access-control-allow-methods': 'GET, POST',
      });
      res.writeHead(status, headers).end(body === undefined ? '' : JSON.stringify(body));
    };
    if (req.method === 'OPTIONS') return send(204);

    const url = new URL(req.url, 'http://x');
    const authed = req.headers['x-docviz-token'] === token;

    if (req.method === 'GET' && url.pathname === '/v1/health') {
      if (!authed) return send(200, { ok: true, paired: false });
      return send(200, { ok: true, paired: true, providers: available, provider: defaultProvider, version: '0.1.0' });
    }

    const route = url.pathname.match(/^\/v1\/(cards|card|repair|explore)$/)?.[1];
    if (req.method !== 'POST' || !route) return send(404, { error: 'Not found' });
    if (!authed) return send(401, { error: 'Bad or missing pairing code' });

    const started = Date.now();
    try {
      const body = await readJson(req);
      const provider = pickProvider(body.provider || defaultProvider, available);
      const job = BUILDERS[route](body);
      const label = route === 'cards' ? `${body.sections?.length || 0} sections` : (body.section?.heading || '').slice(0, 40);
      log(`→ ${route} via ${provider} · ${label}`);
      const result = await limited(() => complete(provider, {
        ...job,
        model: body.model || defaultModel,
        research: route === 'explore',
        timeoutMs: TIMEOUTS[route],
      }));
      log(`✓ ${route} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
      send(200, { provider, result });
    } catch (e) {
      log(`✗ ${route}: ${e.message}`);
      send(e.status || 500, { error: e.message });
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve({ server, available }));
  });
}
