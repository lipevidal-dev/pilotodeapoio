import { z } from "zod";

const identifier = z.string().trim().min(1).max(120);

/** Produção envia `login`. Clientes antigos ainda podem enviar `email`. */
export const loginSchema = z
  .object({
    login: identifier.optional(),
    email: identifier.optional(),
    password: z.string().min(1).max(120),
  })
  .superRefine((data, ctx) => {
    if (!data.login && !data.email) {
      ctx.addIssue({ code: "custom", message: "Required", path: ["login"] });
    }
  });
