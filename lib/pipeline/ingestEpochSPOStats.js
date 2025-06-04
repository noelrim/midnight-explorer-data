import REQUEST from './request.js';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

/*process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
initializeApp({ projectId: 'midnight-explorer' });
const db = getFirestore();*/

//import serviceAccount from './service-account.json' with { type: "json" };
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);


initializeApp({
  credential: cert(serviceAccount),
  projectId: 'midnight-explorer-df5bf' 
});
const db = getFirestore();




const STARTING_EPOCH_DATE = new Date("2025-05-13T00:00:00Z");
const TESTNET_EPOCH = 931;

function getEpochDate(epoch) {
  const date = new Date(STARTING_EPOCH_DATE.getTime());
  date.setDate(date.getDate() + (parseInt(epoch) - TESTNET_EPOCH));

  return date.toISOString().slice(0, 10); // 'YYYY-MM-DD'
}

async function processEpoch(epoch) {
  try {
    const data = await REQUEST.getSPOS(epoch);
    const result = data?.result;
    if (!result) {
      console.warn(`⚠️ No result for epoch ${epoch}`);
      return;
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
    console.log(`✅ Saved ${dateStr} (Epoch ${epoch})`);

  } catch (err) {
    console.error(`❌ Error processing epoch ${epoch}:`, err.message);
  }
}

async function main() {
  const epochRes = await REQUEST.getEpoch();
  const currentEpoch = epochRes?.result?.mainchain?.epoch;
  if (!currentEpoch) {
    console.error("❌ Could not fetch current epoch.");
    return;
  }

  for (let epoch = TESTNET_EPOCH; epoch <= currentEpoch; epoch++) {
    await processEpoch(epoch);
  }

  console.log("✅ All epochs processed.");
}

main();
