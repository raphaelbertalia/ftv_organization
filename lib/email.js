function escapeHtml(value = "") {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}


export function buildNotificationEmail({
    title,
    message,
    buttonLabel = "Abrir FTV Hub",
    buttonUrl = process.env.APP_URL
}) {
    const safeTitle =
        escapeHtml(title);

    const safeMessage =
        escapeHtml(message);

    const safeButtonLabel =
        escapeHtml(buttonLabel);

    const safeButtonUrl =
        escapeHtml(
            buttonUrl ||
            "https://ftvhub.com.br"
        );

    return `
    <!doctype html>
    <html lang="pt-BR">
      <body style="
        margin:0;
        padding:0;
        background:#0b0f17;
        font-family:Arial,Helvetica,sans-serif;
        color:#e5e7eb;
      ">

        <div style="
          max-width:560px;
          margin:0 auto;
          padding:32px 16px;
        ">

          <div style="
            background:#111827;
            border:1px solid #263244;
            border-radius:16px;
            padding:28px;
          ">

            <div style="
              color:#22c55e;
              font-size:14px;
              font-weight:800;
              margin-bottom:12px;
            ">
              FTV HUB
            </div>

            <h1 style="
              margin:0 0 16px;
              font-size:22px;
              color:#ffffff;
            ">
              ${safeTitle}
            </h1>

            <p style="
              margin:0;
              color:#cbd5e1;
              line-height:1.6;
            ">
              ${safeMessage}
            </p>

            <div style="
              margin-top:24px;
              text-align:center;
            ">
              <a
                href="${safeButtonUrl}"
                style="
                  display:inline-block;
                  padding:12px 20px;
                  border-radius:10px;
                  background:#16a34a;
                  color:#ffffff;
                  text-decoration:none;
                  font-weight:700;
                "
              >
                ${safeButtonLabel}
              </a>
            </div>

          </div>

          <div style="
            padding-top:18px;
            text-align:center;
            color:#64748b;
            font-size:12px;
          ">
            Esta é uma mensagem automática do FTV Hub.
          </div>

        </div>

      </body>
    </html>
  `;
}


export async function sendEmail({
    to,
    subject,
    html,
    text
}) {
    const apiKey =
        process.env.RESEND_API_KEY;

    const from =
        process.env.EMAIL_FROM;

    if (!apiKey) {
        throw new Error(
            "RESEND_API_KEY não configurada"
        );
    }

    if (!from) {
        throw new Error(
            "EMAIL_FROM não configurado"
        );
    }

    if (!to) {
        throw new Error(
            "Destinatário não informado"
        );
    }

    const recipients =
        Array.isArray(to)
            ? to.filter(Boolean)
            : [to].filter(Boolean);

    if (!recipients.length) {
        throw new Error(
            "Nenhum destinatário válido"
        );
    }

    const response =
        await fetch(
            "https://api.resend.com/emails",
            {
                method: "POST",

                headers: {
                    Authorization:
                        `Bearer ${apiKey}`,

                    "Content-Type":
                        "application/json"
                },

                body:
                    JSON.stringify({
                        from,
                        to: recipients,
                        subject,
                        html,
                        text
                    })
            }
        );

    const data =
        await response
            .json()
            .catch(() => null);

    if (!response.ok) {
        throw new Error(
            data?.message ||
            `Erro no Resend (${response.status})`
        );
    }

    return data;
}


export async function sendEmailSafe(
    options
) {
    try {
        const result =
            await sendEmail(options);

        console.log(
            "[FTV Hub] E-mail enviado:",
            result?.id || "sem id"
        );

        return {
            ok: true,
            result
        };

    } catch (err) {
        console.error(
            "[FTV Hub] Falha ao enviar e-mail:",
            err?.message || err
        );

        return {
            ok: false,
            error:
                err?.message ||
                "Falha no envio"
        };
    }
}