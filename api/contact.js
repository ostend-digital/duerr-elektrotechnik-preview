// Kontaktformular duerr-elektrotechnik.de: nimmt die Anfrage entgegen und verschickt sie über ein
// All-Inkl-Postfach (SMTP) an MAIL_TO. Antwortet erst mit ok:true, wenn der Mailserver die Mail
// angenommen hat; sonst ok:false, und das Formular zeigt Telefon und Mail-Link als Ausweg.
// Zugangsdaten nur als Vercel-Umgebungsvariablen: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS,
// MAIL_FROM, MAIL_TO (mehrere Empfänger mit Komma). Nichts davon steht im Repo.
// Ersetzt seit 10/2026 FormSubmit (Aktivierungsmail, Bot-Spam über die offene Mailadresse).
const nodemailer = require("nodemailer");

const ALLOWED_HOSTS = ["duerr-elektrotechnik.de", "www.duerr-elektrotechnik.de", "duerr-elektrotechnik-preview.vercel.app"];
const MIN_FILL_MS = 2000; // schneller ausgefüllt = Bot

const clean = (v, max) => String(v == null ? "" : v).replace(/\r/g, "").trim().slice(0, max);
const oneLine = (v, max) => clean(v, max).replace(/\s+/g, " ");

function originAllowed(req) {
  const src = req.headers.origin || req.headers.referer || "";
  if (!src) return true; // manche Browser senden keinen Origin bei same-origin
  try {
    const host = new URL(src).hostname;
    return ALLOWED_HOSTS.includes(host) || host.endsWith("-pascals-projects-58bc7dee.vercel.app");
  } catch (e) {
    return false;
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method" });
  if (!originAllowed(req)) return res.status(403).json({ ok: false, error: "origin" });

  let b = req.body || {};
  if (typeof b === "string") {
    try { b = JSON.parse(b); } catch (e) { b = {}; }
  }

  // Spam: verstecktes Feld ausgefüllt oder zu schnell abgeschickt. Bots bekommen «ok», damit sie nicht nachbessern.
  const elapsed = Date.now() - Number(b.t0 || 0);
  if (clean(b._honey, 200) || !(elapsed >= MIN_FILL_MS)) return res.status(200).json({ ok: true });

  const name = oneLine(b.name, 100);
  const telefon = oneLine(b.telefon, 40);
  const email = oneLine(b.email, 200);
  const anliegen = clean(b.anliegen, 4000);
  if (
    name.length < 2 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ||
    (telefon && !/^[+0-9 ()./-]{6,40}$/.test(telefon)) ||
    !b.datenschutz
  ) {
    return res.status(400).json({ ok: false, error: "fields" });
  }

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM, MAIL_TO } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !MAIL_FROM || !MAIL_TO) {
    console.error("contact: SMTP-Umgebungsvariablen fehlen");
    return res.status(500).json({ ok: false, error: "config" });
  }

  const when = new Date().toLocaleString("de-DE", { timeZone: "Europe/Berlin" });
  const track = ["gclid", "gbraid", "wbraid", "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]
    .map((k) => [k, oneLine(b[k], 300)])
    .filter(([, v]) => v);
  const lines = [
    "Neue Anfrage über duerr-elektrotechnik.de",
    "",
    `Name: ${name}`,
    `Telefon: ${telefon || "-"}`,
    `E-Mail: ${email}`,
    `Seite: ${oneLine(b.page, 300) || "-"}`,
    `Eingang: ${when}`,
    "",
    "Anliegen:",
    anliegen || "(kein Text)",
  ];
  if (track.length) lines.push("", "Herkunft (Werbung):", ...track.map(([k, v]) => `${k}: ${v}`));
  lines.push("", "Datenschutz-Einwilligung: erteilt", "", "Mit «Antworten» geht die Mail direkt an den Kunden.");

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 465),
    secure: Number(SMTP_PORT || 465) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });

  try {
    await transporter.sendMail({
      from: { name: "Dürr Elektrotechnik Website", address: MAIL_FROM },
      to: MAIL_TO,
      replyTo: { name, address: email },
      subject: `Neue Anfrage über die Website: ${name}`,
      text: lines.join("\n"),
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("contact: Versand fehlgeschlagen", err && err.code, err && err.message);
    return res.status(502).json({ ok: false, error: "send" });
  }
};
