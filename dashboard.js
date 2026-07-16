// Dashboard Controller for ResumeMkr
import { initAuthProtection, logoutUser } from "./auth.js";
import { 
  db, 
  handleFirestoreError, 
  OperationType,
  collection, 
  query, 
  where, 
  getDocs, 
  doc, 
  setDoc, 
  deleteDoc, 
  updateDoc 
} from "./firebase.js";
import { DEFAULT_RESUME_DATA } from "./templates.js";

// Global states
let currentUser = null;
let resumesList = [];
let availableTags = new Set();

// Modal element anchors
const createModal = document.getElementById("create-modal");
const renameModal = document.getElementById("rename-modal");
const deleteModal = document.getElementById("delete-modal");
const createForm = document.getElementById("create-resume-form");
const renameForm = document.getElementById("rename-resume-form");

// DOM anchors
const navUserName = document.getElementById("nav-user-name");
const navUserPhoto = document.getElementById("nav-user-photo");
const welcomeUserName = document.getElementById("welcome-user-name");
const statResumesCount = document.getElementById("stat-resumes-count");
const statFavoritesCount = document.getElementById("stat-favorites-count");
const statLastEdited = document.getElementById("stat-last-edited");

const searchInput = document.getElementById("search-input");
const tagFilter = document.getElementById("tag-filter");
const favoriteFilter = document.getElementById("favorite-filter");

const resumesSkeleton = document.getElementById("resumes-skeleton");
const noResumesContainer = document.getElementById("no-resumes-container");
const resumesGrid = document.getElementById("resumes-grid");

// Initialize page
document.addEventListener("DOMContentLoaded", async () => {
  // Guard route
  currentUser = await initAuthProtection(true, "login.html");
  if (!currentUser) return;

  // Sync profile UI
  navUserName.textContent = currentUser.displayName || "User";
  welcomeUserName.textContent = currentUser.displayName || "User";
  if (currentUser.photoURL) {
    navUserPhoto.src = currentUser.photoURL;
  }

  // Load resumes
  await fetchResumes();

  // Listeners
  document.getElementById("create-resume-btn").addEventListener("click", () => showModal(createModal));
  document.getElementById("no-resumes-create-btn").addEventListener("click", () => showModal(createModal));
  document.getElementById("logout-btn").addEventListener("click", logoutUser);

  document.querySelectorAll(".modal-close").forEach(btn => {
    btn.addEventListener("click", () => {
      hideModal(createModal);
      hideModal(renameModal);
      hideModal(deleteModal);
    });
  });

  const deleteCancelBtn = document.getElementById("delete-cancel-btn");
  if (deleteCancelBtn) {
    deleteCancelBtn.addEventListener("click", () => {
      hideModal(deleteModal);
    });
  }

  const deleteConfirmBtn = document.getElementById("delete-confirm-btn");
  if (deleteConfirmBtn) {
    deleteConfirmBtn.addEventListener("click", async () => {
      const id = document.getElementById("delete-target-id").value;
      if (id) {
        try {
          await deleteDoc(doc(db, "resumes", id));
          hideModal(deleteModal);
          await fetchResumes();
        } catch (err) {
          alert("Could not delete resume.");
          console.error(err);
        }
      }
    });
  }

  createForm.addEventListener("submit", handleCreateResume);
  renameForm.addEventListener("submit", handleRenameResume);

  searchInput.addEventListener("input", filterAndRenderResumes);
  tagFilter.addEventListener("change", filterAndRenderResumes);
  favoriteFilter.addEventListener("change", filterAndRenderResumes);
});

// Fetch user resumes from Firestore
async function fetchResumes() {
  const collectionName = "resumes";
  try {
    const q = query(collection(db, collectionName), where("userId", "==", currentUser.uid));
    const snapshot = await getDocs(q);
    
    resumesList = [];
    availableTags.clear();

    snapshot.forEach(docSnap => {
      const data = docSnap.data();
      resumesList.push({ id: docSnap.id, ...data });
      if (data.tags && Array.isArray(data.tags)) {
        data.tags.forEach(t => availableTags.add(t));
      }
    });

    // Update tags filter dropdown
    tagFilter.innerHTML = `<option value="">All Tags</option>`;
    availableTags.forEach(tag => {
      tagFilter.innerHTML += `<option value="${tag}">${tag}</option>`;
    });

    updateDashboardStats();
    filterAndRenderResumes();
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, collectionName);
  }
}

// Update counters
function updateDashboardStats() {
  statResumesCount.textContent = resumesList.length;
  const favCount = resumesList.filter(r => r.isFavorite).length;
  statFavoritesCount.textContent = favCount;

  if (resumesList.length > 0) {
    // Sort to get latest
    const sorted = [...resumesList].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    const latestDate = new Date(sorted[0].updatedAt);
    statLastEdited.textContent = latestDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } else {
    statLastEdited.textContent = "Never";
  }
}

