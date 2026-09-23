export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  try {
    // 1. If GITHUB_TOKEN is configured in Vercel environment variables, trigger GitHub Actions workflow
    const token = process.env.GITHUB_TOKEN;
    let triggeredWorkflow = false;

    if (token) {
      try {
        const ghRes = await fetch(
          'https://api.github.com/repos/VivekParmar-18/flight-tracker/actions/workflows/track.yml/dispatches',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/vnd.github.v3+json',
              'User-Agent': 'Flight-Tracker-Vercel'
            },
            body: JSON.stringify({ ref: 'main' })
          }
        );
        if (ghRes.ok) {
          triggeredWorkflow = true;
        }
      } catch (err) {
        console.error('Failed to trigger GitHub Actions workflow:', err);
      }
    }

    // 2. Fetch the latest live history from GitHub repository directly
    const rawUrl = `https://raw.githubusercontent.com/VivekParmar-18/flight-tracker/main/flight_history.json?t=${Date.now()}`;
    const rawRes = await fetch(rawUrl, { cache: 'no-store' });
    let latestHistory = [];
    if (rawRes.ok) {
      latestHistory = await rawRes.json();
    }

    const latest = latestHistory[latestHistory.length - 1] || null;

    res.status(200).json({
      success: true,
      snapshot: latest,
      triggeredWorkflow,
      message: triggeredWorkflow
        ? 'GitHub Actions cloud scrape triggered! New prices will update in ~60 seconds.'
        : 'Checked latest cloud data. Automated scraper runs every 10 minutes in GitHub Actions.'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
