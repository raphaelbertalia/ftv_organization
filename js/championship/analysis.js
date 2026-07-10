(function () {
    const {
        PLAYER_CATEGORIES,
        escapeHtml
    } = window.ChampionshipUtils;

    function countPlayers(players) {
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

            const role =
                PLAYER_CATEGORIES[player.category]?.role;

            if (role === "Carrega") {
                summary.carries += 1;
            } else if (role === "Não carrega") {
                summary.doesNotCarry += 1;
            }
        });

        return summary;
    }

    function estimateLeveling(players) {
        const points = (players || [])
            .map((player) => Number(player.points))
            .filter(Number.isFinite)
            .sort((a, b) => a - b);

        if (points.length < 2 || points.length % 2 !== 0) {
            return {
                level: "neutral",
                spread: null,
                pairTotals: [],
                message: "Ainda não é possível avaliar o nivelamento."
            };
        }

        const pairTotals = [];

        let start = 0;
        let end = points.length - 1;

        /*
         * Estimativa:
         * combina a maior pontuação com a menor,
         * tentando aproximar o total das duplas.
         */
        while (start < end) {
            pairTotals.push(
                points[start] + points[end]
            );

            start += 1;
            end -= 1;
        }

        const minimum = Math.min(...pairTotals);
        const maximum = Math.max(...pairTotals);
        const spread = maximum - minimum;

        if (spread <= 1) {
            return {
                level: "success",
                spread,
                pairTotals,
                message:
                    "O nivelamento estimado está bem equilibrado."
            };
        }

        if (spread === 2) {
            return {
                level: "warning",
                spread,
                pairTotals,
                message:
                    "O nivelamento pode apresentar alguma diferença entre as duplas."
            };
        }

        return {
            level: "danger",
            spread,
            pairTotals,
            message:
                "Atenção: o nivelamento estimado está bastante diferente."
        };
    }

    function analyzeChampionship(players, drawType) {
        const summary = countPlayers(players);

        const errors = [];
        const warnings = [];

        if (summary.total === 0) {
            errors.push("Cadastre os jogadores antes de sortear.");
        }

        if (summary.total % 2 !== 0) {
            errors.push(
                "A quantidade de jogadores precisa ser par."
            );
        }

        const sideDifference = Math.abs(
            summary.left - summary.right
        );

        const sidesCanBeBalanced =
            sideDifference <= summary.any;

        if (!sidesCanBeBalanced) {
            errors.push(
                "Os jogadores de lado qualquer não são suficientes para compensar a diferença entre esquerda e direita."
            );
        }

        let leveling = null;

        if (drawType === "custom") {
            leveling = estimateLeveling(players);

            if (leveling.level === "warning") {
                warnings.push(leveling.message);
            }

            if (leveling.level === "danger") {
                warnings.push(leveling.message);
            }
        }

        return {
            canDraw: errors.length === 0,
            summary,
            errors,
            warnings,
            leveling
        };
    }

    function getLight(level) {
        const lights = {
            success: "🟢",
            warning: "🟡",
            danger: "🔴",
            neutral: "⚪"
        };

        return lights[level] || "⚪";
    }

    function renderChampionshipAnalysis(analysis, drawType) {
        const statusIcon =
            analysis.canDraw ? "🟢" : "🔴";

        const statusMessage =
            analysis.canDraw
                ? "Campeonato pronto para o sorteio."
                : "O sorteio ainda não pode ser realizado.";

        const errorsHtml = analysis.errors
            .map((message) => `
                <div style="margin-top:6px;">
                    🔴 ${escapeHtml(message)}
                </div>
            `)
            .join("");

        const warningsHtml = analysis.warnings
            .map((message) => `
                <div style="margin-top:6px;">
                    🟡 ${escapeHtml(message)}
                </div>
            `)
            .join("");

        const levelingHtml =
            drawType === "custom" && analysis.leveling
                ? `
                    <div style="margin-top:10px;">
                        ${getLight(analysis.leveling.level)}
                        <b>Nivelamento:</b>
                        ${escapeHtml(
                    analysis.leveling.message
                )}

                        ${analysis.leveling.spread !== null
                    ? `
                                    <div
                                        class="muted"
                                        style="margin-top:4px;"
                                    >
                                        Diferença estimada entre a dupla
                                        mais forte e a mais fraca:
                                        ${analysis.leveling.spread}
                                        ponto(s).
                                    </div>
                                `
                    : ""
                }
                    </div>
                `
                : "";

        return `
            <div class="card" style="margin:0 0 12px 0;">
                <b>Diagnóstico do campeonato</b>

                <div style="margin-top:10px;">
                    ${statusIcon}
                    <b>${statusMessage}</b>
                </div>

                ${errorsHtml}
                ${warningsHtml}
                ${levelingHtml}
            </div>
        `;
    }

    window.ChampionshipAnalysis = {
        analyzeChampionship,
        renderChampionshipAnalysis
    };
})();