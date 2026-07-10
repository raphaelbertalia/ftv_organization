(function () {
    const {
        PLAYER_CATEGORIES,
        $,
        getCurrentUser,
        escapeHtml,
        apiJson,
        getDrawTypeLabel,
        getSideLabel,
        getCategoryLabel
    } = window.ChampionshipUtils;

    let openedDraw = null;
    let editingPlayer = null;
    let playersSort = "created";

    async function loadChampionshipPlayers(drawId) {
        const user = getCurrentUser();

        if (!user?.id) {
            throw new Error("Usuário não identificado.");
        }

        const playerParams = new URLSearchParams({
            action: "players",
            draw_id: drawId,
            created_by: user.id
        });

        const pairParams = new URLSearchParams({
            action: "pairs",
            draw_id: drawId,
            created_by: user.id
        });

        const [playersData, pairsData] = await Promise.all([
            apiJson(
                `/api/championship-draws?${playerParams.toString()}`
            ),
            apiJson(
                `/api/championship-draws?${pairParams.toString()}`
            )
        ]);

        return {
            draw: playersData.draw,
            players: playersData.players || [],
            pairs: pairsData.pairs || []
        };
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

    function sortPlayers(players) {
        const list = [...players];

        if (playersSort === "name") {
            return list.sort((a, b) =>
                (a.name || "").localeCompare(
                    b.name || "",
                    "pt-BR"
                )
            );
        }

        if (playersSort === "side") {
            const sideOrder = {
                left: 1,
                right: 2,
                any: 3
            };

            return list.sort((a, b) => {
                const sideDiff =
                    (sideOrder[a.preferred_side] || 99) -
                    (sideOrder[b.preferred_side] || 99);

                if (sideDiff !== 0) {
                    return sideDiff;
                }

                return (a.name || "").localeCompare(
                    b.name || "",
                    "pt-BR"
                );
            });
        }

        if (playersSort === "category") {
            const categoryOrder = {
                beginner: 1,
                novice: 2,
                advanced_b: 3,
                advanced_a: 4
            };

            return list.sort((a, b) => {
                const categoryDiff =
                    (categoryOrder[a.category] || 99) -
                    (categoryOrder[b.category] || 99);

                if (categoryDiff !== 0) {
                    return categoryDiff;
                }

                return (a.name || "").localeCompare(
                    b.name || "",
                    "pt-BR"
                );
            });
        }

        if (playersSort === "points") {
            return list.sort((a, b) => {
                const pointsDiff =
                    Number(b.points || 0) -
                    Number(a.points || 0);

                if (pointsDiff !== 0) {
                    return pointsDiff;
                }

                return (a.name || "").localeCompare(
                    b.name || "",
                    "pt-BR"
                );
            });
        }

        return list;
    }

    function renderPlayersList(players, draw) {
        const list = Array.isArray(players)
            ? sortPlayers(players)
            : [];

        if (!list.length) {
            return `
                <div class="muted">
                    Nenhum jogador cadastrado.
                </div>
            `;
        }

        return list.map((player, index) => {
            const category =
                PLAYER_CATEGORIES[player.category];

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
                            ${getSideLabel(
                player.preferred_side
            )}
                        </div>

                        ${draw.draw_type === "custom"
                    ? `
                                    <div
                                        class="muted"
                                        style="margin-top:4px;"
                                    >
                                        Categoria:
                                        ${getCategoryLabel(
                        player.category
                    )}
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

    function getPlayersSummary(players, drawType) {
        const list = Array.isArray(players) ? players : [];

        const summary = {
            total: list.length,
            left: 0,
            right: 0,
            any: 0,
            carries: 0,
            doesNotCarry: 0
        };

        list.forEach((player) => {
            const side = player.preferred_side || "any";

            if (side === "left") {
                summary.left += 1;
            } else if (side === "right") {
                summary.right += 1;
            } else {
                summary.any += 1;
            }

            if (drawType === "custom") {
                const role =
                    PLAYER_CATEGORIES[player.category]?.role;

                if (role === "Carrega") {
                    summary.carries += 1;
                }

                if (role === "Não carrega") {
                    summary.doesNotCarry += 1;
                }
            }
        });

        return summary;
    }

    function renderChampionshipDetails(
        draw,
        players,
        savedPairs = []
    ) {
        const wrap = $("championshipDrawsContent");

        if (!wrap) return;

        openedDraw = draw;
        editingPlayer = null;
        const analysis =
            window.ChampionshipAnalysis.analyzeChampionship(
                players,
                draw.draw_type
            );

        const summary = getPlayersSummary(
            players,
            draw.draw_type
        );

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
                            ${getDrawTypeLabel(
            draw.draw_type
        )}
                        </div>

                        <div
                            class="muted"
                            style="margin-top:4px;"
                        >
                            Jogadores cadastrados:
                            ${players.length}
                        </div>
                    </div>

                    <div class="muted" style="margin-top:8px;">
                        Esquerda: ${summary.left}
                        • Direita: ${summary.right}
                        • Qualquer: ${summary.any}
                    </div>

                    ${draw.draw_type === "custom"
                ? `
                            <div class="muted" style="margin-top:4px;">
                                Carrega: ${summary.carries}
                                • Não carrega: ${summary.doesNotCarry}
                            </div>
                        `
                : ""
            }

                    <span class="pill">
                        ${escapeHtml(draw.status)}
                    </span>
                </div>
            </div>

            ${window.ChampionshipAnalysis.renderChampionshipAnalysis(
                analysis,
                draw.draw_type
            )}

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
                            <option value="any">
                                Qualquer
                            </option>
                            <option value="left">
                                Esquerda
                            </option>
                            <option value="right">
                                Direita
                            </option>
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

                <div
                    class="row"
                    style="
                        justify-content:space-between;
                        align-items:end;
                        gap:12px;
                        flex-wrap:wrap;
                    "
                >

                    <b>Jogadores</b>

                    <div>

                        <div class="muted">
                            Ordenar por
                        </div>

                        <select id="championshipPlayersSort">

                            <option value="created">
                                Ordem de cadastro
                            </option>

                            <option value="name">
                                Nome A-Z
                            </option>

                            <option value="side">
                                Lado
                            </option>

                            ${draw.draw_type === "custom"
                ? `
                                    <option value="category">
                                        Categoria
                                    </option>

                                    <option value="points">
                                        Pontuação
                                    </option>
                                `
                : ""
            }

                        </select>

                    </div>

                </div>

                <div
                    id="championshipPlayersList"
                    style="margin-top:12px;"
                >
                    ${renderPlayersList(players, draw)}
                </div>

                </div>

                <div
                    style="
                        display:flex;
                        justify-content:center;
                        margin:18px 0;
                    "
                >
                    <button
                        id="btnChampionshipSort"
                        type="button"
                        data-can-draw="${analysis.canDraw}"
                        aria-disabled="${!analysis.canDraw}"
                        class="${analysis.canDraw ? "" : "championship-sort-disabled"}"
                        style="
                            min-width:240px;
                            font-size:16px;
                            padding:14px 24px;
                        "
                    >
                        🎲 Sortear duplas
                    </button>
                </div>

            ${window.ChampionshipSort.renderDrawSection(
                draw,
                players,
                savedPairs
            )}
`;

        if ($("championshipPlayersSort")) {
            $("championshipPlayersSort").value = playersSort;
        }

        $("championshipPlayerName")?.focus();
    }

    function startPlayerEditing(button) {
        editingPlayer = {
            id: button.dataset.id,
            name: button.dataset.name || "",
            preferredSide:
                button.dataset.side || "any",
            category:
                button.dataset.category || ""
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
            $("btnCancelEditChampionshipPlayer")
                .style.display = "inline-block";
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
            $("btnCancelEditChampionshipPlayer")
                .style.display = "none";
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
            const data =
                await loadChampionshipPlayers(drawId);

            renderChampionshipDetails(
                data.draw,
                data.players || [],
                data.pairs || []
            );
        } catch (err) {
            console.error(
                "Erro abrindo campeonato:",
                err
            );

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

    async function handlePlayerClick(
        event,
        renderChampionshipDrawsTab
    ) {

        const sortClickHandled =
            await window.ChampionshipSort
                .handleSortClick(event);

        if (sortClickHandled) {
            return true;
        }

        const editPlayerButton = event.target.closest(
            ".btnEditChampionshipPlayer"
        );

        if (editPlayerButton) {
            startPlayerEditing(editPlayerButton);
            return true;
        }

        const cancelEditPlayerButton =
            event.target.closest(
                "#btnCancelEditChampionshipPlayer"
            );

        if (cancelEditPlayerButton) {
            cancelPlayerEditing();
            return true;
        }

        const savePlayerButton = event.target.closest(
            "#btnSaveChampionshipPlayer"
        );

        if (savePlayerButton) {
            if (!openedDraw?.id) {
                alert(
                    "Campeonato não identificado."
                );

                return true;
            }

            const name = (
                $("championshipPlayerName")?.value || ""
            ).trim();

            const preferredSide =
                $("championshipPlayerSide")?.value ||
                "any";

            const category =
                $("championshipPlayerCategory")?.value ||
                null;

            if (!name) {
                alert(
                    "Informe o nome do jogador."
                );

                return true;
            }

            if (
                openedDraw.draw_type === "custom" &&
                !category
            ) {
                alert(
                    "Selecione a categoria do jogador."
                );

                return true;
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

                savePlayerButton.textContent =
                    editingPlayer?.id
                        ? "Salvar alterações"
                        : "Adicionar";
            }

            return true;
        }

        const deletePlayerButton = event.target.closest(
            ".btnDeleteChampionshipPlayer"
        );

        if (deletePlayerButton) {
            if (!openedDraw?.id) {
                alert(
                    "Campeonato não identificado."
                );

                return true;
            }

            const playerId =
                deletePlayerButton.dataset.id;

            const playerName =
                deletePlayerButton.dataset.name ||
                "este jogador";

            if (!confirm(`Excluir "${playerName}"?`)) {
                return true;
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

            return true;
        }

        const backButton = event.target.closest(
            "#btnBackToChampionships"
        );

        if (backButton) {
            await renderChampionshipDrawsTab();
            return true;
        }

        return false;
    }

    document.addEventListener("change", async (event) => {

        const sort = event.target.closest(
            "#championshipPlayersSort"
        );

        if (!sort || !openedDraw?.id) {
            return;
        }

        playersSort = sort.value;

        await openChampionship(openedDraw.id);

    });

    window.ChampionshipPlayers = {
        openChampionship,
        handlePlayerClick
    };
})();