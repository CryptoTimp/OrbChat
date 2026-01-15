import admin from 'firebase-admin';
import * as path from 'path';

// Initialize Firebase Admin SDK
// Try to use service account file if it exists, otherwise use application default credentials
let firebaseInitialized = false;

if (!admin.apps.length) {
  try {
    // Try to load service account from file (for development)
    const serviceAccountPath = path.join(__dirname, '..', 'serviceAccountKey.json');
    let serviceAccount: any = null;
    
    if (require('fs').existsSync(serviceAccountPath)) {
      // Method 1: Load from file
      serviceAccount = require(serviceAccountPath);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: 'https://pixelapp-c8fa3-default-rtdb.europe-west1.firebasedatabase.app',
      });
      firebaseInitialized = true;
      console.log('Firebase Admin SDK initialized with service account file');
    } else if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
      // Method 2: Construct from environment variables
      serviceAccount = {
        type: 'service_account',
        project_id: process.env.FIREBASE_PROJECT_ID,
        private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
        private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'), // Handle escaped newlines
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
        client_id: process.env.FIREBASE_CLIENT_ID,
        auth_uri: 'https://accounts.google.com/o/oauth2/auth',
        token_uri: 'https://oauth2.googleapis.com/token',
        auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
        client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL,
      };
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: 'https://pixelapp-c8fa3-default-rtdb.europe-west1.firebasedatabase.app',
      });
      firebaseInitialized = true;
      console.log('Firebase Admin SDK initialized with environment variables');
    } else {
      // No credentials available
      console.warn('Firebase Admin SDK: No credentials found');
      console.warn('Server will continue but Firebase operations will be skipped.');
      console.warn('To enable Firebase, use one of these methods:');
      console.warn('  1. Download service account key from Firebase Console and save as server/serviceAccountKey.json');
      console.warn('  2. Set environment variables: FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY, FIREBASE_CLIENT_EMAIL');
      firebaseInitialized = false;
    }
  } catch (error: any) {
    console.warn('Firebase Admin SDK initialization failed:', error.message);
    console.warn('Server will continue but Firebase operations will be skipped.');
    firebaseInitialized = false;
  }
}

export const firebaseAdmin = admin;

// Lazy getters for Firebase services (only access when initialized)
export function getFirebaseAuth() {
  if (!admin.apps.length) {
    throw new Error('Firebase Admin SDK not initialized');
  }
  return admin.auth();
}

export function getFirebaseDb() {
  if (!admin.apps.length) {
    throw new Error('Firebase Admin SDK not initialized');
  }
  return admin.database();
}

// Verify Firebase ID token
export async function verifyIdToken(token: string): Promise<admin.auth.DecodedIdToken | null> {
  try {
    if (!admin.apps.length) {
      console.warn('Firebase Admin SDK not initialized, cannot verify token');
      return null;
    }
    const decodedToken = await getFirebaseAuth().verifyIdToken(token);
    return decodedToken;
  } catch (error) {
    console.error('Error verifying Firebase token:', error);
    return null;
  }
}

// Get user data from Firebase Database
export async function getUserData(uid: string) {
  try {
    if (!admin.apps.length) {
      console.warn('Firebase Admin SDK not initialized, cannot get user data');
      return null;
    }
    // Check if database is actually available (not just initialized)
    try {
      const snapshot = await getFirebaseDb().ref(`users/${uid}`).once('value');
      return snapshot.val();
    } catch (dbError: any) {
      // If database access fails due to credentials, return null gracefully
      if (dbError.code === 'app/invalid-credential' || dbError.message?.includes('credential')) {
        console.warn('Firebase credentials not available, skipping database operation');
        return null;
      }
      throw dbError;
    }
  } catch (error: any) {
    // Don't log credential errors as errors, just warnings
    if (error.code === 'app/invalid-credential' || error.message?.includes('credential')) {
      console.warn('Firebase credentials not available:', error.message);
      return null;
    }
    console.error('Error getting user data:', error.message);
    return null;
  }
}

// Update user orbs in Firebase Database
export async function updateUserOrbs(uid: string, orbs: number) {
  try {
    if (!admin.apps.length) {
      console.warn('Firebase Admin SDK not initialized, cannot update user orbs');
      return false;
    }
    await getFirebaseDb().ref(`users/${uid}/orbs`).set(orbs);
    return true;
  } catch (error) {
    console.error('Error updating user orbs:', error);
    return false;
  }
}

