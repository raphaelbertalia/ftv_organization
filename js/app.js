// js/app.js
// Cola aqui toda a “cola” do app: tabs, render players, sessão+duplas, registrar jogo, export/import.
// Depende das funções: loadState/saveState (storage.js), defaultState+state (state.js),
// getCurrentSession/createSession (sessions.js), addMatch (matches.js), renderRanking (ranking.js).

(function () {
    const $ = (id) => document.getElementById(id);

    const ADMIN_PASSWORD = "1303"; // <-- troca aqui

    function requireAdmin() {
        const pass = prompt("Senha admin:");
        if (pass === null) return false; // cancelou
        if (pass !== ADMIN_PASSWORD) {
            alert("Senha errada 😅");
            return false;
        }
        return true;
    }

    // helpers locais
    function todayISO() {
        const d = new Date();
        const tz = d.getTimezoneOffset() * 60000;
        return new Date(Date.now() - tz).toISOString().slice(0, 10);
    }
    function uid() {
        return (crypto && crypto.randomUUID) ? crypto.randomUUID() : (Math.random().toString(36).slice(2) + Date.now());
    }

    // ---------- Tabs ----------
    function showTab(name) {
        document.querySelectorAll('[id^="tab-"]').forEach((el) => (el.style.display = "none"));
        document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
        const tabEl = document.getElementById(`tab-${name}`);
        if (tabEl) tabEl.style.display = "block";
        const btn = document.querySelector(`.tab[data-tab="${name}"]`);
        if (btn) btn.classList.add("active");

        if (name === "ranking") window.renderRanking();
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
            chk.addEventListener("change", () => {
                p.active = chk.checked;
                saveState();
                renderPairsEditor();
                updateTopStats();
            });

            const name = document.createElement("input");
            name.value = p.name || "";
            name.addEventListener("change", () => {
                const clean = (name.value || "").trim();
                if (!clean) return;
                p.name = clean;
                saveState();
                renderPairsEditor();
                renderPairSelects();
                window.renderRanking();
            });

            const right = document.createElement("div");
            right.className = "right";

            const pill = document.createElement("span");
            pill.className = "pill";
            pill.textContent = p.active ? "ativo" : "inativo";

            const del = document.createElement("span");
            del.className = "link";
            del.textContent = "remover";
            del.addEventListener("click", () => {
                if (!requireAdmin()) return;
                const used = (state.matches || []).some((m) => (m.a || []).includes(p.id) || (m.b || []).includes(p.id));
                if (used) return alert("Esse jogador já tem jogos no histórico. Desativa ao invés de remover.");
                if (!confirm(`Remover ${p.name}?`)) return;
                state.players = (state.players || []).filter((x) => x.id !== p.id);
                saveState();
                renderPlayers();
                renderPairsEditor();
                renderPairSelects();
                updateTopStats();
            });

            right.appendChild(pill);
            right.appendChild(del);

            div.appendChild(chk);
            div.appendChild(name);
            div.appendChild(right);

            wrap.appendChild(div);
        });
    }

    function addPlayer(name) {
        const clean = (name || "").trim();
        if (!clean) return alert("Nome vazio 😅");
        if ((state.players || []).some((p) => (p.name || "").toLowerCase() === clean.toLowerCase())) {
            return alert("Já tem esse nome.");
        }
        state.players.push({ id: uid(), name: clean, active: true });
        saveState();
        renderPlayers();
        renderPairsEditor();
        updateTopStats();
    }

    if ($("btnAddPlayer")) {
        $("btnAddPlayer").addEventListener("click", () => {
            if (!requireAdmin()) return;
            addPlayer($("newPlayerName").value);
            $("newPlayerName").value = "";
            $("newPlayerName").focus();
        });
    }

    if ($("btnActivateAll")) {
        $("btnActivateAll").addEventListener("click", () => {
            (state.players || []).forEach((p) => (p.active = true));
            saveState();
            renderPlayers();
            renderPairsEditor();
            updateTopStats();
        });
    }

    if ($("btnDeactivateAll")) {
        $("btnDeactivateAll").addEventListener("click", () => {
            (state.players || []).forEach((p) => (p.active = false));
            saveState();
            renderPlayers();
            renderPairsEditor();
            updateTopStats();
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
        $("btnStartSession").addEventListener("click", () => {
            if (!requireAdmin()) return;
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
            createSession(name, pairs);
            renderPairSelects();
            updateNextGameUI();
            updateTopStats();
            alert("Sessão iniciada e duplas salvas ✅");
        });
    }

    // ---------- Registrar jogo ----------
    if ($("btnAddMatch")) {
        $("btnAddMatch").addEventListener("click", () => {
            const sess = getCurrentSession();
            if (!sess) return alert("Inicia uma sessão do dia antes de registrar jogos.");

            const pairAId = $("pairA")?.value || "";
            const pairBId = $("pairB")?.value || "";
            if (!pairAId || !pairBId) return alert("Escolhe Dupla A e Dupla B.");
            if (pairAId === pairBId) return alert("Não dá pra jogar contra a mesma dupla 😅");

            const scoreA = parseInt(($("scoreA")?.value || ""), 10);
            const scoreB = parseInt(($("scoreB")?.value || ""), 10);
            if (!Number.isFinite(scoreA) || !Number.isFinite(scoreB)) return alert("Coloca os dois placares (ex: 18 e 15).");
            if (scoreA < 0 || scoreB < 0 || scoreA > 18 || scoreB > 18) return alert("Placar deve ficar entre 0 e 18.");
            if (scoreA !== 18 && scoreB !== 18) return alert("Alguém precisa fechar em 18 😅");

            addMatch(pairAId, pairBId, scoreA, scoreB);

            renderMatchHistory();

            updateNextGameUI();

            if ($("scoreA")) $("scoreA").value = "";
            if ($("scoreB")) $("scoreB").value = "";

            updateTopStats();
            window.renderRanking();
            alert("Jogo salvo ✅");
        });
    }

    if ($("btnUndo")) {
        $("btnUndo").addEventListener("click", () => {
            const sess = getCurrentSession();
            if (!sess) return alert("Sem sessão ativa.");
            if (!confirm("Desfazer o último jogo desta sessão?")) return;

            undoLastMatchOfCurrentSession();

            renderMatchHistory();

            updateTopStats();
            window.renderRanking();
            alert("Último jogo da sessão desfeito.");
        });
    }

    // ---------- Ranking controls ----------
    ["period", "sortBy", "showOnly"].forEach((id) => {
        if ($(id)) $(id).addEventListener("change", () => window.renderRanking());
    });

    // ---------- Dados: export/import/reset ----------
    function exportJSON() {
        const payload = JSON.stringify(state, null, 2);
        const blob = new Blob([payload], { type: "application/json" });
        const a = document.createElement("a");
        const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
        a.href = URL.createObjectURL(blob);
        a.download = `liga-futevolei-${ts}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
    }

    function importJSONFile(file) {
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const data = JSON.parse(String(reader.result || ""));
                if (!data || typeof data !== "object") throw new Error("JSON inválido");
                if (!Array.isArray(data.players) || !Array.isArray(data.matches)) throw new Error("Formato inválido");

                // pequenas correções/compat
                data.players.forEach((p) => {
                    if (!p.id || !p.name) throw new Error("Jogadores inválidos");
                    if (typeof p.active !== "boolean") p.active = true;
                });

                if (!Array.isArray(data.sessions)) data.sessions = [];
                if (typeof data.currentSessionId === "undefined") data.currentSessionId = null;

                state = data;
                saveState();

                renderPlayers();
                renderPairsEditor();
                renderPairSelects();
                updateTopStats();
                window.renderRanking();
                renderDataInfo();
                alert("Importado com sucesso ✅");
            } catch (e) {
                alert("Falhou ao importar: " + (e?.message || "erro"));
            }
        };
        reader.readAsText(file);
    }

    if ($("btnExport")) $("btnExport").addEventListener("click", exportJSON);

    if ($("btnImport")) $("btnImport").addEventListener("click", () => $("importFile").click());

    if ($("importFile")) {
        $("importFile").addEventListener("change", (ev) => {
            const f = ev.target.files && ev.target.files[0];
            if (!f) return;
            importJSONFile(f);
            ev.target.value = "";
        });
    }

    if ($("btnReset")) {
        $("btnReset").addEventListener("click", () => {
            if (!requireAdmin()) return; // 🔒 senha primeiro
            if (!confirm("Zerar tudo mesmo? (Jogadores, sessões e jogos)")) return;

            state = defaultState();
            saveState();
            renderPlayers();
            renderPairsEditor();
            renderPairSelects();
            updateTopStats();
            window.renderRanking();
            renderDataInfo();
            alert("Zerado.");
        });
    }

    function renderDataInfo() {
        if (!$("dbInfo")) return;
        $("dbInfo").textContent =
            `versão: ${state.version}\n` +
            `criado:  ${state.createdAt}\n` +
            `update:  ${state.updatedAt}\n` +
            `jogadores: ${(state.players || []).length}\n` +
            `sessões:   ${(state.sessions || []).length}\n` +
            `jogos:     ${(state.matches || []).length}\n`;
    }

    function renderMatchHistory() {

        const sess = getCurrentSession();
        if (!sess) return;

        const wrap = $("matchHistory");
        if (!wrap) return;

        const matches = (state.matches || []).filter(m => m.sessionId === sess.id);

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
        <b>Jogo ${i + 1}</b>
        <span>${pairName(m.pairAId)}</span>
        <b>${m.scoreA} x ${m.scoreB}</b>
        <span>${pairName(m.pairBId)}</span>
      </div>

      <div style="display:flex; gap:8px;">
        <button class="secondary btnEditMatch" data-id="${m.id}">✏️</button>
        <button class="secondary btnDelMatch" data-id="${m.id}">🗑️</button>
      </div>
    </div>
  `).join("");
    }

    function getSessionMatches(sess) {
        return (state.matches || [])
            .filter(m => m.sessionId === sess.id)
            .sort((a, b) => (a.scheduleIndex ?? 9999) - (b.scheduleIndex ?? 9999) || (a.createdAt - b.createdAt));
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
    }

    function getSessionMatches(sess) {
        return (state.matches || [])
            .filter(m => m.sessionId === sess.id)
            .slice()
            .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
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
            stats.set(p.id, { pairId: p.id, wins: 0, played: 0, diff: 0, pointsFor: 0 });
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

            if (sa > sb) a.wins++;
            else b.wins++;
        }

        const table = [...stats.values()];
        table.sort((x, y) => (y.wins - x.wins) || (y.diff - x.diff) || (y.pointsFor - x.pointsFor));
        return table;
    }

    function computeNextPlannedGame(sess) {
        const pairs = sess.pairs || [];
        const ms = getSessionMatches(sess);

        // 1) Abertura fixa
        if (ms.length === 0) return { pairAId: pairs[0]?.id, pairBId: pairs[1]?.id, label: "Jogo 1 (abertura)" };
        if (ms.length === 1) return { pairAId: pairs[2]?.id, pairBId: pairs[3]?.id, label: "Jogo 2 (abertura)" };

        // 2) Chaveamento (winner x winner / loser x loser)
        if (ms.length === 2) {
            const g1 = getWinnerLoser(ms[0]);
            const g2 = getWinnerLoser(ms[1]);
            return { pairAId: g1.winnerPairId, pairBId: g2.winnerPairId, label: "W x W" };
        }
        if (ms.length === 3) {
            const g1 = getWinnerLoser(ms[0]);
            const g2 = getWinnerLoser(ms[1]);
            return { pairAId: g1.loserPairId, pairBId: g2.loserPairId, label: "L x L" };
        }

        // 3) Depois disso: topo x topo / baixo x baixo (alternando)
        const table = computePairTableForSession(sess);
        const topA = table[0]?.pairId, topB = table[1]?.pairId;
        const botA = table[2]?.pairId, botB = table[3]?.pairId;

        // alterna: jogo par = topo, jogo ímpar = baixo (ajuste se preferir)
        const n = ms.length;
        const chooseTop = (n % 2 === 0);

        return chooseTop
            ? { pairAId: topA, pairBId: topB, label: "Topo x Topo" }
            : { pairAId: botA, pairBId: botB, label: "Baixo x Baixo" };
    }

    function updateNextGameUI() {
        const sess = getCurrentSession();
        if (!sess) return;

        const planned = computeNextPlannedGame(sess);

        if ($("gameProgress")) $("gameProgress").textContent = `Jogo ${getSessionMatches(sess).length + 1}`;

        if (!planned?.pairAId || !planned?.pairBId) {
            if ($("nextGameLabel")) $("nextGameLabel").textContent = "Sem próximo jogo definido.";
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

        // auto seleciona
        if ($("pairA")) $("pairA").value = planned.pairAId;
        if ($("pairB")) $("pairB").value = planned.pairBId;
    }

    // ---------- Init ----------
    renderPlayers();
    renderPairsEditor();
    renderPairSelects();
    updateTopStats();
    window.renderRanking();
    renderDataInfo();
    renderMatchHistory();

    document.addEventListener("click", (ev) => {
        const btnEdit = ev.target.closest?.(".btnEditMatch");
        const btnDel = ev.target.closest?.(".btnDelMatch");
        if (!btnEdit && !btnDel) return;

        const sess = getCurrentSession();
        if (!sess) return alert("Sem sessão ativa.");

        const matchId = (btnEdit || btnDel).dataset.id;
        const idx = (state.matches || []).findIndex(m => m.id === matchId);
        if (idx < 0) return alert("Jogo não encontrado.");

        // 🔒 senha (você já tem o requireAdmin() no app.js)
        if (!requireAdmin()) return;

        const match = state.matches[idx];

        if (btnEdit) {
            const a = prompt("Novo placar da Dupla A:", String(match.scoreA));
            if (a === null) return;
            const b = prompt("Novo placar da Dupla B:", String(match.scoreB));
            if (b === null) return;

            const scoreA = parseInt(a, 10);
            const scoreB = parseInt(b, 10);

            if (!Number.isFinite(scoreA) || !Number.isFinite(scoreB)) return alert("Placar inválido.");
            if (scoreA < 0 || scoreB < 0 || scoreA > 18 || scoreB > 18) return alert("Placar deve ficar entre 0 e 18.");
            if (scoreA !== 18 && scoreB !== 18) return alert("Alguém precisa fechar em 18 😅");

            match.scoreA = scoreA;
            match.scoreB = scoreB;
            match.editedAt = Date.now();

            saveState();
            updateAllSessionUI();
            alert("Placar atualizado ✅");
            return;
        }

        if (btnDel) {
            if (!confirm("Apagar esse jogo?")) return;

            state.matches.splice(idx, 1);

            // Ajusta rodízio pra não quebrar o “próximo jogo”
            recomputeNextIndex(sess);

            saveState();
            updateAllSessionUI();
            alert("Jogo apagado ✅");
            return;
        }
    });

    // default tab
    showTab("jogos");
})();