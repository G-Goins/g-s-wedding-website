import { db, firebaseConfigured } from "./firebase-config.js";
import {
  doc,
  getDoc,
  serverTimestamp,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const lookupForm = document.getElementById("lookupForm");
const guestNameInput = document.getElementById("guestName");
const lookupMessage = document.getElementById("lookupMessage");
const inviteSection = document.getElementById("inviteSection");
const householdNameEl = document.getElementById("householdName");
const inviteHelp = document.getElementById("inviteHelp");
const guestCheckboxes = document.getElementById("guestCheckboxes");
const extraGuestFields = document.getElementById("extraGuestFields");
const rsvpForm = document.getElementById("rsvpForm");
const mailingAddress = document.getElementById("mailingAddress");
const dietaryNotes = document.getElementById("dietaryNotes");
const songRequest = document.getElementById("songRequest");
const message = document.getElementById("message");
const toast = document.getElementById("toast");

let currentInviteId = null;
let currentInvite = null;

function showToast(text) {
  if (!toast) return;

  toast.textContent = text;
  toast.classList.add("show");

  window.setTimeout(() => {
    toast.classList.remove("show");
  }, 2600);
}

function setLookupMessage(text) {
  lookupMessage.textContent = text || "";
}

function normalizeName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function renderInvite(inviteId, invite) {
  currentInviteId = inviteId;
  currentInvite = invite;

  inviteSection.classList.remove("hidden");
  householdNameEl.textContent = invite.householdName || "Your Household";

  const maxAttendees = Number(invite.maxAttendees || invite.guestNames?.length || 1);
  const guestNames = Array.isArray(invite.guestNames) ? invite.guestNames : [];

  inviteHelp.textContent = `You may RSVP for up to ${maxAttendees} guest${maxAttendees === 1 ? "" : "s"}.`;

  guestCheckboxes.innerHTML = guestNames
    .map((guest) => {
      const checked = invite.rsvp?.attendeeNames?.includes(guest) ? "checked" : "";

      return `
        <label class="checkbox-row">
          <input type="checkbox" name="attendeeName" value="${guest}" ${checked} />
          <span>${guest}</span>
        </label>
      `;
    })
    .join("");

  const extraCount = Math.max(0, maxAttendees - guestNames.length);

  extraGuestFields.innerHTML = Array.from({ length: extraCount })
    .map((_, index) => {
      return `
        <label>
          Additional guest ${index + 1}
          <input type="text" class="extra-guest-input" placeholder="Guest name" />
        </label>
      `;
    })
    .join("");

  if (invite.rsvp?.attending === true) {
    rsvpForm.elements.attending.value = "yes";
  }

  if (invite.rsvp?.attending === false) {
    rsvpForm.elements.attending.value = "no";
  }

  mailingAddress.value = invite.rsvp?.mailingAddress || "";
  dietaryNotes.value = invite.rsvp?.dietaryNotes || "";
  songRequest.value = invite.rsvp?.songRequest || "";
  message.value = invite.rsvp?.message || "";

  const mode = getParam("mode");

  if (mode === "address") {
    mailingAddress.focus();
    showToast("We found your invite. Add your mailing address here.");
  }
}

async function loadInvite(inviteId) {
  if (!db) {
    setLookupMessage("Firebase is not configured yet.");
    return;
  }

  setLookupMessage("Loading invite...");

  const inviteSnap = await getDoc(doc(db, "invites", inviteId));

  if (!inviteSnap.exists()) {
    setLookupMessage("We could not find that invite. Check the spelling or email us.");
    return;
  }

  setLookupMessage("");
  renderInvite(inviteId, inviteSnap.data());
}

async function lookupInviteByName(name) {
  if (!db) {
    setLookupMessage("Firebase is not configured yet.");
    return;
  }

  const normalized = normalizeName(name);

  if (!normalized) {
    setLookupMessage("Please enter your full name.");
    return;
  }

  setLookupMessage("Searching guest list...");

  const lookupSnap = await getDoc(doc(db, "guestLookups", normalized));

  if (!lookupSnap.exists()) {
    setLookupMessage("We could not find that name. Try the full name from your invitation, or email us.");
    return;
  }

  const lookup = lookupSnap.data();
  const inviteId = lookup.inviteId;

  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set("invite", inviteId);
  window.history.replaceState({}, "", nextUrl.toString());

  await loadInvite(inviteId);
}

lookupForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    await lookupInviteByName(guestNameInput.value);
  } catch (error) {
    console.error(error);
    setLookupMessage("Something went wrong while searching. Try again.");
  }
});

rsvpForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!db || !currentInviteId || !currentInvite) {
    showToast("Invite is not loaded.");
    return;
  }

  const attendingValue = rsvpForm.elements.attending.value;
  const attending = attendingValue === "yes";

  const selectedNames = Array.from(rsvpForm.querySelectorAll('input[name="attendeeName"]:checked'))
    .map((input) => input.value);

  const extraNames = Array.from(rsvpForm.querySelectorAll(".extra-guest-input"))
    .map((input) => input.value.trim())
    .filter(Boolean);

  const attendeeNames = attending ? [...selectedNames, ...extraNames] : [];
  const maxAttendees = Number(currentInvite.maxAttendees || 1);

  if (attending && attendeeNames.length === 0) {
    showToast("Select at least one attendee.");
    return;
  }

  if (attendeeNames.length > maxAttendees) {
    showToast(`This invite allows up to ${maxAttendees} guest${maxAttendees === 1 ? "" : "s"}.`);
    return;
  }

  const payload = {
    rsvp: {
      submitted: true,
      attending,
      attendeeNames,
      dietaryNotes: dietaryNotes.value.trim(),
      songRequest: songRequest.value.trim(),
      mailingAddress: mailingAddress.value.trim(),
      message: message.value.trim()
    },
    rsvpUpdatedAt: serverTimestamp()
  };

  try {
    await updateDoc(doc(db, "invites", currentInviteId), payload);
    showToast("RSVP saved.");
  } catch (error) {
    console.error(error);
    showToast("Could not save RSVP. Please try again.");
  }
});

window.addEventListener("load", async () => {
  if (!firebaseConfigured) {
    setLookupMessage("Firebase config is still using placeholder values.");
    return;
  }

  const inviteId = getParam("invite");

  if (inviteId) {
    await loadInvite(inviteId);
  }
});