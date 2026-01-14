import admin from 'firebase-admin';
import * as path from 'path';

// Initialize Firebase Admin SDK
// Try to use service account file if it exists, otherwise use application default credentials
let firebaseInitialized = false;

if (!admin.apps.length) {
  try {
    // Try to load service account from file (for development)
    const serviceAccountPath = path.join(__dirname, '..', 'serviceAccountKey.json');
    
    if (require('fs').existsSync(serviceAccountPath)) {
      const serviceAccount = require(serviceAccountPath);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: 'https://pixelapp-c8fa3-default-rtdb.europe-west1.firebasedatabase.app',
      });
      firebaseInitialized = true;
      console.log('Firebase Admin SDK initialized with service account');
    } else {
      // Try to initialize with application default credentials
      admin.initializeApp({
        projectId: 'pixelapp-c8fa3',
        databaseURL: 'https://pixelapp-c8fa3-default-rtdb.europe-west1.firebasedatabase.app',
      });
      firebaseInitialized = true;
      console.log('Firebase Admin SDK initialized (using default credentials)');
    }
  } catch (error: any) {
    console.warn('Firebase Admin SDK initialization failed:', error.message);
    console.warn('Server will continue but Firebase operations may fail.');
    console.warn('To fix: Download service account key from Firebase Console and save as server/serviceAccountKey.json');
    // Initialize with minimal config to prevent further errors
    try {
      admin.initializeApp({
        projectId: 'pixelapp-c8fa3',
        databaseURL: 'https://pixelapp-c8fa3-default-rtdb.europe-west1.firebasedatabase.app',
      }, 'fallback');
    } catch (e) {
      // Ignore if already initialized
    }
  }
}

export const firebaseAdmin = admin;
export const firebaseAuth = admin.auth();
export const firebaseDb = admin.database();

// Verify Firebase ID token
export async function verifyIdToken(token: string): Promise<admin.auth.DecodedIdToken | null> {
  try {
    const decodedToken = await firebaseAuth.verifyIdToken(token);
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
    const snapshot = await firebaseDb.ref(`users/${uid}`).once('value');
    return snapshot.val();
  } catch (error: any) {
    console.error('Error getting user data:', error.message);
    return null;
  }
}

// Update user orbs in Firebase Database
export async function updateUserOrbs(uid: string, orbs: number) {
  try {
    await firebaseDb.ref(`users/${uid}/orbs`).set(orbs);
    return true;
  } catch (error) {
    console.error('Error updating user orbs:', error);
    return false;
  }
}

// Add item to user inventory in Firebase Database
export async function addToUserInventory(uid: string, itemId: string) {
  try {
    const inventoryRef = firebaseDb.ref(`users/${uid}/inventory`);
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
    const snapshot = await firebaseDb.ref(`users/${uid}/inventory`).once('value');
    return snapshot.val() || [];
  } catch (error) {
    console.error('Error getting inventory:', error);
    return [];
  }
}

// Get user equipped items from Firebase Database
export async function getUserEquippedItems(uid: string): Promise<string[]> {
  try {
    const snapshot = await firebaseDb.ref(`users/${uid}/equippedItems`).once('value');
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
    await firebaseDb.ref(`users/${uid}/equippedItems`).set(equippedItems);
    return true;
  } catch (error) {
    console.error('Error updating equipped items:', error);
    return false;
  }
}

// Get shop items (we'll store these in Firebase too, but for now keep them server-side)
// This function can be used to seed shop items to Firebase if needed
export async function getShopItemsFromFirebase(): Promise<any[]> {
  try {
    const snapshot = await firebaseDb.ref('shop_items').once('value');
    return snapshot.val() ? Object.values(snapshot.val()) : [];
  } catch (error) {
    console.error('Error getting shop items from Firebase:', error);
    return [];
  }
}
