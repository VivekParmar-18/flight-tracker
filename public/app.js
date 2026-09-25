let priceChartInstance = null;
let latestData = null;
let targetNextCheckTimestamp = null;
let checkInFlight = false;
let statusPollTimer = null;
const selectedAirlines = new Set(); // empty = show all

const AIRLINE_SITES = {
  'Air India': 'https://www.airindia.com/',
  'Air Canada': 'https://www.aircanada.com/',
  'Emirates': 'https://www.emirates.com/ca/english/',
  'Etihad': 'https://www.etihad.com/en-ca/',
  'Qatar Airways': 'https://www.qatarairways.com/en-ca/homepage.html'
};

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => (typeof n === 'number' ? `CA$${n.toLocaleString('en-CA')}` : '—');

function duration(min) {
  if (typeof min !== 'number') return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function shortDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' });
}

function dateTime(iso) {
  const d = new Date(iso);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function getTarget(config) {
  try {
    const stored = Number(localStorage.getItem('targetPriceCAD'));
    if (stored > 0) return stored;
  } catch {
    // storage unavailable
  }
  return config?.targetPriceCAD || null;
}

const bookUrl = (option, prefer) => `/api/book?t=${encodeURIComponent(option.bookToken)}&prefer=${prefer}`;

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

async function fetchStatus() {
  try {
    const res = await fetch('/api/status', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    render(data);

    // First load on a serverless deployment with old data: fetch fresh prices right away
    if (data.stats.stale && data.stats.mode === 'serverless' && !checkInFlight) {
      runLiveCheck({ auto: true });
    }
    // The local server is mid-search: keep polling until it's done
    clearTimeout(statusPollTimer);
    if (data.stats.isScraping) statusPollTimer = setTimeout(fetchStatus, 4000);
  } catch (err) {
    showError(`Could not load flight data (${err.message}).`);
  }
}

async function runLiveCheck({ auto = false } = {}) {
  if (checkInFlight) return;
  checkInFlight = true;
  const btn = document.getElementById('btnCheckNow');
  btn.disabled = true;
  btn.innerHTML = '<span class="btn-icon spin">↻</span> Searching live fares…';
  document.getElementById('nextCheckTimer').textContent = 'searching…';

  try {
    const res = await fetch('/api/check-now', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    render(data);
    const best = data.latest?.bestPrice;
    btn.innerHTML = `<span class="btn-icon">✓</span> ${best != null ? `Best now: ${money(best)}` : 'Prices updated'}`;
  } catch (err) {
    showError(`Live search failed: ${err.message}. Showing the last saved results.`);
    btn.innerHTML = '<span class="btn-icon">↻</span> Try Again';
  } finally {
    checkInFlight = false;
    setTimeout(() => {
      btn.disabled = false;
      btn.innerHTML = '<span class="btn-icon">↻</span> Check Live Prices Now';
    }, auto ? 0 : 2500);
  }
}

function showError(message) {
  const el = document.getElementById('errorBanner');
  el.hidden = !message;
  el.textContent = message || '';
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function render(data) {
  latestData = data;
  const { config, latest, history, stats } = data;

  renderDataHealth(latest, stats);
  renderHeader(config, latest);
  renderCriteria(config);
  renderHero(config, latest, stats);
  renderChart(history, getTarget(config));
  renderAirlineFilters(latest);
  renderOptions(latest);
  renderUnpriced(latest);
  renderTable(history);

  targetNextCheckTimestamp = stats.nextCheckTimestamp;
  updateCountdown();
}

// Warn loudly whenever the prices on screen are not fresh, so old data is never mistaken for live data
function renderDataHealth(latest, stats) {
  const notes = [];
  if (latest) {
    const ageMin = Math.round((Date.now() - Date.parse(latest.timestamp)) / 60000);
    const age = ageMin < 90 ? `${ageMin} min` : `${Math.round(ageMin / 60)} h`;
    if (stats.lastError) notes.push(`Latest live check failed: ${stats.lastError.message}. Prices below are from ${age} ago.`);
    else if (ageMin > (stats.intervalMinutes || 10) * 3 && !checkInFlight) notes.push(`Prices below are ${age} old — press "Check Live Prices Now" to refresh.`);
    if (latest.partial) notes.push('Some flights could not be priced in the last check and may be missing from the list.');
  } else if (stats.lastError) {
    notes.push(`Live check failed: ${stats.lastError.message}`);
  }
  showError(notes.join(' '));
}

function renderHeader(config, latest) {
  document.getElementById('routeFrom').textContent = config.originCity || config.origin;
  document.getElementById('routeTo').textContent = config.destinationCity || config.destination;
  document.getElementById('routeSubtitle').textContent =
    `${config.origin} ⇄ ${config.destination} • ${shortDate(config.dateFrom)} – ${shortDate(config.dateTo)}, ${config.dateTo.slice(0, 4)} • Round trip, 1 adult, economy`;

  const btn = document.getElementById('btnBookBest');
  const best = latest?.options?.[0];
  if (best) {
    btn.href = bookUrl(best, 'cheapest');
    btn.classList.remove('is-disabled');
    btn.textContent = `Book Best Deal · ${money(best.price)} ↗`;
    btn.title = `${best.airlines.join(' / ')} via ${best.cheapest?.seller || 'best seller'}`;
  } else {
    btn.href = latest?.searchUrl || '#';
    btn.textContent = 'Search on Google Flights ↗';
    btn.classList.toggle('is-disabled', !latest?.searchUrl);
  }
}

function renderCriteria(config) {
  const airlines = config.airlines?.length ? config.airlines.join(', ') : 'Any airline';
  const cards = [
    ['🛡️', 'No US Layovers', 'No connections through US airports — no US transit visa needed', 'badge-success'],
    ['✈️', `Max ${config.maxStops} Stop Each Way`, 'Single ticket only — bags checked through, protected connection', 'badge-success'],
    ['🧳', `${config.checkedBagsIncluded} Checked Bags Included`, 'Only fares that include the free checked bags count', 'badge-gold'],
    ['🔍', airlines, `Live fares from Google Flights, checked every ${config.scrapeIntervalMinutes || 10} min`, 'badge-info']
  ];
  document.getElementById('criteriaRow').innerHTML = cards.map(([icon, title, text, cls]) => `
    <div class="badge-card ${cls}">
      <span class="badge-icon">${icon}</span>
      <div><strong>${esc(title)}</strong><p>${esc(text)}</p></div>
    </div>`).join('');
}

function renderHero(config, latest, stats) {
  const best = latest?.options?.[0];
  document.getElementById('currentPrice').textContent = best ? best.price.toLocaleString('en-CA') : '—';
  document.getElementById('lastUpdatedTag').textContent = latest ? `Checked ${dateTime(latest.timestamp)}` : 'Not checked yet';

  const change = document.getElementById('priceChange');
  if (best && typeof stats.previousPrice === 'number' && stats.previousPrice !== best.price) {
    const diff = best.price - stats.previousPrice;
    change.textContent = `${diff > 0 ? '▲' : '▼'} ${money(Math.abs(diff))}`;
    change.className = `price-change ${diff > 0 ? 'up' : 'down'}`;
  } else {
    change.textContent = '';
  }

  const summary = document.getElementById('bestSummary');
  if (best) {
    const direct = best.direct && best.direct.seller !== best.cheapest?.seller
      ? ` • Direct with ${esc(best.direct.seller)}: <strong>${money(best.direct.price)}</strong>` : '';
    summary.innerHTML = `<strong>${esc(best.airlines.join(' / '))}</strong> via ${esc(best.outbound.layovers.map(l => l.city || l.airport).join(', ') || 'nonstop')}` +
      ` • Sold by ${esc(best.cheapest?.seller || '—')}${direct}`;
  } else if (latest) {
    summary.textContent = 'No priced flights currently match all criteria.';
  }

  const typical = document.getElementById('typicalRange');
  const range = latest?.typicalRange;
  typical.hidden = !(best && range);
  if (best && range) {
    const level = best.price < range[0] ? 'low' : best.price > range[1] ? 'high' : 'typical';
    typical.innerHTML = `Google Flights says fares for this search are usually <strong>${money(range[0])}–${money(range[1])}</strong> — today's best is <strong class="level-${level}">${level}</strong>.`;
  }

  const target = getTarget(config);
  const alert = document.getElementById('targetAlert');
  alert.hidden = !(best && target && best.price <= target);
  alert.textContent = best && target && best.price <= target ? `🎯 Below your target of ${money(target)} — good time to book!` : '';

  document.getElementById('statLowest').textContent = money(stats.minPrice);
  document.getElementById('statAverage').textContent = money(stats.avgPrice);
  document.getElementById('statTarget').textContent = money(target);
  const input = document.getElementById('targetInput');
  if (document.activeElement !== input) input.value = target || '';
}

function renderChart(history, targetPrice) {
  const points = history.filter(h => typeof h.bestPrice === 'number');
  const empty = document.getElementById('chartEmpty');
  empty.hidden = points.length > 0;
  const count = `${history.length} check${history.length === 1 ? '' : 's'}`;
  document.getElementById('logCount').textContent = count;
  document.getElementById('logCount2').textContent = count;
  if (typeof Chart === 'undefined') return;

  const ctx = document.getElementById('priceChart').getContext('2d');
  const labels = points.map(p => {
    const d = new Date(p.timestamp);
    return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  });
  const prices = points.map(p => p.bestPrice);

  if (priceChartInstance) priceChartInstance.destroy();
  const gradient = ctx.createLinearGradient(0, 0, 0, 260);
  gradient.addColorStop(0, 'rgba(0, 229, 255, 0.35)');
  gradient.addColorStop(1, 'rgba(0, 229, 255, 0.0)');

  const datasets = [{
    label: 'Best matching fare (CAD)',
    data: prices,
    borderColor: '#00e5ff',
    backgroundColor: gradient,
    borderWidth: 2,
    fill: true,
    tension: 0.25,
    pointBackgroundColor: '#00e5ff',
    pointBorderColor: '#070e17',
    pointRadius: points.length > 60 ? 0 : 3,
    pointHoverRadius: 6
  }];
  if (targetPrice) {
    datasets.push({
      label: 'Target alert',
      data: Array(prices.length).fill(targetPrice),
      borderColor: '#f59e0b',
      borderWidth: 2,
      borderDash: [6, 4],
      pointRadius: 0,
      fill: false
    });
  }

  priceChartInstance = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { left: 6 } },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: '#8ba2b8', font: { family: 'Outfit', size: 12 } } },
        tooltip: {
          backgroundColor: 'rgba(7, 14, 23, 0.95)',
          borderColor: 'rgba(0, 229, 255, 0.3)',
          borderWidth: 1,
          callbacks: { label: (c) => ` ${c.dataset.label}: ${money(c.raw)}` }
        }
      },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#5c748a', maxTicksLimit: 8 } },
        y: {
          grace: '10%',
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#5c748a', font: { family: 'Space Mono', size: 11 }, callback: (v) => money(v) }
        }
      }
    }
  });
}

