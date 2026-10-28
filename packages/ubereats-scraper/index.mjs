import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const packageDir = fileURLToPath(new URL('.', import.meta.url));
const installations = new Map();

async function runtime(options) {
  const python = options.python || process.env.UBER_EATS_PYTHON;
  const source = options.source || process.env.UBER_EATS_SOURCE;
  if (python && source) return { python, source: resolve(source) };
  if (python || source) throw new Error('Provide both python and source when using an existing scraper installation');
  const directory = resolve(options.runtimeDir || '.cache/ubereats');
  if (!installations.has(directory)) {
    const installation = execute('bash', [`${packageDir}setup.sh`, directory], {
      timeout: 5 * 60 * 1000, maxBuffer: 4 * 1024 * 1024,
    }).catch(error => {
      installations.delete(directory);
      throw error;
    });
    installations.set(directory, installation);
  }
  await installations.get(directory);
  return { python: `${directory}/venv/bin/python`, source: `${directory}/source` };
}

export async function fetchOffers({ latitude, longitude, locale = 'us', limit = 20 }, options = {}) {
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90
      || !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
    throw new Error('Valid latitude and longitude are required');
  }
  if (typeof locale !== 'string' || !/^[a-z]{2}(?:-[a-z]{2})?$/.test(locale)) {
    throw new Error('Use a country locale such as us, de or de-en');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
    throw new Error('Store limit must be between 1 and 20');
  }
  try {
    const { python, source } = await runtime(options);
    const result = execute(python, [`${packageDir}python/fetch.py`, source], {
      timeout: 8 * 60 * 1000, maxBuffer: 4 * 1024 * 1024,
    });
    result.child.stdin.on('error', () => {});
    result.child.stdin.end(JSON.stringify({ point: { latitude, longitude }, locale, limit }));
    const { stdout, stderr } = await result;
    if (stderr) console.error(stderr.trim());
    const snapshot = JSON.parse(stdout);
    if (!Array.isArray(snapshot?.stores) || !Number.isFinite(Date.parse(snapshot.fetched_at))) {
      throw new Error('Unexpected Uber Eats offer response');
    }
    return snapshot;
  } catch (error) {
    throw new Error(error.stderr?.trim() || error.message, { cause: error });
  }
}
