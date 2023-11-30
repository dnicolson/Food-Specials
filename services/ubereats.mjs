import puppeteer from 'puppeteer';

const getSpecialsSelector = () => {
  const generateSelector = (target) => {
    const selectorPath = [];
    while (target.tagName) {
        let i = 0;
        if (target.parentNode) {
            const children = target.parentNode.children;
            while (i < children.length && children[i] !== target) {
                i++;
            }
        }
        selectorPath.unshift(target.nodeName + (
            i > 0 ? `:nth-child(${i + 1})` : ''));
        target = target.parentNode;
    }
    return selectorPath.join(' > ');
  }

  const specialsImage = document.querySelector('img[src$="promo-tag-3x.png"]');
  if (!specialsImage) {
    return null;
  }

  return generateSelector(specialsImage.closest('li'));
}

export default async({ url }, cache) => {
  const browser = await puppeteer.launch({headless: 'new'});
  const page = await browser.newPage();
  await page.setViewport({ width: 1269 + 434, height: 4000 });

  let html = '';

  try {
    await page.goto(url);
    await page.waitForXPath('//picture/img');

    const restaurants = await page.evaluate(() => {
      const anchorElements = Array.from(document.body.querySelectorAll('a[data-testid="store-card"]'));
      return anchorElements.map(anchor => anchor.href);
    });
    console.log(`${restaurants.length} restaurants`);

    for (const link of restaurants) {
      console.log(link);

      const filename = link.replace(/.*store\/([^/]+)\/.*/, '$1.png').replace(/%([0-9A-Fa-f]{2})/, '');
      const imagePath = `images/ubereats/${filename}`;
      let title;

      if (!cache.get(filename) || cache.tooOld(filename)) {
        try {
          await page.goto(link, {'waitUntil' : 'networkidle0'});
        } catch (error) {
          console.error('Error:', error);
          continue;
        }

        const specialsSelector = await page.evaluate(getSpecialsSelector);
        if (!specialsSelector) {
          console.log('Specials selector not found.');
          continue;
        }

        const elementHandle = await page.$(specialsSelector);
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
