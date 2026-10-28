import assert from 'node:assert/strict';
import test from 'node:test';
import getSpecials, { renderSpecials, requestFromUrl } from '../services/ubereats.mjs';

const point = { latitude: 52.5097995, longitude: 13.4581929 };
const url = `https://www.ubereats.com/de-en/search?pl=${Buffer.from(encodeURIComponent(JSON.stringify(point))).toString('base64')}`;
const key = 'ubereats:offers:de-en:52.5097995,13.4581929';

function snapshot(hoursAgo = 0) {
  return {
    fetched_at: new Date(Date.now() - hoursAgo * 3600000).toISOString(),
    stores: [{
      name: 'Burgermeister', link: 'https://www.ubereats.com/de-en/store/example/store-id',
      offers: ['Buy 1, get 1'], currency: 'EUR',
      items: [{ name: 'Cheeseburger', price: 8.4, offer: 'Buy 1, get 1 free', max_redemptions: 3 }],
    }],
  };
}

function memoryCache(data) {
  const items = data ? { [key]: { snapshot: data } } : {};
  return { items, get: key => items[key], set: (key, value) => { items[key] = value; } };
}

test('uses the configured delivery point and locale', () => {
  assert.deepEqual(requestFromUrl(url), { point, locale: 'de-en' });
  assert.throws(() => requestFromUrl('https://www.ubereats.com/de-en/search'));
});

test('renders offer details while escaping upstream text and rejecting unsafe links', () => {
  const data = snapshot();
  data.stores[0].name = '<script>alert("test")</script>';
  data.stores[0].link = 'javascript:alert(1)';
  data.stores[0].items[0].link = 'https://untrusted.example/item';
  const html = renderSpecials(data);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>|javascript:|untrusted.example/);
  assert.match(html, /€8\.40/);
  assert.match(html, /up to 3 redemptions/);
});

test('fresh saved offers avoid a network request', async () => {
  const cache = memoryCache(snapshot(1));
  const html = await getSpecials({ url }, cache, () => { throw new Error('Unexpected network call'); });
  assert.match(html, /Burgermeister/);
  assert.doesNotMatch(html, /Live update unavailable/);
});

test('successful retrieval replaces old data', async () => {
  const cache = memoryCache(snapshot(5));
  const fresh = snapshot();
  await getSpecials({ url }, cache, async request => {
    assert.deepEqual(request.point, point);
    return fresh;
  });
  assert.equal(cache.get(key).snapshot, fresh);
});

test('failed retrieval shows the age of recent saved offers without refreshing their date', async () => {
  const saved = snapshot(5);
  const cache = memoryCache(saved);
  const html = await getSpecials({ url }, cache, async () => { throw new Error('HTTP 403'); });
  assert.match(html, /Live update unavailable/);
  assert.match(html, /These offers may have changed/);
  assert.equal(cache.get(key).snapshot.fetched_at, saved.fetched_at);
});

test('failed retrieval without recent data rejects instead of producing a successful empty build', async () => {
  for (const data of [undefined, snapshot(25)]) {
    await assert.rejects(getSpecials({ url }, memoryCache(data), async () => {
      throw new Error('HTTP 403');
    }), /no recent saved offers/);
  }
});

test('a valid empty result differs from malformed retrieval', async () => {
  const empty = { ...snapshot(), stores: [] };
  assert.match(await getSpecials({ url }, memoryCache(), async () => empty), /No current Uber Eats offers/);
  await assert.rejects(getSpecials({ url }, memoryCache(), async () => ({ stores: [] })), /retrieval failed/);
});
