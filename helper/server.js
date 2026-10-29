// Localhost bridge between the extension and the user's CLI.
import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import { complete, illustrate, detectProviders, pickProvider, httpError, IMAGES, CODEX_RATES } from './providers.js';
import { cardsPrompt, cardPrompt, repairPrompt, explorePrompt, illustratePrompt } from './prompts.js';

// Headings and titles come from untrusted pages; keep control characters out of the console.
const CONTROL = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]', 'g');
export const cleanForLog = (s) => String(s).replace(CONTROL, ' ');

const MAX_BODY = 2_000_000;
const CONCURRENCY = 3;

const TIMEOUTS = { cards: 240_000, card: 150_000, repair: 90_000, explore: 480_000, illustrate: 300_000 };
const BUILDERS = { cards: cardsPrompt, card: cardPrompt, repair: repairPrompt, explore: explorePrompt, illustrate: illustratePrompt };

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
      // With both CLIs, Claude plans the cards and Codex paints the pictures.
      return send(200, { ok: true, paired: true, providers: available, provider: defaultProvider, pictures: available.codex, codexRates: CODEX_RATES, version: '0.2.0' });
    }

    const image = url.pathname.match(/^\/v1\/image\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/)?.[1];
    if (req.method === 'GET' && image) {
      if (!authed) return send(401, { error: 'Bad or missing pairing code' });
      const file = join(IMAGES, `${image}.png`);
      if (!existsSync(file)) return send(404, { error: 'No such picture' });
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'private, max-age=31536000', ...(origin && { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'x-docviz-token' }) });
      return createReadStream(file).pipe(res);
    }

    const route = url.pathname.match(/^\/v1\/(cards|card|repair|explore|illustrate)$/)?.[1];
    if (req.method !== 'POST' || !route) return send(404, { error: 'Not found' });
    if (!authed) return send(401, { error: 'Bad or missing pairing code' });

    const started = Date.now();
    let provider = null;
    try {
      const body = await readJson(req);
      const picture = route === 'illustrate';
      if (picture && (!body.card || typeof body.card !== 'object')) throw httpError(400, 'illustrate needs a card');
      if (picture && !available.codex) throw httpError(503, 'Pictures need the Codex CLI on PATH');
      provider = picture ? 'codex' : pickProvider(body.provider || defaultProvider, available);
      const job = BUILDERS[route](body);
      const label = route === 'cards' ? `${body.sections?.length || 0} sections` : (body.section?.heading || body.card?.title || '').slice(0, 40);
      log(`→ ${route} via ${provider} · ${cleanForLog(label)}`);
      // The planner's --model is a Claude/Codex text model; pictures use Codex's default.
      const run = picture
        ? () => illustrate({ ...job, timeoutMs: TIMEOUTS[route] })
        : () => complete(provider, { ...job, model: body.model || defaultModel, research: route === 'explore', timeoutMs: TIMEOUTS[route] });
      const { output, usage } = await limited(run);
      log(`✓ ${route} in ${((Date.now() - started) / 1000).toFixed(1)}s · ${usage.estimated ? '~' : ''}$${usage.usd.toFixed(4)}`);
      send(200, { provider, result: output, usage: { ...usage, provider, ms: Date.now() - started } });
    } catch (e) {
      log(`✗ ${route}: ${cleanForLog(e.message)}`);
      // A call that failed after the CLI spent still reports what it cost.
      send(e.status || 500, { error: e.message, ...(e.usage && { usage: { ...e.usage, provider, ms: Date.now() - started } }) });
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve({ server, available }));
  });
}
