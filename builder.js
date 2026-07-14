// Resume Builder Editor Engine for ResumeMkr
import { initAuthProtection } from "./auth.js";
import { db, handleFirestoreError, OperationType } from "./firebase.js";
import { TEMPLATES, DEFAULT_RESUME_DATA } from "./templates.js";
import { AutoSaveService } from "./autosave.js";
import { downloadPDF, downloadWord, downloadJSON } from "./export.js";
import { doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// State
let currentUser = null;
let resumeId = null;
let resumeData = null;
let autosaveService = null;
let currentZoom = 100;
let historyStack = [];
let redoStack = [];

// DOM References
const activeTemplateSelector = document.getElementById("active-template-selector");
const resumeTitle = document.getElementById("resume-title");
const syncStatus = document.getElementById("sync-status");
const zoomSlider = document.getElementById("zoom-slider");
const zoomLabel = document.getElementById("zoom-label");
const zoomContainer = document.getElementById("zoom-container");
const a4Preview = document.getElementById("resume-a4-preview");
const scorePct = document.getElementById("resume-score-pct");
const scoreComplete = document.getElementById("score-complete");
const scoreAts = document.getElementById("score-ats");
const scoreTip = document.getElementById("score-tip");
const strengthBadge = document.getElementById("resume-strength-badge");

// Initialize builder
document.addEventListener("DOMContentLoaded", async () => {
  currentUser = await initAuthProtection(true, "login.html");
  if (!currentUser) return;

  // Retrieve resume ID from URL parameters
  const params = new URLSearchParams(window.location.search);
  resumeId = params.get("id");

  if (!resumeId) {
    alert("No Resume ID provided. Returning to dashboard.");
    window.location.href = "dashboard.html";
    return;
  }

  await loadResume();

  // Keyboard Shortcuts Setup
  document.addEventListener("keydown", handleKeyboardShortcuts);

  // Setup Actions dropdown
  const dropdownBtn = document.getElementById("export-dropdown-btn");
  const exportMenu = document.getElementById("export-menu");
  dropdownBtn.addEventListener("click", () => exportMenu.classList.toggle("hidden"));
  document.addEventListener("click", (e) => {
    if (!dropdownBtn.contains(e.target) && !exportMenu.contains(e.target)) {
      exportMenu.classList.add("hidden");
    }
  });

  // Setup Zoom sliders
  zoomSlider.addEventListener("input", (e) => applyZoom(parseInt(e.target.value)));
  document.getElementById("zoom-in-btn").addEventListener("click", () => applyZoom(currentZoom + 10));
  document.getElementById("zoom-out-btn").addEventListener("click", () => applyZoom(currentZoom - 10));
  document.getElementById("fit-zoom-btn").addEventListener("click", fitZoomToPane);

  // Setup Workspace theme toggle
  document.getElementById("builder-theme-toggle").addEventListener("click", toggleWorkspaceTheme);

  // Setup Rename modals
  const titleModal = document.getElementById("rename-title-modal");
  document.getElementById("rename-title-btn").addEventListener("click", () => {
    document.getElementById("modal-resume-name").value = resumeData.name;
    titleModal.classList.remove("hidden");
  });
  document.querySelectorAll(".title-modal-close").forEach(btn => {
    btn.addEventListener("click", () => titleModal.classList.add("hidden"));
  });
  document.getElementById("rename-title-form").addEventListener("submit", handleRenameTitle);

  // Expose export triggers
  document.getElementById("export-pdf-btn").addEventListener("click", () => {
    syncFormToData();
    downloadPDF("resume-a4-preview", `${resumeData.name}.pdf`);
  });
  document.getElementById("export-word-btn").addEventListener("click", () => {
    syncFormToData();
    downloadWord(resumeData, `${resumeData.name}.docx`);
  });
  document.getElementById("export-json-btn").addEventListener("click", () => {
    syncFormToData();
    downloadJSON(resumeData, `${resumeData.name}_backup.json`);
  });
  document.getElementById("print-btn").addEventListener("click", () => {
    syncFormToData();
    window.print();
  });

  // Fill in active style choices
  populateTemplatesSelector();
});

// Load Resume from Firestore
async function loadResume() {
  const collectionName = "resumes";
  try {
    const docSnap = await getDoc(doc(db, "resumes", resumeId));
    if (!docSnap.exists()) {
      alert("Resume not found.");
      window.location.href = "dashboard.html";
      return;
    }

    resumeData = docSnap.data();
    resumeTitle.textContent = resumeData.name;

    // Initialize autosave
    autosaveService = new AutoSaveService(resumeId, currentUser.uid, handleAutosaveStateChange);

    // Initial fill and preview render
    syncDataToForm();
    registerFormInputs();
    renderLivePreview();
    calculateResumeScore();
    fitZoomToPane();
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `${collectionName}/${resumeId}`);
  }
}

// Populate Selector with 30 items
function populateTemplatesSelector() {
  activeTemplateSelector.innerHTML = TEMPLATES.map(t => 
    `<option value="${t.id}">${t.name} (${t.category})</option>`
  ).join("");

  activeTemplateSelector.addEventListener("change", (e) => {
    resumeData.templateId = e.target.value;
    
    // Auto sync layout parameters matching chosen template configs
    const match = TEMPLATES.find(t => t.id === e.target.value);
    if (match) {
      resumeData.themeSettings.fontFamily = match.font;
      resumeData.themeSettings.primaryColor = match.primaryColor;
      resumeData.themeSettings.secondaryColor = match.secondaryColor;
      resumeData.themeSettings.showIcons = match.showIcons;
      resumeData.themeSettings.showLines = match.showLines;
      
      // Update form controls
      document.getElementById("theme-font").value = match.font;
      document.getElementById("theme-primary").value = match.primaryColor;
      document.getElementById("theme-primary-text").value = match.primaryColor;
      document.getElementById("theme-secondary").value = match.secondaryColor;
      document.getElementById("theme-secondary-text").value = match.secondaryColor;
      document.getElementById("theme-showicons").checked = match.showIcons;
      document.getElementById("theme-showlines").checked = match.showLines;
    }

    saveState();
    renderLivePreview();
  });
}

// Sync values to Form controls
function syncDataToForm() {
  // Personal Info
  document.getElementById("p-fullname").value = resumeData.personalInfo?.fullName || "";
  document.getElementById("p-title").value = resumeData.personalInfo?.jobTitle || "";
  document.getElementById("p-email").value = resumeData.personalInfo?.email || "";
  document.getElementById("p-phone").value = resumeData.personalInfo?.phone || "";
  document.getElementById("p-address").value = resumeData.personalInfo?.address || "";
  document.getElementById("p-linkedin").value = resumeData.personalInfo?.linkedin || "";
  document.getElementById("p-github").value = resumeData.personalInfo?.github || "";
  document.getElementById("p-portfolio").value = resumeData.personalInfo?.portfolio || "";
  document.getElementById("p-photourl").value = resumeData.personalInfo?.photoURL || "";

  // Summary
  document.getElementById("p-summary").value = resumeData.summary || "";
  document.getElementById("summary-char-count").textContent = `${(resumeData.summary || "").length} chars`;

  // Lists
  renderExperienceFormList();
  renderEducationFormList();
  renderProjectsFormList();
  renderSkillsTagsContainers();
  renderCertificationsFormList();
  renderAchievementsFormList();
  renderCustomSectionsFormList();
  renderSectionReorderList();

  // Design Theme settings
  const theme = resumeData.themeSettings || {};
  document.getElementById("theme-font").value = theme.fontFamily || "Inter";
  document.getElementById("theme-pagesize").value = theme.pageSize || "A4";
  document.getElementById("theme-header-align").value = theme.headerAlign || "left";
  document.getElementById("theme-primary").value = theme.primaryColor || "#0f172a";
  document.getElementById("theme-primary-text").value = theme.primaryColor || "#0f172a";
  document.getElementById("theme-secondary").value = theme.secondaryColor || "#475569";
  document.getElementById("theme-secondary-text").value = theme.secondaryColor || "#475569";
  document.getElementById("theme-fontsize").value = parseInt(theme.fontSize || 14);
  document.getElementById("val-font-size").textContent = theme.fontSize || "14px";
  document.getElementById("theme-lineheight").value = parseFloat(theme.lineHeight || 1.5);
  document.getElementById("val-line-height").textContent = theme.lineHeight || "1.5";
  document.getElementById("theme-margins").value = parseInt(theme.margins || 20);
  document.getElementById("val-margins").textContent = theme.margins || "20px";
  document.getElementById("theme-showphoto").checked = theme.showPhoto !== false;
  document.getElementById("theme-showicons").checked = theme.showIcons !== false;
  document.getElementById("theme-showlines").checked = theme.showLines !== false;

  activeTemplateSelector.value = resumeData.templateId || "modern_ats";
}

