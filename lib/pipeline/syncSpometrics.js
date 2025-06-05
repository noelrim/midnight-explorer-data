import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

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

  const MAX_BLOCKS = 1500;

  console.log(`🔍 Fetching last ${MAX_BLOCKS} blocks from RecentBlocks...`);

  const blockSnap = await db
    .collection('RecentBlocks')
    .orderBy('BlockHeight', 'desc')
    .limit(MAX_BLOCKS)
    .get();

  const blockData = blockSnap.docs.map(doc => doc.data()).reverse();

  const authorBlocks = {};
  for (const block of blockData) {
    const author = block.Author;
    const height = block.BlockHeight;
    if (!author) continue;
    if (!authorBlocks[author]) authorBlocks[author] = [];
    authorBlocks[author].push(height);
  }

  const authorKeys = Object.keys(authorBlocks);
  console.log(`📚 Fetching stats for ${authorKeys.length} active SPOs...`);

  // ✅ Optimized: batch read using getAll()
  const refs = authorKeys.map(author => db.collection('spometrics').doc(author));
  const docs = await db.getAll(...refs);

  const existingStats = {};
  docs.forEach(doc => {
    const id = doc.id;
    existingStats[id] = doc.exists
      ? {
          blockcount: doc.data().blockcount || 0,
          lastblockadded: doc.data().lastblockadded || 0,
        }
      : { blockcount: 0, lastblockadded: 0 };
  });

  const updates = [];
  for (const [author, heights] of Object.entries(authorBlocks)) {
    const current = existingStats[author];
    const newBlocks = heights.filter(h => h > current.lastblockadded);
    if (newBlocks.length === 0) continue;

    updates.push({
      author,
      blockcount: current.blockcount + newBlocks.length,
      lastblockadded: Math.max(...newBlocks),
    });
  }

  console.log(`📝 Preparing ${updates.length} spometrics updates...`);

  const batchSize = 250;
  for (let i = 0; i < updates.length; i += batchSize) {
    const chunk = updates.slice(i, i + batchSize);
    const batch = db.batch();
    for (const { author, blockcount, lastblockadded } of chunk) {
      const ref = db.collection('spometrics').doc(author);
      batch.set(ref, { blockcount, lastblockadded }, { merge: true });
    }
    await batch.commit();
    console.log(`✅ Committed ${chunk.length} spometrics updates.`);
  }

  console.log("🎉 spometrics sync complete.");
}
