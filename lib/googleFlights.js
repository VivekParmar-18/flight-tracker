// Live Google Flights client.
// Reads the same data the Google Flights web app renders (server-rendered search results +
// the GetBookingResults RPC), so it needs no headless browser and runs locally, in GitHub
// Actions and on Vercel serverless functions alike.

const BASE = 'https://www.google.com/travel/flights';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const REQUEST_TIMEOUT_MS = 20000;

// Airports in the United States that could appear as a layover on a Canada <-> India trip.
export const US_AIRPORTS = new Set([
  'ATL', 'AUS', 'BNA', 'BOS', 'BWI', 'CLE', 'CLT', 'CMH', 'CVG', 'DCA', 'DEN', 'DFW', 'DTW', 'EWR',
  'FLL', 'HNL', 'IAD', 'IAH', 'IND', 'JFK', 'LAS', 'LAX', 'LGA', 'MCI', 'MCO', 'MDW', 'MIA', 'MSP',
  'MSY', 'OAK', 'ORD', 'PDX', 'PHL', 'PHX', 'PIT', 'RDU', 'SAN', 'SAT', 'SEA', 'SFO', 'SJC', 'SLC',
  'SMF', 'STL', 'TPA', 'ANC', 'BUF', 'SYR', 'ALB', 'BDL', 'PVD', 'RIC', 'ORF', 'JAX', 'RSW', 'PBI'
]);

// ---------------------------------------------------------------------------
// tfs URL parameter (protobuf, base64url) used by Google Flights to describe a search
// ---------------------------------------------------------------------------

const varint = (n) => {
  const bytes = [];
  while (n > 127) {
    bytes.push((n & 127) | 128);
    n >>>= 7;
  }
  bytes.push(n);
  return bytes;
};
const fieldKey = (field, wireType) => varint((field << 3) | wireType);
const pbString = (field, s) => {
  const data = [...Buffer.from(String(s), 'utf-8')];
  return [...fieldKey(field, 2), ...varint(data.length), ...data];
};
const pbMessage = (field, bytes) => [...fieldKey(field, 2), ...varint(bytes.length), ...bytes];
const pbInt = (field, n) => [...fieldKey(field, 0), ...varint(n)];

/**
 * legs: [{ date, from, to, maxStops?, airlines?: ['AI'], selected?: [{ from, date, to, airline, number }] }]
 * trip: 1 = round trip, 2 = one way. seat: 1 = economy.
 */
export function buildTfs({ legs, adults = 1, seat = 1, trip = 1 }) {
  const out = [];
  for (const leg of legs) {
    const fd = [...pbString(2, leg.date)];
    for (const s of leg.selected || []) {
      fd.push(...pbMessage(4, [
        ...pbString(1, s.from), ...pbString(2, s.date), ...pbString(3, s.to),
        ...pbString(5, s.airline), ...pbString(6, s.number)
      ]));
    }
    if (leg.maxStops != null) fd.push(...pbInt(5, leg.maxStops));
    for (const a of leg.airlines || []) fd.push(...pbString(6, a));
    fd.push(...pbMessage(13, pbString(2, leg.from)), ...pbMessage(14, pbString(2, leg.to)));
    out.push(...pbMessage(3, fd));
  }
  for (let i = 0; i < adults; i++) out.push(...pbInt(8, 1));
  out.push(...pbInt(9, seat), ...pbInt(19, trip));
  return Buffer.from(out).toString('base64url');
}

const localeParams = (config) => `hl=en&gl=CA&curr=${config.currency || 'CAD'}`;

function legFilters(config, from, to, date) {
  return {
    date,
    from,
    to,
    maxStops: config.maxStops ?? undefined,
    airlines: config.airlines?.length ? config.airlines : undefined
  };
}

function tfsLegs(config, outbound, inbound) {
  const out = legFilters(config, config.origin, config.destination, config.dateFrom);
  const back = legFilters(config, config.destination, config.origin, config.dateTo);
  if (outbound) out.selected = toSelected(outbound);
  if (inbound) back.selected = toSelected(inbound);
  return [out, back];
}

