(function () {
    const PLAYER_CATEGORIES = {
        beginner: {
            label: "Estreante",
            role: "Não carrega",
            points: 1
        },
        novice: {
            label: "Iniciante",
            role: "Não carrega",
            points: 2
        },
        advanced_b: {
            label: "Avançado B",
            role: "Carrega",
            points: 3
        },
        advanced_a: {
            label: "Avançado A",
            role: "Carrega",
            points: 4
        }
    };

    let openedDraw = null;
    let editingPlayer = null;

    function $(id) {
        return document.getElementById(id);
    }

    function getCurrentUser() {
        return window.state?.auth?.user || null;
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    async function apiJson(url, options = {}) {
        const response = await fetch(url, {
            headers: {
                "Content-Type": "application/json",
                ...(options.headers || {})
            },
            ...options
        });

        let data = null;

        try {
            data = await response.json();
        } catch (_) {
            data = null;
        }

        if (!response.ok) {
            throw new Error(data?.error || `HTTP ${response.status}`);
        }

        return data;
    }

    function formatDate(value) {
        if (!value) return "—";

        return new Date(value).toLocaleDateString("pt-BR");
    }

    function getDrawTypeLabel(drawType) {
        return drawType === "custom"
            ? "Personalizado"
            : "Simples";
    }

    function getSideLabel(side) {
        const labels = {
            left: "Esquerda",
            right: "Direita",
            any: "Qualquer"
        };

        return labels[side] || "Qualquer";
    }

    function getCategoryLabel(category) {
        return PLAYER_CATEGORIES[category]?.label || "—";
    }

    async function loadChampionshipDraws() {
        const user = getCurrentUser();

        if (!user?.id) {
            throw new Error("Usuário não identificado.");
        }

        return apiJson(
            `/api/championship-draws?created_by=${encodeURIComponent(user.id)}`
        );
    }

    async function createChampionshipDraw(name, drawType) {
        const user = getCurrentUser();

        if (!user?.id) {
            throw new Error("Usuário não identificado.");
        }

        return apiJson("/api/championship-draws", {
            method: "POST",
            body: JSON.stringify({
                name,
                draw_type: drawType,
                created_by: user.id
            })
        });
    }

    async function deleteChampionshipDraw(id) {
        const user = getCurrentUser();

        if (!user?.id) {
            throw new Error("Usuário não identificado.");
        }

        return apiJson("/api/championship-draws", {
            method: "DELETE",
            body: JSON.stringify({
                id,
                created_by: user.id
            })
        });
    }

    async function loadChampionshipPlayers(drawId) {
        const user = getCurrentUser();

        if (!user?.id) {
            throw new Error("Usuário não identificado.");
        }

        const params = new URLSearchParams({
            action: "players",
            draw_id: drawId,
            created_by: user.id
        });

        return apiJson(
            `/api/championship-draws?${params.toString()}`
        );
    }

    async function createChampionshipPlayer({
        drawId,
        name,
        preferredSide,
        category
    }) {
        const user = getCurrentUser();

        if (!user?.id) {
            throw new Error("Usuário não identificado.");
        }

        return apiJson("/api/championship-draws?action=players", {
            method: "POST",
            body: JSON.stringify({
                action: "players",
                draw_id: drawId,
                created_by: user.id,
                name,
                preferred_side: preferredSide,
                category
            })
        });
    }

    async function updateChampionshipPlayer({
        playerId,
        drawId,
        name,
        preferredSide,
        category
    }) {
        const user = getCurrentUser();

        if (!user?.id) {
            throw new Error("Usuário não identificado.");
        }

        return apiJson("/api/championship-draws?action=players", {
            method: "PATCH",
            body: JSON.stringify({
                action: "players",
                id: playerId,
                draw_id: drawId,
                created_by: user.id,
                name,
                preferred_side: preferredSide,
                category
            })
        });
    }

    async function deleteChampionshipPlayer(playerId, drawId) {
        const user = getCurrentUser();

        if (!user?.id) {
            throw new Error("Usuário não identificado.");
        }

        return apiJson("/api/championship-draws?action=players", {
            method: "DELETE",
            body: JSON.stringify({
                action: "players",
                id: playerId,
                draw_id: drawId,
                created_by: user.id
            })
        });
    }

    function renderCreateForm() {
        const wrap = $("championshipDrawsContent");

        if (!wrap) return;

        wrap.innerHTML = `
            <div class="card" style="margin:0;">
                <b>Novo campeonato</b>

                <div
                    class="row"
                    style="
                        margin-top:12px;
                        align-items:end;
                        gap:12px;
                        flex-wrap:wrap;
                    "
                >
                    <div style="flex:1; min-width:220px;">
                        <div class="muted">Nome do campeonato</div>

                        <input
                            id="championshipName"
                            type="text"
                            placeholder="Ex: Resenha do Chaves"
                            style="width:100%;"
                        />
                    </div>

                    <div style="min-width:180px;">
                        <div class="muted">Tipo de sorteio</div>

                        <select id="championshipDrawType">
                            <option value="simple">Simples</option>
                            <option value="custom">Personalizado</option>
                        </select>
                    </div>

                    <div class="row" style="gap:8px;">
                        <button
                            id="btnSaveChampionship"
                            type="button"
                        >
                            Salvar
                        </button>

                        <button
                            id="btnCancelChampionship"
                            class="secondary"
                            type="button"
                        >
                            Cancelar
                        </button>
                    </div>
                </div>
            </div>
        `;

        $("championshipName")?.focus();
    }

    function renderDrawsList(draws) {
        const wrap = $("championshipDrawsContent");

        if (!wrap) return;

        openedDraw = null;

        const list = Array.isArray(draws) ? draws : [];

        wrap.innerHTML = `
            <div
                style="
                    display:flex;
                    justify-content:flex-end;
                    margin-bottom:12px;
                "
            >
                <button
                    id="btnNewChampionship"
                    type="button"
                >
                    Novo campeonato
                </button>
            </div>

            ${list.length
                ? list.map(draw => `
                        <div
                            class="card"
                            style="margin:0 0 12px 0;"
                        >
                            <div
                                class="row"
                                style="
                                    justify-content:space-between;
                                    align-items:center;
                                    gap:12px;
                                    flex-wrap:wrap;
                                "
                            >
                                <div>
                                    <div
                                        style="
                                            font-size:18px;
                                            font-weight:700;
                                        "
                                    >
                                        ${escapeHtml(draw.name)}
                                    </div>

                                    <div
                                        class="muted"
                                        style="margin-top:6px;"
                                    >
                                        Tipo:
                                        ${getDrawTypeLabel(draw.draw_type)}
                                    </div>

                                    <div
                                        class="muted"
                                        style="margin-top:4px;"
                                    >
                                        Criado em:
                                        ${formatDate(draw.created_at)}
                                    </div>

                                    <div
                                        class="muted"
                                        style="margin-top:4px;"
                                    >
                                        Status:
                                        ${escapeHtml(draw.status)}
                                    </div>
                                </div>

                                <div class="row" style="gap:8px;">
                                    <button
                                        class="secondary btnOpenChampionship"
                                        type="button"
                                        data-id="${draw.id}"
                                    >
                                        Abrir
                                    </button>

                                    <button
                                        class="secondary btnDeleteChampionship"
                                        type="button"
                                        data-id="${draw.id}"
                                        data-name="${escapeHtml(draw.name)}"
                                    >
                                        Excluir
                                    </button>
                                </div>
                            </div>
                        </div>
                    `).join("")
                : `
                        <div class="card" style="margin:0;">
                            <div class="muted">
                                Nenhum campeonato cadastrado.
                            </div>
                        </div>
                    `
            }
        `;
    }

    function renderCategorySelect(drawType) {
        if (drawType !== "custom") {
            return "";
        }

        return `
            <div style="min-width:180px;">
                <div class="muted">Categoria</div>

                <select id="championshipPlayerCategory">
                    <option value="">Selecione</option>
                    <option value="beginner">
                        Estreante — 1 ponto
                    </option>
                    <option value="novice">
                        Iniciante — 2 pontos
                    </option>
                    <option value="advanced_b">
                        Avançado B — 3 pontos
                    </option>
                    <option value="advanced_a">
                        Avançado A — 4 pontos
                    </option>
                </select>
            </div>
        `;
    }

    function renderPlayersList(players, draw) {
        const list = Array.isArray(players) ? players : [];

        if (!list.length) {
            return `
                <div class="muted">
                    Nenhum jogador cadastrado.
                </div>
            `;
        }

        return list.map((player, index) => {
            const category = PLAYER_CATEGORIES[player.category];

            return `
                <div
                    class="player-item"
                    style="
                        justify-content:space-between;
                        gap:12px;
                        margin-top:8px;
                    "
                >
                    <div>
                        <b>
                            ${index + 1}.
                            ${escapeHtml(player.name)}
                        </b>

                        <div
                            class="muted"
                            style="margin-top:5px;"
                        >
                            Lado:
                            ${getSideLabel(player.preferred_side)}
                        </div>

                        ${draw.draw_type === "custom"
                    ? `
                                    <div
                                        class="muted"
                                        style="margin-top:4px;"
                                    >
                                        Categoria:
                                        ${getCategoryLabel(player.category)}
                                    </div>

                                    <div
                                        class="muted"
                                        style="margin-top:4px;"
                                    >
                                        Função:
                                        ${category?.role || "—"}
                                        •
                                        ${player.points ?? "—"} ponto(s)
                                    </div>
                                `
                    : ""
                }
                    </div>

                    <div class="row" style="gap:8px;">
                        <button
                            class="secondary btnEditChampionshipPlayer"
                            type="button"
                            data-id="${player.id}"
                            data-name="${escapeHtml(player.name)}"
                            data-side="${player.preferred_side || "any"}"
                            data-category="${player.category || ""}"
                        >
                            Editar
                        </button>

                        <button
                            class="secondary btnDeleteChampionshipPlayer"
                            type="button"
                            data-id="${player.id}"
                            data-name="${escapeHtml(player.name)}"
                        >
                            Excluir
                        </button>
                    </div>
                </div>
            `;
        }).join("");
    }

    function renderChampionshipDetails(draw, players) {
        const wrap = $("championshipDrawsContent");

        if (!wrap) return;

        openedDraw = draw;
        editingPlayer = null;

        wrap.innerHTML = `
            <div style="margin-bottom:12px;">
                <button
                    id="btnBackToChampionships"
                    class="secondary"
                    type="button"
                >
                    ← Meus campeonatos
                </button>
            </div>

            <div class="card" style="margin:0 0 12px 0;">
                <div
                    class="row"
                    style="
                        justify-content:space-between;
                        align-items:center;
                        gap:12px;
                        flex-wrap:wrap;
                    "
                >
                    <div>
                        <div
                            style="
                                font-size:20px;
                                font-weight:700;
                            "
                        >
                            ${escapeHtml(draw.name)}
                        </div>

                        <div
                            class="muted"
                            style="margin-top:6px;"
                        >
                            Tipo:
                            ${getDrawTypeLabel(draw.draw_type)}
                        </div>

                        <div
                            class="muted"
                            style="margin-top:4px;"
                        >
                            Jogadores cadastrados:
                            ${players.length}
                        </div>
                    </div>

                    <span class="pill">
                        ${escapeHtml(draw.status)}
                    </span>
                </div>
            </div>

            <div class="card" style="margin:0 0 12px 0;">
                <b id="championshipPlayerFormTitle">
                    Adicionar jogador
                </b>

                <div
                    class="row"
                    style="
                        margin-top:12px;
                        align-items:end;
                        gap:12px;
                        flex-wrap:wrap;
                    "
                >
                    <div style="flex:1; min-width:220px;">
                        <div class="muted">Nome</div>

                        <input
                            id="championshipPlayerName"
                            type="text"
                            placeholder="Nome do jogador"
                            style="width:100%;"
                        />
                    </div>

                    <div style="min-width:160px;">
                        <div class="muted">Lado</div>

                        <select id="championshipPlayerSide">
                            <option value="any">Qualquer</option>
                            <option value="left">Esquerda</option>
                            <option value="right">Direita</option>
                        </select>
                    </div>

                    ${renderCategorySelect(draw.draw_type)}

                    <div class="row" style="gap:8px;">
                        <button
                            id="btnSaveChampionshipPlayer"
                            type="button"
                        >
                            Adicionar
                        </button>

                        <button
                            id="btnCancelEditChampionshipPlayer"
                            class="secondary"
                            type="button"
                            style="display:none;"
                        >
                            Cancelar edição
                        </button>
                    </div>
                </div>
            </div>

            <div class="card" style="margin:0;">
                <b>Jogadores</b>

                <div
                    id="championshipPlayersList"
                    style="margin-top:12px;"
                >
                    ${renderPlayersList(players, draw)}
                </div>
            </div>
        `;

        $("championshipPlayerName")?.focus();
    }

    function startPlayerEditing(button) {
        editingPlayer = {
            id: button.dataset.id,
            name: button.dataset.name || "",
            preferredSide: button.dataset.side || "any",
            category: button.dataset.category || ""
        };

        if ($("championshipPlayerFormTitle")) {
            $("championshipPlayerFormTitle").textContent =
                "Editar jogador";
        }

        if ($("championshipPlayerName")) {
            $("championshipPlayerName").value =
                editingPlayer.name;
        }

        if ($("championshipPlayerSide")) {
            $("championshipPlayerSide").value =
                editingPlayer.preferredSide;
        }

        if ($("championshipPlayerCategory")) {
            $("championshipPlayerCategory").value =
                editingPlayer.category;
        }

        if ($("btnSaveChampionshipPlayer")) {
            $("btnSaveChampionshipPlayer").textContent =
                "Salvar alterações";
        }

        if ($("btnCancelEditChampionshipPlayer")) {
            $("btnCancelEditChampionshipPlayer").style.display =
                "inline-block";
        }

        $("championshipPlayerName")?.focus();
    }

    function cancelPlayerEditing() {
        editingPlayer = null;

        if ($("championshipPlayerFormTitle")) {
            $("championshipPlayerFormTitle").textContent =
                "Adicionar jogador";
        }

        if ($("championshipPlayerName")) {
            $("championshipPlayerName").value = "";
        }

        if ($("championshipPlayerSide")) {
            $("championshipPlayerSide").value = "any";
        }

        if ($("championshipPlayerCategory")) {
            $("championshipPlayerCategory").value = "";
        }

        if ($("btnSaveChampionshipPlayer")) {
            $("btnSaveChampionshipPlayer").textContent =
                "Adicionar";
        }

        if ($("btnCancelEditChampionshipPlayer")) {
            $("btnCancelEditChampionshipPlayer").style.display =
                "none";
        }

        $("championshipPlayerName")?.focus();
    }

    async function openChampionship(drawId) {
        const wrap = $("championshipDrawsContent");

        if (!wrap) return;

        wrap.innerHTML = `
            <div class="muted">
                Carregando campeonato...
            </div>
        `;

        try {
            const data = await loadChampionshipPlayers(drawId);

            renderChampionshipDetails(
                data.draw,
                data.players || []
            );
        } catch (err) {
            console.error("Erro abrindo campeonato:", err);

            wrap.innerHTML = `
                <div class="card" style="margin:0;">
                    <div class="muted">
                        ${escapeHtml(
                err.message ||
                "Não foi possível abrir o campeonato."
            )}
                    </div>

                    <button
                        id="btnBackToChampionships"
                        class="secondary"
                        type="button"
                        style="margin-top:12px;"
                    >
                        Voltar
                    </button>
                </div>
            `;
        }
    }

    async function renderChampionshipDrawsTab() {
        const wrap = $("championshipDrawsContent");

        if (!wrap) return;

        wrap.innerHTML = `
            <div class="muted">
                Carregando campeonatos...
            </div>
        `;

        try {
            const draws = await loadChampionshipDraws();

            renderDrawsList(draws);
        } catch (err) {
            console.error("Erro carregando campeonatos:", err);

            wrap.innerHTML = `
                <div class="muted">
                    Não foi possível carregar os campeonatos.
                </div>
            `;
        }
    }

    document.addEventListener("click", async (event) => {
        const playerClickHandled =
            await window.ChampionshipPlayers.handlePlayerClick(
                event,
                renderChampionshipDrawsTab
            );

        if (playerClickHandled) {
            return;
        }

        const newButton = event.target.closest(
            "#btnNewChampionship"
        );

        if (newButton) {
            renderCreateForm();
            return;
        }

        const cancelButton = event.target.closest(
            "#btnCancelChampionship"
        );

        if (cancelButton) {
            await renderChampionshipDrawsTab();
            return;
        }

        const backButton = event.target.closest(
            "#btnBackToChampionships"
        );

        if (backButton) {
            await renderChampionshipDrawsTab();
            return;
        }

        const saveButton = event.target.closest(
            "#btnSaveChampionship"
        );

        if (saveButton) {
            const name = (
                $("championshipName")?.value || ""
            ).trim();

            const drawType =
                $("championshipDrawType")?.value || "simple";

            if (!name) {
                return alert(
                    "Informe o nome do campeonato."
                );
            }

            saveButton.disabled = true;
            saveButton.textContent = "Salvando...";

            try {
                await createChampionshipDraw(
                    name,
                    drawType
                );

                alert("Campeonato criado ✅");

                await renderChampionshipDrawsTab();
            } catch (err) {
                alert(
                    err.message ||
                    "Erro ao criar campeonato."
                );

                saveButton.disabled = false;
                saveButton.textContent = "Salvar";
            }

            return;
        }

        const deleteButton = event.target.closest(
            ".btnDeleteChampionship"
        );

        if (deleteButton) {
            const id = deleteButton.dataset.id;
            const name =
                deleteButton.dataset.name ||
                "este campeonato";

            if (!confirm(`Excluir "${name}"?`)) {
                return;
            }

            deleteButton.disabled = true;

            try {
                await deleteChampionshipDraw(id);

                alert("Campeonato excluído 🗑️");

                await renderChampionshipDrawsTab();
            } catch (err) {
                alert(
                    err.message ||
                    "Erro ao excluir campeonato."
                );

                deleteButton.disabled = false;
            }

            return;
        }

        const openButton = event.target.closest(
            ".btnOpenChampionship"
        );

        if (openButton) {
            await window.ChampionshipPlayers.openChampionship(
                openButton.dataset.id
            );

            return;
        }

        // =======================
        // EDITAR JOGADOR
        // =======================

        const editPlayerButton = event.target.closest(
            ".btnEditChampionshipPlayer"
        );

        if (editPlayerButton) {
            startPlayerEditing(editPlayerButton);
            return;
        }

        const cancelEditPlayerButton = event.target.closest(
            "#btnCancelEditChampionshipPlayer"
        );

        if (cancelEditPlayerButton) {
            cancelPlayerEditing();
            return;
        }

        // =======================
        // SALVAR JOGADOR
        // =======================

        const savePlayerButton = event.target.closest(
            "#btnSaveChampionshipPlayer"
        );

        if (savePlayerButton) {
            if (!openedDraw?.id) {
                return alert(
                    "Campeonato não identificado."
                );
            }

            const name = (
                $("championshipPlayerName")?.value || ""
            ).trim();

            const preferredSide =
                $("championshipPlayerSide")?.value || "any";

            const category =
                $("championshipPlayerCategory")?.value || null;

            if (!name) {
                return alert(
                    "Informe o nome do jogador."
                );
            }

            if (
                openedDraw.draw_type === "custom" &&
                !category
            ) {
                return alert(
                    "Selecione a categoria do jogador."
                );
            }

            savePlayerButton.disabled = true;
            savePlayerButton.textContent =
                editingPlayer?.id
                    ? "Salvando..."
                    : "Adicionando...";

            try {
                if (editingPlayer?.id) {
                    await updateChampionshipPlayer({
                        playerId: editingPlayer.id,
                        drawId: openedDraw.id,
                        name,
                        preferredSide,
                        category
                    });

                    alert("Jogador atualizado ✅");
                } else {
                    await createChampionshipPlayer({
                        drawId: openedDraw.id,
                        name,
                        preferredSide,
                        category
                    });
                }

                await openChampionship(openedDraw.id);
            } catch (err) {
                alert(
                    err.message ||
                    "Erro ao cadastrar jogador."
                );

                savePlayerButton.disabled = false;
                savePlayerButton.textContent = "Adicionar";
            }

            return;
        }

        const deletePlayerButton = event.target.closest(
            ".btnDeleteChampionshipPlayer"
        );

        if (deletePlayerButton) {
            if (!openedDraw?.id) {
                return alert(
                    "Campeonato não identificado."
                );
            }

            const playerId =
                deletePlayerButton.dataset.id;

            const playerName =
                deletePlayerButton.dataset.name ||
                "este jogador";

            if (!confirm(`Excluir "${playerName}"?`)) {
                return;
            }

            deletePlayerButton.disabled = true;

            try {
                await deleteChampionshipPlayer(
                    playerId,
                    openedDraw.id
                );

                await openChampionship(openedDraw.id);
            } catch (err) {
                alert(
                    err.message ||
                    "Erro ao excluir jogador."
                );

                deletePlayerButton.disabled = false;
            }
        }
    });

    window.renderChampionshipDrawsTab =
        renderChampionshipDrawsTab;
})();