import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

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

  const nowHourKey = getHourKey(new Date());

  // 🟡 Step 1: Get latest EndHeight from HourlyTransactions
  const latestHourly = await db.collection('HourlyTransactions')
    .orderBy('EndHeight', 'desc')
    .limit(1)
    .get();

  let lastEndHeight = 0;
  if (!latestHourly.empty) {
    lastEndHeight = latestHourly.docs[0].data().EndHeight || 0;
  }

  console.log(`🔍 Fetching transactions with BlockHeight > ${lastEndHeight}...`);

  // 🟡 Step 2: Get only new transactions
  const snapshot = await db.collection('RecentTransactions')
    .where('BlockHeight', '>', lastEndHeight)
    .get();

  if (snapshot.empty) {
    console.log("📭 No new transactions to process.");
    return;
  }

  console.log(`⏱️ Processing ${snapshot.size} new transactions...`);
  const hourBuckets = {};

  snapshot.forEach(doc => {
    const data = doc.data();
    const timestamp = data.Timestamp.toDate?.() || new Date(data.Timestamp);
    const hourKey = getHourKey(timestamp);

    // 🚫 Skip current in-progress hour
    if (hourKey === nowHourKey) return;

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

  const entries = Object.entries(hourBuckets);
  if (entries.length === 0) {
    console.log("📭 No finalized hourly buckets to write.");
    return;
  }

  console.log(`📝 Preparing to write ${entries.length} new hourly documents...`);
  const batchSize = 250;
  for (let i = 0; i < entries.length; i += batchSize) {
    const chunk = entries.slice(i, i + batchSize);
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
