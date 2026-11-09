import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BriefError, normalizeBrief, reviewVariants, exportCsv, CREATIVE_ANGLES, STARTER_REFERENCES, normalizeReferenceLibrary } from './core.mjs';
import { generate } from './generator.mjs';
import { createProviderRegistry } from './providers.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const bodyLimit = 65536;
const contentTypes = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.zip': 'application/zip', '.md': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

async function readJson(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new HttpError(415, 'Send application/json.');
  if (Number(request.headers['content-length'] || 0) > bodyLimit) throw new HttpError(413, 'Request is too large.');
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > bodyLimit) throw new HttpError(413, 'Request is too large.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Invalid JSON.');
  }
}

async function serveFile(response, filename, download = false) {
  const contents = await readFile(filename);
  const headers = { 'Content-Type': contentTypes[extname(filename)] || 'application/octet-stream' };
  if (download) headers['Content-Disposition'] = `attachment; filename="${filename.split(/[\\/]/).at(-1)}"`;
  response.writeHead(200, headers);
  response.end(contents);
}

export function createAppServer({ generateFn = generate, registry = createProviderRegistry() } = {}) {
  let activeGenerations = 0;
  const generationTimes = [];
  const server = createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    try {
      const host = request.headers.host || '';
      if (!/^(localhost|127\.0\.0\.1):\d+$/.test(host)) throw new HttpError(403, 'Only a local host is allowed.');
      const url = new URL(request.url, `http://${host}`);
      if (request.method === 'POST' && request.headers.origin && request.headers.origin !== `http://${host}`) {
        throw new HttpError(403, 'Cross-origin requests are not allowed.');
      }
      if (request.method === 'GET' && url.pathname === '/api/config') {
        const providers = registry.list();
        const claude = providers.find(provider => provider.id === 'anthropic');
        return sendJson(response, 200, { defaultProvider: registry.defaultId(), providers, hasClaudeKey: claude?.configured === true, model: claude?.model || null });
      }
      if (request.method === 'GET' && url.pathname === '/api/samples') {
        return sendJson(response, 200, JSON.parse(await readFile(resolve(root, 'samples/briefs.json'), 'utf8')));
      }
      if (request.method === 'GET' && url.pathname === '/api/library') {
        return sendJson(response, 200, { angles: CREATIVE_ANGLES, references: STARTER_REFERENCES });
      }
      if (request.method === 'POST' && url.pathname === '/api/library/validate') {
        const payload = await readJson(request);
        return sendJson(response, 200, { references: normalizeReferenceLibrary(payload.references) });
      }
      if (request.method === 'POST' && url.pathname === '/api/generate') {
        const payload = await readJson(request);
        if (payload.provider && payload.mode && payload.provider !== payload.mode) throw new HttpError(400, 'Provider and legacy mode must agree.');
        const providerId = payload.provider || payload.mode || registry.defaultId();
        registry.get(providerId);
        while (generationTimes.length && generationTimes[0] < Date.now() - 60000) generationTimes.shift();
        if (activeGenerations >= 1 || generationTimes.length >= 20) throw new HttpError(429, 'Generation limit reached. Finish the current request or try again later.');
        const controller = new AbortController();
        response.on('close', () => { if (!response.writableEnded) controller.abort(); });
        activeGenerations += 1;
        generationTimes.push(Date.now());
        try {
          const result = await generateFn(payload.brief, providerId, { registry, signal: controller.signal });
          return sendJson(response, 200, result);
        } finally {
          activeGenerations -= 1;
        }
      }
      if (request.method === 'POST' && url.pathname === '/api/review') {
        const payload = await readJson(request);
        return sendJson(response, 200, { variants: reviewVariants(payload.variants, normalizeBrief(payload.brief)) });
      }
      if (request.method === 'POST' && url.pathname === '/api/export') {
        const payload = await readJson(request);
        const brief = normalizeBrief(payload.brief);
        const reviewed = reviewVariants(payload.variants, brief).map((variant, index) => ({ ...variant, approved: payload.variants[index].approved === true }));
        const approved = reviewed.filter(variant => variant.approved);
        if (!approved.length) throw new HttpError(422, 'Approve at least one draft before exporting.');
        if (approved.some(variant => variant.blocked)) throw new HttpError(422, 'An approved draft contains a blocking issue. Edit and review it again.');
        if (payload.format === 'csv') {
          response.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="socklock-approved.csv"' });
          return response.end(exportCsv(approved, brief));
        }
        if (payload.format !== 'json') throw new HttpError(400, 'Choose CSV or JSON.');
        return sendJson(response, 200, { schemaVersion: 1, kind: 'approved-draft-export', brief, source: payload.meta?.source || 'Imported drafts', variants: approved });
      }
      if (request.method !== 'GET') throw new HttpError(405, 'Method not allowed.');
      if (url.pathname === '/vendor/lucide.js') return await serveFile(response, resolve(root, 'node_modules/lucide/dist/umd/lucide.js'));
      if (url.pathname === '/vendor/manrope.css') return await serveFile(response, resolve(root, 'node_modules/@fontsource-variable/manrope/index.css'));
      if (/^\/vendor\/files\/manrope-[a-z-]+\.woff2$/.test(url.pathname)) {
        return await serveFile(response, resolve(root, 'node_modules/@fontsource-variable/manrope/files', url.pathname.split('/').at(-1)));
      }
      if (url.pathname === '/samples/briefs.json') return await serveFile(response, resolve(root, 'samples/briefs.json'));
      if (url.pathname.startsWith('/deliverables/')) {
        const name = url.pathname.slice('/deliverables/'.length);
        if (!/^[a-z0-9_.-]+$/.test(name)) throw new HttpError(404, 'Not found.');
        return await serveFile(response, resolve(root, 'deliverables', name), url.searchParams.has('download'));
      }
      const publicRoot = resolve(root, 'public');
      const filename = resolve(publicRoot, `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`);
      if (!filename.startsWith(`${publicRoot}${sep}`)) throw new HttpError(404, 'Not found.');
      return await serveFile(response, filename);
    } catch (error) {
      if (response.writableEnded || response.destroyed) return;
      const status = error.status || (error instanceof BriefError ? 400 : error.code === 'ENOENT' ? 404 : 503);
      const message = error instanceof BriefError || error instanceof HttpError
        ? error.message
        : status === 404 ? 'Not found.' : 'Service unavailable. No local-template fallback was used. Check configuration and try again.';
      sendJson(response, status, { error: message });
    }
  });
  server.requestTimeout = 60000;
  server.headersTimeout = 10000;
  return server;
}

export async function startServer(port = Number(process.env.PORT || 4317)) {
  for (let offset = 0; offset < 10; offset += 1) {
    const server = createAppServer();
    try {
      await new Promise((resolveListen, rejectListen) => {
        server.once('error', rejectListen);
        server.listen(port === 0 ? 0 : port + offset, '127.0.0.1', resolveListen);
      });
      return server;
    } catch (error) {
      if (error.code !== 'EADDRINUSE' || offset === 9) throw error;
    }
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const server = await startServer();
  console.log(`SockLock Variants: http://127.0.0.1:${server.address().port}`);
  const registry = createProviderRegistry();
  console.log(`Default provider: ${registry.defaultId()}`);
  for (const provider of registry.list()) console.log(`${provider.label}: ${provider.configured ? 'settings configured' : 'not configured'}`);
}