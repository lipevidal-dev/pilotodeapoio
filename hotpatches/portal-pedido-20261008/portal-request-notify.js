export function collectAdminEmails(users) {
    const out = [];
    const seen = new Set();
    for (const user of users) {
        for (const raw of [user.notificationEmail, user.email]) {
            const email = (raw ?? "").trim();
            if (!email.includes("@"))
                continue;
            if (email.toLowerCase().endsWith("@escala.local"))
                continue;
            const key = email.toLowerCase();
            if (seen.has(key))
                continue;
            seen.add(key);
            out.push(email);
        }
    }
    return out;
}
function formatBrDate(iso) {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    if (!match)
        return iso;
    return `${match[3]}/${match[2]}/${match[1]}`;
}
export function buildPortalRequestAdminMail(input) {
    const label = input.type === "FERIAS" ? "Férias" : "Outro";
    const start = formatBrDate(input.date);
    const end = formatBrDate(input.endDate ?? input.date);
    const when = input.type === "FERIAS" && start !== end
        ? `Período: ${start} a ${end}`
        : `Data: ${start}`;
    const notes = input.notes?.trim() ? input.notes.trim() : "Sem observações.";
    return {
        subject: `Solicitação de ${label} no portal`,
        text: [
            `${input.employeeName} enviou uma solicitação de ${label}.`,
            when,
            `Observações: ${notes}`,
        ].join("\n"),
    };
}
