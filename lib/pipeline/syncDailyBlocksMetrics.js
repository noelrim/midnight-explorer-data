import { createClient } from 'graphql-ws';
import WebSocket from 'ws';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

/*if (!process.env.FIRESTORE_EMULATOR_HOST) {
  process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
  console.log(`🟡 Defaulting to Firestore Emulator at ${process.env.FIRESTORE_EMULATOR_HOST}`);
}*/

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

let db;
function initFirestore() {
  if (!db) {
    initializeApp({
      credential: cert(serviceAccount),
      projectId: 'midnight-explorer-df5bf',
    });
    db = getFirestore();
  }
}

// --- Helpers ---
function getUTCDateKey(date) {
  return date.toISOString().slice(0, 10); // e.g. "2025-07-10"
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

// --- Main Logic ---
async function main(fromParam = null, toParam = Infinity) {
  let from = fromParam;
  const to = toParam;
  const todayKey = getUTCDateKey(new Date());

  if (!from) {
    from = await getResumeHeightFromFirestore();
  }

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

        if (!firstBlockTimestamp) firstBlockTimestamp = blockTime;
        lastSeenDateKey = dateKey;

        if (dateKey === todayKey) {
          console.log(`⏹️ Encountered today's date (${todayKey}), stopping stream.`);
          finished = true;
          unsubscribe();
          resolve();
          return;
        }

        const existing = dailyCounts.get(dateKey) || { count: 0, lastHeight: 0 };
        dailyCounts.set(dateKey, {
          count: existing.count + 1,
          lastHeight: block.height,
        });

        if (block.height > to) {
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

// --- Firestore Flush Logic ---
async function flushAllToFirestore(dailyCounts, expectedBlocksPerDay, firstBlockTimestamp, lastSeenDateKey) {
  initFirestore();
  const batch = db.batch();

  for (const [dateKey, { count, lastHeight }] of dailyCounts.entries()) {
    if (dateKey === lastSeenDateKey) {
      console.log(`🕒 Skipping ongoing (incomplete) day: ${dateKey}`);
      continue;
    }

    const date = new Date(dateKey);
    let expectedBlocks = expectedBlocksPerDay;

    if (dateKey === getUTCDateKey(firstBlockTimestamp)) {
      const secsRemaining =
        86400 -
        (firstBlockTimestamp.getUTCHours() * 3600 +
         firstBlockTimestamp.getUTCMinutes() * 60 +
         firstBlockTimestamp.getUTCSeconds());
      expectedBlocks = Math.floor((secsRemaining / 86400) * expectedBlocksPerDay);
      console.log(`⚖️ Adjusted expected blocks for first day (${dateKey}): ${expectedBlocks}`);
    }

    const ref = db.collection('DailyBlockMetrics').doc(dateKey);
    batch.set(ref, {
      date,
      blockCount: count,
      expectedBlocks,
      uptimePercent: parseFloat(((count / expectedBlocks) * 100).toFixed(2)),
      lastBlockHeight: lastHeight,
      updatedAt: Timestamp.now(),
    }, { merge: true });

    console.log(`📦 Prepared doc for ${dateKey}: ${count} blocks, lastHeight=${lastHeight}`);
  }

  try {
    await batch.commit();
    console.log(`✅ Successfully flushed ${dailyCounts.size} days to Firestore (excluding ongoing day).`);
  } catch (err) {
    console.error('🔥 Batch commit failed:', err);
  }
}

// --- Exported for reuse ---
export default async function syncDailyBlocksMetrics(from = null, to = Infinity) {
  try {
    await main(from, to);
  } catch (err) {
    console.error('💥 Fatal error during block uptime ingestion:', err);
    throw err;
  }
}

// --- Optional CLI usage ---
if (import.meta.url === `file://${process.argv[1]}`) {
  const { from, to } = parseArgs();
  syncDailyBlocksMetrics(from, to);
}