import { db, firebaseConfigured } from "./firebase-config.js";

import {
  doc,
  getDoc,
  serverTimestamp,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";


/* ---------------------------------------------------------
   DOM
--------------------------------------------------------- */

const $ = (id) =>
  document.getElementById(id);


const lookupForm =
  $("lookupForm");

const guestNameInput =
  $("guestName");

const lookupMessage =
  $("lookupMessage");


const candidateChoices =
  $("candidateChoices");

const candidateChoiceList =
  $("candidateChoiceList");

const candidatePrompt =
  $("candidatePrompt");


const inviteSection =
  $("inviteSection");

const householdName =
  $("householdName");

const inviteHelp =
  $("inviteHelp");


const namedGuestResponses =
  $("namedGuestResponses");


const plusOneSection =
  $("plusOneSection");

const plusOneHelp =
  $("plusOneHelp");

const plusOneCount =
  $("plusOneCount");

const plusOneNameFields =
  $("plusOneNameFields");


const welcomeReceptionResponse =
  $("welcomeReceptionResponse");


const lodging =
  $("lodging");

const shuttleResponse =
  $("shuttleResponse");

const arrivalPlans =
  $("arrivalPlans");

const departurePlans =
  $("departurePlans");

const travelNotes =
  $("travelNotes");


const dietaryNotes =
  $("dietaryNotes");

const songRequest =
  $("songRequest");


const contactEmail =
  $("contactEmail");

const contactPhone =
  $("contactPhone");


const message =
  $("message");


const rsvpForm =
  $("rsvpForm");


const wrongInviteButton =
  $("wrongInviteButton");

const wrongInviteBottomButton =
  $("wrongInviteBottomButton");


const toast =
  $("toast");


/* ---------------------------------------------------------
   State
--------------------------------------------------------- */

let currentInviteId = null;
let currentInvite = null;

let currentGuestNames = [];
let currentExtraCapacity = 0;
let currentMaxAttendees = 0;

let toastTimer = null;


/* ---------------------------------------------------------
   Name normalization
--------------------------------------------------------- */

const NAME_SUFFIXES = new Set([
  "jr",
  "sr",
  "ii",
  "iii",
  "iv",
  "v"
]);


/*
 * These are intentionally conservative.
 *
 * Prefix matching still handles:
 *
 * Char Hall -> Charles Hall
 * Kat Smith -> Katherine Smith
 *
 * These groups additionally handle:
 *
 * Charlie Hall -> Charles Hall
 * Tom Smith -> Thomas Smith
 */
const NICKNAME_GROUPS = [
  ["alexander", "alex"],
  ["andrew", "andy", "drew"],
  ["benjamin", "ben", "benny"],
  ["charles", "charlie", "chuck"],
  ["christopher", "chris"],
  ["daniel", "dan", "danny"],
  ["elizabeth", "liz", "lizzy", "beth"],
  ["james", "jim", "jimmy"],
  ["jennifer", "jen", "jenny"],
  ["john", "jack", "johnny"],
  ["joseph", "joe", "joey"],
  [
    "katherine",
    "kathryn",
    "catherine",
    "katie",
    "kate",
    "kathy",
    "kat"
  ],
  ["margaret", "maggie", "meg", "peggy"],
  ["michael", "mike"],
  ["nicholas", "nick"],
  ["patricia", "pat", "patty"],
  ["rebecca", "becca", "becky"],
  ["robert", "rob", "bob", "bobby"],
  ["samantha", "sam"],
  ["stephanie", "steph"],
  ["thomas", "tom", "tommy"],
  ["william", "will", "bill", "billy"]
];


const nicknameCanonical =
  new Map();


for (
  const group
  of NICKNAME_GROUPS
) {
  const canonical =
    group[0];

  for (
    const name
    of group
  ) {
    nicknameCanonical.set(
      name,
      canonical
    );
  }
}


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


function normalizeSearchInput(value) {
  const ignoredWords =
    new Set([
      "the",
      "family",
      "household"
    ]);


  return normalizeWords(value)
    .split(" ")
    .filter(
      (word) =>
        word &&
        !ignoredWords.has(word)
    )
    .join(" ");
}


function normalizeNameKey(value) {
  return normalizeWords(value)
    .replace(/\s+/g, "-");
}


function nameParts(value) {
  const parts =
    normalizeWords(value)
      .split(" ")
      .filter(Boolean);


  while (
    parts.length > 1 &&
    NAME_SUFFIXES.has(
      parts.at(-1)
    )
  ) {
    parts.pop();
  }


  return {
    surname:
      parts.at(-1) || "",

    given:
      parts.slice(0, -1)
  };
}


function surnameVariants(value) {
  const surname =
    normalizeWords(value);


  const variants =
    new Set([
      surname
    ]);


  /*
   * Helps "The Halls" find "Hall".
   *
   * We still try the original form first, so names such as
   * Jones continue to work normally.
   */
  if (
    surname.length > 3 &&
    surname.endsWith("s")
  ) {
    variants.add(
      surname.slice(0, -1)
    );
  }


  if (
    surname.length > 2 &&
    !surname.endsWith("s")
  ) {
    variants.add(
      `${surname}s`
    );
  }


  return Array.from(
    variants
  );
}


function namesEquivalent(
  queryPart,
  candidatePart
) {
  if (
    candidatePart.startsWith(
      queryPart
    )
  ) {
    return true;
  }


  const queryCanonical =
    nicknameCanonical.get(
      queryPart
    );


  const candidateCanonical =
    nicknameCanonical.get(
      candidatePart
    );


  return Boolean(
    queryCanonical &&
    candidateCanonical &&
    queryCanonical ===
      candidateCanonical
  );
}


function uniqueNames(values = []) {
  const seen =
    new Set();


  return values
    .map(
      (value) =>
        String(
          value || ""
        ).trim()
    )
    .filter(
      (value) => {
        const key =
          normalizeNameKey(
            value
          );


        if (
          !key ||
          seen.has(key)
        ) {
          return false;
        }


        seen.add(key);

        return true;
      }
    );
}


/* ---------------------------------------------------------
   General helpers
--------------------------------------------------------- */

function nonNegativeInt(value) {
  if (
    value === "" ||
    value === null ||
    value === undefined
  ) {
    return null;
  }


  const number =
    Number(value);


  if (
    !Number.isFinite(number)
  ) {
    return null;
  }


  return Math.max(
    0,
    Math.floor(number)
  );
}


function inviteCapacity(
  invite,
  guestNames
) {
  const explicitPlusOnes = [
    invite.plusOnes,
    invite.plusOneCount
  ]
    .map(nonNegativeInt)
    .find(
      (value) =>
        value !== null
    );


  if (
    explicitPlusOnes !==
    undefined
  ) {
    return {
      extra:
        explicitPlusOnes,

      max:
        guestNames.length +
        explicitPlusOnes
    };
  }


  const configuredMax =
    nonNegativeInt(
      invite.maxAttendees
    );


  const max =
    Math.max(
      guestNames.length,
      configuredMax ?? 0,
      1
    );


  return {
    max,

    extra:
      Math.max(
        0,
        max -
        guestNames.length
      )
  };
}


/* ---------------------------------------------------------
   UI
--------------------------------------------------------- */

function showToast(text) {
  if (!toast) {
    return;
  }


  clearTimeout(
    toastTimer
  );


  toast.textContent =
    text;


  toast.classList.add(
    "show"
  );


  toastTimer =
    window.setTimeout(
      () => {
        toast.classList.remove(
          "show"
        );
      },
      2800
    );
}


function setLookupMessage(
  text = ""
) {
  lookupMessage.textContent =
    text;
}


function clearCandidates() {
  candidateChoiceList
    .replaceChildren();


  candidateChoices
    .classList.add(
      "hidden"
    );
}


function setInviteQueryParam(
  inviteId
) {
  const url =
    new URL(
      window.location.href
    );


  if (inviteId) {
    url.searchParams.set(
      "invite",
      inviteId
    );
  } else {
    url.searchParams.delete(
      "invite"
    );
  }


  window.history.replaceState(
    {},
    "",
    url
  );
}


function resetInvite() {
  currentInviteId = null;
  currentInvite = null;

  currentGuestNames = [];
  currentExtraCapacity = 0;
  currentMaxAttendees = 0;


  rsvpForm.reset();


  namedGuestResponses
    .replaceChildren();

  plusOneNameFields
    .replaceChildren();


  plusOneSection
    .classList.add(
      "hidden"
    );


  inviteSection
    .classList.add(
      "hidden"
    );


  setInviteQueryParam(null);
}


/* ---------------------------------------------------------
   RSVP rendering
--------------------------------------------------------- */

function savedNamedResponse(
  rsvp,
  name
) {
  const responses =
    Array.isArray(
      rsvp?.namedGuestResponses
    )
      ? rsvp.namedGuestResponses
      : [];


  const response =
    responses.find(
      (item) =>
        normalizeNameKey(
          item?.name
        ) ===
        normalizeNameKey(name)
    );


  if (
    response &&
    typeof response.attending ===
      "boolean"
  ) {
    return response.attending
      ? "yes"
      : "no";
  }


  /*
   * Backwards compatibility with your old RSVP format.
   */
  if (
    rsvp?.submitted
  ) {
    const oldAttendees =
      new Set(
        uniqueNames(
          rsvp.attendeeNames
        ).map(
          normalizeNameKey
        )
      );


    return oldAttendees.has(
      normalizeNameKey(name)
    )
      ? "yes"
      : "no";
  }


  return "";
}


function createNamedGuestRow(
  name,
  index,
  savedValue
) {
  const row =
    document.createElement(
      "article"
    );


  row.className =
    "named-guest-rsvp";


  const heading =
    document.createElement(
      "h4"
    );


  heading.textContent =
    name;


  const options =
    document.createElement(
      "div"
    );


  options.className =
    "attendance-options";


  const choices = [
    {
      value: "yes",
      label: "Attending"
    },
    {
      value: "no",
      label: "Not attending"
    }
  ];


  for (
    const choice
    of choices
  ) {
    const label =
      document.createElement(
        "label"
      );


    label.className =
      "attendance-option";


    const input =
      document.createElement(
        "input"
      );


    input.type =
      "radio";

    input.name =
      `namedGuest-${index}`;

    input.value =
      choice.value;

    input.required =
      true;


    if (
      savedValue ===
      choice.value
    ) {
      input.checked =
        true;
    }


    const span =
      document.createElement(
        "span"
      );


    span.textContent =
      choice.label;


    label.append(
      input,
      span
    );


    options.append(
      label
    );
  }


  row.append(
    heading,
    options
  );


  return row;
}


function renderNamedGuests(
  guestNames,
  rsvp
) {
  const rows =
    guestNames.map(
      (
        name,
        index
      ) =>
        createNamedGuestRow(
          name,
          index,
          savedNamedResponse(
            rsvp,
            name
          )
        )
    );


  namedGuestResponses
    .replaceChildren(
      ...rows
    );
}


function savedExtraNames(
  invite,
  guestNames
) {
  if (
    Array.isArray(
      invite.rsvp?.plusOneNames
    )
  ) {
    return invite.rsvp.plusOneNames;
  }


  const namedKeys =
    new Set(
      guestNames.map(
        normalizeNameKey
      )
    );


  return uniqueNames(
    invite.rsvp?.attendeeNames
  ).filter(
    (name) =>
      !namedKeys.has(
        normalizeNameKey(name)
      )
  );
}


function currentPlusOneNames() {
  return Array.from(
    plusOneNameFields
      .querySelectorAll(
        ".plus-one-name-input"
      )
  ).map(
    (input) =>
      input.value
  );
}


function renderPlusOneFields(
  count,
  existingValues = []
) {
  const fields = [];


  for (
    let index = 0;
    index < count;
    index += 1
  ) {
    const label =
      document.createElement(
        "label"
      );


    label.textContent =
      `Guest ${index + 1} name`;


    const input =
      document.createElement(
        "input"
      );


    input.type =
      "text";

    input.className =
      "plus-one-name-input";

    input.autocomplete =
      "name";

    input.placeholder =
      "Optional name";

    input.value =
      existingValues[index] ||
      "";


    label.append(
      input
    );


    fields.push(
      label
    );
  }


  plusOneNameFields
    .replaceChildren(
      ...fields
    );
}


function configurePlusOnes(
  invite,
  guestNames,
  extraCapacity
) {
  plusOneCount
    .replaceChildren();


  for (
    let count = 0;
    count <= extraCapacity;
    count += 1
  ) {
    const option =
      document.createElement(
        "option"
      );


    option.value =
      String(count);

    option.textContent =
      String(count);


    plusOneCount.append(
      option
    );
  }


  if (
    extraCapacity === 0
  ) {
    plusOneSection
      .classList.add(
        "hidden"
      );

    return;
  }


  plusOneSection
    .classList.remove(
      "hidden"
    );


  plusOneHelp.textContent =
    `Your invitation includes up to ${extraCapacity} additional guest${
      extraCapacity === 1
        ? ""
        : "s"
    }.`;


  const oldExtras =
    savedExtraNames(
      invite,
      guestNames
    );


  const savedCount =
    Math.min(
      extraCapacity,
      nonNegativeInt(
        invite.rsvp?.plusOneCount
      ) ??
      oldExtras.length
    );


  plusOneCount.value =
    String(savedCount);


  renderPlusOneFields(
    savedCount,
    oldExtras
  );
}


function populateAdditionalFields(
  invite
) {
  const rsvp =
    invite.rsvp || {};


  welcomeReceptionResponse.value =
    rsvp.additionalEvents
      ?.welcomeReception ||
    "";


  lodging.value =
    rsvp.travel?.lodging ||
    "";

  shuttleResponse.value =
    rsvp.travel?.shuttle ||
    "";

  arrivalPlans.value =
    rsvp.travel?.arrivalPlans ||
    "";

  departurePlans.value =
    rsvp.travel?.departurePlans ||
    "";

  travelNotes.value =
    rsvp.travel?.notes ||
    "";


  dietaryNotes.value =
    rsvp.dietaryNotes ||
    "";

  songRequest.value =
    rsvp.songRequest ||
    "";


  contactEmail.value =
    rsvp.contact?.email ||
    "";

  contactPhone.value =
    rsvp.contact?.phone ||
    "";


  message.value =
    rsvp.message ||
    "";
}


function renderInvite(
  inviteId,
  invite
) {
  currentInviteId =
    inviteId;

  currentInvite =
    invite;


  clearCandidates();


  currentGuestNames =
    uniqueNames(
      Array.isArray(
        invite.guestNames
      )
        ? invite.guestNames
        : []
    );


  const capacity =
    inviteCapacity(
      invite,
      currentGuestNames
    );


  currentExtraCapacity =
    capacity.extra;

  currentMaxAttendees =
    capacity.max;


  householdName.textContent =
    invite.householdName ||
    currentGuestNames.join(" & ") ||
    "Your Invitation";


  inviteHelp.textContent =
    `This invitation allows up to ${capacity.max} guest${
      capacity.max === 1
        ? ""
        : "s"
    }.`;


  renderNamedGuests(
    currentGuestNames,
    invite.rsvp
  );


  configurePlusOnes(
    invite,
    currentGuestNames,
    currentExtraCapacity
  );


  populateAdditionalFields(
    invite
  );


  inviteSection
    .classList.remove(
      "hidden"
    );


  inviteSection.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}


/* ---------------------------------------------------------
   Invitation loading
--------------------------------------------------------- */

async function loadInvite(
  inviteId
) {
  if (!db) {
    setLookupMessage(
      "Firebase is not configured yet."
    );

    return;
  }


  setLookupMessage(
    "Loading invitation..."
  );


  const snapshot =
    await getDoc(
      doc(
        db,
        "invites",
        inviteId
      )
    );


  if (
    !snapshot.exists()
  ) {
    resetInvite();

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
   Lookup parsing
--------------------------------------------------------- */

function lookupCandidates(
  data,
  fallbackName = ""
) {
  const values =
    Array.isArray(
      data?.candidates
    )
      ? [...data.candidates]
      : [];


  /*
   * Backwards compatibility with the original lookup documents.
   */
  if (data?.inviteId) {
    values.push({
      inviteId:
        data.inviteId,

      name:
        data.name ||
        data.guestName ||
        data.matchedName ||
        data.displayName ||
        fallbackName
    });
  }


  const seen =
    new Set();


  return values
    .map(
      (value) => ({
        inviteId:
          String(
            value?.inviteId ||
            ""
          ).trim(),

        name:
          String(
            value?.name ||
            value?.guestName ||
            value?.matchedName ||
            value?.displayName ||
            ""
          ).trim()
      })
    )
    .filter(
      (value) => {
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
      }
    );
}


/* ---------------------------------------------------------
   Fuzzy matching
--------------------------------------------------------- */

function fuzzyMatches(
  rawQuery,
  candidates
) {
  const query =
    normalizeSearchInput(
      rawQuery
    );


  const wanted =
    nameParts(query);


  const acceptableSurnames =
    new Set(
      surnameVariants(
        wanted.surname
      )
    );


  const sameSurname =
    candidates.filter(
      (candidate) =>
        acceptableSurnames.has(
          nameParts(
            candidate.name
          ).surname
        )
    );


  /*
   * "Hall" or "The Halls"
   */
  if (
    !wanted.given.length
  ) {
    return sameSurname;
  }


  /*
   * "C Hall"
   * "Char Hall"
   * "Charles Hall"
   * "Charlie Hall"
   */
  const narrowed =
    sameSurname.filter(
      (candidate) => {
        const candidateGiven =
          nameParts(
            candidate.name
          ).given;


        return wanted.given.every(
          (queryPart) =>
            candidateGiven.some(
              (candidatePart) =>
                namesEquivalent(
                  queryPart,
                  candidatePart
                )
            )
        );
      }
    );


  /*
   * A correct surname is still useful even if the first-name
   * portion was misspelled.
   */
  return narrowed.length
    ? narrowed
    : sameSurname;
}


/* ---------------------------------------------------------
   Candidate chooser
--------------------------------------------------------- */

function renderCandidates(
  candidates
) {
  clearCandidates();


  candidateChoices
    .classList.remove(
      "hidden"
    );


  candidatePrompt.textContent =
    candidates.length === 1
      ? "Is this you?"
      : "Which guest are you?";


  const sorted =
    [...candidates]
      .sort(
        (a, b) =>
          a.name.localeCompare(
            b.name
          )
      );


  for (
    const candidate
    of sorted
  ) {
    const button =
      document.createElement(
        "button"
      );


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
          console.error(
            error
          );


          setLookupMessage(
            "Something went wrong while opening that invitation. Please try again."
          );
        }
      }
    );


    candidateChoiceList.append(
      button
    );
  }
}


