import { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  User,
  updateProfile
} from 'firebase/auth';
import { ref, set, get, onValue, off } from 'firebase/database';
import { auth, database } from './config';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  orbs: number;
  inventory: string[];
  equippedItems: string[];
  createdAt: number;
}

// Sign up with email and password
export async function signUp(email: string, password: string, displayName: string): Promise<User> {
  const userCredential = await createUserWithEmailAndPassword(auth, email, password);
  const user = userCredential.user;
  
  // Update display name
  await updateProfile(user, { displayName });
  
  // Create user profile in Realtime Database
  const userRef = ref(database, `users/${user.uid}`);
  const profile: UserProfile = {
    uid: user.uid,
    email: user.email || '',
    displayName,
    orbs: 100, // Starting orbs
    inventory: [],
    equippedItems: [],
    createdAt: Date.now(),
  };
  
  await set(userRef, profile);
  console.log('Created user profile in Firebase:', profile);
  
  return user;
}

// Sign in with email and password
export async function signIn(email: string, password: string): Promise<User> {
  const userCredential = await signInWithEmailAndPassword(auth, email, password);
  return userCredential.user;
}

// Sign out
export async function signOut(): Promise<void> {
  await firebaseSignOut(auth);
}

// Get current user
export function getCurrentUser(): User | null {
  return auth.currentUser;
}

// Get user profile from database
export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const userRef = ref(database, `users/${uid}`);
  const snapshot = await get(userRef);
  
  if (snapshot.exists()) {
    return snapshot.val() as UserProfile;
  }
  return null;
}

// Update user orbs
export async function updateUserOrbs(uid: string, orbs: number): Promise<void> {
  const orbsRef = ref(database, `users/${uid}/orbs`);
  await set(orbsRef, orbs);
}

// Add item to inventory
export async function addToInventory(uid: string, itemId: string): Promise<void> {
  const profile = await getUserProfile(uid);
  if (profile) {
    const inventory = [...(profile.inventory || []), itemId];
    const inventoryRef = ref(database, `users/${uid}/inventory`);
    await set(inventoryRef, inventory);
  }
}

// Check if user has item
export async function hasItem(uid: string, itemId: string): Promise<boolean> {
  const profile = await getUserProfile(uid);
  return profile?.inventory?.includes(itemId) || false;
}

// Update equipped items
export async function updateEquippedItems(uid: string, equippedItems: string[]): Promise<void> {
  const equippedRef = ref(database, `users/${uid}/equippedItems`);
  await set(equippedRef, equippedItems);
}

// Subscribe to user profile changes (real-time updates)
export function subscribeToProfile(uid: string, callback: (profile: UserProfile | null) => void): () => void {
  const userRef = ref(database, `users/${uid}`);
  
  const listener = onValue(userRef, (snapshot) => {
    if (snapshot.exists()) {
      callback(snapshot.val() as UserProfile);
    } else {
      callback(null);
    }
  });
  
  // Return unsubscribe function
  return () => off(userRef, 'value', listener);
}

// Listen to auth state changes
export function onAuthChange(callback: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, callback);
}

// Get ID token for server verification
export async function getIdToken(): Promise<string | null> {
  const user = auth.currentUser;
  if (user) {
    return await user.getIdToken();
  }
  return null;
}
