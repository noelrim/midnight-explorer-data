import { createClient } from 'graphql-ws';
import WebSocket from 'ws';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createHash } from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';

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
    startHeight = snapshot.docs[0].data().BlockHeight + 1;
  }

  console.log('Starting ingestion from block height:', startHeight);
  return startHeight;
}

export default async function ingestRecentBlocks(startParam = null, endParam = null) {
  initFirestore();

  const startExecutionTime = Date.now();
  const startHeight = startParam ?? await getHighestBlockHeight();
  const endHeight = endParam ?? Infinity;
  const BUFFER_LIMIT = 500;
  const query = `
    subscription {
      blocks(offset: { height: ${startHeight} }) {
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
  const blockBuffer = new Map();
  const authorUpdates = new Map();
  let expectedHeight = startHeight;
  let inserting = false;

  async function insertBufferedBlocks() {
    if (inserting) return;
    inserting = true;

    const heights = Array.from(blockBuffer.keys()).sort((a, b) => a - b);
    const toInsert = heights.slice(0, BUFFER_LIMIT);
    const blockBatch = db.batch();

    for (const height of toInsert) {
      const block = blockBuffer.get(height);
      blockBuffer.delete(height);

      const blockTime = new Date(block.timestamp);
      const txs = block.transactions || [];

      if (blockTime.getTime() >= startExecutionTime || block.height > endHeight) {
        finished = true;
        setTimeout(() => client.dispose?.(), 0);
        inserting = false;
        return;
      }

      blockBatch.set(db.collection('RecentBlocks').doc(block.hash), {
        BlockHeight: block.height,
        Author: block.author,
        Timestamp: blockTime,
        Hash: block.hash,
        NumTransactions: txs.length,
        Transactions: txs.map(tx => tx.hash),
      });

      const author = block.author;
      if (author) {
        const stats = authorUpdates.get(author) || { blockcount: 0, lastblockadded: 0 };
        stats.blockcount += 1;
        stats.lastblockadded = Math.max(stats.lastblockadded, block.height);
        authorUpdates.set(author, stats);
      }

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

      console.log(`🧱 Buffered block ${block.height}`);
      expectedHeight++;
    }

    for (const [author, stats] of authorUpdates.entries()) {
      const ref = db.collection('spometrics').doc(author);
      blockBatch.set(ref, {
        blockcount: Firestore.FieldValue.increment(stats.blockcount),
        lastblockadded: stats.lastblockadded
      }, { merge: true });
    }
    authorUpdates.clear();

    try {
      await retryAsync(() => blockBatch.commit());
      console.log(`✅ Committed ${toInsert.length} blocks and SPO updates.`);
    } catch (err) {
      console.error('❌ Error committing batch:', err);
      finished = true;
      inserting = false;
      throw err;
    }

    inserting = false;
  }

  console.log(`🚀 Starting block ingestion from height ${startHeight}` + (endParam ? ` to ${endParam}` : ''));

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
            await insertBufferedBlocks();
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
}
