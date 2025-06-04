// /api/runPipeline.js
import { handler as runPipeline } from '../lib/pipeline/index.js';

export default async function handler(req, res) {
  const secret = process.env.PIPELINE_SECRET;
  if (secret && req.query.secret !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    await runPipeline(); // execute directly
    res.status(200).json({ message: 'Pipeline executed.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed', details: err.message });
  }
}