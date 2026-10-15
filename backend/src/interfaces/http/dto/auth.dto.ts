import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().trim().min(1),
  password: z.string().min(1),
});