// Filter and render
function filterAndRenderResumes() {
  const queryText = searchInput.value.toLowerCase().trim();
  const selectedTag = tagFilter.value;
  const isFavoriteOnly = favoriteFilter.value === "favorites";

  const filtered = resumesList.filter(res => {
    const matchesQuery = res.name.toLowerCase().includes(queryText) || 
                         (res.notes && res.notes.toLowerCase().includes(queryText)) ||
                         (res.personalInfo?.jobTitle && res.personalInfo.jobTitle.toLowerCase().includes(queryText));
    const matchesTag = !selectedTag || (res.tags && res.tags.includes(selectedTag));
    const matchesFav = !isFavoriteOnly || res.isFavorite;

    return matchesQuery && matchesTag && matchesFav;
  });

  resumesSkeleton.classList.add("hidden");

  if (filtered.length === 0) {
    resumesGrid.classList.add("hidden");
    noResumesContainer.classList.remove("hidden");
  } else {
    noResumesContainer.classList.add("hidden");
    resumesGrid.classList.remove("hidden");
    
    // Sort latest first
    filtered.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    resumesGrid.innerHTML = filtered.map(res => {
      const formattedDate = new Date(res.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const favoriteColor = res.isFavorite ? 'text-amber-500 fill-amber-500' : 'text-slate-300 hover:text-slate-400';
      
      const tagsBadges = (res.tags || []).map(t => 
        `<span class="px-2 py-0.5 bg-indigo-50 text-indigo-600 text-[10px] font-bold rounded-md uppercase tracking-wider">${t}</span>`
      ).join(" ");

      return `
        <div class="resume-card group flex flex-col justify-between" id="card-${res.id}">
          <div class="space-y-3">
            <div class="flex items-start justify-between">
              <h3 class="font-bold text-slate-800 text-base line-clamp-1 group-hover:text-indigo-600 transition-all">${res.name}</h3>
              <button class="toggle-fav-btn p-1 cursor-pointer" data-id="${res.id}">
                <i data-lucide="star" class="w-5 h-5 ${favoriteColor}"></i>
              </button>
            </div>
            
            <div class="flex flex-wrap gap-1.5">${tagsBadges}</div>
            
            <p class="text-xs text-slate-500 line-clamp-2">${res.personalInfo?.jobTitle || 'No Title'} | ${res.personalInfo?.email || 'No email'}</p>
          </div>

          <div class="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between">
            <span class="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Edited ${formattedDate}</span>
            <div class="flex items-center gap-1">
              <a href="builder.html?id=${res.id}" class="quick-action-btn" title="Continue Editing">
                <i data-lucide="edit-3" class="w-4 h-4"></i>
              </a>
              <button class="quick-action-btn duplicate-btn" data-id="${res.id}" title="Duplicate">
                <i data-lucide="copy" class="w-4 h-4"></i>
              </button>
              <button class="quick-action-btn rename-btn" data-id="${res.id}" data-name="${res.name}" title="Rename">
                <i data-lucide="pencil" class="w-4 h-4"></i>
              </button>
              <button class="quick-action-btn delete-btn text-rose-500 hover:text-rose-700" data-id="${res.id}" title="Delete">
                <i data-lucide="trash-2" class="w-4 h-4"></i>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join("");

    // Reinitialize icons inside the grid
    lucide.createIcons();
    registerCardActionListeners();
  }
}

// Bind clicks inside dynamically-rendered resume cards
function registerCardActionListeners() {
  document.querySelectorAll(".toggle-fav-btn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const id = btn.getAttribute("data-id");
      const res = resumesList.find(r => r.id === id);
      if (res) {
        res.isFavorite = !res.isFavorite;
        await updateDoc(doc(db, "resumes", id), { isFavorite: res.isFavorite });
        updateDashboardStats();
        filterAndRenderResumes();
      }
    });
  });

  document.querySelectorAll(".duplicate-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      const target = resumesList.find(r => r.id === id);
      if (target) {
        const copyName = `Copy of ${target.name}`;
        const newId = "res_" + Math.random().toString(36).substring(2, 11);
        const duplicatePayload = {
          ...target,
          resumeId: newId,
          name: copyName,
          isFavorite: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        delete duplicatePayload.id; // remove local ID key

        await setDoc(doc(db, "resumes", newId), duplicatePayload);
        await fetchResumes();
      }
    });
  });

  document.querySelectorAll(".rename-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      const name = btn.getAttribute("data-name");
      document.getElementById("rename-target-id").value = id;
      document.getElementById("rename-resume-name").value = name;
      showModal(renameModal);
    });
  });

  document.querySelectorAll(".delete-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      document.getElementById("delete-target-id").value = id;
      showModal(deleteModal);
    });
  });
}

// Handle creations
async function handleCreateResume(e) {
  e.preventDefault();
  const name = document.getElementById("new-resume-name").value;
  const templateId = document.getElementById("new-resume-template").value;

  const newId = "res_" + Math.random().toString(36).substring(2, 11);
  const newResume = {
    ...DEFAULT_RESUME_DATA,
    resumeId: newId,
    userId: currentUser.uid,
    name: name,
    templateId: templateId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  try {
    await setDoc(doc(db, "resumes", newId), newResume);
    window.location.href = `builder.html?id=${newId}`;
  } catch (err) {
    alert("Could not create resume. Please try again.");
    console.error(err);
  }
}

// Handle Renames
async function handleRenameResume(e) {
  e.preventDefault();
  const id = document.getElementById("rename-target-id").value;
  const newName = document.getElementById("rename-resume-name").value;

  try {
    await updateDoc(doc(db, "resumes", id), { name: newName, updatedAt: new Date().toISOString() });
    hideModal(renameModal);
    await fetchResumes();
  } catch (err) {
    alert("Could not rename resume.");
    console.error(err);
  }
}

// Modals Helpers
function showModal(el) {
  el.classList.remove("hidden");
}
function hideModal(el) {
  el.classList.add("hidden");
}
