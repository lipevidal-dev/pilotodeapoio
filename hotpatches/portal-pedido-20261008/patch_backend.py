"""Avisa o admin por e-mail em férias e outro, no dist que estiver no servidor."""
import pathlib
import re
import sys

NOTIFY_CALL_FERIAS = """
await this.notifyAdminsOfPortalRequest({
    employeeId,
    type: "FERIAS",
    date: input.date,
    endDate: input.endDate ?? input.date,
    notes: input.notes,
});
return created;"""

NOTIFY_CALL_OUTRO = """
if (input.type === "OUTRO") {
    await this.notifyAdminsOfPortalRequest({
        employeeId,
        type: "OUTRO",
        date: input.date,
        notes: input.notes,
    });
}
return created;"""

METHOD = """
async notifyAdminsOfPortalRequest(input) {
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

SET_RE = re.compile(
    r"const PAO_PORTAL_REQUEST_TYPES = new Set(?:<[^>\n]*>)?\(\[(.*?)\]\);",
    re.S,
)
IMPORTS = (
    'import { emailService } from "../../infrastructure/email/email.service.js";\n'
    'import { buildPortalRequestAdminMail, collectAdminEmails } from "./portal-request-notify.js";\n'
)


def fail(text: str, message: str) -> None:
    print(message, file=sys.stderr)
    for needle in ("PAO_PORTAL_REQUEST_TYPES", "createPendingVacation", "createPendingPreAllocation", "approveRequest"):
        index = text.find(needle)
        if index < 0:
            print(f"--- sem {needle} ---", file=sys.stderr)
            continue
        start = max(0, index - 80)
        end = min(len(text), index + 280)
        print(f"--- {needle} ---", file=sys.stderr)
        print(text[start:end], file=sys.stderr)
    raise SystemExit(1)


def indent_at(text: str, index: int) -> str:
    line_start = text.rfind("\n", 0, index) + 1
    match = re.match(r"[ \t]*", text[line_start:])
    return match.group(0) if match else ""


def skip_string(text: str, index: int) -> int:
    quote = text[index]
    i = index + 1
    while i < len(text):
        if text[i] == "\\":
            i += 2
            continue
        if text[i] == quote:
            return i + 1
        i += 1
    return i


def match_paren(text: str, open_index: int) -> int:
    depth = 0
    i = open_index
    while i < len(text):
        char = text[i]
        if char in ("'", '"', "`"):
            i = skip_string(text, i)
            continue
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    raise SystemExit("parenteses sem fechar")


def reindent(block: str, indent: str) -> str:
    lines = block.strip("\n").split("\n")
    return "\n".join(indent + line if line else line for line in lines)


def remove_voo_from_pao_set(text: str) -> str:
    matches = list(SET_RE.finditer(text))
    if len(matches) != 1:
        fail(text, f"conjunto PAO: achei {len(matches)}")
    match = matches[0]
    body = match.group(1)
    if not re.search(r"""["']VOO["']""", body):
        return text
    body = re.sub(r"""["']VOO["']""", "", body, count=1)
    body = re.sub(r",\s*,", ",", body)
    body = re.sub(r"^\s*,", "", body)
    body = re.sub(r",(\s*)$", r"\1", body)
    updated = text[: match.start(1)] + body + text[match.end(1) :]
    check = SET_RE.search(updated)
    if check is None or re.search(r"""["']VOO["']""", check.group(1)):
        fail(text, "nao consegui tirar VOO do conjunto PAO")
    return updated


def replace_return_call(text: str, name: str, trailer: str) -> str:
    needle = f"return this.{name}("
    found = [item.start() for item in re.finditer(re.escape(needle), text)]
    if len(found) != 1:
        fail(text, f"{name}: achei {len(found)} retornos, esperava 1")
    start = found[0]
    open_paren = text.find("(", start)
    close_paren = match_paren(text, open_paren)
    if close_paren + 1 >= len(text) or text[close_paren + 1] != ";":
        fail(text, f"{name}: o retorno nao termina com ponto e virgula")
    end = close_paren + 2
    indent = indent_at(text, start)
    call = text[start:end].replace(f"return this.{name}(", f"const created = await this.{name}(", 1)
    block = call + "\n" + reindent(trailer, indent)
    return text[:start] + block + text[end:]


def ensure_imports(text: str) -> str:
    if "portal-request-notify.js" in text and "email.service.js" in text:
        return text
    marker = "const requestedDayOffRepo = "
    if text.count(marker) != 1:
        fail(text, "nao achei o ponto do import")
    return text.replace(marker, IMPORTS + marker, 1)


def ensure_method(text: str) -> str:
    if "async notifyAdminsOfPortalRequest" in text or "notifyAdminsOfPortalRequest(input)" in text:
        return text
    match = re.search(r"^[ \t]*async approveRequest\b", text, re.M)
    if match is None:
        fail(text, "approveRequest nao encontrado")
    indent = indent_at(text, match.start())
    return text[: match.start()] + reindent(METHOD, indent) + "\n" + text[match.start() :]


def patch(text: str) -> str:
    text = text.replace("\r\n", "\n")
    already = "notifyAdminsOfPortalRequest" in text
    text = remove_voo_from_pao_set(text)
    if not already:
        text = replace_return_call(text, "createPendingVacation", NOTIFY_CALL_FERIAS)
        text = replace_return_call(text, "createPendingPreAllocation", NOTIFY_CALL_OUTRO)
        text = ensure_method(text)
        text = ensure_imports(text)
    if "email.service.js" not in text or "portal-request-notify.js" not in text:
        fail(text, "import do e-mail nao entrou")
    if "notifyAdminsOfPortalRequest" not in text:
        fail(text, "o aviso ao admin nao entrou")
    return text


def main() -> None:
    path = pathlib.Path(sys.argv[1])
    updated = patch(path.read_text(encoding="utf-8"))
    path.write_text(updated, encoding="utf-8")
    print("backend patch ok")


if __name__ == "__main__":
    main()