// Bind live changes
function registerFormInputs() {
  const form = document.getElementById("resume-builder-form");
  
  form.addEventListener("input", (e) => {
    const id = e.target.id;
    const val = e.target.value;

    // Direct personal mappings
    if (id.startsWith("p-")) {
      const prop = id.substring(2);
      if (prop === "summary") {
        resumeData.summary = val;
        document.getElementById("summary-char-count").textContent = `${val.length} chars`;
      } else {
        if (!resumeData.personalInfo) resumeData.personalInfo = {};
        if (prop === "fullname") {
          resumeData.personalInfo.fullName = val;
        } else if (prop === "title") {
          resumeData.personalInfo.jobTitle = val;
        } else if (prop === "photourl") {
          resumeData.personalInfo.photoURL = val;
        } else {
          resumeData.personalInfo[prop] = val;
        }
      }
    }

    // Direct design theme mappings
    if (id.startsWith("theme-")) {
      const prop = id.substring(6);
      if (!resumeData.themeSettings) resumeData.themeSettings = {};

      if (prop === "primary" || prop === "secondary") {
        resumeData.themeSettings[`${prop}Color`] = val;
        document.getElementById(`theme-${prop}-text`).value = val;
      } else if (prop === "primary-text" || prop === "secondary-text") {
        const rawHex = val.startsWith("#") ? val : `#${val}`;
        if (/^#[0-9A-F]{6}$/i.test(rawHex)) {
          const cleanProp = prop.split("-")[0];
          resumeData.themeSettings[`${cleanProp}Color`] = rawHex;
          document.getElementById(`theme-${cleanProp}`).value = rawHex;
        }
      } else if (prop === "font") {
        resumeData.themeSettings.fontFamily = val;
      } else if (prop === "header-align") {
        resumeData.themeSettings.headerAlign = val;
      } else if (prop === "fontsize") {
        resumeData.themeSettings.fontSize = `${val}px`;
        document.getElementById("val-font-size").textContent = `${val}px`;
      } else if (prop === "lineheight") {
        resumeData.themeSettings.lineHeight = val;
        document.getElementById("val-line-height").textContent = val;
      } else if (prop === "margins") {
        resumeData.themeSettings.margins = `${val}px`;
        document.getElementById("val-margins").textContent = `${val}px`;
      } else if (prop === "showphoto" || prop === "showicons" || prop === "showlines") {
        const key = "show" + prop.substring(4).charAt(0).toUpperCase() + prop.substring(5);
        resumeData.themeSettings[key] = e.target.checked;
      } else {
        resumeData.themeSettings[prop] = val;
      }
    }

    saveState();
    renderLivePreview();
    calculateResumeScore();
  });

  // Dynamic Suggestion lists matching guidelines
  const techInput = document.getElementById("tech-skills-input");
  techInput.addEventListener("input", handleTechSuggestions);
  techInput.addEventListener("keydown", handleTechTagsAdd);
}

// AI suggestions list
const AI_PRESET_SUGGESTIONS = {
  "sql": ["SQL Server", "MySQL", "PostgreSQL", "Oracle", "SQLite", "NoSQL"],
  "power bi": ["DAX", "Power Query", "Data modeling", "Interactive dashboards", "BI Analytics"],
  "python": ["Pandas", "NumPy", "Matplotlib", "SciPy", "Django", "FastAPI"],
  "javascript": ["TypeScript", "React", "Node.js", "Express", "Vite", "ESNext"],
  "led": ["Led design systems", "Led a team of engineers", "Led cross-functional squads"],
  "designed": ["Designed cloud architectures", "Designed RESTful APIs", "Designed responsive interfaces"]
};

function handleTechSuggestions(e) {
  const text = e.target.value.toLowerCase().trim();
  const suggestionsBox = document.getElementById("tech-suggestions");

  if (!text) {
    suggestionsBox.classList.add("hidden");
    return;
  }

  // Find matches
  let matches = [];
  Object.keys(AI_PRESET_SUGGESTIONS).forEach(key => {
    if (key.includes(text) || text.includes(key)) {
      matches = [...matches, ...AI_PRESET_SUGGESTIONS[key]];
    }
  });

  if (matches.length > 0) {
    suggestionsBox.innerHTML = Array.from(new Set(matches)).map(m => 
      `<div class="autosuggest-item" data-val="${m}">${m}</div>`
    ).join("");
    suggestionsBox.classList.remove("hidden");

    // Click items to insert
    suggestionsBox.querySelectorAll(".autosuggest-item").forEach(item => {
      item.addEventListener("click", () => {
        const val = item.getAttribute("data-val");
        addTechTag(val);
        techInput.value = "";
        suggestionsBox.classList.add("hidden");
      });
    });
  } else {
    suggestionsBox.classList.add("hidden");
  }
}

function handleTechTagsAdd(e) {
  if (e.key === "Enter" || e.key === ",") {
    e.preventDefault();
    const val = e.target.value.replace(/,/g, "").trim();
    if (val) {
      addTechTag(val);
      e.target.value = "";
      document.getElementById("tech-suggestions").classList.add("hidden");
    }
  }
}

function addTechTag(val) {
  if (!resumeData.skills) resumeData.skills = { technical: [], soft: [], languages: [] };
  if (!resumeData.skills.technical) resumeData.skills.technical = [];
  if (!resumeData.skills.technical.includes(val)) {
    resumeData.skills.technical.push(val);
    saveState();
    renderSkillsTagsContainers();
    renderLivePreview();
  }
}

// Render dynamic Lists form components
function renderExperienceFormList() {
  const container = document.getElementById("experience-list-container");
  const list = resumeData.experience || [];

  container.innerHTML = list.map((exp, idx) => `
    <div class="p-4 border border-slate-200 rounded-xl bg-white space-y-3 relative" data-idx="${idx}">
      <button type="button" class="remove-exp-btn absolute top-3 right-3 text-slate-300 hover:text-rose-500 p-1 rounded hover:bg-slate-50 cursor-pointer" data-idx="${idx}">
        <i data-lucide="trash-2" class="w-4 h-4"></i>
      </button>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Company</label>
          <input type="text" class="exp-company w-full px-3 py-2 border border-slate-200 rounded-lg text-xs" value="${exp.company || ""}">
        </div>
        <div>
          <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Role</label>
          <input type="text" class="exp-role w-full px-3 py-2 border border-slate-200 rounded-lg text-xs" value="${exp.role || ""}">
        </div>
        <div>
          <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Start Date</label>
          <input type="text" class="exp-start w-full px-3 py-2 border border-slate-200 rounded-lg text-xs" placeholder="e.g. 2022-08" value="${exp.startDate || ""}">
        </div>
        <div>
          <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">End Date</label>
          <input type="text" class="exp-end w-full px-3 py-2 border border-slate-200 rounded-lg text-xs" placeholder="e.g. Present" value="${exp.endDate || ""}">
        </div>
        <div class="col-span-2">
          <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Description</label>
          <textarea class="exp-desc w-full px-3 py-2 border border-slate-200 rounded-lg text-xs leading-relaxed" rows="3">${exp.description || ""}</textarea>
        </div>
      </div>
    </div>
  `).join("");

  lucide.createIcons();
  bindExperienceInputs();
}

