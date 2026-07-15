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
let lastHistoryStateStr = "";
let historyDebounceTimeout = null;
const MAX_HISTORY_LIMIT = 50;

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

  // Setup Undo/Redo click listeners
  const undoBtn = document.getElementById("undo-btn");
  const redoBtn = document.getElementById("redo-btn");
  if (undoBtn) undoBtn.addEventListener("click", undo);
  if (redoBtn) redoBtn.addEventListener("click", redo);
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
    initHistory(resumeData);
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

    saveState(true);
    renderSectionReorderList();
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
  document.getElementById("theme-sectiongap").value = parseInt(theme.sectionGap || 16);
  document.getElementById("val-sectiongap").textContent = theme.sectionGap || "16px";
  document.getElementById("theme-headergap").value = parseInt(theme.headerGap || 8);
  document.getElementById("val-headergap").textContent = theme.headerGap || "8px";
  document.getElementById("theme-headersize").value = parseInt(theme.headerSize || 24);
  document.getElementById("val-headersize").textContent = `${theme.headerSize || 24}px`;
  document.getElementById("theme-topmargin").value = parseInt(theme.topMargin !== undefined ? theme.topMargin : 20);
  document.getElementById("val-topmargin").textContent = `${theme.topMargin !== undefined ? theme.topMargin : 20}px`;
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
      } else if (prop === "sectiongap") {
        resumeData.themeSettings.sectionGap = `${val}px`;
        document.getElementById("val-sectiongap").textContent = `${val}px`;
      } else if (prop === "headergap") {
        resumeData.themeSettings.headerGap = `${val}px`;
        document.getElementById("val-headergap").textContent = `${val}px`;
      } else if (prop === "headersize") {
        resumeData.themeSettings.headerSize = parseInt(val);
        document.getElementById("val-headersize").textContent = `${val}px`;
      } else if (prop === "topmargin") {
        resumeData.themeSettings.topMargin = parseInt(val);
        document.getElementById("val-topmargin").textContent = `${val}px`;
      } else if (prop === "showphoto" || prop === "showicons" || prop === "showlines") {
        const key = "show" + prop.substring(4).charAt(0).toUpperCase() + prop.substring(5);
        resumeData.themeSettings[key] = e.target.checked;
      } else {
        resumeData.themeSettings[prop] = val;
      }
    }

    const isDiscrete = e.target.type === "checkbox" || e.target.tagName === "SELECT";
    saveState(isDiscrete);
    renderLivePreview();
    calculateResumeScore();
  });

  // Dynamic Suggestion lists matching guidelines
  const techInput = document.getElementById("tech-skills-input");
  if (techInput) {
    techInput.addEventListener("input", handleTechSuggestions);
    techInput.addEventListener("keydown", handleTechTagsAdd);
  }
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
        if (techInput) techInput.value = "";
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

  let techSec = skillSectionsList.find(sec => sec.id === "technical" || sec.title.toLowerCase().includes("tech"));
  if (!techSec) {
    if (skillSectionsList.length > 0) {
      techSec = skillSectionsList[0];
    } else {
      techSec = { id: "technical", title: "Technical Skills", skills: [] };
      skillSectionsList.push(techSec);
      resumeData.skills = skillSectionsList;
    }
  }

  if (!techSec.skills) techSec.skills = [];
  if (!techSec.skills.includes(val)) {
    techSec.skills.push(val);
    saveState(true);
    renderSkillsTagsContainers();
    renderLivePreview();
  }
}

// Render dynamic Lists form components
function renderExperienceFormList() {
  const container = document.getElementById("experience-list-container");
  const list = resumeData.experience || [];

  container.innerHTML = list.map((exp, idx) => {
    const isPresent = exp.endDate === "Present";
    const desc = exp.description || "";
    // split by newline, clean up, and default to at least one empty string if empty
    const points = desc.split(/\r?\n/).map(line => line.trim());
    if (points.length === 0) points.push("");

    return `
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
            <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Start Month & Year</label>
            <input type="month" class="exp-start w-full px-3 py-2 border border-slate-200 rounded-lg text-xs" value="${exp.startDate || ""}">
          </div>
          <div>
            <div class="flex justify-between items-center">
              <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">End Month & Year</label>
              <label class="inline-flex items-center gap-1 cursor-pointer text-[10px] text-indigo-600 font-bold">
                <input type="checkbox" class="exp-present-checkbox rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 mr-1" ${isPresent ? "checked" : ""}> Currently Work Here
              </label>
            </div>
            <input type="${isPresent ? "hidden" : "month"}" class="exp-end w-full px-3 py-2 border border-slate-200 rounded-lg text-xs" value="${isPresent ? "" : (exp.endDate || "")}">
            ${isPresent ? `<div class="exp-present-badge bg-indigo-50 border border-indigo-200 text-indigo-700 rounded-lg text-xs px-3 py-2 font-semibold">Present</div>` : ""}
          </div>
          
          <div class="col-span-2 space-y-2">
            <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Description (Bullet Points)</label>
            <div class="space-y-1.5 exp-points-container" data-exp-idx="${idx}">
              ${points.map((pt, pIdx) => `
                <div class="flex items-center gap-2" data-point-idx="${pIdx}">
                  <span class="text-slate-400 text-xs select-none shrink-0">•</span>
                  <input type="text" class="exp-point-input flex-1 px-3 py-1.5 border border-slate-200 rounded-lg text-xs" value="${pt.replace(/^[\s\-*•·○■]+/, "").trim()}" placeholder="e.g. Led a team of 4 developers to build the core product">
                  <button type="button" class="remove-exp-point-btn text-slate-300 hover:text-rose-500 p-1" data-exp-idx="${idx}" data-point-idx="${pIdx}">
                    <i data-lucide="x" class="w-4 h-4"></i>
                  </button>
                </div>
              `).join("")}
            </div>
            <button type="button" class="add-exp-point-btn flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition py-1 px-2 rounded hover:bg-indigo-50 mt-1" data-exp-idx="${idx}">
              <i data-lucide="plus" class="w-3.5 h-3.5"></i> Add Point
            </button>
          </div>
        </div>
      </div>
    `;
  }).join("");

  lucide.createIcons();
  bindExperienceInputs();
}

