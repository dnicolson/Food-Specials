import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

export default async ({ deliveryAreaId, postalCode }, cache) => {
  const response = await fetch(`https://cw-api.takeaway.com/api/v33/restaurants?deliveryAreaId=${deliveryAreaId}&postalCode=${postalCode}&lat=52.500629437689376&lng=13.464779782091698&limit=0&isAccurate=true&filterShowTestRestaurants=false`, {
    "headers": {
      "x-country-code": "de",
      "x-language-code": "de",
    }
  });

  const browser = await puppeteer.use(StealthPlugin()).launch({headless: 'new'});
  const page = (await browser.pages())[0];
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
  await page.setExtraHTTPHeaders({
    'accept-language': 'en-US,en;q=0.9'
  });

  await page.setViewport({ width: 1200, height: 4000 });

  let html = '';

  try {
    const restaurantsData = (await response.json()).restaurants;
    const restaurants = Object.values(restaurantsData).filter(r => r.supports.discounts)
                                                      .map(r => r.primarySlug)
                                                      .map(link => `https://www.lieferando.de/en/menu/${link}`);
    console.log(`${restaurants.length} restaurants`);

    for (const link of restaurants) {
      console.log(link);

      const filename = link.replace(/.*en\/menu\/([^\/]+)(\/.*)?/, '$1.png');
      const imagePath = `images/lieferando/${filename}`;
      let title;

      if (!cache.get(filename) || cache.tooOld(filename)) {
        try {
          await page.goto(`${link}#discounts`, {'waitUntil': 'networkidle0'});
        } catch (error) {
          console.error('Error:', error);
          continue;
        }

        const specialsSelector = 'div[data-qa=modal-content]';
        try {
          await page.waitForSelector(specialsSelector);
        } catch (error) {
          console.log('Modal content element not found.');
          continue;
        }

        const elementHandle = await page.$(specialsSelector);
        if (!elementHandle) {
          console.log('Specials element not found.');
          continue;
        }

        await elementHandle.screenshot({path: imagePath});

        title = await page.$eval('h1', h1 => h1.textContent);

        cache.set(filename, {
          title,
          date: new Date()
        });
      }

      title = cache.get(filename)['title'];

      html += `<h2><a href="${link}">${title}</a></h2>
               <img src="${imagePath}">
               <hr>`;
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await browser.close();
  }

  return html;
};
