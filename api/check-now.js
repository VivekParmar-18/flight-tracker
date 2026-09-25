import { refreshLive, serverlessStatus } from '../lib/serverless.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  try {
    await refreshLive();
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ success: true, ...(await serverlessStatus()) });
  } catch (error) {
    res.status(502).json({ error: `Live search failed: ${error.message}` });
  }
}
