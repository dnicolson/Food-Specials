import puppeteer from 'puppeteer';

const textsToSearch = ['2 for 1 burger 🍔', 'Exclusive partner deals 💸', 'Wolt Specials', 'Offers near you'];

function flattenArray(arr) {
  return arr.flatMap(element => Array.isArray(element) ? flattenArray(element) : element);
}

export default async({ url, postCode }, cache) => {
   const browser = await puppeteer.launch({headless: 'new'});
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 4000 });
  let html = '';

  try {
    await page.goto(url);
    
    await page.waitForSelector('button[data-localization-key="gdpr-consents.banner.accept-button"]');
    await page.click('button[data-localization-key="gdpr-consents.banner.accept-button"]');

    const addressInput = 'input[data-test-id="address-picker-input.input"]';
    await page.waitForSelector(addressInput);
    await page.type(addressInput, postCode);

    const matchSelector = `(//div[contains(text(), "${postCode}") and starts-with(@class, "sc")])[1]`;
    await page.waitForXPath(matchSelector);
    const [result] = await page.$x(matchSelector);
    if (!result) {
      console.log('Error entering address.');
      return;
    }

    await result.click();

    await page.waitForTimeout(5000);

    await page.waitForSelector('h2');

    const restaurantsUnflattened = await page.evaluate((textsToSearch) => {
      const results = textsToSearch.map((targetText) => {
        const elements = document.querySelectorAll('*');

        const heading = Array.from(elements).filter((element) => {
          return element.innerHTML.includes(targetText);
        }).filter((element) => element.tagName === 'H2')[0];

        if (!heading) {
          return [];
        }

        return Array.from(heading.parentElement.parentElement.nextElementSibling.getElementsByTagName('a')).map(x => x.getAttribute('href'));
      });

      return results;
    }, textsToSearch);

    const restaurants = flattenArray(restaurantsUnflattened).filter((name) => name.match(/\/restaurant\//))
                          .filter((value, index, array) => array.indexOf(value) === index)
                          .map(link => `https://wolt.com${link}`)

    console.log(`${restaurants.length} restaurants`);

    for (const link of restaurants) {
      console.log(link);

      const filename = link.replace(/.*(?:discover|restaurant)\/([^\/]+)(\/.*)?/, '$1.png');
      const imagePath = `images/wolt/${filename}`;
      let title;

      if (!cache.get(filename) || cache.tooOld(filename)) {
        try {
          await page.goto(link);
        } catch (error) {
          console.error('Error:', error);
          continue;
        }

        const specialsSelector = '(//*[@data-test-id="MenuSection"])[1]';
        try {
          await page.waitForXPath(specialsSelector);
        } catch (error) {
          console.error('Error:', error);
          continue;
        }

        const elementHandle = (await page.$x(specialsSelector))[0];
        if (!elementHandle) {
          console.log('Specials element not found.');
          continue;
        }

        const boundingBox = await elementHandle.boundingBox();
        if (boundingBox) {
          const screenshotOptions = {
            path: imagePath,
            clip: boundingBox,
          };
          await elementHandle.screenshot(screenshotOptions);
        }

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