function renderAirlineFilters(latest) {
  const airlines = [...new Set((latest?.options || []).flatMap(o => o.airlines))].sort();
  for (const a of [...selectedAirlines]) if (!airlines.includes(a)) selectedAirlines.delete(a);
  const chip = (label, active, value) =>
    `<button class="chip ${active ? 'active' : ''}" data-airline="${esc(value)}">${esc(label)}</button>`;
  document.getElementById('airlineFilters').innerHTML =
    chip('All airlines', selectedAirlines.size === 0, '') + airlines.map(a => chip(a, selectedAirlines.has(a), a)).join('');
}

function legSummary(label, itin) {
  const layovers = itin.layovers.length
    ? itin.layovers.map(l => `${duration(l.minutes)} in ${esc(l.city || l.airport)} (${esc(l.airport)})`).join(', ')
    : 'Nonstop';
  const plus = itin.arriveDayOffset > 0 ? `<sup>+${itin.arriveDayOffset}</sup>` : '';
  return `
    <div class="leg-row">
      <div class="leg-label">${label} • ${esc(shortDate(itin.departDate))}</div>
      <div class="leg-times"><strong>${esc(itin.departTime)}</strong> ${esc(itin.from)} → <strong>${esc(itin.arriveTime)}${plus}</strong> ${esc(itin.to)}</div>
      <div class="leg-meta">${duration(itin.durationMin)} • ${itin.stops === 0 ? 'Nonstop' : `${itin.stops} stop: ${layovers}`}</div>
    </div>`;
}

