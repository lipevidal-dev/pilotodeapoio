import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

export type SendEmailInput = {
  to: string[];
  subject: string;
  text: string;
};

function uniqueEmails(emails: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of emails) {
    const email = raw.trim();
    if (!email || !email.includes("@")) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(email);
  }
  return out;
}

async function appendLocalLog(entry: string): Promise<void> {
  const dir = process.env.EMAIL_LOG_DIR || path.join(process.cwd(), "logs");
  try {
    await mkdir(dir, { recursive: true });
    await appendFile(path.join(dir, "email-notifications.log"), entry, "utf8");
  } catch (err) {
    console.warn("[email] falha ao gravar log local:", err);
  }
}

/**
 * Envio de e-mail com nodemailer (se SMTP_* estiver configurado).
 * Sem SMTP, grava em logs/email-notifications.log para não perder o evento.
 */
export class EmailService {
  async send(input: SendEmailInput): Promise<{ sent: boolean; to: string[] }> {
    const to = uniqueEmails(input.to);
    if (to.length === 0) {
      console.warn("[email] nenhum destinatário válido para:", input.subject);
      return { sent: false, to: [] };
    }

    const stamp = new Date().toISOString();
    const logLine = `${stamp}\t${input.subject}\t${to.join(",")}\t${input.text.replace(/\s+/g, " ")}\n`;
    await appendLocalLog(logLine);

    const host = process.env.SMTP_HOST?.trim();
    const from = process.env.SMTP_FROM?.trim();
    if (!host || !from) {
      console.warn(
        `[email] SMTP não configurado — notificação apenas em log (${input.subject} → ${to.join(", ")})`,
      );
      return { sent: false, to };
    }

    try {
      const nodemailer = await import("nodemailer");
      const port = Number(process.env.SMTP_PORT || "587");
      const transporter = nodemailer.createTransport({
        host,
        port,
        secure: process.env.SMTP_SECURE === "true" || port === 465,
        auth:
          process.env.SMTP_USER && process.env.SMTP_PASS
            ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
            : undefined,
      });
      await transporter.sendMail({
        from,
        to: to.join(", "),
        subject: input.subject,
        text: input.text,
      });
      return { sent: true, to };
    } catch (err) {
      console.error("[email] falha no envio SMTP (mantido em log):", err);
      return { sent: false, to };
    }
  }
}

export const emailService = new EmailService();