function bindExperienceInputs() {
  const container = document.getElementById("experience-list-container");
  
  container.querySelectorAll(".remove-exp-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.getAttribute("data-idx"));
      resumeData.experience.splice(idx, 1);
      saveState();
      renderExperienceFormList();
      renderLivePreview();
    });
  });

  // Bind keyup changes
  ["company", "role", "start", "end", "desc"].forEach(prop => {
    container.querySelectorAll(`.exp-${prop}`).forEach(input => {
      input.addEventListener("input", () => {
        const box = input.closest("[data-idx]");
        const idx = parseInt(box.getAttribute("data-idx"));
        const realProp = prop === "start" ? "startDate" : prop === "end" ? "endDate" : prop === "desc" ? "description" : prop;
        resumeData.experience[idx][realProp] = input.value;
        saveState();
        renderLivePreview();
      });
    });
  });
}

document.getElementById("add-experience-btn").addEventListener("click", () => {
  if (!resumeData.experience) resumeData.experience = [];
  resumeData.experience.push({ company: "", role: "", startDate: "", endDate: "", description: "" });
  saveState();
  renderExperienceFormList();
  renderLivePreview();
});

// Render Education forms
function renderEducationFormList() {
  const container = document.getElementById("education-list-container");
  const list = resumeData.education || [];

  container.innerHTML = list.map((edu, idx) => `
    <div class="p-4 border border-slate-200 rounded-xl bg-white space-y-3 relative" data-idx="${idx}">
      <button type="button" class="remove-edu-btn absolute top-3 right-3 text-slate-300 hover:text-rose-500 p-1 rounded hover:bg-slate-50 cursor-pointer" data-idx="${idx}">
        <i data-lucide="trash-2" class="w-4 h-4"></i>
      </button>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Institution</label>
          <input type="text" class="edu-inst w-full px-3 py-2 border border-slate-200 rounded-lg text-xs" value="${edu.institution || ""}">
        </div>
        <div>
          <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Degree</label>
          <input type="text" class="edu-degree w-full px-3 py-2 border border-slate-200 rounded-lg text-xs" value="${edu.degree || ""}">
        </div>
        <div>
          <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Start Date</label>
          <input type="text" class="edu-start w-full px-3 py-2 border border-slate-200 rounded-lg text-xs" value="${edu.startDate || ""}">
        </div>
        <div>
          <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">End Date</label>
          <input type="text" class="edu-end w-full px-3 py-2 border border-slate-200 rounded-lg text-xs" value="${edu.endDate || ""}">
        </div>
      </div>
    </div>
  `).join("");

  lucide.createIcons();
  bindEducationInputs();
}

function bindEducationInputs() {
  const container = document.getElementById("education-list-container");
  
  container.querySelectorAll(".remove-edu-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.getAttribute("data-idx"));
      resumeData.education.splice(idx, 1);
      saveState();
      renderEducationFormList();
      renderLivePreview();
    });
  });

  ["inst", "degree", "start", "end"].forEach(prop => {
    container.querySelectorAll(`.edu-${prop}`).forEach(input => {
      input.addEventListener("input", () => {
        const box = input.closest("[data-idx]");
        const idx = parseInt(box.getAttribute("data-idx"));
        const realProp = prop === "inst" ? "institution" : prop === "start" ? "startDate" : prop === "end" ? "endDate" : prop;
        resumeData.education[idx][realProp] = input.value;
        saveState();
        renderLivePreview();
      });
    });
  });
}

document.getElementById("add-education-btn").addEventListener("click", () => {
  if (!resumeData.education) resumeData.education = [];
  resumeData.education.push({ institution: "", degree: "", startDate: "", endDate: "" });
  saveState();
  renderEducationFormList();
  renderLivePreview();
});

// Render Projects forms
function renderProjectsFormList() {
  const container = document.getElementById("projects-list-container");
  const list = resumeData.projects || [];

  container.innerHTML = list.map((proj, idx) => `
    <div class="p-4 border border-slate-200 rounded-xl bg-white space-y-3 relative" data-idx="${idx}">
      <button type="button" class="remove-proj-btn absolute top-3 right-3 text-slate-300 hover:text-rose-500 p-1 rounded hover:bg-slate-50 cursor-pointer" data-idx="${idx}">
        <i data-lucide="trash-2" class="w-4 h-4"></i>
      </button>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Project Title</label>
          <input type="text" class="proj-title w-full px-3 py-2 border border-slate-200 rounded-lg text-xs" value="${proj.title || ""}">
        </div>
        <div>
          <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Project Link</label>
          <input type="text" class="proj-link w-full px-3 py-2 border border-slate-200 rounded-lg text-xs" value="${proj.link || ""}">
        </div>
        <div class="col-span-2">
          <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Technologies / Skills used (comma-separated)</label>
          <input type="text" class="proj-skills w-full px-3 py-2 border border-slate-200 rounded-lg text-xs" value="${proj.skills || ""}" placeholder="e.g. React, TailwindCSS, Node.js">
        </div>
        <div class="col-span-2">
          <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Description</label>
          <textarea class="proj-desc w-full px-3 py-2 border border-slate-200 rounded-lg text-xs leading-relaxed" rows="2">${proj.description || ""}</textarea>
        </div>
      </div>
    </div>
  `).join("");

  lucide.createIcons();
  bindProjectsInputs();
}

function bindProjectsInputs() {
  const container = document.getElementById("projects-list-container");

  container.querySelectorAll(".remove-proj-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.getAttribute("data-idx"));
      resumeData.projects.splice(idx, 1);
      saveState();
      renderProjectsFormList();
      renderLivePreview();
    });
  });

  ["title", "link", "desc", "skills"].forEach(prop => {
    container.querySelectorAll(`.proj-${prop}`).forEach(input => {
      input.addEventListener("input", () => {
        const box = input.closest("[data-idx]");
        const idx = parseInt(box.getAttribute("data-idx"));
        const realProp = prop === "desc" ? "description" : prop;
        resumeData.projects[idx][realProp] = input.value;
        saveState();
        renderLivePreview();
      });
    });
  });
}

document.getElementById("add-projects-btn").addEventListener("click", () => {
  if (!resumeData.projects) resumeData.projects = [];
  resumeData.projects.push({ title: "", link: "", description: "", skills: "" });
  saveState();
  renderProjectsFormList();
  renderLivePreview();
});

