const weddingDate = new Date("2027-05-01T16:00:00");
const desktopHeader = document.getElementById("desktopHeader");
const countdownDays = document.getElementById("countdownDays");
const toast = document.getElementById("toast");
const addCalendarButton = document.getElementById("addCalendarButton");
const copyAddressButton = document.getElementById("copyAddressButton");
const venueAddress = document.getElementById("venueAddress");

function showToast(message) {
  if (!toast) return;

  toast.textContent = message;
  toast.classList.add("show");

  window.setTimeout(() => {
    toast.classList.remove("show");
  }, 2600);
}

function updateHeader() {
  if (!desktopHeader) return;

  if (window.scrollY > 60) {
    desktopHeader.classList.add("scrolled");
  } else {
    desktopHeader.classList.remove("scrolled");
  }
}

function updateCountdown() {
  if (!countdownDays) return;

  const now = new Date();
  const diff = weddingDate - now;
  const days = Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));

  countdownDays.textContent = days.toLocaleString();
}

function initializeLikes() {
  const likeButtons = document.querySelectorAll(".like-button");

  likeButtons.forEach((button) => {
    const likeId = button.dataset.likeId;
    const storageKey = `liked-${likeId}`;

    if (localStorage.getItem(storageKey) === "true") {
      button.classList.add("liked");
      button.textContent = "♥";
    }

    button.addEventListener("click", () => {
      const isLiked = button.classList.toggle("liked");

      button.textContent = isLiked ? "♥" : "♡";
      localStorage.setItem(storageKey, String(isLiked));

      showToast(isLiked ? "Added to your favorites" : "Removed from favorites");
    });
  });
}

function initializeCommentJumps() {
  const commentButtons = document.querySelectorAll(".comment-jump");

  commentButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const target = document.querySelector(button.dataset.target);

      if (target) {
        target.scrollIntoView({ behavior: "smooth" });
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
            url: shareUrl,
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
  const location = "Ruckersville, VA";
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
    "END:VCALENDAR",
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

window.addEventListener("scroll", updateHeader);
window.addEventListener("load", () => {
  updateHeader();
  updateCountdown();
  initializeLikes();
  initializeCommentJumps();
  initializeShareButtons();
});

if (addCalendarButton) {
  addCalendarButton.addEventListener("click", downloadCalendarFile);
}

if (copyAddressButton) {
  copyAddressButton.addEventListener("click", copyAddress);
}