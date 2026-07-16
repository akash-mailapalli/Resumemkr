// Firebase SDK Initialization and Re-exports for ResumeMkr
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, doc, getDocFromServer } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

// Standard Firebase configs
const defaultConfigs = {
  aistudio: {
    projectId: "ipl-game-b6c6a",
    appId: "1:568874657087:web:9f064e51a13048c1441f8a",
    apiKey: "AIzaSyCJmB4gK_tb6UGDFaKmH_isVYhfzWhmyB0",
    authDomain: "ipl-game-b6c6a.firebaseapp.com",
    firestoreDatabaseId: "(default)",
    storageBucket: "ipl-game-b6c6a.firebasestorage.app",
    messagingSenderId: "568874657087",
    measurementId: "G-8SVWRCR7HK"
  },
  custom: {
    projectId: "ipl-game-b6c6a",
    appId: "1:568874657087:web:9f064e51a13048c1441f8a",
    apiKey: "AIzaSyCJmB4gK_tb6UGDFaKmH_isVYhfzWhmyB0",
    authDomain: "ipl-game-b6c6a.firebaseapp.com",
    firestoreDatabaseId: "(default)",
    storageBucket: "ipl-game-b6c6a.firebasestorage.app",
    messagingSenderId: "568874657087",
    measurementId: "G-8SVWRCR7HK"
  }
};

// Check active provider from localStorage
export let activeProvider = localStorage.getItem("firebase_provider") || "aistudio";

// Save custom config to localStorage if any exists, otherwise fall back to default
const customStored = localStorage.getItem("custom_firebase_config");
if (customStored) {
  try {
    defaultConfigs.custom = JSON.parse(customStored);
  } catch (e) {
    console.error("Invalid custom firebase config stored", e);
  }
}

const firebaseConfig = defaultConfigs[activeProvider] || defaultConfigs.aistudio;

// Initialize Firebase App
const app = initializeApp(firebaseConfig);

// Initialize Services
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// Provider Switcher
export function switchFirebaseProvider(newProvider) {
  if (newProvider === "aistudio" || newProvider === "custom") {
    localStorage.setItem("firebase_provider", newProvider);
    window.location.reload();
  }
}

// Error handling and Diagnostics
export const OperationType = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  LIST: 'list',
  GET: 'get',
  WRITE: 'write',
};

export function handleFirestoreError(error, operationType, path) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid || null,
      email: auth.currentUser?.email || null,
      emailVerified: auth.currentUser?.emailVerified || null,
      isAnonymous: auth.currentUser?.isAnonymous || null,
      tenantId: auth.currentUser?.tenantId || null,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        uid: provider.uid,
        email: provider.email,
        displayName: provider.displayName,
        photoURL: provider.photoURL,
      })) || [],
    },
    operationType,
    path
  };
  console.error("Firestore Error:", JSON.stringify(errInfo));
  throw error;
}

// Re-export standard Firebase JS SDK components from the gstatic CDN:
export { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged,
  sendPasswordResetEmail,
  updateProfile,
  updatePassword,
  deleteUser,
  GoogleAuthProvider,
  signInWithPopup,
  sendEmailVerification,
  EmailAuthProvider,
  reauthenticateWithCredential
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

export { 
  doc, 
  setDoc, 
  getDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  getDocs,
  getDocFromServer
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Connection test
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration.");
    }
  }
}
testConnection();
