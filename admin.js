import { auth, db, firebaseConfigured } from "./firebase-config.js";

import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";


/* ---------------------------------------------------------
   DOM
--------------------------------------------------------- */

const loginForm =
  document.getElementById("loginForm");

const adminPanel =
  document.getElementById("adminPanel");

const adminStatus =
  document.getElementById("adminStatus");

const signOutButton =
  document.getElementById("signOutButton");


const adminEmail =
  document.getElementById("adminEmail");

const adminPassword =
  document.getElementById("adminPassword");


const postForm =
  document.getElementById("postForm");

const postTitle =
  document.getElementById("postTitle");

const postCaption =
  document.getElementById("postCaption");

const postImageUrl =
  document.getElementById("postImageUrl");

const adminPosts =
  document.getElementById("adminPosts");


const guestCsvFile =
  document.getElementById("guestCsvFile");

const importGuestCsvButton =
  document.getElementById("importGuestCsvButton");


const toast =
  document.getElementById("toast");


/* ---------------------------------------------------------
   Constants
--------------------------------------------------------- */

const FIRESTORE_BATCH_LIMIT = 400;

const CSV_IMPORT_SOURCE =
  "guest-csv";

const NAME_SUFFIXES = new Set([
  "jr",
  "sr",
  "ii",
  "iii",
  "iv",
  "v"
]);


/* ---------------------------------------------------------
   UI helpers
--------------------------------------------------------- */

function showToast(message) {
  if (!toast) {
    console.log(message);
    return;
  }

  toast.textContent = message;
  toast.classList.add("show");

  window.setTimeout(() => {
    toast.classList.remove("show");
  }, 3200);
}


function setAdminStatus(message) {
  if (adminStatus) {
    adminStatus.textContent =
      message;
  }

  console.log(message);
}


function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


function cleanCell(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}


/* ---------------------------------------------------------
   Name normalization
--------------------------------------------------------- */

/*
 * Examples:
 *
 * Charles A. Hall -> charles a hall
 * Mariángela      -> mariangela
 * O'Connor        -> oconnor
 */
