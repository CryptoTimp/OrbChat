import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
  apiKey: "AIzaSyDO6gq2eJFckqeezNwBhO51hWs7N7kDAW8",
  authDomain: "pixelapp-c8fa3.firebaseapp.com",
  projectId: "pixelapp-c8fa3",
  storageBucket: "pixelapp-c8fa3.firebasestorage.app",
  messagingSenderId: "154312628546",
  appId: "1:154312628546:web:e4c39c9249d6195ed150db",
  databaseURL: "https://pixelapp-c8fa3-default-rtdb.europe-west1.firebasedatabase.app"
};

// Initialize Firebase
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const database = getDatabase(app);
