import { describe, expect, it } from "vitest";
import {
  buildPortalRequestAdminMail,
  collectAdminEmails,
} from "../application/use-cases/portal-request-notify.js";

describe("portal-request-notify", () => {
  it("junta o e-mail de aviso e o e-mail do admin, sem duplicar o demo", () => {
    expect(
      collectAdminEmails([
        { email: "admin@escala.local", notificationEmail: "Thays_pgoncalves@hotmail.com" },
        { email: "segundo.admin@pcoordenador.com.br", notificationEmail: null },
        { email: "segundo.admin@pcoordenador.com.br", notificationEmail: "segundo.admin@pcoordenador.com.br" },
      ]),
    ).toEqual(["Thays_pgoncalves@hotmail.com", "segundo.admin@pcoordenador.com.br"]);
  });

  it("monta o aviso de férias com o período e as observações", () => {
    expect(
      buildPortalRequestAdminMail({
        employeeName: "Felipe Vidal",
        type: "FERIAS",
        date: "2026-11-05",
        endDate: "2026-11-10",
        notes: "Viagem",
      }),
    ).toEqual({
      subject: "Solicitação de Férias no portal",
      text: "Felipe Vidal enviou uma solicitação de Férias.\nPeríodo: 05/11/2026 a 10/11/2026\nObservações: Viagem",
    });
  });

  it("monta o aviso de outro com um dia e sem observação", () => {
    expect(
      buildPortalRequestAdminMail({
        employeeName: "Felipe Vidal",
        type: "OUTRO",
        date: "2026-11-05",
      }).text,
    ).toContain("Data: 05/11/2026");
    expect(
      buildPortalRequestAdminMail({
        employeeName: "Felipe Vidal",
        type: "OUTRO",
        date: "2026-11-05",
      }).text,
    ).toContain("Sem observações.");
  });
});