function bindExperienceInputs() {
  const container = document.getElementById("experience-list-container");
  if (!container) return;
  
  container.querySelectorAll(".remove-exp-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.getAttribute("data-idx"));
      resumeData.experience.splice(idx, 1);
      saveState(true);
      renderExperienceFormList();
      renderLivePreview();
    });
  });

  // Bind keyup changes for main text/month fields
  ["company", "role", "start", "end"].forEach(prop => {
    container.querySelectorAll(`.exp-${prop}`).forEach(input => {
      input.addEventListener("input", () => {
        const box = input.closest("[data-idx]");
        const idx = parseInt(box.getAttribute("data-idx"));
        const realProp = prop === "start" ? "startDate" : prop === "end" ? "endDate" : prop;
        resumeData.experience[idx][realProp] = input.value;
        saveState();
        renderLivePreview();
      });
    });
  });

  // Bind currently work here checkbox
  container.querySelectorAll(".exp-present-checkbox").forEach(checkbox => {
    checkbox.addEventListener("change", () => {
      const box = checkbox.closest("[data-idx]");
      const idx = parseInt(box.getAttribute("data-idx"));
      if (checkbox.checked) {
        resumeData.experience[idx].endDate = "Present";
      } else {
        resumeData.experience[idx].endDate = "";
      }
      saveState(true);
      renderExperienceFormList();
      renderLivePreview();
    });
  });

  // Bind individual bullet points
  container.querySelectorAll(".exp-point-input").forEach(input => {
    input.addEventListener("input", () => {
      const expIdx = parseInt(input.closest("[data-exp-idx]").getAttribute("data-exp-idx"));
      const pContainer = input.closest(".exp-points-container");
      const pointInputs = Array.from(pContainer.querySelectorAll(".exp-point-input"));
      const textLines = pointInputs.map(inp => inp.value.trim());
      resumeData.experience[expIdx].description = textLines.join("\n");
      saveState();
      renderLivePreview();
    });
  });

  // Add bullet point
  container.querySelectorAll(".add-exp-point-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const expIdx = parseInt(btn.getAttribute("data-exp-idx"));
      const currentDesc = resumeData.experience[expIdx].description || "";
      const lines = currentDesc.split(/\r?\n/).map(l => l.trim());
      lines.push(""); // append an empty item
      resumeData.experience[expIdx].description = lines.join("\n");
      saveState(true);
      renderExperienceFormList();
      renderLivePreview();
      
      // Focus on the newly added input
      const newPoints = container.querySelectorAll(`[data-exp-idx="${expIdx}"] .exp-point-input`);
      if (newPoints.length > 0) {
        newPoints[newPoints.length - 1].focus();
      }
    });
  });

  // Remove bullet point
  container.querySelectorAll(".remove-exp-point-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const expIdx = parseInt(btn.getAttribute("data-exp-idx"));
      const pointIdx = parseInt(btn.getAttribute("data-point-idx"));
      const currentDesc = resumeData.experience[expIdx].description || "";
      const lines = currentDesc.split(/\r?\n/).map(l => l.trim());
      lines.splice(pointIdx, 1);
      resumeData.experience[expIdx].description = lines.join("\n");
      saveState(true);
      renderExperienceFormList();
      renderLivePreview();
    });
  });
}

