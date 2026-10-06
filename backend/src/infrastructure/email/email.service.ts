import { appendFile, mkdir } from "node:fs/promises";
import dns from "node:dns/promises";
import path from "node:path";
import nodemailer from "nodemailer";

export type SendEmailInput = {
  to: string[];
  subject: string;
  text: string;
};

const DEFAULT_FROM = "Escala APAO <noreply@pcoordenador.com.br>";
const DEFAULT_HELO = "pcoordenador.com.br";

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

function resolveFromAddress(): string {
  const configured = (process.env.SMTP_FROM || "").trim();
  if (!configured) return DEFAULT_FROM;
  const lower = configured.toLowerCase();
  // Nunca enviar como outro domínio/projeto.
  if (lower.includes("@pcoordenador.com.br")) return configured;
  console.warn(
    `[email] SMTP_FROM="${configured}" ignorado — remetente forçado para ${DEFAULT_FROM}`,
  );
  return DEFAULT_FROM;
}

function smtpAuthConfigured(): boolean {
  const host = process.env.SMTP_HOST?.trim();
  const user = (process.env.SMTP_USER || "").trim().toLowerCase();
  const pass = (process.env.SMTP_PASS || process.env.SMTP_PASSWORD || "").trim();
  // Só usa SMTP autenticado se a conta for do domínio do projeto.
  return Boolean(host && pass && user.endsWith("@pcoordenador.com.br"));
}

async function sendViaAuthenticatedSmtp(input: {
  from: string;
  to: string[];
  subject: string;
  text: string;
}): Promise<void> {
  const port = Number(process.env.SMTP_PORT || "465");
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE === "true" || port === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS || process.env.SMTP_PASSWORD,
    },
    name: DEFAULT_HELO,
  });
  await transporter.sendMail({
    from: input.from,
    to: input.to.join(", "),
    subject: input.subject,
    text: input.text,
  });
}

async function sendViaDirectMx(input: {
  from: string;
  to: string;
  subject: string;
  text: string;
}): Promise<void> {
  const domain = input.to.split("@")[1];
  if (!domain) throw new Error(`Destinatário inválido: ${input.to}`);
  const mxRecords = await dns.resolveMx(domain);
  mxRecords.sort((a, b) => a.priority - b.priority);
  const errors: string[] = [];

  for (const mx of mxRecords.slice(0, 3)) {
    try {
      const transporter = nodemailer.createTransport({
        host: mx.exchange,
        port: 25,
        secure: false,
        tls: { rejectUnauthorized: false },
        name: DEFAULT_HELO,
        connectionTimeout: 15000,
        greetingTimeout: 15000,
        socketTimeout: 20000,
      });
      await transporter.sendMail({
        from: input.from,
        to: input.to,
        subject: input.subject,
        text: input.text,
      });
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${mx.exchange}: ${msg}`);
    }
  }

  throw new Error(`Falha MX para ${input.to}: ${errors.join(" | ")}`);
}

/**
 * Envio de e-mail do projeto PCoordenador.
 * - Remetente sempre @pcoordenador.com.br
 * - Preferência: SMTP autenticado da própria conta @pcoordenador.com.br
 * - Fallback: entrega direta no MX do destinatário
 */
export class EmailService {
  async send(input: SendEmailInput): Promise<{ sent: boolean; to: string[] }> {
    const to = uniqueEmails(input.to);
    if (to.length === 0) {
      console.warn("[email] nenhum destinatário válido para:", input.subject);
      return { sent: false, to: [] };
    }

    const from = resolveFromAddress();
    const stamp = new Date().toISOString();
    const logLine = `${stamp}\t${input.subject}\t${to.join(",")}\t${from}\t${input.text.replace(/\s+/g, " ")}\n`;
    await appendLocalLog(logLine);

    try {
      if (smtpAuthConfigured()) {
        await sendViaAuthenticatedSmtp({
          from,
          to,
          subject: input.subject,
          text: input.text,
        });
        console.info(`[email] enviado via SMTP auth (${from} → ${to.join(", ")})`);
        return { sent: true, to };
      }

      const delivered: string[] = [];
      const failed: string[] = [];
      for (const recipient of to) {
        try {
          await sendViaDirectMx({
            from,
            to: recipient,
            subject: input.subject,
            text: input.text,
          });
          delivered.push(recipient);
        } catch (err) {
          failed.push(`${recipient}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      if (delivered.length > 0) {
        console.info(
          `[email] enviado via MX direto (${from} → ${delivered.join(", ")})`,
        );
      }
      if (failed.length > 0) {
        console.error("[email] falha parcial/total no MX direto:", failed.join(" ; "));
      }
      return { sent: delivered.length > 0, to: delivered };
    } catch (err) {
      console.error("[email] falha no envio (mantido em log):", err);
      return { sent: false, to: [] };
    }
  }
}

export const emailService = new EmailService();
