// State handling for the Vercel deployment. Serverless functions have a read-only filesystem,
// so stored history comes from the GitHub repo (updated by the GitHub Actions tracker) and live
// searches are cached in memory for as long as the function instance stays warm.
import fs from 'fs';
import { buildStatus, readConfigFile, runLiveSearch, toHistoryPoint } from './core.js';

const RAW_BASE = process.env.HISTORY_RAW_BASE || 'https://raw.githubusercontent.com/VivekParmar-18/flight-tracker/main';

let liveSnapshot = null;
let liveHistory = []; // points gathered by this instance since it started
let inflight = null;

async function readStored(file, fallback) {
  try {
    const res = await fetch(`${RAW_BASE}/${file}?t=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (res.ok) return await res.json();
  } catch {
    // fall through to the bundled copy
  }
  try {
    return JSON.parse(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf-8'));
  } catch {
    return fallback;
  }
}

export function refreshLive(config = readConfigFile()) {
  if (!inflight) {
    inflight = runLiveSearch(config)
      .then(snapshot => {
        liveSnapshot = snapshot;
        liveHistory = [...liveHistory, toHistoryPoint(snapshot)].slice(-200);
        return snapshot;
      })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

export async function serverlessStatus(config = readConfigFile()) {
  const [storedHistory, storedLatest] = await Promise.all([
    readStored('flight_history.json', []),
    readStored('latest_snapshot.json', null)
  ]);
  const history = (Array.isArray(storedHistory) ? storedHistory : []).filter(h => 'bestPrice' in h);
  const lastStored = history.length ? history[history.length - 1].timestamp : '';
  const merged = [...history, ...liveHistory.filter(p => p.timestamp > lastStored)];

  const latest = [liveSnapshot, storedLatest?.options ? storedLatest : null]
    .filter(Boolean)
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))[0] || null;

  return buildStatus({ config, latest, history: merged, isScraping: !!inflight, mode: 'serverless' });
}