document.getElementById("add-experience-btn").addEventListener("click", () => {
  if (!resumeData.experience) resumeData.experience = [];
  resumeData.experience.push({ company: "", role: "", startDate: "", endDate: "", description: "" });
  saveState(true);
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
          <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Specialization / Branch</label>
          <input type="text" class="edu-specialization w-full px-3 py-2 border border-slate-200 rounded-lg text-xs" placeholder="e.g. Computer Science & Engineering" value="${edu.specialization || ""}">
        </div>
        <div>
          <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">CGPA / Percentage</label>
          <input type="text" class="edu-cgpa w-full px-3 py-2 border border-slate-200 rounded-lg text-xs" placeholder="e.g. 9.2 CGPA or 85%" value="${edu.cgpa || edu.gpa || ""}">
        </div>
        <div>
          <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Start Year</label>
          <input type="text" class="edu-start w-full px-3 py-2 border border-slate-200 rounded-lg text-xs" placeholder="e.g. 2018" value="${edu.startDate || ""}">
        </div>
        <div>
          <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">End Year</label>
          <input type="text" class="edu-end w-full px-3 py-2 border border-slate-200 rounded-lg text-xs" placeholder="e.g. 2022" value="${edu.endDate || ""}">
        </div>
      </div>
    </div>
  `).join("");

  lucide.createIcons();
  bindEducationInputs();
}

function bindEducationInputs() {
  const container = document.getElementById("education-list-container");
  if (!container) return;
  
  container.querySelectorAll(".remove-edu-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.getAttribute("data-idx"));
      resumeData.education.splice(idx, 1);
      saveState(true);
      renderEducationFormList();
      renderLivePreview();
    });
  });

  ["inst", "degree", "specialization", "start", "end", "cgpa"].forEach(prop => {
    container.querySelectorAll(`.edu-${prop}`).forEach(input => {
      input.addEventListener("input", () => {
        const box = input.closest("[data-idx]");
        const idx = parseInt(box.getAttribute("data-idx"));
        const realProp = prop === "inst" ? "institution" : prop === "start" ? "startDate" : prop === "end" ? "endDate" : prop;
        resumeData.education[idx][realProp] = input.value;
        if (prop === "cgpa") {
          resumeData.education[idx].gpa = input.value; // set gpa for backwards compatibility
        }
        saveState();
        renderLivePreview();
      });
    });
  });
}

document.getElementById("add-education-btn").addEventListener("click", () => {
  if (!resumeData.education) resumeData.education = [];
  resumeData.education.push({ institution: "", degree: "", startDate: "", endDate: "" });
  saveState(true);
  renderEducationFormList();
  renderLivePreview();
});

// Render Projects forms
function renderProjectsFormList() {
  const container = document.getElementById("projects-list-container");
  const list = resumeData.projects || [];

  container.innerHTML = list.map((proj, idx) => {
    const isPresent = proj.endDate === "Present";
    const desc = proj.description || "";
    const points = desc.split(/\r?\n/).map(line => line.trim());
    if (points.length === 0) points.push("");

    return `
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
          <div>
            <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Start Month & Year</label>
            <input type="month" class="proj-start w-full px-3 py-2 border border-slate-200 rounded-lg text-xs" value="${proj.startDate || ""}">
          </div>
          <div>
            <div class="flex justify-between items-center">
              <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">End Month & Year</label>
              <label class="inline-flex items-center gap-1 cursor-pointer text-[10px] text-indigo-600 font-bold">
                <input type="checkbox" class="proj-present-checkbox rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 mr-1" ${isPresent ? "checked" : ""}> Ongoing
              </label>
            </div>
            <input type="${isPresent ? "hidden" : "month"}" class="proj-end w-full px-3 py-2 border border-slate-200 rounded-lg text-xs" value="${isPresent ? "" : (proj.endDate || "")}">
            ${isPresent ? `<div class="proj-present-badge bg-indigo-50 border border-indigo-200 text-indigo-700 rounded-lg text-xs px-3 py-2 font-semibold">Ongoing / Present</div>` : ""}
          </div>
          <div class="col-span-2">
            <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Technologies / Skills used (comma-separated)</label>
            <input type="text" class="proj-skills w-full px-3 py-2 border border-slate-200 rounded-lg text-xs" value="${proj.skills || ""}" placeholder="e.g. React, TailwindCSS, Node.js">
          </div>
          
          <div class="col-span-2 space-y-2">
            <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Project Details (Bullet Points)</label>
            <div class="space-y-1.5 proj-points-container" data-proj-idx="${idx}">
              ${points.map((pt, pIdx) => `
                <div class="flex items-center gap-2" data-point-idx="${pIdx}">
                  <span class="text-slate-400 text-xs select-none shrink-0">•</span>
                  <input type="text" class="proj-point-input flex-1 px-3 py-1.5 border border-slate-200 rounded-lg text-xs" value="${pt.replace(/^[\s\-*•·○■]+/, "").trim()}" placeholder="e.g. Architected responsive dashboards using React and Tailwind.">
                  <button type="button" class="remove-proj-point-btn text-slate-300 hover:text-rose-500 p-1" data-proj-idx="${idx}" data-point-idx="${pIdx}">
                    <i data-lucide="x" class="w-4 h-4"></i>
                  </button>
                </div>
              `).join("")}
            </div>
            <button type="button" class="add-proj-point-btn flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition py-1 px-2 rounded hover:bg-indigo-50 mt-1" data-proj-idx="${idx}">
              <i data-lucide="plus" class="w-3.5 h-3.5"></i> Add Point
            </button>
          </div>
        </div>
      </div>
    `;
  }).join("");

  lucide.createIcons();
  bindProjectsInputs();
}

function bindProjectsInputs() {
  const container = document.getElementById("projects-list-container");
  if (!container) return;

  container.querySelectorAll(".remove-proj-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.getAttribute("data-idx"));
      resumeData.projects.splice(idx, 1);
      saveState(true);
      renderProjectsFormList();
      renderLivePreview();
    });
  });

  // Bind direct inputs
  ["title", "link", "start", "end", "skills"].forEach(prop => {
    container.querySelectorAll(`.proj-${prop}`).forEach(input => {
      input.addEventListener("input", () => {
        const box = input.closest("[data-idx]");
        const idx = parseInt(box.getAttribute("data-idx"));
        const realProp = prop === "start" ? "startDate" : prop === "end" ? "endDate" : prop;
        resumeData.projects[idx][realProp] = input.value;
        saveState();
        renderLivePreview();
      });
    });
  });

  // Bind ongoing checkbox
  container.querySelectorAll(".proj-present-checkbox").forEach(checkbox => {
    checkbox.addEventListener("change", () => {
      const box = checkbox.closest("[data-idx]");
      const idx = parseInt(box.getAttribute("data-idx"));
      if (checkbox.checked) {
        resumeData.projects[idx].endDate = "Present";
      } else {
        resumeData.projects[idx].endDate = "";
      }
      saveState(true);
      renderProjectsFormList();
      renderLivePreview();
    });
  });

  // Bind individual bullet inputs
  container.querySelectorAll(".proj-point-input").forEach(input => {
    input.addEventListener("input", () => {
      const projIdx = parseInt(input.closest("[data-proj-idx]").getAttribute("data-proj-idx"));
      const pContainer = input.closest(".proj-points-container");
      const pointInputs = Array.from(pContainer.querySelectorAll(".proj-point-input"));
      const textLines = pointInputs.map(inp => inp.value.trim());
      resumeData.projects[projIdx].description = textLines.join("\n");
      saveState();
      renderLivePreview();
    });
  });

  // Add bullet point
  container.querySelectorAll(".add-proj-point-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const projIdx = parseInt(btn.getAttribute("data-proj-idx"));
      const currentDesc = resumeData.projects[projIdx].description || "";
      const lines = currentDesc.split(/\r?\n/).map(l => l.trim());
      lines.push("");
      resumeData.projects[projIdx].description = lines.join("\n");
      saveState(true);
      renderProjectsFormList();
      renderLivePreview();
      
      const newInputs = container.querySelectorAll(`[data-proj-idx="${projIdx}"] .proj-point-input`);
      if (newInputs.length > 0) {
        newInputs[newInputs.length - 1].focus();
      }
    });
  });

  // Remove bullet point
  container.querySelectorAll(".remove-proj-point-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const projIdx = parseInt(btn.getAttribute("data-proj-idx"));
      const pointIdx = parseInt(btn.getAttribute("data-point-idx"));
      const currentDesc = resumeData.projects[projIdx].description || "";
      const lines = currentDesc.split(/\r?\n/).map(l => l.trim());
      lines.splice(pointIdx, 1);
      resumeData.projects[projIdx].description = lines.join("\n");
      saveState(true);
      renderProjectsFormList();
      renderLivePreview();
    });
  });
}

document.getElementById("add-projects-btn").addEventListener("click", () => {
  if (!resumeData.projects) resumeData.projects = [];
  resumeData.projects.push({ title: "", link: "", startDate: "", endDate: "", description: "", skills: "" });
  saveState(true);
  renderProjectsFormList();
  renderLivePreview();
});

// Render dynamic Skills & Languages categories (allowing subheadings to be added and edited)
function renderSkillsTagsContainers() {
  if (!Array.isArray(resumeData.skills)) {
    if (resumeData.skills && typeof resumeData.skills === "object") {
      resumeData.skills = [
        { id: "technical", title: "Technical Skills", skills: resumeData.skills.technical || [] },
        { id: "soft", title: "Soft Skills", skills: resumeData.skills.soft || [] },
        { id: "languages", title: "Languages", skills: resumeData.skills.languages || [] }
      ];
    } else {
      resumeData.skills = [];
    }
  }
  const skillSectionsList = resumeData.skills;

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
    if (titleInput) {
      titleInput.addEventListener("input", (e) => {
        sec.title = e.target.value;
        saveState();
        renderLivePreview();
      });
    }

    // Skills tag adding listener
    const tagInput = box.querySelector(".skill-sec-input");
    if (tagInput) {
      tagInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === ",") {
          e.preventDefault();
          const val = tagInput.value.replace(/,/g, "").trim();
          if (val) {
            if (!sec.skills) sec.skills = [];
            if (!sec.skills.includes(val)) {
              sec.skills.push(val);
              saveState(true);
              renderSkillsTagsContainers();
              renderLivePreview();
            }
          }
          tagInput.value = "";
        }
      });
    }

    // Tag removal
    box.querySelectorAll(".remove-skill-tag").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const tagIdx = parseInt(btn.getAttribute("data-tag-idx"));
        sec.skills.splice(tagIdx, 1);
        saveState(true);
        renderSkillsTagsContainers();
        renderLivePreview();
      });
    });

    // Section deletion
    const deleteBtn = box.querySelector(".delete-skill-section");
    if (deleteBtn) {
      deleteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        skillSectionsList.splice(secIdx, 1);
        saveState(true);
        renderSkillsTagsContainers();
        renderLivePreview();
      });
    }
  });
}

// Add skill section click registration
document.getElementById("add-skill-section-btn").addEventListener("click", () => {
  if (!Array.isArray(resumeData.skills)) {
    if (resumeData.skills && typeof resumeData.skills === "object") {
      resumeData.skills = [
        { id: "technical", title: "Technical Skills", skills: resumeData.skills.technical || [] },
        { id: "soft", title: "Soft Skills", skills: resumeData.skills.soft || [] },
        { id: "languages", title: "Languages", skills: resumeData.skills.languages || [] }
      ];
    } else {
      resumeData.skills = [];
    }
  }
  const skillSectionsList = resumeData.skills;

  skillSectionsList.push({
    id: "custom_" + Date.now(),
    title: "New Skill Subheading",
    skills: []
  });

  saveState(true);
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
      saveState(true);
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
  saveState(true);
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
      saveState(true);
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
  saveState(true);
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
  if (!container) return;

  container.querySelectorAll(".remove-cs-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.getAttribute("data-idx"));
      resumeData.customSections.splice(idx, 1);
      saveState(true);
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

  const defaultOrder = ["summary", "experience", "education", "projects", "skills", "certifications", "achievements", "custom"];
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
    certifications: "Certifications",
    achievements: "Awards & Achievements",
    custom: "Custom Sections"
  };

  const activeTemplateId = resumeData.templateId || "modern_ats";
  const isSidebar = activeTemplateId === "creative" || activeTemplateId === "sidebar_resume" || activeTemplateId === "designer_resume" || activeTemplateId === "colorful_resume" || activeTemplateId === "minimal_split";
  const isRightTwoCol = activeTemplateId === "executive" || activeTemplateId === "developer_resume" || activeTemplateId === "data_analyst_resume" || activeTemplateId === "luxury" || activeTemplateId === "executive_columnar";
  const isTwoColumn = isSidebar || isRightTwoCol;

  container.innerHTML = resumeData.sectionOrder.map((key, idx) => {
    let colToggleHtml = "";
    if (isTwoColumn) {
      if (!resumeData.sectionColumns) {
        resumeData.sectionColumns = {};
      }
      const currentCol = resumeData.sectionColumns[key] || (isSidebar ? (["skills", "certifications", "achievements"].includes(key) ? "col1" : "col2") : (["education", "skills"].includes(key) ? "col2" : "col1"));
      
      const label1 = isSidebar ? "Sidebar" : "Left Col";
      const label2 = isSidebar ? "Main Col" : "Right Col";
      
      colToggleHtml = `
        <div class="flex items-center bg-slate-100 p-0.5 rounded-lg text-[10px] border border-slate-200/40 shrink-0">
          <button type="button" class="btn-set-col px-2 py-0.5 rounded-md font-bold transition-all cursor-pointer ${currentCol === 'col1' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-800 bg-transparent'}" data-key="${key}" data-col="col1">
            ${label1}
          </button>
          <button type="button" class="btn-set-col px-2 py-0.5 rounded-md font-bold transition-all cursor-pointer ${currentCol === 'col2' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-800 bg-transparent'}" data-key="${key}" data-col="col2">
            ${label2}
          </button>
        </div>
      `;
    }

    return `
      <div class="flex flex-col sm:flex-row sm:items-center justify-between p-2.5 bg-slate-50 border border-slate-200/60 rounded-xl hover:bg-slate-100/50 gap-2.5 transition-all">
        <div class="flex items-center justify-between sm:justify-start gap-3 flex-1">
          <div class="flex items-center gap-2">
            <span class="text-xs text-slate-400 font-mono font-bold">#${idx + 1}</span>
            <span class="text-xs font-bold text-slate-700">${labels[key]}</span>
          </div>
          ${colToggleHtml}
        </div>
        <div class="flex items-center justify-end gap-1">
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

  // Attach column positioning listeners
  container.querySelectorAll(".btn-set-col").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const key = btn.getAttribute("data-key");
      const col = btn.getAttribute("data-col");
      if (!resumeData.sectionColumns) {
        resumeData.sectionColumns = {};
      }
      resumeData.sectionColumns[key] = col;
      saveState(true);
      renderSectionReorderList();
      renderLivePreview();
    });
  });

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
        saveState(true);
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
        saveState(true);
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
  saveState(true);
  renderCustomSectionsFormList();
  renderLivePreview();
});