// Add item to user inventory in Firebase Database
export async function addToUserInventory(uid: string, itemId: string) {
  try {
    if (!admin.apps.length) {
      console.warn('Firebase Admin SDK not initialized, cannot add to inventory');
      return false;
    }
    const inventoryRef = getFirebaseDb().ref(`users/${uid}/inventory`);
    const snapshot = await inventoryRef.once('value');
    const currentInventory = snapshot.val() || [];
    
    if (!currentInventory.includes(itemId)) {
      currentInventory.push(itemId);
      await inventoryRef.set(currentInventory);
    }
    return true;
  } catch (error) {
    console.error('Error adding to inventory:', error);
    return false;
  }
}

// Get user inventory from Firebase Database
export async function getUserInventory(uid: string): Promise<string[]> {
  try {
    if (!admin.apps.length) {
      console.warn('Firebase Admin SDK not initialized, cannot get inventory');
      return [];
    }
    const snapshot = await getFirebaseDb().ref(`users/${uid}/inventory`).once('value');
    return snapshot.val() || [];
  } catch (error) {
    console.error('Error getting inventory:', error);
    return [];
  }
}

// Get user equipped items from Firebase Database
export async function getUserEquippedItems(uid: string): Promise<string[]> {
  try {
    if (!admin.apps.length) {
      console.warn('Firebase Admin SDK not initialized, cannot get equipped items');
      return [];
    }
    const snapshot = await getFirebaseDb().ref(`users/${uid}/equippedItems`).once('value');
    return snapshot.val() || [];
  } catch (error) {
    console.error('Error getting equipped items:', error);
    return [];
  }
}

// Check if user has item in inventory
export async function userHasItem(uid: string, itemId: string): Promise<boolean> {
  try {
    const inventory = await getUserInventory(uid);
    return inventory.includes(itemId);
  } catch (error) {
    console.error('Error checking if user has item:', error);
    return false;
  }
}

// Update equipped items in Firebase Database
export async function updateUserEquippedItems(uid: string, equippedItems: string[]): Promise<boolean> {
  try {
    if (!admin.apps.length) {
      console.warn('Firebase Admin SDK not initialized, cannot update equipped items');
      return false;
    }
    await getFirebaseDb().ref(`users/${uid}/equippedItems`).set(equippedItems);
    return true;
  } catch (error) {
    console.error('Error updating equipped items:', error);
    return false;
  }
}

// Update gold coins in Firebase Database
export async function updateGoldCoins(uid: string, amount: number): Promise<boolean> {
  try {
    if (!admin.apps.length) {
      console.warn('Firebase Admin SDK not initialized, cannot update gold coins');
      return false;
    }
    try {
      await getFirebaseDb().ref(`users/${uid}/gold_coins`).set(amount);
      return true;
    } catch (dbError: any) {
      // If database access fails due to credentials, return false gracefully
      if (dbError.code === 'app/invalid-credential' || dbError.message?.includes('credential')) {
        console.warn('Firebase credentials not available, skipping gold coins update');
        return false;
      }
      throw dbError;
    }
  } catch (error: any) {
    // Don't log credential errors as errors, just warnings
    if (error.code === 'app/invalid-credential' || error.message?.includes('credential')) {
      console.warn('Firebase credentials not available:', error.message);
      return false;
    }
    console.error('Error updating gold coins:', error);
    return false;
  }
}

// Get gold coins from Firebase Database
export async function getGoldCoins(uid: string): Promise<number> {
  try {
    if (!admin.apps.length) {
      console.warn('Firebase Admin SDK not initialized, cannot get gold coins');
      return 0;
    }
    try {
      const snapshot = await getFirebaseDb().ref(`users/${uid}/gold_coins`).once('value');
      return snapshot.val() || 0;
    } catch (dbError: any) {
      // If database access fails due to credentials, return 0 gracefully
      if (dbError.code === 'app/invalid-credential' || dbError.message?.includes('credential')) {
        console.warn('Firebase credentials not available, skipping gold coins read');
        return 0;
      }
      throw dbError;
    }
  } catch (error: any) {
    // Don't log credential errors as errors, just warnings
    if (error.code === 'app/invalid-credential' || error.message?.includes('credential')) {
      console.warn('Firebase credentials not available:', error.message);
      return 0;
    }
    console.error('Error getting gold coins:', error);
    return 0;
  }
}

// Get shop items (we'll store these in Firebase too, but for now keep them server-side)
// This function can be used to seed shop items to Firebase if needed
export async function getShopItemsFromFirebase(): Promise<any[]> {
  try {
    if (!admin.apps.length) {
      console.warn('Firebase Admin SDK not initialized, cannot get shop items');
      return [];
    }
    const snapshot = await getFirebaseDb().ref('shop_items').once('value');
    return snapshot.val() ? Object.values(snapshot.val()) : [];
  } catch (error) {
    console.error('Error getting shop items from Firebase:', error);
    return [];
  }
}
