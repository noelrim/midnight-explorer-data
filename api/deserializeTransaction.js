import deserializeTransaction from '../lib/pipeline/deserializeTransaction.js';

export default async function handler(req, res) {
  if (req.query.secret !== process.env.PIPELINE_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Manually parse JSON body if Content-Type is application/json
  if (req.method === 'POST' && req.headers['content-type']?.includes('application/json')) {
    try {
      const buffers = [];
      for await (const chunk of req) {
        buffers.push(chunk);
      }
      req.body = JSON.parse(Buffer.concat(buffers).toString());
    } catch (err) {
      console.error('❌ Error parsing JSON body:', err);
      return res.status(400).json({ error: 'Invalid JSON body' });
    }
  }

  const rawTxHex = req.body?.txHex;
  if (!rawTxHex) {
    return res.status(400).json({ error: 'Missing txHex in request body' });
  }

  try {
    const tx = await deserializeTransaction(rawTxHex);
    return res.status(200).json({
      message: `Transaction deserialized successfully`,
      transaction: tx
    });
  } catch (err) {
    console.error('❌ Error during deserialization:', err);
    return res.status(500).json({ error: 'Deserialization failed', details: err.message });
  }
}
