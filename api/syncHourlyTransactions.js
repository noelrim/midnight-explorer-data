// File: api/syncHourly.js
import syncHourlyStats from '../lib/pipeline/syncHourlyTransactions.js';

export default async function handler(req, res) {
  if (req.query.secret !== process.env.PIPELINE_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    await syncHourlyStats();
    return res.status(200).json({ message: 'Hourly sync complete' });
  } catch (err) {
    console.error('❌ Hourly sync error:', err);
    return res.status(500).json({ error: 'Hourly sync failed', details: err.message });
  }
}