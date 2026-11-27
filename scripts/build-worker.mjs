import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, 'server'), { recursive: true });
await mkdir(path.join(dist, '.openai'), { recursive: true });
const [html, hero, portrait, session, template, manifest, admin, platform, fontVazirmatn, fontEstedad, fontKatibeh, fontIranNastaliq] = await Promise.all([
  readFile(path.join(root, 'src/index.html'), 'utf8'),
  readFile(path.join(root, 'src/assets/kimia-salon-hero.webp')),
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
const heroPath = '/media/hero-' + createHash('sha256').update(hero).digest('hex').slice(0, 12) + '.webp';
const offerImage = await readFile(path.join(root, 'src/assets/black-friday-haircut-crop.webp'));
const offerImagePath = '/media/black-friday-' + createHash('sha256').update(offerImage).digest('hex').slice(0, 12) + '.webp';
const seo = await readFile(path.join(root, 'worker/seo.js'), 'utf8') + '\n' + await readFile(path.join(root, 'worker/service-guides.js'), 'utf8') + '\n' + await readFile(path.join(root, 'worker/navigation.js'), 'utf8');
const worker = template
  .replace('__PAGE_HTML__', () => JSON.stringify(html.replaceAll('/media/atelier.webp', heroPath).replaceAll('/media/black-friday-haircut-crop.webp', offerImagePath).replace('__OFFER_PRELOAD_URL__', offerImagePath)))
  .replace('__OFFER_MEDIA_PATH__', JSON.stringify(offerImagePath))
  .replace('__OFFER_BASE64__', JSON.stringify(offerImage.toString('base64')))
  .replace('__ADMIN_HTML__', () => JSON.stringify(admin))
  .replace('__PLATFORM_CODE__', () => platform)
  .replace('__SEO_CODE__', () => seo)
  .replace('__HERO_BASE64__', JSON.stringify(hero.toString('base64')))
  .replace('__HERO_MEDIA_PATH__', JSON.stringify(heroPath))
  .replace('__HERO_VERSIONED_BASE64__', JSON.stringify(hero.toString('base64')))
  .replace('__PORTRAIT_BASE64__', JSON.stringify(portrait.toString('base64')))
  .replace('__SESSION_BASE64__', JSON.stringify(session.toString('base64')))
  .replace('__FONT_VAZIRMATN_BASE64__', JSON.stringify(fontVazirmatn.toString('base64')))
  .replace('__FONT_ESTEDAD_BASE64__', JSON.stringify(fontEstedad.toString('base64')))
  .replace('__FONT_KATIBEH_BASE64__', JSON.stringify(fontKatibeh.toString('base64')))
  .replace('__FONT_IRANNASTALIQ_BASE64__', JSON.stringify(fontIranNastaliq.toString('base64')));
await writeFile(path.join(dist, 'server/index.js'), worker);
await writeFile(path.join(dist, '.openai/hosting.json'), manifest);
console.log(`Built ${path.join(dist, 'server/index.js')}`);
