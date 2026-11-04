import { describe, expect, it } from "vitest";
import { createEmployeeSchema, updateEmployeeSchema } from "../interfaces/http/dto/employee.dto.js";

describe("observação do colaborador", () => {
  it("aceita observation no cadastro e na edição", () => {
    const created = createEmployeeSchema.parse({
      name: "Ana",
      type: "PAO",
      observation: "  Prefere T2  ",
    });
    expect(created.observation).toBe("Prefere T2");

    const updated = updateEmployeeSchema.parse({ observation: "Escala manual às terças" });
    expect(updated.observation).toBe("Escala manual às terças");
  });

  it("permite limpar a observation", () => {
    expect(updateEmployeeSchema.parse({ observation: null }).observation).toBeNull();
    expect(updateEmployeeSchema.parse({ observation: "   " }).observation).toBe("");
  });

  it("rejeita observation acima de 500 caracteres", () => {
    const result = updateEmployeeSchema.safeParse({ observation: "x".repeat(501) });
    expect(result.success).toBe(false);
  });
});