function segmentDetails(itin) {
  return itin.legs.map((l, i) => {
    const layover = itin.layovers[i];
    return `
      <div class="segment">
        <span class="flight-number">${esc(l.airline)} ${esc(l.flightNumber)}</span>
        <span>${esc(l.airlineName || '')}${l.aircraft ? ` • ${esc(l.aircraft)}` : ''}</span>
        <span>${esc(shortDate(l.departDate))} ${esc(l.departTime)} ${esc(l.from)} → ${esc(l.arriveTime)} ${esc(l.to)} (${duration(l.durationMin)})</span>
      </div>
      ${layover && i < itin.legs.length - 1 ? `<div class="segment-layover">⏱️ ${duration(layover.minutes)} layover at ${esc(layover.airportName || layover.airport)}</div>` : ''}`;
  }).join('');
}

function optionCard(o, isBest) {
  const bagsTag = o.bagsVerified
    ? `<span class="tag tag-green">🧳 ${o.checkedBags} free checked bag${o.checkedBags === 1 ? '' : 's'}</span>`
    : '<span class="tag tag-warn">🧳 Bags not reported — check at booking</span>';
  const fare = o.cheapest?.fare ? `<span class="tag">${esc(o.cheapest.fare)} fare</span>` : '';
  const refund = o.refundable
    ? `<span class="tag tag-blue">↩︎ ${esc(o.refundable.refund)}${o.refundable.price !== o.price ? ` from ${money(o.refundable.price)}` : ''}</span>`
    : '';

  const directBtn = o.direct
    ? `<a class="btn btn-gold btn-sm" target="_blank" rel="noopener" href="${bookUrl(o, 'direct')}">Book with ${esc(o.direct.seller)} · ${money(o.direct.price)} ↗</a>`
    : '';
  const cheapestBtn = o.cheapest && (!o.direct || o.cheapest.seller !== o.direct.seller)
    ? `<a class="btn ${o.direct ? 'btn-secondary' : 'btn-gold'} btn-sm" target="_blank" rel="noopener" href="${bookUrl(o, 'cheapest')}">${o.direct ? 'Cheapest: ' : 'Book with '}${esc(o.cheapest.seller)} · ${money(o.cheapest.price)} ↗</a>`
    : '';

  const sellers = (o.bookingOptions || []).map(s => `
    <tr><td>${esc(s.seller)}${s.isAirline ? ' <span class="tag tag-mini">airline</span>' : ''}</td>
      <td>${esc(s.fare || '—')}</td>
      <td>${s.checkedBags == null ? '?' : s.checkedBags}</td>
      <td>${esc(s.refund || '—')}</td>
      <td class="fare-cell">${money(s.price)}</td></tr>`).join('');

  return `
    <article class="card option-card ${isBest ? 'is-best' : ''}">
      ${isBest ? '<span class="best-ribbon">BEST DEAL</span>' : ''}
      <div class="option-head">
        <div>
          <div class="option-airlines">${esc(o.airlines.join(' / '))}</div>
          <div class="tag-row">${bagsTag}${fare}${refund}</div>
        </div>
        <div class="option-price">
          <span class="price">${money(o.price)}</span>
          <span class="price-sub">round trip via ${esc(o.cheapest?.seller || '—')}</span>
        </div>
      </div>
${o.cheapestAnyBags ? `<p class="fare-note">ℹ️ Price shown is the cheapest fare with ${o.checkedBags} free checked bags. The lowest fare on this trip is ${money(o.cheapestAnyBags.price)}${o.cheapestAnyBags.fare ? ` (${esc(o.cheapestAnyBags.fare)})` : ''} with only ${o.cheapestAnyBags.checkedBags ?? 'unknown'} checked bag${o.cheapestAnyBags.checkedBags === 1 ? '' : 's'}.</p>` : ''}
      <div class="legs">${legSummary('Outbound', o.outbound)}${legSummary('Return', o.inbound)}</div>
      <details class="option-details">
        <summary>Flight numbers, layovers &amp; all ${o.bookingOptions?.length || 0} booking options</summary>
        <div class="details-grid">
          <div><h4>Outbound</h4>${segmentDetails(o.outbound)}</div>
          <div><h4>Return</h4>${segmentDetails(o.inbound)}</div>
        </div>
        <table class="history-table sellers-table">
          <thead><tr><th>Seller</th><th>Fare</th><th>Free bags</th><th>Refund</th><th>Price</th></tr></thead>
          <tbody>${sellers}</tbody>
        </table>
        ${o.baggagePolicyUrls?.length ? `<p class="small-note">Baggage policy: ${o.baggagePolicyUrls.map(b => `<a href="${esc(b.url)}" target="_blank" rel="noopener">${esc(b.airline)}</a>`).join(' • ')}</p>` : ''}
      </details>
      <div class="option-actions">
        ${directBtn}${cheapestBtn}
        <a class="btn btn-link btn-sm" target="_blank" rel="noopener" href="${esc(o.googleBookingUrl)}">Compare on Google Flights ↗</a>
      </div>
    </article>`;
}