const toSelected = (itinerary) => itinerary.legs.map(l => ({
  from: l.from, date: l.departDate, to: l.to, airline: l.airline, number: l.flightNumber
}));

/** Google Flights results page for the configured round trip (optionally with the outbound already picked). */
export function googleSearchUrl(config, outbound = null) {
  return `${BASE}/search?tfs=${buildTfs({ legs: tfsLegs(config, outbound, null) })}&${localeParams(config)}`;
}

/** Google Flights booking page for an exact round-trip itinerary ("Book with <airline>" + all sellers). */
export function googleBookingUrl(config, outbound, inbound) {
  const legs = tfsLegs({ ...config, maxStops: undefined, airlines: undefined }, outbound, inbound);
  return `${BASE}/booking?tfs=${buildTfs({ legs })}&${localeParams(config)}`;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const pad = (n) => String(n).padStart(2, '0');
const fmtDate = (d) => (Array.isArray(d) ? `${d[0]}-${pad(d[1])}-${pad(d[2])}` : null);

function fmtTime(t) {
  const [h = 0, m = 0] = Array.isArray(t) ? t : [];
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 === 0 ? 12 : h % 12}:${pad(m)} ${suffix}`;
}

const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

function parseItinerary(item) {
  const f = item[0];
  const legs = (f[2] || []).map(l => ({
    from: l[3],
    fromName: l[4],
    to: l[6],
    toName: l[5],
    departDate: fmtDate(l[20]),
    departTime: fmtTime(l[8]),
    arriveDate: fmtDate(l[21]),
    arriveTime: fmtTime(l[10]),
    durationMin: l[11],
    aircraft: l[17] || null,
    airline: l[22]?.[0],
    airlineName: l[22]?.[3],
    flightNumber: l[22]?.[1]
  }));
  const departDate = fmtDate(f[4]);
  const arriveDate = fmtDate(f[7]);
  return {
    key: legs.map(l => `${l.airline}${l.flightNumber}`).join('-'),
    airlines: f[1] || [],
    from: f[3],
    to: f[6],
    departDate,
    departTime: fmtTime(f[5]),
    arriveDate,
    arriveTime: fmtTime(f[8]),
    arriveDayOffset: departDate && arriveDate ? daysBetween(departDate, arriveDate) : 0,
    durationMin: f[9],
    stops: Math.max(0, legs.length - 1),
    layovers: (f[13] || []).map(x => ({ minutes: x[0], airport: x[1], airportName: x[4], city: x[5] })),
    legs,
    price: item[1]?.[0]?.[1] ?? null
  };
}

function extractDataBlock(html, key) {
  const start = html.indexOf(`AF_initDataCallback({key: '${key}'`);
  if (start === -1) return null;
  const dataStart = html.indexOf('data:', start) + 5;
  const dataEnd = html.indexOf(', sideChannel:', dataStart);
  return JSON.parse(html.slice(dataStart, dataEnd));
}

async function fetchText(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en-CA,en;q=0.9', ...(init.headers || {}) },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: 'no-store'
  });
  if (!res.ok) throw new Error(`Google Flights responded with HTTP ${res.status}`);
  return res.text();
}

/** Runs a Google Flights search page and returns every itinerary it lists. */
async function searchPage(config, outbound = null) {
  const html = await fetchText(googleSearchUrl(config, outbound));
  const data = extractDataBlock(html, 'ds:1');
  if (!data) throw new Error('Google Flights returned no flight data (blocked or page layout changed)');
  const itineraries = [2, 3].flatMap(k => data?.[k]?.[0] || []).map(parseItinerary);
  const baggageLinks = Object.fromEntries((data[11] || []).map(([code, , url]) => [code, url]));
  return { itineraries, baggageLinks };
}

// ---------------------------------------------------------------------------
// Booking options (GetBookingResults RPC) — sellers, click-through links and baggage allowance
// ---------------------------------------------------------------------------

function bookingRequestBody(config, outbound, inbound) {
  const leg = (from, to, date, itin) => [
    [[[from, 0]]], [[[to, 0]]], null, 0, null, null, date, null,
    itin.legs.map(l => [l.from, l.departDate, l.to, null, l.airline, l.flightNumber]),
    null, null, null, null, null, 3
  ];
  const inner = [[], [null, null, 1, null, [], 1, [1, 0, 0, 0], null, null, null, null, null, null, [
    leg(config.origin, config.destination, config.dateFrom, outbound),
    leg(config.destination, config.origin, config.dateTo, inbound)
  ], null, null, null, 1], null, 0];
  return 'f.req=' + encodeURIComponent(JSON.stringify([null, JSON.stringify(inner)]));
}

function parseRpcChunks(text) {
  const chunks = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('[')) continue;
    try {
      for (const entry of JSON.parse(line)) {
        if (entry[0] === 'wrb.fr' && typeof entry[2] === 'string') chunks.push(JSON.parse(entry[2]));
      }
    } catch {
      // partial/non-JSON line — ignore
    }
  }
  return chunks;
}

function parseBags(bags) {
  // [null, null, <carry-on code>, null, 1, <bool>, [<free checked bags>, 1]]; carry-on code 4 = "unknown"
  if (!Array.isArray(bags) || bags[2] === 4) return { carryOn: null, checked: null };
  return {
    carryOn: typeof bags[2] === 'number' ? bags[2] : null,
    checked: Array.isArray(bags[6]) && typeof bags[6][0] === 'number' ? bags[6][0] : null
  };
}

// Fare attribute codes: [1, x] = ticket changes, [2, x] = refunds (1 = free, 2 = partial/fee, 4 = not allowed)
const REFUND_LABELS = { 1: 'Refundable', 2: 'Partial refund', 3: 'Refund for a fee', 4: 'Non-refundable' };
const CHANGE_LABELS = { 1: 'Free changes', 2: 'Changes for a fee', 3: 'Changes for a fee', 4: 'No changes' };

function parseFareRules(attrs) {
  const map = Object.fromEntries((Array.isArray(attrs) ? attrs : []).filter(Array.isArray));
  return {
    refund: REFUND_LABELS[map[2]] || null,
    refundable: map[2] === 1 || map[2] === 2 || map[2] === 3,
    changes: CHANGE_LABELS[map[1]] || null
  };
}

export async function getBookingOptions(config, outbound, inbound) {
  const url = `https://www.google.com/_/FlightsFrontendUi/data/travel.frontend.flights.FlightsFrontendService/GetBookingResults?${localeParams(config)}&rt=c`;
  const text = await fetchText(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'X-Same-Domain': '1',
      'X-Goog-Ext-259736195-Jspb': `["en-US","CA","${config.currency || 'CAD'}",1,null,[-300],null,null,7,[]]`
    },
    body: bookingRequestBody(config, outbound, inbound)
  });

  const chunks = parseRpcChunks(text);
  const raw = chunks.find(c => Array.isArray(c?.[1]?.[0]) && Array.isArray(c[1][0][0]?.[1]))?.[1]?.[0] || [];
  const carriers = new Set([...outbound.legs, ...inbound.legs].map(l => l.airline));

  const options = [];
  for (const o of raw) {
    const sellers = (o[1] || []).map(s => ({ code: s[0], name: s[1], isAirline: !!s[3] }));
    const link = o[5]?.[2];
    const price = o[7]?.[0]?.[1] ?? null;
    if (!sellers.length || price == null) continue;
    const clickUrl = Array.isArray(link)
      ? `${link[0]}?${(link[1] || []).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`
      : null;
    const details = o[21];
    options.push({
      seller: sellers.map(s => s.name).join(' + '),
      sellerCode: sellers.map(s => s.code).join('+'),
      isAirline: sellers.length === 1 && sellers[0].isAirline && carriers.has(sellers[0].code),
      separateTickets: sellers.length > 1,
      fare: typeof details?.[3] === 'string' ? details[3] : null,
      price,
      bags: parseBags(details?.[7]),
      ...parseFareRules(details?.[1]),
      clickUrl
    });
  }
  options.sort((a, b) => a.price - b.price);
  return { options };
}