// Render dynamic Skills & Languages categories (allowing subheadings to be added and edited)
function renderSkillsTagsContainers() {
  let skillSectionsList = [];
  if (Array.isArray(resumeData.skills)) {
    skillSectionsList = resumeData.skills;
  } else if (resumeData.skills && typeof resumeData.skills === "object") {
    skillSectionsList = [
      { id: "technical", title: "Technical Skills", skills: resumeData.skills.technical || [] },
      { id: "soft", title: "Soft Skills", skills: resumeData.skills.soft || [] },
      { id: "languages", title: "Languages", skills: resumeData.skills.languages || [] }
    ];
    resumeData.skills = skillSectionsList;
  } else {
    resumeData.skills = [];
    skillSectionsList = [];
  }

  const container = document.getElementById("skills-sections-container");
  if (!container) return;

  container.innerHTML = skillSectionsList.map((sec, secIdx) => {
    const tagsHtml = (sec.skills || []).map((tag, tagIdx) => `
      <span class="inline-flex items-center gap-1 px-2.5 py-1 bg-indigo-50 text-indigo-700 text-xs font-semibold rounded-lg">
        ${tag}
        <button type="button" class="text-indigo-400 hover:text-rose-500 cursor-pointer remove-skill-tag" data-sec-idx="${secIdx}" data-tag-idx="${tagIdx}">&times;</button>
      </span>
    `).join("");

    return `
      <div class="p-4 border border-slate-200 rounded-xl bg-slate-50/50 space-y-3 relative group" data-sec-idx="${secIdx}">
        <button type="button" class="delete-skill-section absolute top-3 right-3 text-slate-300 hover:text-rose-500 p-1 rounded hover:bg-slate-100 cursor-pointer transition-all" data-sec-idx="${secIdx}">
          <i data-lucide="trash-2" class="w-4 h-4"></i>
        </button>
        <div class="w-2/3">
          <label class="block text-[9px] font-extrabold text-slate-400 uppercase tracking-widest mb-1">Subheading Title</label>
          <input type="text" class="skill-sec-title w-full px-3 py-1.5 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 uppercase focus:ring-1 focus:ring-indigo-500 bg-white" value="${sec.title || ""}" placeholder="Category Heading">
        </div>
        <div class="space-y-1.5">
          <label class="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Skills / Items (Type skill and press Enter or comma to add)</label>
          <input type="text" class="skill-sec-input w-full px-3 py-2 border border-slate-200 rounded-lg text-xs" placeholder="e.g. React, SQL, Spanish...">
          <div class="flex flex-wrap gap-1.5 mt-2">${tagsHtml}</div>
        </div>
      </div>
    `;
  }).join("");

  lucide.createIcons();

  // Bind dynamic skills event listeners
  const boxes = container.querySelectorAll("[data-sec-idx]");
  boxes.forEach(box => {
    const secIdx = parseInt(box.getAttribute("data-sec-idx"));
    const sec = skillSectionsList[secIdx];

    // Subheading input listener
    const titleInput = box.querySelector(".skill-sec-title");
    titleInput.addEventListener("input", (e) => {
      sec.title = e.target.value;
      saveState();
      renderLivePreview();
    });

    // Skills tag adding listener
    const tagInput = box.querySelector(".skill-sec-input");
    tagInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === ",") {
        e.preventDefault();
        const val = tagInput.value.replace(/,/g, "").trim();
        if (val) {
          if (!sec.skills) sec.skills = [];
          if (!sec.skills.includes(val)) {
            sec.skills.push(val);
            saveState();
            renderSkillsTagsContainers();
            renderLivePreview();
          }
        }
        tagInput.value = "";
      }
    });

    // Tag removal
    box.querySelectorAll(".remove-skill-tag").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const tagIdx = parseInt(btn.getAttribute("data-tag-idx"));
        sec.skills.splice(tagIdx, 1);
        saveState();
        renderSkillsTagsContainers();
        renderLivePreview();
      });
    });

    // Section deletion
    box.querySelector(".delete-skill-section").addEventListener("click", (e) => {
      e.stopPropagation();
      skillSectionsList.splice(secIdx, 1);
      saveState();
      renderSkillsTagsContainers();
      renderLivePreview();
    });
  });
}

// Add skill section click registration
document.getElementById("add-skill-section-btn").addEventListener("click", () => {
  let skillSectionsList = [];
  if (Array.isArray(resumeData.skills)) {
    skillSectionsList = resumeData.skills;
  } else if (resumeData.skills && typeof resumeData.skills === "object") {
    skillSectionsList = [
      { id: "technical", title: "Technical Skills", skills: resumeData.skills.technical || [] },
      { id: "soft", title: "Soft Skills", skills: resumeData.skills.soft || [] },
      { id: "languages", title: "Languages", skills: resumeData.skills.languages || [] }
    ];
    resumeData.skills = skillSectionsList;
  } else {
    resumeData.skills = [];
    skillSectionsList = [];
  }

  skillSectionsList.push({
    id: "custom_" + Date.now(),
    title: "New Skill Subheading",
    skills: []
  });

  saveState();
  renderSkillsTagsContainers();
  renderLivePreview();
});

// Render dynamic Certifications forms
function renderCertificationsFormList() {
  const container = document.getElementById("certifications-list-container");
  if (!container) return;
  const list = resumeData.certifications || [];

  container.innerHTML = list.map((cert, idx) => `
    <div class="flex items-center gap-2 bg-slate-50 p-2 border border-slate-200 rounded-xl relative group" data-idx="${idx}">
      <input type="text" class="cert-item w-full bg-transparent border-none text-xs focus:ring-0 focus:outline-none px-1" value="${cert || ""}" placeholder="e.g. AWS Solutions Architect (2025) or Certified ScrumMaster">
      <button type="button" class="remove-cert-btn text-slate-400 hover:text-rose-500 p-1 cursor-pointer transition-all" data-idx="${idx}">
        <i data-lucide="x" class="w-4 h-4"></i>
      </button>
    </div>
  `).join("");

  lucide.createIcons();
  bindCertificationsInputs();
}

function bindCertificationsInputs() {
  const container = document.getElementById("certifications-list-container");
  if (!container) return;

  container.querySelectorAll(".remove-cert-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.getAttribute("data-idx"));
      resumeData.certifications.splice(idx, 1);
      saveState();
      renderCertificationsFormList();
      renderLivePreview();
    });
  });

  container.querySelectorAll(".cert-item").forEach(input => {
    input.addEventListener("input", () => {
      const box = input.closest("[data-idx]");
      const idx = parseInt(box.getAttribute("data-idx"));
      resumeData.certifications[idx] = input.value;
      saveState();
      renderLivePreview();
    });
  });
}

document.getElementById("add-cert-btn").addEventListener("click", () => {
  if (!resumeData.certifications) resumeData.certifications = [];
  resumeData.certifications.push("");
  saveState();
  renderCertificationsFormList();
  renderLivePreview();
});

// Render dynamic Achievements & Awards forms
function renderAchievementsFormList() {
  const container = document.getElementById("achievements-list-container");
  if (!container) return;
  const list = resumeData.achievements || [];

  container.innerHTML = list.map((ach, idx) => `
    <div class="flex items-center gap-2 bg-slate-50 p-2 border border-slate-200 rounded-xl relative group" data-idx="${idx}">
      <input type="text" class="ach-item w-full bg-transparent border-none text-xs focus:ring-0 focus:outline-none px-1" value="${ach || ""}" placeholder="e.g. Won First Place at Global TechHack 2024">
      <button type="button" class="remove-ach-btn text-slate-400 hover:text-rose-500 p-1 cursor-pointer transition-all" data-idx="${idx}">
        <i data-lucide="x" class="w-4 h-4"></i>
      </button>
    </div>
  `).join("");

  lucide.createIcons();
  bindAchievementsInputs();
}

function bindAchievementsInputs() {
  const container = document.getElementById("achievements-list-container");
  if (!container) return;

  container.querySelectorAll(".remove-ach-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.getAttribute("data-idx"));
      resumeData.achievements.splice(idx, 1);
      saveState();
      renderAchievementsFormList();
      renderLivePreview();
    });
  });

  container.querySelectorAll(".ach-item").forEach(input => {
    input.addEventListener("input", () => {
      const box = input.closest("[data-idx]");
      const idx = parseInt(box.getAttribute("data-idx"));
      resumeData.achievements[idx] = input.value;
      saveState();
      renderLivePreview();
    });
  });
}

document.getElementById("add-achievement-btn").addEventListener("click", () => {
  if (!resumeData.achievements) resumeData.achievements = [];
  resumeData.achievements.push("");
  saveState();
  renderAchievementsFormList();
  renderLivePreview();
});

// Custom sections
function renderCustomSectionsFormList() {
  const container = document.getElementById("custom-sections-container");
  const list = resumeData.customSections || [];

  container.innerHTML = list.map((cs, idx) => `
    <div class="p-4 border border-slate-200 rounded-xl bg-white space-y-3 relative" data-idx="${idx}">
      <button type="button" class="remove-cs-btn absolute top-3 right-3 text-slate-300 hover:text-rose-500 p-1 rounded hover:bg-slate-50 cursor-pointer" data-idx="${idx}">
        <i data-lucide="trash-2" class="w-4 h-4"></i>
      </button>
      <div class="space-y-2">
        <div>
          <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Section Name</label>
          <input type="text" class="cs-name w-full px-3 py-2 border border-slate-200 rounded-lg text-xs" value="${cs.title || ""}">
        </div>
        <div>
          <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Content / Paragraphs</label>
          <textarea class="cs-desc w-full px-3 py-2 border border-slate-200 rounded-lg text-xs leading-relaxed" rows="3">${cs.description || ""}</textarea>
        </div>
      </div>
    </div>
  `).join("");

  lucide.createIcons();
  bindCustomSectionsInputs();
}

