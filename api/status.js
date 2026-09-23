import fs from 'fs';
import path from 'path';

export default async function handler(req, res) {
  try {
    let history = [];
    let config = {
      origin: 'YYZ',
      originCity: 'Toronto',
      destination: 'AMD',
      destinationCity: 'Ahmedabad',
      dateFrom: '2027-01-10',
      dateTo: '2027-02-06',
      currency: 'CAD',
      targetPriceCAD: 2000,
      scrapeIntervalMinutes: 10
    };

    // 1. Try fetching latest cloud history directly from GitHub raw (bypasses build cache)
    try {
      const rawUrl = `https://raw.githubusercontent.com/VivekParmar-18/flight-tracker/main/flight_history.json?t=${Date.now()}`;
      const rawRes = await fetch(rawUrl, { cache: 'no-store' });
      if (rawRes.ok) {
        history = await rawRes.json();
      }
    } catch (netErr) {
      // Fallback to local file if offline or network error
    }

    // 2. Fallback to local files if GitHub raw was empty
    if (!history.length) {
      const historyPath = path.join(process.cwd(), 'flight_history.json');
      if (fs.existsSync(historyPath)) {
        try {
          history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
        } catch (e) {}
      }
    }

    const configPath = path.join(process.cwd(), 'config.json');
    if (fs.existsSync(configPath)) {
      try {
        config = { ...config, ...JSON.parse(fs.readFileSync(configPath, 'utf8')) };
      } catch (e) {}
    }

    const latest = history[history.length - 1] || null;
    const prices = history.map(h => h.priceCAD).filter(p => typeof p === 'number');
    const minPrice = prices.length ? Math.min(...prices) : null;
    const maxPrice = prices.length ? Math.max(...prices) : null;
    const avgPrice = prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : null;

    const INTERVAL_MS = 10 * 60 * 1000;
    const now = Date.now();
    const nextCheckTimestamp = Math.ceil(now / INTERVAL_MS) * INTERVAL_MS;
    const remainingMs = Math.max(0, nextCheckTimestamp - now);

    res.status(200).json({
      config,
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
        intervalMinutes: 10,
        isScraping: false
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