function renderOptions(latest) {
  const list = document.getElementById('optionsList');
  const all = latest?.options || [];
  const bestId = all[0]?.id;
  let options = selectedAirlines.size
    ? all.filter(o => o.airlines.some(a => selectedAirlines.has(a)))
    : [...all];

  const sort = document.getElementById('sortSelect').value;
  const totalDuration = (o) => o.outbound.durationMin + o.inbound.durationMin;
  if (sort === 'duration') options.sort((a, b) => totalDuration(a) - totalDuration(b));
  else if (sort === 'direct') options.sort((a, b) => (a.direct?.price ?? Infinity) - (b.direct?.price ?? Infinity));
  else options.sort((a, b) => a.price - b.price);

  document.getElementById('optionCount').textContent = options.length;
  if (!latest) {
    list.innerHTML = '<div class="card empty-card">Searching live fares on Google Flights…</div>';
  } else if (!options.length) {
    list.innerHTML = '<div class="card empty-card">No priced round trips match all criteria right now.</div>';
  } else {
    list.innerHTML = options.map(o => optionCard(o, o.id === bestId)).join('');
  }
}

function referenceCard(label, fare) {
  if (!fare) return '';
  const range = fare.typicalRange;
  const level = range ? (fare.price < range[0] ? 'low' : fare.price > range[1] ? 'high' : 'typical') : null;
  return `
    <div class="card reference-card">
      <div class="leg-label">${esc(label)}</div>
      <div class="option-price"><span class="price">${money(fare.price)}</span></div>
      <div class="leg-meta">${fare.flights.map(esc).join(' → ')}${range ? ` • usually ${money(range[0])}–${money(range[1])}, now <span class="level-${level}">${level}</span>` : ''}</div>
      <a class="btn btn-link btn-sm" target="_blank" rel="noopener" href="${esc(fare.url)}">View on Google Flights ↗</a>
    </div>`;
}

