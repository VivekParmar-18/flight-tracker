import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readConfigFile, runLiveSearch, toHistoryPoint } from './lib/core.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HISTORY_FILE = path.join(__dirname, 'flight_history.json');
const LATEST_FILE = path.join(__dirname, 'latest_snapshot.json');
const CONFIG_FILE = path.join(__dirname, 'config.json');
const MAX_HISTORY = 1000;

export const loadConfig = readConfigFile;

export function saveConfig(newConfig) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(newConfig, null, 2), 'utf-8');
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (e) {
    console.error(`Error reading ${path.basename(file)}:`, e.message);
    return fallback;
  }
}

export function loadHistory() {
  const history = readJson(HISTORY_FILE, []);
  // Drop entries from the old format (hard-coded placeholder prices, no live data)
  return Array.isArray(history) ? history.filter(h => 'bestPrice' in h) : [];
}

export function saveHistory(history) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8');
}

export function loadLatest() {
  return readJson(LATEST_FILE, null);
}

/**
 * Searches Google Flights live for every round trip matching the criteria in config.json,
 * stores the full snapshot + a compact history point, and returns the snapshot.
 */
export async function runCheck() {
  const config = loadConfig();
  console.log(`[${new Date().toISOString()}] Searching ${config.origin} -> ${config.destination} (${config.dateFrom} / ${config.dateTo})...`);

  const snapshot = await runLiveSearch(config);

  const history = loadHistory();
  const previous = history[history.length - 1];
  if (previous?.bestPrice != null && snapshot.bestPrice != null && previous.bestPrice !== snapshot.bestPrice) {
    console.log(`PRICE CHANGE: CA$${previous.bestPrice} -> CA$${snapshot.bestPrice}`);
  }

  history.push(toHistoryPoint(snapshot));
  saveHistory(history.slice(-MAX_HISTORY));
  fs.writeFileSync(LATEST_FILE, JSON.stringify(snapshot, null, 2), 'utf-8');

  console.log(`Found ${snapshot.options.length} matching round trips` +
    (snapshot.bestPrice != null ? `, best CA$${snapshot.bestPrice} (${snapshot.best.airlines.join(' / ')} via ${snapshot.best.seller})` : '') +
    (snapshot.unpriced.length ? `; ${snapshot.unpriced.length} more without a published fare` : ''));
  return snapshot;
}

// Direct terminal execution: `npm run track`
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  runCheck()
    .then(snap => {
      for (const o of snap.options) {
        console.log(`  CA$${o.price}  ${o.airlines.join(' / ').padEnd(28)} ${o.outbound.key} / ${o.inbound.key}  bags:${o.checkedBags ?? '?'}  ${o.cheapest?.seller}`);
      }
      process.exit(0);
    })
    .catch(err => {
      console.error('Search failed:', err.message);
      process.exit(1);
    });
}
