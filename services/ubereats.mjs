import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const freshFor = 4 * 60 * 60 * 1000;
const staleFor = 24 * 60 * 60 * 1000;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

function storeLink(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'www.ubereats.com' ? url.href : null;
  } catch {
    return null;
  }
}

function linkedName(name, href) {
  const link = storeLink(href);
  return link ? `<a href="${escapeHtml(link)}">${escapeHtml(name)}</a>` : escapeHtml(name);
}

export function requestFromUrl(value) {
  const url = new URL(value);
  const location = JSON.parse(decodeURIComponent(Buffer.from(url.searchParams.get('pl') || '', 'base64').toString()));
  const { latitude, longitude } = location;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
      || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    throw new Error('Uber Eats URL must contain valid delivery coordinates');
  }
  const locale = url.pathname.split('/').filter(Boolean)[0];
  if (!/^[a-z]{2}(?:-[a-z]{2})?$/.test(locale)) {
    throw new Error('Uber Eats URL must contain a country locale');
  }
  return { point: { latitude, longitude }, locale };
}

function validSnapshot(data) {
  return data && Number.isFinite(Date.parse(data.fetched_at)) && Array.isArray(data.stores)
    && data.stores.every(store => typeof store.name === 'string'
      && Array.isArray(store.offers) && store.offers.every(offer => typeof offer === 'string')
      && Array.isArray(store.items) && store.items.every(item => typeof item.name === 'string'
        && typeof item.offer === 'string'));
}

export function renderSpecials(data, stale = false) {
  const timestamp = new Date(data.fetched_at).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
  let html = `<p>${stale ? 'Live update unavailable. Showing saved offers from' : 'Offers updated'} <time datetime="${escapeHtml(data.fetched_at)}">${escapeHtml(timestamp)}</time>${stale ? '. These offers may have changed.' : '.'}</p>`;
  if (!data.stores.length) return `${html}<p>No current Uber Eats offers were found for this address.</p>`;
  for (const store of data.stores) {
    html += `<article><h2>${linkedName(store.name, store.link)}</h2><ul>`;
    html += store.offers.map(offer => `<li>${escapeHtml(offer)}</li>`).join('');
    html += '</ul>';
    if (store.items.length) {
      html += '<table class="table"><thead><tr><th>Item</th><th>Listed price</th><th>Offer</th></tr></thead><tbody>';
      for (const item of store.items) {
        const price = Number.isFinite(item.price) && /^[A-Z]{3}$/.test(store.currency || '')
          ? new Intl.NumberFormat('en-GB', { style: 'currency', currency: store.currency }).format(item.price) : '';
        const limit = Number.isInteger(item.max_redemptions) && item.max_redemptions > 0
          ? ` (up to ${item.max_redemptions} redemptions)` : '';
        html += `<tr><td>${linkedName(item.name, item.link)}</td><td>${escapeHtml(price)}</td><td>${escapeHtml(item.offer + limit)}</td></tr>`;
      }
      html += '</tbody></table>';
    }
    html += '</article><hr>';
  }
  return html;
}

async function fetchOffers(request) {
  const python = process.env.UBER_EATS_PYTHON || `${root}.cache/ubereats/venv/bin/python`;
  const source = process.env.UBER_EATS_SOURCE || `${root}.cache/ubereats/source`;
  const result = execFileAsync(python, [`${root}scripts/fetch-ubereats.py`, source], {
    cwd: root, timeout: 8 * 60 * 1000, maxBuffer: 4 * 1024 * 1024,
  });
  result.child.stdin.on('error', () => {});
  result.child.stdin.end(JSON.stringify(request));
  const { stdout, stderr } = await result;
  if (stderr) console.error(stderr.trim());
  return JSON.parse(stdout);
}

export default async function getSpecials({ url }, cache, retrieve = fetchOffers) {
  const request = requestFromUrl(url);
  const key = `ubereats:offers:v1:${request.locale}:${request.point.latitude},${request.point.longitude}`;
  const saved = cache.get(key);
  const age = Date.now() - Date.parse(saved?.snapshot?.fetched_at);
  const usable = validSnapshot(saved?.snapshot) && age >= 0;
  if (usable && age < freshFor) return renderSpecials(saved.snapshot);
  let snapshot;
  try {
    snapshot = await retrieve(request);
    if (!validSnapshot(snapshot)) throw new Error('Unexpected Uber Eats offer data');
  } catch (error) {
    console.error('Uber Eats live update failed:', error.stderr?.trim() || error.message);
    if (usable && age < staleFor) return renderSpecials(saved.snapshot, true);
    throw new Error('Uber Eats retrieval failed and no recent saved offers are available', { cause: error });
  }
  cache.set(key, { date: snapshot.fetched_at, snapshot });
  console.log(`Uber Eats: ${snapshot.stores.length} offer cards, ${snapshot.stores.reduce((n, store) => n + store.items.length, 0)} promoted items`);
  return renderSpecials(snapshot);
}
