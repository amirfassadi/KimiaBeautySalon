import assert from 'node:assert/strict';
const { default: worker } = await import(new URL('../dist/server/index.js', import.meta.url));
const env = {};
let response = await worker.fetch(new Request('https://kimia-beauty-salon.test/'), env);
assert.equal(response.status, 200);
assert.match(await response.text(), /آتلیهٔ عکاسی/);
response = await worker.fetch(new Request('https://kimia-beauty-salon.test/media/portrait.webp'), env);
assert.equal(response.status, 200);
assert.match(response.headers.get('content-type'), /image\/webp/);
assert.ok((await response.arrayBuffer()).byteLength > 10_000);
response = await worker.fetch(new Request('https://kimia-beauty-salon.test/api/health'), env);
assert.deepEqual(await response.json(), { ok: true, booking_enabled: false });
response = await worker.fetch(new Request('https://kimia-beauty-salon.test/api/bookings', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'آزمایشی', phone: '۰۹۳۰۷۸۹۷۸۲۵', service: 'atelier', consent: true, request_key: 'b408f53a-656c-44f3-b878-06ff0e0d67af', preferred_time: 'پنجشنبه عصر' }),
}), env);
assert.equal(response.status, 503, 'Booking must stay unconfigured until database secrets are present');
response = await worker.fetch(new Request('https://kimia-beauty-salon.test/api/bookings', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'تست', phone: 'not-a-phone', service: 'atelier' }),
}), env);
assert.equal(response.status, 400);
response = await worker.fetch(new Request('https://kimia-beauty-salon.test/'), env);
const homepage = await response.text();
assert.match(homepage, /تماس برای هماهنگی/);
assert.doesNotMatch(homepage, /id="openAccountBtn"/);
assert.match(homepage, /id="booking"[^>]*hidden/);
assert.match(homepage, /id="tracking"[^>]*hidden/);
console.log('Worker route tests passed: homepage, media, health, configuration gate, and input validation.');
