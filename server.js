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
let nextCheckTime = Date.now() + 10 * 60 * 1000;

// API: Get flight tracking status and history
app.get('/api/status', (req, res) => {
  const config = loadConfig();
  const history = loadHistory();
  const latest = history[history.length - 1] || null;

  const prices = history.map(h => h.priceCAD).filter(p => typeof p === 'number');
  const minPrice = prices.length ? Math.min(...prices) : null;
  const maxPrice = prices.length ? Math.max(...prices) : null;
  const avgPrice = prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : null;

  res.json({
    config,
    latest,
    history,
    stats: {
      minPrice,
      maxPrice,
      avgPrice,
      totalChecks: history.length,
      lastChecked: latest ? latest.timestamp : null,
      nextCheckInMs: Math.max(0, nextCheckTime - Date.now()),
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
    nextCheckTime = Date.now() + (loadConfig().scrapeIntervalMinutes || 10) * 60 * 1000;
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
    scrapeIntervalMinutes: Number(req.body.scrapeIntervalMinutes) || current.scrapeIntervalMinutes || 10
  };
  saveConfig(updated);
  res.json({ success: true, config: updated });
});

// Background periodic checker (Every 10 minutes)
function setupScheduler() {
  const config = loadConfig();
  const intervalMinutes = config.scrapeIntervalMinutes || 10;
  const intervalMs = intervalMinutes * 60 * 1000;
  nextCheckTime = Date.now() + intervalMs;
  
  console.log(`[Auto-Poller] Initialized! Polling every ${intervalMinutes} minutes.`);

  setInterval(async () => {
    if (isScraping) return;
    try {
      console.log(`\n-----------------------------------------------------------`);
      console.log(`[10-Min Auto-Poll] Executing scheduled Air India flight scrape...`);
      isScraping = true;
      await scrapeAirIndiaFlight();
      isScraping = false;
      nextCheckTime = Date.now() + intervalMs;
      console.log(`[10-Min Auto-Poll] Completed! Next check in ${intervalMinutes} minutes.`);
      console.log(`-----------------------------------------------------------\n`);
    } catch (err) {
      isScraping = false;
      console.error('[10-Min Auto-Poll] Scrape error:', err.message);
    }
  }, intervalMs);
}

app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`✈️  Air India Flight Tracker Active on http://localhost:${PORT}`);
  console.log(`🔄 Auto-polling scheduled every 10 minutes.`);
  console.log(`📍 YYZ (Toronto) -> AMD (Ahmedabad) • Jan 10 - Feb 6, 2027`);
  console.log(`🛡️ 1 Stop (DEL) • 0 US Layovers • 2 Checked Bags`);
  console.log(`=======================================================`);
  setupScheduler();
});
