// lib/pipeline/index.js
import ingestBlocks from './ingestRecentBlocks.js';
import syncHourly from './syncHourlyTransactions.js';
import syncSpometrics from './syncSpometrics.js';

export async function handler() {
  console.log('🚀 Starting block ingestion...');
  await ingestBlocks();

  console.log('📊 Syncing hourly transaction stats...');
  await syncHourly();

  console.log('📈 Syncing spometrics...');
  await syncSpometrics();

  console.log('✅ Pipeline completed successfully.');
}
