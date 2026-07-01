import { db, firebaseConfigured } from "./firebase-config.js";
import {
  collection,
  doc,
  increment,
  onSnapshot,
  orderBy,
  query,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const weddingDate = new Date("2027-05-01T16:00:00");
const countdownDays = document.getElementById("countdownDays");
const toast = document.getElementById("toast");
const addCalendarButton = document.getElementById("addCalendarButton");
const copyAddressButton = document.getElementById("copyAddressButton");
const venueAddress = document.getElementById("venueAddress");
const dynamicPosts = document.getElementById("dynamicPosts");

const likeListeners = new Set();

function showToast(message) {
  if (!toast) return;

  toast.textContent = message;
  toast.classList.add("show");

  window.setTimeout(() => {
    toast.classList.remove("show");
  }, 2600);
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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

function initializeLikeButtons(scope = document) {
  const likeButtons = scope.querySelectorAll(".like-button");

  likeButtons.forEach((button) => {
    const postId = button.dataset.postId;
    const countEl = document.querySelector(`[data-like-count-for="${postId}"]`);

    const alreadyLiked = localStorage.getItem(getLikeStorageKey(postId)) === "true";
    setLikeButtonState(button, alreadyLiked);

    if (db && !likeListeners.has(postId)) {
      likeListeners.add(postId);

      onSnapshot(doc(db, "postLikes", postId), (snapshot) => {
        const count = snapshot.exists() ? snapshot.data().count || 0 : 0;
        const allCountEls = document.querySelectorAll(`[data-like-count-for="${postId}"]`);

        allCountEls.forEach((element) => {
          element.textContent = count.toLocaleString();
        });
      });
    } else if (!db && countEl) {
      countEl.textContent = "0";
    }

    if (button.dataset.initialized === "true") return;
    button.dataset.initialized = "true";

    button.addEventListener("click", async () => {
      const wasLiked = localStorage.getItem(getLikeStorageKey(postId)) === "true";
      const isNowLiked = !wasLiked;
      const delta = isNowLiked ? 1 : -1;

      setLikeButtonState(button, isNowLiked);
      localStorage.setItem(getLikeStorageKey(postId), String(isNowLiked));

      if (!db) {
        showToast("Firebase is not configured yet. Like saved only on this device.");
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

        console.error(error);
        showToast("Could not save like.");
      } finally {
        button.disabled = false;
      }
    });
  });
}

function renderDynamicPost(postId, post) {
  const title = escapeHtml(post.title);
  const caption = escapeHtml(post.caption);
  const imageUrl = escapeHtml(post.imageUrl);
  const author = escapeHtml(post.author || "@sydneyandgrant");

  return `
    <article class="post-card">
      <div class="post-header">
        <img src="images/grant-sydney.jpeg" alt="" class="avatar" />
        <div>
          <h3>${author}</h3>
          <p>${title}</p>
        </div>
        <span class="dots">•••</span>
      </div>

      ${imageUrl ? `<img src="${imageUrl}" alt="" class="dynamic-post-image" />` : ""}

      <div class="post-actions">
        <button type="button" class="like-button" data-post-id="${postId}" aria-pressed="false">
          <span class="heart">♡</span>
          <span class="like-count" data-like-count-for="${postId}">0</span>
        </button>

        <button
          type="button"
          class="share-button"
          data-share-text="${title}"
        >
          Share
        </button>
      </div>

      <p class="caption">
        <strong>${author}</strong>
        ${caption}
      </p>
    </article>
  `;
}

function loadDynamicPosts() {
  if (!dynamicPosts) return;

  if (!firebaseConfigured || !db) {
    dynamicPosts.innerHTML = "";
    return;
  }

  const postsQuery = query(collection(db, "posts"), orderBy("createdAt", "desc"));

  onSnapshot(postsQuery, (snapshot) => {
    if (snapshot.empty) {
      dynamicPosts.innerHTML = "";
      return;
    }

    dynamicPosts.innerHTML = snapshot.docs
      .map((postDoc) => renderDynamicPost(postDoc.id, postDoc.data()))
      .join("");

    initializeLikeButtons(dynamicPosts);
    initializeShareButtons(dynamicPosts);
  });
}

function initializeShareButtons(scope = document) {
  const shareButtons = scope.querySelectorAll(".share-button");

  shareButtons.forEach((button) => {
    if (button.dataset.initialized === "true") return;
    button.dataset.initialized = "true";

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
    showToast("Copy the address from the footer.");
  }
}

window.addEventListener("load", () => {
  updateCountdown();
  initializeLikeButtons();
  initializeShareButtons();
  loadDynamicPosts();
});

if (addCalendarButton) {
  addCalendarButton.addEventListener("click", downloadCalendarFile);
}

if (copyAddressButton) {
  copyAddressButton.addEventListener("click", copyAddress);
}