function renderUnpriced(latest) {
  const items = latest?.unpriced || [];
  const ref = latest?.reference;
  const r = latest?.route;
  document.getElementById('unpricedSection').hidden = !items.length && !ref;
  document.getElementById('unpricedTitle').textContent = ref
    ? `${ref.name} — no ${r?.originCity || ''} ⇄ ${r?.destinationCity || ''} fare published`
    : 'Also on this route — no fare published';
  document.getElementById('referenceFares').innerHTML = ref ? `
    <p class="section-note reference-note">For comparison, ${esc(ref.name)}'s live fares to its hub ${esc(ref.hub)} on the same dates (Delhi only — Ahmedabad would need a separate ticket, so these don't meet your single-ticket rule):</p>
    ${referenceCard(`Round trip ${r?.origin || ''} ⇄ ${ref.hub}`, ref.roundTrip)}
    ${referenceCard(`One way ${r?.origin || ''} → ${ref.hub}`, ref.oneWay)}` : '';
  document.getElementById('unpricedList').innerHTML = items.map(u => {
    const airline = u.airlines[0];
    const site = AIRLINE_SITES[airline];
    return `
      <div class="card unpriced-card">
        <div class="option-airlines">${esc(u.airlines.join(' / '))}</div>
        ${legSummary('Outbound', u.outbound)}
        <div class="segment-list">${u.outbound.legs.map(l => `<span class="flight-number">${esc(l.airline)} ${esc(l.flightNumber)}</span>`).join(' → ')}</div>
        <div class="option-actions">
          ${site ? `<a class="btn btn-secondary btn-sm" target="_blank" rel="noopener" href="${site}">Check fare on ${esc(airline)} ↗</a>` : ''}
          <a class="btn btn-link btn-sm" target="_blank" rel="noopener" href="${esc(u.googleSearchUrl)}">View on Google Flights ↗</a>
        </div>
      </div>`;
  }).join('');
}

