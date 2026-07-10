(function () {

    const {
        $,
        getCurrentUser,
        escapeHtml,
        apiJson,
        formatDate,
        getDrawTypeLabel
    } = window.ChampionshipUtils;

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
    });

    window.renderChampionshipDrawsTab =
        renderChampionshipDrawsTab;
})();