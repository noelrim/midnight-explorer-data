// File: api/syncSpometrics.js
import syncSpometrics from '../lib/pipeline/syncSpometrics.js';

export default async function handler(req, res) {
  if (req.query.secret !== process.env.PIPELINE_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    await syncSpometrics();
    return res.status(200).json({ message: 'Spometrics sync complete' });
  } catch (err) {
    console.error('❌ Spometrics sync error:', err);
    return res.status(500).json({ error: 'Spometrics sync failed', details: err.message });
  }
}
