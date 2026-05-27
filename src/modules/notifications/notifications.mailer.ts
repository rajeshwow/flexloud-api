import nodemailer from "nodemailer";

const smtpHost = process.env.SMTP_HOST;
const smtpPort = Number(process.env.SMTP_PORT || 587);
const smtpSecure = process.env.SMTP_SECURE === "true";
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;
const mailFrom = process.env.MAIL_FROM || smtpUser;

const transporter = nodemailer.createTransport({
  host: smtpHost,
  port: smtpPort,
  secure: smtpSecure,
  auth:
    smtpUser && smtpPass
      ? {
          user: smtpUser,
          pass: smtpPass,
        }
      : undefined,
});

export async function sendNotificationEmail(params: {
  to: string;
  subject: string;
  html: string;
}) {
  if (!smtpHost) {
    throw new Error("SMTP_HOST is missing");
  }

  if (!mailFrom) {
    throw new Error("MAIL_FROM or SMTP_USER is missing");
  }

  if (!params.to) {
    throw new Error("Recipient email is missing");
  }

  await transporter.sendMail({
    from: mailFrom,
    to: params.to,
    subject: params.subject,
    html: params.html,
  });
}
