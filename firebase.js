// Firebase Configuration and Initialization for ResumeMkr
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, doc, getDocFromServer } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

const aiStudioConfig = {
  projectId: "sylvan-basis-h7krv",
  appId: "1:467631494457:web:66e7fcef040e17b3f684e8",
  apiKey: "AIzaSyC2F7K_gDeaneG9EP0WIqtCYMgWyHnw73s",
  authDomain: "sylvan-basis-h7krv.firebaseapp.com",
  firestoreDatabaseId: "ai-studio-7494cfa1-b51a-4bec-bed9-ed239820b222",
  storageBucket: "sylvan-basis-h7krv.firebasestorage.app",
  messagingSenderId: "467631494457"
};

const customConfig = {
  apiKey: "AIzaSyCJmB4gK_tb6UGDFaKmH_isVYhfzWhmyB0",
  authDomain: "ipl-game-b6c6a.firebaseapp.com",
  databaseURL: "https://ipl-game-b6c6a-default-rtdb.firebaseio.com",
  projectId: "ipl-game-b6c6a",
  storageBucket: "ipl-game-b6c6a.firebasestorage.app",
  messagingSenderId: "568874657087",
  appId: "1:568874657087:web:9f064e51a13048c1441f8a",
  measurementId: "G-8SVWRCR7HK"
};

// Default to custom config as user requested it, but allow switching to aistudio
const activeProvider = localStorage.getItem('firebase_provider') || 'custom';
const firebaseConfig = activeProvider === 'aistudio' ? aiStudioConfig : customConfig;

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = firebaseConfig.firestoreDatabaseId 
  ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
  : getFirestore(app);
export const storage = getStorage(app);

export { activeProvider };

export function switchFirebaseProvider(newProvider) {
  localStorage.setItem('firebase_provider', newProvider);
  window.location.reload();
}

// Error Handling utility matching FirestoreErrorInfo guidelines
export const OperationType = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  LIST: 'list',
  GET: 'get',
  WRITE: 'write',
};

export function showFirebaseDiagnosticUI() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('firebase-diagnostic-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'firebase-diagnostic-overlay';
  overlay.className = 'fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-[9999] animate-fade-in font-sans';
  overlay.innerHTML = `
    <div class="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 flex flex-col gap-4 animate-scale-up text-left">
      <div class="flex items-start gap-3">
        <div class="p-2.5 bg-rose-50 border border-rose-100 rounded-xl text-rose-600 shrink-0">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
          </svg>
        </div>
        <div>
          <h3 class="font-extrabold text-slate-800 text-lg leading-tight">Firestore Database Setup Required</h3>
          <p class="text-xs text-slate-500 mt-1 leading-relaxed">Your custom Firebase project <code class="font-bold font-mono text-indigo-600 bg-indigo-50/50 px-1 rounded">ipl-game-b6c6a</code> is linked, but Cloud Firestore needs to be enabled and initialized.</p>
        </div>
      </div>

      <div class="bg-slate-50 border border-slate-100 rounded-2xl p-4 space-y-3 text-xs leading-relaxed">
        <p class="font-bold text-slate-700">How to enable it in 30 seconds:</p>
        <ol class="list-decimal list-inside space-y-2 text-slate-600 font-medium">
          <li>Enable the API by clicking this <a href="https://console.developers.google.com/apis/api/firestore.googleapis.com/overview?project=ipl-game-b6c6a" target="_blank" class="font-bold text-indigo-600 underline hover:text-indigo-800 inline-flex items-center gap-0.5">Google Cloud API Link <svg class="w-3 h-3 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg></a></li>
          <li>Click the blue <strong>Enable</strong> button on that page.</li>
          <li>Next, go to your <a href="https://console.firebase.google.com/project/ipl-game-b6c6a/firestore" target="_blank" class="font-bold text-indigo-600 underline hover:text-indigo-800 inline-flex items-center gap-0.5">Firebase Firestore Console <svg class="w-3 h-3 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg></a></li>
          <li>Click the white <strong>Create database</strong> button.</li>
          <li>Choose a location, select <strong>Start in test mode</strong> (or production), and click <strong>Create</strong>.</li>
        </ol>
      </div>

      <div class="flex items-center justify-end gap-2.5 pt-2">
        <button id="dismiss-diagnostic" type="button" class="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-xl text-xs transition-all shrink-0 cursor-pointer">
          Dismiss
        </button>
        <a href="https://console.firebase.google.com/project/ipl-game-b6c6a/firestore" target="_blank" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs transition-all flex items-center gap-1 shrink-0 shadow-md shadow-indigo-100">
          Go to Firebase Console <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg>
        </a>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  document.getElementById('dismiss-diagnostic')?.addEventListener('click', () => {
    overlay.remove();
  });
}

export function triggerDiagnosticPopup(error) {
  const errMsg = error instanceof Error ? error.message : String(error);
  if (
    errMsg.includes("firestore.googleapis.com") || 
    errMsg.includes("permission-denied") || 
    errMsg.includes("Permission denied") ||
    errMsg.includes("disabled") ||
    errMsg.includes("not been used") ||
    errMsg.includes("offline")
  ) {
    showFirebaseDiagnosticUI();
  }
}

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
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  triggerDiagnosticPopup(error);
  throw new Error(JSON.stringify(errInfo));
}

// Test Connection as mandated in the guidelines
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && (error.message.includes('offline') || error.message.includes('permission-denied') || error.message.includes('firestore.googleapis.com'))) {
      console.warn("Firebase client appears to be offline or loading initial state.", error);
      triggerDiagnosticPopup(error);
    }
  }
}
testConnection();
