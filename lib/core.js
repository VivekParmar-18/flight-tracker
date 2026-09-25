// Shared, storage-agnostic helpers used by the local server, the CLI tracker and the Vercel functions.
import fs from 'fs';
import { findFlights, airlineReferenceFares } from './googleFlights.js';

export const DEFAULT_CONFIG = {
  origin: 'YYZ',
  originCity: 'Toronto',
  destination: 'AMD',
  destinationCity: 'Ahmedabad',
  dateFrom: '2027-01-10',
  dateTo: '2027-02-06',
  currency: 'CAD',
  targetPriceCAD: 2800,
  scrapeIntervalMinutes: 10,
  // Empty = any airline. Use IATA codes, e.g. ["AI"] for Air India only.
  airlines: [],
  maxStops: 1,
  avoidCountries: ['US'],
  checkedBagsIncluded: 2,
  maxOptions: 10,
  maxLayoverHours: null,
  // Airline whose own-network fares (to its hub) are shown for reference
  referenceAirline: { code: 'AI', name: 'Air India', hub: 'DEL' }
};

export function readConfigFile() {
  try {
    const raw = fs.readFileSync(new URL('../config.json', import.meta.url), 'utf-8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/** Runs a live search and turns it into a snapshot (full data for the dashboard). */
export async function runLiveSearch(config) {
  const result = await findFlights(config);
  // Never replace good data with an empty/broken run: an empty result with errors means Google
  // blocked or failed midway, not that there are no flights.
  if (!result.options.length && result.errors.length) throw new Error(result.errors[0]);
  if (!result.options.length && !result.unpriced.length) {
    throw new Error('Google Flights returned no itineraries at all (blocked or page changed); keeping previous data');
  }

  let reference = null;
  if (config.referenceAirline?.code) {
    try {
      reference = await airlineReferenceFares(config, config.referenceAirline);
    } catch (err) {
      console.warn('[reference] skipped:', err.message);
    }
  }

  const best = result.options[0] || null;
  return {
    id: Date.now().toString(),
    timestamp: result.fetchedAt,
    source: 'Google Flights (live)',
    route: {
      origin: config.origin,
      originCity: config.originCity,
      destination: config.destination,
      destinationCity: config.destinationCity,
      dateFrom: config.dateFrom,
      dateTo: config.dateTo,
      currency: config.currency
    },
    bestPrice: best ? best.price : null,
    best: best && {
      id: best.id,
      airlines: best.airlines,
      price: best.price,
      seller: best.cheapest?.seller || null
    },
    options: result.options,
    unpriced: result.unpriced,
    typicalRange: result.typicalRange,
    reference,
    partial: result.partial,
    rejectedCount: result.rejectedCount,
    searchUrl: result.searchUrl,
    errors: result.errors
  };
}

/** Compact history point, so the history file stays small. */
export function toHistoryPoint(snapshot) {
  return {
    timestamp: snapshot.timestamp,
    bestPrice: snapshot.bestPrice,
    bestAirlines: snapshot.best?.airlines || [],
    bestSeller: snapshot.best?.seller || null,
    matches: snapshot.options.length,
    prices: Object.fromEntries(snapshot.options.map(o => [o.id, o.price]))
  };
}

export function buildStatus({ config, latest, history, isScraping = false, mode = 'server', lastError = null }) {
  const intervalMinutes = config.scrapeIntervalMinutes || 10;
  const intervalMs = intervalMinutes * 60 * 1000;
  const prices = history.map(h => h.bestPrice).filter(p => typeof p === 'number');
  const previous = [...history].reverse().find(h => h.timestamp !== latest?.timestamp && typeof h.bestPrice === 'number');
  const now = Date.now();
  const nextCheckTimestamp = Math.ceil(now / intervalMs) * intervalMs;

  return {
    config,
    latest,
    history,
    stats: {
      minPrice: prices.length ? Math.min(...prices) : null,
      maxPrice: prices.length ? Math.max(...prices) : null,
      avgPrice: prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : null,
      previousPrice: previous?.bestPrice ?? null,
      totalChecks: history.length,
      lastChecked: latest?.timestamp || null,
      stale: !latest || now - Date.parse(latest.timestamp) > intervalMs,
      nextCheckTimestamp,
      intervalMinutes,
      isScraping,
      mode,
      // Most recent failed check newer than the data shown (so the page can warn about it)
      lastError: lastError && (!latest || lastError.at > latest.timestamp) ? lastError : null
    }
  };
}
