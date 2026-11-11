import assert from 'node:assert/strict';

const {default: worker} = await import('../dist/server/index.js');
const origin = 'https://kimia.test';
const admin = {'oai-authenticated-user-id': 'admin-1', 'oai-authenticated-user-email': 'owner@example.test'};
const serviceId = '11111111-1111-4111-8111-111111111111';
const inactiveId = '22222222-2222-4222-8222-222222222222';
const imagePath = '/uploads/33333333-3333-4333-8333-333333333333.webp';
let settings = {
  name: 'کیمیا آزمایشی',
  phone: '+989111111111',
  address: 'تهران، ونک، خیابان آزمایشی',
  hero_title: 'عنوان آزمایشی',
  hero_description: 'توضیح آزمایشی قابل مشاهده',
  public_base_url: 'https://panel.example.test',
  hero_image_url: imagePath,
  hero_image_published: false,
  hero_image_consent_confirmed: false,
};
const services = [
  {id: serviceId, slug: 'custom-service', name_fa: 'خدمت تازه', description_fa: 'توضیح خدمت تازه', details_fa: 'جزئیات', is_active: true, sort_order: 1},
  {id: inactiveId, slug: 'hidden-service', name_fa: 'خدمت مخفی', description_fa: 'نباید نمایش داده شود', details_fa: '', is_active: false, sort_order: 2},
];
const env = {
  SUPABASE_URL: 'https://db.example.test',
  SUPABASE_SECRET_KEY: 'test-secret',
  RATE_LIMIT_SALT: 'test-salt',
  ADMIN_EMAILS: 'owner@example.test',
  BUCKET: {
    async get(key) {
      return key === imagePath.slice('/uploads/'.length) ? {
        body: new Uint8Array([1, 2, 3]),
        httpMetadata: {contentType: 'image/webp'},
      } : null;
    },
  },
};

globalThis.fetch = async input => {
  const url = new URL(input);
  const path = url.pathname.replace('/rest/v1/', '');
  if (path === 'site_settings') return Response.json([{content: settings}]);
  if (path === 'services') return Response.json(services.filter(service => url.searchParams.get('is_active') !== 'eq.true' || service.is_active));
  if (path === 'gallery_items') return Response.json([]);
  if (path === 'business_hours') return Response.json([]);
  if (path === 'staff_members') return Response.json([]);
  throw new Error(`Unexpected database path: ${path}`);
};

const request = (path, options = {}) => new Request(origin + path, options);
let response = await worker.fetch(request('/'), env);
let homepage = await response.text();
assert.equal(response.status, 200);
assert.match(homepage, /خدمت تازه/);
assert.doesNotMatch(homepage, /میکاپ و گریم/);
assert.match(homepage, /عنوان آزمایشی/);
assert.match(homepage, /توضیح آزمایشی قابل مشاهده/);
assert.match(homepage, /tel:\+989111111111/);
assert.match(homepage, /تهران، ونک، خیابان آزمایشی/);
assert.doesNotMatch(homepage, /href="#booking"/);

response = await worker.fetch(request('/sitemap.xml'), env);
const sitemap = await response.text();
assert.match(sitemap, /https:\/\/panel\.example\.test\/services\/custom-service/);
assert.doesNotMatch(sitemap, /hidden-service/);
response = await worker.fetch(request('/services/hidden-service'), env);
assert.equal(response.status, 404);
response = await worker.fetch(request('/robots.txt'), env);
assert.match(await response.text(), /Sitemap: https:\/\/panel\.example\.test\/sitemap\.xml/);

response = await worker.fetch(request(imagePath, {headers: admin}), env);
assert.equal(response.status, 200);
response = await worker.fetch(request(imagePath), env);
assert.equal(response.status, 404);

settings.hero_image_published = true;
settings.hero_image_consent_confirmed = true;
response = await worker.fetch(request('/api/admin/settings', {
  method: 'PUT',
  headers: {...admin, origin, 'content-type': 'application/json'},
  body: JSON.stringify(settings),
}), env);
assert.equal(response.status, 200);
response = await worker.fetch(request('/'), env);
homepage = await response.text();
assert.match(homepage, /background-image:[^;]*33333333-3333-4333-8333-333333333333\.webp/);
response = await worker.fetch(request(imagePath), env);
assert.equal(response.status, 200);

console.log('Launch content behavior passed: dynamic services, inactive service exclusion, settings, SEO origin, contact links, and hero image publication.');
