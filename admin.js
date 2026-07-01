import { auth, db, storage, firebaseConfigured } from "./firebase-config.js";
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
import {
  getDownloadURL,
  ref,
  uploadBytes
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

const loginForm = document.getElementById("loginForm");
const adminPanel = document.getElementById("adminPanel");
const adminStatus = document.getElementById("adminStatus");
const signOutButton = document.getElementById("signOutButton");
const postForm = document.getElementById("postForm");
const postTitle = document.getElementById("postTitle");
const postCaption = document.getElementById("postCaption");
const postImageUrl = document.getElementById("postImageUrl");
const postImageFile = document.getElementById("postImageFile");
const guestSeedInput = document.getElementById("guestSeedInput");
const seedGuestsButton = document.getElementById("seedGuestsButton");
const loadRsvpsButton = document.getElementById("loadRsvpsButton");
const rsvpResults = document.getElementById("rsvpResults");
const adminPosts = document.getElementById("adminPosts");
const toast = document.getElementById("toast");
const guestCsvFile = document.getElementById("guestCsvFile");
const importGuestCsvButton = document.getElementById("importGuestCsvButton");

function showToast(text) {
  if (!toast) return;

  toast.textContent = text;
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

function parseCsvLine(line) {
  const result = [];
  let current = "";
  let insideQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"' && insideQuotes && nextChar === '"') {
      current += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      insideQuotes = !insideQuotes;
      continue;
    }

    if (char === "," && !insideQuotes) {
      result.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  result.push(current.trim());
  return result;
}

function parseCsv(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    throw new Error("CSV must include a header row and at least one guest row.");
  }

  const headers = parseCsvLine(lines[0]).map((header) => {
    return header.trim().toLowerCase();
  });

  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row = {};

    headers.forEach((header, index) => {
      row[header] = values[index] || "";
    });

    return row;
  });
}

function buildHouseholdsFromCsvRows(rows) {
  const households = new Map();

  rows.forEach((row) => {
    const householdName = row.householdname?.trim();
    const firstName = row.firstname?.trim();
    const lastName = row.lastname?.trim();
    const maxAttendeesRaw = row.maxattendees?.trim();

    if (!firstName || !lastName) {
      throw new Error("Each row must include firstName and lastName.");
    }

    const fullName = `${firstName} ${lastName}`.trim();
    const resolvedHouseholdName = householdName || fullName;

    if (!households.has(resolvedHouseholdName)) {
      households.set(resolvedHouseholdName, {
        householdName: resolvedHouseholdName,
        guestNames: [],
        maxAttendees: 0
      });
    }

    const household = households.get(resolvedHouseholdName);

    household.guestNames.push(fullName);

    const parsedMax = Number(maxAttendeesRaw);

    if (Number.isFinite(parsedMax) && parsedMax > household.maxAttendees) {
      household.maxAttendees = parsedMax;
    }
  });

  return Array.from(households.values()).map((household) => {
    return {
      ...household,
      maxAttendees: household.maxAttendees || household.guestNames.length
    };
  });
}

async function readSelectedCsvFile() {
  const file = guestCsvFile.files?.[0];

  if (!file) {
    throw new Error("Choose a CSV file first.");
  }

  return await file.text();
}

async function importGuestCsv() {
  const csvText = await readSelectedCsvFile();
  const rows = parseCsv(csvText);
  const households = buildHouseholdsFromCsvRows(rows);

  if (households.length === 0) {
    throw new Error("No households found in CSV.");
  }

  const batch = writeBatch(db);

  households.forEach((household) => {
    const inviteId = generateInviteId();

    batch.set(doc(db, "invites", inviteId), {
      householdName: household.householdName,
      guestNames: household.guestNames,
      maxAttendees: household.maxAttendees,
      createdAt: serverTimestamp(),
      rsvp: {
        submitted: false,
        attending: false,
        attendeeNames: [],
        dietaryNotes: "",
        songRequest: "",
        mailingAddress: "",
        message: ""
      }
    });

    household.guestNames.forEach((guestName) => {
      const lookupId = normalizeName(guestName);

      batch.set(doc(db, "guestLookups", lookupId), {
        inviteId,
        householdName: household.householdName,
        matchedName: guestName
      });
    });
  });

  await batch.commit();

  guestCsvFile.value = "";
  showToast(`Imported ${households.length} household${households.length === 1 ? "" : "s"}.`);
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

function generateInviteId() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "";

  for (let i = 0; i < 12; i += 1) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }

  return result;
}

function parseGuestSeed(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [householdNameRaw, guestNamesRaw, maxAttendeesRaw] = line
        .split("|")
        .map((part) => part.trim());

      const guestNames = String(guestNamesRaw || "")
        .split(";")
        .map((name) => name.trim())
        .filter(Boolean);

      const maxAttendees = Number(maxAttendeesRaw || guestNames.length || 1);

      if (!householdNameRaw || guestNames.length === 0 || !Number.isFinite(maxAttendees)) {
        throw new Error(`Invalid guest line: ${line}`);
      }

      return {
        householdName: householdNameRaw,
        guestNames,
        maxAttendees
      };
    });
}

async function uploadPostImageIfNeeded() {
  const file = postImageFile.files?.[0];

  if (!file) {
    return postImageUrl.value.trim();
  }

  if (!storage) {
    throw new Error("Firebase Storage is not configured.");
  }

  const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
  const storageRef = ref(storage, `post-images/${Date.now()}-${safeFileName}`);

  await uploadBytes(storageRef, file);
  return await getDownloadURL(storageRef);
}

