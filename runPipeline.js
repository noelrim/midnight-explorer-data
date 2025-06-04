import { exec } from 'child_process';

function runScript(scriptName) {
  return new Promise((resolve, reject) => {
    const child = exec(`node ${scriptName}`, (error, stdout, stderr) => {
      if (error) {
        console.error(`❌ ${scriptName} failed with exit code ${error.code}`);
        console.error('--- STDERR ---');
        console.error(stderr);
        console.error('--- STDOUT ---');
        console.error(stdout);
        return reject(error);
      }
      console.log(`✅ ${scriptName} completed successfully.`);
      resolve(stdout);
    });

    // Show logs live during GitHub Actions run
    child.stdout?.pipe(process.stdout);
    child.stderr?.pipe(process.stderr);
  });
}

async function runPipeline() {
  try {
    console.log('🚀 Starting block ingestion...');
    await runScript('ingestRecentBlocks.js');

    console.log('📊 Syncing hourly transaction stats...');
    await runScript('syncHourlyTransactions.js');

    console.log('📈 Syncing spometrics...');
    await runScript('syncSpometrics.js');

    console.log('✅ Pipeline completed successfully.');
  } catch (err) {
    console.error('❌ Pipeline failed.');
    process.exit(err.code || 1);
  }
}

// Global unhandled promise rejection handler
process.on('unhandledRejection', (err) => {
