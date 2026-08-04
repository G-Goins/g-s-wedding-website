import {
  db,
  firebaseConfigured
} from "./firebase-config.js";

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
const proposalForm = document.getElementById("proposalForm");
const proposalFormMessage = document.getElementById(
  "proposalFormMessage"
);
const proposalSubmitButton = document.getElementById(
  "proposalSubmitButton"
);
const shirtSize = document.getElementById("shirtSize");
const proposalPhone = document.getElementById("proposalPhone");
const proposalNote = document.getElementById("proposalNote");

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

function isAllowedVideoUrl(value) {
  try {
    const url = new URL(value);

    return [
      "www.youtube.com",
      "youtube.com",
      "www.youtube-nocookie.com",
      "player.vimeo.com"
    ].includes(url.hostname);
  } catch {
    return false;
  }
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
      String(invitation.firstName || "").trim() || "My Friend";

    proposalHeading.textContent =
      `${firstName}, will you be my groomsman?`;

    proposalMessage.textContent =
      invitation.message ||
      "I would be honored to have you stand beside me.";

    if (
      invitation.videoUrl &&
      isAllowedVideoUrl(invitation.videoUrl)
    ) {
      proposalVideo.src = invitation.videoUrl;
    } else {
      proposalVideo.closest(".proposal-video").classList.add(
        "hidden"
      );
    }

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
    setFormMessage("Please select a response.");
    return;
  }

  proposalSubmitButton.disabled = true;
  setFormMessage("Saving your response...");

  const responseData = {
    inviteId: currentInviteId,
    response: selectedResponse,
    shirtSize: shirtSize.value,
    phone: proposalPhone.value.trim(),
    note: proposalNote.value.trim(),
    submittedAt: serverTimestamp()
  };

  try {
    await setDoc(
      doc(
        db,
        "groomsmanResponses",
        currentInviteId
      ),
      responseData,
      {
        merge: true
      }
    );

    setFormMessage("Your response has been saved. Thank you.");
    proposalSubmitButton.textContent = "Response saved";
  } catch (error) {
    console.error("Could not save response:", error);
    setFormMessage(
      "Your response could not be saved. Please try again."
    );
  } finally {
    proposalSubmitButton.disabled = false;
  }
});

window.addEventListener("load", loadProposal);