import { requireAuthUser } from "./require-auth.js";
export class ForbiddenError extends Error {
    code = "FORBIDDEN";
    constructor() {
        super("Acesso negado. Apenas administradores podem executar esta ação.");
        this.name = "ForbiddenError";
    }
}
export async function requireAdminUser(req) {
    const user = await requireAuthUser(req);
    if (user.role !== "ADMIN") {
        throw new ForbiddenError();
    }
    return user;
}
//# sourceMappingURL=require-admin.js.map