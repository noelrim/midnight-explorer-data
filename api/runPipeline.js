import { handler as runPipeline } from '../lib/pipeline/index.js';

export default async function handler(req, res) {
  const secret = process.env.PIPELINE_SECRET;
  if (secret && req.query.secret !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    await runPipeline();
    res.status(200).json({ message: '✅ Pipeline executed successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Pipeline failed', details: err.message });
  }
}
