// File: lib/pipeline/syncEpochSPOStats.js
import REQUEST from './public/request.js';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

let db;
if (!db) {
  initializeApp({
    credential: cert(serviceAccount),
    projectId: 'midnight-explorer-df5bf',
  });
  db = getFirestore();
}

const STARTING_EPOCH_DATE = new Date("2025-05-13T00:00:00Z");
const TESTNET_EPOCH = 931;

function getEpochDate(epoch) {
  const date = new Date(STARTING_EPOCH_DATE.getTime());
  date.setDate(date.getDate() + (parseInt(epoch) - TESTNET_EPOCH));
  return date.toISOString().slice(0, 10); // 'YYYY-MM-DD'
}

async function processEpoch(epoch) {
  const data = await REQUEST.getSPOS(epoch);
  const result = data?.result;
  if (!result) {
    console.warn(`⚠️ No result for epoch ${epoch}`);
    return null;
  }

  const dateStr = getEpochDate(epoch);

  // ----- Permissioned -----
  const permissioned = result.permissionedCandidates || [];
  const permissionedValid = permissioned.filter(p => p.isValid).length;
  const permissionedInvalid = permissioned.length - permissionedValid;

  // ----- Registered -----
  const registrations = result.candidateRegistrations || {};
  const totalRegistered = Object.keys(registrations).length;

  let validRegistered = 0;
  for (const entry of Object.values(registrations)) {
    if (Array.isArray(entry)) {
      validRegistered += entry.filter(r => r.isValid).length;
    }
  }
  const invalidRegistered = totalRegistered - validRegistered;

  // ----- Combined document -----
  const docData = {
    Epoch: epoch,
    Date: dateStr,
    Permissioned: {
      RegistrationCount: permissioned.length,
      ValidRegistrations: permissionedValid,
      InvalidRegistrations: permissionedInvalid
    },
    Registered: {
      RegistrationCount: totalRegistered,
      ValidRegistrations: validRegistered,
      InvalidRegistrations: invalidRegistered
    }
  };

  await db.collection("EpochSPOStats").doc(dateStr).set(docData);
  return { dateStr, epoch };
}

export default async function syncEpochSPOStats() {
  const epochRes = await REQUEST.getEpoch();
  const currentEpoch = epochRes?.result?.mainchain?.epoch;
  if (!currentEpoch) {
    throw new Error("Could not fetch current epoch.");
  }

  const results = [];
  for (let epoch = TESTNET_EPOCH; epoch <= currentEpoch; epoch++) {
    const result = await processEpoch(epoch);
    if (result) results.push(result);
  }

  return {
    processedCount: results.length,
    lastEpoch: results.at(-1)?.epoch ?? null,
    lastDate: results.at(-1)?.dateStr ?? null,
  };
}
