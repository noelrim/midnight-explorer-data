// File: lib/pipeline/syncSPOs.js
import REQUEST from '../request.js';
import * as cryptoUtils from '../public/cryptoutils.js';
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

function removeTrailingSlash(str) {
  if (!str) return '';
  return str.endsWith('/') ? str.slice(0, -1) : str;
}

export default async function syncSPOs() {
  const epochResponse = await REQUEST.getEpoch();
  if (!epochResponse?.result?.mainchain?.epoch) {
    throw new Error('Could not fetch current epoch');
  }

  const currentEpoch = epochResponse.result.mainchain.epoch;
  console.log(`Current Epoch: ${currentEpoch}`);

  const sposResponse = await REQUEST.getSPOS(currentEpoch);
  const rawSpos = sposResponse?.result?.candidateRegistrations;
  const permissionedCandidates = sposResponse.result.permissionedCandidates;

  if (!rawSpos) {
    console.log('No SPO registrations found.');
    return;
  }

  const batch = db.batch();
  let spoCount = 0;
  let validCount = 0;

  for (const key in rawSpos) {
    const current = rawSpos[key][0];
    const date = new Date(STARTING_EPOCH_DATE);
    date.setHours(date.getHours() + (parseInt(current.utxo.epochNumber) - currentEpoch) * 24);

    const poolID = cryptoUtils.hashToBlech2b224(current.mainchainPubKey.substring(2));
    const spoMD = await REQUEST.getPoolMetaData(poolID);
    const isValid = Boolean(current.stakeDelegation);
    if (isValid) validCount++;

    const spoDoc = {
      CardanoEpoch: Number(current.utxo.epochNumber),
      Block: Number(current.utxo.blockNumber),
      Slot: Number(current.utxo.slotNumber),
      Stake: Number(current.stakeDelegation || 0) / 1_000_000,
      IsValid: isValid,
      AuraPubKey: current.auraPubKey.substring(2) || "",
      SidechainPubKey: current.sidechainPubKey,
      CardanoPoolID: poolID,
      Ticker: spoMD.ticker || "",
      Name: spoMD.name || "",
      Description: spoMD.description || "",
      HomePage: removeTrailingSlash(spoMD.homepage || ""),
      Type: "Registered"
    };

    const docRef = db.collection('SPOs').doc(current.auraPubKey.substring(2));
    batch.set(docRef, spoDoc);
    spoCount++;
  }

  for (const pc of permissionedCandidates) {
    const auraPubKey = pc.auraPublicKey;
    if (!auraPubKey) continue;

    const spoDoc = {
      SidechainPubKey: pc.sidechainPublicKey,
      AuraPubKey: auraPubKey.substring(2),
      Ticker: "Shielded",
      Name: "Shielded",
      Type: "Permissioned"
    };

    const docRef = db.collection('SPOs').doc(auraPubKey.substring(2));
    batch.set(docRef, spoDoc);
    spoCount++;
  }

  await batch.commit();
  return { spoCount, validCount };
}
