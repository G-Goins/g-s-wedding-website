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

const loginForm = document.getElementById("loginForm");
const adminPanel = document.getElementById("adminPanel");
const adminStatus = document.getElementById("adminStatus");
const signOutButton = document.getElementById("signOutButton");

const adminEmail = document.getElementById("adminEmail");
const adminPassword = document.getElementById("adminPassword");

const postForm = document.getElementById("postForm");
const postTitle = document.getElementById("postTitle");
const postCaption = document.getElementById("postCaption");
const postImageUrl = document.getElementById("postImageUrl");
const adminPosts = document.getElementById("adminPosts");

const guestCsvFile = document.getElementById("guestCsvFile");
const importGuestCsvButton = document.getElementById("importGuestCsvButton");

const toast = document.getElementById("toast");

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
    adminStatus.textContent = message;
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

  const headers = parseCsvLine(lines[0]).map((header) =>
    header.trim().toLowerCase()
  );

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

  return Array.from(households.values()).map((household) => ({
    ...household,
    maxAttendees: household.maxAttendees || household.guestNames.length
  }));
}

async function importGuestCsv() {
  if (!guestCsvFile) {
    throw new Error("Guest CSV input is missing from admin.html.");
  }

  const file = guestCsvFile.files?.[0];

  if (!file) {
    throw new Error("Choose a CSV file first.");
  }

  if (!db) {
    throw new Error("Firebase database is not configured.");
  }

  const csvText = await file.text();
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

async function createPost(event) {
  event.preventDefault();

  const title = postTitle?.value.trim();
  const caption = postCaption?.value.trim();
  const imageUrl = postImageUrl?.value.trim() || "";

  if (!title || !caption) {
    showToast("Post title and caption are required.");
    return;
  }

  try {
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
    showToast(`Could not publish post: ${error.code || error.message}`);
  }
}

async function loadAdminPosts() {
  if (!adminPosts) return;

  try {
    const snapshot = await getDocs(query(collection(db, "posts"), orderBy("createdAt", "desc")));

    if (snapshot.empty) {
      adminPosts.innerHTML = `<p>No posts yet.</p>`;
      return;
    }

    adminPosts.innerHTML = snapshot.docs
      .map((postDoc) => {
        const post = postDoc.data();

        return `
          <div class="result-card">
            <h3>${escapeHtml(post.title)}</h3>
            <p>${escapeHtml(post.caption)}</p>
            ${
              post.imageUrl
                ? `<p><strong>Image:</strong> ${escapeHtml(post.imageUrl)}</p>`
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
      })
      .join("");

    document.querySelectorAll(".delete-post-button").forEach((button) => {
      button.addEventListener("click", async () => {
        const postId = button.dataset.postId;

        if (!window.confirm("Delete this post?")) return;

        try {
          await deleteDoc(doc(db, "posts", postId));
          showToast("Post deleted.");
          await loadAdminPosts();
        } catch (error) {
          console.error(error);
          showToast(`Could not delete post: ${error.code || error.message}`);
        }
      });
    });
  } catch (error) {
    console.error(error);
    showToast(`Could not load posts: ${error.code || error.message}`);
  }
}

if (!firebaseConfigured) {
  setAdminStatus("Firebase config is still using placeholder values in firebase-config.js.");
}

if (loginForm) {
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!firebaseConfigured || !auth) {
      showToast("Firebase is not configured.");
      return;
    }

    const email = adminEmail?.value.trim();
    const password = adminPassword?.value;

    if (!email || !password) {
      showToast("Enter email and password.");
      return;
    }

    try {
      setAdminStatus("Signing in...");
      await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
      console.error(error);

      const messageByCode = {
        "auth/invalid-credential": "Invalid email or password.",
        "auth/user-not-found": "No Firebase Auth user exists for this email.",
        "auth/wrong-password": "Incorrect password.",
        "auth/operation-not-allowed": "Email/Password sign-in is not enabled in Firebase Authentication.",
        "auth/unauthorized-domain": "This domain is not authorized in Firebase Authentication settings."
      };

      showToast(messageByCode[error.code] || `Sign-in failed: ${error.code || error.message}`);
      setAdminStatus(messageByCode[error.code] || `Sign-in failed: ${error.code || error.message}`);
    }
  });
}

if (signOutButton) {
  signOutButton.addEventListener("click", async () => {
    await signOut(auth);
  });
}

if (postForm) {
  postForm.addEventListener("submit", createPost);
}

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
    if (!user) {
      loginForm?.classList.remove("hidden");
      adminPanel?.classList.add("hidden");
      setAdminStatus("Signed out.");
      return;
    }

    loginForm?.classList.add("hidden");
    adminPanel?.classList.remove("hidden");
    setAdminStatus(`Signed in as ${user.email}`);

    await loadAdminPosts();
  });
}