/** Cheapest single-ticket option that includes the required number of free checked bags. */
function pickOption(options, minBags, { airlineOnly = false, refundableOnly = false } = {}) {
  const pool = options.filter(o =>
    !o.separateTickets && (!airlineOnly || o.isAirline) && (!refundableOnly || o.refundable));
  return pool.find(o => o.bags.checked != null && o.bags.checked >= minBags)
    // Nobody reports the bag allowance for this itinerary: fall back to the cheapest, flagged as unverified
    || (pool.every(o => o.bags.checked == null) ? pool[0] : null)
    || null;
}

// ---------------------------------------------------------------------------
// Criteria
// ---------------------------------------------------------------------------

function avoidedAirports(config) {
  const avoid = new Set((config.avoidAirports || []).map(a => a.toUpperCase()));
  const countries = (config.avoidCountries || []).map(c => c.toUpperCase());
  if (countries.some(c => ['US', 'USA', 'UNITED STATES'].includes(c))) US_AIRPORTS.forEach(a => avoid.add(a));
  return avoid;
}

/** Returns the list of reasons an itinerary breaks the criteria (empty = passes). */
function routeViolations(config, itin, avoid) {
  const reasons = [];
  if (config.maxStops != null && itin.stops > config.maxStops) reasons.push(`${itin.stops} stops`);
  const touched = itin.legs.flatMap(l => [l.from, l.to]);
  const bad = [...new Set(touched.filter(a => avoid.has(a)))];
  if (bad.length) reasons.push(`connects via ${bad.join(', ')}`);
  if (config.airlines?.length && itin.legs.some(l => !config.airlines.includes(l.airline))) reasons.push('other airline');
  if (config.maxLayoverHours && itin.layovers.some(l => l.minutes > config.maxLayoverHours * 60)) reasons.push('layover too long');
  return reasons;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = await fn(items[i], i);
      } catch (err) {
        results[i] = { error: err.message };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Finds every round-trip itinerary that satisfies the configured criteria, with live
 * round-trip prices, baggage allowance and booking links.
 */
export async function findFlights(config) {
  const avoid = avoidedAirports(config);
  const maxOptions = config.maxOptions || 8;
  const minBags = config.checkedBagsIncluded || 0;

  const { itineraries: outbounds, baggageLinks } = await searchPage(config);
  const eligibleOut = outbounds.filter(o => routeViolations(config, o, avoid).length === 0);
  const pricedOut = eligibleOut.filter(o => o.price != null).sort((a, b) => a.price - b.price).slice(0, maxOptions);
  const unpricedOut = eligibleOut.filter(o => o.price == null);

  const trips = await mapLimit(pricedOut, 4, async (outbound) => {
    const { itineraries: returns, baggageLinks: moreLinks } = await searchPage(config, outbound);
    Object.assign(baggageLinks, moreLinks);
    const eligibleReturns = returns
      .filter(r => r.price != null && routeViolations(config, r, avoid).length === 0)
      .sort((a, b) => a.price - b.price);
    if (!eligibleReturns.length) return null;

    // Price the cheapest couple of returns and keep whichever gives the cheapest qualifying fare
    let best = null;
    for (const inbound of eligibleReturns.slice(0, 2)) {
      const { options: sellers } = await getBookingOptions(config, outbound, inbound);
      const cheapest = pickOption(sellers, minBags);
      if (!cheapest) continue; // no single-ticket fare with the required bags
      if (best && best.cheapest.price <= cheapest.price) continue;
      best = {
        inbound,
        cheapest,
        direct: pickOption(sellers, minBags, { airlineOnly: true }),
        refundable: pickOption(sellers, minBags, { refundableOnly: true }),
        sellers
      };
    }
    if (!best) return null;

    const { inbound, cheapest, direct, refundable, sellers } = best;
    const summarize = (o) => o && ({
      seller: o.seller, fare: o.fare, price: o.price, isAirline: o.isAirline,
      checkedBags: o.bags.checked, refund: o.refund, changes: o.changes
    });
    return {
      id: `${outbound.key}_${inbound.key}`,
      airlines: [...new Set([...outbound.airlines, ...inbound.airlines])],
      price: cheapest.price,
      checkedBags: cheapest.bags.checked,
      bagsVerified: cheapest.bags.checked != null,
      cheapest: summarize(cheapest),
      direct: summarize(direct),
      refundable: summarize(refundable),
      outbound,
      inbound,
      alternativeReturns: eligibleReturns.length - 1,
      bookingOptions: sellers.filter(o => !o.separateTickets).slice(0, 8).map(summarize),
      bookToken: encodeItinerary(outbound, inbound),
      googleBookingUrl: googleBookingUrl(config, outbound, inbound),
      baggagePolicyUrls: [...new Set([...outbound.legs, ...inbound.legs].map(l => l.airline))]
        .map(code => ({ airline: code, url: baggageLinks[code] }))
        .filter(x => x.url)
    };
  });

  const options = trips.filter(t => t && !t.error).sort((a, b) => a.price - b.price);
  const errors = trips.filter(t => t?.error).map(t => t.error);

  return {
    fetchedAt: new Date().toISOString(),
    searchUrl: googleSearchUrl(config),
    options,
    // Itineraries that match the route criteria but that Google Flights has no fare for
    // (e.g. Air India's own YYZ -> DEL -> AMD connections).
    unpriced: unpricedOut.map(o => ({
      id: o.key,
      airlines: o.airlines,
      outbound: o,
      googleSearchUrl: googleSearchUrl(config, o)
    })),
    errors
  };
}

/**
 * Resolves a fresh "Book with <airline>" click-through URL for an exact itinerary.
 * Google's click-through tokens expire, so this is fetched at click time.
 */
export async function resolveBookingLink(config, outbound, inbound, { prefer = 'direct' } = {}) {
  const { options } = await getBookingOptions(config, outbound, inbound);
  const linked = options.filter(o => o.clickUrl);
  const minBags = config.checkedBagsIncluded || 0;
  const best = (prefer === 'direct' && pickOption(linked, minBags, { airlineOnly: true }))
    || pickOption(linked, minBags)
    || linked.find(o => !o.separateTickets)
    || null;
  return best ? { url: best.clickUrl, seller: best.seller, fare: best.fare, price: best.price } : null;
}

// Compact, URL-safe encoding of an itinerary pair so booking links stay stateless (works on Vercel)
export function encodeItinerary(outbound, inbound) {
  const pack = (it) => it.legs.map(l => [l.from, l.departDate, l.to, l.airline, l.flightNumber]);
  return Buffer.from(JSON.stringify([pack(outbound), pack(inbound)])).toString('base64url');
}

export function decodeItinerary(token) {
  const unpack = (legs) => ({
    legs: legs.map(([from, departDate, to, airline, flightNumber]) => ({ from, departDate, to, airline, flightNumber }))
  });
  const [out, back] = JSON.parse(Buffer.from(String(token), 'base64url').toString('utf-8'));
  const valid = (legs) => Array.isArray(legs) && legs.length > 0 && legs.length <= 4
    && legs.every(l => Array.isArray(l) && l.length === 5 && l.every(v => typeof v === 'string' && /^[A-Z0-9-]{1,10}$/.test(v)));
  if (!valid(out) || !valid(back)) throw new Error('Invalid itinerary');
  return { outbound: unpack(out), inbound: unpack(back) };
}
