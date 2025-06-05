// File: api/syncSPOs.js
import syncSPOs from '../lib/pipeline/syncSPOs.js';

export default async function handler(req, res) {
  if (req.query.secret !== process.env.PIPELINE_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const { spoCount, validCount } = await syncSPOs();
    return res.status(200).json({
      message: `SPO sync complete: ${spoCount} total, ${validCount} valid`,
    });
  } catch (err) {
    console.error('❌ SPO sync error:', err);
    return res.status(500).json({ error: 'SPO sync failed', details: err.message });
  }
}
