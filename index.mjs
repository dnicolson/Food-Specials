import fs from 'fs';
import ubereats from './services/ubereats.mjs';
import wolt from './services/wolt.mjs';
import lieferando from './services/lieferando.mjs';

const CONFIG = {
  ubereats: {
    url: 'https://www.ubereats.com/de-en/search?carid=eyJwbHVnaW4iOiJyZWNvbW1lbmRhdGlvbkZlZWRQbHVnaW4iLCJyZWNvbW1UeXBlIjoicHJvbW90ZWRfcmVzdGF1cmFudHMifQ%3D%3D&pl=JTdCJTIyYWRkcmVzcyUyMiUzQSUyMkdhYnJpZWwtTWF4LVN0cmElQzMlOUZlJTIwMiUyMiUyQyUyMnJlZmVyZW5jZSUyMiUzQSUyMkNoSUp0ZTlWelY1T3FFY1JTMEt1NlZBbUZfVSUyMiUyQyUyMnJlZmVyZW5jZVR5cGUlMjIlM0ElMjJnb29nbGVfcGxhY2VzJTIyJTJDJTIybGF0aXR1ZGUlMjIlM0E1Mi41MDk3OTk1JTJDJTIybG9uZ2l0dWRlJTIyJTNBMTMuNDU4MTkyOSU3RA%3D%3D&sc=HOME_FEED_ITEM&title=Today%E2%80%99s%20offers'
  },
  wolt: {
    url: 'https://wolt.com/en/deu',
    postCode: '10245'
  },
  lieferando: {
    // url: 'https://www.lieferando.de/lieferservice/essen/berlin-10245'
    deliveryAreaId: '1205675',
    postalCode: '10245',
  }
};

let items;
try {
  items = JSON.parse(fs.readFileSync('cache.json', 'utf-8'));
} catch (error) {
  items = {}
}

const cache = {
  items,
  get: function (key) {
    if (this.items[key]) {
      return this.items[key];
    }
  },
  set: function (key, value) {
    this.items[key] = value;
    fs.writeFileSync('cache.json', JSON.stringify(this.items));
  },
  tooOld: function (key) {
    return (new Date() - new Date(this.items[key]['date'])) > 4 * 60 * 60 * 1000;
  },
};

(async () => {
  let html = fs.readFileSync('template.html', 'utf-8');

  const services = {
    'ubereats': ubereats,
    'wolt': wolt,
    // 'lieferando': lieferando,
  }

  for (const service of Object.keys(services)) {
    if (!fs.existsSync(`images/${service}`)) {
      fs.mkdirSync(`images/${service}`, { recursive: true });
    }
    html = html.replace(`{{${service}}}`, await services[service](CONFIG[service], cache));
  };

  fs.writeFileSync('index.html', html);
})();
