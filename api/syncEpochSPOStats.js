// File: api/syncEpochSPOStats.js
import syncEpochSPOStats from '../lib/pipeline/syncEpochSPOStats.js';

export default async function handler(req, res) {
  if (req.query.secret !== process.env.PIPELINE_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const result = await syncEpochSPOStats();
    return res.status(200).json({
      message: `Epoch SPO stats sync complete.`,
      ...result
    });
  } catch (err) {
    console.error('❌ EpochSPOStats sync error:', err);
    return res.status(500).json({ error: 'Sync failed', details: err.message });
  }
}
