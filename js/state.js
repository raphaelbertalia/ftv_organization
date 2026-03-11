// state.js

function defaultState() {
  return {
    version: 2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    players: [],
    sessions: [],
    currentSessionId: null,
    matches: [],

    auth: {
      user: null
    }
  };
}

// carrega do localStorage, senão cria do zero
let state = (window.loadState && loadState()) || defaultState();

// garante compatibilidade com estados antigos
if (!state.auth) {
  state.auth = { user: null };
}

// garante campos (compat)
if (!Array.isArray(state.players)) state.players = [];
if (!Array.isArray(state.sessions)) state.sessions = [];
if (!Array.isArray(state.matches)) state.matches = [];
if (typeof state.currentSessionId === "undefined") state.currentSessionId = null;
if (!state.version) state.version = 2;
if (!state.createdAt) state.createdAt = new Date().toISOString();
if (!state.updatedAt) state.updatedAt = new Date().toISOString();

// ✅ expõe global pro app.js
window.state = state;
window.defaultState = defaultState;