function bindCustomSectionsInputs() {
  const container = document.getElementById("custom-sections-container");

  container.querySelectorAll(".remove-cs-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.getAttribute("data-idx"));
      resumeData.customSections.splice(idx, 1);
      saveState();
      renderCustomSectionsFormList();
      renderLivePreview();
    });
  });

  container.querySelectorAll(".cs-name").forEach(input => {
    input.addEventListener("input", () => {
      const idx = parseInt(input.closest("[data-idx]").getAttribute("data-idx"));
      resumeData.customSections[idx].title = input.value;
      saveState();
      renderLivePreview();
    });
  });

  container.querySelectorAll(".cs-desc").forEach(input => {
    input.addEventListener("input", () => {
      const idx = parseInt(input.closest("[data-idx]").getAttribute("data-idx"));
      resumeData.customSections[idx].description = input.value;
      saveState();
      renderLivePreview();
    });
  });
}

// Section Reordering
function renderSectionReorderList() {
  const container = document.getElementById("reorder-sections-container");
  if (!container) return;

  const defaultOrder = ["summary", "experience", "education", "projects", "skills", "custom"];
  if (!resumeData.sectionOrder) {
    resumeData.sectionOrder = [...defaultOrder];
  } else {
    // Make sure we have exactly all items
    const current = resumeData.sectionOrder.filter(k => defaultOrder.includes(k));
    defaultOrder.forEach(k => {
      if (!current.includes(k)) {
        current.push(k);
      }
    });
    resumeData.sectionOrder = current;
  }

  const labels = {
    summary: "Professional Summary",
    experience: "Work Experience",
    education: "Education",
    projects: "Projects",
    skills: "Skills",
    custom: "Custom Sections"
  };

  container.innerHTML = resumeData.sectionOrder.map((key, idx) => {
    return `
      <div class="flex items-center justify-between p-2 bg-slate-50 border border-slate-200/60 rounded-xl hover:bg-slate-100/50 transition-all">
        <div class="flex items-center gap-2">
          <span class="text-xs text-slate-400 font-mono font-bold">#${idx + 1}</span>
          <span class="text-xs font-bold text-slate-700">${labels[key]}</span>
        </div>
        <div class="flex items-center gap-1">
          <button type="button" class="btn-move-section-up p-1 rounded hover:bg-slate-200 text-slate-500 hover:text-slate-800 disabled:opacity-30 disabled:pointer-events-none cursor-pointer" data-key="${key}" ${idx === 0 ? 'disabled' : ''}>
            <i data-lucide="chevron-up" class="w-4 h-4"></i>
          </button>
          <button type="button" class="btn-move-section-down p-1 rounded hover:bg-slate-200 text-slate-500 hover:text-slate-800 disabled:opacity-30 disabled:pointer-events-none cursor-pointer" data-key="${key}" ${idx === resumeData.sectionOrder.length - 1 ? 'disabled' : ''}>
            <i data-lucide="chevron-down" class="w-4 h-4"></i>
          </button>
        </div>
      </div>
    `;
  }).join("");

  // Re-attach listeners
  container.querySelectorAll(".btn-move-section-up").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const key = btn.getAttribute("data-key");
      const idx = resumeData.sectionOrder.indexOf(key);
      if (idx > 0) {
        // Swap with previous
        const temp = resumeData.sectionOrder[idx - 1];
        resumeData.sectionOrder[idx - 1] = key;
        resumeData.sectionOrder[idx] = temp;
        saveState();
        renderSectionReorderList();
        renderLivePreview();
      }
    });
  });

  container.querySelectorAll(".btn-move-section-down").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const key = btn.getAttribute("data-key");
      const idx = resumeData.sectionOrder.indexOf(key);
      if (idx !== -1 && idx < resumeData.sectionOrder.length - 1) {
        // Swap with next
        const temp = resumeData.sectionOrder[idx + 1];
        resumeData.sectionOrder[idx + 1] = key;
        resumeData.sectionOrder[idx] = temp;
        saveState();
        renderSectionReorderList();
        renderLivePreview();
      }
    });
  });

  if (window.lucide) {
    window.lucide.createIcons();
  }
}

document.getElementById("add-custom-section-btn").addEventListener("click", () => {
  if (!resumeData.customSections) resumeData.customSections = [];
  resumeData.customSections.push({ title: "New Dynamic Section", description: "" });
  saveState();
  renderCustomSectionsFormList();
  renderLivePreview();
});

// Calculate ATS score metrics
function calculateResumeScore() {
  let score = 0;
  let tips = [];

  const p = resumeData.personalInfo || {};
  if (p.fullName) score += 15; else tips.push("Add your full name");
  if (p.jobTitle) score += 10; else tips.push("Provide your professional title");
  if (p.email && p.phone) score += 15; else tips.push("Provide contact channels");

  if ((resumeData.summary || "").length > 50) score += 15; else tips.push("Write a solid summary outline (min 50 chars)");
  if (resumeData.experience && resumeData.experience.length > 0) score += 20; else tips.push("Add at least one job experience position");
  if (resumeData.education && resumeData.education.length > 0) score += 15; else tips.push("List your academic history");
  if (resumeData.skills?.technical && resumeData.skills.technical.length > 2) score += 10; else tips.push("Enrich your technical skills keywords list");

  scorePct.textContent = `${score}%`;
  scoreComplete.textContent = `${score}%`;

  if (score >= 80) {
    scoreAts.textContent = "Excellent";
    scoreAts.className = "font-bold text-emerald-600";
    strengthBadge.textContent = "Strong ATS";
    strengthBadge.className = "px-2.5 py-0.5 bg-emerald-100 text-emerald-700 font-bold text-[10px] rounded-full uppercase tracking-wider";
    scoreTip.textContent = "Your resume is fully complete, professional, and ATS optimized!";
  } else if (score >= 50) {
    scoreAts.textContent = "Good";
    scoreAts.className = "font-bold text-amber-600";
    strengthBadge.textContent = "Intermediate";
    strengthBadge.className = "px-2.5 py-0.5 bg-amber-100 text-amber-700 font-bold text-[10px] rounded-full uppercase tracking-wider";
    scoreTip.textContent = tips[0] ? `Recommendation: ${tips[0]}.` : "Almost perfect, fill other sections.";
  } else {
    scoreAts.textContent = "Weak";
    scoreAts.className = "font-bold text-rose-600";
    strengthBadge.textContent = "Draft";
    strengthBadge.className = "px-2.5 py-0.5 bg-slate-100 text-slate-700 font-bold text-[10px] rounded-full uppercase tracking-wider";
    scoreTip.textContent = tips[0] ? `Critical addition needed: ${tips[0]}.` : "Please start filling in your info.";
  }
}