async function createPost(event) {
  event.preventDefault();

  const title = postTitle.value.trim();
  const caption = postCaption.value.trim();

  if (!title || !caption) {
    showToast("Title and caption are required.");
    return;
  }

  try {
    const imageUrl = await uploadPostImageIfNeeded();
    const postRef = doc(collection(db, "posts"));

    await setDoc(postRef, {
      title,
      caption,
      imageUrl,
      author: "@sydneyandgrant",
      createdAt: serverTimestamp()
    });

    postForm.reset();
    showToast("Post published.");
    await loadAdminPosts();
  } catch (error) {
    console.error(error);
    showToast("Could not publish post.");
  }
}

async function seedGuests() {
  const rows = parseGuestSeed(guestSeedInput.value);

  if (rows.length === 0) {
    showToast("Add at least one guest line.");
    return;
  }

  const batch = writeBatch(db);

  rows.forEach((row) => {
    const inviteId = generateInviteId();

    batch.set(doc(db, "invites", inviteId), {
      householdName: row.householdName,
      guestNames: row.guestNames,
      maxAttendees: row.maxAttendees,
      createdAt: serverTimestamp(),
      rsvp: {
        submitted: false,
        attending: false,
        attendeeNames: [],
        dietaryNotes: "",
        songRequest: "",
        mailingAddress: "",
        message: ""
      }
    });

    row.guestNames.forEach((guestName) => {
      const lookupId = normalizeName(guestName);

      batch.set(doc(db, "guestLookups", lookupId), {
        inviteId,
        householdName: row.householdName,
        matchedName: guestName
      });
    });
  });

  await batch.commit();

  guestSeedInput.value = "";
  showToast(`Created ${rows.length} invite${rows.length === 1 ? "" : "s"}.`);
}

async function loadRsvps() {
  const snapshot = await getDocs(query(collection(db, "invites"), orderBy("householdName")));

  rsvpResults.innerHTML = snapshot.docs
    .map((inviteDoc) => {
      const invite = inviteDoc.data();
      const rsvp = invite.rsvp || {};
      const attendingText = rsvp.submitted
        ? rsvp.attending ? "Attending" : "Declined"
        : "Not submitted";

      return `
        <div class="result-card">
          <h3>${escapeHtml(invite.householdName)}</h3>
          <p><strong>Status:</strong> ${escapeHtml(attendingText)}</p>
          <p><strong>Guests:</strong> ${escapeHtml((rsvp.attendeeNames || []).join(", ") || "—")}</p>
          <p><strong>Address:</strong> ${escapeHtml(rsvp.mailingAddress || "—")}</p>
          <p><strong>Dietary:</strong> ${escapeHtml(rsvp.dietaryNotes || "—")}</p>
          <p><strong>Song:</strong> ${escapeHtml(rsvp.songRequest || "—")}</p>
          <p><strong>Message:</strong> ${escapeHtml(rsvp.message || "—")}</p>
          <p><strong>Invite ID:</strong> ${escapeHtml(inviteDoc.id)}</p>
        </div>
      `;
    })
    .join("");
}

async function loadAdminPosts() {
  const snapshot = await getDocs(query(collection(db, "posts"), orderBy("createdAt", "desc")));

  adminPosts.innerHTML = snapshot.docs
    .map((postDoc) => {
      const post = postDoc.data();

      return `
        <div class="result-card">
          <h3>${escapeHtml(post.title)}</h3>
          <p>${escapeHtml(post.caption)}</p>
          ${post.imageUrl ? `<p><a href="${escapeHtml(post.imageUrl)}" target="_blank" rel="noopener">Image</a></p>` : ""}
          <button type="button" class="secondary-admin-button delete-post-button" data-post-id="${postDoc.id}">
            Delete
          </button>
        </div>
      `;
    })
    .join("");

  document.querySelectorAll(".delete-post-button").forEach((button) => {
    button.addEventListener("click", async () => {
      const postId = button.dataset.postId;

      if (!window.confirm("Delete this post?")) return;

      await deleteDoc(doc(db, "posts", postId));
      showToast("Post deleted.");
      await loadAdminPosts();
    });
  });
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!firebaseConfigured) {
    showToast("Firebase config is still using placeholder values.");
    return;
  }

  const email = document.getElementById("adminEmail").value.trim();
  const password = document.getElementById("adminPassword").value;

  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    console.error(error);
    showToast("Sign-in failed.");
  }
});

signOutButton.addEventListener("click", async () => {
  await signOut(auth);
});

postForm.addEventListener("submit", createPost);

seedGuestsButton.addEventListener("click", async () => {
  try {
    await seedGuests();
  } catch (error) {
    console.error(error);
    showToast(error.message || "Could not seed guests.");
  }
});

loadRsvpsButton.addEventListener("click", async () => {
  try {
    await loadRsvps();
  } catch (error) {
    console.error(error);
    showToast("Could not load RSVPs.");
  }
});

if (importGuestCsvButton) {
  importGuestCsvButton.addEventListener("click", async () => {
    try {
      await importGuestCsv();
    } catch (error) {
      console.error(error);
      showToast(error.message || "Could not import guest CSV.");
    }
  });
}

if (firebaseConfigured && auth) {
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      loginForm.classList.add("hidden");
      adminPanel.classList.remove("hidden");
      adminStatus.textContent = `Signed in as ${user.email}`;
      await loadAdminPosts();
    } else {
      loginForm.classList.remove("hidden");
      adminPanel.classList.add("hidden");
      adminStatus.textContent = "";
    }
  });
}