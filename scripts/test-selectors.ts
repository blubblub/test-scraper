/**
 * test-selectors.ts
 *
 * Loads saved HTML snapshots from snapshots/ and tests the current selectors,
 * reporting which fields are populated vs null.
 *
 * Usage: npx tsx scripts/test-selectors.ts
 */
import { chromium } from 'playwright';
import { readdirSync, existsSync } from 'fs';
import { join, resolve } from 'path';

const SNAPSHOT_DIR = resolve(import.meta.dirname ?? '.', '..', 'snapshots');

async function testDetailPage(page: any, file: string) {
    const filePath = join(SNAPSHOT_DIR, file);
    await page.goto(`file://${filePath}`, { waitUntil: 'domcontentloaded' });

    console.log(`\n=== ${file} ===`);

    const results = await page.evaluate(() => {
        const r: Record<string, any> = {};

        // Title — h3
        const h3 = document.querySelector('h3');
        r.title = h3?.textContent?.trim() ?? null;

        // Price — comment anchor approach
        r.priceComment = null;
        r.priceCss = null;
        try {
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_COMMENT);
            let node;
            while ((node = walker.nextNode())) {
                const val = (node.nodeValue ?? '').trim();
                if (val.includes('PRICE')) {
                    r.priceComment = `Found comment: "${val}"`;
                    const sibling = (node as any).nextElementSibling ?? (node as any).nextSibling;
                    if (sibling) {
                        r.priceFromComment = sibling.textContent?.trim().substring(0, 100) ?? null;
                    }
                }
            }
        } catch {}
        // CSS fallback
        const priceEl = document.querySelector('.text-danger.font-weight-bold span, .text-danger.font-weight-bold');
        r.priceCss = priceEl?.textContent?.trim().substring(0, 100) ?? null;

        // Specs — comment anchor approach
        r.dataComment = null;
        r.specsFromComment = null;
        try {
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_COMMENT);
            let node;
            while ((node = walker.nextNode())) {
                const val = (node.nodeValue ?? '').trim();
                if (val.includes('DATA')) {
                    r.dataComment = `Found comment: "${val}"`;
                    // Find next table sibling
                    let el: any = node;
                    while (el && el.nodeName !== 'TABLE') {
                        el = el.nextSibling ?? el.nextElementSibling;
                    }
                    if (el?.nodeName === 'TABLE') {
                        const rows = el.querySelectorAll('tr');
                        const specs: Record<string, string> = {};
                        rows.forEach((row: any) => {
                            const th = row.querySelector('th');
                            const td = row.querySelector('td');
                            if (th && td) {
                                specs[th.textContent?.trim() ?? ''] = td.textContent?.trim() ?? '';
                            }
                        });
                        r.specsFromComment = specs;
                    }
                }
            }
        } catch {}

        // CSS fallback for specs
        const tables = document.querySelectorAll('table.table-sm');
        r.tableSm_count = tables.length;

        // All comments in page (for debugging)
        const comments: string[] = [];
        const cw = document.createTreeWalker(document.body, NodeFilter.SHOW_COMMENT);
        let cn;
        while ((cn = cw.nextNode())) {
            comments.push((cn.nodeValue ?? '').trim().substring(0, 80));
        }
        r.allComments = comments;

        // Images
        const imgs = document.querySelectorAll('.GO-OglasPhoto img, img[src*="images.avto.net"], #BigPhoto');
        r.imageCount = imgs.length;

        // Phone
        const telLink = document.querySelector('a[href^="tel:"]');
        r.phone = telLink?.textContent?.trim() ?? null;

        // Seller
        const phoneIcon = document.querySelector('.fa-phone-square');
        r.hasPhoneIcon = !!phoneIcon;
        const userIcon = document.querySelector('.fa-user');
        r.hasUserIcon = !!userIcon;

        return r;
    });

    // Report
    for (const [key, value] of Object.entries(results)) {
        const status = value === null || value === undefined ? '❌ null' :
            (typeof value === 'object' && Object.keys(value).length === 0) ? '⚠️ empty' :
            '✅';
        const display = typeof value === 'object' ? JSON.stringify(value).substring(0, 120) : String(value).substring(0, 120);
        console.log(`  ${status} ${key}: ${display}`);
    }
}

async function testSearchPage(page: any, file: string) {
    const filePath = join(SNAPSHOT_DIR, file);
    await page.goto(`file://${filePath}`, { waitUntil: 'domcontentloaded' });

    console.log(`\n=== ${file} ===`);

    const results = await page.evaluate(() => {
        const r: Record<string, any> = {};
        r.resultRows = document.querySelectorAll('.GO-Results-Row').length;
        r.titles = document.querySelectorAll('.GO-Results-Naziv').length;
        r.prices = document.querySelectorAll('.GO-Results-Top-Price, .GO-Results-Price').length;
        r.links = document.querySelectorAll('a.stretched-link').length;
        r.detailLinks = document.querySelectorAll('a[href*="details.asp"]').length;
        r.nextPage = document.querySelectorAll('li.GO-Rounded-R').length;
        return r;
    });

    for (const [key, value] of Object.entries(results)) {
        console.log(`  ${value === 0 ? '❌' : '✅'} ${key}: ${value}`);
    }
}

async function main() {
    if (!existsSync(SNAPSHOT_DIR)) {
        console.error('No snapshots/ directory found. Save HTML snapshots first (see snapshots/README.md).');
        process.exit(1);
    }

    const files = readdirSync(SNAPSHOT_DIR).filter(f => f.endsWith('.html'));
    if (files.length === 0) {
        console.error('No .html files in snapshots/. Save avto.net pages manually (see snapshots/README.md).');
        process.exit(1);
    }

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    const detailFiles = files.filter(f => f.startsWith('detail'));
    const searchFiles = files.filter(f => f.startsWith('search'));

    if (searchFiles.length > 0) {
        console.log('\n📋 SEARCH RESULTS PAGES');
        for (const f of searchFiles) await testSearchPage(page, f);
    }

    if (detailFiles.length > 0) {
        console.log('\n📄 DETAIL PAGES');
        for (const f of detailFiles) await testDetailPage(page, f);
    }

    await browser.close();
    console.log('\nDone.');
}

main().catch(console.error);