// Render dynamic Live Preview HTML inside the A4 container
function renderLivePreview() {
  const p = resumeData.personalInfo || {};
  const theme = resumeData.themeSettings || {};
  const templateId = resumeData.templateId || "modern_ats";

  // Clean layout styling variables mapping
  a4Preview.style.setProperty("--primary-color", theme.primaryColor || "#0f172a");
  a4Preview.style.setProperty("--secondary-color", theme.secondaryColor || "#475569");
  a4Preview.style.padding = theme.margins || "20px";
  
  const fontName = theme.fontFamily || "Inter";
  a4Preview.style.fontFamily = fontName.includes(" ") && !fontName.startsWith("'") && !fontName.startsWith('"')
    ? `'${fontName}', sans-serif`
    : `${fontName}, sans-serif`;
    
  a4Preview.style.fontSize = theme.fontSize || "14px";
  a4Preview.style.lineHeight = theme.lineHeight || "1.5";
  a4Preview.className = "resume-preview-container";

  const headerAlign = theme.headerAlign || "left"; // "left", "center", "right"
  let contactsAlignClass = "justify-start text-left";
  if (headerAlign === "center") {
    contactsAlignClass = "justify-center text-center mx-auto";
  } else if (headerAlign === "right") {
    contactsAlignClass = "justify-end text-right ml-auto";
  }

  // Build content HTML dynamically based on column layouts
  const showIconTag = (iconName) => theme.showIcons !== false ? `<span class="resume-icon"><i data-lucide="${iconName}" class="w-3.5 h-3.5"></i></span>` : "";
  const dividerLine = theme.showLines !== false ? `<hr class="my-3 border-slate-200">` : "";

  // Contact line
  const contactsArr = [];
  if (p.email) contactsArr.push(`${showIconTag('mail')} ${p.email}`);
  if (p.phone) contactsArr.push(`${showIconTag('phone')} ${p.phone}`);
  if (p.address) contactsArr.push(`${showIconTag('map-pin')} ${p.address}`);
  if (p.linkedin) contactsArr.push(`${showIconTag('linkedin')} ${p.linkedin}`);
  if (p.github) contactsArr.push(`${showIconTag('github')} ${p.github}`);
  if (p.portfolio) contactsArr.push(`${showIconTag('globe')} ${p.portfolio}`);

  const contactsLine = contactsArr.map((c, idx) => `
    <span class="inline-flex items-center gap-1.5 whitespace-nowrap">${c}</span>
    ${idx < contactsArr.length - 1 ? '<span class="text-slate-300 px-1.5 font-normal">|</span>' : ''}
  `).join("");

  // Helper to render section headers consistently, with real hex colors avoiding html2canvas var() shorthand border bugs
  const renderSectionHeader = (title) => `
    <h3 class="text-xs font-extrabold uppercase tracking-widest section-header-underline" style="border-bottom: 2px solid ${theme.primaryColor || '#0f172a'}; color: ${theme.primaryColor || '#0f172a'};">${title}</h3>
  `;

  // Helper to format multiline descriptions or bullet-prefixed text as bullet lists
  const formatDescriptionAsBullets = (text) => {
    if (!text) return "";
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
    if (lines.length === 0) return "";
    
    // If only one line and it does not start with a bullet prefix, render as a clean paragraph
    if (lines.length === 1 && !/^[-\*•·○■]/.test(lines[0])) {
      return `<p class="leading-relaxed whitespace-pre-line text-slate-600">${lines[0]}</p>`;
    }
    
    const bulletItems = lines.map(line => {
      // Strip common bullet characters if present
      const cleaned = line.replace(/^[\s\-*•·○■]+/, "").trim();
      if (!cleaned) return "";
      return `
        <div class="flex items-start gap-1.5 leading-relaxed mt-0.5 text-slate-600">
          <span class="text-slate-400 font-sans shrink-0 mt-1 select-none text-[8px]" style="color: ${theme.primaryColor || '#0f172a'};">•</span>
          <span class="flex-1">${cleaned}</span>
        </div>
      `;
    }).filter(Boolean);
    
    return `<div class="space-y-1.5 mt-1">${bulletItems.join("")}</div>`;
  };

  // Profile image element
  const profilePhotoHtml = (theme.showPhoto !== false && p.photoURL) ? `
    <img src="${p.photoURL}" class="w-16 h-16 rounded-full border border-slate-200 object-cover shadow-sm shrink-0" alt="Avatar">
  ` : "";

  // Experiences content
  const expHtml = (resumeData.experience || []).map(exp => `
    <div class="flex flex-col gap-1">
      <div class="flex justify-between items-start">
        <h4 class="font-bold text-slate-800 text-sm">${exp.role || 'Position Title'}</h4>
        <span class="text-xs text-slate-500 font-semibold">${exp.startDate || 'Start'} - ${exp.endDate || 'End'}</span>
      </div>
      <div class="text-xs font-semibold text-indigo-600">${exp.company || 'Company Name'}</div>
      <div class="text-xs leading-relaxed mt-0.5">${formatDescriptionAsBullets(exp.description)}</div>
    </div>
  `).join("<div class='h-3'></div>");

  // Education content
  const eduHtml = (resumeData.education || []).map(edu => `
    <div class="flex flex-col gap-1">
      <div class="flex justify-between items-start">
        <h4 class="font-bold text-slate-800 text-sm">${edu.degree || 'Degree / Major'}</h4>
        <span class="text-xs text-slate-500 font-semibold">${edu.startDate || 'Start'} - ${edu.endDate || 'End'}</span>
      </div>
      <div class="text-xs font-semibold text-slate-600">${edu.institution || 'University Name'}</div>
    </div>
  `).join("<div class='h-2'></div>");

  // Projects content
  const projHtml = (resumeData.projects || []).map(proj => `
    <div class="flex flex-col gap-1">
      <div class="flex justify-between items-start">
        <h4 class="font-bold text-indigo-650 text-xs">${proj.title || 'Project Name'}</h4>
        <span class="text-[10px] text-slate-400 font-mono">${proj.link || ''}</span>
      </div>
      <div class="text-xs leading-relaxed mt-0.5">${formatDescriptionAsBullets(proj.description)}</div>
    </div>
  `).join("<div class='h-2.5'></div>");

  // Skills lists HTML
  const skills = resumeData.skills || { technical: [], soft: [], languages: [] };
  const technicalHtml = (skills.technical || []).map(s => 
    `<span class="px-2 py-0.5 bg-slate-100 text-slate-700 text-xs rounded-md font-semibold">${s}</span>`
  ).join(" ");
  const softHtml = (skills.soft || []).map(s => 
    `<span class="px-2 py-0.5 bg-indigo-50 text-indigo-700 text-xs rounded-md font-semibold">${s}</span>`
  ).join(" ");
  const languagesHtml = (skills.languages || []).map(s => 
    `<span class="px-2 py-0.5 bg-emerald-50 text-emerald-700 text-xs rounded-md font-semibold">${s}</span>`
  ).join(" ");

  // Custom sections content
  const customSecsHtml = (resumeData.customSections || []).map(cs => `
    <div class="flex flex-col gap-1.5 mt-2">
      ${renderSectionHeader(cs.title)}
      <p class="text-xs text-slate-600 leading-relaxed whitespace-pre-line">${cs.description || ''}</p>
    </div>
  `).join("<div class='h-3'></div>");

  const isSidebarLayout = templateId === "creative" || templateId === "sidebar_resume" || templateId === "designer_resume" || templateId === "colorful_resume";
  const isTwoColumnRight = templateId === "executive" || templateId === "developer_resume" || templateId === "data_analyst_resume" || templateId === "luxury";

  const sectionContentMap = {
    summary: resumeData.summary ? `
      <div class="flex flex-col gap-1">
        ${renderSectionHeader(isSidebarLayout ? "Profile Summary" : "Professional Summary")}
        <p class="text-xs text-slate-600 leading-relaxed">${resumeData.summary}</p>
      </div>
    ` : "",

    experience: (resumeData.experience && resumeData.experience.length > 0) ? `
      <div class="flex flex-col gap-2">
        ${renderSectionHeader(isSidebarLayout ? "Professional Experience" : (isTwoColumnRight ? "Work Experience" : "Work Experience"))}
        <div class="flex flex-col gap-3">${expHtml}</div>
      </div>
    ` : "",

    education: (resumeData.education && resumeData.education.length > 0) ? `
      <div class="flex flex-col gap-2">
        ${renderSectionHeader("Education")}
        <div class="flex flex-col gap-2.5">${eduHtml}</div>
      </div>
    ` : "",

    projects: (resumeData.projects && resumeData.projects.length > 0) ? `
      <div class="flex flex-col gap-2">
        ${renderSectionHeader("Projects")}
        <div class="flex flex-col gap-2.5">${projHtml}</div>
      </div>
    ` : "",

    skills: (skills.technical?.length > 0 || skills.soft?.length > 0) ? `
      <div class="flex flex-col gap-2">
        ${renderSectionHeader("Skills")}
        <div style="display: flex; flex-direction: row; gap: 16px;">
          ${skills.technical?.length > 0 ? `
            <div style="flex: 1; min-width: 0;" class="flex flex-col gap-1">
              <span class="text-xs font-bold text-slate-400 uppercase">Technical skills</span>
              <div class="flex flex-wrap gap-1">${technicalHtml}</div>
            </div>
          ` : ""}
          ${skills.soft?.length > 0 ? `
            <div style="flex: 1; min-width: 0;" class="flex flex-col gap-1">
              <span class="text-xs font-bold text-slate-400 uppercase">Soft strengths</span>
              <div class="flex flex-wrap gap-1">${softHtml}</div>
            </div>
          ` : ""}
        </div>
      </div>
    ` : "",

    custom: customSecsHtml ? customSecsHtml : ""
  };

  // Outer structure builders depending on sidebar layouts
  let innerStructure = "";

  if (isSidebarLayout) {
    // Left narrow sidebar layout
    const mainSectionsHtml = (resumeData.sectionOrder || ["summary", "experience", "education", "projects", "skills", "custom"])
      .filter(key => ["summary", "experience", "education", "projects", "custom"].includes(key))
      .map(key => sectionContentMap[key])
      .filter(Boolean)
      .join("<div class='h-4'></div>");

    innerStructure = `
      <div class="layout-two-column-left-sidebar" style="display: flex; flex-direction: row; gap: 24px;">
        <!-- Sidebar Col -->
        <div style="width: 240px; flex-shrink: 0;" class="border-r border-slate-100 pr-5 flex flex-col gap-5">
          <div class="flex flex-col gap-2 ${headerAlign === 'center' ? 'items-center text-center' : (headerAlign === 'right' ? 'items-end text-right' : 'items-start text-left')}">
            ${profilePhotoHtml}
            <h2 class="text-lg font-extrabold text-slate-800 leading-tight">${p.fullName || 'Alex Rivera'}</h2>
            <div class="text-xs font-semibold text-indigo-600 leading-tight">${p.jobTitle || 'Technical Designer'}</div>
          </div>
          
          <div class="pt-4 flex flex-col gap-1.5 text-xs text-slate-600 ${headerAlign === 'center' ? 'items-center' : (headerAlign === 'right' ? 'items-end' : 'items-start')}">
            ${contactsArr.map(c => `<div class="truncate">${c}</div>`).join("")}
          </div>

          ${skills.technical?.length > 0 ? `
            <div class="flex flex-col gap-1.5">
              <h4 class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Tech Skills</h4>
              <div class="flex flex-wrap gap-1">${technicalHtml}</div>
            </div>
          ` : ""}

          ${skills.soft?.length > 0 ? `
            <div class="flex flex-col gap-1.5">
              <h4 class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Soft Skills</h4>
              <div class="flex flex-wrap gap-1">${softHtml}</div>
            </div>
          ` : ""}

          ${skills.languages?.length > 0 ? `
            <div class="flex flex-col gap-1.5">
              <h4 class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Languages</h4>
              <div class="flex flex-wrap gap-1">${languagesHtml}</div>
            </div>
          ` : ""}
        </div>

        <!-- Main Body Col -->
        <div style="flex: 1; min-width: 0;" class="flex flex-col gap-4">
          ${mainSectionsHtml}
        </div>
      </div>
    `;
  } else if (isTwoColumnRight) {
    // Right narrow column
    const leftSectionsHtml = (resumeData.sectionOrder || ["summary", "experience", "education", "projects", "skills", "custom"])
      .filter(key => ["summary", "experience", "projects", "custom"].includes(key))
      .map(key => sectionContentMap[key])
      .filter(Boolean)
      .join("<div class='h-4'></div>");

    const rightSectionsHtml = (resumeData.sectionOrder || ["summary", "experience", "education", "projects", "skills", "custom"])
      .filter(key => ["education", "skills"].includes(key))
      .map(key => sectionContentMap[key])
      .filter(Boolean)
      .join("<div class='h-4'></div>");

    innerStructure = `
      <div class="flex flex-col gap-5">
        <!-- Header banner -->
        <div class="flex ${headerAlign === 'center' ? 'flex-col items-center text-center' : (headerAlign === 'right' ? 'flex-row-reverse text-right items-center' : 'flex-row items-center')} justify-between gap-4">
          <div class="flex flex-col gap-1 ${headerAlign === 'center' ? 'items-center text-center' : (headerAlign === 'right' ? 'items-end text-right' : 'items-start text-left')}">
            <h2 class="text-2xl font-extrabold tracking-tight" style="color: ${theme.primaryColor || '#0f172a'}">${p.fullName || 'Alex Rivera'}</h2>
            <div class="text-sm font-semibold text-indigo-600">${p.jobTitle || 'Lead Systems Developer'}</div>
            <div class="text-xs text-slate-500 pt-1 flex flex-wrap gap-x-3 gap-y-1 ${contactsAlignClass}">${contactsLine}</div>
          </div>
          ${profilePhotoHtml}
        </div>

        ${dividerLine}

        <div class="layout-two-column-right-narrow" style="display: flex; flex-direction: row; gap: 24px;">
          <!-- Left wide column -->
          <div style="flex: 1; min-width: 0;" class="flex flex-col gap-4">
            ${leftSectionsHtml}
          </div>

          <!-- Right narrow column -->
          <div style="width: 220px; flex-shrink: 0;" class="flex flex-col gap-4 border-l border-slate-100 pl-4">
            ${rightSectionsHtml}
          </div>
        </div>
      </div>
    `;
  } else {
    // Default standard One-Column layout (perfect for ATS, Classic, Minimal)
    const orderedSectionsHtml = (resumeData.sectionOrder || ["summary", "experience", "education", "projects", "skills", "custom"])
      .map(key => sectionContentMap[key])
      .filter(Boolean)
      .join("<div class='h-4'></div>");

    innerStructure = `
      <div class="flex flex-col gap-5">
        <!-- Centered Header option -->
        <div class="flex ${headerAlign === 'center' ? 'flex-col items-center text-center' : (headerAlign === 'right' ? 'flex-row-reverse text-right items-center' : 'flex-row items-center')} justify-between gap-4">
          <div class="flex flex-col gap-1 ${headerAlign === 'center' ? 'items-center text-center' : (headerAlign === 'right' ? 'items-end text-right' : 'items-start text-left')}">
            <h2 class="text-2xl font-extrabold tracking-tight" style="color: ${theme.primaryColor || '#0f172a'}">${p.fullName || 'Alex Rivera'}</h2>
            <div class="text-sm font-semibold text-indigo-600">${p.jobTitle || 'Senior Software Engineer'}</div>
            <div class="text-xs text-slate-500 pt-1 flex flex-wrap gap-x-3 gap-y-1 ${contactsAlignClass}">${contactsLine}</div>
          </div>
          ${profilePhotoHtml}
        </div>

        ${dividerLine}

        ${orderedSectionsHtml}
      </div>
    `;
  }

  a4Preview.innerHTML = innerStructure;
  lucide.createIcons();
}

