import { PlaywrightCrawler, Configuration } from 'crawlee';
import { router } from './routes.js';

const startUrls = [
    'https://www.avto.net/Ads/results.asp?zession=&Lession=&TypeView=&Eession=&Kession=&Fession=&Ression=&Aession=&Tession=&Zession=&Session=&Ession=&Pession=&Gession=&Ession2=&oession=&iession=&jession=&dession=&hession=&aession=',
];

const crawler = new PlaywrightCrawler({
    requestHandler: router,
    maxRequestsPerCrawl: 100,
    headless: true,
    launchContext: {
        launchOptions: {
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        },
    },
    requestHandlerTimeoutSecs: 120,
    navigationTimeoutSecs: 60,
});

await crawler.run(startUrls);
