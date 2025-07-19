import { createClient } from 'graphql-ws';
import WebSocket from 'ws';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import path from 'path';
import { fileURLToPath } from 'url';

/*if (!process.env.FIRESTORE_EMULATOR_HOST) {
  process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
  console.log(`🟡 Defaulting to Firestore Emulator at ${process.env.FIRESTORE_EMULATOR_HOST}`);
}
*/
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

let db;

export default async function syncSpometrics() {
  if (!db) {
    initializeApp({
      credential: cert(serviceAccount),
      projectId: 'midnight-explorer-df5bf',
    });
    db = getFirestore();
  }


function getUTCDateKey(date) {
  return date.toISOString().slice(0, 10);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const argMap = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      argMap[args[i].replace('--', '')] = parseInt(args[i + 1], 10);
    }
  }
  return {
    from: argMap.from || null,
    to: argMap.to || Infinity,
  };
}

async function getResumeHeightFromFirestore() {
  initFirestore();
  const snapshot = await db.collection('DailyBlockMetrics')
    .orderBy('date', 'desc')
    .limit(1)
    .get();

  if (snapshot.empty) {
    console.log('🟡 No existing DailyBlockMetrics. Starting from height 1.');
    return 1;
  }

  const doc = snapshot.docs[0];
  const lastHeight = doc.data().lastBlockHeight;

  if (typeof lastHeight === 'number') {
    console.log(`🔁 Resuming from last stored height: ${lastHeight} → ${lastHeight + 1}`);
    return lastHeight + 1;
  }

  console.warn(`⚠️ lastBlockHeight missing from latest document (${doc.id}). Starting from 1.`);
  return 1;
}

async function loadFederatedKeys() {
  initFirestore();
  const snapshot = await db.collection('SPOs')
    .where('Type', '==', 'Permissioned')
    .get();

  const federatedKeys = new Set();
  snapshot.forEach(doc => {
    const data = doc.data();
    if (data.AuraPubKey) {
      federatedKeys.add(data.AuraPubKey);
    }
  });

  console.log(`🔑 Loaded ${federatedKeys.size} federated SPO AuraPubKeys.`);
  return federatedKeys;
}

async function main(fromParam = null, toParam = Infinity) {
  let from = fromParam;
  const to = toParam;
  const todayKey = getUTCDateKey(new Date());

  if (!from) {
    from = await getResumeHeightFromFirestore();
  }

  const federatedKeys = await loadFederatedKeys();

  console.log(`🚀 Streaming blocks from height ${from} to ${to}...`);

  const expectedBlocksPerDay = 14400;
  const dailyCounts = new Map();
  let firstBlockTimestamp = null;
  let lastSeenDateKey = null;
  let finished = false;

  const client = createClient({
    url: 'wss://indexer-rs.testnet-02.midnight.network/api/v1/graphql/ws',
    webSocketImpl: WebSocket,
  });

  const query = `
    subscription {
      blocks(offset: { height: ${from} }) {
        hash
        timestamp
        height
        author
      }
    }
  `;

  await new Promise((resolve, reject) => {
    const unsubscribe = client.subscribe({ query }, {
      next: ({ data }) => {
        if (!data?.blocks || finished) return;

        const block = data.blocks;
        const blockTime = new Date(block.timestamp);
        const dateKey = getUTCDateKey(blockTime);
        const isFederated = federatedKeys.has(block.author);
        const blockType = isFederated ? 'Federated' : 'SPO';

        if (!firstBlockTimestamp) firstBlockTimestamp = blockTime;
        lastSeenDateKey = dateKey;

        if (dateKey === todayKey) {
          console.log(`⏹️ Encountered today's date (${todayKey}), stopping stream.`);
          finished = true;
          unsubscribe();
          resolve();
          return;
        }

        const existing = dailyCounts.get(dateKey) || {
          SPO: { count: 0 },
          Federated: { count: 0 },
          lastBlockHeight: 0
        };

        existing[blockType].count += 1;
        existing.lastBlockHeight = block.height;
        dailyCounts.set(dateKey, existing);

        if (block.height >= to) {
          console.log(`⏹️ Reached target block height (${to}).`);
          finished = true;
          unsubscribe();
          resolve();
        }
      },
      error: (err) => {
        console.error('❌ Subscription error:', err);
        reject(err);
      },
      complete: () => {
        console.log('✔️ Streaming complete.');
        resolve();
      },
    });
  });

  await flushAllToFirestore(dailyCounts, expectedBlocksPerDay, firstBlockTimestamp, lastSeenDateKey);
}

async function flushAllToFirestore(dailyCounts, expectedBlocksPerDay, firstBlockTimestamp, lastSeenDateKey) {
  initFirestore();
  const batch = db.batch();

  for (const [dateKey, counts] of dailyCounts.entries()) {
    if (dateKey === lastSeenDateKey) {
      console.log(`🕒 Skipping ongoing (incomplete) day: ${dateKey}`);
      continue;
    }

    const date = new Date(dateKey);
    let adjustedTotalExpected = expectedBlocksPerDay;

    if (dateKey === getUTCDateKey(firstBlockTimestamp)) {
      const secsRemaining =
        86400 -
        (firstBlockTimestamp.getUTCHours() * 3600 +
         firstBlockTimestamp.getUTCMinutes() * 60 +
         firstBlockTimestamp.getUTCSeconds());
      adjustedTotalExpected = Math.floor((secsRemaining / 86400) * expectedBlocksPerDay);
      console.log(`⚖️ Adjusted expected blocks for first day (${dateKey}): ${adjustedTotalExpected}`);
    }

    const expectedSPO = Math.round(adjustedTotalExpected * (100 / 1100));
    const expectedFederated = adjustedTotalExpected - expectedSPO;

    const federatedUptime = expectedFederated === 0 ? 0 : (counts.Federated.count / expectedFederated) * 100;
    const spoUptime = expectedSPO === 0 ? 0 : (counts.SPO.count / expectedSPO) * 100;

    const ref = db.collection('DailyBlockMetrics').doc(dateKey);

    batch.set(ref, {
      date,
      expectedBlocks: adjustedTotalExpected,
      blockCount: counts.Federated.count + counts.SPO.count,
      lastBlockHeight: counts.lastBlockHeight,
      validatorStats: {
        Federated: {
          blockCount: counts.Federated.count,
          expectedBlocks: expectedFederated,
          uptimePercent: parseFloat(federatedUptime.toFixed(2))
        },
        SPO: {
          blockCount: counts.SPO.count,
          expectedBlocks: expectedSPO,
          uptimePercent: parseFloat(spoUptime.toFixed(2))
        }
      },
      updatedAt: Timestamp.now()
    }, { merge: true });

    console.log(`📦 Prepared doc for ${dateKey}: SPO=${counts.SPO.count}, Federated=${counts.Federated.count}`);
  }

  try {
    await batch.commit();
    console.log(`✅ Successfully flushed ${dailyCounts.size} days to Firestore (excluding ongoing day).`);
  } catch (err) {
    console.error('🔥 Batch commit failed:', err);
  }
}

export default async function syncDailyBlocksMetrics(from = null, to = Infinity) {
  try {
    await main(from, to);
  } catch (err) {
    console.error('💥 Fatal error during block uptime ingestion:', err);
    throw err;
  }
}
/* // LOCAL EXECUTION
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  const { from, to } = parseArgs();
  console.log(`📥 Parsed args → from: ${from}, to: ${to}`);
  syncDailyBlocksMetrics(from, to);
}*/
