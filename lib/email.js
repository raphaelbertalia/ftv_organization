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
    buttonUrl = process.env.APP_URL,
    eyebrow = "FTV HUB",
    details = []
}) {
    const appUrl =
        process.env.APP_URL ||
        "https://www.ftvhub.com.br";

    const logoUrl =
        `${appUrl}/img/ftv-hub-email-logo.png`;

    const safeTitle =
        escapeHtml(title);

    const safeMessage =
        escapeHtml(message);

    const safeButtonLabel =
        escapeHtml(buttonLabel);

    const safeButtonUrl =
        escapeHtml(
            buttonUrl || appUrl
        );

    const safeEyebrow =
        escapeHtml(eyebrow);

    const detailsHtml =
        Array.isArray(details) &&
            details.length
            ? `
        <table
          role="presentation"
          width="100%"
          cellspacing="0"
          cellpadding="0"
          border="0"
          style="
            margin-top:24px;
            background:#0b1424;
            border:1px solid #223552;
            border-radius:14px;
          "
        >
          <tr>
            <td style="padding:18px;">
              <div style="
                color:#7f91aa;
                font-size:12px;
                font-weight:700;
                text-transform:uppercase;
                letter-spacing:.08em;
                margin-bottom:10px;
              ">
                Detalhes
              </div>

              ${details.map(item => `
                <div style="
                  margin-top:6px;
                  font-size:14px;
                  line-height:1.6;
                  color:#cbd5e1;
                ">
                  <strong style="color:#ffffff;">
                    ${escapeHtml(item.label)}
                  </strong>
                  ${escapeHtml(item.value)}
                </div>
              `).join("")}

            </td>
          </tr>
        </table>
      `
            : "";

    return `
    <!doctype html>
    <html lang="pt-BR">

      <body style="
        margin:0;
        padding:0;
        background:#070d16;
        font-family:Arial,Helvetica,sans-serif;
        color:#e5e7eb;
      ">

        <table
          role="presentation"
          width="100%"
          cellspacing="0"
          cellpadding="0"
          border="0"
          style="
            width:100%;
            background:#070d16;
            padding:32px 16px;
          "
        >

          <tr>
            <td align="center">

              <table
                role="presentation"
                width="100%"
                cellspacing="0"
                cellpadding="0"
                border="0"
                style="
                  width:100%;
                  max-width:600px;
                "
              >

                <tr>
                  <td
                    align="center"
                    style="padding-bottom:22px;"
                  >
                    <img
                      src="${logoUrl}"
                      alt="FTV Hub"
                      width="190"
                      style="
                        display:block;
                        max-width:190px;
                        width:100%;
                        height:auto;
                        border:0;
                      "
                    />
                  </td>
                </tr>

                <tr>
                  <td style="
                    background:#111827;
                    border:1px solid #26364d;
                    border-radius:20px;
                    padding:32px;
                  ">

                    <div style="
                      color:#22c55e;
                      font-size:12px;
                      font-weight:800;
                      letter-spacing:.10em;
                      text-transform:uppercase;
                      margin-bottom:12px;
                    ">
                      ${safeEyebrow}
                    </div>

                    <div style="
                      margin:0 0 16px;
                      color:#ffffff;
                      font-size:26px;
                      font-weight:800;
                      line-height:1.2;
                    ">
                      ${safeTitle}
                    </div>

                    <div style="
                      color:#cbd5e1;
                      font-size:15px;
                      line-height:1.7;
                    ">
                      ${safeMessage}
                    </div>

                    ${detailsHtml}

                    <div style="
                      margin-top:28px;
                      text-align:center;
                    ">
                      <a
                        href="${safeButtonUrl}"
                        target="_blank"
                        style="
                          display:inline-block;
                          padding:14px 24px;
                          border-radius:12px;
                          background:#22c55e;
                          color:#07110a;
                          text-decoration:none;
                          font-size:15px;
                          font-weight:800;
                        "
                      >
                        ${safeButtonLabel}
                      </a>
                    </div>

                  </td>
                </tr>

                <tr>
                  <td style="
                    padding-top:18px;
                    text-align:center;
                    color:#64748b;
                    font-size:12px;
                    line-height:1.6;
                  ">
                    Esta é uma mensagem automática do FTV Hub.
                    <br>
                    Futevôlei em um só lugar.
                  </td>
                </tr>

              </table>

            </td>
          </tr>

        </table>

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