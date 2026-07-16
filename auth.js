// Authentication, Session Tracking & Authorization for ResumeMkr
import { 
  auth, 
  db,
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
  reauthenticateWithCredential,
  doc, 
  setDoc, 
  getDoc
} from "./firebase.js";

// Google provider
const googleProvider = new GoogleAuthProvider();

// Check if user is logged in, redirect if on protected page
export function initAuthProtection(requiresAuth = true, redirectUrl = "login.html") {
  return new Promise((resolve) => {
    onAuthStateChanged(auth, async (user) => {
      const currentPath = window.location.pathname;
      const currentPage = currentPath.substring(currentPath.lastIndexOf('/') + 1);

      if (user) {
        // Enforce email verification if desired, but let's keep it optional for smooth flow
        // while tracking emailVerified status.
        
        // Setup/Sync user document
        const userRef = doc(db, "users", user.uid);
        try {
          const userSnap = await getDoc(userRef);
          if (!userSnap.exists()) {
            await setDoc(userRef, {
              userId: user.uid,
              displayName: user.displayName || "New User",
              email: user.email,
              photoURL: user.photoURL || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150&q=80",
              joinedDate: new Date().toISOString(),
              resumeCount: 0
            });
          }
        } catch (e) {
          console.error("Error checking/creating user doc", e);
        }

        if (!requiresAuth && (currentPage === "login.html" || currentPage === "signup.html")) {
          window.location.href = "dashboard.html";
        }
        resolve(user);
      } else {
        if (requiresAuth && currentPage !== "index.html" && currentPage !== "" && currentPage !== "login.html" && currentPage !== "signup.html" && currentPage !== "forgot.html" && currentPage !== "templates.html") {
          window.location.href = redirectUrl;
        }
        resolve(null);
      }
    });
  });
}

// Login
export async function loginWithEmail(email, password, rememberMe = false) {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    return userCredential.user;
  } catch (error) {
    throw error;
  }
}

// Google Login
export async function loginWithGoogle() {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (error) {
    console.error("Google Login Error:", error);
    if (error && (error.code === "auth/unauthorized-domain" || error.message?.includes("unauthorized-domain"))) {
      const currentHost = window.location.hostname;
      const projectId = auth.app.options.projectId || "sylvan-basis-h7krv";
      throw new Error(`UNAUTHORIZED_DOMAIN|${currentHost}|${projectId}`);
    }
    if (error && (error.code === "auth/operation-not-supported-in-this-environment" || error.message?.includes("iframe") || error.message?.includes("third-party cookies") || error.message?.includes("network-error"))) {
      throw new Error("Google Sign-In is restricted in this preview or iframe environment. Please sign in using Email & Password, which works perfectly!");
    }
    throw error;
  }
}

// Register
export async function registerWithEmail(email, password, fullName) {
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    
    // Update profile display name
    await updateProfile(user, {
      displayName: fullName,
      photoURL: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150&q=80"
    });

    // Create user doc
    const userRef = doc(db, "users", user.uid);
    await setDoc(userRef, {
      userId: user.uid,
      displayName: fullName,
      email: email,
      photoURL: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150&q=80",
      joinedDate: new Date().toISOString(),
      resumeCount: 0
    });

    try {
      await sendEmailVerification(user);
    } catch (evErr) {
      console.warn("Could not send verification email:", evErr);
    }

    return user;
  } catch (error) {
    throw error;
  }
}

// Logout
export async function logoutUser() {
  await signOut(auth);
  window.location.href = "login.html";
}

// Forgot Password
export async function resetPassword(email) {
  await sendPasswordResetEmail(auth, email);
}

// Change Password
export async function changeUserPassword(newPassword) {
  const user = auth.currentUser;
  if (!user) throw new Error("No user authenticated.");
  await updatePassword(user, newPassword);
}

// Update User Password (alias)
export async function updateUserPassword(user, newPassword) {
  const targetUser = user || auth.currentUser;
  if (!targetUser) throw new Error("No user authenticated.");
  await updatePassword(targetUser, newPassword);
}

// Reauthenticate and update password securely
export async function reauthenticateAndChangePassword(currentPassword, newPassword) {
  const user = auth.currentUser;
  if (!user) throw new Error("No user authenticated.");
  if (!user.email) throw new Error("User email not found. Cannot reauthenticate.");
  
  try {
    const credential = EmailAuthProvider.credential(user.email, currentPassword);
    await reauthenticateWithCredential(user, credential);
  } catch (reauthErr) {
    console.error("Reauth failed:", reauthErr);
    if (reauthErr.code === "auth/invalid-credential" || reauthErr.code === "auth/wrong-password") {
      throw new Error("Incorrect current password. Please verify and try again.");
    }
    throw new Error(reauthErr.message || "Failed to verify current credentials.");
  }
  
  await updatePassword(user, newPassword);
}

// Update User Info
export async function updateUserInfo(user, { displayName, photoURL }) {
  const targetUser = user || auth.currentUser;
  if (!targetUser) throw new Error("No user authenticated.");
  
  const profileUpdate = {};
  if (displayName !== undefined) profileUpdate.displayName = displayName;
  if (photoURL !== undefined) profileUpdate.photoURL = photoURL;
  
  await updateProfile(targetUser, profileUpdate);
  
  // Update Firestore user document
  const userRef = doc(db, "users", targetUser.uid);
  const firestoreUpdate = {};
  if (displayName !== undefined) firestoreUpdate.displayName = displayName;
  if (photoURL !== undefined) firestoreUpdate.photoURL = photoURL;
  
  await setDoc(userRef, firestoreUpdate, { merge: true });
}

// Update Profile
export async function updateUserProfile(displayName, photoURL) {
  const user = auth.currentUser;
  if (!user) throw new Error("No user authenticated.");
  await updateProfile(user, { displayName, photoURL });
  
  // Update Firestore user document
  const userRef = doc(db, "users", user.uid);
  await setDoc(userRef, {
    displayName,
    photoURL
  }, { merge: true });
}

// Delete Account
export async function deleteUserAccount() {
  const user = auth.currentUser;
  if (!user) throw new Error("No user authenticated.");
  await deleteUser(user);
}
