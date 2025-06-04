// File: api/ingestRecentBlocks.js
import ingestRecentBlocks from '../lib/pipeline/ingestRecentBlocks.js';

export default async function handler(req, res) {
  if (req.query.secret !== process.env.PIPELINE_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    await ingestRecentBlocks();
    return res.status(200).json({ message: 'Ingestion complete' });
  } catch (err) {
    console.error('❌ Ingestion error:', err);
    return res.status(500).json({ error: 'Ingestion failed', details: err.message });
  }
}