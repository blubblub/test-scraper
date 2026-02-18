import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
});
const page = await context.newPage();

console.log('Loading search page...');
await page.goto('https://www.avto.net/Ads/results.asp?zession=&Ession=&TypeView=&Eession=&Kession=&Fession=&Ression=&Aession=&Tession=&Zession=&Session=&Pession=&Gession=&Ession2=&oession=&iession=&jession=&dession=&hession=&aession=', { waitUntil: 'networkidle', timeout: 60000 });

await page.waitForTimeout(10000);

const pageTitle = await page.title();
console.log('Page title:', pageTitle);

const links = await page.$$eval('a[href*="details.asp"]', els => els.slice(0, 3).map(a => a.href)).catch(() => []);
console.log('Listing links:', links);

if (links.length > 0) {
    console.log('\n--- NAVIGATING TO LISTING ---');
    await page.goto(links[0], { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(5000);
    
    const structure = await page.evaluate(() => {
        const result = {};
        const allElements = document.querySelectorAll('*[class]');
        const classNames = new Set();
        allElements.forEach(el => {
            if (typeof el.className === 'string') {
                el.className.split(/\s+/).forEach(c => {
                    if (c && c.length > 2) classNames.add(c);
                });
            }
        });
        result.classNames = [...classNames].sort();
        result.headings = [...document.querySelectorAll('h1, h2, h3, h4')].map(h => ({
            tag: h.tagName, text: h.textContent?.trim().slice(0, 100), class: h.className
        }));
        result.tables = [...document.querySelectorAll('table')].map(t => ({
            class: t.className, rows: t.rows.length,
            sample: [...t.rows].slice(0, 3).map(r => r.textContent?.trim().slice(0, 200))
        }));
        const allNodes = document.body.querySelectorAll('*');
        const prices = [];
        allNodes.forEach(el => {
            const t = el.textContent?.trim() || '';
            if (el.children.length === 0 && (t.includes('€') || t.match(/[\d.,]+\s*EUR/))) {
                prices.push({ tag: el.tagName, class: el.className, id: el.id, text: t.slice(0, 100), parentClass: el.parentElement?.className });
            }
        });
        result.prices = prices.slice(0, 5);
        result.bodyTextSample = document.body.innerText.slice(0, 3000);
        return result;
    });
    
    console.log(JSON.stringify(structure, null, 2));
} else {
    console.log('No listings found. Body text:');
    const body = await page.evaluate(() => document.body.innerText.slice(0, 2000));
    console.log(body);
}

await browser.close();
