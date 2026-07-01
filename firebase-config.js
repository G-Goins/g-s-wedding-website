import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

export const firebaseConfig = {
  apiKey: "AIzaSyBD-XcsLnfE_hWwU8Xcft8m-_A4pcVidSg",
  authDomain: "wedding-website-905e0.firebaseapp.com",
  projectId: "wedding-website-905e0",
  storageBucket: "wedding-website-905e0.firebasestorage.app",
  messagingSenderId: "861257187929",
  appId: "1:861257187929:web:6da5e65e426f19fcfae748"
};

export const firebaseConfigured = Object.values(firebaseConfig).every((value) => {
  return value && !String(value).startsWith("YOUR_");
});

export const app = firebaseConfigured ? initializeApp(firebaseConfig) : null;
export const auth = firebaseConfigured ? getAuth(app) : null;
export const db = firebaseConfigured ? getFirestore(app) : null;
export const storage = firebaseConfigured ? getStorage(app) : null;