/* ---------------------------------------------------------
   Guest lookup
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


  const query =
    normalizeSearchInput(
      rawName
    );


  if (!query) {
    setLookupMessage(
      "Please enter your name or household."
    );

    return;
  }


  resetInvite();
  clearCandidates();


  const exactKey =
    normalizeNameKey(
      query
    );


  const {
    surname
  } =
    nameParts(query);


  if (!surname) {
    setLookupMessage(
      "Please enter your last name."
    );

    return;
  }


  setLookupMessage(
    "Searching guest list..."
  );


  /*
   * Exact-name fast path.
   */
  const exactSnapshot =
    await getDoc(
      doc(
        db,
        "guestLookups",
        exactKey
      )
    );


  if (
    exactSnapshot.exists()
  ) {
    const exactCandidates =
      lookupCandidates(
        exactSnapshot.data(),
        rawName
      );


    if (
      exactCandidates.length === 1
    ) {
      setInviteQueryParam(
        exactCandidates[0]
          .inviteId
      );


      await loadInvite(
        exactCandidates[0]
          .inviteId
      );


      return;
    }


    if (
      exactCandidates.length > 1
    ) {
      setLookupMessage(
        "We found more than one match. Please choose your name."
      );


      renderCandidates(
        exactCandidates
      );


      return;
    }
  }


  /*
   * Loose path:
   *
   * only surname-index documents are downloaded.
   */
  const surnameKeys =
    surnameVariants(
      surname
    );


  const snapshots =
    await Promise.all(
      surnameKeys.map(
        (key) =>
          getDoc(
            doc(
              db,
              "guestLookups",
              `last--${key}`
            )
          )
      )
    );


  const candidates =
    snapshots.flatMap(
      (snapshot) =>
        snapshot.exists()
          ? lookupCandidates(
              snapshot.data()
            )
          : []
    );


  const deduped =
    Array.from(
      new Map(
        candidates.map(
          (candidate) => [
            `${candidate.inviteId}::${normalizeNameKey(
              candidate.name
            )}`,
            candidate
          ]
        )
      ).values()
    );


  if (
    !deduped.length
  ) {
    setLookupMessage(
      "We could not find that name. Try your last name, first initial + last name, or full name."
    );

    return;
  }


  const matches =
    fuzzyMatches(
      query,
      deduped
    );


  if (
    !matches.length
  ) {
    setLookupMessage(
      "We could not find that name. Check the spelling and try again."
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
        "Something went wrong while searching. Please try again."
      );
    }
  }
);


