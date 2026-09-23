let priceChartInstance = null;
let countdownTimer = null;
const INTERVAL_MS = 10 * 60 * 1000;

// Universal clock anchor: all users compute against the exact same 10-minute clock boundary
function computeNextCheckTimestamp() {
  const now = Date.now();
  return Math.ceil(now / INTERVAL_MS) * INTERVAL_MS;
}

let targetNextCheckTimestamp = computeNextCheckTimestamp();
let serverIsScraping = false;

async function fetchStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    renderDashboard(data);
  } catch (err) {
    console.error('Failed to fetch flight status:', err);
  }
}

function renderDashboard(data) {
  const { config, latest, history, stats } = data;

  if (latest) {
    document.getElementById('currentPrice').textContent = Number(latest.priceCAD).toLocaleString();
    const dateObj = new Date(latest.timestamp);
    document.getElementById('lastUpdatedTag').textContent = `Last Checked: ${dateObj.toLocaleDateString()} ${dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;

    const bookBtn = document.getElementById('btnBookAirIndia');
    if (bookBtn) {
      bookBtn.href = latest.bookingUrl || 'https://www.airindia.com/in/en/google-flight-booking.html?or=YYZ&de=AMD&on=202701101115&re=202702060820&ad=1&ch=0&in=0&tr=R&cc=ECONOMY&po=CA';
    }
  }

  if (stats) {
    if (stats.minPrice) document.getElementById('statLowest').textContent = `CA$${Number(stats.minPrice).toLocaleString()}`;
    if (stats.avgPrice) document.getElementById('statAverage').textContent = `CA$${Number(stats.avgPrice).toLocaleString()}`;
    if (config.targetPriceCAD) document.getElementById('statTarget').textContent = `CA$${Number(config.targetPriceCAD).toLocaleString()}`;
    
    serverIsScraping = !!stats.isScraping;
    if (stats.nextCheckTimestamp) {
      targetNextCheckTimestamp = stats.nextCheckTimestamp;
    }
  }

  if (config && config.targetPriceCAD) {
    document.getElementById('targetInput').value = config.targetPriceCAD;
  }

  document.getElementById('logCount').textContent = `${history.length} Checks Logged`;

  renderChart(history, config?.targetPriceCAD);
  renderTable(history);
  updateCountdownDisplay();
}

function updateCountdownDisplay() {
  const timerEl = document.getElementById('nextCheckTimer');
  if (!timerEl) return;

  if (serverIsScraping) {
    timerEl.textContent = 'Scraping live prices...';
    return;
  }

  const now = Date.now();
  let remainingMs = targetNextCheckTimestamp - now;

  // If countdown reached zero, re-anchor to the next 10-minute boundary and trigger a sync fetch
  if (remainingMs <= 0) {
    targetNextCheckTimestamp = computeNextCheckTimestamp();
    remainingMs = Math.max(0, targetNextCheckTimestamp - now);
    timerEl.textContent = 'Checking now...';
    setTimeout(fetchStatus, 3000);
    return;
  }

  const mins = Math.floor(remainingMs / 60000);
  const secs = Math.floor((remainingMs % 60000) / 1000);
  timerEl.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function startCountdown() {
  if (countdownTimer) clearInterval(countdownTimer);
  updateCountdownDisplay();
  countdownTimer = setInterval(updateCountdownDisplay, 1000);
}

function renderChart(history, targetPrice) {
  const ctx = document.getElementById('priceChart').getContext('2d');

  let chartData = [...history];
  if (chartData.length === 1) {
    const p = chartData[0];
    const earlier = new Date(new Date(p.timestamp).getTime() - 10 * 60 * 1000).toISOString();
    chartData.unshift({
      timestamp: earlier,
      priceCAD: p.priceCAD
    });
  }

  const labels = chartData.map(item => {
    const d = new Date(item.timestamp);
    return `${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  });

  const prices = chartData.map(item => item.priceCAD);

  if (priceChartInstance) {
    priceChartInstance.destroy();
  }

  const gradient = ctx.createLinearGradient(0, 0, 0, 260);
  gradient.addColorStop(0, 'rgba(0, 229, 255, 0.35)');
  gradient.addColorStop(1, 'rgba(0, 229, 255, 0.0)');

  priceChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Air India Fare (CAD)',
          data: prices,
          borderColor: '#00e5ff',
          backgroundColor: gradient,
          borderWidth: 3,
          fill: true,
          tension: 0.3,
          pointBackgroundColor: '#00e5ff',
          pointBorderColor: '#070e17',
          pointBorderWidth: 2,
          pointRadius: 5,
          pointHoverRadius: 7
        },
        {
          label: 'Target Alert Threshold',
          data: Array(prices.length).fill(targetPrice || 2400),
          borderColor: '#f59e0b',
          borderWidth: 2,
          borderDash: [6, 4],
          pointRadius: 0,
          fill: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: {
            color: '#8ba2b8',
            font: { family: 'Outfit', size: 12 }
          }
        },
        tooltip: {
          backgroundColor: 'rgba(7, 14, 23, 0.95)',
          titleFont: { family: 'Outfit', size: 13 },
          bodyFont: { family: 'Space Mono', size: 13 },
          borderColor: 'rgba(0, 229, 255, 0.3)',
          borderWidth: 1,
          callbacks: {
            label: function(context) {
              return ` ${context.dataset.label}: CA$${Number(context.raw).toLocaleString()}`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { color: '#5c748a', font: { family: 'Outfit', size: 11 } }
        },
        y: {
          min: 2000,
          max: 3000,
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: {
            color: '#5c748a',
            font: { family: 'Space Mono', size: 11 },
            callback: value => `CA$${value}`
          }
        }
      }
    }
  });
}

