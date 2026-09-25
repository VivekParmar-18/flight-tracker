// Shared, storage-agnostic helpers used by the local server, the CLI tracker and the Vercel functions.
import fs from 'fs';
import { findFlights } from './googleFlights.js';

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
  maxLayoverHours: null
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

export function buildStatus({ config, latest, history, isScraping = false, mode = 'server' }) {
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
      mode
    }
  };
}
