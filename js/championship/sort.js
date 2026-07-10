(function () {
    const {
        PLAYER_CATEGORIES,
        escapeHtml,
        getSideLabel,
        getCurrentUser,
        apiJson
    } = window.ChampionshipUtils;

    let currentDraw = null;
    let currentPlayers = [];
    let currentPairs = [];

    function shuffle(items) {
        const result = [...items];

        for (let i = result.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));

            [result[i], result[j]] = [
                result[j],
                result[i]
            ];
        }

        return result;
    }

    function getPlayerPoints(player) {
        const databasePoints = Number(player.points);

        if (Number.isFinite(databasePoints)) {
            return databasePoints;
        }

        return Number(
            PLAYER_CATEGORIES[player.category]?.points || 0
        );
    }

    function prepareSidePools(players) {
        const total = players.length;
        const playersPerSide = total / 2;

        const left = players.filter(
            player => player.preferred_side === "left"
        );

        const right = players.filter(
            player => player.preferred_side === "right"
        );

        const any = shuffle(
            players.filter(
                player =>
                    !["left", "right"].includes(
                        player.preferred_side
                    )
            )
        );

        const leftMissing = playersPerSide - left.length;
        const rightMissing = playersPerSide - right.length;

        if (
            leftMissing < 0 ||
            rightMissing < 0 ||
            leftMissing + rightMissing !== any.length
        ) {
            throw new Error(
                "Não foi possível distribuir os jogadores entre esquerda e direita."
            );
        }

        const anyForLeft = any.slice(0, leftMissing);
        const anyForRight = any.slice(leftMissing);

        return {
            left: shuffle([
                ...left,
                ...anyForLeft
            ]),
            right: shuffle([
                ...right,
                ...anyForRight
            ])
        };
    }

    function buildPairs(leftPlayers, rightPlayers) {
        return leftPlayers.map((leftPlayer, index) => {
            const rightPlayer = rightPlayers[index];

            return {
                number: index + 1,
                left: leftPlayer,
                right: rightPlayer,
                totalPoints:
                    getPlayerPoints(leftPlayer) +
                    getPlayerPoints(rightPlayer)
            };
        });
    }

    function calculatePairingScore(pairs) {
        const totals = pairs.map(
            pair => pair.totalPoints
        );

        if (!totals.length) {
            return Number.MAX_SAFE_INTEGER;
        }

        const minimum = Math.min(...totals);
        const maximum = Math.max(...totals);
        const spread = maximum - minimum;

        const average =
            totals.reduce(
                (sum, value) => sum + value,
                0
            ) / totals.length;

        const variance =
            totals.reduce(
                (sum, value) =>
                    sum + Math.pow(value - average, 2),
                0
            ) / totals.length;

        /*
         * A diferença entre a dupla mais forte e a mais
         * fraca tem prioridade. A variância desempata.
         */
        return (spread * 1000) + variance;
    }

    function drawSimple(players) {
        const pools = prepareSidePools(players);

        return buildPairs(
            shuffle(pools.left),
            shuffle(pools.right)
        );
    }

    function drawCustom(players) {
        let bestPairs = null;
        let bestScore = Number.MAX_SAFE_INTEGER;

        /*
         * Testamos várias combinações válidas.
         * Todas respeitam esquerda + direita.
         * Escolhemos a que aproxima melhor a pontuação.
         */
        const attempts = Math.min(
            5000,
            Math.max(1000, players.length * 250)
        );

        for (let attempt = 0; attempt < attempts; attempt++) {
            const pools = prepareSidePools(players);

            const candidate = buildPairs(
                shuffle(pools.left),
                shuffle(pools.right)
            );

            const score =
                calculatePairingScore(candidate);

            if (score < bestScore) {
                bestScore = score;
                bestPairs = candidate;
            }

            if (bestScore === 0) {
                break;
            }
        }

        return bestPairs || [];
    }

    function normalizeSavedPairs(savedPairs) {
        if (!Array.isArray(savedPairs)) {
            return [];
        }

        return savedPairs.map((pair, index) => ({
            id: pair.id,
            number: pair.pair_number || index + 1,

            left: {
                id: pair.player_1_id,
                name: pair.player_1_name,
                preferred_side:
                    pair.player_1_side || "left",
                category:
                    pair.player_1_category || null,
                points:
                    pair.player_1_points
            },

            right: {
                id: pair.player_2_id,
                name: pair.player_2_name,
                preferred_side:
                    pair.player_2_side || "right",
                category:
                    pair.player_2_category || null,
                points:
                    pair.player_2_points
            },

            totalPoints:
                Number(pair.total_points || 0)
        }));
    }

    function renderSortActions(confirmed = false) {
        if (!currentPairs.length) {
            return "";
        }

        if (confirmed) {
            return `
            <div
                class="row"
                style="
                    margin-top:16px;
                    gap:10px;
                "
            >
                <span class="pill">
                    ✅ Sorteio confirmado
                </span>

                <button
                    id="btnCopyChampionshipPairs"
                    class="secondary"
                    type="button"
                >
                    📋 Copiar duplas
                </button>
            </div>
        `;
        }

        return `
        <div
            class="row"
            style="
                margin-top:16px;
                gap:10px;
            "
        >
            <button
                id="btnConfirmChampionshipPairs"
                type="button"
            >
                💾 Confirmar sorteio
            </button>

            <button
                id="btnCopyChampionshipPairs"
                class="secondary"
                type="button"
            >
                📋 Copiar duplas
            </button>
        </div>
    `;
    }

    function updateSortActions(confirmed = false) {
        const actions =
            document.getElementById(
                "championshipSortActions"
            );

        if (!actions) {
            return;
        }

        actions.innerHTML =
            renderSortActions(confirmed);
    }

    async function saveCurrentPairs() {
        const user = getCurrentUser();

        if (!user?.id) {
            throw new Error("Usuário não identificado.");
        }

        if (!currentDraw?.id || !currentPairs.length) {
            throw new Error(
                "Nenhum sorteio disponível para confirmar."
            );
        }

        await apiJson(
            "/api/championship-draws?action=pairs",
            {
                method: "POST",
                body: JSON.stringify({
                    action: "pairs",
                    draw_id: currentDraw.id,
                    created_by: user.id,
                    pairs: currentPairs.map(
                        (pair, index) => ({
                            pair_number: index + 1,
                            player_1_id: pair.left.id,
                            player_2_id: pair.right.id,
                            total_points:
                                pair.totalPoints
                        })
                    )
                })
            }
        );

        currentDraw.status = "drawn";
    }

    async function deleteSavedPairs() {
        const user = getCurrentUser();

        if (!user?.id) {
            throw new Error("Usuário não identificado.");
        }

        await apiJson(
            "/api/championship-draws?action=pairs",
            {
                method: "DELETE",
                body: JSON.stringify({
                    action: "pairs",
                    draw_id: currentDraw.id,
                    created_by: user.id
                })
            }
        );

        currentDraw.status = "draft";
        currentPairs = [];
    }

    function buildPairsClipboardText() {
        const championshipName =
            currentDraw?.name || "Campeonato";

        const lines = [
            `🏆 ${championshipName}`,
            "",
            "DUPLAS SORTEADAS",
            ""
        ];

        currentPairs.forEach((pair, index) => {
            lines.push(`Dupla ${index + 1}`);
            lines.push(
                `${pair.left.name} / ${pair.right.name}`
            );

            lines.push("");
        });

        return lines.join("\n").trim();
    }

    async function copyCurrentPairs() {
        if (!currentPairs.length) {
            throw new Error(
                "Nenhuma dupla disponível para copiar."
            );
        }

        const text = buildPairsClipboardText();

        if (
            navigator.clipboard &&
            window.isSecureContext
        ) {
            await navigator.clipboard.writeText(text);
            return;
        }

        const textarea =
            document.createElement("textarea");

        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";

        document.body.appendChild(textarea);

        textarea.focus();
        textarea.select();

        const copied =
            document.execCommand("copy");

        textarea.remove();

        if (!copied) {
            throw new Error(
                "Não foi possível copiar as duplas."
            );
        }
    }

    function renderPairs(pairs, drawType) {
        if (!pairs.length) {
            return `
                <div class="muted">
                    Nenhum sorteio realizado.
                </div>
            `;
        }

        const totals = pairs.map(
            pair => pair.totalPoints
        );

        const minimum = Math.min(...totals);
        const maximum = Math.max(...totals);
        const spread = maximum - minimum;

        const levelingSummary =
            drawType === "custom"
                ? `
                    <div
                        class="muted"
                        style="margin-bottom:12px;"
                    >
                        Diferença entre a maior e a menor
                        pontuação: <b>${spread}</b>
                    </div>
                `
                : "";

        return `
            ${levelingSummary}

            <div
                style="
                    display:grid;
                    grid-template-columns:
                        repeat(auto-fit, minmax(220px, 1fr));
                    gap:12px;
                "
            >
                ${pairs.map(pair => `
                    <div class="card" style="margin:0;">
                        <div
                            style="
                                font-size:16px;
                                font-weight:700;
                                margin-bottom:10px;
                            "
                        >
                            Dupla ${pair.number}
                        </div>

                        <div>
                            <b>
                                ${escapeHtml(pair.left.name)}
                            </b>

                            <div class="muted">
                                ${getSideLabel(
            pair.left.preferred_side
        )}
                                → Esquerda
                            </div>
                        </div>

                        <div
                            style="
                                margin:10px 0;
                                opacity:.35;
                                border-top:1px solid currentColor;
                            "
                        ></div>

                        <div>
                            <b>
                                ${escapeHtml(pair.right.name)}
                            </b>

                            <div class="muted">
                                ${getSideLabel(
            pair.right.preferred_side
        )}
                                → Direita
                            </div>
                        </div>

                        ${drawType === "custom"
                ? `
                                <div
                                    class="pill"
                                    style="
                                        display:inline-block;
                                        margin-top:12px;
                                    "
                                >
                                    ${pair.totalPoints} pontos
                                </div>
                            `
                : ""
            }
                    </div>
                `).join("")}
            </div>
        `;
    }

    function renderDrawSection(
        draw,
        players,
        savedPairs = []
    ) {
        currentDraw = draw;

        currentPlayers =
            Array.isArray(players) ? players : [];

        currentPairs =
            normalizeSavedPairs(savedPairs);

        const analysis =
            window.ChampionshipAnalysis
                .analyzeChampionship(
                    currentPlayers,
                    draw.draw_type
                );

        const hasConfirmedPairs =
            currentPairs.length > 0;

        return `
        <div
            class="card"
            style="margin:12px 0 0 0;"
        >
            <div>
                <b>Sorteio das duplas</b>

                <div
                    class="muted"
                    style="margin-top:5px;"
                >
                    ${draw.draw_type === "custom"
                ? "O sistema respeita os lados e busca equilibrar a pontuação."
                : "O sistema forma duplas respeitando esquerda e direita."
            }
                </div>
            </div>

            ${!analysis.canDraw &&
                !hasConfirmedPairs
                ? `
                        <div
                            class="muted"
                            style="margin-top:12px;"
                        >
                            Corrija os bloqueios do diagnóstico
                            para liberar o sorteio.
                        </div>
                    `
                : ""
            }

            <div
                id="championshipSortResult"
                style="margin-top:16px;"
            >
                ${hasConfirmedPairs
                ? renderPairs(
                    currentPairs,
                    draw.draw_type
                )
                : `
                            <div class="muted">
                                Nenhum sorteio realizado.
                            </div>
                        `
            }
            </div>

            <div id="championshipSortActions">
                ${hasConfirmedPairs
                ? renderSortActions(true)
                : ""
            }
            </div>
        </div>
    `;
    }

    function performDraw() {
        if (!currentDraw || !currentPlayers.length) {
            throw new Error(
                "Campeonato ou jogadores não identificados."
            );
        }

        const analysis =
            window.ChampionshipAnalysis
                .analyzeChampionship(
                    currentPlayers,
                    currentDraw.draw_type
                );

        if (!analysis.canDraw) {
            throw new Error(
                "O campeonato ainda não está apto para o sorteio."
            );
        }

        currentPairs =
            currentDraw.draw_type === "custom"
                ? drawCustom(currentPlayers)
                : drawSimple(currentPlayers);

        const result =
            document.getElementById(
                "championshipSortResult"
            );

        if (result) {
            result.innerHTML = renderPairs(
                currentPairs,
                currentDraw.draw_type
            );
        }

        const button =
            document.getElementById(
                "btnChampionshipSort"
            );

        if (button) {
            button.textContent = "🔄 Refazer sorteio";
        }

        updateSortActions(false);
    }

    async function handleSortClick(event) {
        const confirmButton = event.target.closest(
            "#btnConfirmChampionshipPairs"
        );

        if (confirmButton) {
            confirmButton.disabled = true;
            confirmButton.textContent = "Salvando...";

            try {
                await saveCurrentPairs();

                updateSortActions(true);

                alert(
                    "Sorteio confirmado e salvo ✅"
                );
            } catch (err) {
                alert(
                    err.message ||
                    "Não foi possível salvar o sorteio."
                );

                confirmButton.disabled = false;
                confirmButton.textContent =
                    "💾 Confirmar sorteio";
            }

            return true;
        }

        const copyButton = event.target.closest(
            "#btnCopyChampionshipPairs"
        );

        if (copyButton) {
            try {
                await copyCurrentPairs();

                const oldText =
                    copyButton.textContent;

                copyButton.textContent =
                    "✅ Duplas copiadas";

                setTimeout(() => {
                    copyButton.textContent = oldText;
                }, 1800);
            } catch (err) {
                alert(
                    err.message ||
                    "Não foi possível copiar as duplas."
                );
            }

            return true;
        }

        const button = event.target.closest(
            "#btnChampionshipSort"
        );

        if (!button) {
            return false;
        }

        const canDraw =
            button.dataset.canDraw === "true";

        if (!canDraw) {
            alert(
                "O sorteio ainda não pode ser realizado.\n\n" +
                "Corrija a quantidade de jogadores e os bloqueios indicados no diagnóstico."
            );

            return true;
        }

        if (
            currentDraw?.status === "drawn" &&
            currentPairs.length
        ) {
            const confirmed = confirm(
                "Já existe um sorteio confirmado.\n\n" +
                "Deseja apagar o sorteio salvo e gerar outro?"
            );

            if (!confirmed) {
                return true;
            }

            button.disabled = true;
            button.textContent =
                "Apagando sorteio anterior...";

            try {
                await deleteSavedPairs();
            } catch (err) {
                alert(
                    err.message ||
                    "Não foi possível apagar o sorteio anterior."
                );

                button.disabled = false;
                button.textContent =
                    "🔄 Refazer sorteio";

                return true;
            }
        }

        button.disabled = true;
        button.textContent = "Sorteando...";

        try {
            performDraw();
        } catch (err) {
            alert(
                err.message ||
                "Não foi possível realizar o sorteio."
            );

            button.textContent =
                "🎲 Sortear duplas";
        } finally {
            button.disabled = false;
        }

        return true;
    }

    window.ChampionshipSort = {
        renderDrawSection,
        handleSortClick
    };
})();