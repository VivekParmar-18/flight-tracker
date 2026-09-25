# ✈️ Live Flight Tracker — Toronto (YYZ) ⇄ Ahmedabad (AMD)

Tracks **live Google Flights prices** for every round trip that matches your criteria and links
straight to the airline's (or cheapest seller's) booking page for that exact itinerary.

- **Route / dates:** YYZ ⇄ AMD, Jan 10 – Feb 6, 2027, 1 adult, economy
- **Criteria (in `config.json`):**
  - max 1 stop each way (`maxStops`)
  - no layovers in the US (`avoidCountries`)
  - single ticket only (no self-transfer / separate tickets)
  - fare must include 2 free checked bags (`checkedBagsIncluded`) — e.g. Air Canada is tracked at its *Flex* fare, not *Standard* (1 bag)
  - any airline (`airlines: []`), or restrict with IATA codes, e.g. `["AI", "EK"]`
  - optional `maxLayoverHours` to drop very long connections

## How it works

`lib/googleFlights.js` reads the same data the Google Flights web app uses (no headless browser):

1. Searches the round trip with the stop filter and collects every outbound itinerary.
2. For each outbound, loads the matching return flights with real round-trip totals.
3. Calls Google's booking-options endpoint to get every seller (airline + agencies), each fare's
   price, free checked bags and refund/change rules.
4. Keeps the cheapest fare that satisfies the criteria for each itinerary.

**Book buttons** go through `/api/book`, which fetches a fresh click-through link at click time and
redirects to the airline's booking engine with the flights and dates pre-filled (links expire, so
they're never stored).

Itineraries that fit the criteria but have **no fare published on Google Flights** (currently Air
India's own YYZ → DEL/BOM → AMD connections) are listed separately with a link to the airline.

## Local usage

```bash
npm install
npm start          # dashboard on http://localhost:3000, live search every 10 min
npm run track      # one-off search, prints results and updates the data files
npm run stop
```

Data files: `latest_snapshot.json` (full latest results) and `flight_history.json` (compact price history).

## Cloud

- **GitHub Actions** (`.github/workflows/track.yml`) runs `tracker.js` hourly and commits the data files.
- **Vercel** serves `public/` plus `api/status`, `api/check-now` and `api/book`. The page fetches live
  prices when opened (if the stored data is older than 10 min), on "Check Live Prices Now", and every
  10 minutes while it's open.
