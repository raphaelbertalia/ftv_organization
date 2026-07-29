// js/app.js
// Cola aqui toda a “cola” do app: tabs, render players, sessão+duplas, registrar jogo, export/import.
// Depende das funções: loadState/saveState (storage.js), defaultState+state (state.js),
// getCurrentSession/createSession (sessions.js), addMatch (matches.js), renderRanking (ranking.js).

(function () {
    const $ = (id) => document.getElementById(id);

    const Loading = (() => {
        let activeOperations = 0;

        function show(message = "Processando...") {
            const overlay = $("globalLoading");
            const text = $("globalLoadingText");

            activeOperations++;

            if (!overlay) return;

            if (text) {
                text.textContent = message;
            }

            overlay.classList.add("is-visible");
            overlay.setAttribute("aria-hidden", "false");

            document.body.classList.add("app-is-loading");
        }

        function hide() {
            const overlay = $("globalLoading");

            activeOperations = Math.max(
                0,
                activeOperations - 1
            );

            if (activeOperations > 0 || !overlay) {
                return;
            }

            overlay.classList.remove("is-visible");
            overlay.setAttribute("aria-hidden", "true");

            document.body.classList.remove("app-is-loading");
        }

        function forceHide() {
            const overlay = $("globalLoading");

            activeOperations = 0;

            if (!overlay) return;

            overlay.classList.remove("is-visible");
            overlay.setAttribute("aria-hidden", "true");

            document.body.classList.remove("app-is-loading");
        }

        return {
            show,
            hide,
            forceHide
        };
    })();

    let rotationSetupExpanded = false;
    let sessionGamesExpanded = false;

    // helpers locais
    function todayISO() {
        const d = new Date();
        const tz = d.getTimezoneOffset() * 60000;
        return new Date(Date.now() - tz).toISOString().slice(0, 10);
    }
    function uid() {
        return (crypto && crypto.randomUUID) ? crypto.randomUUID() : (Math.random().toString(36).slice(2) + Date.now());
    }

    function getCurrentUser() {
        return state.auth?.user || null;
    }

    function isAdmin() {
        return getCurrentUser()?.role === "admin";
    }

    function isOrganizer() {
        return getCurrentUser()?.role === "organizer";
    }

    function canOperate() {
        const role = getCurrentUser()?.role;
        return role === "admin" || role === "user";
    }

    function canView() {
        return !!getCurrentUser();
    }

    function requireAdmin() {
        if (!isAdmin()) {
            alert("Sem permissão 😅");
            return false;
        }
        return true;
    }

    function requireOperator() {
        const user = getCurrentUser();

        if (!user || user.role === "guest") {
            alert("Modo visitante não pode fazer isso 👀");
            return false;
        }

        if (!canOperate()) {
            alert("Sem permissão 😅");
            return false;
        }

        return true;
    }

    async function apiJson(url, options = {}) {
        const res = await fetch(url, {
            headers: {
                "Content-Type": "application/json",
                ...(options.headers || {})
            },
            ...options
        });

        let data = null;
        try {
            data = await res.json();
        } catch (_) { }

        if (!res.ok) {
            throw new Error(data?.error || `HTTP ${res.status}`);
        }

        return data;
    }

    let dbStatus = {
        ok: false,
        checkedAt: null,
        error: null
    };

    async function checkDbStatus() {
        try {
            const data = await apiJson("/api/test-db");
            dbStatus = {
                ok: !!data?.ok,
                checkedAt: new Date().toISOString(),
                error: null
            };
        } catch (err) {
            dbStatus = {
                ok: false,
                checkedAt: new Date().toISOString(),
                error: err?.message || "Falha ao consultar banco"
            };
        }

        renderDataInfo();
    }

    async function hydrateStateFromDb() {
        const previousViewSessionId = state.viewSessionId ?? null;

        state.sessions = [];
        state.matches = [];
        state.cycles = [];
        state.currentSessionId = null;
        state.currentCycleId = null;
        state.viewSessionId = null;

        try {
            const data = await apiJson("/api/bootstrap");

            state.players = Array.isArray(data.players) ? data.players : [];

            const rawSessions = Array.isArray(data.sessions) ? data.sessions : [];
            const rawPairs = Array.isArray(data.pairs) ? data.pairs : [];
            const rawMatches = Array.isArray(data.matches) ? data.matches : [];
            const rawCycles = Array.isArray(data.cycles) ? data.cycles : [];

            state.matches = rawMatches.map(m => ({
                ...m,
                sessionId: m.sessionId ?? m.session_id ?? null,
                pairAId: m.pairAId ?? m.pair_a_id ?? m.pair_a ?? null,
                pairBId: m.pairBId ?? m.pair_b_id ?? m.pair_b ?? null,
                scoreA: m.scoreA ?? m.score_a ?? null,
                scoreB: m.scoreB ?? m.score_b ?? null,
                scheduleIndex: m.scheduleIndex ?? m.schedule_index ?? null,
                createdAt: m.createdAt ?? m.created_at ?? null
            }));

            state.cycles = rawCycles.map(c => {
                const cycleId = c.id;

                const cyclePairs = rawPairs
                    .filter(p => String(p.cycle_id ?? p.cycleId) === String(cycleId))
                    .map(p => ({
                        id: p.id,
                        p1: p.p1,
                        p2: p.p2,
                        position: p.position
                    }));

                return {
                    ...c,
                    startDate: c.startDate ?? c.start_date ?? null,
                    endDate: c.endDate ?? c.end_date ?? null,
                    createdAt: c.createdAt ?? c.created_at ?? null,
                    pairs: cyclePairs
                };
            });

            const activeCycle = (state.cycles || []).find(
                c => c.status === "em_andamento"
            );

            state.currentCycleId = activeCycle ? activeCycle.id : null;

            state.sessions = rawSessions.map(s => {
                const sessionId = s.id;

                const sessionPairs = rawPairs
                    .filter(p =>
                        String(p.session_id ?? p.sessionId ?? "") === String(sessionId)
                        && !(p.cycle_id ?? p.cycleId)
                    )
                    .map(p => ({
                        id: p.id,
                        p1: p.p1,
                        p2: p.p2,
                        position: p.position
                    }));

                let participantIds =
                    s.participantIds ??
                    s.participant_ids ??
                    [];

                if (typeof participantIds === "string") {
                    try {
                        participantIds = JSON.parse(participantIds);
                    } catch (_) {
                        participantIds = [];
                    }
                }

                if (!Array.isArray(participantIds)) {
                    participantIds = [];
                }

                const fallbackRoster = [
                    ...new Set(
                        sessionPairs.flatMap(pair => [pair.p1, pair.p2])
                    )
                ];

                if (!participantIds.length) {
                    participantIds = fallbackRoster;
                }

                const playMode =
                    s.playMode ??
                    s.play_mode ??
                    "fixed";

                const normalized = {
                    ...s,
                    dateISO: s.dateISO ?? s.date_iso ?? null,
                    createdAt: s.createdAt ?? s.created_at ?? null,

                    playMode,
                    participantIds,

                    pendingPairAId:
                        s.pendingPairAId ??
                        s.pending_pair_a_id ??
                        null,

                    pendingPairBId:
                        s.pendingPairBId ??
                        s.pending_pair_b_id ??
                        null,

                    // O ranking ainda usa roster
                    roster: [
                        ...new Set([
                            ...participantIds,
                            ...sessionPairs.flatMap(pair => [pair.p1, pair.p2])
                        ].map(String))
                    ],

                    pairs: sessionPairs
                };

                if (
                    normalized.playMode === "fixed" &&
                    sessionPairs.length === 4
                ) {
                    normalized.schedule =
                        buildScheduleQuartaCH(sessionPairs);
                } else {
                    normalized.schedule = null;
                }

                const sessionMatches = state.matches.filter(
                    m => String(m.sessionId) === String(sessionId)
                );

                const maxIdx = sessionMatches.reduce((acc, m) => {
                    const idx = Number(m.scheduleIndex);
                    return Number.isInteger(idx) ? Math.max(acc, idx) : acc;
                }, -1);

                normalized.nextIndex = maxIdx >= 0 ? maxIdx + 1 : sessionMatches.length;

                return normalized;
            });

            // 🔥 agora quem manda é o banco
            const activeSession = (state.sessions || []).find(
                s => s.status === "em_andamento"
            );

            state.currentSessionId = activeSession ? activeSession.id : null;

            const viewedStillExists = state.sessions.some(
                s => String(s.id) === String(previousViewSessionId)
            );

            if (viewedStillExists) {
                state.viewSessionId = previousViewSessionId;
            }

            saveState();
            updateAllSessionUI();
        } catch (err) {
            console.error("Erro carregando dados do banco:", err);
        }
    }

    async function doLogin(username, password) {
        const data = await apiJson("/api/login", {
            method: "POST",
            body: JSON.stringify({ username, password })
        });

        state.auth.user = data.user;
        saveState();
        updateAuthUI();
    }

    function doLogout() {
        state.auth.user = null;
        saveState();
        updateAuthUI();
    }

    function enterGuestMode() {
        state.auth = state.auth || {};
        state.auth.user = { username: "visitante", role: "guest" };
        saveState();
        updateAuthUI();
    }

    function updateAuthUI() {
        const user = getCurrentUser();
        const logged = !!user;
        const guest = user?.role === "guest";
        const organizer = isOrganizer();

        if ($("authStatus")) {
            $("authStatus").innerHTML = user
                ? guest
                    ? `Acesso atual: <span class="guest-badge">visitante</span>`
                    : `Logado como: ${user.username} (${user.role})`
                : "Não logado";
        }

        if ($("loginForm")) {
            $("loginForm").style.display = !logged ? "flex" : "none";
        }

        if ($("logoutBox")) {
            $("logoutBox").style.display = logged && !guest ? "block" : "none";
        }

        if ($("guestLoginBox")) {
            $("guestLoginBox").style.display = guest ? "block" : "none";
        }

        if ($("btnRankingOnly")) {
            $("btnRankingOnly").style.display = !logged ? "inline-block" : "none";
        }

        if ($("guestBanner")) {
            $("guestBanner").style.display = guest ? "block" : "none";
        }

        const jogosTab = document.querySelector('.tab[data-tab="jogos"]');
        const sessoesTab = document.querySelector('.tab[data-tab="sessoes"]');
        const rankingTab = document.querySelector('.tab[data-tab="ranking"]');
        const jogadoresTab = document.querySelector('.tab[data-tab="jogadores"]');
        const dadosTab = document.querySelector('.tab[data-tab="dados"]');
        const cicloTab = document.querySelector('.tab[data-tab="ciclo"]');
        const sorteiosTab = document.querySelector('.tab[data-tab="sorteios"]');

        if (jogosTab) {
            jogosTab.style.display =
                logged && !guest && !organizer
                    ? "inline-block"
                    : "none";
        }

        if (sessoesTab) {
            sessoesTab.style.display =
                logged && !guest && !organizer
                    ? "inline-block"
                    : "none";
        }

        if (rankingTab) {
            rankingTab.style.display =
                organizer
                    ? "none"
                    : "inline-block";
        }

        if (sorteiosTab) {
            sorteiosTab.style.display =
                organizer || isAdmin()
                    ? "inline-block"
                    : "none";
        }

        if (jogadoresTab) {
            jogadoresTab.style.display = isAdmin() ? "inline-block" : "none";
        }

        if (dadosTab) {
            dadosTab.style.display = isAdmin() ? "inline-block" : "none";
        }

        if (cicloTab) {
            cicloTab.style.display = isAdmin() ? "inline-block" : "none";
        }

        // Esconde os indicadores do topo para o organizer
        if ($("todayLabel")?.parentElement) {
            $("todayLabel").parentElement.style.display =
                organizer ? "none" : "inline-flex";
        }

        if ($("todayGames")?.parentElement) {
            $("todayGames").parentElement.style.display =
                organizer ? "none" : "inline-flex";
        }

        if ($("activeCount")?.parentElement) {
            $("activeCount").parentElement.style.display =
                organizer ? "none" : "inline-flex";
        }

        if ($("statusLine")) {
            $("statusLine").style.display =
                organizer ? "none" : "block";
        }

        if ($("btnStartSession")) {
            $("btnStartSession").style.display =
                canOperate() ? "inline-block" : "none";
        }

        if ($("btnAddMatch")) {
            $("btnAddMatch").disabled = !canOperate();
        }

        if ($("btnUndo")) {
            $("btnUndo").style.display =
                isAdmin() ? "inline-block" : "none";
        }

        if ($("btnAddPlayer")) {
            $("btnAddPlayer").style.display =
                isAdmin() ? "inline-block" : "none";
        }

        if ($("btnActivateAll")) {
            $("btnActivateAll").style.display =
                isAdmin() ? "inline-block" : "none";
        }

        if ($("btnDeactivateAll")) {
            $("btnDeactivateAll").style.display =
                isAdmin() ? "inline-block" : "none";
        }

        if ($("btnReset")) {
            $("btnReset").style.display =
                isAdmin() ? "inline-block" : "none";
        }

        if ($("btnResetKeepPlayers")) {
            $("btnResetKeepPlayers").style.display =
                isAdmin() ? "inline-block" : "none";
        }

        if ($("btnCheckDb")) {
            $("btnCheckDb").style.display =
                isAdmin() ? "inline-block" : "none";
        }

        updateHomeLayout();
        renderMatchHistory();
    }

    function buildScheduleQuartaCH(pairs) {
        if (!pairs || pairs.length !== 4) return null;

        const [p1, p2, p3, p4] = pairs;

        return [
            { a: { type: "pair", id: p1.id }, b: { type: "pair", id: p2.id }, label: "Jogo 1" },
            { a: { type: "pair", id: p3.id }, b: { type: "pair", id: p4.id }, label: "Jogo 2" },
            { a: { type: "winner", match: 1 }, b: { type: "winner", match: 2 }, label: "Jogo 3 (W1 x W2)" },
            { a: { type: "loser", match: 1 }, b: { type: "loser", match: 2 }, label: "Jogo 4 (L1 x L2)" },
            { a: { type: "winner", match: 3 }, b: { type: "winner", match: 4 }, label: "Jogo 5 (W3 x W4)" },
            { a: { type: "loser", match: 3 }, b: { type: "loser", match: 4 }, label: "Jogo 6 (L3 x L4)" },
            { a: { type: "winner", match: 5 }, b: { type: "winner", match: 6 }, label: "Jogo 7 (W5 x W6)" },
            { a: { type: "loser", match: 5 }, b: { type: "loser", match: 6 }, label: "Jogo 8 (L5 x L6)" },
        ];
    }

    // ---------- Tabs ----------
    function showTab(name) {
        const user = getCurrentUser();
        const guest = user?.role === "guest";
        const organizer = isOrganizer();

        if (!user) {
            name = "ranking";
        }

        if (guest && name !== "ranking") {
            name = "ranking";
        }

        if (organizer && name !== "sorteios") {
            name = "sorteios";
        }

        if (name === "sessoes" && (!user || guest)) {
            name = "ranking";
        }

        if ((name === "jogadores" || name === "dados" || name === "ciclo") && !isAdmin()) {
            name = user && !guest ? "jogos" : "ranking";
        }

        if (name === "jogos" && (!user || guest)) {
            name = "ranking";
        }

        document.querySelectorAll('[id^="tab-"]').forEach((el) => (el.style.display = "none"));
        document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));

        const tabEl = document.getElementById(`tab-${name}`);
        if (tabEl) tabEl.style.display = "block";

        const btn = document.querySelector(`.tab[data-tab="${name}"]`);
        if (btn) btn.classList.add("active");

        if (name === "ranking") window.renderRanking();
        if (name === "sessoes") renderSessionsTab();
        if (name === "jogadores") renderPlayers();
        if (name === "dados") renderDataInfo();
        if (name === "ciclo") renderCycleTab();
        if (name === "sorteios") {
            window.renderChampionshipDrawsTab();
        }
    }

    document.querySelectorAll(".tab").forEach((t) => {
        t.addEventListener("click", () => showTab(t.dataset.tab));
    });

    // ---------- Top stats ----------
    function updateTopStats() {
        const t = todayISO();
        if ($("todayLabel")) $("todayLabel").textContent = t;
        if ($("todayGames")) $("todayGames").textContent = String((state.matches || []).filter((m) => m.dateISO === t).length);
        if ($("activeCount")) $("activeCount").textContent = String((state.players || []).filter((p) => p.active).length);
        if ($("statusLine")) $("statusLine").textContent = `Jogadores: ${(state.players || []).length} • Jogos: ${(state.matches || []).length}`;
    }

    function updateHomeLayout() {
        const user = getCurrentUser();
        const logged = !!user;
        const guest = user?.role === "guest";
        const hasActiveSession = !!getCurrentSession();

        if ($("loginScreen")) {
            $("loginScreen").style.display = (!logged || guest) ? "block" : "none";
        }

        if ($("appContent")) {
            $("appContent").style.display = logged ? "block" : "none";
        }

        if ($("headerUserBox")) {
            $("headerUserBox").style.display = logged ? "inline-flex" : "none";
        }

        if ($("btnHeaderLogout")) {
            $("btnHeaderLogout").style.display = logged && !guest ? "inline-block" : "none";
        }

        if ($("headerUserText")) {
            if (!logged) {
                $("headerUserText").textContent = "";
            } else if (guest) {
                $("headerUserText").textContent = "Visitante";
            } else {
                $("headerUserText").textContent = `${user.username} (${user.role})`;
            }
        }

        if ($("sessionSetupCard")) {
            $("sessionSetupCard").style.display = logged && !guest && !hasActiveSession ? "block" : "none";
        }

        if ($("pairsCard")) {
            $("pairsCard").style.display = logged && !guest && !hasActiveSession ? "block" : "none";
        }

        if ($("sessionProgressCard")) {
            $("sessionProgressCard").style.display = logged && !guest && hasActiveSession ? "block" : "none";
        }

        if ($("matchCard")) {
            $("matchCard").style.display = logged && !guest && hasActiveSession ? "block" : "none";
        }

        if ($("historyCard")) {
            $("historyCard").style.display = logged && !guest ? "block" : "none";
        }

        if ($("sessionSummary")) {
            $("sessionSummary").style.display = logged && !guest ? $("sessionSummary").style.display : "none";
        }
    }

    function updateRankingPeriodUI() {
        const period = $("period")?.value || "session";
        const isCustom = period === "custom";

        if ($("fromDateWrap")) {
            $("fromDateWrap").style.display = isCustom ? "block" : "none";
        }

        if ($("toDateWrap")) {
            $("toDateWrap").style.display = isCustom ? "block" : "none";
        }

        if (isCustom) {
            const now = new Date();
            const y = now.getFullYear();
            const m = String(now.getMonth() + 1).padStart(2, "0");
            const firstDay = `${y}-${m}-01`;

            if ($("fromDate") && !$("fromDate").value) {
                $("fromDate").value = firstDay;
            }

            if ($("toDate") && !$("toDate").value) {
                $("toDate").value = todayISO();
            }
        }
    }

    // ---------- Players ----------
    function renderPlayers() {
        const wrap = $("playersList");
        if (!wrap) return;

        wrap.innerHTML = "";

        const players = (state.players || [])
            .slice()
            .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

        players.forEach((p) => {
            const div = document.createElement("div");
            div.className = "player-item";

            const chk = document.createElement("input");
            chk.type = "checkbox";
            chk.checked = !!p.active;
            chk.addEventListener("change", async () => {
                p.active = chk.checked;
                saveState();
                renderPairsEditor();
                updateTopStats();

                await apiJson("/api/players", {
                    method: "POST",
                    body: JSON.stringify({
                        id: p.id,
                        name: p.name,
                        active: p.active,
                        side: p.side || ""
                    })
                });
            });

            const name = document.createElement("input");
            name.value = p.name || "";
            name.addEventListener("change", async () => {
                const clean = (name.value || "").trim();
                if (!clean) return;

                p.name = clean;
                saveState();
                renderPairsEditor();
                renderPairSelects();
                window.renderRanking();

                await apiJson("/api/players", {
                    method: "POST",
                    body: JSON.stringify({
                        id: p.id,
                        name: p.name,
                        active: p.active,
                        side: p.side || ""
                    })
                });
            });

            const side = document.createElement("select");
            side.innerHTML = `
            <option value="">Lado</option>
            <option value="left">Esquerdo</option>
            <option value="right">Direito</option>
            <option value="both">Coringa</option>
        `;
            side.value = p.side || "";
            side.addEventListener("change", async () => {
                p.side = side.value;
                saveState();

                await apiJson("/api/players", {
                    method: "POST",
                    body: JSON.stringify({
                        id: p.id,
                        name: p.name,
                        active: p.active,
                        side: p.side || ""
                    })
                });
            });

            const right = document.createElement("div");
            right.className = "right";

            const pill = document.createElement("span");
            pill.className = "pill";
            pill.textContent = p.active ? "ativo" : "inativo";

            const del = document.createElement("span");
            del.className = "link";
            del.textContent = "remover";
            del.addEventListener("click", async () => {
                if (!requireAdmin()) return;

                const used = (state.matches || []).some((m) => {
                    const sess = (state.sessions || []).find((s) => s.id === m.sessionId);
                    if (!sess) return false;

                    const pairA = (sess.pairs || []).find((pair) => pair.id === m.pairAId);
                    const pairB = (sess.pairs || []).find((pair) => pair.id === m.pairBId);

                    const playersInMatch = [
                        pairA?.p1, pairA?.p2,
                        pairB?.p1, pairB?.p2
                    ].filter(Boolean);

                    return playersInMatch.includes(p.id);
                });

                if (used) return alert("Esse jogador já tem jogos no histórico. Desativa ao invés de remover.");
                if (!confirm(`Remover ${p.name}?`)) return;

                state.players = (state.players || []).filter((x) => x.id !== p.id);
                saveState();
                renderPlayers();
                renderPairsEditor();
                renderPairSelects();
                updateTopStats();

                await apiJson("/api/players", {
                    method: "DELETE",
                    body: JSON.stringify({ id: p.id })
                });
            });

            right.appendChild(pill);
            right.appendChild(del);

            div.appendChild(chk);
            div.appendChild(name);
            div.appendChild(side);
            div.appendChild(right);

            wrap.appendChild(div);
        });
    }

    // ---------- Ciclo ----------
    function renderCycleTab() {
        const info = $("cycleInfo");
        const editor = $("cyclePairsEditor");

        if (!info || !editor) return;

        const cycle = getActiveCycle();
        const allCycles = state.cycles || [];

        if (!cycle) {
            info.innerHTML = "<div class='muted'>Nenhum ciclo ativo.</div>";
        } else {
            info.innerHTML = `
            <div><b>${cycle.name}</b></div>
            <div class="muted" style="margin-top:6px;">
                ${cycle.startDate} até ${cycle.endDate}
            </div>
        `;
        }

        const cyclesListHtml = allCycles.length
            ? allCycles.map(c => `
            <div class="player-item" style="justify-content:space-between;">
                <div>
                    <b>${c.name}</b>
                    <div class="muted">${c.startDate} até ${c.endDate}</div>
                </div>
                <div style="display:flex; gap:8px;">
                    <span class="pill">${c.status}</span>
                    <button class="secondary btnDeleteCycleItem" data-id="${c.id}">🗑️</button>
                </div>
            </div>
        `).join("")
            : "<div class='muted'>Nenhum ciclo cadastrado.</div>";

        const pairs = cycle?.pairs || [];

        const pairsHtml = pairs.length
            ? pairs.map((p, i) => {
                const p1 = state.players.find(pl => pl.id === p.p1)?.name || "?";
                const p2 = state.players.find(pl => pl.id === p.p2)?.name || "?";

                return `
                <div class="player-item">
                    <b>Dupla ${i + 1}</b> — ${p1} + ${p2}
                </div>
            `;
            }).join("")
            : "<div class='muted'>Nenhuma dupla do ciclo ativo para exibir.</div>";

        const cycleSessions = cycle
            ? (state.sessions || []).filter(s => {
                const date = s.dateISO;
                return date && cycle.startDate && cycle.endDate
                    && date >= cycle.startDate
                    && date <= cycle.endDate;
            })
            : [];

        const sessionsHtml = cycleSessions.length
            ? cycleSessions.map(s => {
                const matches = getSessionMatches(s);
                const table = computePairTableForSession(s);
                const best = table[0];
                const bestLabel = best ? getPairDisplayName(s, best.pairId) : "—";

                return `
                <div class="player-item" style="justify-content:space-between; gap:12px;">
                    <div>
                        <b>${s.name || "Sem nome"}</b>
                        <div class="muted">${s.dateISO || "-"} • ${matches.length} jogo(s)</div>
                        <div class="muted">🏆 ${bestLabel}</div>
                    </div>
                    <button class="secondary btnViewSession" data-id="${s.id}">Abrir</button>
                </div>
            `;
            }).join("")
            : "<div class='muted'>Nenhuma sessão dentro do ciclo ativo ainda.</div>";

        const cycleStats = new Map();

        pairs.forEach(pair => {
            const p1 = state.players.find(p => p.id === pair.p1)?.name || "?";
            const p2 = state.players.find(p => p.id === pair.p2)?.name || "?";

            cycleStats.set(pair.id, {
                pairId: pair.id,
                label: `${p1} + ${p2}`,
                played: 0,
                wins: 0,
                points: 0,
                pointsFor: 0,
                diff: 0
            });
        });

        cycleSessions.forEach(sess => {
            const table = computePairTableForSession(sess);

            table.forEach(row => {
                const sessionPair = sess.pairs.find(p => p.id === row.pairId);
                if (!sessionPair) return;

                const cyclePair = pairs.find(p =>
                    [p.p1, p.p2].sort().join("|") ===
                    [sessionPair.p1, sessionPair.p2].sort().join("|")
                );

                if (!cyclePair) return;

                const stat = cycleStats.get(cyclePair.id);
                if (!stat) return;

                stat.played += row.played || 0;
                stat.wins += row.wins || 0;
                stat.points += row.points || 0;
                stat.pointsFor += row.pointsFor || 0;
                stat.diff += row.diff || 0;
            });
        });

        const cycleRanking = [...cycleStats.values()]
            .sort((a, b) =>
                (b.points - a.points) ||
                (b.wins - a.wins) ||
                (b.diff - a.diff) ||
                (b.pointsFor - a.pointsFor)
            );

        const cycleRankingHtml = cycleRanking.length
            ? `
                <table class="table" style="margin-top:10px;">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Dupla</th>
                            <th>Pts</th>
                            <th>V</th>
                            <th>J</th>
                            <th>Saldo</th>
                            <th>Pró</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${cycleRanking.map((r, i) => `
                            <tr>
                                <td>${i + 1}</td>
                                <td>${r.label}</td>
                                <td>${r.points}</td>
                                <td>${r.wins}</td>
                                <td>${r.played}</td>
                                <td>${r.diff}</td>
                                <td>${r.pointsFor}</td>
                            </tr>
                        `).join("")}
                    </tbody>
                </table>
            `
            : "<div class='muted'>Sem ranking do ciclo ainda.</div>";

        editor.innerHTML = `
            <div><b>Todos os ciclos</b></div>
            <div style="margin-top:10px;">
                ${cyclesListHtml}
            </div>

            <hr style="margin:16px 0; opacity:.2;">

            <div><b>Duplas do ciclo ativo</b></div>
            <div style="margin-top:10px;">
                ${pairsHtml}
            </div>

            <hr style="margin:16px 0; opacity:.2;">

            <div><b>Ranking do ciclo / Churras</b></div>
            <div style="margin-top:10px;">
                ${cycleRankingHtml}
            </div>

            <hr style="margin:16px 0; opacity:.2;">
            
            <div><b>Resultados do ciclo ativo</b></div>
            <div style="margin-top:10px;">
                ${sessionsHtml}
            </div>
        `;
        renderCyclePairsManualEditor();
    }

    function renderCyclePairsManualEditor() {
        const wrap = $("cyclePairsManualEditor");
        if (!wrap) return;

        const players = (state.players || [])
            .filter(p => p.active)
            .slice()
            .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

        const makeSelect = (id) => {
            const sel = document.createElement("select");
            sel.id = id;

            sel.innerHTML = `<option value="">— selecione —</option>`;

            players.forEach(p => {
                const opt = document.createElement("option");
                opt.value = p.id;
                opt.textContent = p.name;
                sel.appendChild(opt);
            });

            return sel;
        };

        wrap.innerHTML = "";

        for (let i = 1; i <= 4; i++) {
            const card = document.createElement("div");
            card.className = "player-item";
            card.style.marginTop = "8px";

            card.innerHTML = `<b>Dupla ${i}</b>`;

            const s1 = makeSelect(`cycle_p${i}_1`);
            const s2 = makeSelect(`cycle_p${i}_2`);

            card.appendChild(s1);
            card.appendChild(s2);

            wrap.appendChild(card);
        }
    }

    function renderChampionshipDrawsTab() {
        const wrap = $("championshipDrawsContent");

        if (!wrap) return;

        wrap.innerHTML = `
        <div class="muted">
            Módulo de sorteios em construção.
        </div>
    `;
    }

    async function addPlayer(name) {
        const clean = (name || "").trim();
        if (!clean) return alert("Nome vazio 😅");

        if ((state.players || []).some((p) => (p.name || "").toLowerCase() === clean.toLowerCase())) {
            return alert("Já tem esse nome.");
        }

        const side = $("newPlayerSide")?.value || "";

        const player = {
            id: uid(),
            name: clean,
            active: true,
            side
        };

        state.players.push(player);
        saveState();
        renderPlayers();
        renderPairsEditor();
        updateTopStats();

        try {
            await apiJson("/api/players", {
                method: "POST",
                body: JSON.stringify(player)
            });
        } catch (err) {
            console.error("Erro salvando jogador no banco:", err);
        }
    }

    if ($("btnLogin")) {
        $("btnLogin").addEventListener("click", async () => {
            const username = ($("loginUsername")?.value || "").trim();
            const password = ($("loginPassword")?.value || "").trim();

            if (!username || !password) {
                return alert("Preencha usuário e senha.");
            }

            try {
                await doLogin(username, password);
                $("loginPassword").value = "";
                showTab(isOrganizer() ? "sorteios" : "jogos");
                alert("Login feito ✅");
            } catch (err) {
                alert(err.message || "Falha no login");
            }
        });
    }

    if ($("btnShowLogin")) {
        $("btnShowLogin").addEventListener("click", () => {
            state.auth = state.auth || {};
            state.auth.user = null;
            saveState();
            updateAuthUI();
        });
    }

    if ($("btnRankingOnly")) {
        $("btnRankingOnly").addEventListener("click", () => {
            enterGuestMode();
            showTab("ranking");
        });
    }

    if ($("btnLogout")) {
        $("btnLogout").addEventListener("click", async () => {
            await doLogout();
            showTab("ranking");
            alert("Saiu da conta.");
        });
    }

    if ($("btnHeaderLogout")) {
        $("btnHeaderLogout").addEventListener("click", async () => {
            await doLogout();
            showTab("ranking");
            alert("Saiu da conta.");
        });
    }

    if ($("btnAddPlayer")) {
        $("btnAddPlayer").addEventListener("click", async () => {
            if (!requireAdmin()) return;
            await addPlayer($("newPlayerName").value);
            $("newPlayerName").value = "";
            $("newPlayerName").focus();
        });
    }

    if ($("btnActivateAll")) {
        $("btnActivateAll").addEventListener("click", async () => {
            if (!requireAdmin()) return;
            (state.players || []).forEach((p) => (p.active = true));
            saveState();
            renderPlayers();
            renderPairsEditor();
            updateTopStats();

            await Promise.allSettled(
                (state.players || []).map((p) =>
                    apiJson("/api/players", {
                        method: "POST",
                        body: JSON.stringify({
                            id: p.id,
                            name: p.name,
                            active: true
                        })
                    })
                )
            );
        });
    }

    if ($("btnDeactivateAll")) {
        $("btnDeactivateAll").addEventListener("click", async () => {
            if (!requireAdmin()) return;
            (state.players || []).forEach((p) => (p.active = false));
            saveState();
            renderPlayers();
            renderPairsEditor();
            updateTopStats();

            await Promise.allSettled(
                (state.players || []).map((p) =>
                    apiJson("/api/players", {
                        method: "POST",
                        body: JSON.stringify({
                            id: p.id,
                            name: p.name,
                            active: false
                        })
                    })
                )
            );
        });
    }

    // ---------- Sessão + Duplas fixas ----------
    // Editor: 4 duplas (8 jogadores). Depois a gente deixa dinâmico se quiser.
    function renderPairsEditor() {
        const wrap = $("pairsEditor");
        if (!wrap) return;

        const players = (state.players || [])
            .filter((p) => p.active)
            .slice()
            .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

        const makeSelect = (id) => {
            const sel = document.createElement("select");
            sel.id = id;
            sel.disabled = !!getCurrentSession();
            const o0 = document.createElement("option");
            o0.value = "";
            o0.textContent = "— selecione —";
            sel.appendChild(o0);
            players.forEach((p) => {
                const o = document.createElement("option");
                o.value = p.id;
                o.textContent = p.name;
                sel.appendChild(o);
            });
            return sel;
        };

        wrap.innerHTML = "";
        for (let i = 1; i <= 4; i++) {
            const card = document.createElement("div");
            card.className = "card";
            card.style.margin = "8px 0";

            const title = document.createElement("div");
            title.innerHTML = `<b>Dupla ${i}</b>`;
            title.style.marginBottom = "8px";

            const row = document.createElement("div");
            row.className = "row";

            const c1 = document.createElement("div");
            const c2 = document.createElement("div");

            c1.appendChild(makeSelect(`p${i}_1`));
            c2.appendChild(makeSelect(`p${i}_2`));

            row.appendChild(c1);
            row.appendChild(c2);

            card.appendChild(title);
            card.appendChild(row);
            wrap.appendChild(card);
        }
    }

    function updatePairsEditorLock() {
        const sess = getCurrentSession();
        const locked = !!sess;

        const wrap = $("pairsEditor");
        if (!wrap) return;

        wrap.querySelectorAll("select").forEach((sel) => {
            sel.disabled = locked;
        });

        wrap.style.opacity = locked ? "0.7" : "1";
        wrap.style.pointerEvents = locked ? "none" : "auto";
    }

    function renderPairSelects() {
        const sess = (typeof getCurrentSession === "function") ? getCurrentSession() : null;

        const selA = $("pairA");
        const selB = $("pairB");
        if (!selA || !selB) return;

        const fill = (sel, pairs) => {
            sel.innerHTML = "";
            const o0 = document.createElement("option");
            o0.value = "";
            o0.textContent = "— selecione —";
            sel.appendChild(o0);

            pairs.forEach((pr) => {
                const p1 = (state.players || []).find((p) => p.id === pr.p1)?.name || "?";
                const p2 = (state.players || []).find((p) => p.id === pr.p2)?.name || "?";
                const o = document.createElement("option");
                o.value = pr.id;
                o.textContent = `${p1} + ${p2}`;
                sel.appendChild(o);
            });
        };

        if (!sess) {
            fill(selA, []);
            fill(selB, []);
            if ($("sessionActiveLabel")) $("sessionActiveLabel").textContent = "nenhuma";
            return;
        }

        if ($("sessionActiveLabel")) $("sessionActiveLabel").textContent = `${sess.name} (${sess.dateISO})`;
        fill(selA, sess.pairs || []);
        fill(selB, sess.pairs || []);

        if (sess.pendingPairAId) {
            selA.value = String(sess.pendingPairAId);
        }

        if (sess.pendingPairBId) {
            selB.value = String(sess.pendingPairBId);
        }
    }

    function getPlayerName(playerId) {
        return (state.players || []).find(
            player => String(player.id) === String(playerId)
        )?.name || "?";
    }

    function getCurrentParticipantIds(session) {
        const ids = Array.isArray(session?.participantIds)
            ? session.participantIds
            : [];

        return [...new Set(ids.map(String))];
    }

    function fillPlayerSelect(select, participantIds) {
        if (!select) return;

        const currentValue = select.value;

        select.innerHTML = `
        <option value="">— selecione —</option>
    `;

        participantIds
            .map(playerId => ({
                id: playerId,
                name: getPlayerName(playerId)
            }))
            .sort((a, b) => a.name.localeCompare(b.name))
            .forEach(player => {
                const option = document.createElement("option");
                option.value = player.id;
                option.textContent = player.name;
                select.appendChild(option);
            });

        if (
            currentValue &&
            participantIds.some(id => String(id) === String(currentValue))
        ) {
            select.value = currentValue;
        }
    }

    function renderParticipantAdjustment() {
        const session = getCurrentSession();
        const card = $("participantAdjustmentCard");
        const button = $("btnAdjustParticipants");
        const select = $("absentPlayerSelect");

        if (!card || !button || !select) return;

        if (!session) {
            card.style.display = "none";
            button.style.display = "none";
            return;
        }

        button.style.display =
            session.playMode === "fixed"
                ? "inline-block"
                : "none";

        const participantIds = getCurrentParticipantIds(session);

        fillPlayerSelect(select, participantIds);
    }

    function updateRotationRestingPlayers(session) {
        const restingNames = $("rotationRestingNames");
        const restingInfo = $("rotationRestingInfo");

        if (!restingNames || !restingInfo) return;

        if (!session || session.playMode !== "rotation") {
            restingInfo.style.display = "none";
            restingNames.textContent = "—";
            return;
        }

        const participantIds = getCurrentParticipantIds(session);

        const selectedIds = [
            $("rotationA1")?.value || "",
            $("rotationA2")?.value || "",
            $("rotationB1")?.value || "",
            $("rotationB2")?.value || ""
        ]
            .filter(Boolean)
            .map(String);

        const uniqueSelectedIds = new Set(selectedIds);

        const restingPlayers = participantIds
            .filter(
                playerId =>
                    !uniqueSelectedIds.has(String(playerId))
            )
            .map(getPlayerName)
            .sort((a, b) => a.localeCompare(b));

        restingInfo.style.display = "flex";

        if (uniqueSelectedIds.size < 4) {
            restingNames.textContent =
                "Selecione os quatro jogadores";
            restingInfo.classList.add("is-waiting");
            return;
        }

        restingInfo.classList.remove("is-waiting");

        restingNames.textContent =
            restingPlayers.length
                ? restingPlayers.join(", ")
                : "Ninguém";
    }

    function renderRotationSetup() {
        const session = getCurrentSession();
        const card = $("rotationSetupCard");
        const setupContent = $("rotationSetupContent");
        const toggleButton = $("btnToggleRotationSetup");

        if (!card) return;

        if (!session || session.playMode !== "rotation") {
            card.style.display = "none";
            rotationSetupExpanded = false;

            if (setupContent) {
                setupContent.style.display = "none";
            }

            if (toggleButton) {
                toggleButton.style.display = "none";
            }

            if ($("rotationRestingInfo")) {
                $("rotationRestingInfo").style.display = "none";
            }

            return;
        }

        const hasPreparedMatch =
            !!session.pendingPairAId &&
            !!session.pendingPairBId;

        /*
         * O card permanece visível no rodízio.
         * Quando já existe jogo preparado, apenas o formulário é recolhido.
         */
        card.style.display = "block";

        if (toggleButton) {
            toggleButton.style.display =
                hasPreparedMatch
                    ? "inline-block"
                    : "none";

            toggleButton.textContent =
                rotationSetupExpanded
                    ? "✖ Fechar alteração"
                    : "✏️ Editar duplas";
        }

        if (setupContent) {
            setupContent.style.display =
                hasPreparedMatch && !rotationSetupExpanded
                    ? "none"
                    : "block";
        }

        const participantIds = getCurrentParticipantIds(session);

        fillPlayerSelect($("rotationA1"), participantIds);
        fillPlayerSelect($("rotationA2"), participantIds);
        fillPlayerSelect($("rotationB1"), participantIds);
        fillPlayerSelect($("rotationB2"), participantIds);

        const participantNames = participantIds
            .map(getPlayerName)
            .sort((a, b) => a.localeCompare(b));

        if ($("rotationParticipantsInfo")) {
            $("rotationParticipantsInfo").textContent =
                `Rodízio com ${participantIds.length} jogadores: ${participantNames.join(", ")}`;
        }

        /*
         * Quando há jogo preparado, recupera os jogadores das duplas
         * para que o botão "Editar duplas" abra tudo preenchido.
         */
        if (hasPreparedMatch) {
            const pairA = (session.pairs || []).find(
                pair =>
                    String(pair.id) ===
                    String(session.pendingPairAId)
            );

            const pairB = (session.pairs || []).find(
                pair =>
                    String(pair.id) ===
                    String(session.pendingPairBId)
            );

            if (pairA && pairB) {
                if ($("rotationA1")) {
                    $("rotationA1").value = String(pairA.p1);
                }

                if ($("rotationA2")) {
                    $("rotationA2").value = String(pairA.p2);
                }

                if ($("rotationB1")) {
                    $("rotationB1").value = String(pairB.p1);
                }

                if ($("rotationB2")) {
                    $("rotationB2").value = String(pairB.p2);
                }
            }
        }

        updateRotationRestingPlayers(session);
    }

    if ($("btnToggleRotationSetup")) {
        $("btnToggleRotationSetup").addEventListener("click", () => {
            rotationSetupExpanded = !rotationSetupExpanded;
            renderRotationSetup();
        });
    }

    [
        "rotationA1",
        "rotationA2",
        "rotationB1",
        "rotationB2"
    ].forEach(selectId => {
        const select = $(selectId);

        if (!select) return;

        select.addEventListener("change", () => {
            updateRotationRestingPlayers(
                getCurrentSession()
            );
        });
    });

    async function persistSessionRotation(session) {
        await apiJson("/api/sessions", {
            method: "PATCH",
            body: JSON.stringify({
                id: session.id,
                play_mode: session.playMode,
                participant_ids: session.participantIds
            })
        });
    }

    async function activateRotationWithAbsentPlayer(absentPlayerId) {
        const session = getCurrentSession();

        if (!session) {
            throw new Error("Nenhuma sessão ativa.");
        }

        if (session.playMode === "rotation") {
            throw new Error("Essa sessão já está em modo de rodízio.");
        }

        const currentParticipants = getCurrentParticipantIds(session);

        if (currentParticipants.length !== 8) {
            throw new Error(
                `A sessão precisa ter 8 participantes antes da remoção. Atualmente possui ${currentParticipants.length}.`
            );
        }

        if (
            !currentParticipants.some(
                id => String(id) === String(absentPlayerId)
            )
        ) {
            throw new Error("O jogador selecionado não pertence à sessão.");
        }

        const remainingParticipants = currentParticipants.filter(
            id => String(id) !== String(absentPlayerId)
        );

        if (remainingParticipants.length !== 7) {
            throw new Error("Não foi possível formar o rodízio com 7 jogadores.");
        }

        const confirmed = confirm(
            `Remover ${getPlayerName(absentPlayerId)} dos próximos jogos e iniciar o rodízio com 7?\n\nOs jogos já registrados serão mantidos.`
        );

        if (!confirmed) return false;

        session.playMode = "rotation";
        session.participantIds = remainingParticipants;
        session.schedule = null;

        /*
         * roster representa todo mundo que fez ou poderia ter feito
         * parte da sessão. Não removemos o ausente daqui para preservar
         * o histórico caso ele já tenha disputado algum jogo.
         */
        session.roster = [
            ...new Set([
                ...(Array.isArray(session.roster) ? session.roster : []),
                ...currentParticipants
            ].map(String))
        ];

        recomputeNextIndex(session);
        saveState();

        await persistSessionRotation(session);

        return true;
    }

    function findExistingSessionPair(session, player1Id, player2Id) {
        const wanted = [String(player1Id), String(player2Id)]
            .sort()
            .join("|");

        return (session.pairs || []).find(pair => {
            const current = [String(pair.p1), String(pair.p2)]
                .sort()
                .join("|");

            return current === wanted;
        }) || null;
    }

    async function findOrCreateSessionPair(session, player1Id, player2Id) {
        const existing = findExistingSessionPair(
            session,
            player1Id,
            player2Id
        );

        if (existing) {
            return existing;
        }

        const pair = {
            id: uid(),
            p1: player1Id,
            p2: player2Id,
            position: (session.pairs || []).length + 1
        };

        session.pairs = session.pairs || [];
        session.pairs.push(pair);

        await apiJson("/api/pairs", {
            method: "POST",
            body: JSON.stringify({
                id: pair.id,
                session_id: session.id,
                p1: pair.p1,
                p2: pair.p2,
                position: pair.position
            })
        });

        return pair;
    }

    function getPlayersFromSessionMatch(session, match) {
        const pairA = (session.pairs || []).find(
            pair => String(pair.id) === String(match.pairAId)
        );

        const pairB = (session.pairs || []).find(
            pair => String(pair.id) === String(match.pairBId)
        );

        if (!pairA || !pairB) {
            return null;
        }

        return {
            pairA: [String(pairA.p1), String(pairA.p2)],
            pairB: [String(pairB.p1), String(pairB.p2)]
        };
    }

    function makePlayersKey(player1Id, player2Id) {
        return [String(player1Id), String(player2Id)]
            .sort()
            .join("|");
    }

    function addMapCount(map, key, amount = 1) {
        map.set(key, (map.get(key) || 0) + amount);
    }

    function getRotationStatistics(session) {
        const participantIds = getCurrentParticipantIds(session);

        const stats = new Map(
            participantIds.map(playerId => [
                String(playerId),
                {
                    playerId: String(playerId),
                    played: 0,
                    lastPlayedIndex: -1
                }
            ])
        );

        const partnerCounts = new Map();
        const opponentCounts = new Map();

        const matches = getSessionMatches(session);

        matches.forEach((match, matchPosition) => {
            const matchPlayers =
                getPlayersFromSessionMatch(session, match);

            if (!matchPlayers) return;

            const scheduleIndex = Number.isInteger(
                Number(match.scheduleIndex)
            )
                ? Number(match.scheduleIndex)
                : matchPosition;

            const allPlayers = [
                ...matchPlayers.pairA,
                ...matchPlayers.pairB
            ];

            allPlayers.forEach(playerId => {
                const playerStat = stats.get(String(playerId));

                /*
                 * O ausente pode ter aparecido antes do rodízio.
                 * Ele não participa das sugestões, mas o histórico
                 * continua preservado.
                 */
                if (!playerStat) return;

                playerStat.played += 1;
                playerStat.lastPlayedIndex = scheduleIndex;
            });

            addMapCount(
                partnerCounts,
                makePlayersKey(
                    matchPlayers.pairA[0],
                    matchPlayers.pairA[1]
                )
            );

            addMapCount(
                partnerCounts,
                makePlayersKey(
                    matchPlayers.pairB[0],
                    matchPlayers.pairB[1]
                )
            );

            matchPlayers.pairA.forEach(playerA => {
                matchPlayers.pairB.forEach(playerB => {
                    addMapCount(
                        opponentCounts,
                        makePlayersKey(playerA, playerB)
                    );
                });
            });
        });

        return {
            participantIds,
            stats,
            partnerCounts,
            opponentCounts,
            matches
        };
    }

    function canPlaySide(player, side) {
        const playerSide = player?.side || "";

        if (!playerSide) {
            return true;
        }

        if (playerSide === "both") {
            return true;
        }

        return playerSide === side;
    }

    function getPairSidePenalty(player1Id, player2Id) {
        const player1 = (state.players || []).find(
            player => String(player.id) === String(player1Id)
        );

        const player2 = (state.players || []).find(
            player => String(player.id) === String(player2Id)
        );

        const validNormal =
            canPlaySide(player1, "left") &&
            canPlaySide(player2, "right");

        const validInverted =
            canPlaySide(player2, "left") &&
            canPlaySide(player1, "right");

        if (validNormal || validInverted) {
            return 0;
        }

        /*
         * Não bloqueia completamente, pois pode haver uma noite
         * sem combinação perfeita de lados.
         */
        return 250;
    }

    function getCombinationGroups(items, size) {
        const result = [];

        function combine(startIndex, current) {
            if (current.length === size) {
                result.push([...current]);
                return;
            }

            for (
                let index = startIndex;
                index < items.length;
                index++
            ) {
                current.push(items[index]);
                combine(index + 1, current);
                current.pop();
            }
        }

        combine(0, []);

        return result;
    }

    function getFourPlayerPairings(players) {
        const [a, b, c, d] = players;

        return [
            {
                pairA: [a, b],
                pairB: [c, d]
            },
            {
                pairA: [a, c],
                pairB: [b, d]
            },
            {
                pairA: [a, d],
                pairB: [b, c]
            }
        ];
    }

    function calculateRotationCandidateScore(
        candidate,
        rotationStats
    ) {
        const {
            stats,
            partnerCounts,
            opponentCounts,
            matches
        } = rotationStats;

        const selectedPlayers = [
            ...candidate.pairA,
            ...candidate.pairB
        ];

        /*
         * Simula a quantidade de jogos depois do próximo confronto.
         * A maior prioridade é deixar todos com números próximos.
         */
        const projectedGames = [
            ...stats.values()
        ].map(playerStat => {
            const willPlay = selectedPlayers.includes(
                playerStat.playerId
            );

            return playerStat.played + (willPlay ? 1 : 0);
        });

        const maxProjected = Math.max(...projectedGames);
        const minProjected = Math.min(...projectedGames);

        let score = 0;

        // Maior peso: equilíbrio de participações.
        score += (maxProjected - minProjected) * 1000;

        // Entre opções equilibradas, prioriza quem jogou menos.
        selectedPlayers.forEach(playerId => {
            score += (stats.get(playerId)?.played || 0) * 80;
        });

        // Evita repetir parceiros.
        score += (
            partnerCounts.get(
                makePlayersKey(
                    candidate.pairA[0],
                    candidate.pairA[1]
                )
            ) || 0
        ) * 120;

        score += (
            partnerCounts.get(
                makePlayersKey(
                    candidate.pairB[0],
                    candidate.pairB[1]
                )
            ) || 0
        ) * 120;

        // Evita repetir adversários.
        candidate.pairA.forEach(playerA => {
            candidate.pairB.forEach(playerB => {
                score += (
                    opponentCounts.get(
                        makePlayersKey(playerA, playerB)
                    ) || 0
                ) * 15;
            });
        });

        // Respeita esquerda, direita e coringa quando possível.
        score += getPairSidePenalty(
            candidate.pairA[0],
            candidate.pairA[1]
        );

        score += getPairSidePenalty(
            candidate.pairB[0],
            candidate.pairB[1]
        );

        /*
         * Pequena penalização para os quatro jogadores do último
         * jogo voltarem juntos imediatamente.
         */
        const lastMatch = matches[matches.length - 1];

        if (lastMatch) {
            const lastMatchPlayers =
                getPlayersFromSessionMatch(
                    getCurrentSession(),
                    lastMatch
                );

            if (lastMatchPlayers) {
                const lastPlayerSet = new Set([
                    ...lastMatchPlayers.pairA,
                    ...lastMatchPlayers.pairB
                ]);

                const repeatedFromLast = selectedPlayers.filter(
                    playerId => lastPlayerSet.has(playerId)
                ).length;

                score += repeatedFromLast * 20;
            }
        }

        /*
         * Pequeno fator aleatório apenas para desempatar opções
         * praticamente iguais.
         */
        score += Math.random();

        return score;
    }

    function suggestNextRotationMatch(session) {
        if (!session || session.playMode !== "rotation") {
            return null;
        }

        const rotationStats = getRotationStatistics(session);

        if (rotationStats.participantIds.length !== 7) {
            throw new Error(
                `O rodízio automático espera 7 participantes. A sessão possui ${rotationStats.participantIds.length}.`
            );
        }

        const groupsOfFour = getCombinationGroups(
            rotationStats.participantIds,
            4
        );

        const candidates = [];

        groupsOfFour.forEach(group => {
            getFourPlayerPairings(group).forEach(pairing => {
                candidates.push({
                    ...pairing,
                    score: calculateRotationCandidateScore(
                        pairing,
                        rotationStats
                    )
                });
            });
        });

        candidates.sort(
            (candidateA, candidateB) =>
                candidateA.score - candidateB.score
        );

        return candidates[0] || null;
    }

    async function prepareAutomaticRotationMatch(session) {
        if (!session || session.playMode !== "rotation") {
            return false;
        }

        const matches = getSessionMatches(session);

        if (matches.length >= 8) {
            return false;
        }

        const suggestion = suggestNextRotationMatch(session);

        if (!suggestion) {
            throw new Error(
                "Não foi possível sugerir o próximo confronto."
            );
        }

        const [
            playerA1,
            playerA2
        ] = suggestion.pairA;

        const [
            playerB1,
            playerB2
        ] = suggestion.pairB;

        /*
         * Preenche também o editor visual. Assim ainda será
         * possível alterar manualmente antes de preparar novamente.
         */
        if ($("rotationA1")) {
            $("rotationA1").value = playerA1;
        }

        if ($("rotationA2")) {
            $("rotationA2").value = playerA2;
        }

        if ($("rotationB1")) {
            $("rotationB1").value = playerB1;
        }

        if ($("rotationB2")) {
            $("rotationB2").value = playerB2;
        }

        updateRotationRestingPlayers(session);

        const pairA = await findOrCreateSessionPair(
            session,
            playerA1,
            playerA2
        );

        const pairB = await findOrCreateSessionPair(
            session,
            playerB1,
            playerB2
        );

        session.pendingPairAId = pairA.id;
        session.pendingPairBId = pairB.id;

        rotationSetupExpanded = false;

        saveState();

        await apiJson("/api/sessions", {
            method: "PATCH",
            body: JSON.stringify({
                id: session.id,
                pending_pair_a_id: pairA.id,
                pending_pair_b_id: pairB.id
            })
        });

        updateAllSessionUI();

        return true;
    }

    async function prepareRotationMatch() {
        const session = getCurrentSession();

        if (!session) {
            throw new Error("Nenhuma sessão ativa.");
        }

        if (session.playMode !== "rotation") {
            throw new Error("A sessão não está em modo de rodízio.");
        }

        const selectedPlayers = [
            $("rotationA1")?.value || "",
            $("rotationA2")?.value || "",
            $("rotationB1")?.value || "",
            $("rotationB2")?.value || ""
        ];

        if (selectedPlayers.some(id => !id)) {
            throw new Error("Selecione os quatro jogadores do próximo jogo.");
        }

        if (new Set(selectedPlayers.map(String)).size !== 4) {
            throw new Error("Cada jogador pode aparecer apenas uma vez no jogo.");
        }

        const participantIds = getCurrentParticipantIds(session);

        const hasInvalidPlayer = selectedPlayers.some(
            playerId =>
                !participantIds.some(
                    participantId =>
                        String(participantId) === String(playerId)
                )
        );

        if (hasInvalidPlayer) {
            throw new Error("Foi selecionado um jogador que não está no rodízio.");
        }

        const pairA = await findOrCreateSessionPair(
            session,
            selectedPlayers[0],
            selectedPlayers[1]
        );

        const pairB = await findOrCreateSessionPair(
            session,
            selectedPlayers[2],
            selectedPlayers[3]
        );

        session.pendingPairAId = pairA.id;
        session.pendingPairBId = pairB.id;

        rotationSetupExpanded = false;

        saveState();

        await apiJson("/api/sessions", {
            method: "PATCH",
            body: JSON.stringify({
                id: session.id,
                pending_pair_a_id: pairA.id,
                pending_pair_b_id: pairB.id
            })
        });

        updateAllSessionUI();
    }

    function readPairsFromEditor() {
        const pairs = [];
        const used = new Set();

        for (let i = 1; i <= 4; i++) {
            const p1 = $(`p${i}_1`)?.value || "";
            const p2 = $(`p${i}_2`)?.value || "";

            if (!p1 || !p2) throw new Error("Preenche todas as duplas.");
            if (p1 === p2) throw new Error("Dupla não pode repetir jogador.");
            if (used.has(p1) || used.has(p2)) throw new Error("Um jogador foi usado em mais de uma dupla.");

            used.add(p1);
            used.add(p2);

            pairs.push({ id: uid(), p1, p2 });
        }

        return pairs;
    }

    function readCyclePairsFromEditor() {
        const pairs = [];
        const used = new Set();

        for (let i = 1; i <= 4; i++) {
            const p1 = $(`cycle_p${i}_1`)?.value || "";
            const p2 = $(`cycle_p${i}_2`)?.value || "";

            if (!p1 || !p2) throw new Error("Preencha todas as duplas do ciclo.");
            if (p1 === p2) throw new Error("Dupla não pode repetir jogador.");
            if (used.has(p1) || used.has(p2)) throw new Error("Um jogador foi usado em mais de uma dupla.");

            used.add(p1);
            used.add(p2);

            pairs.push({ id: uid(), p1, p2 });
        }

        return pairs;
    }

    function shuffleArray(arr) {
        return arr
            .map(item => ({ item, sort: Math.random() }))
            .sort((a, b) => a.sort - b.sort)
            .map(({ item }) => item);
    }

    function drawPairsBySide() {
        if (getCurrentSession()) {
            return alert("Já existe uma sessão ativa.");
        }

        const activePlayers = (state.players || []).filter(p => p.active);

        const lefts = shuffleArray(activePlayers.filter(p => p.side === "left"));
        const rights = shuffleArray(activePlayers.filter(p => p.side === "right"));
        const boths = shuffleArray(activePlayers.filter(p => p.side === "both"));

        while (lefts.length < 4 && boths.length) {
            lefts.push(boths.pop());
        }

        while (rights.length < 4 && boths.length) {
            rights.push(boths.pop());
        }

        if (lefts.length < 4 || rights.length < 4) {
            return alert("Não deu pra formar 4 duplas. Precisa de 4 jogadores para cada lado, usando coringas se necessário.");
        }

        const finalLefts = shuffleArray(lefts).slice(0, 4);
        const finalRights = shuffleArray(rights).slice(0, 4);

        for (let i = 1; i <= 4; i++) {
            const left = finalLefts[i - 1];
            const right = finalRights[i - 1];

            const sel1 = $(`p${i}_1`);
            const sel2 = $(`p${i}_2`);

            if (sel1) sel1.value = left.id;
            if (sel2) sel2.value = right.id;
        }
    }

    if ($("btnStartSession")) {
        $("btnStartSession").addEventListener("click", async () => {
            if (!requireOperator()) return;

            if (getCurrentSession()) {
                return alert("Já existe uma sessão ativa. Finalize a atual antes de iniciar outra.");
            }
            const inputName = ($("sessionName")?.value || "").trim();

            function formatDateBR() {
                const d = new Date();
                const dia = String(d.getDate()).padStart(2, "0");
                const mes = String(d.getMonth() + 1).padStart(2, "0");
                const ano = d.getFullYear();
                return `${dia}-${mes}-${ano}`;
            }

            const name = inputName || `games_${formatDateBR()}`;

            const activeCount = (state.players || []).filter((p) => p.active).length;
            if (activeCount < 4) return alert("Precisa ter pelo menos 4 jogadores ativos.");

            let pairs;

            const cycle = getActiveCycle();

            if (cycle && cycle.pairs && cycle.pairs.length === 4) {
                const game1A = $("cycleGame1PairA")?.value || "";
                const game1B = $("cycleGame1PairB")?.value || "";

                if (!game1A || !game1B) {
                    return alert("Escolha as duas duplas do Jogo 1.");
                }

                if (game1A === game1B) {
                    return alert("O Jogo 1 precisa ter duas duplas diferentes.");
                }

                const pairA = cycle.pairs.find(p => p.id === game1A);
                const pairB = cycle.pairs.find(p => p.id === game1B);

                const remaining = cycle.pairs.filter(
                    p => p.id !== game1A && p.id !== game1B
                );

                pairs = [
                    { ...pairA, id: uid() },
                    { ...pairB, id: uid() },
                    { ...remaining[0], id: uid() },
                    { ...remaining[1], id: uid() }
                ];
            } else {
                try {
                    pairs = readPairsFromEditor();
                } catch (e) {
                    return alert(e.message || "Erro nas duplas.");
                }
            }

            // createSession (sessions.js) deve salvar: {id,name,dateISO,pairs,roster...} e setar currentSessionId
            await createSession(name, pairs);
            const sess = getCurrentSession();
            sess.schedule = buildScheduleQuartaCH(sess.pairs);
            sess.nextIndex = 0;
            saveState();

            if ($("sessionName")) $("sessionName").value = "";

            updateAllSessionUI();
            alert("Sessão iniciada e duplas salvas ✅");
        });
    }

    if ($("btnCreateCycle")) {
        $("btnCreateCycle").addEventListener("click", async () => {
            if (!requireAdmin()) return;

            const name = $("cycleName").value;
            const start = $("cycleStartDate").value;
            const end = $("cycleEndDate").value;

            if (!name || !start || !end) {
                return alert("Preenche tudo 😅");
            }

            try {
                await apiJson("/api/monthly-cycles", {
                    method: "POST",
                    body: JSON.stringify({
                        id: uid(),
                        name,
                        start_date: start,
                        end_date: end,
                        pairs: []
                    })
                });

                await hydrateStateFromDb();
                renderCycleTab();

                alert("Ciclo criado ✅");
            } catch (err) {
                alert(err.message);
            }
        });
    }

    if ($("btnSaveCyclePairs")) {
        $("btnSaveCyclePairs").addEventListener("click", async () => {
            if (!requireAdmin()) return;

            const cycle = getActiveCycle();
            if (!cycle) return alert("Crie um ciclo primeiro.");

            let pairs;
            try {
                pairs = readCyclePairsFromEditor();
            } catch (err) {
                return alert(err.message);
            }

            await apiJson("/api/monthly-cycles", {
                method: "POST",
                body: JSON.stringify({
                    id: cycle.id,
                    name: cycle.name,
                    start_date: cycle.startDate,
                    end_date: cycle.endDate,
                    pairs
                })
            });

            await hydrateStateFromDb();
            renderCycleTab();

            alert("Duplas do ciclo salvas ✅");
        });
    }

    if ($("btnEndCycle")) {
        $("btnEndCycle").addEventListener("click", async () => {
            if (!requireAdmin()) return;

            const cycle = getActiveCycle();
            if (!cycle) return alert("Sem ciclo ativo.");

            if (!confirm(`Finalizar o ciclo "${cycle.name}"?`)) return;

            try {
                await apiJson("/api/monthly-cycles", {
                    method: "PATCH",
                    body: JSON.stringify({
                        id: cycle.id,
                        status: "encerrada"
                    })
                });

                await hydrateStateFromDb();
                renderCycleTab();

                alert("Ciclo finalizado ✅");
            } catch (err) {
                alert(err.message || "Erro ao finalizar ciclo");
            }
        });
    }

    if ($("btnDeleteCycle")) {
        $("btnDeleteCycle").addEventListener("click", async () => {
            if (!requireAdmin()) return;

            const cycle = (state.cycles || []).find(c => c.id === state.currentCycleId);
            if (!cycle) return alert("Sem ciclo ativo.");

            if (!confirm("Excluir ciclo atual?")) return;

            try {
                await apiJson("/api/monthly-cycles", {
                    method: "DELETE",
                    body: JSON.stringify({ id: cycle.id })
                });

                await hydrateStateFromDb();
                renderCycleTab();

                alert("Ciclo removido 🗑️");
            } catch (err) {
                alert(err.message);
            }
        });
    }

    if ($("btnDrawCyclePairs")) {
        $("btnDrawCyclePairs").addEventListener("click", async () => {
            if (!requireAdmin()) return;

            const cycle = (state.cycles || []).find(c => c.id === state.currentCycleId);
            if (!cycle) return alert("Cria um ciclo primeiro.");

            const activePlayers = (state.players || []).filter(p => p.active);

            if (activePlayers.length < 8) {
                return alert("Precisa de pelo menos 8 jogadores ativos.");
            }

            const shuffled = activePlayers
                .sort(() => Math.random() - 0.5)
                .slice(0, 8);

            const pairs = [];

            for (let i = 0; i < 4; i++) {
                pairs.push({
                    id: uid(),
                    p1: shuffled[i * 2].id,
                    p2: shuffled[i * 2 + 1].id
                });
            }

            try {
                await apiJson("/api/monthly-cycles", {
                    method: "POST",
                    body: JSON.stringify({
                        id: cycle.id,
                        name: cycle.name,
                        start_date: cycle.startDate,
                        end_date: cycle.endDate,
                        pairs
                    })
                });

                await hydrateStateFromDb();
                renderCycleTab();

                alert("Duplas sorteadas 🔥");
            } catch (err) {
                alert(err.message);
            }
        });
    }

    if ($("btnDrawPairs")) {
        $("btnDrawPairs").addEventListener("click", () => {
            drawPairsBySide();
        });
    }

    // ---------- Registrar jogo (delegado, funciona mesmo se o botão existir depois) ----------
    document.addEventListener("click", async (ev) => {
        const btn = ev.target.closest?.("#btnAddMatch");
        if (!btn) return;

        if (!requireOperator()) return;

        const sess = getCurrentSession();

        if (!sess) {
            return alert(
                "Inicia uma sessão do dia antes de registrar jogos."
            );
        }

        const pairAId = $("pairA")?.value || "";
        const pairBId = $("pairB")?.value || "";

        if (!pairAId || !pairBId) {
            return alert("Escolhe Dupla A e Dupla B.");
        }

        if (pairAId === pairBId) {
            return alert(
                "Não dá pra jogar contra a mesma dupla 😅"
            );
        }

        const scoreA = parseInt(
            $("scoreA")?.value || "",
            10
        );

        const scoreB = parseInt(
            $("scoreB")?.value || "",
            10
        );

        if (
            !Number.isFinite(scoreA) ||
            !Number.isFinite(scoreB)
        ) {
            return alert(
                "Coloca os dois placares (ex: 18 e 15)."
            );
        }

        if (!isValidFinalScore(scoreA, scoreB)) {
            return alert(
                "Placar inválido. Vai até 18, mas em 17x17 vence quem abrir 2."
            );
        }

        recomputeNextIndex(sess);

        Loading.show("Salvando jogo...");

        try {
            await addMatch(
                pairAId,
                pairBId,
                scoreA,
                scoreB,
                sess.nextIndex
            );

            if (sess.playMode === "rotation") {
                sess.pendingPairAId = null;
                sess.pendingPairBId = null;

                saveState();

                await apiJson("/api/sessions", {
                    method: "PATCH",
                    body: JSON.stringify({
                        id: sess.id,
                        pending_pair_a_id: null,
                        pending_pair_b_id: null
                    })
                });
            }

            recomputeNextIndex(sess);
            saveState();

            if ($("scoreA")) {
                $("scoreA").value = "";
            }

            if ($("scoreB")) {
                $("scoreB").value = "";
            }

            if (
                sess.playMode === "rotation" &&
                getSessionMatches(sess).length < 8
            ) {
                try {
                    const prepared =
                        await prepareAutomaticRotationMatch(sess);

                    if (!prepared) {
                        throw new Error(
                            "A preparação automática não retornou um confronto."
                        );
                    }

                    Loading.forceHide();

                    alert(
                        "Jogo salvo ✅\n\n" +
                        "O próximo confronto já foi montado."
                    );

                    return;
                } catch (rotationError) {
                    console.error(
                        "Erro ao montar próximo jogo automático:",
                        rotationError
                    );

                    updateAllSessionUI();

                    Loading.forceHide();

                    alert(
                        "O jogo foi salvo, mas não foi possível montar " +
                        "o próximo confronto automaticamente.\n\n" +
                        `Erro: ${rotationError?.message ||
                        "erro desconhecido"
                        }`
                    );

                    return;
                }
            }

            updateAllSessionUI();

            Loading.forceHide();

            alert("Jogo salvo ✅");
        } catch (err) {
            console.error("Erro ao salvar jogo:", err);

            Loading.forceHide();

            alert(
                err?.message ||
                "Não foi possível salvar o jogo."
            );
        } finally {
            Loading.forceHide();
        }
    });

    if ($("btnUndo")) {
        $("btnUndo").textContent = "↩️ Refazer último jogo";

        $("btnUndo").addEventListener("click", async () => {
            if (!requireAdmin()) return;

            const sess = getCurrentSession();

            if (!sess) {
                return alert("Sem sessão ativa.");
            }

            const sessionMatches = getSessionMatches(sess);

            if (!sessionMatches.length) {
                return alert("Não há jogo nesta sessão para refazer.");
            }

            const confirmed = confirm(
                "⚠️ Refazer o último jogo?\n\n" +
                "O último resultado registrado será removido.\n\n" +
                "As mesmas duplas serão carregadas novamente para que " +
                "você informe o placar correto.\n\n" +
                "Essa ação não poderá ser desfeita."
            );

            if (!confirmed) return;

            const button = $("btnUndo");
            const originalText = button.textContent;

            button.disabled = true;
            button.textContent = "Refazendo...";

            try {
                const removedMatch =
                    await undoLastMatchOfCurrentSession();

                recomputeNextIndex(sess);

                await restoreRemovedMatchForRedo(
                    sess,
                    removedMatch
                );

                updateAllSessionUI();

                // O render pode recriar os selects.
                // Por isso reforçamos os valores depois da atualização.
                if ($("pairA")) {
                    $("pairA").value =
                        String(removedMatch.pairAId);
                }

                if ($("pairB")) {
                    $("pairB").value =
                        String(removedMatch.pairBId);
                }

                if ($("scoreA")) {
                    $("scoreA").value = "";
                    $("scoreA").focus();
                }

                if ($("scoreB")) {
                    $("scoreB").value = "";
                }

                alert(
                    "Último jogo removido ✅\n\n" +
                    "As mesmas duplas foram carregadas para registrar novamente."
                );
            } catch (err) {
                console.error("Erro ao refazer último jogo:", err);

                alert(
                    err?.message ||
                    "Não foi possível refazer o último jogo."
                );
            } finally {
                button.disabled = false;
                button.textContent = originalText;
            }
        });
    }

    if ($("btnEndSession")) {
        $("btnEndSession").addEventListener("click", async () => {
            const sess = getCurrentSession();
            if (!sess) return alert("Sem sessão ativa.");

            const matches = getSessionMatches(sess);
            if (matches.length < 8) return alert("A sessão ainda não terminou.");

            await apiJson("/api/sessions", {
                method: "PATCH",
                body: JSON.stringify({
                    id: sess.id,
                    status: "encerrada"
                })
            });

            state.viewSessionId = sess.id;
            state.currentSessionId = null;
            state.updatedAt = new Date().toISOString();
            saveState();

            updateAllSessionUI();
            showTab("sessoes");

            alert(`Sessão "${sess.name}" encerrada ✅`);
        });
    }

    if ($("btnAdjustParticipants")) {
        $("btnAdjustParticipants").addEventListener("click", () => {
            if (!requireOperator()) return;

            const session = getCurrentSession();

            if (!session) {
                return alert("Nenhuma sessão ativa.");
            }

            if (session.playMode !== "fixed") {
                return alert("A sessão já está em modo de rodízio.");
            }

            renderParticipantAdjustment();

            if ($("participantAdjustmentCard")) {
                $("participantAdjustmentCard").style.display = "block";
            }
        });
    }

    if ($("btnCancelParticipantAdjustment")) {
        $("btnCancelParticipantAdjustment").addEventListener("click", () => {
            if ($("participantAdjustmentCard")) {
                $("participantAdjustmentCard").style.display = "none";
            }

            if ($("absentPlayerSelect")) {
                $("absentPlayerSelect").value = "";
            }
        });
    }

    if ($("btnActivateRotation")) {
        $("btnActivateRotation").addEventListener("click", async () => {
            if (!requireOperator()) return;

            const absentPlayerId =
                $("absentPlayerSelect")?.value || "";

            if (!absentPlayerId) {
                return alert("Selecione o jogador ausente.");
            }

            try {
                const changed =
                    await activateRotationWithAbsentPlayer(absentPlayerId);

                if (!changed) return;

                if ($("participantAdjustmentCard")) {
                    $("participantAdjustmentCard").style.display = "none";
                }

                if ($("absentPlayerSelect")) {
                    $("absentPlayerSelect").value = "";
                }

                await prepareAutomaticRotationMatch(
                    getCurrentSession()
                );

                alert(
                    "Rodízio com 7 iniciado ✅\n\nO próximo jogo foi montado automaticamente."
                );
            } catch (err) {
                alert(err.message || "Erro ao iniciar rodízio.");
            }
        });
    }

    if ($("btnPrepareRotationMatch")) {
        $("btnPrepareRotationMatch").addEventListener("click", async () => {
            if (!requireOperator()) return;

            try {
                await prepareRotationMatch();

                alert(
                    "Próximo jogo preparado ✅\n\nAgora informe o placar e salve normalmente."
                );
            } catch (err) {
                alert(err.message || "Erro ao preparar jogo.");
            }
        });
    }

    document.addEventListener("click", async (ev) => {
        const btn = ev.target.closest(".btnDeleteSession");
        if (!btn) return;

        if (!requireAdmin()) return;

        const id = btn.dataset.id;

        const sess = state.sessions.find(s => s.id === id);

        if (!confirm(
            `⚠️ Excluir sessão "${sess?.name || 'sem nome'}"?\n\n` +
            "Essa ação não pode ser desfeita."
        )) return;

        try {
            await apiJson("/api/sessions", {
                method: "DELETE",
                body: JSON.stringify({ id })
            });

            // 👉 AQUI É O PONTO EXATO
            state.sessions = state.sessions.filter(s => s.id !== id);

            state.matches = state.matches.filter(
                m => String(m.sessionId) !== String(id)
            );

            if (state.currentSessionId === id) {
                state.currentSessionId = null;
            }

            if (state.viewSessionId === id) {
                state.viewSessionId = null;
            }

            saveState();
            updateAllSessionUI();

            alert("Sessão excluída 🗑️");
        } catch (err) {
            alert(err.message || "Erro ao excluir sessão");
        }
    });

    document.addEventListener("click", (ev) => {
        const button =
            ev.target.closest?.(".btnViewSession");

        if (!button) return;

        state.viewSessionId =
            button.dataset.id;

        sessionGamesExpanded = false;

        saveState();
        renderSessionsTab();
        showTab("sessoes");

        window.scrollTo({
            top: 0,
            behavior: "smooth"
        });
    });

    document.addEventListener("click", (ev) => {
        const button =
            ev.target.closest?.("#btnBackSessions");

        if (!button) return;

        state.viewSessionId = null;
        sessionGamesExpanded = false;

        saveState();
        renderSessionsTab();

        window.scrollTo({
            top: 0,
            behavior: "smooth"
        });
    });

    document.addEventListener("click", (ev) => {
        const button =
            ev.target.closest?.("#btnToggleSessionGames");

        if (!button) return;

        sessionGamesExpanded =
            !sessionGamesExpanded;

        renderSessionsTab();

        /*
         * Como a renderização recria os accordions,
         * abrimos novamente a área de jogos.
         */
        const accordions =
            $("sessionDetails")
                ?.querySelectorAll(".session-accordion");

        const gamesAccordion =
            accordions?.[2];

        if (gamesAccordion) {
            gamesAccordion.open = true;
            gamesAccordion.scrollIntoView({
                behavior: "smooth",
                block: "start"
            });
        }
    });

    async function gerarImagemResumo(tipo) {
        const sess = getCurrentSession() || getViewedSession();
        if (!sess) return alert("Sem sessão");

        const table = computePairTableForSession(sess);
        if (!table.length) return alert("Sem dados");

        const best = table[0];
        const worst = table[table.length - 1];

        const data = tipo === "best" ? best : worst;

        const nome = getPairDisplayName(sess, data.pairId);

        // 👉 busca mensagem do backend
        let frase = "";
        try {
            const res = await apiJson(`/api/resenha-message?kind=${tipo}`);
            frase = res.message || "";
        } catch {
            frase = tipo === "best"
                ? "Hoje foi domínio total 🔥"
                : "Hoje não deu... 😂";
        }

        // 👉 cria card fake
        const el = document.createElement("div");
        el.className = `share-card ${tipo}`;

        el.innerHTML = `
            <!-- overlay bonito -->
            <div style="
                position:absolute;
                inset:0;
                background: radial-gradient(circle at top, rgba(255,255,255,0.05), transparent 60%);
            "></div>

            <!-- conteúdo -->
            <div style="position:relative; z-index:2; display:flex; flex-direction:column; align-items:center;">

                <div class="share-title">QUARTA CH</div>

                <div class="share-subtitle">
                ${tipo === "best" ? "🏆 MELHOR DUPLA" : "🪵 PIOR DUPLA"}
                </div>

                <div class="share-name">
                ${nome}
                </div>

                <div class="share-stats">
                ${data.points} pts • ${data.wins} vitórias
                </div>

                <div class="share-msg">
                "${frase}"
                </div>

                <div class="share-date">
                ${sess.dateISO}
                </div>

            </div>
            `;

        document.body.appendChild(el);

        const canvas = await html2canvas(el, {
            scale: 2,
            backgroundColor: "#020617",
            useCORS: true
        });
        document.body.removeChild(el);

        const link = document.createElement("a");
        link.download = `${tipo} -quarta.png`;
        link.href = canvas.toDataURL();
        link.click();
    }

    document.addEventListener("click", async (ev) => {
        if (ev.target.closest("#btnShareBest")) {
            gerarImagemResumo("best");
        }

        if (ev.target.closest("#btnShareWorst")) {
            gerarImagemResumo("worst");
        }
    });

    // ---------- Ranking controls ----------
    function updateRankingPeriodUI() {
        const period = $("period")?.value || "session";
        const isCustom = period === "custom";

        if ($("fromDateWrap")) $("fromDateWrap").style.display = isCustom ? "block" : "none";
        if ($("toDateWrap")) $("toDateWrap").style.display = isCustom ? "block" : "none";

        if (isCustom) {
            const now = new Date();
            const y = now.getFullYear();
            const m = String(now.getMonth() + 1).padStart(2, "0");
            const firstDay = `${y}-${m}-01`;

            if ($("fromDate") && !$("fromDate").value) $("fromDate").value = firstDay;
            if ($("toDate") && !$("toDate").value) $("toDate").value = todayISO();
        }
    }

    // ---------- Ranking controls ----------
    ["period", "sortBy", "showOnly", "fromDate", "toDate"].forEach((id) => {
        if ($(id)) {
            $(id).addEventListener("change", () => {
                updateRankingPeriodUI();
                window.renderRanking();
            });
        }
    });

    if ($("btnReset")) {
        $("btnReset").addEventListener("click", async () => {
            if (!requireAdmin()) return;
            if (!confirm("Zerar tudo mesmo? (Jogadores, sessões e jogos)")) return;

            try {
                await apiJson("/api/reset", {
                    method: "POST",
                    body: JSON.stringify({ keepPlayers: false })
                });

                applyFullLocalReset();
                alert("Zerado total ✅");
            } catch (err) {
                console.error("Erro resetando banco:", err);
                alert("Falhou ao zerar no banco.");
            }
        });
    }

    if ($("btnResetKeepPlayers")) {
        $("btnResetKeepPlayers").addEventListener("click", async () => {
            if (!requireAdmin()) return;
            if (!confirm("Zerar jogos e sessões, mas manter os jogadores?")) return;

            try {
                await apiJson("/api/reset", {
                    method: "POST",
                    body: JSON.stringify({ keepPlayers: true })
                });

                applyKeepPlayersLocalReset();
                alert("Jogos e sessões apagados; jogadores mantidos ✅");
            } catch (err) {
                console.error("Erro resetando banco mantendo players:", err);
                alert("Falhou ao zerar no banco.");
            }
        });
    }

    if ($("btnCheckDb")) {
        $("btnCheckDb").addEventListener("click", async () => {
            await checkDbStatus();
            alert(dbStatus.ok ? "Banco conectado ✅" : "Falha ao conectar no banco ❌");
        });
    }

    function renderDataInfo() {
        if (!$("dbInfo")) return;

        const checked = dbStatus.checkedAt
            ? new Date(dbStatus.checkedAt).toLocaleString("pt-BR")
            : "nunca";

        const dbLine = dbStatus.ok
            ? "conectado ✅"
            : `falha ❌${dbStatus.error ? " (" + dbStatus.error + ")" : ""} `;

        $("dbInfo").textContent =
            `versão: ${state.version} \n` +
            `criado:  ${state.createdAt} \n` +
            `update:  ${state.updatedAt} \n` +
            `jogadores: ${(state.players || []).length} \n` +
            `sessões:   ${(state.sessions || []).length} \n` +
            `jogos:     ${(state.matches || []).length} \n` +
            `banco:     ${dbLine} \n` +
            `checado:   ${checked} \n`;
    }

    function renderMatchHistory() {

        const wrap = $("matchHistory");
        if (!wrap) return;

        const sess = getCurrentSession();
        if (!sess) {
            wrap.innerHTML = "<div class='muted'>Sem sessão ativa.</div>";
            return;
        }

        const matches = (state.matches || []).filter(m => String(m.sessionId) === String(sess.id));

        if (!matches.length) {
            wrap.innerHTML = "<div class='muted'>Nenhum jogo ainda.</div>";
            return;
        }

        const pairName = (pairId) => {

            const pair = sess.pairs.find(p => p.id === pairId);
            if (!pair) return "?";

            const p1 = state.players.find(p => p.id === pair.p1)?.name || "?";
            const p2 = state.players.find(p => p.id === pair.p2)?.name || "?";

            return `${p1}/${p2}`;
        };

        const matchesOrdered = matches
            .slice()
            .sort((a, b) => (a.scheduleIndex ?? 9999) - (b.scheduleIndex ?? 9999) || (a.createdAt - b.createdAt));

        wrap.innerHTML = matchesOrdered.map((m, i) => {
            const scoreA = Number(m.scoreA);
            const scoreB = Number(m.scoreB);

            const pairAClass =
                scoreA > scoreB
                    ? "is-winner"
                    : "is-loser";

            const pairBClass =
                scoreB > scoreA
                    ? "is-winner"
                    : "is-loser";

            return `
                <div class="match-history-item">

                    <div class="match-history-header">
                        <span class="match-history-number">
                            Jogo ${(m.scheduleIndex ?? i) + 1}
                        </span>

                        ${canOperate()
                    ? `
                                <button
                                    class="secondary btnEditMatch match-history-edit"
                                    type="button"
                                    data-id="${m.id}"
                                    aria-label="Editar placar do jogo ${(m.scheduleIndex ?? i) + 1}"
                                >
                                    ✏️
                                </button>
                            `
                    : ""
                }
                    </div>

                    <div class="match-history-scoreboard">

                        <div class="match-history-team ${pairAClass}">
                            <span class="match-history-pair">
                                ${pairName(m.pairAId)}
                            </span>

                            <strong class="match-history-score">
                                ${m.scoreA}
                            </strong>
                        </div>

                        <div class="match-history-team ${pairBClass}">
                            <span class="match-history-pair">
                                ${pairName(m.pairBId)}
                            </span>

                            <strong class="match-history-score">
                                ${m.scoreB}
                            </strong>
                        </div>

                    </div>

                </div>
            `;
        }).join("");
    }

    function recomputeNextIndex(sess) {
        const matches = getSessionMatches(sess);
        // se tem scheduleIndex, usa o maior + 1
        const maxIdx = matches.reduce((acc, m) => {
            return typeof m.scheduleIndex === "number" ? Math.max(acc, m.scheduleIndex) : acc;
        }, -1);

        if (maxIdx >= 0) {
            sess.nextIndex = maxIdx + 1;
        } else {
            // fallback: quantidade de jogos da sessão
            sess.nextIndex = matches.length;
        }
    }

    async function restoreRemovedMatchForRedo(session, removedMatch) {
        if (!session || !removedMatch) {
            return;
        }

        session.pendingPairAId = removedMatch.pairAId;
        session.pendingPairBId = removedMatch.pairBId;

        if ($("pairA")) {
            $("pairA").value = String(removedMatch.pairAId);
        }

        if ($("pairB")) {
            $("pairB").value = String(removedMatch.pairBId);
        }

        if ($("scoreA")) {
            $("scoreA").value = "";
        }

        if ($("scoreB")) {
            $("scoreB").value = "";
        }

        if (session.playMode === "rotation") {
            const pairA = (session.pairs || []).find(
                pair => String(pair.id) === String(removedMatch.pairAId)
            );

            const pairB = (session.pairs || []).find(
                pair => String(pair.id) === String(removedMatch.pairBId)
            );

            if (pairA && pairB) {
                if ($("rotationA1")) {
                    $("rotationA1").value = String(pairA.p1);
                }

                if ($("rotationA2")) {
                    $("rotationA2").value = String(pairA.p2);
                }

                if ($("rotationB1")) {
                    $("rotationB1").value = String(pairB.p1);
                }

                if ($("rotationB2")) {
                    $("rotationB2").value = String(pairB.p2);
                }
            }

            updateRotationRestingPlayers(session);

            await apiJson("/api/sessions", {
                method: "PATCH",
                body: JSON.stringify({
                    id: session.id,
                    pending_pair_a_id: removedMatch.pairAId,
                    pending_pair_b_id: removedMatch.pairBId
                })
            });
        }

        saveState();
    }

    function updateAllSessionUI() {
        renderPairSelects();
        updateNextGameUI();
        updateTopStats();
        window.renderRanking();
        renderDataInfo();
        renderMatchHistory();
        renderSessionsTab();
        updateStartSessionButton();
        updateEndSessionButton();
        renderSessionSummary();
        updatePairsEditorLock();
        updateHomeLayout();
        renderCycleGame1Selects();

        renderParticipantAdjustment();
        renderRotationSetup();
    }

    function getSessionMatches(sess) {
        return (state.matches || [])
            .filter(m => String(m.sessionId) === String(sess.id))
            .slice()
            .sort((a, b) => (a.scheduleIndex ?? 9999) - (b.scheduleIndex ?? 9999) || (a.createdAt - b.createdAt));
    }

    function getActiveCycle() {
        return (state.cycles || []).find(c => c.id === state.currentCycleId) || null;
    }

    function renderCycleGame1Selects() {
        const cycle = getActiveCycle();

        const boxA = $("cycleStartGameBox");
        const boxB = $("cycleStartGameBoxB");
        const selA = $("cycleGame1PairA");
        const selB = $("cycleGame1PairB");

        if (!boxA || !boxB || !selA || !selB) return;

        if (!cycle || !cycle.pairs || cycle.pairs.length !== 4 || getCurrentSession()) {
            boxA.style.display = "none";
            boxB.style.display = "none";
            return;
        }

        boxA.style.display = "block";
        boxB.style.display = "block";

        const fill = (sel) => {
            sel.innerHTML = `<option value="">— selecione —</option>`;

            cycle.pairs.forEach(pair => {
                const p1 = state.players.find(p => p.id === pair.p1)?.name || "?";
                const p2 = state.players.find(p => p.id === pair.p2)?.name || "?";

                const opt = document.createElement("option");
                opt.value = pair.id;
                opt.textContent = `${p1} + ${p2}`;
                sel.appendChild(opt);
            });
        };

        fill(selA);
        fill(selB);
    }

    function getSessionById(id) {
        return (state.sessions || []).find(s => s.id === id) || null;
    }

    function getViewedSession() {
        if (!state.viewSessionId) {
            return null;
        }

        return getSessionById(
            state.viewSessionId
        );
    }

    function getSessionParticipantIds(session) {
        const configuredIds = Array.isArray(session?.participantIds)
            ? session.participantIds
            : [];

        if (configuredIds.length) {
            return [...new Set(configuredIds.map(String))];
        }

        return [
            ...new Set(
                (session?.pairs || [])
                    .flatMap(pair => [pair.p1, pair.p2])
                    .filter(Boolean)
                    .map(String)
            )
        ];
    }

    function getSessionModeInfo(session) {
        const participantCount =
            getSessionParticipantIds(session).length;

        if (session?.playMode === "rotation") {
            return {
                icon: "🔄",
                label: "Rodízio",
                participantCount,
                description:
                    `Rodízio • ${participantCount} jogadores`
            };
        }

        return {
            icon: "🎮",
            label: "Duplas fixas",
            participantCount,
            description:
                `Duplas fixas • ${participantCount} jogadores`
        };
    }

    function getSessionPlayerParticipation(session) {
        const participantIds =
            getSessionParticipantIds(session);

        const participation = new Map(
            participantIds.map(playerId => [
                String(playerId),
                {
                    playerId: String(playerId),
                    name: getPlayerName(playerId),
                    played: 0
                }
            ])
        );

        const matches = getSessionMatches(session);

        matches.forEach(match => {
            const pairA = (session.pairs || []).find(
                pair =>
                    String(pair.id) === String(match.pairAId)
            );

            const pairB = (session.pairs || []).find(
                pair =>
                    String(pair.id) === String(match.pairBId)
            );

            const playerIds = [
                pairA?.p1,
                pairA?.p2,
                pairB?.p1,
                pairB?.p2
            ].filter(Boolean);

            playerIds.forEach(playerId => {
                const id = String(playerId);

                if (!participation.has(id)) {
                    participation.set(id, {
                        playerId: id,
                        name: getPlayerName(id),
                        played: 0
                    });
                }

                participation.get(id).played += 1;
            });
        });

        return [...participation.values()]
            .sort((a, b) =>
                (b.played - a.played) ||
                a.name.localeCompare(b.name)
            );
    }

    function getRotationBalanceInfo(participation) {
        if (!participation.length) {
            return {
                label: "Sem dados",
                icon: "⚪",
                difference: 0
            };
        }

        const gameCounts =
            participation.map(player => player.played);

        const maxGames = Math.max(...gameCounts);
        const minGames = Math.min(...gameCounts);
        const difference = maxGames - minGames;

        if (difference <= 1) {
            return {
                label: "Excelente",
                icon: "🟢",
                difference
            };
        }

        if (difference === 2) {
            return {
                label: "Razoável",
                icon: "🟡",
                difference
            };
        }

        return {
            label: "Desequilibrado",
            icon: "🔴",
            difference
        };
    }

    function renderPlayerParticipationTable(session) {
        const participation =
            getSessionPlayerParticipation(session);

        if (!participation.length) {
            return `
            <div class="muted">
                Nenhuma participação encontrada.
            </div>
        `;
        }

        const balance =
            getRotationBalanceInfo(participation);

        return `
        <div style="
            display:grid;
            grid-template-columns:
                repeat(auto-fit, minmax(150px, 1fr));
            gap:8px;
            margin-top:12px;
        ">
            ${participation.map(player => `
                <div class="player-item"
                    style="justify-content:space-between;">
                    <span>${player.name}</span>
                    <b>${player.played}</b>
                </div>
            `).join("")}
        </div>

        ${session.playMode === "rotation" ? `
            <div class="muted" style="margin-top:12px;">
                ${balance.icon}
                Equilíbrio do rodízio:
                <b>${balance.label}</b>

                ${balance.difference > 0
                    ? ` • diferença máxima de ${balance.difference} jogo(s)`
                    : ""}
            </div>
        ` : ""}
    `;
    }

    function renderSessionsTab() {
        const listView = $("sessionsListView");
        const detailsView = $("sessionDetailsView");
        const list = $("sessionsList");
        const details = $("sessionDetails");

        if (!listView || !detailsView || !list || !details) {
            return;
        }

        const sessions = (state.sessions || [])
            .slice()
            .sort(
                (a, b) =>
                    (b.dateISO || "").localeCompare(a.dateISO || "")
            );

        const viewed = getViewedSession();

        /*
         * Quando existe sessão selecionada, exibimos somente os detalhes.
         * Caso contrário, mostramos somente a lista.
         */
        listView.style.display = viewed ? "none" : "block";
        detailsView.style.display = viewed ? "block" : "none";

        if (!sessions.length) {
            list.innerHTML = `
            <div class="muted">
                Nenhuma sessão cadastrada.
            </div>
        `;

            details.innerHTML = "";
            return;
        }

        /*
         * LISTA DE SESSÕES
         */
        list.innerHTML = sessions.map(session => {
            const matches = getSessionMatches(session);

            const isActive =
                String(session.id) ===
                String(state.currentSessionId);

            const table =
                computePairTableForSession(session);

            const best = table[0];

            const bestLabel = best
                ? getPairDisplayName(session, best.pairId)
                : "Sem resultado";

            const modeInfo =
                getSessionModeInfo(session);

            const bestDescription =
                session.playMode === "rotation"
                    ? "Melhor combinação"
                    : "Melhor dupla";

            return `
            <article class="session-list-item">

                <div class="session-list-main">

                    <div class="session-list-header">
                        <strong class="session-list-name">
                            ${session.name || "Sem nome"}
                        </strong>

                        <span class="pill">
                            ${isActive ? "ativa" : "encerrada"}
                        </span>
                    </div>

                    <div class="session-list-meta">
                        <span>
                            📅 ${session.dateISO || "-"}
                        </span>

                        <span>
                            🎮 ${matches.length} jogo(s)
                        </span>

                        <span>
                            ${modeInfo.icon}
                            ${modeInfo.label}
                        </span>

                        <span>
                            👥 ${modeInfo.participantCount}
                        </span>
                    </div>

                    <div class="session-list-best">
                        🏆 ${bestDescription}:
                        <strong>${bestLabel}</strong>
                    </div>

                </div>

                <div class="session-list-actions">

                    <button
                        class="secondary btnViewSession"
                        type="button"
                        data-id="${session.id}"
                    >
                        Abrir
                    </button>

                    ${isAdmin()
                    ? `
                            <button
                                class="secondary btnDeleteSession"
                                type="button"
                                data-id="${session.id}"
                                aria-label="Excluir sessão"
                            >
                                🗑️
                            </button>
                        `
                    : ""
                }

                </div>

            </article>
        `;
        }).join("");

        /*
         * Nenhuma sessão selecionada:
         * paramos após renderizar a lista.
         */
        if (!viewed) {
            details.innerHTML = "";
            return;
        }

        /*
         * DETALHES DA SESSÃO
         */
        const matches =
            getSessionMatches(viewed);

        const table =
            computePairTableForSession(viewed);

        /*
         * Para melhor/pior combinação, ignoramos linhas que nunca jogaram.
         * Isso impede uma dupla sem partida de aparecer como pior colocada.
         */
        const playedTable =
            table.filter(row => Number(row.played) > 0);

        const individualRanking =
            typeof window.computeIndividualRankingForSession === "function"
                ? window.computeIndividualRankingForSession(
                    viewed,
                    state.matches || []
                )
                : [];

        const best =
            playedTable[0] || null;

        const worst =
            playedTable[playedTable.length - 1] || null;

        const modeInfo =
            getSessionModeInfo(viewed);

        const pairSectionTitle =
            viewed.playMode === "rotation"
                ? "Combinações utilizadas"
                : "Duplas da sessão";

        const bestTitle =
            viewed.playMode === "rotation"
                ? "Melhor combinação"
                : "Melhor dupla";

        const worstTitle =
            viewed.playMode === "rotation"
                ? "Pior combinação"
                : "Pior dupla";

        const visibleMatches =
            sessionGamesExpanded
                ? matches
                : matches.slice(0, 4);

        const hasMoreMatches =
            matches.length > 4;

        const gamesHtml = visibleMatches.length
            ? visibleMatches.map((match, index) => {
                const scoreA = Number(match.scoreA);
                const scoreB = Number(match.scoreB);

                const pairAClass =
                    scoreA > scoreB
                        ? "is-winner"
                        : "is-loser";

                const pairBClass =
                    scoreB > scoreA
                        ? "is-winner"
                        : "is-loser";

                return `
                <div class="session-game-item">

                    <div class="session-game-number">
                        Jogo ${Number.isInteger(
                    Number(match.scheduleIndex)
                )
                        ? Number(match.scheduleIndex) + 1
                        : index + 1
                    }
                    </div>

                    <div class="session-game-team ${pairAClass}">
                        <span>
                            ${getPairDisplayName(
                        viewed,
                        match.pairAId
                    )}
                        </span>

                        <strong>
                            ${match.scoreA}
                        </strong>
                    </div>

                    <div class="session-game-team ${pairBClass}">
                        <span>
                            ${getPairDisplayName(
                        viewed,
                        match.pairBId
                    )}
                        </span>

                        <strong>
                            ${match.scoreB}
                        </strong>
                    </div>

                </div>
            `;
            }).join("")
            : `
            <div class="muted">
                Nenhum jogo registrado.
            </div>
        `;

        const summaryHtml = playedTable.length
            ? `
            <div class="session-highlights-grid">

                <div
                    class="session-highlight-card is-best session-share-trigger"
                    data-share-kind="best"
                >
                    <div class="session-highlight-label">
                        🏆 ${bestTitle}
                    </div>

                    <strong class="session-highlight-name">
                        ${getPairDisplayName(
                viewed,
                best.pairId
            )}
                    </strong>

                    <div class="muted session-highlight-stats">
                        ${best.points} pts
                        • ${best.wins} vitória(s)
                        • saldo ${best.diff}
                        • pró ${best.pointsFor}
                    </div>
                </div>

                <div
                    class="session-highlight-card is-worst session-share-trigger"
                    data-share-kind="worst"
                >
                    <div class="session-highlight-label">
                        🪵 ${worstTitle}
                    </div>

                    <strong class="session-highlight-name">
                        ${getPairDisplayName(
                viewed,
                worst.pairId
            )}
                    </strong>

                    <div class="muted session-highlight-stats">
                        ${worst.points} pts
                        • ${worst.wins} vitória(s)
                        • saldo ${worst.diff}
                        • pró ${worst.pointsFor}
                    </div>
                </div>

            </div>
        `
            : `
            <div class="muted">
                Sem resultados suficientes para gerar o resumo.
            </div>
        `;

        const individualRankingHtml = individualRanking.length
            ? `
        <div class="session-individual-podium">

            ${individualRanking.slice(0, 3).map((player, index) => {
                const medal =
                    index === 0
                        ? "🥇"
                        : index === 1
                            ? "🥈"
                            : "🥉";

                return `
                    <div class="
                        session-individual-podium-item
                        session-individual-position-${index + 1}
                    ">
                        <div class="session-individual-medal">
                            ${medal}
                        </div>

                        <strong class="session-individual-name">
                            ${player.name}
                        </strong>

                        <div class="session-individual-points">
                            ${player.points} pts
                        </div>

                        <div class="muted session-individual-stats">
                            ${player.played} jogo(s)
                            • ${player.wins} vitória(s)
                            • saldo ${player.diff >= 0 ? "+" : ""}${player.diff}
                        </div>
                    </div>
                `;
            }).join("")}

                    </div>

                    <div class="session-table-scroll">
                        <table class="table session-individual-table">
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>Jogador</th>
                                    <th>Pts</th>
                                    <th>J</th>
                                    <th>V</th>
                                    <th>D</th>
                                    <th>Saldo</th>
                                    <th>Pró</th>
                                </tr>
                            </thead>

                            <tbody>
                                ${individualRanking.map((player, index) => `
                                    <tr>
                                        <td>
                                            ${index === 0
                    ? "🥇"
                    : index === 1
                        ? "🥈"
                        : index === 2
                            ? "🥉"
                            : index + 1
                }
                                        </td>

                                        <td>
                                            <strong>${player.name}</strong>
                                        </td>

                                        <td>${player.points}</td>
                                        <td>${player.played}</td>
                                        <td>${player.wins}</td>
                                        <td>${player.losses}</td>

                                        <td>
                                            ${player.diff >= 0 ? "+" : ""}
                                            ${player.diff}
                                        </td>

                                        <td>${player.pointsFor}</td>
                                    </tr>
                                `).join("")}
                            </tbody>
                        </table>
                    </div>
                `
            : `
        <div class="muted">
            Sem ranking individual para essa sessão.
        </div>
    `;

        const rankingHtml = playedTable.length
            ? `
            <div class="session-table-scroll">
                <table class="table session-ranking-table">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Dupla</th>
                            <th>Pts</th>
                            <th>V</th>
                            <th>J</th>
                            <th>Saldo</th>
                            <th>Pró</th>
                        </tr>
                    </thead>

                    <tbody>
                        ${playedTable.map((row, index) => `
                            <tr>
                                <td>${index + 1}</td>

                                <td>
                                    ${getPairDisplayName(
                viewed,
                row.pairId
            )}
                                </td>

                                <td>${row.points}</td>
                                <td>${row.wins}</td>
                                <td>${row.played}</td>
                                <td>${row.diff}</td>
                                <td>${row.pointsFor}</td>
                            </tr>
                        `).join("")}
                    </tbody>
                </table>
            </div>
        `
            : `
            <div class="muted">
                Sem ranking para essa sessão.
            </div>
        `;

        details.innerHTML = `
        <div class="session-details-header">

            <div>
                <div class="muted">
                    Sessão selecionada
                </div>

                <h2 class="session-details-title">
                    ${viewed.name || "Sem nome"}
                </h2>

                <div class="session-details-meta">
                    <span>
                        📅 ${viewed.dateISO || "-"}
                    </span>

                    <span>
                        🎮 ${matches.length} jogo(s)
                    </span>

                    <span>
                        ${modeInfo.icon}
                        ${modeInfo.label}
                    </span>

                    <span>
                        👥 ${modeInfo.participantCount}
                    </span>
                </div>
            </div>

            <span class="pill">
                ${viewed.status === "em_andamento"
                ? "Sessão ativa"
                : "Sessão encerrada"
            }
            </span>

        </div>

        <details class="session-accordion" open>
            <summary>
                <span>
                    📊 Resumo
                </span>

                <span class="session-accordion-hint">
                    Visão geral
                </span>
            </summary>

            <div class="session-accordion-content">

                ${summaryHtml}

                <div class="session-summary-section">
                    <strong>${pairSectionTitle}</strong>

                    <div class="muted session-pairs-used">
                        ${(viewed.pairs || [])
                .map(pair =>
                    getPairDisplayName(
                        viewed,
                        pair.id
                    )
                )
                .join(" • ") || "Nenhuma"}
                    </div>
                </div>

                <div class="session-summary-section">
                    <strong>
                        ${viewed.playMode === "rotation"
                ? "Resumo do rodízio"
                : "Participação por jogador"
            }
                    </strong>

                    <div class="muted session-summary-description">
                        Quantidade de partidas disputadas por jogador.
                    </div>

                    ${renderPlayerParticipationTable(viewed)}
                </div>

            </div>
                </details>

                <details class="session-accordion">
                    <summary>
                        <span>
                            🏆 Ranking individual
                        </span>

                        <span class="session-accordion-hint">
                            ${individualRanking.length}
                        </span>
                    </summary>

                    <div class="session-accordion-content">
                        ${individualRankingHtml}
                    </div>
                </details>

                <details class="session-accordion">
                    <summary>
                        <span>
                            🎮 Jogos
                        </span>

                <span class="session-accordion-hint">
                    ${matches.length}
                </span>
            </summary>

            <div class="session-accordion-content">

                <div class="session-games-list">
                    ${gamesHtml}
                </div>

                ${hasMoreMatches
                ? `
                        <button
                            id="btnToggleSessionGames"
                            class="secondary session-more-button"
                            type="button"
                        >
                            ${sessionGamesExpanded
                    ? "Mostrar menos jogos"
                    : `Mostrar todos os ${matches.length} jogos`
                }
                        </button>
                    `
                : ""
            }

            </div>
        </details>

        <details class="session-accordion">
            <summary>
                <span>
                    🏆 Ranking das duplas
                </span>

                <span class="session-accordion-hint">
                    ${playedTable.length}
                </span>
            </summary>

            <div class="session-accordion-content">
                ${rankingHtml}
            </div>
        </details>
    `;
    }

    function getWinnerLoser(match) {
        const aWin = Number(match.scoreA) > Number(match.scoreB);
        return {
            winnerPairId: aWin ? match.pairAId : match.pairBId,
            loserPairId: aWin ? match.pairBId : match.pairAId,
        };
    }

    // ranking POR DUPLA só pra decidir topo x topo / baixo x baixo depois do chaveamento
    function computePairTableForSession(sess) {
        const stats = new Map();

        (sess.pairs || []).forEach(p => {
            stats.set(p.id, {
                pairId: p.id,
                wins: 0,
                played: 0,
                diff: 0,
                pointsFor: 0,
                points: 0, // ✅ pontuação da liga
            });
        });

        const matches = getSessionMatches(sess);

        for (const m of matches) {
            const a = stats.get(m.pairAId);
            const b = stats.get(m.pairBId);
            if (!a || !b) continue;

            const sa = Number(m.scoreA), sb = Number(m.scoreB);

            a.played++; b.played++;
            a.pointsFor += sa; b.pointsFor += sb;
            a.diff += (sa - sb);
            b.diff += (sb - sa);

            // ✅ pontuação: vitória=3, 18x0=4
            if (sa > sb) {
                a.wins++;
                a.points += (sa === 18 && sb === 0) ? 4 : 3;
            } else if (sb > sa) {
                b.wins++;
                b.points += (sb === 18 && sa === 0) ? 4 : 3;
            }
        }

        const table = [...stats.values()];

        // ✅ ordena por pontos primeiro
        table.sort((a, b) =>
            ((b.points || 0) - (a.points || 0)) ||
            ((b.diff || 0) - (a.diff || 0)) ||
            ((b.pointsFor || 0) - (a.pointsFor || 0))
        );

        return table;
    }

    function getPairDisplayName(sess, pairId) {
        const pair = (sess.pairs || []).find((p) => p.id === pairId);
        if (!pair) return "? + ?";

        const p1 = (state.players || []).find((p) => p.id === pair.p1)?.name || "?";
        const p2 = (state.players || []).find((p) => p.id === pair.p2)?.name || "?";

        return `${p1} + ${p2}`;
    }

    function updateStartSessionButton() {
        const btn = $("btnStartSession");
        const input = $("sessionName");
        const sess = getCurrentSession();

        if (!btn) return;

        const hasActiveSession = !!sess;

        btn.disabled = hasActiveSession;
        btn.title = hasActiveSession ? "Finalize a sessão atual para iniciar outra." : "";
        btn.style.opacity = hasActiveSession ? "0.6" : "1";
        btn.style.cursor = hasActiveSession ? "not-allowed" : "pointer";

        if (input) {
            input.disabled = hasActiveSession;
        }
    }

    function updateEndSessionButton() {
        const btn = $("btnEndSession");
        const sess = getCurrentSession();

        if (!btn) return;

        if (!sess) {
            btn.style.display = "none";
            return;
        }

        const matches = getSessionMatches(sess);
        btn.style.display = matches.length >= 8 ? "inline-block" : "none";
    }

    function renderSessionSummary() {
        const wrap = $("sessionSummary");
        const content = $("sessionSummaryContent");
        const sess = getCurrentSession();

        if (!wrap || !content) return;

        if (!sess) {
            wrap.style.display = "none";
            content.innerHTML = "";
            return;
        }

        const matches = getSessionMatches(sess);
        const finished = matches.length >= 8;

        if (!finished) {
            wrap.style.display = "none";
            content.innerHTML = "";
            return;
        }

        const table = computePairTableForSession(sess);
        if (!table.length) {
            wrap.style.display = "none";
            content.innerHTML = "";
            return;
        }

        const best = table[0];
        const worst = table[table.length - 1];

        content.innerHTML = `
        <div style="text-align:center;">
            <div class="muted" style="margin-bottom:8px;">Resumo final da sessão</div>

            <div style="font-size:28px; font-weight:800; margin-bottom:8px;">
                🏆 Melhor dupla da noite
            </div>

            <div style="font-size:22px; font-weight:700; margin-bottom:6px;">
                ${getPairDisplayName(sess, best.pairId)}
            </div>

            <div class="muted" style="margin-bottom:18px;">
                ${best.points} pts • ${best.wins} vitórias • saldo ${best.diff} • pró ${best.pointsFor}
            </div>

            <hr style="margin:18px 0; opacity:.2;">

            <div style="font-size:22px; font-weight:800; margin-bottom:8px;">
                🪵 Pior dupla da noite
            </div>

            <div style="font-size:18px; font-weight:700; margin-bottom:6px;">
                ${getPairDisplayName(sess, worst.pairId)}
            </div>

            <div class="muted">
                ${worst.points} pts • ${worst.wins} vitórias • saldo ${worst.diff} • pró ${worst.pointsFor}
            </div>
        </div>
        <div style="margin-top:16px; display:flex; gap:10px; justify-content:center;">
            <button id="btnShareBest">📸 Campeão</button>
            <button id="btnShareWorst" class="secondary">📸 Lenha 🪵</button>
        </div>
    `;

        wrap.style.display = "block";
    }

    function getMatchByScheduleIndex(sess, idx) {
        return (state.matches || []).find(m => String(m.sessionId) === String(sess.id) && Number(m.scheduleIndex) === Number(idx)) || null;
    }

    function getWinnerLoserPairId(match, want) {
        if (!match) return null;
        if (Number(match.scoreA) === Number(match.scoreB)) return null;

        const winnerId = Number(match.scoreA) > Number(match.scoreB) ? match.pairAId : match.pairBId;
        const loserId = Number(match.scoreA) > Number(match.scoreB) ? match.pairBId : match.pairAId;

        return want === "winner" ? winnerId : loserId;
    }

    function resolvePairId(sess, ref) {
        if (!ref) return null;
        if (ref.type === "pair") return ref.id;

        const prevIdx = Number(ref.match) - 1; // 1..8 -> 0..7
        const prev = getMatchByScheduleIndex(sess, prevIdx);
        if (!prev) return null;

        return getWinnerLoserPairId(prev, ref.type); // "winner" ou "loser"
    }

    function computeNextPlannedGame(sess) {
        if (!sess.schedule || !sess.schedule.length) return null;

        recomputeNextIndex(sess);
        const idx = sess.nextIndex || 0;

        if (idx >= sess.schedule.length) return { done: true, label: "Sessão finalizada (8 jogos) ✅" };

        const sch = sess.schedule[idx];
        const aId = resolvePairId(sess, sch.a);
        const bId = resolvePairId(sess, sch.b);

        if (!aId || !bId || aId === bId) {
            return { pending: true, label: `${sch.label}: aguardando jogos anteriores (sem empates)` };
        }

        return { pairAId: aId, pairBId: bId, label: sch.label };
    }

    function updateNextGameUI() {
        const sess = getCurrentSession();

        const modeBadge = $("sessionModeBadge");
        const gameProgress = $("gameProgress");
        const nextGameLabel = $("nextGameLabel");

        function renderNextGame({
            title = "Próximo jogo",
            pairA = "",
            pairB = "",
            message = "",
            status = ""
        }) {
            if (!nextGameLabel) return;

            nextGameLabel.classList.remove(
                "is-ready",
                "is-waiting",
                "is-finished"
            );

            if (status) {
                nextGameLabel.classList.add(status);
            }

            if (pairA && pairB) {
                nextGameLabel.innerHTML = `
                <div class="next-game-title">
                    ${title}
                </div>

                <div class="next-game-versus">
                    <div class="next-game-pair next-game-pair-a">
                        ${pairA}
                    </div>

                    <div class="next-game-vs">
                        VS
                    </div>

                    <div class="next-game-pair next-game-pair-b">
                        ${pairB}
                    </div>
                </div>
            `;

                return;
            }

            nextGameLabel.innerHTML = `
            <div class="next-game-title">
                ${title}
            </div>

            <div class="next-game-message">
                ${message || "—"}
            </div>
        `;
        }

        if (!sess) {
            if (modeBadge) {
                modeBadge.textContent = "Sem sessão";
            }

            if (gameProgress) {
                gameProgress.textContent = "";
            }

            renderNextGame({
                title: "Sessão",
                message: "Sem sessão ativa.",
                status: "is-waiting"
            });

            if ($("pairA")) {
                $("pairA").value = "";
            }

            if ($("pairB")) {
                $("pairB").value = "";
            }

            return;
        }

        if (sess.playMode === "rotation") {
            recomputeNextIndex(sess);

            const nextGameNumber = (sess.nextIndex || 0) + 1;

            if (modeBadge) {
                modeBadge.textContent = "🔄 Rodízio";
            }

            if (gameProgress) {
                gameProgress.textContent =
                    `Jogo ${Math.min(nextGameNumber, 8)} de 8`;
            }

            const pairA = (sess.pairs || []).find(
                pair =>
                    String(pair.id) ===
                    String(sess.pendingPairAId || "")
            );

            const pairB = (sess.pairs || []).find(
                pair =>
                    String(pair.id) ===
                    String(sess.pendingPairBId || "")
            );

            if (pairA && pairB) {
                const pairASelect = $("pairA");
                const pairBSelect = $("pairB");

                if (pairASelect) {
                    pairASelect.value = String(pairA.id);
                }

                if (pairBSelect) {
                    pairBSelect.value = String(pairB.id);
                }

                renderNextGame({
                    title: "Próximo jogo",
                    pairA:
                        `${getPlayerName(pairA.p1)} + ` +
                        `${getPlayerName(pairA.p2)}`,
                    pairB:
                        `${getPlayerName(pairB.p1)} + ` +
                        `${getPlayerName(pairB.p2)}`,
                    status: "is-ready"
                });
            } else {
                if ($("pairA")) {
                    $("pairA").value = "";
                }

                if ($("pairB")) {
                    $("pairB").value = "";
                }

                renderNextGame({
                    title: "Aguardando próximo jogo",
                    message:
                        "Escolha os quatro jogadores abaixo " +
                        "e prepare o próximo jogo.",
                    status: "is-waiting"
                });
            }

            return;
        }

        if (modeBadge) {
            modeBadge.textContent = "🎮 Duplas fixas";
        }

        const next = computeNextPlannedGame(sess);

        if (!next) {
            if (gameProgress) {
                gameProgress.textContent = "";
            }

            renderNextGame({
                title: "Próximo jogo",
                message: "Não foi possível calcular o próximo jogo.",
                status: "is-waiting"
            });

            return;
        }

        const nextGameNumber = (sess.nextIndex || 0) + 1;

        if (gameProgress) {
            gameProgress.textContent =
                `Jogo ${Math.min(nextGameNumber, 8)} de 8`;
        }

        if (next.done) {
            renderNextGame({
                title: "Sessão concluída",
                message: "Todos os 8 jogos foram registrados ✅",
                status: "is-finished"
            });

            if ($("pairA")) {
                $("pairA").value = "";
            }

            if ($("pairB")) {
                $("pairB").value = "";
            }

            return;
        }

        if (next.pending) {
            renderNextGame({
                title: "Aguardando resultado",
                message: next.label,
                status: "is-waiting"
            });

            return;
        }

        const pairA = (sess.pairs || []).find(
            pair => String(pair.id) === String(next.pairAId)
        );

        const pairB = (sess.pairs || []).find(
            pair => String(pair.id) === String(next.pairBId)
        );

        if (!pairA || !pairB) {
            renderNextGame({
                title: "Próximo jogo",
                message: "As duplas do próximo jogo não foram encontradas.",
                status: "is-waiting"
            });

            return;
        }

        if ($("pairA")) {
            $("pairA").value = String(pairA.id);
        }

        if ($("pairB")) {
            $("pairB").value = String(pairB.id);
        }

        renderNextGame({
            title: next.label || "Próximo jogo",
            pairA:
                `${getPlayerName(pairA.p1)} + ` +
                `${getPlayerName(pairA.p2)}`,
            pairB:
                `${getPlayerName(pairB.p1)} + ` +
                `${getPlayerName(pairB.p2)}`,
            status: "is-ready"
        });
    }

    function applyFullLocalReset() {
        state = defaultState();
        saveState();
        renderPlayers();
        renderPairsEditor();
        renderPairSelects();
        updateTopStats();
        window.renderRanking();
        renderDataInfo();
        renderMatchHistory();
    }

    function applyKeepPlayersLocalReset() {
        const keepPlayers = (state.players || []).slice();

        state.sessions = [];
        state.matches = [];
        state.currentSessionId = null;
        state.players = keepPlayers;
        state.updatedAt = new Date().toISOString();

        saveState();
        renderPlayers();
        renderPairsEditor();
        renderPairSelects();
        updateTopStats();
        window.renderRanking();
        renderDataInfo();
        renderMatchHistory();
    }

    // ---------- Init ----------
    (async function init() {
        renderPlayers();
        renderPairsEditor();

        await checkDbStatus();
        await hydrateStateFromDb();

        updateAuthUI();
        updateAllSessionUI();
        updateRankingPeriodUI();

        const bootUser = getCurrentUser();
        showTab(bootUser?.role === "guest" || !bootUser ? "ranking" : "jogos");
    })();

    document.addEventListener("click", async (ev) => {
        const btnEdit = ev.target.closest?.(".btnEditMatch");

        if (!btnEdit) return;

        const sess = getCurrentSession();
        if (!sess) return alert("Sem sessão ativa.");

        const matchId = btnEdit.dataset.id;
        const idx = (state.matches || []).findIndex(m => m.id === matchId);
        if (idx < 0) return alert("Jogo não encontrado.");

        const match = state.matches[idx];

        if (btnEdit) {
            if (!requireOperator()) return;

            const a = prompt("Novo placar da Dupla A:", String(match.scoreA));
            if (a === null) return;
            const b = prompt("Novo placar da Dupla B:", String(match.scoreB));
            if (b === null) return;

            const scoreA = parseInt(a, 10);
            const scoreB = parseInt(b, 10);

            if (!Number.isFinite(scoreA) || !Number.isFinite(scoreB)) {
                return alert("Placar inválido.");
            }

            if (!isValidFinalScore(scoreA, scoreB)) {
                return alert("Placar inválido. Vai até 18, mas em 17x17 vence quem abrir 2.");
            }

            match.scoreA = scoreA;
            match.scoreB = scoreB;
            match.editedAt = Date.now();

            saveState();
            await window.syncMatchToDb(match);
            updateAllSessionUI();
            alert("Placar atualizado ✅");
            return;
        }

    });

    document.addEventListener("click", async (ev) => {
        const card = ev.target.closest(".session-share-trigger");
        if (!card) return;

        const tipo = card.dataset.shareKind;
        if (!tipo) return;

        gerarImagemResumo(tipo);
    });

    // default tab
    const bootUser = getCurrentUser();
    showTab(bootUser?.role === "guest" || !bootUser ? "ranking" : "jogos");

    // 🔄 Corrige reload ao voltar do celular bloqueado
    let rehydrating = false;

    async function safeRehydrate() {
        if (rehydrating) return;
        rehydrating = true;

        try {
            await hydrateStateFromDb();

            // mantém a mesma sessão ativa após voltar do bloqueio
            const current = (state.sessions || []).find(
                s => String(s.id) === String(state.currentSessionId)
            );

            if (current) {
                state.currentSessionId = current.id;
            }

            updateAllSessionUI();
        } catch (err) {
            console.error("Erro ao reidratar:", err);
        } finally {
            rehydrating = false;
        }
    }

    // quando volta do background
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
            safeRehydrate();
        }
    });

    document.addEventListener("click", async (ev) => {
        const btn = ev.target.closest(".btnDeleteCycleItem");
        if (!btn) return;

        if (!requireAdmin()) return;

        const id = btn.dataset.id;

        const cycle = state.cycles.find(c => c.id === id);

        if (!confirm(`Excluir ciclo "${cycle?.name || ''}"?`)) return;

        try {
            await apiJson("/api/monthly-cycles", {
                method: "DELETE",
                body: JSON.stringify({ id })
            });

            await hydrateStateFromDb();
            renderCycleTab();

            alert("Ciclo excluído 🗑️");
        } catch (err) {
            alert(err.message || "Erro ao excluir ciclo");
        }
    });

    // fallback
    window.addEventListener("focus", () => {
        safeRehydrate();
    });
})();