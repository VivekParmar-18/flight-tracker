import fs from 'fs';
import path from 'path';

export default function handler(req, res) {
  try {
    const historyPath = path.join(process.cwd(), 'flight_history.json');
    const configPath = path.join(process.cwd(), 'config.json');

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

    if (fs.existsSync(historyPath)) {
      history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    }
    if (fs.existsSync(configPath)) {
      config = { ...config, ...JSON.parse(fs.readFileSync(configPath, 'utf8')) };
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
