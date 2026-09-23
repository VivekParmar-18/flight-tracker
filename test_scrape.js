import { chromium } from 'playwright';

async function test() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  // We can also directly pass airlines=AI filter to Google Flights!
  // In Google Flights, filter airline: &f=airlines:AI
  const url = 'https://www.google.com/travel/flights?q=flights+from+YYZ+to+AMD+on+2027-01-10+to+2027-02-06&hl=en&curr=CAD';
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);

  const airIndiaCards = await page.evaluate(() => {
    const listItems = Array.from(document.querySelectorAll('li.pIav2d'));
    const matched = [];

    for (const item of listItems) {
      const text = item.innerText || '';
      if (text.includes('Air India')) {
        // Find price span
        const priceSpan = item.querySelector('span[aria-label*="Canadian dollars"], span[aria-label*="dollars"], .YMlIz > span');
        let price = null;
        if (priceSpan) {
          const aria = priceSpan.getAttribute('aria-label') || '';
          const m = aria.match(/(\d+[\d,]*)\s*Canadian dollars/i) || aria.match(/(\d+[\d,]*)\s*dollars/i);
          if (m) {
            price = parseInt(m[1].replace(/,/g, ''), 10);
          } else {
            const tm = priceSpan.innerText.match(/CA?\$([\d,]+)/);
            if (tm) price = parseInt(tm[1].replace(/,/g, ''), 10);
          }
        }

        matched.push({
          price,
          text
        });
      }
    }
    return matched;
  });

  console.log('Air India Cards found:', airIndiaCards.length);
  console.dir(airIndiaCards, { depth: null });
  await browser.close();
}

test();
