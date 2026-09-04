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
    let pendingSummaryShare = null;

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

    function getCurrentGroupId() {
        return state.auth?.currentGroupId || null;
    }

    function getCurrentGroup() {
        const groupId = getCurrentGroupId();

        if (!groupId) return null;

        return (state.auth?.groups || []).find(
            group => String(group.id) === String(groupId)
        ) || null;
    }

    function updateGroupHeader() {
        const selector = $("groupSelector");
        const label = $("headerGroupName");

        if (!selector || !label) return;

        const groups = state.auth?.groups || [];
        const currentId = String(getCurrentGroupId() || "");

        // Nenhum grupo
        if (!groups.length) {
            selector.style.display = "none";
            label.style.display = "inline";
            label.textContent = "Sem grupo";
            return;
        }

        // Apenas um grupo
        if (groups.length === 1) {
            selector.style.display = "none";
            label.style.display = "inline";
            label.textContent = groups[0].name;
            return;
        }

        // Vários grupos
        selector.innerHTML = groups.map(group => `
        <option value="${group.id}">
            ${group.name}
        </option>
            `).join("");

        selector.value = currentId;

        label.style.display = "none";
        selector.style.display = "inline-block";
    }

    function getCurrentGroupRole() {
        return getCurrentGroup()?.role || null;
    }

    function isGlobalAdmin() {
        return getCurrentUser()?.role === "admin";
    }

    function isAdmin() {
        return isGlobalAdmin() ||
            getCurrentGroupRole() === "admin";
    }

    function isOrganizer() {
        return getCurrentUser()?.role === "organizer";
    }

    function canOperate() {
        const role = getCurrentGroupRole();

        return isGlobalAdmin() ||
            (
                !!getCurrentGroupId() &&
                (role === "admin" || role === "user")
            );
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

    function getRankingPositionEmoji(index) {
        return ["🥇", "🥈", "🥉"][index] || `${index + 1}º`;
    }

    async function shareSummary(message, title = "Quarta CH") {
        if (!message) return;

        if (navigator.share) {
            try {
                await navigator.share({
                    title,
                    text: message
                });
                return;
            } catch (err) {
                if (err?.name === "AbortError") {
                    return;
                }

                console.warn(
                    "Compartilhamento nativo indisponível:",
                    err
                );
            }
        }

        window.location.href =
            `https://wa.me/?text=${encodeURIComponent(message)}`;
    }

    function buildSessionShareMessage(session) {
        const matches = getSessionMatches(session);
        const table = computePairTableForSession(session)
            .filter(row => Number(row.played) > 0);
        const trends = getHistoricalPlayerTrends(session.dateISO);

        const rankingLines = table.map((row, index) => {
            const pairName = getPairDisplayName(
                session,
                row.pairId
            );

            const balance = Number(row.diff) > 0
                ? `+${row.diff}`
                : row.diff;

            return `${getRankingPositionEmoji(index)} ${pairName} — ` +
                `${row.points} pts | ${row.wins}V | saldo ${balance}`;
        });

        return [
            "🏐 *QUARTA CH — RESUMO DA SESSÃO*",
            "",
            `📅 ${session.name || formatDateBR(session.dateISO)}`,
            `🎮 ${matches.length} jogos realizados`,
            "",
            "*Classificação da noite*",
            ...rankingLines,
            "",
            trends.rising
                ? `📈 Em alta: ${trends.rising.name}`
                : "📈 Em alta: histórico em formação",
            trends.falling
                ? `🧱 Quebrou o fechadinho: ${trends.falling.name}`
                : "🧱 Fechadinho intacto",
            "",
            "🔥 Resenha encerrada. Até a próxima quarta!"
        ].join("\n");
    }

    function buildCycleShareMessage(cycle) {
        const sessions = getCycleSessions(cycle);
        const ranking = computeIndividualCycleRanking(sessions);
        const trends = getHistoricalPlayerTrends(cycle.endDate);
        const totalMatches = sessions.reduce(
            (total, session) =>
                total + getSessionMatches(session).length,
            0
        );

        const rankingLines = ranking.map((row, index) => {
            const balance = Number(row.diff) > 0
                ? `+${row.diff}`
                : row.diff;

            return `${getRankingPositionEmoji(index)} ${row.name} — ` +
                `${row.points} pts | ${row.wins}V | ` +
                `${row.played}J | saldo ${balance}`;
        });

        return [
            "🏆 *QUARTA CH — CICLO FINALIZADO*",
            "",
            `📋 ${cycle.name || "Ciclo mensal"}`,
            `📅 ${formatDateBR(cycle.startDate)} → ${formatDateBR(cycle.endDate)}`,
            `🏐 ${sessions.length} sessões | 🎮 ${totalMatches} jogos`,
            "",
            "*Classificação final*",
            ...rankingLines,
            "",
            trends.rising
                ? `📈 Em alta: ${trends.rising.name}`
                : "📈 Em alta: histórico em formação",
            trends.falling
                ? `🧱 Quebrou o fechadinho: ${trends.falling.name}`
                : "🧱 Fechadinho intacto",
            "",
            ranking[0]
                ? `👑 Campeão do ciclo: *${ranking[0].name}*`
                : "Classificação encerrada sem jogos registrados."
        ].join("\n");
    }

    function escapeSummaryHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    async function getResenhaPhrase(kind) {
        try {
            const data = await apiJson(
                `/api/resenha-message?kind=${kind}&group_id=${encodeURIComponent(getCurrentGroupId())}`
            );

            return data?.message || "";
        } catch (_) {
            return kind === "best"
                ? "Hoje foi domínio total!"
                : "Hoje não deu... mas a resenha está garantida!";
        }
    }

    function getHistoricalPlayerTrends(referenceDateISO = null) {
        const historyByPlayer = new Map();

        const sessions = (state.sessions || [])
            .filter(session => {
                if (!getSessionMatches(session).length) return false;
                if (!referenceDateISO) return true;

                return String(session.dateISO || "") <=
                    String(referenceDateISO);
            })
            .slice()
            .sort((a, b) =>
                String(a.dateISO || "")
                    .localeCompare(String(b.dateISO || ""))
            );

        sessions.forEach(session => {
            const sessionRanking =
                computeIndividualCycleRanking([session]);

            sessionRanking.forEach(row => {
                const id = String(row.playerId);

                if (!historyByPlayer.has(id)) {
                    historyByPlayer.set(id, {
                        playerId: id,
                        name: row.name,
                        performances: []
                    });
                }

                historyByPlayer.get(id).performances.push({
                    efficiency: Number(row.efficiency) || 0,
                    pointsPerGame: row.played
                        ? Number(row.points) / Number(row.played)
                        : 0
                });
            });
        });

        const candidates = [...historyByPlayer.values()]
            .filter(player => player.performances.length >= 4)
            .map(player => {
                const performances = player.performances;
                const recent = performances.slice(-2);
                const previous = performances.slice(-4, -2);
                const average = (items, field) =>
                    items.reduce(
                        (total, item) => total + item[field],
                        0
                    ) / items.length;

                return {
                    ...player,
                    efficiencyDelta: Math.round(
                        average(recent, "efficiency") -
                        average(previous, "efficiency")
                    ),
                    pointsDelta:
                        average(recent, "pointsPerGame") -
                        average(previous, "pointsPerGame")
                };
            });

        const rising = candidates
            .filter(player => player.efficiencyDelta > 0)
            .sort((a, b) =>
                (b.efficiencyDelta - a.efficiencyDelta) ||
                (b.pointsDelta - a.pointsDelta)
            )[0] || null;

        const falling = candidates
            .filter(player => player.efficiencyDelta < 0)
            .sort((a, b) =>
                (a.efficiencyDelta - b.efficiencyDelta) ||
                (a.pointsDelta - b.pointsDelta)
            )[0] || null;

        return { rising, falling };
    }

    function canvasToSummaryFile(canvas, fileName) {
        return new Promise((resolve, reject) => {
            canvas.toBlob(blob => {
                if (!blob) {
                    reject(new Error("Não foi possível gerar a imagem."));
                    return;
                }

                resolve(new File(
                    [blob],
                    fileName,
                    { type: "image/png" }
                ));
            }, "image/png");
        });
    }

    async function createSummaryImage({
        eyebrow,
        title,
        period,
        stats,
        winnerLabel,
        winnerName,
        winnerStats,
        winnerPhrase,
        loserLabel,
        loserName,
        loserStats,
        loserPhrase,
        trends,
        ranking
    }) {
        if (typeof html2canvas !== "function") {
            throw new Error("Gerador de imagem não carregado.");
        }

        const card = document.createElement("div");
        card.className = "summary-capture-card";

        card.innerHTML = `
            <div class="summary-capture-glow"></div>

            <div class="summary-capture-content">
                <div class="summary-capture-brand">QUARTA CH</div>
                <div class="summary-capture-eyebrow">${escapeSummaryHtml(eyebrow)}</div>
                <div class="summary-capture-title">${escapeSummaryHtml(title)}</div>
                <div class="summary-capture-period">${escapeSummaryHtml(period)}</div>

                <div class="summary-capture-stats">
                    ${stats.map(item => `
                        <div>
                            <strong>${escapeSummaryHtml(item.value)}</strong>
                            <span>${escapeSummaryHtml(item.label)}</span>
                        </div>
                    `).join("")}
                </div>

                <div class="summary-capture-highlights">
                    <section class="summary-capture-highlight is-winner">
                        <div class="summary-capture-highlight-label">
                            🏆 ${escapeSummaryHtml(winnerLabel)}
                        </div>
                        <strong>${escapeSummaryHtml(winnerName)}</strong>
                        <span>${escapeSummaryHtml(winnerStats)}</span>
                        <blockquote>“${escapeSummaryHtml(winnerPhrase)}”</blockquote>
                    </section>

                    <section class="summary-capture-highlight is-loser">
                        <div class="summary-capture-highlight-label">
                            🪵 ${escapeSummaryHtml(loserLabel)}
                        </div>
                        <strong>${escapeSummaryHtml(loserName)}</strong>
                        <span>${escapeSummaryHtml(loserStats)}</span>
                        <blockquote>“${escapeSummaryHtml(loserPhrase)}”</blockquote>
                    </section>
                </div>

                <div class="summary-capture-trends">
                    <section class="summary-capture-trend is-rising">
                        <span>📈 EM ALTA</span>
                        <strong>${escapeSummaryHtml(
            trends?.rising?.name || "Histórico em formação"
        )}</strong>
                        <small>${trends?.rising
                ? `Aumento de ${trends.rising.efficiencyDelta}% no aproveitamento`
                : "São necessárias 4 participações"
            }</small>
                    </section>

                    <section class="summary-capture-trend is-falling">
                        <span>🧱 QUEBROU O FECHADINHO</span>
                        <strong>${escapeSummaryHtml(
                trends?.falling?.name || "Fechadinho intacto"
            )}</strong>
                        <small>${trends?.falling
                ? `Queda de ${Math.abs(trends.falling.efficiencyDelta)}% no aproveitamento`
                : "Ninguém caiu de rendimento"
            }</small>
                    </section>
                </div>

                <div class="summary-capture-ranking">
                    <div class="summary-capture-ranking-title">CLASSIFICAÇÃO</div>
                    ${ranking.map((row, index) => `
                        <div class="summary-capture-ranking-row">
                            <span>${getRankingPositionEmoji(index)}</span>
                            <strong>${escapeSummaryHtml(row.name)}</strong>
                            <b>${escapeSummaryHtml(row.points)} pts</b>
                        </div>
                    `).join("")}
                </div>

                <div class="summary-capture-footer">
                    FUTVÔLEI • RESENHA • QUARTA CH
                </div>
            </div>
        `;

        document.body.appendChild(card);

        try {
            const canvas = await html2canvas(card, {
                scale: 1,
                backgroundColor: null,
                useCORS: true
            });

            return canvas;
        } finally {
            document.body.removeChild(card);
        }
    }

    function showSummarySharePreview(file, message, title) {
        const modal = $("summaryShareModal");
        const preview = $("summarySharePreview");

        if (!modal || !preview) {
            throw new Error("Prévia de compartilhamento não encontrada.");
        }

        if (pendingSummaryShare?.previewUrl) {
            URL.revokeObjectURL(pendingSummaryShare.previewUrl);
        }

        const previewUrl = URL.createObjectURL(file);

        pendingSummaryShare = {
            file,
            message,
            title,
            previewUrl
        };

        preview.src = previewUrl;
        modal.classList.add("is-visible");
        modal.setAttribute("aria-hidden", "false");
        document.body.classList.add("app-is-loading");
    }

    function closeSummarySharePreview() {
        const modal = $("summaryShareModal");
        const preview = $("summarySharePreview");

        modal?.classList.remove("is-visible");
        modal?.setAttribute("aria-hidden", "true");
        document.body.classList.remove("app-is-loading");

        if (preview) {
            preview.removeAttribute("src");
        }

        if (pendingSummaryShare?.previewUrl) {
            URL.revokeObjectURL(pendingSummaryShare.previewUrl);
        }

        pendingSummaryShare = null;
    }

    function downloadPendingSummaryImage() {
        if (!pendingSummaryShare) return;

        const link = document.createElement("a");
        link.href = pendingSummaryShare.previewUrl;
        link.download = pendingSummaryShare.file.name;
        link.click();
    }

    async function sendPendingSummaryImage() {
        if (!pendingSummaryShare) return;

        const { file, message, title } = pendingSummaryShare;

        if (
            navigator.share &&
            navigator.canShare?.({ files: [file] })
        ) {
            try {
                await navigator.share({
                    title,
                    text: message,
                    files: [file]
                });

                closeSummarySharePreview();
                return;
            } catch (err) {
                if (err?.name === "AbortError") return;

                console.warn("Falha ao compartilhar imagem:", err);
            }
        }

        downloadPendingSummaryImage();
        alert(
            "A imagem foi baixada. O WhatsApp será aberto com o texto pronto; depois é só anexar a imagem no grupo."
        );

        await shareSummary(message, title);
    }

    async function prepareSessionSummaryImage(session) {
        const table = computePairTableForSession(session)
            .filter(row => Number(row.played) > 0);

        if (!table.length) {
            return alert("Essa sessão ainda não possui resultados.");
        }

        Loading.show("Criando arte da sessão...");

        try {
            const [winnerPhrase, loserPhrase] = await Promise.all([
                getResenhaPhrase("best"),
                getResenhaPhrase("worst")
            ]);

            const best = table[0];
            const worst = table[table.length - 1];
            const matches = getSessionMatches(session);
            const canvas = await createSummaryImage({
                eyebrow: "RESUMO DA SESSÃO",
                title: session.name || "Quarta CH",
                period: formatDateBR(session.dateISO),
                stats: [
                    { value: matches.length, label: "JOGOS" },
                    { value: table.length, label: "DUPLAS" },
                    { value: session.roster?.length || 0, label: "JOGADORES" }
                ],
                winnerLabel: "MELHOR DUPLA",
                winnerName: getPairDisplayName(session, best.pairId),
                winnerStats: `${best.points} pts • ${best.wins} vitórias • saldo ${best.diff}`,
                winnerPhrase,
                loserLabel: "LENHA DA NOITE",
                loserName: getPairDisplayName(session, worst.pairId),
                loserStats: `${worst.points} pts • ${worst.wins} vitórias • saldo ${worst.diff}`,
                loserPhrase,
                trends: getHistoricalPlayerTrends(session.dateISO),
                ranking: table.map(row => ({
                    name: getPairDisplayName(session, row.pairId),
                    points: row.points
                }))
            });

            const file = await canvasToSummaryFile(
                canvas,
                `resumo-sessao-${session.dateISO || "quarta-ch"}.png`
            );

            Loading.forceHide();
            showSummarySharePreview(
                file,
                buildSessionShareMessage(session),
                `Resumo da sessão — ${session.name || "Quarta CH"}`
            );
        } catch (err) {
            Loading.forceHide();
            alert(err?.message || "Não foi possível criar a arte da sessão.");
        }
    }

    async function prepareCycleSummaryImage(cycle) {
        const sessions = getCycleSessions(cycle);
        const ranking = computeIndividualCycleRanking(sessions);

        if (!ranking.length) {
            return alert("Esse ciclo ainda não possui resultados.");
        }

        Loading.show("Criando arte do ciclo...");

        try {
            const [winnerPhrase, loserPhrase] = await Promise.all([
                getResenhaPhrase("best"),
                getResenhaPhrase("worst")
            ]);

            const best = ranking[0];
            const worst = ranking[ranking.length - 1];
            const totalMatches = sessions.reduce(
                (total, session) =>
                    total + getSessionMatches(session).length,
                0
            );
            const canvas = await createSummaryImage({
                eyebrow: "RESUMO DO CICLO",
                title: cycle.name || "Ciclo mensal",
                period: `${formatDateBR(cycle.startDate)} → ${formatDateBR(cycle.endDate)}`,
                stats: [
                    { value: sessions.length, label: "SESSÕES" },
                    { value: totalMatches, label: "JOGOS" },
                    { value: ranking.length, label: "JOGADORES" }
                ],
                winnerLabel: "CAMPEÃO DO CICLO",
                winnerName: best.name,
                winnerStats: `${best.points} pts • ${best.wins} vitórias • saldo ${best.diff}`,
                winnerPhrase,
                loserLabel: "LANTERNA DO CICLO",
                loserName: worst.name,
                loserStats: `${worst.points} pts • ${worst.wins} vitórias • saldo ${worst.diff}`,
                loserPhrase,
                trends: getHistoricalPlayerTrends(cycle.endDate),
                ranking: ranking.slice(0, 5).map(row => ({
                    name: row.name,
                    points: row.points
                }))
            });

            const file = await canvasToSummaryFile(
                canvas,
                `resumo-ciclo-${cycle.startDate || "quarta-ch"}.png`
            );

            Loading.forceHide();
            showSummarySharePreview(
                file,
                buildCycleShareMessage(cycle),
                `Resumo do ciclo — ${cycle.name || "Quarta CH"}`
            );
        } catch (err) {
            Loading.forceHide();
            alert(err?.message || "Não foi possível criar a arte do ciclo.");
        }
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

    async function hydrateStateFromDb() {
        const previousViewSessionId = state.viewSessionId ?? null;
        const previousViewCycleId = state.viewCycleId ?? null;

        state.players = [];
        state.sessions = [];
        state.matches = [];
        state.cycles = [];
        state.currentSessionId = null;
        state.currentCycleId = null;
        state.viewSessionId = null;
        state.viewCycleId = null;

        try {
            const groupId = getCurrentGroupId();

            if (!groupId) {
                return;
            }

            const data = await apiJson(
                `/api/bootstrap?group_id=${encodeURIComponent(groupId)}`
            );

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

            const viewedCycleStillExists = state.cycles.some(
                cycle => String(cycle.id) === String(previousViewCycleId)
            );

            if (viewedCycleStillExists) {
                state.viewCycleId = previousViewCycleId;
            }

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
        const data = await apiJson("/api/auth?action=login", {
            method: "POST",
            body: JSON.stringify({ username, password })
        });

        state.auth.user = data.user;

        state.auth.groups = Array.isArray(data.groups)
            ? data.groups
            : [];

        if (state.auth.groups.length === 1) {
            state.auth.currentGroupId = state.auth.groups[0].id;
        } else {
            state.auth.currentGroupId = null;
        }

        saveState();
        updateAuthUI();
    }

    function doLogout() {
        state.auth.user = null;
        state.auth.groups = [];
        state.auth.currentGroupId = null;

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
        const hasGroup = !!getCurrentGroupId();
        updateGroupHeader();

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
                logged && !guest && !organizer && hasGroup
                    ? "inline-block"
                    : "none";
        }

        if (sessoesTab) {
            sessoesTab.style.display =
                logged && !guest && !organizer && hasGroup
                    ? "inline-block"
                    : "none";
        }

        if (rankingTab) {
            rankingTab.style.display =
                !organizer && (guest || hasGroup)
                    ? "inline-block"
                    : "none";
        }

        if (sorteiosTab) {
            sorteiosTab.style.display =
                logged && !guest
                    ? "inline-block"
                    : "none";
        }

        if (jogadoresTab) {
            jogadoresTab.style.display =
                isAdmin() && hasGroup ? "inline-block" : "none";
        }

        if (dadosTab) {
            dadosTab.style.display =
                isAdmin() && hasGroup ? "inline-block" : "none";
        }

        if (cicloTab) {
            cicloTab.style.display =
                isAdmin() && hasGroup ? "inline-block" : "none";
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

        const hasGroup = !!getCurrentGroupId();

        if (
            user &&
            !guest &&
            !organizer &&
            !hasGroup &&
            name !== "sorteios"
        ) {
            return;
        }

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
        const organizer = isOrganizer();
        const groups = state.auth?.groups || [];
        const hasGroups = groups.length > 0;
        const hasGroup = !!getCurrentGroupId();
        const waitingForGroup =
            logged && !guest && !organizer && !hasGroups;

        const hasActiveSession = !!getCurrentSession();

        if ($("loginScreen")) {
            $("loginScreen").style.display = (!logged || guest) ? "block" : "none";
        }

        if ($("noGroupScreen")) {
            $("noGroupScreen").style.display =
                waitingForGroup
                    ? "block"
                    : "none";
        }

        if ($("appContent")) {
            $("appContent").style.display =
                logged ? "block" : "none";
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
                        side: p.side || "",
                        group_id: getCurrentGroupId()
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
                        side: p.side || "",
                        group_id: getCurrentGroupId()
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
                        side: p.side || "",
                        group_id: getCurrentGroupId()
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
                    body: JSON.stringify({ id: p.id, group_id: getCurrentGroupId() })
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
    function formatDateBR(dateISO) {
        if (!dateISO) return "—";

        const [year, month, day] = String(dateISO).split("-");

        if (!year || !month || !day) {
            return dateISO;
        }

        return `${day}/${month}/${year}`;
    }

    function getCycleSessions(cycle) {
        if (!cycle) return [];

        return (state.sessions || [])
            .filter(session => {
                const date = session.dateISO;

                return (
                    date &&
                    cycle.startDate &&
                    cycle.endDate &&
                    date >= cycle.startDate &&
                    date <= cycle.endDate
                );
            })
            .sort((a, b) =>
                String(b.dateISO || "")
                    .localeCompare(String(a.dateISO || ""))
            );
    }

    function countCycleWednesdays(startDate, endDate) {
        if (!startDate || !endDate) return 0;

        const parseDate = (dateISO) => {
            const [year, month, day] = String(dateISO)
                .split("-")
                .map(Number);

            return new Date(
                Date.UTC(year, month - 1, day)
            );
        };

        const start = parseDate(startDate);
        const end = parseDate(endDate);

        if (
            Number.isNaN(start.getTime()) ||
            Number.isNaN(end.getTime()) ||
            start > end
        ) {
            return 0;
        }

        let total = 0;
        const current = new Date(start);

        while (current <= end) {
            // Domingo = 0, quarta-feira = 3
            if (current.getUTCDay() === 3) {
                total++;
            }

            current.setUTCDate(
                current.getUTCDate() + 1
            );
        }

        return total;
    }

    function computeIndividualCycleRanking(cycleSessions) {
        const stats = new Map();

        function ensurePlayer(playerId) {
            if (!playerId) return null;

            const normalizedId = String(playerId);

            if (!stats.has(normalizedId)) {
                const player = (state.players || []).find(
                    item => String(item.id) === normalizedId
                );

                stats.set(normalizedId, {
                    playerId: normalizedId,
                    name: player?.name || "Jogador",
                    sessions: new Set(),
                    played: 0,
                    wins: 0,
                    points: 0,
                    pointsFor: 0,
                    diff: 0
                });
            }

            return stats.get(normalizedId);
        }

        cycleSessions.forEach(session => {
            const pairsById = new Map(
                (session.pairs || []).map(pair => [
                    String(pair.id),
                    pair
                ])
            );

            getSessionMatches(session).forEach(match => {
                const pairA = pairsById.get(
                    String(match.pairAId)
                );

                const pairB = pairsById.get(
                    String(match.pairBId)
                );

                if (!pairA || !pairB) return;

                const scoreA = Number(match.scoreA);
                const scoreB = Number(match.scoreB);

                if (
                    !Number.isFinite(scoreA) ||
                    !Number.isFinite(scoreB)
                ) {
                    return;
                }

                const aWon = scoreA > scoreB;
                const bWon = scoreB > scoreA;

                const aPoints = aWon
                    ? scoreA === 18 && scoreB === 0
                        ? 4
                        : 3
                    : 0;

                const bPoints = bWon
                    ? scoreB === 18 && scoreA === 0
                        ? 4
                        : 3
                    : 0;

                [pairA.p1, pairA.p2].forEach(playerId => {
                    const stat = ensurePlayer(playerId);

                    if (!stat) return;

                    stat.sessions.add(String(session.id));
                    stat.played++;
                    stat.pointsFor += scoreA;
                    stat.diff += scoreA - scoreB;

                    if (aWon) {
                        stat.wins++;
                        stat.points += aPoints;
                    }
                });

                [pairB.p1, pairB.p2].forEach(playerId => {
                    const stat = ensurePlayer(playerId);

                    if (!stat) return;

                    stat.sessions.add(String(session.id));
                    stat.played++;
                    stat.pointsFor += scoreB;
                    stat.diff += scoreB - scoreA;

                    if (bWon) {
                        stat.wins++;
                        stat.points += bPoints;
                    }
                });
            });
        });

        return [...stats.values()]
            .map(stat => ({
                ...stat,
                sessions: stat.sessions.size,
                losses: Math.max(
                    0,
                    stat.played - stat.wins
                ),
                efficiency: stat.played
                    ? Math.round(
                        (stat.wins / stat.played) * 100
                    )
                    : 0
            }))
            .sort((a, b) =>
                (b.points - a.points) ||
                (b.wins - a.wins) ||
                (b.diff - a.diff) ||
                (b.pointsFor - a.pointsFor) ||
                a.name.localeCompare(b.name)
            );
    }

    function computeCycleRankingMovement(
        currentRanking,
        cycleSessions
    ) {
        const movementByPlayer = new Map();

        if (!currentRanking.length) {
            return movementByPlayer;
        }

        /*
         * getCycleSessions retorna da mais recente para a mais antiga.
         * Removemos a sessão mais recente para reconstruir a
         * classificação existente antes da última rodada.
         */
        const sessionsBeforeLatest =
            cycleSessions.slice(1);

        const previousRanking =
            computeIndividualCycleRanking(
                sessionsBeforeLatest
            );

        const previousPositions = new Map(
            previousRanking.map((row, index) => [
                String(row.playerId),
                index + 1
            ])
        );

        currentRanking.forEach((row, index) => {
            const currentPosition = index + 1;

            const previousPosition =
                previousPositions.get(
                    String(row.playerId)
                );

            /*
             * Ainda não havia ranking anterior.
             * Consideramos manutenção para evitar uma falsa subida.
             */
            if (!previousPosition) {
                movementByPlayer.set(
                    String(row.playerId),
                    {
                        type: "stable",
                        difference: 0,
                        previousPosition: null,
                        currentPosition,
                        label: "Manteve"
                    }
                );

                return;
            }

            const difference =
                previousPosition - currentPosition;

            if (difference > 0) {
                movementByPlayer.set(
                    String(row.playerId),
                    {
                        type: "up",
                        difference,
                        previousPosition,
                        currentPosition,
                        label:
                            difference === 1
                                ? "Subiu 1 posição"
                                : `Subiu ${difference} posições`
                    }
                );

                return;
            }

            if (difference < 0) {
                const positionsLost =
                    Math.abs(difference);

                movementByPlayer.set(
                    String(row.playerId),
                    {
                        type: "down",
                        difference: positionsLost,
                        previousPosition,
                        currentPosition,
                        label:
                            positionsLost === 1
                                ? "Caiu 1 posição"
                                : `Caiu ${positionsLost} posições`
                    }
                );

                return;
            }

            movementByPlayer.set(
                String(row.playerId),
                {
                    type: "stable",
                    difference: 0,
                    previousPosition,
                    currentPosition,
                    label: "Manteve"
                }
            );
        });

        return movementByPlayer;
    }

    function renderCycleTab() {
        const info = $("cycleInfo");
        const rankingWrap = $("cycleIndividualRanking");
        const sessionsWrap = $("cycleSessionsList");
        const legacyEditor = $("cyclePairsEditor");
        const listView = $("cycleListView");
        const detailsView = $("cycleDetailsView");
        const listWrap = $("cycleList");

        if (
            !info ||
            !rankingWrap ||
            !sessionsWrap ||
            !legacyEditor ||
            !listView ||
            !detailsView ||
            !listWrap
        ) {
            return;
        }

        const cycle = getViewedCycle();
        const cycleIsActive = cycle?.status === "em_andamento";

        const allCycles = (state.cycles || [])
            .slice()
            .sort((a, b) =>
                String(b.startDate || "")
                    .localeCompare(String(a.startDate || ""))
            );

        listView.style.display = cycle ? "none" : "block";
        detailsView.style.display = cycle ? "block" : "none";

        listWrap.innerHTML = allCycles.length
            ? `
                <div class="cycle-browser-list">
                    ${allCycles.map(item => {
                const itemSessions = getCycleSessions(item);
                const itemMatches = itemSessions.reduce(
                    (total, session) =>
                        total + getSessionMatches(session).length,
                    0
                );
                const itemRanking =
                    computeIndividualCycleRanking(itemSessions);
                const champion = itemRanking[0] || null;
                const isActive =
                    item.status === "em_andamento";

                return `
                            <article class="cycle-browser-item">
                                <div class="cycle-browser-main">
                                    <div class="cycle-browser-header">
                                        <strong>${item.name || "Ciclo sem nome"}</strong>
                                        <span class="pill ${isActive ? "is-active" : ""}">
                                            ${isActive ? "em andamento" : "encerrado"}
                                        </span>
                                    </div>

                                    <div class="cycle-browser-period">
                                        📅 ${formatDateBR(item.startDate)}
                                        → ${formatDateBR(item.endDate)}
                                    </div>

                                    <div class="cycle-browser-stats">
                                        <span>🏐 ${itemSessions.length} sessão(ões)</span>
                                        <span>🎮 ${itemMatches} jogo(s)</span>
                                        <span>👥 ${itemRanking.length} jogador(es)</span>
                                        <span>🏆 ${champion ? champion.name : "Em aberto"}</span>
                                    </div>
                                </div>

                                <div class="cycle-browser-actions">
                                    <button
                                        class="secondary btnViewCycle"
                                        data-id="${item.id}"
                                        type="button"
                                    >
                                        ➜ Abrir
                                    </button>

                                    ${isAdmin()
                        ? `
                                            <button
                                                class="secondary btnDeleteCycleItem"
                                                data-id="${item.id}"
                                                type="button"
                                                aria-label="Excluir ciclo"
                                            >
                                                🗑️
                                            </button>
                                        `
                        : ""
                    }
                                </div>
                            </article>
                        `;
            }).join("")}
                </div>
            `
            : `
                <div class="cycle-empty-state">
                    <div class="cycle-empty-icon">🏆</div>
                    <div>
                        <b>Nenhum ciclo cadastrado</b>
                        <div class="muted" style="margin-top:4px;">
                            Abra “Gerenciar ciclo” para criar o primeiro ciclo mensal.
                        </div>
                    </div>
                </div>
            `;

        const cycleSessions =
            getCycleSessions(cycle);

        const totalCycleRounds =
            cycle
                ? countCycleWednesdays(
                    cycle.startDate,
                    cycle.endDate
                )
                : 0;

        const completedRoundDates = new Set(
            cycleSessions
                .map(session => session.dateISO)
                .filter(Boolean)
        );

        const completedRounds =
            Math.min(
                completedRoundDates.size,
                totalCycleRounds
            );

        const cycleProgress =
            totalCycleRounds > 0
                ? Math.min(
                    100,
                    Math.round(
                        (completedRounds / totalCycleRounds) * 100
                    )
                )
                : 0;

        const individualRanking =
            computeIndividualCycleRanking(cycleSessions);

        const rankingMovement =
            computeCycleRankingMovement(
                individualRanking,
                cycleSessions
            );

        const totalMatches =
            cycleSessions.reduce(
                (total, session) =>
                    total + getSessionMatches(session).length,
                0
            );

        const totalPlayers =
            individualRanking.length;

        const firstPlace =
            individualRanking[0] || null;

        const secondPlace =
            individualRanking[1] || null;

        const leadershipStatus =
            firstPlace && secondPlace
                ? firstPlace.points === secondPlace.points
                    ? "🔥 Empate na liderança"
                    : "👑 Líder isolado"
                : firstPlace
                    ? "👑 Líder isolado"
                    : "Classificação em aberto";

        /*
         * RESUMO DO CICLO
         */
        if (!cycle) {
            info.innerHTML = `
            <div class="cycle-empty-state">

                <div class="cycle-empty-icon">
                    🏆
                </div>

                <div>
                    <b>Nenhum ciclo ativo</b>

                    <div
                        class="muted"
                        style="margin-top:4px;"
                    >
                        Abra “Gerenciar ciclo” para criar
                        o próximo ciclo mensal.
                    </div>
                </div>

            </div>
        `;
        } else {
            info.innerHTML = `
            <div class="cycle-overview-main">

                <div>
                    <div class="cycle-overview-eyebrow">
                        ${cycleIsActive ? "Ciclo atual" : "Ciclo encerrado"}
                    </div>

                    <div class="cycle-overview-title">
                        ${cycle.name || "Ciclo mensal"}
                    </div>

                    <div class="cycle-overview-period">
                        ${formatDateBR(cycle.startDate)}
                        →
                        ${formatDateBR(cycle.endDate)}
                    </div>
                </div>

                <span class="cycle-status-badge ${cycleIsActive ? "is-active" : "is-finished"}">
                    ${cycleIsActive ? "Em andamento" : "Encerrado"}
                </span>

            </div>

            <div class="cycle-progress">

                <div class="cycle-progress-header">

                    <span>Progresso do ciclo</span>

                    <strong>
                        ${cycleProgress}%
                    </strong>

                </div>

                <div
                    class="cycle-progress-track"
                    role="progressbar"
                    aria-valuemin="0"
                    aria-valuemax="100"
                    aria-valuenow="${cycleProgress}"
                >
                    <div
                        class="cycle-progress-fill"
                        style="width:${cycleProgress}%;"
                    ></div>
                </div>

                <div class="cycle-progress-caption">
                    ${completedRounds}
                    de
                    ${totalCycleRounds}
                    ${totalCycleRounds === 1
                    ? "quarta realizada"
                    : "quartas realizadas"
                }
                </div>

            </div>

            <div class="cycle-overview-stats">

                <div class="cycle-stat-item">
                    <strong>${cycleSessions.length}</strong>
                    <span>Sessões</span>
                </div>

                <div class="cycle-stat-item">
                    <strong>${totalMatches}</strong>
                    <span>Jogos</span>
                </div>

                <div class="cycle-stat-item">
                    <strong>${totalPlayers}</strong>
                    <span>Jogadores</span>
                </div>

            </div>

            <div class="cycle-leadership-status">
                ${leadershipStatus}
            </div>

            <div class="cycle-top-two">

                <div class="cycle-top-player is-first">

                    <div class="cycle-top-player-position">
                        🥇 1º colocado
                    </div>

                    <strong>
                        ${firstPlace ? firstPlace.name : "—"}
                    </strong>

                    <span>
                        ${firstPlace
                    ? `${firstPlace.points} pts • ${firstPlace.wins} vitórias`
                    : "Sem classificação"
                }
                    </span>

                </div>

                <div class="cycle-top-player is-second">

                    <div class="cycle-top-player-position">
                        🥈 2º colocado
                    </div>

                    <strong>
                        ${secondPlace ? secondPlace.name : "—"}
                    </strong>

                    <span>
                        ${secondPlace
                    ? `${secondPlace.points} pts • ${secondPlace.wins} vitórias`
                    : "Sem classificação"
                }
                    </span>

                </div>

            </div>

            <div class="cycle-share-actions">
                <button
                    class="btnShareCycleSummary"
                    data-id="${cycle.id}"
                    type="button"
                >
                    📲 Compartilhar resumo
                </button>
            </div>
        `;
        }

        /*
         * RANKING INDIVIDUAL
         */
        if (!cycle) {
            rankingWrap.innerHTML = `
            <div class="muted">
                Crie um ciclo para acompanhar
                a classificação individual.
            </div>
        `;
        } else if (!individualRanking.length) {
            rankingWrap.innerHTML = `
            <div class="cycle-empty-inline">
                Ainda não há jogos registrados
                dentro deste ciclo.
            </div>
        `;
        } else {
            const visibleRanking =
                individualRanking.slice(0, 5);

            const medals = [
                "🥇",
                "🥈"
            ];

            rankingWrap.innerHTML = `
            <div class="cycle-ranking-list">

            ${visibleRanking.map((row, index) => {
                const movement =
                    rankingMovement.get(
                        String(row.playerId)
                    ) || {
                        type: "stable",
                        difference: 0,
                        label: "Manteve"
                    };

                const movementSymbol =
                    movement.type === "up"
                        ? "▲"
                        : movement.type === "down"
                            ? "▼"
                            : "●";

                const movementText =
                    movement.type === "stable"
                        ? movementSymbol
                        : `${movementSymbol}${movement.difference}`;

                return `

                    ${index === 2
                        ? `
                                <div class="cycle-ranking-divider"></div>>
                            `
                        : ""
                    }

                    <div
                        class="
                            cycle-ranking-row
                            ${index < 2
                        ? `is-top-${index + 1}`
                        : ""
                    }
                        "
                    >

                        <div class="cycle-ranking-position">
                            ${medals[index] ||
                    `${index + 1}º`
                    }
                        </div>

                        <div class="cycle-ranking-player">

                            <div class="cycle-ranking-name-line">

                                <strong>
                                    ${row.name}
                                </strong>

                                <span
                                    class="
                                        cycle-ranking-movement
                                        is-${movement.type}
                                    "
                                    title="${movement.label}"
                                    aria-label="${movement.label}"
                                >
                                    ${movementText}
                                </span>

                            </div>

                            <span>
                                ${row.wins}V
                                •
                                ${row.losses}D
                                •
                                ${row.efficiency}%
                            </span>

                        </div>

                        <div class="cycle-ranking-points">

                            <strong>
                                ${row.points}
                            </strong>

                            <span>pts</span>

                        </div>

                    </div>
                `;
            }).join("")}

            </div>

            ${individualRanking.length > 5
                    ? `
                        <details class="cycle-full-ranking">

                            <summary>
                                Ver classificação completa
                                (${individualRanking.length})
                            </summary>

                            <div class="cycle-ranking-table-wrap">

                                <table class="table cycle-ranking-table">

                                    <thead>
                                        <tr>
                                            <th>#</th>
                                            <th>Jogador</th>
                                            <th>Pts</th>
                                            <th>V</th>
                                            <th>J</th>
                                            <th>Saldo</th>
                                            <th>Aprov.</th>
                                        </tr>
                                    </thead>

                                    <tbody>

                                        ${individualRanking.map(
                        (row, index) => `
                                                <tr>

                                                    <td>
                                                        ${index + 1}
                                                    </td>

                                                    <td>
                                                        <b>${row.name}</b>
                                                    </td>

                                                    <td>
                                                        ${row.points}
                                                    </td>

                                                    <td>
                                                        ${row.wins}
                                                    </td>

                                                    <td>
                                                        ${row.played}
                                                    </td>

                                                    <td>
                                                        ${row.diff > 0
                                ? "+"
                                : ""
                            }${row.diff}
                                                    </td>

                                                    <td>
                                                        ${row.efficiency}%
                                                    </td>

                                                </tr>
                                            `
                    ).join("")}

                                    </tbody>

                                </table>

                            </div>

                        </details>
                    `
                    : ""
                }
        `;
        }

        /*
         * SESSÕES DO CICLO
         */
        if (!cycle) {
            sessionsWrap.innerHTML = `
            <div class="muted">
                Nenhuma sessão para exibir.
            </div>
        `;
        } else if (!cycleSessions.length) {
            sessionsWrap.innerHTML = `
            <div class="cycle-empty-inline">
                Nenhuma sessão encontrada entre
                ${formatDateBR(cycle.startDate)}
                e
                ${formatDateBR(cycle.endDate)}.
            </div>
        `;
        } else {
            sessionsWrap.innerHTML = `
            <div class="cycle-session-list">

                ${cycleSessions.map(session => {
                const matches =
                    getSessionMatches(session);

                const sessionRanking =
                    computeIndividualCycleRanking([
                        session
                    ]);

                const sessionLeader =
                    sessionRanking[0] || null;

                const sessionStatus =
                    session.status === "encerrada"
                        ? "Encerrada"
                        : "Em andamento";

                return `
                        <article class="cycle-session-item">

                        <div class="cycle-session-date">

                            <strong>
                                ${formatDateBR(session.dateISO).slice(0, 5)}
                            </strong>

                            <span>
                                ${sessionStatus}
                            </span>

                        </div>

                        <div class="cycle-session-info">

                            <strong>
                                📅 Quarta ${formatDateBR(session.dateISO).slice(0, 5)}
                            </strong>

                            <div class="cycle-session-meta">

                                <span>
                                    🏐 ${matches.length} jogo(s)
                                </span>

                                ${sessionLeader
                        ? `
                                            <span>
                                                🥇 ${sessionLeader.name}
                                                • ${sessionLeader.points} pts
                                            </span>
                                        `
                        : ""
                    }

                            </div>

                        </div>

                            <button
                                class="
                                    secondary
                                    btnViewSession
                                "
                                data-id="${session.id}"
                                type="button"
                            >
                                ➜ Abrir
                            </button>

                        </article>
                    `;
            }).join("")}

            </div>
        `;
        }

        /*
         * DUPLAS FIXAS LEGADAS
         */
        const pairs =
            getActiveCycle()?.pairs || [];

        legacyEditor.innerHTML = pairs.length
            ? `
            <div class="cycle-legacy-pairs">

                ${pairs.map((pair, index) => {
                const player1 =
                    (state.players || []).find(
                        player =>
                            String(player.id) ===
                            String(pair.p1)
                    );

                const player2 =
                    (state.players || []).find(
                        player =>
                            String(player.id) ===
                            String(pair.p2)
                    );

                const player1Name =
                    player1?.name || "?";

                const player2Name =
                    player2?.name || "?";

                return `
                        <div class="cycle-legacy-pair">

                            <span>
                                Dupla ${index + 1}
                            </span>

                            <strong>
                                ${player1Name}
                                +
                                ${player2Name}
                            </strong>

                        </div>
                    `;
            }).join("")}

            </div>
        `
            : `
            <div class="muted">
                Nenhuma dupla fixa salva
                para o ciclo ativo.
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
                body: JSON.stringify({
                    ...player,
                    group_id: getCurrentGroupId()
                })
            });
        } catch (err) {
            console.error("Erro salvando jogador no banco:", err);
        }
    }

    async function openGroupAccessModal() {
        const user = getCurrentUser();

        if (!user || user.role === "guest") {
            return alert("Faça login para solicitar acesso.");
        }

        const modal = $("groupAccessModal");
        const select = $("groupAccessSelect");
        const status = $("groupAccessStatus");

        if (!modal || !select) return;

        modal.style.display = "block";

        select.innerHTML = `
        <option value="">Carregando grupos...</option>
    `;

        if (status) {
            status.textContent = "";
        }

        try {
            const data = await apiJson("/api/auth?action=access-options", {
                method: "POST",
                body: JSON.stringify({
                    user_id: user.id
                })
            });

            const groups = Array.isArray(data.groups)
                ? data.groups
                : [];

            if (!groups.length) {
                select.innerHTML = `
                <option value="">Nenhum grupo disponível</option>
            `;

                select.disabled = true;

                if ($("btnConfirmGroupAccess")) {
                    $("btnConfirmGroupAccess").disabled = true;
                }

                return;
            }

            select.disabled = false;

            if ($("btnConfirmGroupAccess")) {
                $("btnConfirmGroupAccess").disabled = false;
            }

            select.innerHTML = `
            <option value="">Selecione um grupo</option>
            ${groups.map(group => {
                let label = group.name;

                if (group.already_member) {
                    label += " — Você já participa";
                } else if (group.request_status === "pending") {
                    label += " — Solicitação pendente";
                }

                return `
                    <option
                        value="${group.id}"
                        data-member="${group.already_member ? "true" : "false"}"
                        data-status="${group.request_status || ""}"
                    >
                        ${label}
                    </option>
                `;
            }).join("")}
        `;

        } catch (err) {
            select.innerHTML = `
            <option value="">Erro ao carregar grupos</option>
        `;

            if (status) {
                status.textContent =
                    err.message || "Não foi possível carregar os grupos.";
            }
        }
    }

    if ($("btnRequestGroupAccess")) {
        $("btnRequestGroupAccess").addEventListener("click", async () => {
            await openGroupAccessModal();
        });
    }

    if ($("btnCancelGroupAccess")) {
        $("btnCancelGroupAccess").addEventListener("click", () => {
            $("groupAccessModal").style.display = "none";

            if ($("groupAccessStatus")) {
                $("groupAccessStatus").textContent = "";
            }
        });
    }

    if ($("groupAccessSelect")) {
        $("groupAccessSelect").addEventListener("change", () => {
            const select = $("groupAccessSelect");
            const option = select.options[select.selectedIndex];
            const status = $("groupAccessStatus");
            const button = $("btnConfirmGroupAccess");

            if (!option || !option.value) {
                if (status) status.textContent = "";
                if (button) button.disabled = false;
                return;
            }

            const alreadyMember = option.dataset.member === "true";
            const requestStatus = option.dataset.status;

            if (alreadyMember) {
                if (status) {
                    status.textContent =
                        "Você já participa deste grupo.";
                }

                if (button) button.disabled = true;
                return;
            }

            if (requestStatus === "pending") {
                if (status) {
                    status.textContent =
                        "Sua solicitação para este grupo ainda está pendente. Entre em contato com o responsável pelo grupo.";
                }

                if (button) button.disabled = true;
                return;
            }

            if (status) status.textContent = "";
            if (button) button.disabled = false;
        });
    }

    if ($("btnConfirmGroupAccess")) {
        $("btnConfirmGroupAccess").addEventListener("click", async () => {
            const user = getCurrentUser();
            const select = $("groupAccessSelect");
            const status = $("groupAccessStatus");
            const button = $("btnConfirmGroupAccess");

            if (!user || user.role === "guest") {
                return alert("Faça login para solicitar acesso.");
            }

            const groupId = select?.value;

            if (!groupId) {
                if (status) {
                    status.textContent =
                        "Selecione um grupo para enviar a solicitação.";
                }

                return;
            }

            try {
                if (button) button.disabled = true;

                if (status) {
                    status.textContent = "Enviando solicitação...";
                }

                const data = await apiJson(
                    "/api/auth?action=request-group-access",
                    {
                        method: "POST",
                        body: JSON.stringify({
                            user_id: user.id,
                            group_id: groupId
                        })
                    }
                );

                if (status) {
                    status.textContent =
                        data.message || "Solicitação enviada com sucesso.";
                }

                await openGroupAccessModal();

            } catch (err) {
                if (status) {
                    status.textContent =
                        err.message || "Não foi possível enviar a solicitação.";
                }

                if (button) button.disabled = false;
            }
        });
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
                            active: true,
                            group_id: getCurrentGroupId()
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
                            active: false,
                            group_id: getCurrentGroupId()
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
                participant_ids: session.participantIds,
                group_id: getCurrentGroupId()
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
                pending_pair_b_id: pairB.id,
                group_id: getCurrentGroupId()
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
                pending_pair_b_id: pairB.id,
                group_id: getCurrentGroupId()
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

    const RECENT_PAIR_PENALTIES = [1000000, 100000, 10000, 1000];

    function getPairKey(playerIdA, playerIdB) {
        return [String(playerIdA), String(playerIdB)]
            .sort()
            .join("::");
    }

    function getPairPenalties() {
        const penaltiesByPair = new Map();

        const sessionsWithPairs = (state.sessions || [])
            .filter(session =>
                Array.isArray(session.pairs) &&
                session.pairs.length > 0
            )
            .slice()
            .sort((a, b) => {
                const dateA = a.createdAt || a.dateISO || "";
                const dateB = b.createdAt || b.dateISO || "";

                return String(dateB).localeCompare(String(dateA));
            });

        // Penalidade por qualquer parceria existente no histórico
        sessionsWithPairs.forEach(session => {
            (session.pairs || []).forEach(pair => {
                if (!pair.p1 || !pair.p2) return;

                const key = getPairKey(pair.p1, pair.p2);
                const currentPenalty = penaltiesByPair.get(key) || 0;

                penaltiesByPair.set(
                    key,
                    currentPenalty + 10
                );
            });
        });

        // Penalidade adicional para as quatro sessões mais recentes
        sessionsWithPairs
            .slice(0, RECENT_PAIR_PENALTIES.length)
            .forEach((session, sessionIndex) => {
                const recentPenalty =
                    RECENT_PAIR_PENALTIES[sessionIndex];

                (session.pairs || []).forEach(pair => {
                    if (!pair.p1 || !pair.p2) return;

                    const key = getPairKey(pair.p1, pair.p2);
                    const currentPenalty =
                        penaltiesByPair.get(key) || 0;

                    penaltiesByPair.set(
                        key,
                        currentPenalty + recentPenalty
                    );
                });
            });

        return penaltiesByPair;
    }

    function generatePermutations(players) {
        if (players.length <= 1) {
            return [players];
        }

        const permutations = [];

        players.forEach((player, index) => {
            const remainingPlayers = players.filter(
                (_, currentIndex) => currentIndex !== index
            );

            const remainingPermutations =
                generatePermutations(remainingPlayers);

            remainingPermutations.forEach(permutation => {
                permutations.push([
                    player,
                    ...permutation
                ]);
            });
        });

        return permutations;
    }

    function findBestPairFormation(leftPlayers, rightPlayers) {
        const penaltiesByPair = getPairPenalties();
        const rightPermutations = generatePermutations(rightPlayers);

        let lowestScore = Infinity;
        let bestFormations = [];

        rightPermutations.forEach(permutation => {
            const formation = leftPlayers.map((leftPlayer, index) => ({
                left: leftPlayer,
                right: permutation[index]
            }));

            const score = formation.reduce((total, pair) => {
                const key = getPairKey(
                    pair.left.id,
                    pair.right.id
                );

                return total + (penaltiesByPair.get(key) || 0);
            }, 0);

            if (score < lowestScore) {
                lowestScore = score;
                bestFormations = [formation];
                return;
            }

            if (score === lowestScore) {
                bestFormations.push(formation);
            }
        });

        return bestFormations[
            Math.floor(Math.random() * bestFormations.length)
        ];
    }

    function drawPairsBySide() {
        if (getCurrentSession()) {
            return alert("Já existe uma sessão ativa.");
        }

        const activePlayers = (state.players || [])
            .filter(player => player.active);

        const lefts = shuffleArray(
            activePlayers.filter(player => player.side === "left")
        );

        const rights = shuffleArray(
            activePlayers.filter(player => player.side === "right")
        );

        const boths = shuffleArray(
            activePlayers.filter(player => player.side === "both")
        );

        while (lefts.length < 4 && boths.length) {
            lefts.push(boths.pop());
        }

        while (rights.length < 4 && boths.length) {
            rights.push(boths.pop());
        }

        if (lefts.length < 4 || rights.length < 4) {
            return alert(
                "Não deu pra formar 4 duplas. Precisa de 4 jogadores para cada lado, usando coringas se necessário."
            );
        }

        const finalLefts = shuffleArray(lefts).slice(0, 4);
        const finalRights = shuffleArray(rights).slice(0, 4);

        const bestFormation = findBestPairFormation(
            finalLefts,
            finalRights
        );

        if (!bestFormation?.length) {
            return alert("Não foi possível sortear as duplas.");
        }

        bestFormation.forEach((pair, index) => {
            const position = index + 1;

            const sel1 = $(`p${position}_1`);
            const sel2 = $(`p${position}_2`);

            if (sel1) {
                sel1.value = pair.left.id;
            }

            if (sel2) {
                sel2.value = pair.right.id;
            }
        });

        renderCycleGame1Selects();
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

            const firstPairIndex =
                $("cycleGame1PairA")?.value ?? "";

            const secondPairIndex =
                $("cycleGame1PairB")?.value ?? "";

            if (
                firstPairIndex === "" ||
                secondPairIndex === ""
            ) {
                return alert(
                    "Escolha as duas duplas que irão começar o Jogo 1."
                );
            }

            if (firstPairIndex === secondPairIndex) {
                return alert(
                    "Escolha duas duplas diferentes para o Jogo 1."
                );
            }

            const firstIndex = Number(firstPairIndex);
            const secondIndex = Number(secondPairIndex);

            const firstPair = pairs[firstIndex];
            const secondPair = pairs[secondIndex];

            if (!firstPair || !secondPair) {
                return alert(
                    "Não foi possível identificar as duplas escolhidas."
                );
            }

            const remainingPairs = pairs.filter(
                (_, index) =>
                    index !== firstIndex &&
                    index !== secondIndex
            );

            pairs = [
                firstPair,
                secondPair,
                ...remainingPairs
            ];

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
                        pairs: [],
                        group_id: getCurrentGroupId()
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
                    pairs,
                    group_id: getCurrentGroupId()
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
                        status: "encerrada",
                        group_id: getCurrentGroupId()
                    })
                });

                await hydrateStateFromDb();
                renderCycleTab();

                alert("Ciclo finalizado ✅");

                await prepareCycleSummaryImage(cycle);
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
                    body: JSON.stringify({
                        id: cycle.id,
                        group_id: getCurrentGroupId()
                    })
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
                        pairs,
                        group_id: getCurrentGroupId()
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
        $("btnDrawPairs").addEventListener("click", async () => {
            Loading.show("Buscando as melhores duplas...");

            try {
                // Permite que o navegador exiba a Mikasa antes do cálculo
                await new Promise(resolve => {
                    requestAnimationFrame(() => {
                        requestAnimationFrame(resolve);
                    });
                });

                drawPairsBySide();
            } catch (err) {
                console.error("Erro ao sortear duplas:", err);

                alert(
                    err?.message ||
                    "Não foi possível sortear as duplas."
                );
            } finally {
                Loading.forceHide();
            }
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
                        pending_pair_b_id: null,
                        group_id: getCurrentGroupId()
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

            Loading.show("Refazendo último jogo...");

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

                Loading.forceHide();

                alert(
                    "Último jogo removido ✅\n\n" +
                    "As mesmas duplas foram carregadas para registrar novamente."
                );
            } catch (err) {
                console.error("Erro ao refazer último jogo:", err);

                Loading.forceHide();

                alert(
                    err?.message ||
                    "Não foi possível refazer o último jogo."
                );
            } finally {
                Loading.forceHide();

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
                    status: "encerrada",
                    group_id: getCurrentGroupId()
                })
            });

            state.viewSessionId = sess.id;
            state.currentSessionId = null;
            state.updatedAt = new Date().toISOString();
            saveState();

            updateAllSessionUI();
            showTab("sessoes");

            alert(`Sessão "${sess.name}" encerrada ✅`);

            await prepareSessionSummaryImage(sess);
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
                body: JSON.stringify({
                    id,
                    group_id: getCurrentGroupId()
                })
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
        const button = ev.target.closest?.(".btnViewCycle");

        if (!button) return;

        state.viewCycleId = button.dataset.id;

        saveState();
        renderCycleTab();

        window.scrollTo({
            top: 0,
            behavior: "smooth"
        });
    });

    document.addEventListener("click", (ev) => {
        const button = ev.target.closest?.("#btnBackCycles");

        if (!button) return;

        state.viewCycleId = null;

        saveState();
        renderCycleTab();

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
            const res = await apiJson(
                `/api/resenha-message?kind=${tipo}&group_id=${encodeURIComponent(getCurrentGroupId())}`
            );
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
                    body: JSON.stringify({
                        keepPlayers: false,
                        group_id: getCurrentGroupId()
                    })
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
                    body: JSON.stringify({
                        keepPlayers: true,
                        group_id: getCurrentGroupId()
                    })
                });

                applyKeepPlayersLocalReset();
                alert("Jogos e sessões apagados; jogadores mantidos ✅");
            } catch (err) {
                console.error("Erro resetando banco mantendo players:", err);
                alert("Falhou ao zerar no banco.");
            }
        });
    }

    function renderDataInfo() {
        if (!$("dbInfo")) return;

        $("dbInfo").textContent =
            `versão: ${state.version} \n` +
            `criado:  ${state.createdAt} \n` +
            `update:  ${state.updatedAt} \n` +
            `jogadores: ${(state.players || []).length} \n` +
            `sessões:   ${(state.sessions || []).length} \n` +
            `jogos:     ${(state.matches || []).length} \n`;
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
                    pending_pair_b_id: removedMatch.pairBId,
                    group_id: getCurrentGroupId()
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

    function getViewedCycle() {
        if (!state.viewCycleId) {
            return null;
        }

        return (state.cycles || []).find(
            cycle => String(cycle.id) === String(state.viewCycleId)
        ) || null;
    }

    function renderCycleGame1Selects() {
        const boxA = $("cycleStartGameBox");
        const boxB = $("cycleStartGameBoxB");
        const selA = $("cycleGame1PairA");
        const selB = $("cycleGame1PairB");

        if (!boxA || !boxB || !selA || !selB) return;

        if (getCurrentSession()) {
            boxA.style.display = "none";
            boxB.style.display = "none";
            return;
        }

        let pairs;

        try {
            pairs = readPairsFromEditor();
        } catch (_) {
            boxA.style.display = "none";
            boxB.style.display = "none";
            return;
        }

        if (pairs.length !== 4) {
            boxA.style.display = "none";
            boxB.style.display = "none";
            return;
        }

        boxA.style.display = "block";
        boxB.style.display = "block";

        const getPairLabel = (pair) => {
            const p1 = (state.players || []).find(
                p => String(p.id) === String(pair.p1)
            )?.name || "?";

            const p2 = (state.players || []).find(
                p => String(p.id) === String(pair.p2)
            )?.name || "?";

            return `${p1} + ${p2}`;
        };

        const fill = (select) => {
            const previousValue = select.value;

            select.innerHTML = `
            <option value="">
                — selecione —
            </option>
        `;

            pairs.forEach((pair, index) => {
                const option = document.createElement("option");

                // usamos a posição, porque readPairsFromEditor gera novos IDs
                option.value = String(index);
                option.textContent =
                    `Dupla ${index + 1} — ${getPairLabel(pair)}`;

                select.appendChild(option);
            });

            if (
                previousValue &&
                Number(previousValue) < pairs.length
            ) {
                select.value = previousValue;
            }
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
                        ➜ Abrir
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

        <div class="session-details-share-actions">
            <button
                class="btnShareSessionSummary"
                data-id="${viewed.id}"
                type="button"
            >
                📲 Compartilhar resumo
            </button>
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

    document.addEventListener("click", async (ev) => {
        const button = ev.target.closest?.(".btnShareSessionSummary");
        if (!button) return;

        const session = getSessionById(button.dataset.id);

        if (!session) {
            return alert("Não foi possível localizar a sessão.");
        }

        await prepareSessionSummaryImage(session);
    });

    document.addEventListener("click", async (ev) => {
        const button = ev.target.closest?.(".btnShareCycleSummary");
        if (!button) return;

        const cycle = (state.cycles || []).find(
            item => String(item.id) === String(button.dataset.id)
        );

        if (!cycle) {
            return alert("Não foi possível localizar o ciclo.");
        }

        await prepareCycleSummaryImage(cycle);
    });

    document.addEventListener("click", async (ev) => {
        if (ev.target.closest?.("#btnSendSummaryImage")) {
            await sendPendingSummaryImage();
            return;
        }

        if (ev.target.closest?.("#btnDownloadSummaryImage")) {
            downloadPendingSummaryImage();
            return;
        }

        if (ev.target.closest?.("#btnCloseSummaryShare")) {
            closeSummarySharePreview();
            return;
        }

        if (ev.target.id === "summaryShareModal") {
            closeSummarySharePreview();
        }
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
                body: JSON.stringify({
                    id,
                    group_id: getCurrentGroupId()
                })
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
