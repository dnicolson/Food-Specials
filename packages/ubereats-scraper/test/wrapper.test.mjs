import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fetchOffers } from '../index.mjs';

test('rejects invalid coordinates, locales and limits before installing or requesting data', async () => {
  const location = { latitude: 52.5097995, longitude: 13.4581929 };
  for (const invalid of [
    { latitude: 91 }, { longitude: NaN }, { latitude: '52' },
    { locale: '../de' }, { limit: 0 }, { limit: 21 },
  ]) {
    await assert.rejects(fetchOffers({ ...location, ...invalid }));
  }
});

test('reports Python failures through the package API without fetching fallback data', async () => {
  const source = await mkdtemp(join(tmpdir(), 'ubereats-empty-source-'));
  try {
    await assert.rejects(fetchOffers({ latitude: 52.5, longitude: 13.4 }, {
      python: 'python3', source,
    }), /ModuleNotFoundError/);
  } finally {
    await rm(source, { recursive: true });
  }
});
