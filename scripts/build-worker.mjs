import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, 'server'), { recursive: true });
await mkdir(path.join(dist, '.openai'), { recursive: true });
const [html, hero, portrait, session, template, manifest, admin, platform, fontVazirmatn, fontEstedad, fontKatibeh, fontIranNastaliq] = await Promise.all([
  readFile(path.join(root, 'src/index.html'), 'utf8'),
  readFile(path.join(root, 'src/assets/kimia-atelier.webp')),
  readFile(path.join(root, 'src/assets/portrait.webp')),
  readFile(path.join(root, 'src/assets/atelier-session.webp')),
  readFile(path.join(root, 'worker/index.template.js'), 'utf8'),
  readFile(path.join(root, '.openai/hosting.json'), 'utf8'),
  readFile(path.join(root, 'src/admin.html'), 'utf8'),
  readFile(path.join(root, 'worker/platform.js'), 'utf8'),
  readFile(path.join(root, 'src/assets/fonts/Vazirmatn-wght.woff2')),
  readFile(path.join(root, 'src/assets/fonts/Estedad-wght.woff2')),
  readFile(path.join(root, 'src/assets/fonts/Katibeh-Regular.woff2')),
  readFile(path.join(root, 'src/assets/fonts/IranNastaliq.woff2')),
]);
const worker = template
  .replace('__PAGE_HTML__', () => JSON.stringify(html))
  .replace('__ADMIN_HTML__', () => JSON.stringify(admin))
  .replace('__PLATFORM_CODE__', () => platform)
  .replace('__HERO_BASE64__', JSON.stringify(hero.toString('base64')))
  .replace('__PORTRAIT_BASE64__', JSON.stringify(portrait.toString('base64')))
  .replace('__SESSION_BASE64__', JSON.stringify(session.toString('base64')))
  .replace('__FONT_VAZIRMATN_BASE64__', JSON.stringify(fontVazirmatn.toString('base64')))
  .replace('__FONT_ESTEDAD_BASE64__', JSON.stringify(fontEstedad.toString('base64')))
  .replace('__FONT_KATIBEH_BASE64__', JSON.stringify(fontKatibeh.toString('base64')))
  .replace('__FONT_IRANNASTALIQ_BASE64__', JSON.stringify(fontIranNastaliq.toString('base64')));
await writeFile(path.join(dist, 'server/index.js'), worker);
await writeFile(path.join(dist, '.openai/hosting.json'), manifest);
console.log(`Built ${path.join(dist, 'server/index.js')}`);
