"""Aplica no dist do backend o aviso por e-mail de férias e outro."""
import pathlib
import sys

METHOD = """    async notifyAdminsOfPortalRequest(input) {
        try {
            const [employee, admins] = await Promise.all([
                prisma.employee.findUnique({
                    where: { id: input.employeeId },
                    select: { name: true },
                }),
                prisma.user.findMany({
                    where: { role: "ADMIN" },
                    select: { email: true, notificationEmail: true },
                }),
            ]);
            const mail = buildPortalRequestAdminMail({
                employeeName: employee?.name?.trim() || "Funcionário",
                type: input.type,
                date: input.date,
                endDate: input.endDate,
                notes: input.notes,
            });
            await emailService.send({
                to: collectAdminEmails(admins),
                subject: mail.subject,
                text: mail.text,
            });
        }
        catch (err) {
            console.error("[email] falha ao avisar admin da solicitação do portal:", err);
        }
    }
"""

OLD_SET = """const PAO_PORTAL_REQUEST_TYPES = new Set([
    "FP",
    "VOO",
    "OUTRO",
    "FERIAS",
]);"""

NEW_SET = """const PAO_PORTAL_REQUEST_TYPES = new Set([
    "FP",
    "OUTRO",
    "FERIAS",
]);"""

OLD_FERIAS = """        if (input.type === "FERIAS") {
            return this.createPendingVacation({
                employeeId,
                startDate: input.date,
                endDate: input.endDate ?? input.date,
                notes: input.notes,
                thirteenthAdvanceRequested: input.thirteenthAdvanceRequested,
                sellTenDaysRequested: input.sellTenDaysRequested,
            });
        }"""

NEW_FERIAS = """        if (input.type === "FERIAS") {
            const created = await this.createPendingVacation({
                employeeId,
                startDate: input.date,
                endDate: input.endDate ?? input.date,
                notes: input.notes,
                thirteenthAdvanceRequested: input.thirteenthAdvanceRequested,
                sellTenDaysRequested: input.sellTenDaysRequested,
            });
            await this.notifyAdminsOfPortalRequest({
                employeeId,
                type: "FERIAS",
                date: input.date,
                endDate: input.endDate ?? input.date,
                notes: input.notes,
            });
            return created;
        }"""

OLD_PRE = """        return this.createPendingPreAllocation({
            year: input.year,
            month: input.month,
            employeeId,
            date: input.date,
            type: input.type,
            notes: input.notes,
        });"""

NEW_PRE = """        const created = await this.createPendingPreAllocation({
            year: input.year,
            month: input.month,
            employeeId,
            date: input.date,
            type: input.type,
            notes: input.notes,
        });
        if (input.type === "OUTRO") {
            await this.notifyAdminsOfPortalRequest({
                employeeId,
                type: "OUTRO",
                date: input.date,
                notes: input.notes,
            });
        }
        return created;"""

IMPORTS = (
    'import { emailService } from "../../infrastructure/email/email.service.js";\n'
    'import { buildPortalRequestAdminMail, collectAdminEmails } from "./portal-request-notify.js";\n'
)


def once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: achei {count} ocorrencias, esperava 1")
    return text.replace(old, new, 1)


def patch(text: str) -> str:
    if "notifyAdminsOfPortalRequest" in text:
        raise SystemExit("o use case ja avisa o admin")
    text = once(text, OLD_SET, NEW_SET, "tipos PAO")
    text = once(text, OLD_FERIAS, NEW_FERIAS, "ferias")
    text = once(text, OLD_PRE, NEW_PRE, "outro")
    anchor = "    async approveRequest(input) {"
    if text.count(anchor) != 1:
        raise SystemExit("approveRequest nao encontrado")
    text = text.replace(anchor, METHOD + anchor, 1)
    if "portal-request-notify.js" not in text:
        marker = "const requestedDayOffRepo = "
        if text.count(marker) != 1:
            raise SystemExit("nao achei o ponto do import")
        text = text.replace(marker, IMPORTS + marker, 1)
    if "email.service.js" not in text:
        raise SystemExit("import do e-mail nao entrou")
    return text


def main() -> None:
    path = pathlib.Path(sys.argv[1])
    updated = patch(path.read_text(encoding="utf-8"))
    path.write_text(updated, encoding="utf-8")
    print("backend patch ok")


if __name__ == "__main__":
    main()
