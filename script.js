import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getFirestore,
  doc,
  onSnapshot,
  setDoc,
  increment
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const weddingDate = new Date("2027-05-01T16:00:00");
const countdownDays = document.getElementById("countdownDays");
const toast = document.getElementById("toast");
const addCalendarButton = document.getElementById("addCalendarButton");
const copyAddressButton = document.getElementById("copyAddressButton");
const venueAddress = document.getElementById("venueAddress");

const firebaseConfig = {
  apiKey: "AIzaSyBD-XcsLnfE_hWwU8Xcft8m-_A4pcVidSg",
  authDomain: "wedding-website-905e0.firebaseapp.com",
  projectId: "wedding-website-905e0",
  storageBucket: "wedding-website-905e0.firebasestorage.app",
  messagingSenderId: "861257187929",
  appId: "1:861257187929:web:6da5e65e426f19fcfae748"
};

const firebaseConfigured = Object.values(firebaseConfig).every((value) => {
  return value && !String(value).startsWith("YOUR_");
});

let db = null;

if (firebaseConfigured) {
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
}

function showToast(message) {
  if (!toast) return;

  toast.textContent = message;
  toast.classList.add("show");

  window.setTimeout(() => {
    toast.classList.remove("show");
  }, 2600);
}

function updateCountdown() {
  if (!countdownDays) return;

  const now = new Date();
  const diff = weddingDate - now;
  const days = Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));

  countdownDays.textContent = days.toLocaleString();
}

function getLikeStorageKey(postId) {
  return `sg-liked-${postId}`;
}

function setLikeButtonState(button, liked) {
  const heart = button.querySelector(".heart");

  button.classList.toggle("liked", liked);
  button.setAttribute("aria-pressed", String(liked));

  if (heart) {
    heart.textContent = liked ? "♥" : "♡";
  }
}

function initializeRealLikes() {
  const likeButtons = document.querySelectorAll(".like-button");

  likeButtons.forEach((button) => {
    const postId = button.dataset.postId;
    const countEl = document.querySelector(`[data-like-count-for="${postId}"]`);

    const alreadyLiked = localStorage.getItem(getLikeStorageKey(postId)) === "true";
    setLikeButtonState(button, alreadyLiked);

    if (db) {
      const likeDoc = doc(db, "postLikes", postId);

      onSnapshot(likeDoc, (snapshot) => {
        const count = snapshot.exists() ? snapshot.data().count || 0 : 0;

        if (countEl) {
          countEl.textContent = count.toLocaleString();
        }
      });
    } else if (countEl) {
      countEl.textContent = "0";
    }

    button.addEventListener("click", async () => {
      const wasLiked = localStorage.getItem(getLikeStorageKey(postId)) === "true";
      const isNowLiked = !wasLiked;
      const delta = isNowLiked ? 1 : -1;

      setLikeButtonState(button, isNowLiked);
      localStorage.setItem(getLikeStorageKey(postId), String(isNowLiked));

      if (!db) {
        showToast("Firebase is not configured yet, so this like is only saved on this device.");
        return;
      }

      button.disabled = true;

      try {
        await setDoc(
          doc(db, "postLikes", postId),
          { count: increment(delta) },
          { merge: true }
        );

        showToast(isNowLiked ? "Liked" : "Like removed");
      } catch (error) {
        setLikeButtonState(button, wasLiked);
        localStorage.setItem(getLikeStorageKey(postId), String(wasLiked));

        showToast("Could not save like. Check Firebase rules/config.");
        console.error(error);
      } finally {
        button.disabled = false;
      }
    });
  });
}

function initializeShareButtons() {
  const shareButtons = document.querySelectorAll(".share-button");

  shareButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      const shareText = button.dataset.shareText || "Sydney and Grant are getting married!";
      const shareUrl = window.location.href;

      if (navigator.share) {
        try {
          await navigator.share({
            title: "Sydney & Grant",
            text: shareText,
            url: shareUrl
          });
        } catch {
          return;
        }
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(shareUrl);
        showToast("Site link copied");
      } else {
        showToast("Copy this page URL to share");
      }
    });
  });
}

function downloadCalendarFile() {
  const title = "Sydney and Grant Wedding";
  const location = "6152 Mannahoc Way, Ruckersville, VA 22968";
  const description = "Wedding celebration for Sydney and Grant.";
  const start = "20270501T160000";
  const end = "20270501T230000";

  const icsContent = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Sydney and Grant Wedding//EN",
    "BEGIN:VEVENT",
    `UID:sydney-grant-wedding-${Date.now()}@grantandsydney.com`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").split(".")[0]}Z`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${title}`,
    `LOCATION:${location}`,
    `DESCRIPTION:${description}`,
    "END:VEVENT",
    "END:VCALENDAR"
  ].join("\r\n");

  const blob = new Blob([icsContent], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = "sydney-grant-wedding.ics";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
  showToast("Calendar file downloaded");
}

async function copyAddress() {
  if (!venueAddress) return;

  const addressText = venueAddress.innerText.replace(/\n/g, ", ");

  if (navigator.clipboard) {
    await navigator.clipboard.writeText(addressText);
    showToast("Address copied");
  } else {
    showToast("Copy the address from the footer");
  }
}

window.addEventListener("load", () => {
  updateCountdown();
  initializeRealLikes();
  initializeShareButtons();
});

if (addCalendarButton) {
  addCalendarButton.addEventListener("click", downloadCalendarFile);
}

if (copyAddressButton) {
  copyAddressButton.addEventListener("click", copyAddress);
}