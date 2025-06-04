import { exec } from 'child_process';

function runScript(scriptName) {
  return new Promise((resolve, reject) => {
    const child = exec(`node ${scriptName}`, (error, stdout, stderr) => {
      if (error) return reject(new Error(`❌ ${scriptName} failed:\n${stderr}`));
      resolve(stdout);
    });
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
    console.error(err.message);
    process.exit(1);
  }
}

runPipeline();