// Fit Zoom nicely
function fitZoomToPane() {
  const previewPane = document.getElementById("preview-panel-pane");
  const scale = (previewPane.clientWidth - 80) / 794;
  applyZoom(Math.min(100, Math.max(50, Math.round(scale * 100))));
}

function applyZoom(val) {
  currentZoom = Math.min(150, Math.max(50, val));
  zoomSlider.value = currentZoom;
  zoomLabel.textContent = `${currentZoom}%`;
  zoomContainer.style.transform = `scale(${currentZoom / 100})`;
}

// Save trigger and state push
function saveState() {
  if (autosaveService) {
    autosaveService.queueSave(resumeData);
  }
}

// Autosave Status syncs
function handleAutosaveStateChange(state) {
  if (state === 'saving') {
    syncStatus.innerHTML = `<span class="w-2 h-2 rounded-full bg-amber-500 animate-ping"></span> Syncing draft...`;
  } else if (state === 'saved') {
    syncStatus.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500"></span> Saved to cloud`;
  } else if (state === 'error') {
    syncStatus.innerHTML = `<span class="w-2 h-2 rounded-full bg-rose-500"></span> Offline / Sync error`;
  } else {
    syncStatus.innerHTML = `<span class="w-2 h-2 rounded-full bg-slate-300"></span> Draft edited`;
  }
}