// Calculate ATS score metrics based on number of sections filled
function calculateResumeScore() {
  let score = 0;
  let tips = [];

  const p = resumeData.personalInfo || {};

  // 1. Personal Details / Contact (Core Section)
  if (p.fullName && p.jobTitle && (p.email || p.phone)) {
    score += 20;
  } else {
    tips.push("Add complete contact details & professional title");
  }

  // 2. Professional Summary (Core Section)
  if ((resumeData.summary || "").trim().length > 15) {
    score += 15;
  } else {
    tips.push("Add a brief professional summary");
  }

  // 3. Work Experience (Core Section)
  if (resumeData.experience && resumeData.experience.length > 0) {
    score += 20;
  } else {
    tips.push("Add at least one work experience history");
  }

  // 4. Education (Core Section)
  if (resumeData.education && resumeData.education.length > 0) {
    score += 15;
  } else {
    tips.push("Add your academic background under Education");
  }

  // 5. Skills (Core Section)
  let skillsCount = 0;
  if (Array.isArray(resumeData.skills)) {
    skillsCount = resumeData.skills.reduce((acc, curr) => acc + (curr.skills ? curr.skills.length : 0), 0);
  } else if (resumeData.skills && typeof resumeData.skills === "object") {
    skillsCount = (resumeData.skills.technical || []).length + (resumeData.skills.soft || []).length + (resumeData.skills.languages || []).length;
  }
  if (skillsCount > 0) {
    score += 15;
  } else {
    tips.push("Add key professional or technical skills");
  }

  // 6. Projects (Optional / Booster Section)
  if (resumeData.projects && resumeData.projects.length > 0) {
    score += 5;
  } else {
    tips.push("Consider adding key projects to boost visibility");
  }

  // 7. Certifications (Optional / Booster Section)
  if (resumeData.certifications && resumeData.certifications.filter(Boolean).length > 0) {
    score += 5;
  } else {
    tips.push("Consider listing certifications or credentials");
  }

  // 8. Achievements (Optional / Booster Section)
  if (resumeData.achievements && resumeData.achievements.filter(Boolean).length > 0) {
    score += 5;
  } else {
    tips.push("Consider listing awards or professional achievements");
  }

  // Ensure score is clamped between 0 and 100
  score = Math.min(100, Math.max(0, score));

  scorePct.textContent = `${score}%`;
  scoreComplete.textContent = `${score}%`;

  if (score >= 80) {
    scoreAts.textContent = "Excellent";
    scoreAts.className = "font-bold text-emerald-600";
    strengthBadge.textContent = "Strong ATS";
    strengthBadge.className = "px-2.5 py-0.5 bg-emerald-100 text-emerald-700 font-bold text-[10px] rounded-full uppercase tracking-wider";
    scoreTip.innerHTML = `<span class="text-emerald-700 font-bold">✓ Optimized:</span> Your resume is fully complete, professional, and ATS optimized!`;
  } else if (score >= 50) {
    scoreAts.textContent = "Good";
    scoreAts.className = "font-bold text-amber-600";
    strengthBadge.textContent = "Intermediate";
    strengthBadge.className = "px-2.5 py-0.5 bg-amber-100 text-amber-700 font-bold text-[10px] rounded-full uppercase tracking-wider";
    scoreTip.innerHTML = tips.length > 0 
      ? `<div class="font-bold text-slate-700 mb-1">To reach 100%:</div><ul class="list-disc pl-3.5 space-y-0.5 text-slate-500">${tips.slice(0, 3).map(t => `<li>${t}</li>`).join("")}</ul>`
      : "Almost perfect, fill other sections.";
  } else {
    scoreAts.textContent = "Weak";
    scoreAts.className = "font-bold text-rose-600";
    strengthBadge.textContent = "Draft";
    strengthBadge.className = "px-2.5 py-0.5 bg-slate-100 text-slate-700 font-bold text-[10px] rounded-full uppercase tracking-wider";
    scoreTip.innerHTML = tips.length > 0
      ? `<div class="font-bold text-slate-700 mb-1 flex items-center gap-1"><span class="text-rose-500">⚠</span> Critical additions:</div><ul class="list-disc pl-3.5 space-y-0.5 text-slate-500">${tips.slice(0, 3).map(t => `<li>${t}</li>`).join("")}</ul>`
      : "Please start filling in your info.";
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
  const marginsVal = theme.margins || "20px";
  const topMarginVal = theme.topMargin !== undefined ? `${theme.topMargin}px` : marginsVal;
  a4Preview.style.paddingTop = topMarginVal;
  a4Preview.style.paddingBottom = marginsVal;
  a4Preview.style.paddingLeft = marginsVal;
  a4Preview.style.paddingRight = marginsVal;
  
  const fontName = theme.fontFamily || "Inter";
  a4Preview.style.fontFamily = fontName.includes(" ") && !fontName.startsWith("'") && !fontName.startsWith('"')
    ? `'${fontName}', sans-serif`
    : `${fontName}, sans-serif`;
    
  a4Preview.style.fontSize = theme.fontSize || "14px";
  a4Preview.style.lineHeight = theme.lineHeight || "1.5";
  a4Preview.style.setProperty("--resume-line-height", theme.lineHeight || "1.5");
  a4Preview.className = "resume-preview-container";

  const headerAlign = theme.headerAlign || "left"; // "left", "center", "right"
  const hGap = theme.headerGap || "8px";
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

  // Helper to format startDate and endDate for Experience & Projects (Month Year Format)
  const formatMonthYear = (val) => {
    if (!val) return "";
    if (val.toLowerCase() === "present") return "Present";
    const match = val.match(/^(\d{4})-(\d{2})$/);
    if (match) {
      const [_, year, month] = match;
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const mIdx = parseInt(month, 10) - 1;
      if (mIdx >= 0 && mIdx < 12) {
        return `${months[mIdx]} ${year}`;
      }
    }
    return val;
  };

  // Helper to format startDate and endDate for Education (Year-only Format)
  const formatEducationYear = (val) => {
    if (!val) return "";
    const match = val.match(/^(\d{4})-\d{2}$/);
    if (match) return match[1]; // extract only YYYY
    return val;
  };

  // Helper to render section headers consistently, with real hex colors avoiding html2canvas var() shorthand border bugs
  const renderSectionHeader = (title) => `
    <h3 class="text-xs font-extrabold uppercase tracking-widest section-header-underline" style="border-bottom: 2px solid ${theme.primaryColor || '#0f172a'}; color: ${theme.primaryColor || '#0f172a'};">${title}</h3>
  `;

  // Helper to format multiline descriptions or bullet-prefixed text as bullet lists
  const formatDescriptionAsBullets = (text) => {
    if (!text) return "";
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
    if (lines.length === 0) return "";
    
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
    
    return `<div class="space-y-1 mt-1">${bulletItems.join("")}</div>`;
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
        <span class="text-xs text-slate-500 font-semibold">${formatMonthYear(exp.startDate) || 'Start'}${exp.startDate && exp.endDate ? ' - ' : ''}${formatMonthYear(exp.endDate) || 'End'}</span>
      </div>
      <div class="text-xs font-semibold text-indigo-600">${exp.company || 'Company Name'}</div>
      <div class="text-xs leading-relaxed mt-0.5">${formatDescriptionAsBullets(exp.description)}</div>
    </div>
  `).join("");

  // Education content (CGPA & Year-only format)
  const eduHtml = (resumeData.education || []).map(edu => {
    const cgpaVal = edu.cgpa || edu.gpa || "";
    return `
      <div class="flex flex-col gap-1">
        <div class="flex justify-between items-start">
          <h4 class="font-bold text-slate-800 text-sm">
            ${edu.degree || 'Degree / Major'}
            ${edu.specialization ? `<span class="text-slate-500 font-normal">(${edu.specialization})</span>` : ''}
          </h4>
          <span class="text-xs text-slate-500 font-semibold">${formatEducationYear(edu.startDate) || 'Start'}${edu.startDate && edu.endDate ? ' - ' : ''}${formatEducationYear(edu.endDate) || 'End'}</span>
        </div>
        <div class="text-xs flex justify-between items-center mt-0.5">
          <div class="font-semibold text-slate-600">${edu.institution || 'University Name'}</div>
          ${cgpaVal ? `<div class="text-[11px] font-semibold text-slate-500">CGPA/Percentage: <span class="font-bold text-slate-700">${cgpaVal}</span></div>` : ''}
        </div>
      </div>
    `;
  }).join("");

  // Projects content with technologies/skills pills and Month-Year start/end dates
  const projHtml = (resumeData.projects || []).map(proj => {
    let techHtml = "";
    if (proj.skills) {
      const skillsList = proj.skills.split(",").map(s => s.trim()).filter(Boolean);
      if (skillsList.length > 0) {
        techHtml = `
          <div class="text-[11px] font-semibold text-slate-500 mt-0.5 mb-0.5">[${skillsList.join(", ")}]</div>
        `;
      }
    }
    const hasDates = proj.startDate || proj.endDate;
    const datesStr = hasDates ? `${formatMonthYear(proj.startDate) || 'Start'}${proj.startDate && proj.endDate ? ' - ' : ''}${formatMonthYear(proj.endDate) || 'End'}` : '';

    return `
      <div class="flex flex-col gap-1">
        <div class="flex justify-between items-start">
          <h4 class="font-bold text-slate-800 text-sm">
            ${proj.title || 'Project Name'}
            ${proj.link ? `<span class="text-[10px] text-indigo-650 font-semibold font-mono hover:underline ml-2 select-all">(${proj.link})</span>` : ''}
          </h4>
          ${datesStr ? `<span class="text-xs text-slate-500 font-semibold shrink-0 ml-4">${datesStr}</span>` : ''}
        </div>
        ${techHtml}
        <div class="text-xs leading-relaxed mt-0.5">${formatDescriptionAsBullets(proj.description)}</div>
      </div>
    `;
  }).join("");

  // Dynamic Skill Categories Normalizer
  // Dynamic Skill Categories Normalizer
  if (!Array.isArray(resumeData.skills)) {
    if (resumeData.skills && typeof resumeData.skills === "object") {
      resumeData.skills = [
        { id: "technical", title: "Technical Skills", skills: resumeData.skills.technical || [] },
        { id: "soft", title: "Soft Skills", skills: resumeData.skills.soft || [] },
        { id: "languages", title: "Languages", skills: resumeData.skills.languages || [] }
      ];
    } else {
      resumeData.skills = [];
    }
  }
  const skillSectionsList = resumeData.skills;

  // Certifications content
  const certsHtml = (resumeData.certifications || []).filter(Boolean).map(cert => `
    <div class="flex items-start gap-1.5 leading-relaxed mt-0.5 text-slate-600">
      <span class="text-slate-400 font-sans shrink-0 mt-1 select-none text-[8px]" style="color: ${theme.primaryColor || '#0f172a'};">•</span>
      <span class="text-xs text-slate-700 font-medium">${cert}</span>
    </div>
  `).join("");

  // Achievements content
  const achsHtml = (resumeData.achievements || []).filter(Boolean).map(ach => `
    <div class="flex items-start gap-1.5 leading-relaxed mt-0.5 text-slate-600">
      <span class="text-slate-400 font-sans shrink-0 mt-1 select-none text-[8px]" style="color: ${theme.primaryColor || '#0f172a'};">•</span>
      <span class="text-xs text-slate-700 font-medium">${ach}</span>
    </div>
  `).join("");

  // Custom sections content
  const customSecsHtml = (resumeData.customSections || []).map(cs => `
    <div class="flex flex-col" style="gap: ${hGap}">
      ${renderSectionHeader(cs.title)}
      <p class="text-xs text-slate-600 leading-relaxed whitespace-pre-line">${cs.description || ''}</p>
    </div>
  `).join(`<div style="height: ${theme.sectionGap || '16px'}"></div>`);

  const isSidebarLayout = templateId === "creative" || templateId === "sidebar_resume" || templateId === "designer_resume" || templateId === "colorful_resume" || templateId === "minimal_split";
  const isTwoColumnRight = templateId === "executive" || templateId === "developer_resume" || templateId === "data_analyst_resume" || templateId === "luxury" || templateId === "executive_columnar";

  const isNarrowCol = (key) => {
    const colVal = resumeData.sectionColumns?.[key] || (isSidebarLayout ? (["skills", "certifications", "achievements"].includes(key) ? "col1" : "col2") : (["education", "skills"].includes(key) ? "col2" : "col1"));
    if (isSidebarLayout && colVal === "col1") return true;
    if (isTwoColumnRight && colVal === "col2") return true;
    return false;
  };

  const sectionContentMap = {
    summary: resumeData.summary ? `
      <div class="flex flex-col" style="gap: ${hGap}">
        ${renderSectionHeader(isSidebarLayout ? "Profile Summary" : "Professional Summary")}
        <p class="text-xs text-slate-600 leading-relaxed">${resumeData.summary}</p>
      </div>
    ` : "",

    experience: (resumeData.experience && resumeData.experience.length > 0) ? `
      <div class="flex flex-col" style="gap: ${hGap}">
        ${renderSectionHeader(isSidebarLayout ? "Professional Experience" : "Work Experience")}
        <div class="flex flex-col gap-3">${expHtml}</div>
      </div>
    ` : "",

    education: (resumeData.education && resumeData.education.length > 0) ? `
      <div class="flex flex-col" style="gap: ${hGap}">
        ${renderSectionHeader("Education")}
        <div class="flex flex-col gap-2.5">${eduHtml}</div>
      </div>
    ` : "",

    projects: (resumeData.projects && resumeData.projects.length > 0) ? `
      <div class="flex flex-col" style="gap: ${hGap}">
        ${renderSectionHeader("Projects")}
        <div class="flex flex-col gap-2.5">${projHtml}</div>
      </div>
    ` : "",

    skills: (skillSectionsList.some(sec => sec.skills && sec.skills.length > 0)) ? `
      <div class="flex flex-col" style="gap: ${hGap}">
        ${renderSectionHeader("Skills")}
        <div style="display: flex; flex-direction: ${isNarrowCol("skills") ? "column" : "row"}; flex-wrap: wrap; gap: ${isNarrowCol("skills") ? "12px" : "16px"};">
          ${skillSectionsList.map(sec => {
            if (!sec.skills || sec.skills.length === 0) return "";
            const tagsHtml = sec.skills.map(s => `
              <span class="px-2 py-0.5 bg-slate-100 text-slate-700 text-xs rounded-md font-semibold">${s}</span>
            `).join(" ");
            return `
              <div style="${isNarrowCol("skills") ? "" : "flex: 1; min-width: 120px;"}" class="flex flex-col gap-1">
                <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider">${sec.title || "Skills Category"}</span>
                <div class="flex flex-wrap gap-1">${tagsHtml}</div>
              </div>
            `;
          }).filter(Boolean).join("")}
        </div>
      </div>
    ` : "",

    certifications: (resumeData.certifications && resumeData.certifications.filter(Boolean).length > 0) ? `
      <div class="flex flex-col" style="gap: ${hGap}">
        ${renderSectionHeader("Certifications")}
        <div class="space-y-1.5">${certsHtml}</div>
      </div>
    ` : "",

    achievements: (resumeData.achievements && resumeData.achievements.filter(Boolean).length > 0) ? `
      <div class="flex flex-col" style="gap: ${hGap}">
        ${renderSectionHeader("Awards & Achievements")}
        <div class="space-y-1.5">${achsHtml}</div>
      </div>
    ` : "",

    custom: customSecsHtml ? customSecsHtml : ""
  };

  // Outer structure builders depending on sidebar layouts
  let innerStructure = "";

  if (isSidebarLayout) {
    // Left narrow sidebar layout
    const col1SectionsHtml = (resumeData.sectionOrder || ["summary", "experience", "education", "projects", "skills", "certifications", "achievements", "custom"])
      .filter(key => {
        const colVal = resumeData.sectionColumns?.[key] || (["skills", "certifications", "achievements"].includes(key) ? "col1" : "col2");
        return colVal === "col1";
      })
      .map(key => sectionContentMap[key])
      .filter(Boolean)
      .join(`<div style="height: ${theme.sectionGap || '16px'}"></div>`);

    const col2SectionsHtml = (resumeData.sectionOrder || ["summary", "experience", "education", "projects", "skills", "certifications", "achievements", "custom"])
      .filter(key => {
        const colVal = resumeData.sectionColumns?.[key] || (["skills", "certifications", "achievements"].includes(key) ? "col1" : "col2");
        return colVal === "col2";
      })
      .map(key => sectionContentMap[key])
      .filter(Boolean)
      .join(`<div style="height: ${theme.sectionGap || '16px'}"></div>`);

    innerStructure = `
      <div class="layout-two-column-left-sidebar" style="display: flex; flex-direction: row; gap: 24px;">
        <!-- Sidebar Col -->
        <div style="width: 240px; flex-shrink: 0; gap: ${theme.sectionGap || '16px'};" class="border-r border-slate-100 pr-5 flex flex-col">
          <div class="flex flex-col gap-2 ${headerAlign === 'center' ? 'items-center text-center' : (headerAlign === 'right' ? 'items-end text-right' : 'items-start text-left')}">
            ${profilePhotoHtml}
            <h2 class="font-extrabold text-slate-800 leading-tight" style="font-size: ${theme.headerSize ? Math.round(theme.headerSize * 0.8) : 18}px; color: ${theme.primaryColor || '#0f172a'}">${p.fullName || 'Alex Rivera'}</h2>
            <div class="text-xs font-semibold text-indigo-600 leading-tight">${p.jobTitle || 'Technical Designer'}</div>
          </div>
          
          <div class="pt-4 flex flex-col gap-1.5 text-xs text-slate-600 ${headerAlign === 'center' ? 'items-center' : (headerAlign === 'right' ? 'items-end' : 'items-start')}">
            ${contactsArr.map(c => `<div class="truncate">${c}</div>`).join("")}
          </div>

          ${col1SectionsHtml}
        </div>

        <!-- Main Body Col -->
        <div style="flex: 1; min-width: 0; gap: ${theme.sectionGap || '16px'};" class="flex flex-col">
          ${col2SectionsHtml}
        </div>
      </div>
    `;
  } else if (isTwoColumnRight) {
    // Right narrow column layout
    const col1SectionsHtml = (resumeData.sectionOrder || ["summary", "experience", "education", "projects", "skills", "certifications", "achievements", "custom"])
      .filter(key => {
        const colVal = resumeData.sectionColumns?.[key] || (["education", "skills"].includes(key) ? "col2" : "col1");
        return colVal === "col1";
      })
      .map(key => sectionContentMap[key])
      .filter(Boolean)
      .join(`<div style="height: ${theme.sectionGap || '16px'}"></div>`);

    const col2SectionsHtml = (resumeData.sectionOrder || ["summary", "experience", "education", "projects", "skills", "certifications", "achievements", "custom"])
      .filter(key => {
        const colVal = resumeData.sectionColumns?.[key] || (["education", "skills"].includes(key) ? "col2" : "col1");
        return colVal === "col2";
      })
      .map(key => sectionContentMap[key])
      .filter(Boolean)
      .join(`<div style="height: ${theme.sectionGap || '16px'}"></div>`);

    innerStructure = `
      <div class="flex flex-col" style="gap: ${theme.sectionGap || '16px'};">
        <!-- Header banner -->
        <div class="flex ${headerAlign === 'center' ? 'flex-col items-center text-center' : (headerAlign === 'right' ? 'flex-row-reverse text-right items-center' : 'flex-row items-center')} justify-between gap-4">
          <div class="flex flex-col gap-1 ${headerAlign === 'center' ? 'items-center text-center' : (headerAlign === 'right' ? 'items-end text-right' : 'items-start text-left')}">
            <h2 class="font-extrabold tracking-tight" style="font-size: ${theme.headerSize || 24}px; color: ${theme.primaryColor || '#0f172a'}">${p.fullName || 'Alex Rivera'}</h2>
            <div class="text-sm font-semibold text-indigo-600">${p.jobTitle || 'Lead Systems Developer'}</div>
            <div class="text-xs text-slate-500 pt-1 flex flex-wrap gap-x-3 gap-y-1 ${contactsAlignClass}">${contactsLine}</div>
          </div>
          ${profilePhotoHtml}
        </div>

        ${dividerLine}

        <div class="layout-two-column-right-narrow" style="display: flex; flex-direction: row; gap: 24px;">
          <!-- Left wide column -->
          <div style="flex: 1; min-width: 0; gap: ${theme.sectionGap || '16px'};" class="flex flex-col">
            ${col1SectionsHtml}
          </div>

          <!-- Right narrow column -->
          <div style="width: 220px; flex-shrink: 0; gap: ${theme.sectionGap || '16px'};" class="flex flex-col border-l border-slate-100 pl-4">
            ${col2SectionsHtml}
          </div>
        </div>
      </div>
    `;
  } else {
    // Default standard One-Column layout (perfect for ATS, Classic, Minimal)
    const orderedSectionsHtml = (resumeData.sectionOrder || ["summary", "experience", "education", "projects", "skills", "certifications", "achievements", "custom"])
      .map(key => sectionContentMap[key])
      .filter(Boolean)
      .join(`<div style="height: ${theme.sectionGap || '16px'}"></div>`);

    innerStructure = `
      <div class="flex flex-col" style="gap: ${theme.sectionGap || '16px'};">
        <!-- Centered Header option -->
        <div class="flex ${headerAlign === 'center' ? 'flex-col items-center text-center' : (headerAlign === 'right' ? 'flex-row-reverse text-right items-center' : 'flex-row items-center')} justify-between gap-4">
          <div class="flex flex-col gap-1 ${headerAlign === 'center' ? 'items-center text-center' : (headerAlign === 'right' ? 'items-end text-right' : 'items-start text-left')}">
            <h2 class="font-extrabold tracking-tight" style="font-size: ${theme.headerSize || 24}px; color: ${theme.primaryColor || '#0f172a'}">${p.fullName || 'Alex Rivera'}</h2>
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
  calculateResumeScore();
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
function saveState(isDiscrete = false) {
  pushHistoryState(isDiscrete);
  if (autosaveService) {
    autosaveService.queueSave(resumeData);
  }
}

// History State Management (Undo/Redo)
function initHistory(initialData) {
  historyStack = [];
  redoStack = [];
  lastHistoryStateStr = JSON.stringify(initialData);
  updateUndoRedoButtons();
}

function pushHistoryState(isDiscrete = false) {
  if (!resumeData) return;
  const currentStateStr = JSON.stringify(resumeData);
  if (currentStateStr === lastHistoryStateStr) return;

  if (isDiscrete) {
    if (historyDebounceTimeout) {
      clearTimeout(historyDebounceTimeout);
      historyDebounceTimeout = null;
    }
    historyStack.push(lastHistoryStateStr);
    if (historyStack.length > MAX_HISTORY_LIMIT) {
      historyStack.shift();
    }
    redoStack = [];
    lastHistoryStateStr = currentStateStr;
    updateUndoRedoButtons();
  } else {
    if (historyDebounceTimeout) {
      clearTimeout(historyDebounceTimeout);
    }
    historyDebounceTimeout = setTimeout(() => {
      historyDebounceTimeout = null;
      if (!resumeData) return;
      const debouncedCurrentStateStr = JSON.stringify(resumeData);
      if (debouncedCurrentStateStr === lastHistoryStateStr) return;
      
      historyStack.push(lastHistoryStateStr);
      if (historyStack.length > MAX_HISTORY_LIMIT) {
        historyStack.shift();
      }
      redoStack = [];
      lastHistoryStateStr = debouncedCurrentStateStr;
      updateUndoRedoButtons();
    }, 1000);
  }
}

function undo() {
  if (historyStack.length === 0) return;
  
  if (historyDebounceTimeout) {
    clearTimeout(historyDebounceTimeout);
    historyDebounceTimeout = null;
  }
  
  const currentStateStr = JSON.stringify(resumeData);
  redoStack.push(currentStateStr);
  
  const prevStateStr = historyStack.pop();
  resumeData = JSON.parse(prevStateStr);
  lastHistoryStateStr = prevStateStr;
  
  // Re-sync all UI components to match restored resumeData
  syncDataToForm();
  renderLivePreview();
  calculateResumeScore();
  updateUndoRedoButtons();
  
  if (autosaveService) {
    autosaveService.queueSave(resumeData);
  }
}

function redo() {
  if (redoStack.length === 0) return;
  
  if (historyDebounceTimeout) {
    clearTimeout(historyDebounceTimeout);
    historyDebounceTimeout = null;
  }
  
  const currentStateStr = JSON.stringify(resumeData);
  historyStack.push(currentStateStr);
  if (historyStack.length > MAX_HISTORY_LIMIT) {
    historyStack.shift();
  }
  
  const nextStateStr = redoStack.pop();
  resumeData = JSON.parse(nextStateStr);
  lastHistoryStateStr = nextStateStr;
  
  // Re-sync all UI components to match restored resumeData
  syncDataToForm();
  renderLivePreview();
  calculateResumeScore();
  updateUndoRedoButtons();
  
  if (autosaveService) {
    autosaveService.queueSave(resumeData);
  }
}

function updateUndoRedoButtons() {
  const undoBtn = document.getElementById("undo-btn");
  const redoBtn = document.getElementById("redo-btn");
  if (undoBtn) undoBtn.disabled = historyStack.length === 0;
  if (redoBtn) redoBtn.disabled = redoStack.length === 0;
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

// Keyboard shortcuts (Ctrl+S, Ctrl+P, Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z)
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
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
    e.preventDefault();
    undo();
  }
  if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
    e.preventDefault();
    redo();
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
        const pointInputs = box.querySelectorAll(".exp-point-input");

        if (companyEl) resumeData.experience[idx].company = companyEl.value;
        if (roleEl) resumeData.experience[idx].role = roleEl.value;
        if (startEl) resumeData.experience[idx].startDate = startEl.value;
        if (endEl && endEl.type !== "hidden") {
          resumeData.experience[idx].endDate = endEl.value;
        }
        if (pointInputs.length > 0) {
          const lines = Array.from(pointInputs).map(inp => inp.value.trim());
          resumeData.experience[idx].description = lines.join("\n");
        }
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
        const specializationEl = box.querySelector(".edu-specialization");
        const startEl = box.querySelector(".edu-start");
        const endEl = box.querySelector(".edu-end");
        const cgpaEl = box.querySelector(".edu-cgpa");

        if (instEl) resumeData.education[idx].institution = instEl.value;
        if (degreeEl) resumeData.education[idx].degree = degreeEl.value;
        if (specializationEl) resumeData.education[idx].specialization = specializationEl.value;
        if (startEl) resumeData.education[idx].startDate = startEl.value;
        if (endEl) resumeData.education[idx].endDate = endEl.value;
        if (cgpaEl) {
          resumeData.education[idx].cgpa = cgpaEl.value;
          resumeData.education[idx].gpa = cgpaEl.value; // sync with legacy gpa field
        }
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
        const startEl = box.querySelector(".proj-start");
        const endEl = box.querySelector(".proj-end");
        const pointInputs = box.querySelectorAll(".proj-point-input");

        if (titleEl) resumeData.projects[idx].title = titleEl.value;
        if (linkEl) resumeData.projects[idx].link = linkEl.value;
        if (skillsEl) resumeData.projects[idx].skills = skillsEl.value;
        if (startEl) resumeData.projects[idx].startDate = startEl.value;
        if (endEl && endEl.type !== "hidden") {
          resumeData.projects[idx].endDate = endEl.value;
        }
        if (pointInputs.length > 0) {
          const lines = Array.from(pointInputs).map(inp => inp.value.trim());
          resumeData.projects[idx].description = lines.join("\n");
        }
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
