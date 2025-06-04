import REQUEST from './request.js'; // or native fetch in Node 18+
import * as cryptoUtils from './public/cryptoutils.js';
import { initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

export default async function ingestBlocks() {
  //import serviceAccount from './service-account.json' with { type: "json" };
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);


  initializeApp({
    credential: cert(serviceAccount),
    projectId: 'midnight-explorer-df5bf' 
  });
  const db = getFirestore();


  const STARTING_EPOCH_DATE = new Date("2025-05-13T00:00:00Z");

  // Utility to remove trailing slash
  function removeTrailingSlash(str) {
    if (!str) return '';
    return str.endsWith('/') ? str.slice(0, -1) : str;
  }

  async function main() {
    try {
      const epochResponse = await REQUEST.getEpoch();
      if (!epochResponse?.result?.mainchain?.epoch) {
        console.error('Could not fetch current epoch');
        return;
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
      // Process permissioned candidates (Type: Permissioned)
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
      console.log(`✅ Committed ${spoCount} SPOs to Firestore.`);
      console.log(`✅ Valid SPO count: ${validCount}`);

    } catch (e) {
      console.error('Error in main:', e);
    }
  }
}