// Automatic Synchronizer & Backup Service for ResumeMkr
import { db, handleFirestoreError, OperationType, doc, setDoc } from "./firebase.js";

export class AutoSaveService {
  constructor(resumeId, userId, onStateChangeCallback) {
    this.resumeId = resumeId;
    this.userId = userId;
    this.onStateChange = onStateChangeCallback; // Callback gets: 'saving', 'saved', 'error', 'idle'
    this.timer = null;
    this.pendingData = null;
    this.hasUnsavedChanges = false;
    this.isSaving = false;

    // Window navigation guard
    window.addEventListener('beforeunload', this.handleBeforeUnload.bind(this));
  }

  // Queue data for autosave
  queueSave(resumeData) {
    this.pendingData = { ...resumeData, updatedAt: new Date().toISOString() };
    this.hasUnsavedChanges = true;
    this.onStateChange('idle'); // changes pending

    // Start timer if not running
    if (!this.timer) {
      this.timer = setInterval(() => {
        this.triggerSave();
      }, 5000);
    }
  }

  // Force synchronous save
  async forceSaveNow(resumeData) {
    this.pendingData = { ...resumeData, updatedAt: new Date().toISOString() };
    await this.triggerSave();
  }

  // Perform firestore update
  async triggerSave() {
    if (!this.pendingData || !this.hasUnsavedChanges || this.isSaving) return;

    this.isSaving = true;
    this.onStateChange('saving');

    const dataToSave = { ...this.pendingData };
    const docPath = `resumes/${this.resumeId}`;

    try {
      await setDoc(doc(db, "resumes", this.resumeId), dataToSave, { merge: true });
      this.hasUnsavedChanges = false;
      this.isSaving = false;
      this.onStateChange('saved');
    } catch (err) {
      this.isSaving = false;
      this.onStateChange('error');
      console.error("Autosave Sync Failed", err);
    }
  }

  handleBeforeUnload(e) {
    if (this.hasUnsavedChanges) {
      const msg = "You have unsaved resume updates. Are you sure you want to exit?";
      e.returnValue = msg;
      return msg;
    }
  }

  destroy() {
    if (this.timer) {
      clearInterval(this.timer);
    }
    window.removeEventListener('beforeunload', this.handleBeforeUnload);
  }
}
