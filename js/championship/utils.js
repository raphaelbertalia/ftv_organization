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

    window.ChampionshipUtils = {
        PLAYER_CATEGORIES,
        $,
        getCurrentUser,
        escapeHtml,
        apiJson,
        formatDate,
        getDrawTypeLabel,
        getSideLabel,
        getCategoryLabel
    };
})();