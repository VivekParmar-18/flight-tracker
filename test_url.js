import { chromium } from 'playwright';

async function testUrl() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  const testUrl = 'https://www.google.com/travel/flights?q=Air+India+flights+from+YYZ+to+AMD+on+2027-01-10+to+2027-02-06+1+stop&hl=en&curr=CAD';
  console.log('Testing URL:', testUrl);
  await page.goto(testUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);

  const results = await page.evaluate(() => {
    const listItems = Array.from(document.querySelectorAll('li.pIav2d'));
    return listItems.map(item => {
      const text = item.innerText || '';
      return text.split('\n').filter(l => l.trim().length > 0).slice(0, 8);
    });
  });

  console.log('Results returned:', results.length);
  console.log('First 3 results:', JSON.stringify(results.slice(0, 3), null, 2));

  await browser.close();
}

testUrl();
