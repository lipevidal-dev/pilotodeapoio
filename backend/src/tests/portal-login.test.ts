import { describe, expect, it } from "vitest";
import { isPortalLoginTaken, normalizePortalLogin } from "../domain/auth/portal-login.js";
import { updateEmployeeSchema } from "../interfaces/http/dto/employee.dto.js";

const employeeId = "dd520d92-4840-4279-831d-ed33122c52a6";

describe("portal login", () => {
  it("normaliza maiúsculas e espaços", () => {
    expect(normalizePortalLogin("  LfpCoordenador  ")).toBe("lfpcoordenador");
    expect(normalizePortalLogin("   ")).toBeNull();
  });

  it("não trata o próprio colaborador como login em uso", () => {
    expect(
      isPortalLoginTaken(
        { id: "user-1", employeeId, role: "OPERATOR" },
        employeeId,
      ),
    ).toBe(false);
  });

  it("permite reassociar conta de portal ainda sem vínculo", () => {
    expect(
      isPortalLoginTaken(
        { id: "user-1", employeeId: null, role: "OPERATOR" },
        employeeId,
      ),
    ).toBe(false);
  });

  it("bloqueia login de outro funcionário ou de admin", () => {
    expect(
      isPortalLoginTaken(
        { id: "user-2", employeeId: "outro-funcionario", role: "OPERATOR" },
        employeeId,
      ),
    ).toBe(true);
    expect(
      isPortalLoginTaken(
        { id: "admin", employeeId: null, role: "ADMIN" },
        employeeId,
      ),
    ).toBe(true);
  });

  it("aceita senha com mais de 20 caracteres ao atualizar o mesmo login", () => {
    const parsed = updateEmployeeSchema.safeParse({
      portalLogin: "lfpcoordenador",
      portalPassword: "lfpcoordenadort6t7t8",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.portalPassword).toBe("lfpcoordenadort6t7t8");
    }
  });

  it("rejeita senha curta e login duplicado no formato", () => {
    const parsed = updateEmployeeSchema.safeParse({
      portalLogin: "ab",
      portalPassword: "123",
    });
    expect(parsed.success).toBe(false);
  });
});
