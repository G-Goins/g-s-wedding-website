import { db, firebaseConfigured } from "./firebase-config.js";

import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const loadingElement = document.getElementById("proposalLoading");
const proposalCard = document.getElementById("proposalCard");
const proposalHeading = document.getElementById("proposalHeading");
const proposalMessage = document.getElementById("proposalMessage");
const proposalVideo = document.getElementById("proposalVideo");
const proposalVideoContainer = document.getElementById(
  "proposalVideoContainer"
);
const proposalForm = document.getElementById("proposalForm");
const proposalNote = document.getElementById("proposalNote");
const proposalFormMessage = document.getElementById(
  "proposalFormMessage"
);
const proposalSubmitButton = document.getElementById(
  "proposalSubmitButton"
);

let currentInviteId = null;

function getInviteId() {
  return new URLSearchParams(window.location.search).get("id");
}

function setPageMessage(text) {
  loadingElement.textContent = text;
  loadingElement.classList.remove("hidden");
}

function setFormMessage(text) {
  proposalFormMessage.textContent = text || "";
}

function getEmbeddableVideoUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    const hostname = url.hostname
      .toLowerCase()
      .replace(/^www\./, "");

    if (hostname === "youtu.be") {
      const videoId = url.pathname
        .split("/")
        .filter(Boolean)[0];

      return videoId
        ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}`
        : null;
    }

    if (
      [
        "youtube.com",
        "m.youtube.com",
        "youtube-nocookie.com"
      ].includes(hostname)
    ) {
      if (url.pathname.startsWith("/embed/")) {
        const videoId = url.pathname
          .split("/embed/")[1]
          ?.split("/")[0];

        return videoId
          ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}`
          : null;
      }

      if (url.pathname.startsWith("/shorts/")) {
        const videoId = url.pathname
          .split("/shorts/")[1]
          ?.split("/")[0];

        return videoId
          ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}`
          : null;
      }

      const videoId = url.searchParams.get("v");

      return videoId
        ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}`
        : null;
    }

    if (hostname === "player.vimeo.com") {
      return url.toString();
    }

    if (hostname === "vimeo.com") {
      const videoId = url.pathname
        .split("/")
        .filter(Boolean)[0];

      return videoId
        ? `https://player.vimeo.com/video/${encodeURIComponent(videoId)}`
        : null;
    }

    return null;
  } catch {
    return null;
  }
}

function renderVideo(videoUrl) {
  const embeddableUrl = getEmbeddableVideoUrl(videoUrl);

  if (!embeddableUrl) {
    proposalVideo.removeAttribute("src");
    proposalVideoContainer.classList.add("hidden");
    return;
  }

  proposalVideo.src = embeddableUrl;
  proposalVideoContainer.classList.remove("hidden");
}


function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatProposalMessage(value) {
  return escapeHtml(value)
    // Bold: **text**
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    // Italic: *text*
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // Paragraph breaks
    .split(/\n{2,}/)
    .map((paragraph) => {
      const lines = paragraph.replace(/\n/g, "<br>");
      return `<p>${lines}</p>`;
    })
    .join("");
}


async function loadProposal() {
  if (!firebaseConfigured || !db) {
    setPageMessage("Firebase is not configured.");
    return;
  }

  const inviteId = getInviteId();

  if (!inviteId) {
    setPageMessage("This invitation link is incomplete.");
    return;
  }

  try {
    const inviteSnapshot = await getDoc(
      doc(db, "groomsmanInvites", inviteId)
    );

    if (!inviteSnapshot.exists()) {
      setPageMessage("This invitation could not be found.");
      return;
    }

    const invitation = inviteSnapshot.data();

    if (invitation.enabled !== true) {
      setPageMessage("This invitation is no longer active.");
      return;
    }

    currentInviteId = inviteId;

    const firstName =
      String(invitation.firstName || "").trim() ||
      "My Friend";

    proposalHeading.textContent =
      invitation.title ||
      `${firstName}, a quick question for you...`;

    renderVideo(invitation.videoUrl);

    proposalMessage.innerHTML = formatProposalMessage(
    invitation.message ||
    "I would be honored to have you stand beside me."
    );

    loadingElement.classList.add("hidden");
    proposalCard.classList.remove("hidden");
  } catch (error) {
    console.error("Could not load proposal:", error);

    setPageMessage(
      "Something went wrong while loading this invitation."
    );
  }
}

proposalForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!db || !currentInviteId) {
    setFormMessage("The invitation is not loaded.");
    return;
  }

  const selectedResponse =
    proposalForm.elements.response.value;

  if (!selectedResponse) {
    setFormMessage("Please select an answer.");
    return;
  }

  proposalSubmitButton.disabled = true;
  proposalSubmitButton.textContent = "Saving...";
  setFormMessage("Saving your response...");

  try {
    await setDoc(
      doc(
        db,
        "groomsmanResponses",
        currentInviteId
      ),
      {
        inviteId: currentInviteId,
        response: selectedResponse,
        note: proposalNote.value.trim(),
        submittedAt: serverTimestamp()
      },
      {
        merge: false
      }
    );

    proposalSubmitButton.textContent = "Response saved";

    setFormMessage(
      "Your response has been saved. Thank you."
    );
  } catch (error) {
    console.error("Could not save response:", error);

    proposalSubmitButton.textContent = "Send response";

    setFormMessage(
      "Your response could not be saved. Please try again."
    );
  } finally {
    proposalSubmitButton.disabled = false;
  }
});

window.addEventListener("load", loadProposal);