function renderTable(history) {
  const rows = [...history].reverse().slice(0, 100).map(h => `
    <tr>
      <td>${esc(dateTime(h.timestamp))}</td>
      <td class="fare-cell">${money(h.bestPrice)}</td>
      <td><strong>${esc((h.bestAirlines || []).join(' / ') || '—')}</strong></td>
      <td>${esc(h.bestSeller || '—')}</td>
      <td>${h.matches ?? 0}</td>
    </tr>`).join('');
  document.getElementById('historyTableBody').innerHTML =
    rows || '<tr><td colspan="5">No checks logged yet.</td></tr>';
}

// ---------------------------------------------------------------------------
// Countdown & auto refresh
// ---------------------------------------------------------------------------

function updateCountdown() {
  const el = document.getElementById('nextCheckTimer');
  if (checkInFlight || latestData?.stats?.isScraping) {
    el.textContent = 'searching…';
    return;
  }
  if (!targetNextCheckTimestamp) return;

  const remaining = targetNextCheckTimestamp - Date.now();
  if (remaining <= 0) {
    const intervalMs = (latestData?.stats?.intervalMinutes || 10) * 60000;
    targetNextCheckTimestamp = Math.ceil((Date.now() + 1000) / intervalMs) * intervalMs;
    if (latestData?.stats?.mode === 'serverless') {
      runLiveCheck({ auto: true }); // no background worker on Vercel: the open page triggers the check
    } else {
      setTimeout(fetchStatus, 5000); // the local server polls on the same boundary
    }
    return;
  }
  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  el.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

document.getElementById('btnCheckNow').addEventListener('click', () => runLiveCheck());

document.getElementById('sortSelect').addEventListener('change', () => renderOptions(latestData?.latest));

document.getElementById('airlineFilters').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  const airline = chip.dataset.airline;
  if (!airline) selectedAirlines.clear();
  else if (selectedAirlines.has(airline)) selectedAirlines.delete(airline);
  else selectedAirlines.add(airline);
  renderAirlineFilters(latestData?.latest);
  renderOptions(latestData?.latest);
});

document.getElementById('btnSaveTarget').addEventListener('click', async () => {
  const target = Number(document.getElementById('targetInput').value);
  if (!(target > 0)) return;
  try {
    localStorage.setItem('targetPriceCAD', String(target));
  } catch {
    // storage unavailable — the server copy below still applies locally
  }
  try {
    await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetPriceCAD: target })
    });
  } catch {
    // not available on the serverless deployment; the browser copy is used instead
  }
  if (latestData) render(latestData);
});

setInterval(updateCountdown, 1000);
fetchStatus();
