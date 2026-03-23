// js/app.js
// Cola aqui toda a “cola” do app: tabs, render players, sessão+duplas, registrar jogo, export/import.
// Depende das funções: loadState/saveState (storage.js), defaultState+state (state.js),
// getCurrentSession/createSession (sessions.js), addMatch (matches.js), renderRanking (ranking.js).

(function () {
    const $ = (id) => document.getElementById(id);

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
        const previousCurrentSessionId = state.currentSessionId ?? null;
        const previousViewSessionId = state.viewSessionId ?? null;

        state.sessions = [];
        state.matches = [];
        state.currentSessionId = null;
        state.viewSessionId = null;

        try {
            const data = await apiJson("/api/bootstrap");

            state.players = Array.isArray(data.players) ? data.players : [];

            const rawSessions = Array.isArray(data.sessions) ? data.sessions : [];
            const rawPairs = Array.isArray(data.pairs) ? data.pairs : [];
            const rawMatches = Array.isArray(data.matches) ? data.matches : [];

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

            state.sessions = rawSessions.map(s => {
                const sessionId = s.id;

                const sessionPairs = rawPairs
                    .filter(p => String(p.session_id ?? p.sessionId) === String(sessionId))
                    .map(p => ({
                        id: p.id,
                        p1: p.p1,
                        p2: p.p2
                    }));

                const normalized = {
                    ...s,
                    dateISO: s.dateISO ?? s.date_iso ?? null,
                    createdAt: s.createdAt ?? s.created_at ?? null,
                    pairs: sessionPairs
                };

                normalized.roster = sessionPairs.flatMap(pair => [pair.p1, pair.p2]);

                if (sessionPairs.length === 4) {
                    normalized.schedule = buildScheduleQuartaCH(sessionPairs);
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

            const currentStillExists = state.sessions.some(
                s => String(s.id) === String(previousCurrentSessionId)
            );

            if (currentStillExists) {
                state.currentSessionId = previousCurrentSessionId;
            }

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

    async function doLogout() {
        try {
            await apiJson("/api/logout", {
                method: "POST",
                body: JSON.stringify({})
            });
        } catch (err) {
            console.error("Erro no logout:", err);
        }

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

        if (jogosTab) jogosTab.style.display = logged && !guest ? "inline-block" : "none";
        if (sessoesTab) sessoesTab.style.display = logged && !guest ? "inline-block" : "none";
        if (rankingTab) rankingTab.style.display = "inline-block";
        if (jogadoresTab) jogadoresTab.style.display = isAdmin() ? "inline-block" : "none";
        if (dadosTab) dadosTab.style.display = isAdmin() ? "inline-block" : "none";

        if ($("btnStartSession")) $("btnStartSession").style.display = canOperate() ? "inline-block" : "none";
        if ($("btnAddMatch")) $("btnAddMatch").disabled = !canOperate();
        if ($("btnUndo")) $("btnUndo").style.display = isAdmin() ? "inline-block" : "none";
        if ($("btnAddPlayer")) $("btnAddPlayer").style.display = isAdmin() ? "inline-block" : "none";
        if ($("btnActivateAll")) $("btnActivateAll").style.display = isAdmin() ? "inline-block" : "none";
        if ($("btnDeactivateAll")) $("btnDeactivateAll").style.display = isAdmin() ? "inline-block" : "none";
        if ($("btnReset")) $("btnReset").style.display = isAdmin() ? "inline-block" : "none";
        if ($("btnResetKeepPlayers")) $("btnResetKeepPlayers").style.display = isAdmin() ? "inline-block" : "none";
        if ($("btnCheckDb")) $("btnCheckDb").style.display = isAdmin() ? "inline-block" : "none";

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

        if (!user) {
            name = "ranking";
        }

        if (guest && name !== "ranking") {
            name = "ranking";
        }

        if (name === "sessoes" && (!user || guest)) {
            name = "ranking";
        }

        if ((name === "jogadores" || name === "dados") && !isAdmin()) {
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

                try {
                    await apiJson("/api/players", {
                        method: "POST",
                        body: JSON.stringify({
                            id: p.id,
                            name: p.name,
                            active: p.active
                        })
                    });
                } catch (err) {
                    console.error("Erro atualizando player ativo no banco:", err);
                }
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

                try {
                    await apiJson("/api/players", {
                        method: "POST",
                        body: JSON.stringify({
                            id: p.id,
                            name: p.name,
                            active: p.active
                        })
                    });
                } catch (err) {
                    console.error("Erro atualizando nome do player no banco:", err);
                }
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

                try {
                    await apiJson("/api/players", {
                        method: "DELETE",
                        body: JSON.stringify({ id: p.id })
                    });
                } catch (err) {
                    console.error("Erro removendo player no banco:", err);
                }
            });

            right.appendChild(pill);
            right.appendChild(del);

            div.appendChild(chk);
            div.appendChild(name);
            div.appendChild(right);

            wrap.appendChild(div);
        });
    }

    async function addPlayer(name) {
        const clean = (name || "").trim();
        if (!clean) return alert("Nome vazio 😅");

        if ((state.players || []).some((p) => (p.name || "").toLowerCase() === clean.toLowerCase())) {
            return alert("Já tem esse nome.");
        }

        const player = { id: uid(), name: clean, active: true };

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
        });
    }

    if ($("btnLogout")) {
        $("btnLogout").addEventListener("click", async () => {
            await doLogout();
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
            try {
                pairs = readPairsFromEditor();
            } catch (e) {
                return alert(e.message || "Erro nas duplas.");
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

    // ---------- Registrar jogo (delegado, funciona mesmo se o botão existir depois) ----------
    document.addEventListener("click", (ev) => {
        const btn = ev.target.closest?.("#btnAddMatch");
        if (!btn) return;

        if (!requireOperator()) return;

        const sess = getCurrentSession();
        if (!sess) return alert("Inicia uma sessão do dia antes de registrar jogos.");

        const pairAId = $("pairA")?.value || "";
        const pairBId = $("pairB")?.value || "";
        if (!pairAId || !pairBId) return alert("Escolhe Dupla A e Dupla B.");
        if (pairAId === pairBId) return alert("Não dá pra jogar contra a mesma dupla 😅");

        const scoreA = parseInt(($("scoreA")?.value || ""), 10);
        const scoreB = parseInt(($("scoreB")?.value || ""), 10);
        if (!Number.isFinite(scoreA) || !Number.isFinite(scoreB)) {
            return alert("Coloca os dois placares (ex: 18 e 15).");
        }

        if (!isValidFinalScore(scoreA, scoreB)) {
            return alert("Placar inválido. Vai até 18, mas em 17x17 vence quem abrir 2.");
        }

        recomputeNextIndex(sess); // garante sess.nextIndex consistente

        //        alert("vai salvar"); // ✅ teste

        addMatch(pairAId, pairBId, scoreA, scoreB, sess.nextIndex);

        sess.nextIndex = (sess.nextIndex || 0) + 1;
        saveState();

        if ($("scoreA")) $("scoreA").value = "";
        if ($("scoreB")) $("scoreB").value = "";

        updateAllSessionUI();
        alert("Jogo salvo ✅");
    });

    if ($("btnUndo")) {
        $("btnUndo").addEventListener("click", () => {
            if (!requireAdmin()) return;
            const sess = getCurrentSession();
            if (!sess) return alert("Sem sessão ativa.");
            if (!confirm("Desfazer o último jogo desta sessão?")) return;

            undoLastMatchOfCurrentSession();
            recomputeNextIndex(sess);
            saveState();
            updateAllSessionUI();
            alert("Último jogo da sessão desfeito.");
        });
    }

    if ($("btnEndSession")) {
        $("btnEndSession").addEventListener("click", () => {
            const sess = getCurrentSession();
            if (!sess) return alert("Sem sessão ativa.");

            const matches = getSessionMatches(sess);
            if (matches.length < 8) return alert("A sessão ainda não terminou.");

            state.viewSessionId = sess.id;
            state.currentSessionId = null;
            state.updatedAt = new Date().toISOString();
            saveState();

            updateAllSessionUI();
            showTab("sessoes");

            alert(`Sessão "${sess.name}" encerrada ✅`);
        });
    }

    document.addEventListener("click", (ev) => {
        const btn = ev.target.closest?.(".btnViewSession");
        if (!btn) return;

        state.viewSessionId = btn.dataset.id;
        saveState();
        renderSessionsTab();
        showTab("sessoes");
    });

    // ---------- Ranking controls ----------
    ["period", "sortBy", "showOnly"].forEach((id) => {
        if ($(id)) $(id).addEventListener("change", () => window.renderRanking());
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
            : `falha ❌${dbStatus.error ? " (" + dbStatus.error + ")" : ""}`;

        $("dbInfo").textContent =
            `versão: ${state.version}\n` +
            `criado:  ${state.createdAt}\n` +
            `update:  ${state.updatedAt}\n` +
            `jogadores: ${(state.players || []).length}\n` +
            `sessões:   ${(state.sessions || []).length}\n` +
            `jogos:     ${(state.matches || []).length}\n` +
            `banco:     ${dbLine}\n` +
            `checado:   ${checked}\n`;
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

        wrap.innerHTML = matchesOrdered.map((m, i) => `
    <div class="player-item" style="justify-content:space-between; gap:12px;">
      <div style="display:flex; flex-wrap:wrap; gap:10px; align-items:center;">
        <b>Jogo ${(m.scheduleIndex ?? i) + 1}</b>
        <span>${pairName(m.pairAId)}</span>
        <b>${m.scoreA} x ${m.scoreB}</b>
        <span>${pairName(m.pairBId)}</span>
      </div>

    <div style="display:flex; gap:8px;">
    ${canOperate() ? `<button class="secondary btnEditMatch" data-id="${m.id}">✏️</button>` : ""}
    ${isAdmin() ? `<button class="secondary btnDelMatch" data-id="${m.id}">🗑️</button>` : ""}
    </div>
    </div>
  `).join("");
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
    }

    function getSessionMatches(sess) {
        return (state.matches || [])
            .filter(m => String(m.sessionId) === String(sess.id))
            .slice()
            .sort((a, b) => (a.scheduleIndex ?? 9999) - (b.scheduleIndex ?? 9999) || (a.createdAt - b.createdAt));
    }

    function getSessionById(id) {
        return (state.sessions || []).find(s => s.id === id) || null;
    }

    function getViewedSession() {
        return getSessionById(state.viewSessionId || state.currentSessionId || null);
    }

    function renderSessionsTab() {
        const list = $("sessionsList");
        const details = $("sessionDetails");

        if (!list || !details) return;

        const sessions = (state.sessions || [])
            .slice()
            .sort((a, b) => (b.dateISO || "").localeCompare(a.dateISO || ""));

        if (!sessions.length) {
            list.innerHTML = "<div class='muted'>Nenhuma sessão cadastrada.</div>";
            details.innerHTML = "<div class='muted'>Nada para exibir.</div>";
            return;
        }

        list.innerHTML = sessions.map(sess => {
            const matches = getSessionMatches(sess);
            const isActive = String(sess.id) === String(state.currentSessionId);
            const table = computePairTableForSession(sess);
            const best = table[0];
            const bestLabel = best ? getPairDisplayName(sess, best.pairId) : "—";

            return `
            <div class="player-item" style="justify-content:space-between; gap:12px;">
                <div>
                    <b>${sess.name || "Sem nome"}</b>
                    <div class="muted">${sess.dateISO || "-"} • ${matches.length} jogo(s)</div>
                    <div class="muted" style="margin-top:4px;">
                        🏆 ${bestLabel}
                    </div>
                </div>
                <div style="display:flex; gap:8px; align-items:center;">
                    <span class="pill">${isActive ? "ativa" : "encerrada"}</span>
                    <button class="secondary btnViewSession" data-id="${sess.id}">Abrir</button>
                </div>
            </div>
        `;
        }).join("");

        const viewed = getViewedSession();

        if (!viewed) {
            details.innerHTML = "<div class='muted'>Selecione uma sessão.</div>";
            return;
        }

        const matches = getSessionMatches(viewed);
        const table = computePairTableForSession(viewed);
        const best = table[0];
        const worst = table[table.length - 1];

        details.innerHTML = `
        <div>
            <div class="muted">Sessão selecionada</div>
            <div style="font-size:20px; font-weight:700; margin-top:4px;">
                ${viewed.name || "Sem nome"}
            </div>
            <div class="muted" style="margin-top:6px;">
                Data: ${viewed.dateISO || "-"} • Jogos: ${matches.length}
            </div>

            <hr style="margin:16px 0; opacity:.2;">

            <div><b>Duplas</b></div>
            <div class="muted" style="margin-top:8px;">
                ${(viewed.pairs || []).map(pair => getPairDisplayName(viewed, pair.id)).join(" • ")}
            </div>

            <hr style="margin:16px 0; opacity:.2;">

            ${table.length ? `
                <div><b>Resumo da sessão</b></div>

                <div style="display:grid; gap:12px; margin-top:12px;">
                    <div class="card" style="border-color: rgba(34,197,94,.40);">
                        <div style="font-size:14px; color:#22c55e;">🏆 Melhor dupla</div>
                        <div style="font-size:18px; font-weight:800; margin-top:4px;">
                            ${getPairDisplayName(viewed, best.pairId)}
                        </div>
                        <div class="muted" style="margin-top:6px;">
                            ${best.points} pts • ${best.wins} vitórias • saldo ${best.diff} • pró ${best.pointsFor}
                        </div>
                    </div>

                    <div class="card" style="border-color: rgba(239,68,68,.40);">
                        <div style="font-size:14px; color:#ef4444;">🪵 Pior dupla</div>
                        <div style="font-size:18px; font-weight:800; margin-top:4px;">
                            ${getPairDisplayName(viewed, worst.pairId)}
                        </div>
                        <div class="muted" style="margin-top:6px;">
                            ${worst.points} pts • ${worst.wins} vitórias • saldo ${worst.diff} • pró ${worst.pointsFor}
                        </div>
                    </div>
                </div>

                <hr style="margin:16px 0; opacity:.2;">

                <div><b>Ranking da sessão</b></div>

                <table class="table" style="margin-top:10px;">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Dupla</th>
                            <th>Pontos</th>
                            <th>V</th>
                            <th>Saldo</th>
                            <th>Pró</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${table.map((r, i) => `
                            <tr>
                                <td>${i + 1}</td>
                                <td>${getPairDisplayName(viewed, r.pairId)}</td>
                                <td>${r.points}</td>
                                <td>${r.wins}</td>
                                <td>${r.diff}</td>
                                <td>${r.pointsFor}</td>
                            </tr>
                        `).join("")}
                    </tbody>
                </table>
            ` : `
                <div class="muted">Sem ranking para essa sessão ainda.</div>
            `}
        </div>
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

        if (!sess) {
            if ($("gameProgress")) $("gameProgress").textContent = "";
            if ($("nextGameLabel")) $("nextGameLabel").textContent = "Sem sessão ativa.";
            if ($("pairA")) $("pairA").value = "";
            if ($("pairB")) $("pairB").value = "";
            return;
        }

        const planned = computeNextPlannedGame(sess);

        if ($("gameProgress")) $("gameProgress").textContent = `Jogo ${(sess.nextIndex || 0) + 1}`;

        if (!planned) {
            if ($("nextGameLabel")) $("nextGameLabel").textContent = "Sem próximo jogo definido.";
            return;
        }

        if (planned.done) {
            $("nextGameLabel").textContent = planned.label;
            return;
        }
        if (planned.pending) {
            $("nextGameLabel").textContent = planned.label;
            return;
        }

        const namePair = (pairId) => {
            const pr = (sess.pairs || []).find(p => p.id === pairId);
            if (!pr) return "?/?";
            const p1 = (state.players || []).find(p => p.id === pr.p1)?.name || "?";
            const p2 = (state.players || []).find(p => p.id === pr.p2)?.name || "?";
            return `${p1} + ${p2}`;
        };

        if ($("nextGameLabel")) {
            $("nextGameLabel").textContent = `${planned.label}: ${namePair(planned.pairAId)}  vs  ${namePair(planned.pairBId)}`;
        }

        if ($("pairA")) $("pairA").value = planned.pairAId;
        if ($("pairB")) $("pairB").value = planned.pairBId;
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
        updateAllSessionUI();
        await checkDbStatus();
        await hydrateStateFromDb();
        updateAuthUI();

        const bootUser = getCurrentUser();
        showTab(bootUser?.role === "guest" || !bootUser ? "ranking" : "jogos");
    })();

    document.addEventListener("click", async (ev) => {
        const btnEdit = ev.target.closest?.(".btnEditMatch");
        const btnDel = ev.target.closest?.(".btnDelMatch");
        if (!btnEdit && !btnDel) return;

        const sess = getCurrentSession();
        if (!sess) return alert("Sem sessão ativa.");

        const matchId = (btnEdit || btnDel).dataset.id;
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

        if (btnDel) {
            if (!requireAdmin()) return;
            if (!confirm("Apagar esse jogo?")) return;

            state.matches.splice(idx, 1);

            recomputeNextIndex(sess);

            saveState();
            await window.deleteMatchFromDb(match.id);
            updateAllSessionUI();
            alert("Jogo apagado ✅");
            return;
        }
    });

    // default tab
    const bootUser = getCurrentUser();
    showTab(bootUser?.role === "guest" || !bootUser ? "ranking" : "jogos");
})();