import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import serviceAccount from './service-account.json' with { type: "json" };

initializeApp({
  credential: cert(serviceAccount),
  projectId: 'midnight-explorer-df5bf',
});
const db = getFirestore();

async function syncSpometrics() {
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

  const spometricsSnap = await db.collection('spometrics').get();
  const existingStats = {};
  spometricsSnap.forEach(doc => {
    const data = doc.data();
    existingStats[doc.id] = {
      blockcount: data.blockcount || 0,
      lastblockadded: data.lastblockadded || 0,
    };
  });

  const updates = [];
  for (const [author, heights] of Object.entries(authorBlocks)) {
    const current = existingStats[author] || { blockcount: 0, lastblockadded: 0 };
    const newBlocks = heights.filter(h => h > current.lastblockadded);
    if (newBlocks.length === 0) continue;

    updates.push({
      author,
      blockcount: current.blockcount + newBlocks.length,
      lastblockadded: Math.max(...newBlocks),
    });
  }

  console.log(`📝 Updating ${updates.length} author entries in spometrics...`);

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

syncSpometrics().catch(err => {
  console.error("❌ Error syncing spometrics:", err);
});
