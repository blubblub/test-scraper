/**
 * Progress tracking and statistics for the crawler.
 */

import { Log } from 'crawlee';

export class CrawlerStats {
    private pagesProcessed = 0;
    private listingsFound = 0;
    private listingsEnqueued = 0;
    private detailsScraped = 0;
    private errors = 0;
    private startTime: number;
    private log: Log;
    private seenUrls = new Set<string>();

    constructor(log: Log) {
        this.startTime = Date.now();
        this.log = log;
    }

    recordPage(listingCount: number): void {
        this.pagesProcessed++;
        this.listingsFound += listingCount;
        this.logProgress();
    }

    recordEnqueued(count: number): void {
        this.listingsEnqueued += count;
    }

    getEnqueuedCount(): number {
        return this.listingsEnqueued;
    }

    recordDetail(): void {
        this.detailsScraped++;
    }

    recordError(): void {
        this.errors++;
    }

    /**
     * Track and deduplicate listing URLs.
     * Returns only the URLs that haven't been seen before.
     */
    deduplicateUrls(urls: string[]): string[] {
        const newUrls: string[] = [];
        for (const url of urls) {
            // Normalize URL for dedup (strip trailing slashes, lowercase)
            const normalized = url.replace(/\/+$/, '').toLowerCase();
            if (!this.seenUrls.has(normalized)) {
                this.seenUrls.add(normalized);
                newUrls.push(url);
            }
        }
        return newUrls;
    }

    logProgress(): void {
        const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
        this.log.info(
            `📊 Progress: ${this.pagesProcessed} pages | ` +
            `${this.listingsFound} listings found | ` +
            `${this.listingsEnqueued} enqueued | ` +
            `${this.seenUrls.size} unique URLs | ` +
            `${this.errors} errors | ` +
            `${elapsed}s elapsed`,
        );
    }

    getSummary(): {
        pagesProcessed: number;
        listingsFound: number;
        listingsEnqueued: number;
        detailsScraped: number;
        uniqueUrls: number;
        errors: number;
        elapsedSeconds: number;
    } {
        return {
            pagesProcessed: this.pagesProcessed,
            listingsFound: this.listingsFound,
            listingsEnqueued: this.listingsEnqueued,
            detailsScraped: this.detailsScraped,
            uniqueUrls: this.seenUrls.size,
            errors: this.errors,
            elapsedSeconds: (Date.now() - this.startTime) / 1000,
        };
    }
}
