import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';

// Initialize Firebase Admin SDK
const serviceAccountPath = path.join(__dirname, '..', 'serviceAccountKey.json');

if (!fs.existsSync(serviceAccountPath)) {
  console.error('Error: serviceAccountKey.json not found!');
  console.error('Please download it from Firebase Console and place it in the server directory.');
  process.exit(1);
}

const serviceAccount = require(serviceAccountPath);

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: 'https://pixelapp-c8fa3-default-rtdb.europe-west1.firebasedatabase.app',
  });
}

const db = admin.database();

// All godlike items
const godlikeItems = [
  // Hats
  'hat_godlike_void',
  'hat_godlike_chaos',
  'hat_godlike_abyss',
  // Shirts
  'shirt_godlike_void',
  'shirt_godlike_chaos',
  'shirt_godlike_abyss',
  // Legs
  'legs_godlike_void',
  'legs_godlike_chaos',
  'legs_godlike_abyss',
  // Capes
  'cape_godlike_void',
  'cape_godlike_chaos',
  'cape_godlike_abyss',
  // Wings
  'acc_wings_godlike_void',
  'acc_wings_godlike_chaos',
  'acc_wings_godlike_abyss',
  // Accessories
  'acc_godlike_void',
  'acc_godlike_chaos',
  'acc_godlike_abyss',
  // Boosts
  'boost_godlike_void',
  'boost_godlike_chaos',
  'boost_godlike_abyss',
  // Pets
  'pet_godlike_void',
  'pet_godlike_chaos',
  'pet_godlike_abyss',
];

async function findYONUserId(): Promise<string | null> {
  try {
    const usersSnapshot = await db.ref('users').once('value');
    const users = usersSnapshot.val();
    
    if (!users) {
      console.error('No users found in database');
      return null;
    }
    
    // Search for user with name "YON" (case insensitive)
    for (const [uid, userData] of Object.entries(users)) {
      const user = userData as any;
      if (user && user.name && user.name.toUpperCase() === 'YON') {
        console.log(`Found YON with UID: ${uid}`);
        return uid;
      }
    }
    
    console.error('Could not find user named "YON"');
    return null;
  } catch (error) {
    console.error('Error finding YON user:', error);
    return null;
  }
}

async function addItemsToInventory(uid: string, itemIds: string[]): Promise<void> {
  try {
    const inventoryRef = db.ref(`users/${uid}/inventory`);
    const snapshot = await inventoryRef.once('value');
    const currentInventory: string[] = snapshot.val() || [];
    
    console.log(`Current inventory has ${currentInventory.length} items`);
    
    // Add items that aren't already in inventory
    const itemsToAdd: string[] = [];
    for (const itemId of itemIds) {
      if (!currentInventory.includes(itemId)) {
        itemsToAdd.push(itemId);
        currentInventory.push(itemId);
      } else {
        console.log(`  Item ${itemId} already in inventory, skipping`);
      }
    }
    
    if (itemsToAdd.length > 0) {
      await inventoryRef.set(currentInventory);
      console.log(`\n✅ Successfully added ${itemsToAdd.length} godlike items to YON's inventory:`);
      itemsToAdd.forEach(itemId => console.log(`  - ${itemId}`));
    } else {
      console.log('\n✅ All godlike items are already in YON\'s inventory!');
    }
    
    console.log(`\nTotal items in inventory: ${currentInventory.length}`);
  } catch (error) {
    console.error('Error adding items to inventory:', error);
    throw error;
  }
}

async function main() {
  console.log('🔍 Looking for YON user...\n');
  
  const yonUid = await findYONUserId();
  
  if (!yonUid) {
    console.error('❌ Could not find YON user. Exiting.');
    process.exit(1);
  }
  
  console.log(`\n📦 Adding ${godlikeItems.length} godlike items to YON's inventory...\n`);
  
  await addItemsToInventory(yonUid, godlikeItems);
  
  console.log('\n✨ Done!');
  process.exit(0);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
