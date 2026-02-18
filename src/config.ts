/**
 * Scraper configuration and filter support for avto.net search.
 *
 * Filters can be provided via environment variables or programmatically.
 */

export interface SearchFilters {
    /** Brand code (znamka) e.g. "1" for Audi */
    brand?: string;
    /** Model code (model) */
    model?: string;
    /** Minimum price in EUR */
    priceFrom?: number;
    /** Maximum price in EUR */
    priceTo?: number;
    /** Minimum year */
    yearFrom?: number;
    /** Maximum year */
    yearTo?: number;
    /** Fuel type code: 1=Petrol, 2=Diesel, 3=Electric, 4=Hybrid, etc. */
    fuelType?: string;
    /** Body type code */
    bodyType?: string;
    /** Maximum mileage in km */
    maxMileage?: number;
    /** Location/region code */
    location?: string;
}

export interface CrawlerConfig {
    /** Max pages to crawl (0 = unlimited) */
    maxPages: number;
    /** Max total requests (safety limit) */
    maxRequests: number;
    /** Min delay between requests in ms */
    minDelayMs: number;
    /** Max delay between requests in ms */
    maxDelayMs: number;
    /** Max concurrent requests */
    maxConcurrency: number;
    /** Whether to run headless */
    headless: boolean;
    /** Navigation timeout in seconds */
    navigationTimeoutSecs: number;
    /** Request handler timeout in seconds */
    requestHandlerTimeoutSecs: number;
    /** Number of retries per request */
    maxRetries: number;
}

/**
 * Build avto.net search URL with filters applied.
 */
export function buildSearchUrl(filters: SearchFilters = {}): string {
    const base = 'https://www.avto.net/Ads/results.asp';
    const params = new URLSearchParams();

    // avto.net uses specific parameter names for its session/filter system
    // These empty "ession" params are required for the URL to work
    const sessionParams = [
        'zession', 'Lession', 'TypeView', 'Eession', 'Kession',
        'Fession', 'Ression', 'Aession', 'Tession', 'Zession',
        'Session', 'Ession', 'Pession', 'Gession', 'Ession2',
        'oession', 'iession', 'jession', 'dession', 'hession', 'aession',
    ];

    for (const p of sessionParams) {
        params.set(p, '');
    }

    // Apply filters
    if (filters.brand) params.set('Zession', filters.brand);
    if (filters.model) params.set('Mession', filters.model);
    if (filters.priceFrom) params.set('Cession', filters.priceFrom.toString());
    if (filters.priceTo) params.set('CEession', filters.priceTo.toString());
    if (filters.yearFrom) params.set('Lession', filters.yearFrom.toString());
    if (filters.yearTo) params.set('LEession', filters.yearTo.toString());
    if (filters.fuelType) params.set('Gession', filters.fuelType);
    if (filters.bodyType) params.set('Kession', filters.bodyType);
    if (filters.maxMileage) params.set('Ression', filters.maxMileage.toString());
    if (filters.location) params.set('Ession', filters.location);

    return `${base}?${params.toString()}`;
}

/**
 * Build paginated URL by appending/updating the stran (page) parameter.
 */
export function buildPageUrl(baseUrl: string, page: number): string {
    const url = new URL(baseUrl);
    url.searchParams.set('stession', page.toString());
    return url.toString();
}

/**
 * Load filters from environment variables.
 */
export function loadFiltersFromEnv(): SearchFilters {
    return {
        brand: process.env.AVTO_BRAND || undefined,
        model: process.env.AVTO_MODEL || undefined,
        priceFrom: process.env.AVTO_PRICE_FROM ? Number(process.env.AVTO_PRICE_FROM) : undefined,
        priceTo: process.env.AVTO_PRICE_TO ? Number(process.env.AVTO_PRICE_TO) : undefined,
        yearFrom: process.env.AVTO_YEAR_FROM ? Number(process.env.AVTO_YEAR_FROM) : undefined,
        yearTo: process.env.AVTO_YEAR_TO ? Number(process.env.AVTO_YEAR_TO) : undefined,
        fuelType: process.env.AVTO_FUEL_TYPE || undefined,
        bodyType: process.env.AVTO_BODY_TYPE || undefined,
        maxMileage: process.env.AVTO_MAX_MILEAGE ? Number(process.env.AVTO_MAX_MILEAGE) : undefined,
        location: process.env.AVTO_LOCATION || undefined,
    };
}

/**
 * Load crawler config from environment variables with sensible defaults.
 */
export function loadCrawlerConfig(): CrawlerConfig {
    return {
        maxPages: Number(process.env.MAX_PAGES) || 0,
        maxRequests: Number(process.env.MAX_REQUESTS) || 1000,
        minDelayMs: Number(process.env.MIN_DELAY_MS) || 2000,
        maxDelayMs: Number(process.env.MAX_DELAY_MS) || 5000,
        maxConcurrency: Number(process.env.MAX_CONCURRENCY) || 1,
        headless: process.env.HEADLESS !== 'false',
        navigationTimeoutSecs: Number(process.env.NAV_TIMEOUT_SECS) || 60,
        requestHandlerTimeoutSecs: Number(process.env.HANDLER_TIMEOUT_SECS) || 120,
        maxRetries: Number(process.env.MAX_RETRIES) || 3,
    };
}
