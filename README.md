# ✈️ Air India Flight Tracker — Toronto (YYZ) to Ahmedabad (AMD)

Automated flight price tracker for round-trip travel between Toronto and Ahmedabad.

- **Route:** Toronto Pearson (YYZ) ➔ Ahmedabad (AMD) (via DEL)
- **Dates:** Jan 10, 2027 – Feb 6, 2027 (Round Trip)
- **Airline:** Air India (Pure single-airline booking)
- **Layovers:** 1 Stop in New Delhi (DEL) — **0 US Layovers**
- **Baggage:** 2 Checked Bags included (23 kg each) + 1 Carry-on (7 kg)
- **Fare Type:** Refundable / Flexible options tracked

---

## ⚡ Automated 24/7 Cloud Tracking (GitHub Actions)
This repository uses **GitHub Actions** to automatically scrape and log flight prices 4 times daily (every 6 hours) without needing your computer to be turned on.
- Workflow definition: `.github/workflows/track.yml`
- History log: `flight_history.json`

---

## 💻 Local Usage

### Start Tracker & Dashboard
```bash
npm start
```
Or double-click `start.bat`.
Dashboard opens at: `http://localhost:3000`

### Stop Server
```bash
npm run stop
```
Or double-click `stop.bat`.

### Run One-Time Instant Scrape
```bash
npm run track
```
