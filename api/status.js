import { serverlessStatus } from '../lib/serverless.js';

export default async function handler(req, res) {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(await serverlessStatus());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