/* ---------------------------------------------------------
   Plus-one controls
--------------------------------------------------------- */

plusOneCount.addEventListener(
  "change",
  () => {
    const existingNames =
      currentPlusOneNames();


    const count =
      Math.min(
        currentExtraCapacity,
        nonNegativeInt(
          plusOneCount.value
        ) ?? 0
      );


    renderPlusOneFields(
      count,
      existingNames
    );
  }
);


/* ---------------------------------------------------------
   Wrong invitation
--------------------------------------------------------- */

function returnToLookup() {
  resetInvite();
  clearCandidates();

  setLookupMessage();


  guestNameInput.value =
    "";


  guestNameInput.focus();


  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}


wrongInviteButton.addEventListener(
  "click",
  returnToLookup
);


wrongInviteBottomButton.addEventListener(
  "click",
  returnToLookup
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
        "Invitation is not loaded."
      );

      return;
    }


    const namedGuestResponsesPayload =
      [];


    const namedAttendees =
      [];


    for (
      let index = 0;
      index < currentGuestNames.length;
      index += 1
    ) {
      const name =
        currentGuestNames[index];


      const response =
        rsvpForm.querySelector(
          `input[name="namedGuest-${index}"]:checked`
        );


      if (!response) {
        showToast(
          `Please RSVP for ${name}.`
        );

        return;
      }


      const attending =
        response.value ===
        "yes";


      namedGuestResponsesPayload.push({
        name,
        attending
      });


      if (attending) {
        namedAttendees.push(
          name
        );
      }
    }


    const selectedPlusOneCount =
      Math.min(
        currentExtraCapacity,
        nonNegativeInt(
          plusOneCount.value
        ) ?? 0
      );


    const plusOneNames =
      Array.from(
        plusOneNameFields
          .querySelectorAll(
            ".plus-one-name-input"
          )
      )
        .slice(
          0,
          selectedPlusOneCount
        )
        .map(
          (input) =>
            input.value.trim()
        );


    const totalAttending =
      namedAttendees.length +
      selectedPlusOneCount;


    if (
      totalAttending >
      currentMaxAttendees
    ) {
      showToast(
        `This invitation allows up to ${currentMaxAttendees} guest${
          currentMaxAttendees === 1
            ? ""
            : "s"
        }.`
      );

      return;
    }


    const attendeeNames =
      uniqueNames([
        ...namedAttendees,

        ...plusOneNames.filter(
          Boolean
        )
      ]);


    const rsvp = {
      submitted:
        true,

      attending:
        totalAttending > 0,

      attendeeNames,

      totalAttending,

      namedGuestResponses:
        namedGuestResponsesPayload,

      plusOneCount:
        selectedPlusOneCount,

      plusOneNames,

      additionalEvents: {
        welcomeReception:
          welcomeReceptionResponse.value
      },

      travel: {
        lodging:
          lodging.value.trim(),

        shuttle:
          shuttleResponse.value,

        arrivalPlans:
          arrivalPlans.value.trim(),

        departurePlans:
          departurePlans.value.trim(),

        notes:
          travelNotes.value.trim()
      },

      contact: {
        email:
          contactEmail.value.trim(),

        phone:
          contactPhone.value.trim()
      },

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


      currentInvite = {
        ...currentInvite,
        rsvp
      };


      showToast(
        "Your RSVP has been saved."
      );
    } catch (error) {
      console.error(error);


      showToast(
        "Could not save your RSVP. Please try again."
      );
    }
  }
);


/* ---------------------------------------------------------
   Direct invitation URL
--------------------------------------------------------- */

window.addEventListener(
  "load",
  async () => {
    if (
      !firebaseConfigured
    ) {
      setLookupMessage(
        "Firebase config is still using placeholder values."
      );

      return;
    }


    const inviteId =
      new URLSearchParams(
        window.location.search
      ).get(
        "invite"
      );


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


      setLookupMessage(
        "Something went wrong while opening that invitation. Try your name instead."
      );
    }
  }
);