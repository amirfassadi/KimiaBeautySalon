import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const workerFile = path.join(root, 'dist/server/index.js');

// Development adapter only. The production entry remains the generated Worker.
export function kimiaPreview() {
  let pending;
  let generation = 0;
  let dirty = true;

  async function loadWorker() {
    if (dirty && !pending) {
      dirty = false;
      pending = (async () => {
        await exec(process.execPath, [path.join(root, 'scripts/build-worker.mjs')], { cwd: root });
        return (await import(pathToFileURL(workerFile).href + '?preview=' + (++generation))).default;
      })().catch(error => { dirty = true; pending = undefined; throw error; });
    }
    return pending;
  }

  return {
    name: 'kimia-worker-preview',
    configureServer(server) {
      const watched = ['src', 'worker', '.openai'].map(dir => path.join(root, dir) + path.sep);
      const onChange = file => {
        if (watched.some(dir => path.resolve(file).startsWith(dir))) {
          dirty = true;
          pending = undefined;
          server.ws.send({ type: 'full-reload' });
        }
      };
      server.watcher.on('change', onChange);
      server.watcher.on('add', onChange);
      server.httpServer?.once('close', () => {
        server.watcher.off('change', onChange);
        server.watcher.off('add', onChange);
      });

      server.middlewares.use(async (incoming, outgoing, next) => {
        const requestPath = incoming.url || '/';
        if (/^\/(?:@|node_modules\/|__vite)/.test(requestPath)) return next();
        try {
          const chunks = [];
          let size = 0;
          for await (const chunk of incoming) {
            size += chunk.length;
            if (size > 6 * 1024 * 1024) {
              outgoing.writeHead(413).end('Request too large');
              return;
            }
            chunks.push(chunk);
          }
          const headers = new Headers();
          for (const [key, value] of Object.entries(incoming.headers)) {
            if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
          }
          // Hosting identity headers must never be accepted from local clients.
          headers.delete('oai-authenticated-user-id');
          headers.delete('oai-authenticated-user-email');
          const method = incoming.method || 'GET';
          const url = new URL(requestPath, 'http://' + (incoming.headers.host || 'localhost:3000'));
          const request = new Request(url, {
            method, headers,
            ...(!['GET', 'HEAD'].includes(method) ? { body: Buffer.concat(chunks) } : {}),
          });
          const worker = await loadWorker();
          // Preview is intentionally offline: no database credentials or fake persistence.
          const response = await worker.fetch(request, {});
          const responseHeaders = Object.fromEntries(response.headers.entries());
          responseHeaders['cache-control'] = 'no-store';
          let body = Buffer.from(await response.arrayBuffer());
          if (responseHeaders['content-type']?.includes('text/html')) {
            body = Buffer.from(await server.transformIndexHtml(url.pathname, body.toString('utf8')));
          }
          outgoing.writeHead(response.status, responseHeaders);
          outgoing.end(method === 'HEAD' ? undefined : body);
        } catch (error) {
          server.config.logger.error(String(error?.stack || error));
          outgoing.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
          outgoing.end('Preview could not start. Check the development server log.');
        }
      });
    },
  };
}
