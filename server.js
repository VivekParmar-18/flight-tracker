import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadConfig, saveConfig, loadHistory, loadLatest, runCheck } from './tracker.js';
import { buildStatus } from './lib/core.js';
import { resolveBookingLink, decodeItinerary, googleBookingUrl, googleSearchUrl } from './lib/googleFlights.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let currentCheck = null; // in-flight search promise, shared by the poller and "Check now"

// Prevent server crash from transient unhandled async errors
process.on('uncaughtException', (err) => {
  console.error('[Server Guard] Caught exception:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Server Guard] Unhandled rejection:', reason);
});

function checkNow() {
  if (!currentCheck) {
    currentCheck = runCheck().finally(() => { currentCheck = null; });
  }
  return currentCheck;
}

const status = () => buildStatus({
  config: loadConfig(),
  latest: loadLatest(),
  history: loadHistory(),
  isScraping: !!currentCheck,
  mode: 'server'
});

// API: flight tracking status, latest live results and history
app.get('/api/status', (req, res) => {
  res.json(status());
});

// API: run a live search right now (joins the one in progress, if any)
app.post('/api/check-now', async (req, res) => {
  try {
    await checkNow();
    res.json({ success: true, ...status() });
  } catch (err) {
    res.status(502).json({ error: `Live search failed: ${err.message}` });
  }
});

// API: redirect to the airline's (or cheapest seller's) booking page for an exact itinerary
app.get('/api/book', async (req, res) => {
  const config = loadConfig();
  let itinerary;
  try {
    itinerary = decodeItinerary(req.query.t);
  } catch {
    return res.redirect(302, googleSearchUrl(config));
  }
  try {
    const link = await resolveBookingLink(config, itinerary.outbound, itinerary.inbound, {
      prefer: req.query.prefer === 'cheapest' ? 'cheapest' : 'direct'
    });
    res.redirect(302, link?.url || googleBookingUrl(config, itinerary.outbound, itinerary.inbound));
  } catch (err) {
    console.error('[Book] Falling back to Google Flights:', err.message);
    res.redirect(302, googleBookingUrl(config, itinerary.outbound, itinerary.inbound));
  }
});

// API: update target alert price
app.post('/api/config', (req, res) => {
  const current = loadConfig();
  const target = Number(req.body.targetPriceCAD);
  const updated = { ...current, targetPriceCAD: target > 0 ? target : current.targetPriceCAD };
  saveConfig(updated);
  res.json({ success: true, config: updated });
});

// Background poller aligned to the interval clock boundary (e.g. :00, :10, :20 ...)
function scheduleNextCheck() {
  const intervalMs = (loadConfig().scrapeIntervalMinutes || 10) * 60 * 1000;
  const nextTarget = Math.ceil(Date.now() / intervalMs) * intervalMs;
  let delay = nextTarget - Date.now();
  if (delay <= 1000) delay += intervalMs;

  console.log(`[Auto-Poller] Next live search at ${new Date(Date.now() + delay).toLocaleTimeString()}`);
  setTimeout(async () => {
    try {
      await checkNow();
    } catch (err) {
      console.error('[Auto-Poller] Search failed:', err.message);
    }
    scheduleNextCheck();
  }, delay);
}

app.listen(PORT, () => {
  const config = loadConfig();
  console.log(`=======================================================`);
  console.log(`✈️  Flight Tracker running on http://localhost:${PORT}`);
  console.log(`📍 ${config.origin} -> ${config.destination} • ${config.dateFrom} / ${config.dateTo}`);
  console.log(`🛡️ Max ${config.maxStops} stop • No US layovers • ${config.checkedBagsIncluded} checked bags`);
  console.log(`=======================================================`);

  // Get fresh data immediately if what we have on disk is stale
  const latest = loadLatest();
  const intervalMs = (config.scrapeIntervalMinutes || 10) * 60 * 1000;
  if (!latest || Date.now() - Date.parse(latest.timestamp) > intervalMs) {
    checkNow().catch(err => console.error('[Startup] Search failed:', err.message));
  }
  scheduleNextCheck();
});