function renderTable(history) {
  const tbody = document.getElementById('historyTableBody');
  tbody.innerHTML = '';

  const reversed = [...history].reverse();
  reversed.forEach(item => {
    const tr = document.createElement('tr');
    const d = new Date(item.timestamp);
    const dateFormatted = `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;

    tr.innerHTML = `
      <td>${dateFormatted}</td>
      <td><strong>${item.airline || 'Air India'}</strong></td>
      <td>${item.origin} → ${item.destination}</td>
      <td>${item.dateFrom} / ${item.dateTo}</td>
      <td><span class="badge-pill">${item.stops === 1 ? '1 Stop (DEL)' : item.stops + ' stops'}</span></td>
      <td>${item.checkedBags || '2 Bags (23kg)'}</td>
      <td class="fare-cell">CA$${Number(item.priceCAD).toLocaleString()}</td>
      <td><a href="${item.bookingUrl || 'https://www.airindia.com/in/en/google-flight-booking.html?or=YYZ&de=AMD&on=202701101115&re=202702060820&ad=1&ch=0&in=0&tr=R&cc=ECONOMY&po=CA'}" target="_blank" class="status-badge" style="text-decoration:none;cursor:pointer;color:#00e5ff;border-color:rgba(0,229,255,0.4)">Book ↗</a></td>
    `;
    tbody.appendChild(tr);
  });
}

// Event Listeners
document.getElementById('btnCheckNow').addEventListener('click', async () => {
  const btn = document.getElementById('btnCheckNow');
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="btn-icon">⏳</span> Checking Google Flights Live...`;

  try {
    const res = await fetch('/api/check-now', { method: 'POST' });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      data = { error: text.replace(/<[^>]*>?/gm, '').trim() || 'Unexpected server response' };
    }

    if (data.error) {
      alert(`Notice: ${data.error}`);
    } else {
      if (data.message) {
        alert(data.message);
      }
      await fetchStatus();
    }
  } catch (err) {
    alert(`Scrape error: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
});

document.getElementById('btnSaveTarget').addEventListener('click', async () => {
  const targetVal = document.getElementById('targetInput').value;
  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetPriceCAD: targetVal })
    });
    const data = await res.json();
    if (data.success) {
      alert(`Target alert threshold saved: CA$${targetVal}`);
      fetchStatus();
    }
  } catch (err) {
    alert('Failed to save target price: ' + err.message);
  }
});

// Start synchronized countdown immediately
startCountdown();

// Periodic background sync in UI every 15 seconds
setInterval(fetchStatus, 15000);

// Initial load
fetchStatus();
