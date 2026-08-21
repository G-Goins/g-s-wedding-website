import { db, firebaseConfigured } from "./firebase-config.js";

import {
  doc,
  getDoc,
  serverTimestamp,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";


const $ = (id) => document.getElementById(id);


const lookupForm = $("lookupForm");
const guestNameInput = $("guestName");
const lookupMessage = $("lookupMessage");

const inviteSection = $("inviteSection");
const householdName = $("householdName");
const inviteHelp = $("inviteHelp");

const guestCheckboxes = $("guestCheckboxes");
const extraGuestFields = $("extraGuestFields");

const rsvpForm = $("rsvpForm");

const mailingAddress = $("mailingAddress");
const dietaryNotes = $("dietaryNotes");
const songRequest = $("songRequest");
const message = $("message");

const toast = $("toast");


const SUFFIXES = new Set([
  "jr",
  "sr",
  "ii",
  "iii",
  "iv",
  "v"
]);


let currentInviteId = null;
let currentInvite = null;
let toastTimer = null;


/*
 * The stylesheet already contains styles for these classes.
 * Creating the container here means no additional RSVP markup is required.
 */
const candidateChoices = document.createElement("section");

candidateChoices.className = "candidate-choices hidden";
candidateChoices.setAttribute("aria-live", "polite");

lookupMessage.after(candidateChoices);


/* ---------------------------------------------------------
   General UI helpers
--------------------------------------------------------- */

function showToast(text) {
  if (!toast) {
    return;
  }

  clearTimeout(toastTimer);

  toast.textContent = text;
  toast.classList.add("show");

  toastTimer = window.setTimeout(() => {
    toast.classList.remove("show");
  }, 2600);
}


function setLookupMessage(text = "") {
  lookupMessage.textContent = text;
}


/* ---------------------------------------------------------
   Name normalization
--------------------------------------------------------- */

/*
 * Converts:
 *
 *   "Charles A. Hall" -> "charles a hall"
 *   "Mariángela"      -> "mariangela"
 *   "O'Connor"        -> "oconnor"
 *
 * The admin index builder below uses the exact same logic.
 */
function normalizeWords(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


/*
 * Firestore document-safe lookup key.
 *
 * "Charles A. Hall" -> "charles-a-hall"
 */
function normalizeNameKey(value) {
  return normalizeWords(value).replace(/\s+/g, "-");
}


/*
 * Handles common suffixes correctly:
 *
 * John Hall Jr.
 *
 * surname -> hall
 * given   -> ["john"]
 */
function nameParts(value) {
  const parts = normalizeWords(value)
    .split(" ")
    .filter(Boolean);

  while (
    parts.length > 1 &&
    SUFFIXES.has(parts.at(-1))
  ) {
    parts.pop();
  }

  return {
    surname: parts.at(-1) || "",
    given: parts.slice(0, -1)
  };
}


/*
 * Removes duplicate attendee names while preserving their
 * original capitalization/display spelling.
 */
function uniqueNames(values = []) {
  const seen = new Set();

  return values
    .map((value) => String(value || "").trim())
    .filter((value) => {
      const key = normalizeNameKey(value);

      if (!key || seen.has(key)) {
        return false;
      }

      seen.add(key);

      return true;
    });
}


/* ---------------------------------------------------------
   Invitation capacity / +1 handling
--------------------------------------------------------- */

function nonNegativeInt(value) {
  if (
    value === "" ||
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const number = Number(value);

  if (!Number.isFinite(number)) {
    return null;
  }

  return Math.max(
    0,
    Math.floor(number)
  );
}


/*
 * Preferred invite schema:
 *
 * {
 *   guestNames: ["Charles A. Hall"],
 *   plusOnes: 1,
 *   maxAttendees: 2
 * }
 *
 * If plusOnes exists, it is authoritative.
 *
 * For backwards compatibility, an invite containing only:
 *
 * {
 *   guestNames: ["Charles A. Hall"],
 *   maxAttendees: 2
 * }
 *
 * still produces one unnamed guest field.
 */
function inviteCapacity(invite, guestNames) {
  const plusOnes = [
    invite.plusOnes,
    invite.plusOneCount
  ]
    .map(nonNegativeInt)
    .find((value) => value !== null);

  if (plusOnes !== undefined) {
    return {
      max: guestNames.length + plusOnes,
      extra: plusOnes
    };
  }

  const configuredMax =
    nonNegativeInt(invite.maxAttendees);

  const max = Math.max(
    guestNames.length,
    configuredMax ?? 0,
    1
  );

  return {
    max,
    extra: Math.max(
      0,
      max - guestNames.length
    )
  };
}


/* ---------------------------------------------------------
   URL state
--------------------------------------------------------- */

function setInviteQueryParam(inviteId) {
  const url = new URL(window.location.href);

  if (inviteId) {
    url.searchParams.set(
      "invite",
      inviteId
    );
  } else {
    url.searchParams.delete("invite");
  }

  window.history.replaceState(
    {},
    "",
    url
  );
}


/* ---------------------------------------------------------
   Reset helpers
--------------------------------------------------------- */

function clearCandidates() {
  candidateChoices.replaceChildren();

  candidateChoices.classList.add(
    "hidden"
  );
}


function resetInvite() {
  currentInviteId = null;
  currentInvite = null;

  inviteSection.classList.add(
    "hidden"
  );

  rsvpForm.reset();

  guestCheckboxes.replaceChildren();
  extraGuestFields.replaceChildren();
}


/* ---------------------------------------------------------
   Safe DOM construction
--------------------------------------------------------- */

/*
 * Do not interpolate Firestore guest names into innerHTML.
 *
 * textContent/value avoids a stored-XSS problem if a spreadsheet
 * cell ever contains HTML-like content.
 */
function createCheckboxRow(
  name,
  checked
) {
  const label =
    document.createElement("label");

  label.className = "checkbox-row";


  const input =
    document.createElement("input");

  input.type = "checkbox";
  input.name = "attendeeName";
  input.value = name;
  input.checked = checked;


  const span =
    document.createElement("span");

  span.textContent = name;


  label.append(
    input,
    span
  );

  return label;
}


function createExtraGuestField(
  index,
  value = ""
) {
  const label =
    document.createElement("label");

  label.append(
    `Additional guest ${index + 1}`
  );


  const input =
    document.createElement("input");

  input.type = "text";
  input.className =
    "extra-guest-input";

  input.placeholder =
    "Guest name";

  input.autocomplete =
    "name";

  input.value =
    value;


  label.append(input);

  return label;
}


/* ---------------------------------------------------------
   Invitation rendering
--------------------------------------------------------- */

function renderInvite(
  inviteId,
  invite
) {
  currentInviteId = inviteId;
  currentInvite = invite;

  clearCandidates();


  const guestNames =
    uniqueNames(
      Array.isArray(invite.guestNames)
        ? invite.guestNames
        : []
    );


  const savedNames =
    uniqueNames(
      Array.isArray(
        invite.rsvp?.attendeeNames
      )
        ? invite.rsvp.attendeeNames
        : []
    );


  const savedKeys =
    new Set(
      savedNames.map(
        normalizeNameKey
      )
    );


  const namedKeys =
    new Set(
      guestNames.map(
        normalizeNameKey
      )
    );


  /*
   * Anything previously submitted that is not a named invitee
   * must have been entered into an unnamed +1 field.
   */
  const savedExtras =
    savedNames.filter(
      (name) =>
        !namedKeys.has(
          normalizeNameKey(name)
        )
    );


  const {
    max,
    extra
  } = inviteCapacity(
    invite,
    guestNames
  );


  householdName.textContent =
    invite.householdName ||
    "Your Household";


  inviteHelp.textContent =
    `You may RSVP for up to ${max} guest${
      max === 1 ? "" : "s"
    }.`;


  guestCheckboxes.replaceChildren(
    ...guestNames.map((name) =>
      createCheckboxRow(
        name,
        savedKeys.has(
          normalizeNameKey(name)
        )
      )
    )
  );


  extraGuestFields.replaceChildren(
    ...Array.from(
      {
        length: extra
      },
      (_, index) =>
        createExtraGuestField(
          index,
          savedExtras[index] || ""
        )
    )
  );


  if (
    invite.rsvp?.attending === true
  ) {
    rsvpForm.elements.attending.value =
      "yes";
  }


  if (
    invite.rsvp?.attending === false
  ) {
    rsvpForm.elements.attending.value =
      "no";
  }


  mailingAddress.value =
    invite.rsvp?.mailingAddress || "";

  dietaryNotes.value =
    invite.rsvp?.dietaryNotes || "";

  songRequest.value =
    invite.rsvp?.songRequest || "";

  message.value =
    invite.rsvp?.message || "";


  inviteSection.classList.remove(
    "hidden"
  );


  const mode =
    new URLSearchParams(
      window.location.search
    ).get("mode");


  if (mode === "address") {
    window.setTimeout(() => {
      mailingAddress.focus();
    }, 0);

    showToast(
      "We found your invite. Add your mailing address here."
    );
  }
}


/* ---------------------------------------------------------
   Invitation loading
--------------------------------------------------------- */

async function loadInvite(inviteId) {
  if (!db) {
    setLookupMessage(
      "Firebase is not configured yet."
    );

    return;
  }


  setLookupMessage(
    "Loading invite..."
  );


  const snapshot =
    await getDoc(
      doc(
        db,
        "invites",
        inviteId
      )
    );


  if (!snapshot.exists()) {
    resetInvite();

    setInviteQueryParam(null);

    setLookupMessage(
      "We could not find that invitation."
    );

    return;
  }


  setLookupMessage();


  renderInvite(
    inviteId,
    snapshot.data()
  );
}


/* ---------------------------------------------------------
   Lookup document parsing
--------------------------------------------------------- */

/*
 * New lookup documents contain:
 *
 * {
 *   candidates: [
 *     {
 *       inviteId: "...",
 *       name: "Charles A. Hall"
 *     }
 *   ]
 * }
 *
 * The legacy:
 *
 * {
 *   inviteId: "..."
 * }
 *
 * structure is also supported.
 */
function lookupCandidates(
  data,
  fallbackName = ""
) {
  const values =
    Array.isArray(data?.candidates)
      ? [...data.candidates]
      : [];


  if (data?.inviteId) {
    values.push({
      inviteId:
        data.inviteId,

      name:
        data.name ||
        data.guestName ||
        data.displayName ||
        fallbackName
    });
  }


  const seen = new Set();


  return values
    .map((value) => ({
      inviteId:
        String(
          value?.inviteId || ""
        ).trim(),

      name:
        String(
          value?.name ||
          value?.guestName ||
          value?.displayName ||
          ""
        ).trim()
    }))
    .filter((value) => {
      const key =
        `${value.inviteId}::${normalizeNameKey(
          value.name
        )}`;


      if (
        !value.inviteId ||
        !value.name ||
        seen.has(key)
      ) {
        return false;
      }


      seen.add(key);

      return true;
    });
}


/* ---------------------------------------------------------
   Loose matching
--------------------------------------------------------- */

function fuzzyMatches(
  query,
  candidates
) {
  const wanted =
    nameParts(query);


  /*
   * First constrain the search to the same surname.
   */
  const sameSurname =
    candidates.filter(
      (candidate) =>
        nameParts(
          candidate.name
        ).surname ===
        wanted.surname
    );


  /*
   * "Hall"
   *
   * Return every Hall candidate.
   */
  if (!wanted.given.length) {
    return sameSurname;
  }


  /*
   * Prefix matching means all of these can work:
   *
   * A Hall
   * Al Hall
   * Alice Hall
   *
   * It also lets:
   *
   * Charles Hall
   *
   * find:
   *
   * Charles A. Hall
   *
   * because a middle initial is not required.
   */
  const narrowed =
    sameSurname.filter(
      (candidate) => {
        const candidateGiven =
          nameParts(
            candidate.name
          ).given;


        return wanted.given.every(
          (prefix) =>
            candidateGiven.some(
              (part) =>
                part.startsWith(
                  prefix
                )
            )
        );
      }
    );


  /*
   * If their surname is correct but their prefix does not quite
   * match, show the surname candidates rather than giving a hard
   * "not found".
   */
  return narrowed.length
    ? narrowed
    : sameSurname;
}


/* ---------------------------------------------------------
   Ambiguous candidate chooser
--------------------------------------------------------- */

function renderCandidates(candidates) {
  candidateChoices.replaceChildren();

  candidateChoices.classList.remove(
    "hidden"
  );


  const heading =
    document.createElement("p");

  heading.textContent =
    "Which guest are you?";


  const list =
    document.createElement("div");

  list.className =
    "candidate-choice-list";


  const sorted =
    [...candidates].sort(
      (a, b) =>
        a.name.localeCompare(
          b.name
        )
    );


  for (const candidate of sorted) {
    const button =
      document.createElement("button");


    button.type =
      "button";

    button.className =
      "candidate-choice-button";

    button.textContent =
      candidate.name;


    button.addEventListener(
      "click",
      async () => {
        try {
          setInviteQueryParam(
            candidate.inviteId
          );

          await loadInvite(
            candidate.inviteId
          );
        } catch (error) {
          console.error(error);

          setLookupMessage(
            "Something went wrong while opening that invitation. Try again."
          );
        }
      }
    );


    list.append(button);
  }


  const note =
    document.createElement("p");

  note.className =
    "candidate-warning";

  note.textContent =
    "Select your name to open the matching invitation.";


  candidateChoices.append(
    heading,
    list,
    note
  );
}


/* ---------------------------------------------------------
   Lookup
--------------------------------------------------------- */

async function lookupInviteByName(
  rawName
) {
  if (!db) {
    setLookupMessage(
      "Firebase is not configured yet."
    );

    return;
  }


  const exactKey =
    normalizeNameKey(rawName);


  const {
    surname
  } = nameParts(rawName);


  resetInvite();
  clearCandidates();

  setInviteQueryParam(null);


  if (!exactKey || !surname) {
    setLookupMessage(
      "Please enter your name."
    );

    return;
  }


  setLookupMessage(
    "Searching guest list..."
  );


  /*
   * FAST PATH:
   *
   * Exact guest name.
   *
   * This remains backwards-compatible with your current:
   *
   * guestLookups/<normalized-name>
   *
   * documents.
   */
  const exact =
    await getDoc(
      doc(
        db,
        "guestLookups",
        exactKey
      )
    );


  if (exact.exists()) {
    const candidates =
      lookupCandidates(
        exact.data(),
        rawName
      );


    if (candidates.length === 1) {
      setInviteQueryParam(
        candidates[0].inviteId
      );

      await loadInvite(
        candidates[0].inviteId
      );

      return;
    }


    /*
     * Handles the unlikely but possible situation where two
     * different invitations contain the same normalized guest name.
     */
    if (candidates.length > 1) {
      setLookupMessage(
        "We found more than one exact match. Please choose your name."
      );

      renderCandidates(
        candidates
      );

      return;
    }
  }


  /*
   * LOOSE PATH:
   *
   * Retrieve one surname document.
   *
   * Example:
   *
   * guestLookups/last--hall
   *
   * This prevents the browser from downloading the entire guest list.
   */
  const surnameIndex =
    await getDoc(
      doc(
        db,
        "guestLookups",
        `last--${surname}`
      )
    );


  if (!surnameIndex.exists()) {
    setLookupMessage(
      "We could not find that name. Try your last name, first initial + last name, or full name."
    );

    return;
  }


  const matches =
    fuzzyMatches(
      rawName,
      lookupCandidates(
        surnameIndex.data()
      )
    );


  if (!matches.length) {
    setLookupMessage(
      "We could not find that name. Check the spelling or email us."
    );

    return;
  }


  setLookupMessage(
    matches.length === 1
      ? "We found a possible match. Please confirm your name."
      : "We found a few possible matches. Please choose your name."
  );


  renderCandidates(
    matches
  );
}


/* ---------------------------------------------------------
   Lookup form
--------------------------------------------------------- */

lookupForm.addEventListener(
  "submit",
  async (event) => {
    event.preventDefault();


    try {
      await lookupInviteByName(
        guestNameInput.value
      );
    } catch (error) {
      console.error(error);

      resetInvite();
      clearCandidates();

      setLookupMessage(
        "Something went wrong while searching. Try again."
      );
    }
  }
);


/* ---------------------------------------------------------
   RSVP submission
--------------------------------------------------------- */

rsvpForm.addEventListener(
  "submit",
  async (event) => {
    event.preventDefault();


    if (
      !db ||
      !currentInviteId ||
      !currentInvite
    ) {
      showToast(
        "Invite is not loaded."
      );

      return;
    }


    const attendingValue =
      rsvpForm.elements.attending.value;


    if (!attendingValue) {
      showToast(
        "Please choose whether you will attend."
      );

      return;
    }


    const guestNames =
      uniqueNames(
        Array.isArray(
          currentInvite.guestNames
        )
          ? currentInvite.guestNames
          : []
      );


    const {
      max,
      extra
    } = inviteCapacity(
      currentInvite,
      guestNames
    );


    const attending =
      attendingValue === "yes";


    const selected =
      Array.from(
        rsvpForm.querySelectorAll(
          'input[name="attendeeName"]:checked'
        )
      ).map(
        (input) =>
          input.value.trim()
      );


    /*
     * Only read the exact number of unnamed +1 fields allocated
     * to this invitation.
     */
    const plusOnes =
      Array.from(
        rsvpForm.querySelectorAll(
          ".extra-guest-input"
        )
      )
        .slice(
          0,
          extra
        )
        .map(
          (input) =>
            input.value.trim()
        )
        .filter(Boolean);


    const attendeeNames =
      attending
        ? uniqueNames([
            ...selected,
            ...plusOnes
          ])
        : [];


    if (
      attending &&
      !attendeeNames.length
    ) {
      showToast(
        "Select at least one attendee."
      );

      return;
    }


    if (
      attendeeNames.length > max
    ) {
      showToast(
        `This invite allows up to ${max} guest${
          max === 1 ? "" : "s"
        }.`
      );

      return;
    }


    const rsvp = {
      submitted: true,

      attending,

      attendeeNames,

      mailingAddress:
        mailingAddress.value.trim(),

      dietaryNotes:
        dietaryNotes.value.trim(),

      songRequest:
        songRequest.value.trim(),

      message:
        message.value.trim()
    };


    try {
      await updateDoc(
        doc(
          db,
          "invites",
          currentInviteId
        ),
        {
          rsvp,
          rsvpUpdatedAt:
            serverTimestamp()
        }
      );


      /*
       * Keep local state synchronized so another save during the
       * same browser session uses the current RSVP.
       */
      currentInvite = {
        ...currentInvite,
        rsvp
      };


      showToast(
        "RSVP saved."
      );
    } catch (error) {
      console.error(error);

      showToast(
        "Could not save RSVP. Please try again."
      );
    }
  }
);


/* ---------------------------------------------------------
   Direct invitation URL support
--------------------------------------------------------- */

window.addEventListener(
  "load",
  async () => {
    if (!firebaseConfigured) {
      setLookupMessage(
        "Firebase config is still using placeholder values."
      );

      return;
    }


    const inviteId =
      new URLSearchParams(
        window.location.search
      ).get("invite");


    if (!inviteId) {
      return;
    }


    try {
      await loadInvite(
        inviteId
      );
    } catch (error) {
      console.error(error);

      resetInvite();

      setInviteQueryParam(null);

      setLookupMessage(
        "Something went wrong while opening that invitation. Try your name instead."
      );
    }
  }
);