import { load } from 'cheerio';
import fs from 'fs';
import path from 'path';

const dir = path.join(process.cwd(), 'snapshots');
const files = fs.readdirSync(dir).filter(f => f.startsWith('detail-'));

for (const file of files) {
    const html = fs.readFileSync(path.join(dir, file), 'utf-8');
    const $ = load(html);
    
    console.log(`=== ${file} ===`);
    
    // Title
    const title = $('h3').first().text().trim() || $('h1').first().text().trim() || null;
    console.log(`  Title: ${title?.substring(0, 80)}`);
    
    // Price - card-body spans with € 
    const prices = [];
    $('.card-body .h2 span, .card-body .h1 span').each((_, el) => {
        const t = $(el).text().trim();
        if (/[\d.]+\s*€/.test(t)) prices.push(t);
    });
    const uniquePrices = [...new Set(prices)];
    console.log(`  Prices: ${JSON.stringify(uniquePrices)}`);
    
    // Specs - find tables with th+td
    const specs = {};
    $('table.table-sm tr').each((_, row) => {
        const th = $(row).find('th').text().trim();
        const td = $(row).find('td').text().trim();
        if (th && td) specs[th] = td;
    });
    console.log(`  Specs: ${Object.keys(specs).length} fields`);
    for (const [k, v] of Object.entries(specs)) {
        console.log(`    ${k} ${v}`);
    }
    
    // Description - #StareOpombe
    const opombe = $('#StareOpombe');
    let desc = null;
    if (opombe.length) {
        const items = opombe.find('li');
        if (items.length) {
            desc = items.map((_, li) => $(li).text().trim()).get().filter(Boolean);
        } else {
            desc = opombe.text().trim() || null;
        }
    }
    console.log(`  Description: ${Array.isArray(desc) ? desc.length + ' items' : desc}`);
    
    // Seller name - find NAZIV comment, then next li
    let sellerName = null;
    const htmlStr = html;
    const nazivMatch = htmlStr.match(/<!-+\s*NAZIV\s*-+>/);
    if (nazivMatch) {
        const afterNaziv = htmlStr.substring(nazivMatch.index + nazivMatch[0].length);
        const liMatch = afterNaziv.match(/<li[^>]*>([\s\S]*?)<\/li>/i);
        if (liMatch) {
            const firstLine = liMatch[1].split(/<br\s*\/?>/i)[0].replace(/<[^>]*>/g, '').trim();
            if (firstLine) sellerName = firstLine;
        }
    }
    console.log(`  Seller: ${sellerName}`);
    
    // Phone - tel: href
    const telLink = $('a[href^="tel:"]').first();
    let phone = telLink.length ? telLink.attr('href').replace('tel:', '').trim() : null;
    if (!phone) {
        // Fallback: fa-phone icon container
        const phoneIcon = $('.fa-phone-square, .fa-phone').first();
        if (phoneIcon.length) {
            const container = phoneIcon.closest('li, .list-group-item');
            const text = container.length ? container.text() : phoneIcon.parent().text();
            const match = text.match(/[\d][\d\s/\-]{5,}/);
            if (match) phone = match[0].replace(/[\s/\-]+$/g, '').trim();
        }
    }
    console.log(`  Phone: ${phone}`);
    console.log();
}
