import deserializeTransaction from '../lib/pipeline/deserializeTransaction.js';

export default async function handler(req, res) {
  // CORS headers for all requests
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_TX_DES_ORIGIN || "https://localhost:3001");
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Secret check
  if (req.query.secret !== process.env.PIPELINE_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Manually parse request body
  let body = '';
  await new Promise((resolve, reject) => {
    req.on('data', chunk => {
      body += chunk;
    });
    req.on('end', resolve);
    req.on('error', reject);
  });

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch (e) {
    console.error('❌ Invalid JSON:', e);
    return res.status(400).json({ error: 'Invalid JSON in request body' });
  }

  const rawTxHex = parsed.txHex;
  if (!rawTxHex) {
    return res.status(400).json({ error: 'Missing txHex in request body' });
  }

  try {
    const tx = await deserializeTransaction(rawTxHex);

    return res.status(200).json({
      message: `Transaction deserialized successfully`,
      transaction: tx,
    });
  } catch (err) {
    console.error('❌ Error during deserialization:', err);
    return res.status(500).json({ error: 'Deserialization failed', details: err.message });
  }
}


function inspectObjectFull(obj) {
  if (obj === null || (typeof obj !== 'object' && typeof obj !== 'function')) {
    console.log('Not a valid object');
    return;
  }

  const props = Object.getOwnPropertyNames(obj);

  if (props.length === 0) {
    console.log('No own enumerable or non-enumerable properties found.');
  }

  for (const key of props) {
    let value;
    let type;
    try {
      value = obj[key];
      type = typeof value;
    } catch (e) {
      value = '[Error accessing]';
      type = 'unknown';
    }

    console.log(`${key}: [${type}] ${type !== 'function' ? '= ' + JSON.stringify(value) : ''}`);
  }
}
