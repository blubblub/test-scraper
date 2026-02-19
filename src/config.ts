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
    /** Max search result pages to crawl (0 = unlimited) */
    maxPages: number;
    /** Max detail pages to scrape (0 = unlimited, -1 = skip details) */
    maxDetails: number;
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
 * Uses the real avto.net results.asp parameter format extracted from live pages.
 */
export function buildSearchUrl(filters: SearchFilters = {}): string {
    const base = 'https://www.avto.net/Ads/results.asp';

    // Default params matching avto.net's real URL structure (all required)
    const defaults: Record<string, string> = {
        znamka: '', model: '', modelID: '', tip: '',
        znamka2: '', model2: '', tip2: '',
        znamka3: '', model3: '', tip3: '',
        cenaMin: '0', cenaMax: '999999',
        letnikMin: '0', letnikMax: '2090',
        bencin: '0', starost2: '999', oblika: '0',
        ccmMin: '0', ccmMax: '99999',
        mocMin: '0', mocMax: '999999',
        kmMin: '0', kmMax: '9999999',
        kwMin: '0', kwMax: '999',
        motortakt: '0', motorvalji: '0',
        lokacija: '0', sirina: '0',
        dolzina: '', dolzinaMIN: '0', dolzinaMAX: '100',
        nosilnostMIN: '0', nosilnostMAX: '999999',
        sedezevMIN: '0', sedezevMAX: '9',
        lezisc: '', presek: '0', premer: '0', col: '0', vijakov: '0',
        EToznaka: '0', vozilo: '', airbag: '', barva: '', barvaint: '',
        doseg: '0', BkType: '0', BkOkvir: '0', BkOkvirType: '0', Bk4: '0',
        EQ1: '1000000000', EQ2: '1000000000', EQ3: '1000000000',
        EQ4: '1000000000', EQ5: '1000000000', EQ6: '1000000000',
        EQ7: '1110100120', EQ8: '100000000', EQ9: '1000000020', EQ10: '10000000',
        KAT: '1010000000', PIA: '', PIAzero: '', PIAOut: '', PSLO: '',
        akcija: '0', paketgarancije: '', broker: '0',
        prikazkategorije: '0', kategorija: '0',
        ONLvid: '0', ONLnak: '0', zaloga: '10', arhiv: '0',
        presort: '', tipsort: '', stran: '',
    };

    // Apply user filters
    if (filters.brand) defaults.znamka = filters.brand;
    if (filters.model) defaults.model = filters.model;
    if (filters.priceFrom) defaults.cenaMin = filters.priceFrom.toString();
    if (filters.priceTo) defaults.cenaMax = filters.priceTo.toString();
    if (filters.yearFrom) defaults.letnikMin = filters.yearFrom.toString();
    if (filters.yearTo) defaults.letnikMax = filters.yearTo.toString();
    if (filters.fuelType) defaults.bencin = filters.fuelType;
    if (filters.bodyType) defaults.oblika = filters.bodyType;
    if (filters.maxMileage) defaults.kmMax = filters.maxMileage.toString();
    if (filters.location) defaults.lokacija = filters.location;

    const params = new URLSearchParams(defaults);
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
        maxDetails: process.env.MAX_DETAILS !== undefined ? Number(process.env.MAX_DETAILS) : 0,
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
