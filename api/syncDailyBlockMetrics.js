import syncDailyBlockMetrics from '../../lib/pipeline/syncDailyBlockMetrics.js';

export default async function handler(req, res) {
  if (req.query.secret !== process.env.PIPELINE_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    await syncDailyBlockMetrics();
    return res.status(200).json({ message: 'Daily block metrics sync complete' });
  } catch (err) {
    console.error('❌ Daily sync error:', err);
    return res.status(500).json({ error: 'Daily sync failed', details: err.message });
  }
}