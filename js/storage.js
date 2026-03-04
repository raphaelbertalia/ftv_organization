// storage.js
const STORAGE_KEY = "quarta_ch_v2";

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.error("loadState falhou:", e);
    return null;
  }
}

function saveState() {
  try {
    if (typeof state === "undefined" || !state) return;
    state.updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error("saveState falhou:", e);
  }
}

// ✅ expõe global pro app.js
window.loadState = loadState;
window.saveState = saveState;