function normalizeLookupWords(value) {
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
 * Charles A. Hall -> charles-a-hall
 */
function normalizeLookupKey(value) {
  return normalizeLookupWords(value)
    .replace(/\s+/g, "-");
}


/*
 * John Hall Jr. -> hall
 */
function getLookupSurname(value) {
  const parts =
    normalizeLookupWords(value)
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

  return parts.at(-1) || "";
}


/* ---------------------------------------------------------
   Stable invitation identity
--------------------------------------------------------- */

/*
 * We need imports to be repeatable.
 *
 * The old code generated a new random invite ID every time
 * the CSV was imported. That means importing the same sheet
 * twice created duplicate invitations.
 *
 * This key remains stable for one CSV row.
 */
function stableImportKey({
  householdName,
  firstName,
  lastName
}) {
  return [
    householdName,
    firstName,
    lastName
  ]
    .map(normalizeLookupKey)
    .join("--");
}


function stableInviteId(importKey) {
  return `csv--${importKey}`;
}


/*
 * Used to recognize invitations created by the older importer
 * so existing RSVP information can be preserved when possible.
 */
function inviteSignature({
  householdName,
  guestNames,
  maxAttendees
}) {
  const normalizedGuests =
    [...guestNames]
      .map(normalizeLookupKey)
      .filter(Boolean)
      .sort();

  return [
    normalizeLookupKey(
      householdName
    ),

    normalizedGuests.join("|"),

    String(
      Number(maxAttendees) || 0
    )
  ].join("::");
}


/* ---------------------------------------------------------
   CSV parser
--------------------------------------------------------- */

/*
 * Handles:
 *
 * commas inside quoted cells
 * escaped quotes
 * CRLF / LF
 * quoted multiline cells
 */
function parseCsv(text) {
  const rows = [];

  let row = [];
  let field = "";
  let insideQuotes = false;


  for (
    let index = 0;
    index < text.length;
    index += 1
  ) {
    const char =
      text[index];

    const next =
      text[index + 1];


    if (char === '"') {
      if (
        insideQuotes &&
        next === '"'
      ) {
        field += '"';
        index += 1;
      } else {
        insideQuotes =
          !insideQuotes;
      }

      continue;
    }


    if (
      char === "," &&
      !insideQuotes
    ) {
      row.push(field);
      field = "";

      continue;
    }


    if (
      (
        char === "\n" ||
        char === "\r"
      ) &&
      !insideQuotes
    ) {
      if (
        char === "\r" &&
        next === "\n"
      ) {
        index += 1;
      }


      row.push(field);
      field = "";


      if (
        row.some(
          (value) =>
            cleanCell(value)
        )
      ) {
        rows.push(row);
      }


      row = [];

      continue;
    }


    field += char;
  }


  row.push(field);

  if (
    row.some(
      (value) =>
        cleanCell(value)
    )
  ) {
    rows.push(row);
  }


  if (insideQuotes) {
    throw new Error(
      "CSV contains an unterminated quoted field."
    );
  }


  if (rows.length < 2) {
    throw new Error(
      "CSV must include a header row and at least one invitation row."
    );
  }


  const headers =
    rows[0].map(
      (header) =>
        cleanCell(
          header
        ).toLowerCase()
    );


  const requiredHeaders = [
    "householdname",
    "firstname",
    "lastname",
    "maxattendees"
  ];


  for (
    const requiredHeader
    of requiredHeaders
  ) {
    if (
      !headers.includes(
        requiredHeader
      )
    ) {
      throw new Error(
        `CSV is missing required column: ${requiredHeader}.`
      );
    }
  }


  return rows
    .slice(1)
    .map(
      (
        values,
        rowIndex
      ) => {
        const parsed = {
          __rowNumber:
            rowIndex + 2
        };


        headers.forEach(
          (
            header,
            columnIndex
          ) => {
            parsed[header] =
              cleanCell(
                values[columnIndex] ||
                ""
              );
          }
        );


        return parsed;
      }
    );
}


/* ---------------------------------------------------------
   Spreadsheet guest parsing
--------------------------------------------------------- */

function splitAmpersandNames(value) {
  return cleanCell(value)
    .split(/\s*&\s*/)
    .map(cleanCell)
    .filter(Boolean);
}


function splitSlashNames(value) {
  return cleanCell(value)
    .split(/\s*\/\s*/)
    .map(cleanCell)
    .filter(Boolean);
}


/*
 * Examples:
 *
 * Charles A. + Hall
 *
 * -> Charles A. Hall
 *
 *
 * Calvin D. & Lisa + Goins
 *
 * -> Calvin D. Goins
 * -> Lisa Goins
 *
 *
 * Jeff & Mark + Catlett / Gasteiger
 *
 * -> Jeff Catlett
 * -> Mark Gasteiger
 */
function buildGuestNames(
  firstName,
  lastName
) {
  const firstNames =
    splitAmpersandNames(
      firstName
    );


  const lastNames =
    splitSlashNames(
      lastName
    );


  if (
    !firstNames.length ||
    !lastNames.length
  ) {
    return [];
  }


  /*
   * Paired different surnames.
   */
  if (
    firstNames.length > 1 &&
    lastNames.length ===
      firstNames.length
  ) {
    return firstNames.map(
      (
        first,
        index
      ) =>
        `${first} ${lastNames[index]}`.trim()
    );
  }


  /*
   * Shared surname.
   */
  return firstNames.map(
    (first) =>
      `${first} ${lastName}`.trim()
  );
}


/*
 * IMPORTANT:
 *
 * Each CSV ROW is one invitation.
 *
 * We intentionally do NOT group by householdName.
 */
function buildInvitationsFromCsvRows(
  rows
) {
  const seenImportKeys =
    new Set();


  return rows.map(
    (row) => {
      const householdName =
        cleanCell(
          row.householdname
        );


      const firstName =
        cleanCell(
          row.firstname
        );


      const lastName =
        cleanCell(
          row.lastname
        );


      const maxAttendees =
        Number(
          row.maxattendees
        );


      if (
        !firstName ||
        !lastName
      ) {
        throw new Error(
          `Row ${row.__rowNumber}: firstName and lastName are required.`
        );
      }


      if (
        !Number.isInteger(
          maxAttendees
        ) ||
        maxAttendees < 1
      ) {
        throw new Error(
          `Row ${row.__rowNumber}: maxAttendees must be a positive whole number.`
        );
      }


      const guestNames =
        buildGuestNames(
          firstName,
          lastName
        );


      if (
        !guestNames.length
      ) {
        throw new Error(
          `Row ${row.__rowNumber}: no guest names could be parsed.`
        );
      }


      if (
        maxAttendees <
        guestNames.length
      ) {
        throw new Error(
          `Row ${row.__rowNumber}: maxAttendees (${maxAttendees}) is smaller than the ${guestNames.length} named guests.`
        );
      }


      const resolvedHouseholdName =
        householdName ||
        lastName ||
        guestNames.join(" & ");


      const importKey =
        stableImportKey({
          householdName:
            resolvedHouseholdName,

          firstName,

          lastName
        });


      if (!importKey) {
        throw new Error(
          `Row ${row.__rowNumber}: could not create a stable invitation key.`
        );
      }


      if (
        seenImportKeys.has(
          importKey
        )
      ) {
        throw new Error(
          `Row ${row.__rowNumber}: this invitation duplicates another CSV row (${resolvedHouseholdName}, ${firstName} ${lastName}).`
        );
      }


      seenImportKeys.add(
        importKey
      );


      return {
        rowNumber:
          row.__rowNumber,

        householdName:
          resolvedHouseholdName,

        firstName,

        lastName,

        guestNames,

        maxAttendees,

        /*
         * Explicit unnamed guest allocation.
         */
        plusOnes:
          maxAttendees -
          guestNames.length,

        importKey
      };
    }
  );
}


/* ---------------------------------------------------------
   Firestore batch helper
--------------------------------------------------------- */

async function commitOperationsInChunks(
  operations
) {
  for (
    let start = 0;
    start < operations.length;
    start += FIRESTORE_BATCH_LIMIT
  ) {
    const batch =
      writeBatch(db);


    const chunk =
      operations.slice(
        start,
        start +
          FIRESTORE_BATCH_LIMIT
      );


    for (
      const operation
      of chunk
    ) {
      if (
        operation.type ===
        "delete"
      ) {
        batch.delete(
          operation.ref
        );

        continue;
      }


      if (
        operation.options
      ) {
        batch.set(
          operation.ref,
          operation.data,
          operation.options
        );
      } else {
        batch.set(
          operation.ref,
          operation.data
        );
      }
    }


    await batch.commit();
  }
}


/* ---------------------------------------------------------
   RSVP defaults
--------------------------------------------------------- */

function defaultRsvp() {
  return {
    submitted: false,

    attending: false,

    attendeeNames: [],

    dietaryNotes: "",

    songRequest: "",

    mailingAddress: "",

    message: ""
  };
}


/* ---------------------------------------------------------
   Lookup index construction
--------------------------------------------------------- */

function addLookupCandidate(
  bucketMap,
  key,
  candidate
) {
  if (!key) {
    return;
  }


  const bucket =
    bucketMap.get(key) ||
    new Map();


  const dedupeKey =
    `${candidate.inviteId}::${normalizeLookupKey(
      candidate.name
    )}`;


  bucket.set(
    dedupeKey,
    candidate
  );


  bucketMap.set(
    key,
    bucket
  );
}


/*
 * Builds both:
 *
 * guestLookups/charles-a-hall
 *
 * and:
 *
 * guestLookups/last--hall
 */
function buildLookupOperations(
  importedInvites
) {
  const exactBuckets =
    new Map();


  const surnameBuckets =
    new Map();


  for (
    const invite
    of importedInvites
  ) {
    for (
      const name
      of invite.guestNames
    ) {
      const candidate = {
        inviteId:
          invite.inviteId,

        name
      };


      addLookupCandidate(
        exactBuckets,

        normalizeLookupKey(
          name
        ),

        candidate
      );


      addLookupCandidate(
        surnameBuckets,

        getLookupSurname(
          name
        ),

        candidate
      );
    }
  }


  const operations = [];


  /*
   * Exact-name documents.
   */
  for (
    const [
      exactKey,
      bucket
    ]
    of exactBuckets
  ) {
    operations.push({
      type: "set",

      ref:
        doc(
          db,
          "guestLookups",
          exactKey
        ),

      data: {
        kind:
          "exact",

        candidates:
          Array.from(
            bucket.values()
          ),

        updatedAt:
          serverTimestamp()
      }
    });
  }


  /*
   * Surname documents.
   */
  for (
    const [
      surname,
      bucket
    ]
    of surnameBuckets
  ) {
    operations.push({
      type: "set",

      ref:
        doc(
          db,
          "guestLookups",
          `last--${surname}`
        ),

      data: {
        kind:
          "surname",

        candidates:
          Array.from(
            bucket.values()
          ),

        updatedAt:
          serverTimestamp()
      }
    });
  }


  return {
    operations,

    exactLookupCount:
      exactBuckets.size,

    surnameLookupCount:
      surnameBuckets.size
  };
}


/* ---------------------------------------------------------
   Existing invitation migration
--------------------------------------------------------- */

/*
 * We attempt to preserve existing invitation IDs and RSVP data.
 *
 * Priority:
 *
 * 1. Existing invitation with this new importKey.
 * 2. Existing legacy invitation whose household, names and
 *    maxAttendees exactly match this CSV row.
 * 3. Otherwise create a deterministic new invitation ID.
 *
 * Old unrecognized legacy invitations are NOT deleted.
 * This is intentional: we don't silently destroy RSVP data from
 * your earlier importer.
 */
async function prepareImportedInvites(
  invitations
) {
  const existingSnapshot =
    await getDocs(
      collection(
        db,
        "invites"
      )
    );


  const existingById =
    new Map(
      existingSnapshot.docs.map(
        (snapshot) => [
          snapshot.id,
          snapshot
        ]
      )
    );


  const existingByImportKey =
    new Map();


  const legacyBySignature =
    new Map();


  for (
    const snapshot
    of existingSnapshot.docs
  ) {
    const data =
      snapshot.data();


    if (
      data.importSource ===
        CSV_IMPORT_SOURCE &&
      data.importKey
    ) {
      existingByImportKey.set(
        data.importKey,
        snapshot
      );
    }


    const guestNames =
      Array.isArray(
        data.guestNames
      )
        ? data.guestNames
        : [];


    const signature =
      inviteSignature({
        householdName:
          data.householdName ||
          "",

        guestNames,

        maxAttendees:
          data.maxAttendees
      });


    if (
      !legacyBySignature.has(
        signature
      )
    ) {
      legacyBySignature.set(
        signature,
        []
      );
    }


    legacyBySignature
      .get(signature)
      .push(snapshot);
  }


  const usedInviteIds =
    new Set();


  const importedInvites = [];


  for (
    const invitation
    of invitations
  ) {
    let existing =
      existingByImportKey.get(
        invitation.importKey
      ) ||
      null;


    /*
     * Attempt to migrate a matching invitation from the
     * older random-ID importer.
     */
    if (!existing) {
      const signature =
        inviteSignature(
          invitation
        );


      const matches =
        (
          legacyBySignature.get(
            signature
          ) ||
          []
        ).filter(
          (snapshot) =>
            !usedInviteIds.has(
              snapshot.id
            )
        );


      if (
        matches.length === 1
      ) {
        existing =
          matches[0];
      }
    }


    let inviteId =
      existing?.id ||
      stableInviteId(
        invitation.importKey
      );


    if (
      usedInviteIds.has(
        inviteId
      )
    ) {
      inviteId =
        stableInviteId(
          invitation.importKey
        );
    }


    const existingAtChosenId =
      existingById.get(
        inviteId
      );


    const existingData =
      (
        existing ||
        existingAtChosenId
      )?.data() ||
      null;


    usedInviteIds.add(
      inviteId
    );


    importedInvites.push({
      ...invitation,

      inviteId,

      existingData
    });
  }


  /*
   * Only invitations previously managed by THIS new importer
   * are automatically removed if their CSV row disappears.
   *
   * Old unmarked legacy invitation documents are intentionally
   * retained so we do not accidentally destroy old RSVP data.
   */
  const staleManagedInviteDocs =
    existingSnapshot.docs.filter(
      (snapshot) => {
        const data =
          snapshot.data();


        return (
          data.importSource ===
            CSV_IMPORT_SOURCE &&
          !usedInviteIds.has(
            snapshot.id
          )
        );
      }
    );


  return {
    importedInvites,

    staleManagedInviteDocs
  };
}


/* ---------------------------------------------------------
   Guest CSV import
--------------------------------------------------------- */

async function importGuestCsv() {
  if (!guestCsvFile) {
    throw new Error(
      "Guest CSV input is missing from admin.html."
    );
  }


  const file =
    guestCsvFile.files?.[0];


  if (!file) {
    throw new Error(
      "Choose a CSV file first."
    );
  }


  if (!db) {
    throw new Error(
      "Firebase database is not configured."
    );
  }


  const csvText =
    await file.text();


  const rows =
    parseCsv(
      csvText
    );


  const invitations =
    buildInvitationsFromCsvRows(
      rows
    );


  if (
    !invitations.length
  ) {
    throw new Error(
      "No invitations found in CSV."
    );
  }


  setAdminStatus(
    `Preparing ${invitations.length} invitations...`
  );


  const {
    importedInvites,
    staleManagedInviteDocs
  } =
    await prepareImportedInvites(
      invitations
    );


  /*
   * Write all invitation records.
   *
   * merge:true preserves existing RSVP information.
   */
  const inviteOperations =
    importedInvites.map(
      (invite) => ({
        type:
          "set",

        ref:
          doc(
            db,
            "invites",
            invite.inviteId
          ),

        options: {
          merge: true
        },

        data: {
          householdName:
            invite.householdName,

          guestNames:
            invite.guestNames,

          maxAttendees:
            invite.maxAttendees,

          plusOnes:
            invite.plusOnes,

          importSource:
            CSV_IMPORT_SOURCE,

          importKey:
            invite.importKey,

          updatedAt:
            serverTimestamp(),

          ...(
            invite.existingData
              ? {}
              : {
                  createdAt:
                    serverTimestamp(),

                  rsvp:
                    defaultRsvp()
                }
          )
        }
      })
    );


  setAdminStatus(
    "Writing invitations..."
  );


  await commitOperationsInChunks(
    inviteOperations
  );


  /*
   * Clean up only stale invitations that were created by this
   * version of the CSV importer.
   */
  if (
    staleManagedInviteDocs.length
  ) {
    await commitOperationsInChunks(
      staleManagedInviteDocs.map(
        (snapshot) => ({
          type:
            "delete",

          ref:
            snapshot.ref
        })
      )
    );
  }


  /*
   * Rebuild the guest lookup collection from scratch.
   *
   * THIS is the part your current importer is missing.
   */
  setAdminStatus(
    "Rebuilding RSVP lookup index..."
  );


  const existingLookupsSnapshot =
    await getDocs(
      collection(
        db,
        "guestLookups"
      )
    );


  await commitOperationsInChunks(
    existingLookupsSnapshot.docs.map(
      (snapshot) => ({
        type:
          "delete",

        ref:
          snapshot.ref
      })
    )
  );


  const lookupResult =
    buildLookupOperations(
      importedInvites
    );


  await commitOperationsInChunks(
    lookupResult.operations
  );


  guestCsvFile.value =
    "";


  const namedGuestCount =
    importedInvites.reduce(
      (
        total,
        invite
      ) =>
        total +
        invite.guestNames.length,

      0
    );


  setAdminStatus(
    `Guest list ready: ${importedInvites.length} invitations, ${namedGuestCount} named guests, ${lookupResult.surnameLookupCount} surname indexes.`
  );


  showToast(
    `Imported ${importedInvites.length} invitation${
      importedInvites.length === 1
        ? ""
        : "s"
    }.`
  );
}


/* ---------------------------------------------------------
   Feed posts
--------------------------------------------------------- */

async function createPost(event) {
  event.preventDefault();


  const title =
    postTitle?.value.trim();


  const caption =
    postCaption?.value.trim();


  const imageUrl =
    postImageUrl?.value.trim() ||
    "";


  if (
    !title ||
    !caption
  ) {
    showToast(
      "Post title and caption are required."
    );

    return;
  }


  try {
    const postRef =
      doc(
        collection(
          db,
          "posts"
        )
      );


    await setDoc(
      postRef,
      {
        title,

        caption,

        imageUrl,

        author:
          "@sydneyandgrant",

        createdAt:
          serverTimestamp()
      }
    );


    postForm.reset();


    showToast(
      "Post published."
    );


    await loadAdminPosts();
  } catch (error) {
    console.error(error);


    showToast(
      `Could not publish post: ${
        error.code ||
        error.message
      }`
    );
  }
}


/* ---------------------------------------------------------
   Recent posts
--------------------------------------------------------- */

async function loadAdminPosts() {
  if (!adminPosts) {
    return;
  }


  try {
    const snapshot =
      await getDocs(
        query(
          collection(
            db,
            "posts"
          ),

          orderBy(
            "createdAt",
            "desc"
          )
        )
      );


    if (snapshot.empty) {
      adminPosts.innerHTML =
        "<p>No posts yet.</p>";

      return;
    }


    adminPosts.innerHTML =
      snapshot.docs
        .map(
          (postDoc) => {
            const post =
              postDoc.data();


            return `
              <div class="result-card">
                <h3>${escapeHtml(
                  post.title
                )}</h3>

                <p>${escapeHtml(
                  post.caption
                )}</p>

                ${
                  post.imageUrl
                    ? `
                      <p>
                        <strong>Image:</strong>
                        ${escapeHtml(
                          post.imageUrl
                        )}
                      </p>
                    `
                    : ""
                }

                <button
                  type="button"
                  class="secondary-admin-button delete-post-button"
                  data-post-id="${postDoc.id}"
                >
                  Delete
                </button>
              </div>
            `;
          }
        )
        .join("");


    document
      .querySelectorAll(
        ".delete-post-button"
      )
      .forEach(
        (button) => {
          button.addEventListener(
            "click",
            async () => {
              const postId =
                button.dataset.postId;


              if (
                !window.confirm(
                  "Delete this post?"
                )
              ) {
                return;
              }


              try {
                await deleteDoc(
                  doc(
                    db,
                    "posts",
                    postId
                  )
                );


                showToast(
                  "Post deleted."
                );


                await loadAdminPosts();
              } catch (error) {
                console.error(
                  error
                );


                showToast(
                  `Could not delete post: ${
                    error.code ||
                    error.message
                  }`
                );
              }
            }
          );
        }
      );
  } catch (error) {
    console.error(error);


    showToast(
      `Could not load posts: ${
        error.code ||
        error.message
      }`
    );
  }
}


/* ---------------------------------------------------------
   Initial config
--------------------------------------------------------- */

if (!firebaseConfigured) {
  setAdminStatus(
    "Firebase config is still using placeholder values in firebase-config.js."
  );
}


/* ---------------------------------------------------------
   Login
--------------------------------------------------------- */

if (loginForm) {
  loginForm.addEventListener(
    "submit",
    async (event) => {
      event.preventDefault();


      if (
        !firebaseConfigured ||
        !auth
      ) {
        showToast(
          "Firebase is not configured."
        );

        return;
      }


      const email =
        adminEmail?.value.trim();


      const password =
        adminPassword?.value;


      if (
        !email ||
        !password
      ) {
        showToast(
          "Enter email and password."
        );

        return;
      }


      try {
        setAdminStatus(
          "Signing in..."
        );


        await signInWithEmailAndPassword(
          auth,
          email,
          password
        );
      } catch (error) {
        console.error(error);


        const messageByCode = {
          "auth/invalid-credential":
            "Invalid email or password.",

          "auth/user-not-found":
            "No Firebase Auth user exists for this email.",

          "auth/wrong-password":
            "Incorrect password.",

          "auth/operation-not-allowed":
            "Email/Password sign-in is not enabled in Firebase Authentication.",

          "auth/unauthorized-domain":
            "This domain is not authorized in Firebase Authentication settings."
        };


        const errorMessage =
          messageByCode[
            error.code
          ] ||
          `Sign-in failed: ${
            error.code ||
            error.message
          }`;


        showToast(
          errorMessage
        );


        setAdminStatus(
          errorMessage
        );
      }
    }
  );
}


/* ---------------------------------------------------------
   Sign out
--------------------------------------------------------- */

if (signOutButton) {
  signOutButton.addEventListener(
    "click",
    async () => {
      await signOut(auth);
    }
  );
}


/* ---------------------------------------------------------
   Post creation
--------------------------------------------------------- */

if (postForm) {
  postForm.addEventListener(
    "submit",
    createPost
  );
}


/* ---------------------------------------------------------
   CSV import
--------------------------------------------------------- */

if (importGuestCsvButton) {
  importGuestCsvButton.addEventListener(
    "click",
    async () => {
      const originalText =
        importGuestCsvButton.textContent;


      try {
        importGuestCsvButton.disabled =
          true;


        importGuestCsvButton.textContent =
          "Importing...";


        await importGuestCsv();
      } catch (error) {
        console.error(error);


        const errorMessage =
          error.message ||
          "Could not import guest CSV.";


        showToast(
          errorMessage
        );


        setAdminStatus(
          errorMessage
        );
      } finally {
        importGuestCsvButton.disabled =
          false;


        importGuestCsvButton.textContent =
          originalText;
      }
    }
  );
}


/* ---------------------------------------------------------
   Auth state
--------------------------------------------------------- */

if (
  firebaseConfigured &&
  auth
) {
  onAuthStateChanged(
    auth,
    async (user) => {
      if (!user) {
        loginForm?.classList.remove(
          "hidden"
        );


        adminPanel?.classList.add(
          "hidden"
        );


        setAdminStatus(
          "Signed out."
        );


        return;
      }


      loginForm?.classList.add(
        "hidden"
      );


      adminPanel?.classList.remove(
        "hidden"
      );


      setAdminStatus(
        `Signed in as ${user.email}`
      );


      await loadAdminPosts();
    }
  );
}