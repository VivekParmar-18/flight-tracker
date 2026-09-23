import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadConfig, saveConfig, loadHistory, saveHistory, scrapeAirIndiaFlight } from './tracker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let isScraping = false;
const INTERVAL_MINUTES = 10;
const INTERVAL_MS = INTERVAL_MINUTES * 60 * 1000;

// Prevent server crash from transient unhandled async errors
process.on('uncaughtException', (err) => {
  console.error('[Server Guard] Caught exception:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Server Guard] Unhandled rejection:', reason);
});

// Universal clock anchor: All users & server sync to the exact same 10-minute clock boundary
function getNextCheckTimestamp() {
  const now = Date.now();
  return Math.ceil(now / INTERVAL_MS) * INTERVAL_MS;
}

// API: Get flight tracking status and history
app.get('/api/status', (req, res) => {
  const config = loadConfig();
  const history = loadHistory();
  const latest = history[history.length - 1] || null;

  const prices = history.map(h => h.priceCAD).filter(p => typeof p === 'number');
  const minPrice = prices.length ? Math.min(...prices) : null;
  const maxPrice = prices.length ? Math.max(...prices) : null;
  const avgPrice = prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : null;

  const nextCheckTimestamp = getNextCheckTimestamp();
  const remainingMs = Math.max(0, nextCheckTimestamp - Date.now());

  res.json({
    config: {
      ...config,
      scrapeIntervalMinutes: INTERVAL_MINUTES
    },
    latest,
    history,
    stats: {
      minPrice,
      maxPrice,
      avgPrice,
      totalChecks: history.length,
      lastChecked: latest ? latest.timestamp : null,
      nextCheckTimestamp,
      nextCheckInMs: remainingMs,
      intervalMinutes: INTERVAL_MINUTES,
      isScraping
    }
  });
});

// API: Trigger immediate live scrape
app.post('/api/check-now', async (req, res) => {
  if (isScraping) {
    return res.status(429).json({ error: 'A flight scrape is already in progress. Please wait a moment.' });
  }

  isScraping = true;
  try {
    const snapshot = await scrapeAirIndiaFlight();
    isScraping = false;
    res.json({ success: true, snapshot });
  } catch (err) {
    isScraping = false;
    res.status(500).json({ error: err.message });
  }
});

// API: Update target alert configuration
app.post('/api/config', (req, res) => {
  const current = loadConfig();
  const updated = {
    ...current,
    targetPriceCAD: Number(req.body.targetPriceCAD) || current.targetPriceCAD,
    scrapeIntervalMinutes: INTERVAL_MINUTES
  };
  saveConfig(updated);
  res.json({ success: true, config: updated });
});

// Background periodic checker (Strictly aligned to 10-minute clock marks)
let schedulerTimeout = null;

function scheduleNextSyncScrape() {
  const nextTarget = getNextCheckTimestamp();
  // Ensure we wait at least 1.5 seconds if called right at the boundary
  let delay = nextTarget - Date.now();
  if (delay <= 1000) delay += INTERVAL_MS;

  console.log(`[Auto-Poller] Synchronized next scrape at ${new Date(nextTarget).toLocaleTimeString()} (in ${(delay / 1000).toFixed(0)}s)`);

  if (schedulerTimeout) clearTimeout(schedulerTimeout);

  schedulerTimeout = setTimeout(async () => {
    if (!isScraping) {
      try {
        console.log(`\n-----------------------------------------------------------`);
        console.log(`[10-Min Auto-Poll] Executing synchronized scrape at ${new Date().toLocaleTimeString()}...`);
        isScraping = true;
        await scrapeAirIndiaFlight();
        console.log(`[10-Min Auto-Poll] Completed successfully!`);
        console.log(`-----------------------------------------------------------\n`);
      } catch (err) {
        console.error('[10-Min Auto-Poll] Scrape error:', err.message);
      } finally {
        isScraping = false;
      }
    }
    // Schedule next 10-minute boundary
    scheduleNextSyncScrape();
  }, delay);
}

app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`✈️  Air India Flight Tracker Active on http://localhost:${PORT}`);
  console.log(`🔄 Global synchronized polling active: Every 10 minutes.`);
  console.log(`📍 YYZ (Toronto) -> AMD (Ahmedabad) • Jan 10 - Feb 6, 2027`);
  console.log(`🛡️ 1 Stop (DEL) • 0 US Layovers • 2 Checked Bags Included`);
  console.log(`=======================================================`);
  scheduleNextSyncScrape();
});
