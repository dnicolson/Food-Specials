# Uber Eats scraper for JavaScript

A small JS wrapper around the pinned
[OmkarCloud Python scraper](https://github.com/omkarcloud/uber-eats-scraper).
Returns nearby offers and promoted menu items as JSON. Includes TypeScript
declarations and has no npm runtime dependencies.

```js
import { fetchOffers } from '@food-specials/ubereats-scraper';

const snapshot = await fetchOffers({
  latitude: 52.5097995,
  longitude: 13.4581929,
  locale: 'de-en',
  limit: 20,
});

console.log(snapshot.stores);
```

Requires Node 20+, Python 3.11, Git and Bash. On the first call, the wrapper
installs the pinned scraper and Python dependencies in `.cache/ubereats`
relative to the calling application's working directory. Later calls reuse
that installation. It does not run setup during npm installation.

The second argument accepts `runtimeDir` to choose another installation
directory, or both `python` and `source` to use an existing installation.
`UBER_EATS_PYTHON` and `UBER_EATS_SOURCE` provide the same override for CI.

The returned snapshot contains `fetched_at`, `total_offer_stores` and `stores`.
Each store contains its name, link, offer labels, currency, promoted `items`
and `menu_available`. Each item contains its name, link, listed price, offer
description and any redemption limit. `limit` defaults to 20 and accepts 1–20.
`locale` defaults to `us`.

Each call fetches a feed and up to `limit` menus. Feed failures reject the
promise. Individual menu failures retain the feed offers and set
`menu_available` to false. The calling application owns caching and rendering.

Food-Specials consumes this folder through a `file:` dependency. It can be
copied to a separate repository or installed from an `npm pack` tarball without
changes to its source. The package remains private until explicitly published.

Run its offline checks with `npm test` from this directory. The optional
`diagnostics/compare.py` source script compares the upstream transport against
sample and Berlin requests and is excluded from the npm package.
