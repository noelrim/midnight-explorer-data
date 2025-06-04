import { createClient } from 'graphql-ws';
import WebSocket from 'ws';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createHash } from 'crypto';
import serviceAccount from './service-account.json' with { type: "json" };

initializeApp({
  credential: cert(serviceAccount),
  projectId: 'midnight-explorer-df5bf',
});
const db = getFirestore();

const args = process.argv.slice(2);
let paramStartHeight = null;
let paramEndHeight = null;

if (args.length > 0) {
  paramStartHeight = parseInt(args[0]);
  if (args.length > 1) {
    paramEndHeight = parseInt(args[1]);
  }
}

function getHourKey(date) {
  return date.toISOString().slice(0, 13);
}

async function retryAsync(fn, retries = 3, delayMs = 200) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === retries) throw err;
      console.warn(`Retry attempt ${attempt} failed, retrying in ${delayMs}ms...`);
      await new Promise(r => setTimeout(r, delayMs));
      delayMs *= 2;
    }
  }
}

async function getHighestBlockHeight() {
  const snapshot = await db.collection('RecentBlocks')
    .orderBy('BlockHeight', 'desc')
    .limit(1)
    .get();

  let startHeight = 1;
  if (!snapshot.empty) {
    startHeight = snapshot.docs[0].data().BlockHeight+1;
  }

  console.log('Starting ingestion from block height:', startHeight);
  return startHeight;
}

// --- INGESTION SETUP ---
const startExecutionTime = Date.now();
const startHeight = paramStartHeight ?? await getHighestBlockHeight();
const endHeight = paramEndHeight ?? Infinity;
const BUFFER_LIMIT = 600;
const offsetClause = `(offset: { height: ${startHeight} })`;
const query = `
  subscription {
    blocks${offsetClause} {
      author
      height
      timestamp
      hash
      transactions {
        raw
        hash
        contractActions {
          __typename
        }
      }
    }
  }
`;

const client = createClient({
  url: 'wss://indexer-rs.testnet-02.midnight.network/api/v1/graphql/ws',
  webSocketImpl: WebSocket,
});

let finished = false;
const txBuffer = [];
const authorCounts = {};
const hourlyStats = {};
let expectedHeight = startHeight;
const blockBuffer = new Map();
let inserting = false;

async function processBlock(block) {
  const blockTime = new Date(block.timestamp);
  const txs = block.transactions || [];

  if (blockTime.getTime() >= startExecutionTime || block.height > endHeight) {
    finished = true;
    setTimeout(() => client.dispose?.(), 0);
    return false;
  }

  await retryAsync(() => db.collection('RecentBlocks').doc(block.hash).set({
    BlockHeight: block.height,
    Author: block.author,
    Timestamp: blockTime,
    Hash: block.hash,
    NumTransactions: txs.length,
    Transactions: txs.map(tx => tx.hash),
  }));

  authorCounts[block.author] = (authorCounts[block.author] || 0) + 1;

  for (const tx of txs) {
    let deploy = 0, update = 0, call = 0;

    for (const action of tx.contractActions || []) {
      switch (action.__typename) {
        case 'ContractDeploy': deploy += 1; break;
        case 'ContractUpdate': update += 1; break;
        case 'ContractCall': call += 1; break;
      }
    }

    txBuffer.push({
      id: tx.hash,
      data: {
        BlockHeight: block.height,
        OutputAddress: null,
        TotalOutput: null,
        Timestamp: blockTime,
        NumDeploy: deploy,
        NumUpdate: update,
        NumCall: call
      }
    });
  }

  console.log(`✅ Block ${block.height} stored (${txs.length} txs)`);

  return true;
}

async function insertBufferedBlocks() {
  if (inserting) return;
  inserting = true;

  const heights = Array.from(blockBuffer.keys()).sort((a, b) => a - b);
  const toInsert = heights.slice(0, BUFFER_LIMIT);

  for (const height of toInsert) {
    const block = blockBuffer.get(height);
    blockBuffer.delete(height);

    try {
      const cont = await processBlock(block);
      if (!cont) {
        inserting = false;
        finished = true;
        return;
      }
      expectedHeight++;
    } catch (err) {
      console.error(`❌ Failed to process block ${block.height}:`, err);
      inserting = false;
      finished = true;
      throw err;
    }
  }

  inserting = false;
}

console.log(`🚀 Starting block ingestion from height ${startHeight}` + (paramEndHeight ? ` to ${paramEndHeight}` : ''));

try {
  await new Promise((resolve, reject) => {
    client.subscribe({ query }, {
      next: async ({ data }) => {
        if (!data?.blocks || finished) return;
        const block = data.blocks;
        blockBuffer.set(block.height, block);

        if (blockBuffer.size >= BUFFER_LIMIT && !inserting) {
          await insertBufferedBlocks();
        }

        while (blockBuffer.has(expectedHeight) && !inserting) {
          const block = blockBuffer.get(expectedHeight);
          blockBuffer.delete(expectedHeight);
          try {
            const cont = await processBlock(block);
            if (!cont) {
              finished = true;
              resolve();
              return;
            }
            expectedHeight++;
          } catch (err) {
            console.error(`❌ Failed to process block ${block.height}:`, err);
            finished = true;
            reject(err);
            return;
          }
        }
      },
      error: (err) => {
        if (!finished) {
          console.error('❌ Subscription error:', err);
          finished = true;
          reject(err);
        }
      },
      complete: () => {
        if (!finished) {
          console.log('✔️ Subscription complete.');
        }
        finished = true;
        resolve();
      }
    });
  });
} finally {
  if (txBuffer.length > 0) {
    console.log(`💾 Writing final buffered transactions (${txBuffer.length})...`);
    const batchSize = 250;
    for (let i = 0; i < txBuffer.length; i += batchSize) {
      const chunk = txBuffer.slice(i, i + batchSize);
      const batch = db.batch();
      chunk.forEach(tx => batch.set(db.collection('RecentTransactions').doc(tx.id), tx.data));
      await retryAsync(() => batch.commit());
    }
    console.log(`📝 ${txBuffer.length} transactions written.`);
  }
}
