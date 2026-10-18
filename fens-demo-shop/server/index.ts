import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import express from 'express';
import { api } from './api.js';
import { CLIENT_DIR, DEV, PORT, ROOT, SSR_ENTRY, VERSION } from './config.js';
import { pages, robots, sitemap, type HtmlLoader, type PageRenderer } from './pages.js';
import { sessions } from './session.js';
interface SsrModule {
  render: (path: string) => string;
}
async function main(): Promise<void> {
  const app = express();
  app.disable('x-powered-by');
  app.get('/robots.txt', robots());
  app.get('/sitemap.xml', sitemap());
  let loadHtml: HtmlLoader;
  let render: PageRenderer;
  if (DEV) {
    const { createServer } = await import('vite');
    const vite = await createServer({
      root: ROOT,
      appType: 'custom',
      server: { middlewareMode: true, hmr: { port: PORT + 20000 } },
    });
    app.use(vite.middlewares);
    loadHtml = async (url) =>
      vite.transformIndexHtml(url, await readFile(join(ROOT, 'index.html'), 'utf8'));
    render = async (path) =>
      ((await vite.ssrLoadModule('/src/entry-server.tsx')) as SsrModule).render(path);
  } else {
    const indexFile = join(CLIENT_DIR, 'index.html');
    if (!existsSync(indexFile)) {
      throw new Error(`No build at ${CLIENT_DIR}. Run npm run serve:${VERSION} (it builds first).`);
    }
    app.use(express.static(CLIENT_DIR, { index: false, redirect: false }));
    loadHtml = async () => readFile(indexFile, 'utf8');
    if (!existsSync(SSR_ENTRY)) {
      throw new Error(
        `No server render at ${SSR_ENTRY}. Run npm run serve:${VERSION} (it builds first).`,
      );
    }
    const ssr = (await import(pathToFileURL(SSR_ENTRY).href)) as SsrModule;
    render = async (path) => ssr.render(path);
  }
  app.use(sessions());
  app.use('/api', api());
  app.use(pages(loadHtml, render));
  app.listen(PORT, () => {
    console.log(`Fence ${VERSION} (${DEV ? 'dev' : 'built'}) on http://localhost:${PORT}`);
  });
}
main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
