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
const dynamicPosts = document.getElementById("dynamicPosts");
const addCalendarButton = document.getElementById("addCalendarButton");
const copyAddressButton = document.getElementById("copyAddressButton");
const venueAddress = document.getElementById("venueAddress");
const toast = document.getElementById("toast");

const observedLikeIds = new Set();

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

  const difference = weddingDate.getTime() - Date.now();
  const days = Math.max(
    0,
    Math.ceil(difference / 86_400_000)
  );

  countdownDays.textContent = days.toLocaleString();
}

function likeStorageKey(postId) {
  return `sg-liked-${postId}`;
}

function setLikeState(button, liked) {
  const heart = button.querySelector(".heart");

  button.classList.toggle("liked", liked);
  button.setAttribute("aria-pressed", String(liked));

  if (heart) {
    heart.textContent = liked ? "♥" : "♡";
  }
}

function observeLikeCount(postId) {
  if (!db || observedLikeIds.has(postId)) return;

  observedLikeIds.add(postId);

  onSnapshot(
    doc(db, "postLikes", postId),

    (snapshot) => {
      const count = snapshot.exists()
        ? Number(snapshot.data().count || 0)
        : 0;

      document
        .querySelectorAll(
          `[data-like-count-for="${postId}"]`
        )
        .forEach((element) => {
          element.textContent = count.toLocaleString();
        });
    },

    (error) => {
      console.error("Could not load like count:", error);
    }
  );
}

function initializeLikeButtons(scope = document) {
  scope.querySelectorAll(".like-button").forEach((button) => {
    const postId = button.dataset.postId;

    if (
      !postId ||
      button.dataset.initialized === "true"
    ) {
      return;
    }

    button.dataset.initialized = "true";

    const alreadyLiked =
      localStorage.getItem(likeStorageKey(postId)) === "true";

    setLikeState(button, alreadyLiked);
    observeLikeCount(postId);

    button.addEventListener("click", async () => {
      const wasLiked =
        localStorage.getItem(likeStorageKey(postId)) === "true";

      const isLiked = !wasLiked;

      setLikeState(button, isLiked);
      localStorage.setItem(
        likeStorageKey(postId),
        String(isLiked)
      );

      if (!db) {
        showToast(
          "Like saved on this device. Firebase is not configured."
        );
        return;
      }

      button.disabled = true;

      try {
        await setDoc(
          doc(db, "postLikes", postId),
          {
            count: increment(isLiked ? 1 : -1)
          },
          {
            merge: true
          }
        );

        showToast(isLiked ? "Liked" : "Like removed");
      } catch (error) {
        console.error("Could not save like:", error);

        setLikeState(button, wasLiked);

        localStorage.setItem(
          likeStorageKey(postId),
          String(wasLiked)
        );

        showToast("Could not save the like.");
      } finally {
        button.disabled = false;
      }
    });
  });
}

function initializeShareButtons(scope = document) {
  scope.querySelectorAll(".share-button").forEach((button) => {
    if (button.dataset.initialized === "true") {
      return;
    }

    button.dataset.initialized = "true";

    button.addEventListener("click", async () => {
      const text =
        button.dataset.shareText ||
        "Sydney and Grant are getting married on May 1, 2027!";

      const url = window.location.href;

      if (navigator.share) {
        try {
          await navigator.share({
            title: "Sydney & Grant",
            text,
            url
          });
        } catch (error) {
          if (error?.name !== "AbortError") {
            console.error("Could not share:", error);
          }
        }

        return;
      }

      if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        showToast("Site link copied");
        return;
      }

      showToast("Copy the page URL to share it.");
    });
  });
}

function renderPost(postId, post) {
  const title = escapeHtml(post.title);
  const caption = escapeHtml(post.caption);
  const author = escapeHtml(
    post.author || "@sydneyandgrant"
  );
  const imageUrl = escapeHtml(post.imageUrl || "");

  return `
    <article class="post-card">
      <header class="post-header">
        <img
          src="images/grant-sydney.jpeg"
          alt=""
          class="avatar"
        />

        <div>
          <h3>${author}</h3>
          <p>${title}</p>
        </div>
      </header>

      ${
        imageUrl
          ? `
            <img
              src="${imageUrl}"
              alt=""
              class="dynamic-post-image"
            />
          `
          : ""
      }

      <div class="post-actions">
        <button
          type="button"
          class="like-button"
          data-post-id="${postId}"
          aria-pressed="false"
        >
          <span class="heart" aria-hidden="true">♡</span>

          <span
            class="like-count"
            data-like-count-for="${postId}"
          >
            0
          </span>

          <span class="sr-only">
            Like this post
          </span>
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
  if (
    !dynamicPosts ||
    !firebaseConfigured ||
    !db
  ) {
    return;
  }

  const postsQuery = query(
    collection(db, "posts"),
    orderBy("createdAt", "desc")
  );

  onSnapshot(
    postsQuery,

    (snapshot) => {
      dynamicPosts.innerHTML = snapshot.docs
        .map((postDocument) => {
          return renderPost(
            postDocument.id,
            postDocument.data()
          );
        })
        .join("");

      initializeLikeButtons(dynamicPosts);
      initializeShareButtons(dynamicPosts);
    },

    (error) => {
      console.error("Could not load posts:", error);
      showToast("Could not load the latest posts.");
    }
  );
}

function downloadCalendarFile() {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .split(".")[0];

  const calendar = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Sydney and Grant Wedding//EN",
    "BEGIN:VEVENT",
    `UID:sydney-grant-wedding-${Date.now()}@grantandsydney.com`,
    `DTSTAMP:${timestamp}Z`,
    "DTSTART:20270501T160000",
    "DTEND:20270501T230000",
    "SUMMARY:Sydney and Grant Wedding",
    "LOCATION:6152 Mannahoc Way\\, Ruckersville\\, VA 22968",
    "DESCRIPTION:Wedding celebration for Sydney and Grant.",
    "END:VEVENT",
    "END:VCALENDAR"
  ].join("\r\n");

  const blob = new Blob([calendar], {
    type: "text/calendar;charset=utf-8"
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "sydney-grant-wedding.ics";

  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);

  showToast("Calendar file downloaded");
}

async function copyAddress() {
  if (!venueAddress) return;

  const address = venueAddress.innerText.replace(
    /\n/g,
    ", "
  );

  if (!navigator.clipboard) {
    showToast(
      "Copy the address shown in the footer."
    );
    return;
  }

  try {
    await navigator.clipboard.writeText(address);
    showToast("Address copied");
  } catch (error) {
    console.error("Could not copy address:", error);
    showToast(
      "Could not copy the address automatically."
    );
  }
}

window.addEventListener("DOMContentLoaded", () => {
  updateCountdown();
  initializeLikeButtons();
  initializeShareButtons();
  loadDynamicPosts();
});

addCalendarButton?.addEventListener(
  "click",
  downloadCalendarFile
);

copyAddressButton?.addEventListener(
  "click",
  copyAddress
);