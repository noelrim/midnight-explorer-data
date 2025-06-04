import { exec } from 'child_process';

function runScript(scriptName) {
  return new Promise((resolve, reject) => {
    const child = exec(`node ${scriptName}`, (error, stdout, stderr) => {
      if (error) {
        console.error(`❌ ${scriptName} failed with exit code ${error.code}`);
        console.error('--- STDERR ---\n', stderr);
        console.error('--- STDOUT ---\n', stdout);
        return reject(error);
      }
      console.log(`✅ ${scriptName} completed successfully.`);
      resolve(stdout);
    });

    child.stdout?.pipe(process.stdout);
    child.stderr?.pipe(process.stderr);
  });
}

export async function handler() {
  console.log('🚀 Starting block ingestion...');
  await runScript('ingestRecentBlocks.js');

  console.log('📊 Syncing hourly transaction stats...');
  await runScript('syncHourlyTransactions.js');

  console.log('📈 Syncing spometrics...');
  await runScript('syncSpometrics.js');

  console.log('✅ Pipeline completed successfully.');
}

// Handle unhandled rejections globally
process.on('unhandledRejection', (err) => {
  console.error('🔥 Unhandled rejection:', err);
  process.exit(1);
});

// If run directly from CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  handler().catch((err) => {
    console.error('❌ Pipeline failed.', err);
    process.exit(err.code || 1);
  });
}
