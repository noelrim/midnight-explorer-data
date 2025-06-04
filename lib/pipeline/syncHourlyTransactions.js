import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

let db;

function getHourKey(date) {
  return date.toISOString().slice(0, 13); // 'YYYY-MM-DDTHH'
}

export default async function syncHourlyTransactions() {
  if (!db) {
    initializeApp({
      credential: cert(serviceAccount),
      projectId: 'midnight-explorer-df5bf',
    });
    db = getFirestore();
  }

  console.log("🔍 Fetching all transactions...");
  const snapshot = await db.collection('RecentTransactions').get();

  const hourBuckets = {};

  console.log(`⏱️ Processing ${snapshot.size} transactions...`);
  snapshot.forEach(doc => {
    const data = doc.data();
    const timestamp = data.Timestamp.toDate?.() || new Date(data.Timestamp);
    const hourKey = getHourKey(timestamp);
    const height = data.BlockHeight;

    if (!hourBuckets[hourKey]) {
      hourBuckets[hourKey] = {
        TotalBlocks: new Set(),
        TotalTransactions: 0,
        TotalDeploy: 0,
        TotalUpdate: 0,
        TotalCalls: 0,
        StartHeight: height,
        EndHeight: height,
      };
    }

    const bucket = hourBuckets[hourKey];
    bucket.TotalTransactions += 1;
    bucket.TotalDeploy += data.NumDeploy || 0;
    bucket.TotalUpdate += data.NumUpdate || 0;
    bucket.TotalCalls += data.NumCall || 0;
    bucket.TotalBlocks.add(height);
    bucket.StartHeight = Math.min(bucket.StartHeight, height);
    bucket.EndHeight = Math.max(bucket.EndHeight, height);
  });

  console.log("📦 Comparing with existing HourlyTransactions...");
  const existing = await db.collection('HourlyTransactions').get();
  const existingKeys = {};
  existing.forEach(doc => {
    const data = doc.data();
    existingKeys[doc.id] = data.EndHeight;
  });

  const updates = Object.entries(hourBuckets).filter(([hourKey, bucket]) => {
    const existingEnd = existingKeys[hourKey];
    return existingEnd === undefined || bucket.EndHeight > existingEnd;
  });

  console.log(`📝 Preparing to update ${updates.length} hourly documents...`);

  const batchSize = 250;
  for (let i = 0; i < updates.length; i += batchSize) {
    const chunk = updates.slice(i, i + batchSize);
    const batch = db.batch();
    for (const [hourKey, bucket] of chunk) {
      batch.set(db.collection('HourlyTransactions').doc(hourKey), {
        TotalBlocks: bucket.TotalBlocks.size,
        TotalTransactions: bucket.TotalTransactions,
        TotalDeploy: bucket.TotalDeploy,
        TotalUpdate: bucket.TotalUpdate,
        TotalCalls: bucket.TotalCalls,
        StartHeight: bucket.StartHeight,
        EndHeight: bucket.EndHeight,
      });
    }
    await batch.commit();
    console.log(`✅ Committed ${chunk.length} hourly updates.`);
  }

  console.log("🎉 Sync complete.");
}