// Rename Title action inside Builder
async function handleRenameTitle(e) {
  e.preventDefault();
  const titleVal = document.getElementById("modal-resume-name").value;
  
  try {
    await updateDoc(doc(db, "resumes", resumeId), { name: titleVal });
    resumeData.name = titleVal;
    resumeTitle.textContent = titleVal;
    document.getElementById("rename-title-modal").classList.add("hidden");
  } catch (err) {
    alert("Could not rename title.");
  }
}

// Toggle Workspace Dark mode themes
function toggleWorkspaceTheme() {
  const rootBody = document.getElementById("builder-body-root");
  rootBody.classList.toggle("builder-dark-theme");
  
  const toggleBtn = document.getElementById("builder-theme-toggle");
  if (toggleBtn) {
    if (rootBody.classList.contains("builder-dark-theme")) {
      toggleBtn.innerHTML = `<i data-lucide="moon" class="w-5 h-5"></i>`;
    } else {
      toggleBtn.innerHTML = `<i data-lucide="sun" class="w-5 h-5"></i>`;
    }
    lucide.createIcons();
  }
}

// Keyboard shortcuts (Ctrl+S, Ctrl+P)
function handleKeyboardShortcuts(e) {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    syncFormToData();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
    e.preventDefault();
    syncFormToData();
    window.print();
  }
}

// Collect all live inputs from the form and sync them directly to the in-memory resumeData object
function syncFormToData() {
  if (!resumeData) return;
  if (!resumeData.personalInfo) resumeData.personalInfo = {};
  
  const fullNameEl = document.getElementById("p-fullname");
  const jobTitleEl = document.getElementById("p-title");
  const emailEl = document.getElementById("p-email");
  const phoneEl = document.getElementById("p-phone");
  const addressEl = document.getElementById("p-address");
  const linkedinEl = document.getElementById("p-linkedin");
  const githubEl = document.getElementById("p-github");
  const portfolioEl = document.getElementById("p-portfolio");
  const photoUrlEl = document.getElementById("p-photourl");
  const summaryEl = document.getElementById("p-summary");

  if (fullNameEl) resumeData.personalInfo.fullName = fullNameEl.value;
  if (jobTitleEl) resumeData.personalInfo.jobTitle = jobTitleEl.value;
  if (emailEl) resumeData.personalInfo.email = emailEl.value;
  if (phoneEl) resumeData.personalInfo.phone = phoneEl.value;
  if (addressEl) resumeData.personalInfo.address = addressEl.value;
  if (linkedinEl) resumeData.personalInfo.linkedin = linkedinEl.value;
  if (githubEl) resumeData.personalInfo.github = githubEl.value;
  if (portfolioEl) resumeData.personalInfo.portfolio = portfolioEl.value;
  if (photoUrlEl) resumeData.personalInfo.photoURL = photoUrlEl.value;
  if (summaryEl) resumeData.summary = summaryEl.value;

  // 2. Experience
  const expContainer = document.getElementById("experience-list-container");
  if (expContainer && resumeData.experience) {
    const expBoxes = expContainer.querySelectorAll("[data-idx]");
    expBoxes.forEach(box => {
      const idx = parseInt(box.getAttribute("data-idx"));
      if (resumeData.experience[idx]) {
        const companyEl = box.querySelector(".exp-company");
        const roleEl = box.querySelector(".exp-role");
        const startEl = box.querySelector(".exp-start");
        const endEl = box.querySelector(".exp-end");
        const descEl = box.querySelector(".exp-desc");

        if (companyEl) resumeData.experience[idx].company = companyEl.value;
        if (roleEl) resumeData.experience[idx].role = roleEl.value;
        if (startEl) resumeData.experience[idx].startDate = startEl.value;
        if (endEl) resumeData.experience[idx].endDate = endEl.value;
        if (descEl) resumeData.experience[idx].description = descEl.value;
      }
    });
  }

  // 3. Education
  const eduContainer = document.getElementById("education-list-container");
  if (eduContainer && resumeData.education) {
    const eduBoxes = eduContainer.querySelectorAll("[data-idx]");
    eduBoxes.forEach(box => {
      const idx = parseInt(box.getAttribute("data-idx"));
      if (resumeData.education[idx]) {
        const instEl = box.querySelector(".edu-inst");
        const degreeEl = box.querySelector(".edu-degree");
        const startEl = box.querySelector(".edu-start");
        const endEl = box.querySelector(".edu-end");

        if (instEl) resumeData.education[idx].institution = instEl.value;
        if (degreeEl) resumeData.education[idx].degree = degreeEl.value;
        if (startEl) resumeData.education[idx].startDate = startEl.value;
        if (endEl) resumeData.education[idx].endDate = endEl.value;
      }
    });
  }

  // 4. Projects
  const projContainer = document.getElementById("projects-list-container");
  if (projContainer && resumeData.projects) {
    const projBoxes = projContainer.querySelectorAll("[data-idx]");
    projBoxes.forEach(box => {
      const idx = parseInt(box.getAttribute("data-idx"));
      if (resumeData.projects[idx]) {
        const titleEl = box.querySelector(".proj-title");
        const linkEl = box.querySelector(".proj-link");
        const skillsEl = box.querySelector(".proj-skills");
        const descEl = box.querySelector(".proj-desc");

        if (titleEl) resumeData.projects[idx].title = titleEl.value;
        if (linkEl) resumeData.projects[idx].link = linkEl.value;
        if (skillsEl) resumeData.projects[idx].skills = skillsEl.value;
        if (descEl) resumeData.projects[idx].description = descEl.value;
      }
    });
  }

  // 5. Custom Sections
  const customContainer = document.getElementById("custom-sections-container");
  if (customContainer && resumeData.customSections) {
    const customBoxes = customContainer.querySelectorAll("[data-idx]");
    customBoxes.forEach(box => {
      const idx = parseInt(box.getAttribute("data-idx"));
      if (resumeData.customSections[idx]) {
        const titleEl = box.querySelector(".cs-name");
        const descEl = box.querySelector(".cs-desc");

        if (titleEl) resumeData.customSections[idx].title = titleEl.value;
        if (descEl) resumeData.customSections[idx].description = descEl.value;
      }
    });
  }

  // 6. Certifications
  const certContainer = document.getElementById("certifications-list-container");
  if (certContainer && resumeData.certifications) {
    const certInputs = certContainer.querySelectorAll(".cert-item");
    certInputs.forEach((input, idx) => {
      if (idx < resumeData.certifications.length) {
        resumeData.certifications[idx] = input.value;
      }
    });
  }

  // 7. Achievements
  const achContainer = document.getElementById("achievements-list-container");
  if (achContainer && resumeData.achievements) {
    const achInputs = achContainer.querySelectorAll(".ach-item");
    achInputs.forEach((input, idx) => {
      if (idx < resumeData.achievements.length) {
        resumeData.achievements[idx] = input.value;
      }
    });
  }

  // Force Save and Re-render preview
  if (autosaveService) {
    autosaveService.forceSaveNow(resumeData);
  }
  renderLivePreview();
  calculateResumeScore();
}
