// File: api/runPipeline.js

import { exec } from 'child_process';

export default function handler(req, res) {
  const secret = process.env.PIPELINE_SECRET;
console.log('Provided:', req.query.secret);
console.log('Expected:', process.env.PIPELINE_SECRET);
  // Optional: protect access with a secret
  if (secret && req.query.secret !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const child = exec('node runPipeline.js', (error, stdout, stderr) => {
    if (error) {
      console.error('❌ Pipeline failed:', stderr);
      return res.status(500).json({ error: 'Pipeline failed', details: stderr });
    }
    console.log('✅ Pipeline completed:', stdout);
    return res.status(200).json({ message: 'Pipeline completed', output: stdout });
  });

  // Optionally pipe logs to response stream
  child.stdout?.pipe(process.stdout);
  child.stderr?.pipe(process.stderr);
}