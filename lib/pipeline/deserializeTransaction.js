// Import the necessary classes from the @midnight/ledger package
import { Transaction, NetworkId } from '@midnight-ntwrk/ledger';

// Function to deserialize a transaction from a raw string
function deserializeTransaction(rawString, networkId = NetworkId.Undeployed) {
  try {
    // Convert the string to Uint8Array (assuming it's a hex string)
    const rawBytes = hexStringToUint8Array(rawString);
    
    // Use the static deserialize method from the Transaction class
    const transaction = Transaction.deserialize(rawBytes, NetworkId.TestNet).toString();
    
    return transaction;
  } catch (error) {
    console.error("Error deserializing transaction:", error);
    return null;
  }
}

// Helper function to convert hex string to Uint8Array
function hexStringToUint8Array(hexString) {
  // Remove '0x' prefix if present
  hexString = hexString.startsWith('0x') ? hexString.slice(2) : hexString;
  
  // Ensure even length
  if (hexString.length % 2 !== 0) {
    hexString = '0' + hexString;
  }
  
  const bytes = new Uint8Array(hexString.length / 2);
  for (let i = 0; i < hexString.length; i += 2) {
    bytes[i / 2] = parseInt(hexString.substr(i, 2), 16);
  }
  
  return bytes;
}
export default deserializeTransaction;
