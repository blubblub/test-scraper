/**
 * Offline test: validate search page selectors against saved HTML snapshots.
 * Run: node test-search-cheerio.mjs
 */
import { readFileSync, existsSync } from 'fs';
import { load } from 'cheerio';

const snapshotFiles = [
    'snapshots/search-results.html',
    'snapshots/search-all-dealers.html',
    'snapshots/search-bmw.html',
    'snapshots/search-audi.html',
];

let totalPassed = 0;
let totalFailed = 0;

for (const file of snapshotFiles) {
    if (!existsSync(file)) {
        console.log(`⏭  Skipping ${file} (not found)`);
        continue;
    }

    console.log(`\n📄 Testing: ${file}`);
    const html = readFileSync(file, 'utf8');
    const $ = load(html);

    const rows = $('.GO-Results-Row');
    console.log(`  Listing cards (.GO-Results-Row): ${rows.length}`);

    if (rows.length === 0) {
        console.log('  ❌ No listing cards found');
        totalFailed++;
        continue;
    }

    let titles = 0, urls = 0, prices = 0, thumbnails = 0, specs = 0;

    rows.each((i, row) => {
        const $row = $(row);

        // Title
        const title = $row.find('.GO-Results-Naziv').text().trim();
        if (title) titles++;

        // Detail URL
        const href = $row.find('a[href*="details.asp"]').attr('href');
        if (href) urls++;

        // Price — two layout variants
        const price = $row.find('.GO-Results-Top-Price-TXT-Regular, .GO-Results-Price-TXT-Regular').first().text().trim();
        if (price) prices++;

        // Thumbnail — two layout variants
        const img = $row.find('.GO-Results-Top-Photo img, .GO-Results-Photo img').first();
        const src = img.attr('src') || img.attr('data-src');
        if (src) thumbnails++;

        // Specs table — two layout variants
        const specRows = $row.find('.GO-Results-Top-Data-Top:not(.d-none) table tr, .GO-Results-Data table tr');
        if (specRows.length > 0) specs++;
    });

    const total = rows.length;
    const checks = [
        ['Title', titles, total],
        ['Detail URL', urls, total],
        ['Price', prices, total],
        ['Thumbnail', thumbnails, total],
        ['Specs', specs, total],
    ];

    for (const [name, found, expected] of checks) {
        const pct = ((found / expected) * 100).toFixed(0);
        const ok = found > 0;
        console.log(`  ${ok ? '✅' : '❌'} ${name}: ${found}/${expected} (${pct}%)`);
        if (ok) totalPassed++; else totalFailed++;
    }

    // Pagination
    const paginationLinks = $('ul.pagination.pagination-lg li.page-item a.page-link');
    const naprejLink = paginationLinks.filter((_, el) => $(el).text().trim() === 'Naprej');
    console.log(`  ${naprejLink.length > 0 ? '✅' : '⚠️'} Pagination "Naprej": ${naprejLink.length > 0 ? 'found' : 'not found (may be last page)'}`);

    // Total count
    const bodyText = $.text();
    const countMatch = bodyText.match(/(\d+)\s*oglasov/);
    console.log(`  ${countMatch ? '✅' : '⚠️'} Total count: ${countMatch ? countMatch[1] + ' oglasov' : 'not found'}`);

    // Sample first listing
    const first = rows.first();
    console.log(`\n  📋 Sample listing:`);
    console.log(`     Title: ${first.find('.GO-Results-Naziv').text().trim().substring(0, 60)}`);
    console.log(`     Price: ${first.find('.GO-Results-Top-Price-TXT-Regular').text().trim()}`);
    console.log(`     URL: ${first.find('a[href*="details.asp"]').attr('href')?.substring(0, 60)}`);
}

console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${totalPassed} passed, ${totalFailed} failed`);
process.exit(totalFailed > 0 ? 1 : 0);
