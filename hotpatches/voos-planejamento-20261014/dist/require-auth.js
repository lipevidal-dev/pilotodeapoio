import { authUseCase } from "../../../application/use-cases/auth.use-case.js";
import { InvalidAuthTokenError } from "../../../application/errors/auth.errors.js";
export async function requireAuthUser(req) {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) {
        throw new InvalidAuthTokenError();
    }
    return authUseCase.me(token);
}
//# sourceMappingURL=require-auth.js.map