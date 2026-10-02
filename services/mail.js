const nodemailer = require('nodemailer');
const newsletterService = require('./newsletter');
const { formatMatchDateCs } = require('./accreditation');

let warnedNoSmtp = false;

function readSmtpEnv(prefix) {
  const p = prefix ? `${prefix}_` : '';
  return {
    url: String(process.env[`${p}SMTP_URL`] || (!prefix ? process.env.SMTP_URL : '') || '').trim(),
    host: String(process.env[`${p}SMTP_HOST`] || (!prefix ? process.env.SMTP_HOST : '') || '').trim(),
    port: parseInt(process.env[`${p}SMTP_PORT`] || process.env.SMTP_PORT || '465', 10),
    secureRaw: process.env[`${p}SMTP_SECURE`] ?? process.env.SMTP_SECURE,
    user: String(process.env[`${p}SMTP_USER`] || (!prefix ? process.env.SMTP_USER : '') || '').trim(),
    pass: String(process.env[`${p}SMTP_PASS`] || (!prefix ? process.env.SMTP_PASS : '') || '').trim(),
  };
}

function profileSmtpConfigured(prefix) {
  const cfg = readSmtpEnv(prefix);
  return Boolean(cfg.url || cfg.host);
}

function createTransporterForProfile(prefix) {
  const cfg = readSmtpEnv(prefix);
  if (cfg.url) {
    return nodemailer.createTransport(cfg.url);
  }
  if (!cfg.host) {
    if (!warnedNoSmtp) {
      console.warn(
        '[11ka] SMTP není nastaven - doplňte .env (NEWSLETTER_SMTP_* a/nebo ACCREDITATION_SMTP_*).'
      );
      warnedNoSmtp = true;
    }
    return null;
  }

  const secureExplicit = cfg.secureRaw;
  const secure =
    secureExplicit === 'true' ||
    secureExplicit === '1' ||
    (secureExplicit !== 'false' && secureExplicit !== '0' && cfg.port === 465);

  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure,
    requireTLS: !secure && cfg.port === 587,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass || '' } : undefined,
    tls: { minVersion: 'TLSv1.2' },
  });
}

/** @deprecated použijte createTransporterForProfile */
function createTransporter() {
  return createTransporterForProfile('NEWSLETTER') || createTransporterForProfile('ACCREDITATION');
}

function isSmtpConfigured() {
  return profileSmtpConfigured('NEWSLETTER') || profileSmtpConfigured('ACCREDITATION');
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatFromAddress(email, displayName) {
  const addr = String(email || '').trim();
  if (!addr) return null;
  if (addr.includes('<')) return addr;
  const name = String(displayName || '').trim();
  return name ? `"${name}" <${addr}>` : addr;
}

function getNewsletterFrom() {
  const email = process.env.NEWSLETTER_MAIL_FROM || 'novinky@11ka.cz';
  const name = process.env.NEWSLETTER_MAIL_FROM_NAME || '11ka Novinky';
  return formatFromAddress(email, name);
}

function getAccreditationFrom() {
  const email = process.env.ACCREDITATION_MAIL_FROM || 'akreditace@11ka.cz';
  const name = process.env.ACCREDITATION_MAIL_FROM_NAME || '11ka Akreditace';
  return formatFromAddress(email, name);
}

/**
 * @param {{ title: string, slug: string, excerpt?: string | null }} article
 */
async function notifyNewArticle(article) {
  const tx = createTransporterForProfile('NEWSLETTER');
  if (!tx) return;

  const from = getNewsletterFrom();
  if (!from) {
    console.warn('[11ka] NEWSLETTER_MAIL_FROM chybí - nelze odeslat newsletter.');
    return;
  }

  const recipients = newsletterService.listEmails();
  if (!recipients.length) return;

  const base = (process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.SERVER_PORT || process.env.PORT || 3000}`).replace(
    /\/$/,
    ''
  );
  const url = `${base}/clanek/${encodeURIComponent(article.slug)}`;
  const subject = `11ka - nový článek: ${article.title}`;
  const excerpt = article.excerpt || '';
  const logoUrl = `${base}/logo.png`;

  for (const to of recipients) {
    try {
      const token = newsletterService.buildUnsubscribeToken(to);
      const unsubscribeUrl = `${base}/newsletter/odhlasit?email=${encodeURIComponent(to)}&token=${encodeURIComponent(token)}`;
      const text = `${article.title}\n\n${excerpt}\n\n${url}\n\nOdhlášení z newsletteru: ${unsubscribeUrl}\n`;
      const html = `
<div style="margin:0;padding:24px;background:#0b111b;font-family:Inter,Segoe UI,Arial,sans-serif;color:#e2e8f0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;margin:0 auto;background:#151c2c;border:1px solid rgba(255,255,255,0.08);border-radius:14px;overflow:hidden;">
    <tr>
      <td style="padding:20px 24px;border-bottom:1px solid rgba(255,255,255,0.08);">
        <img src="${logoUrl}" alt="11ka" style="height:34px;width:auto;display:block;" />
      </td>
    </tr>
    <tr>
      <td style="padding:24px;">
        <p style="margin:0 0 10px 0;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#94a3b8;">Nový článek</p>
        <h1 style="margin:0 0 12px 0;font-size:26px;line-height:1.25;color:#ffffff;">${escapeHtml(article.title)}</h1>
        <p style="margin:0 0 20px 0;font-size:15px;line-height:1.6;color:#cbd5e1;">${escapeHtml(excerpt)}</p>
        <p style="margin:0;">
          <a href="${url}" style="display:inline-block;background:#16dffb;color:#0b111b;text-decoration:none;font-weight:700;font-size:14px;padding:10px 16px;border-radius:10px;">Číst článek</a>
        </p>
      </td>
    </tr>
    <tr>
      <td style="padding:14px 24px;border-top:1px solid rgba(255,255,255,0.08);font-size:12px;color:#94a3b8;line-height:1.45;">
        Pokud tlačítko nefunguje, otevřete odkaz: <a href="${url}" style="color:#16dffb;text-decoration:none;">${url}</a>
        <br />
        Odhlásit se z newsletteru: <a href="${unsubscribeUrl}" style="color:#16dffb;text-decoration:none;">${unsubscribeUrl}</a>
      </td>
    </tr>
  </table>
</div>`;
      await tx.sendMail({ from, to, subject, text, html });
    } catch (err) {
      console.error('[11ka] Odeslání na', to, ':', err.message);
    }
  }
}

function sanitizeField(value, maxLen = 500) {
  return String(value || '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

/**
 * @param {{ email: string, phone: string, name: string, match: string, matchDate?: string, accreditationType: 'photo' | 'pisi' }} data
 */
async function sendAccreditationRequest(data) {
  const tx = createTransporterForProfile('ACCREDITATION');
  if (!tx) {
    return { ok: false, error: 'smtp_not_configured' };
  }

  const from = getAccreditationFrom();
  const to = process.env.ACCREDITATION_EMAIL || 'akreditace@11ka.cz';
  const cc = String(process.env.ACCREDITATION_EMAIL_CC || '').trim();
  if (!from) {
    console.warn('[11ka] ACCREDITATION_MAIL_FROM chybí - nelze odeslat žádost o akreditaci.');
    return { ok: false, error: 'mail_from_missing' };
  }

  const typeLabel = data.accreditationType === 'photo' ? 'Photo' : 'Píšící';
  const matchLabel = sanitizeField(data.match, 120);
  const matchDateLabel = formatMatchDateCs(data.matchDate);
  const subject = `11ka - nová žádost o akreditaci${matchLabel ? `: ${matchLabel}` : ''}`;
  const text = [
    'Na webu 11ka.cz byla odeslána nová žádost o akreditaci.',
    '',
    `Jméno: ${data.name}`,
    `E-mail: ${data.email}`,
    `Telefonní číslo: ${data.phone}`,
    `Zápas: ${data.match}`,
    `Datum zápasu: ${matchDateLabel}`,
    `Typ: ${typeLabel}`,
  ].join('\n');

  const html = `
<div style="margin:0;padding:24px;background:#0b111b;font-family:Inter,Segoe UI,Arial,sans-serif;color:#e2e8f0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;margin:0 auto;background:#151c2c;border:1px solid rgba(255,255,255,0.08);border-radius:14px;overflow:hidden;">
    <tr>
      <td style="padding:24px;">
        <p style="margin:0 0 10px 0;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#94a3b8;">Akreditace</p>
        <h1 style="margin:0 0 16px 0;font-size:22px;line-height:1.3;color:#ffffff;">Nová žádost o akreditaci</h1>
        <p style="margin:0 0 20px 0;font-size:14px;line-height:1.6;color:#cbd5e1;">Na webu 11ka.cz byla právě odeslána nová žádost.</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.6;color:#e2e8f0;">
          <tr><td style="padding:6px 0;color:#94a3b8;width:110px;">Jméno</td><td style="padding:6px 0;">${escapeHtml(data.name)}</td></tr>
          <tr><td style="padding:6px 0;color:#94a3b8;">E-mail</td><td style="padding:6px 0;"><a href="mailto:${escapeHtml(data.email)}" style="color:#16dffb;text-decoration:none;">${escapeHtml(data.email)}</a></td></tr>
          <tr><td style="padding:6px 0;color:#94a3b8;">Telefonní číslo</td><td style="padding:6px 0;">${escapeHtml(data.phone)}</td></tr>
          <tr><td style="padding:6px 0;color:#94a3b8;">Zápas</td><td style="padding:6px 0;">${escapeHtml(data.match)}</td></tr>
          <tr><td style="padding:6px 0;color:#94a3b8;">Datum zápasu</td><td style="padding:6px 0;">${escapeHtml(matchDateLabel)}</td></tr>
          <tr><td style="padding:6px 0;color:#94a3b8;">Typ</td><td style="padding:6px 0;">${escapeHtml(typeLabel)}</td></tr>
        </table>
      </td>
    </tr>
  </table>
</div>`;

  try {
    await tx.sendMail({
      from,
      to,
      cc: cc || undefined,
      subject,
      text,
      html,
    });
    return { ok: true };
  } catch (err) {
    console.error('[11ka] Odeslání žádosti o akreditaci:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Ověří připojení k SMTP (pro diagnostiku).
 */
async function verifySmtpConnection() {
  const profiles = ['NEWSLETTER', 'ACCREDITATION'].filter((p) => profileSmtpConfigured(p));
  if (!profiles.length) return { ok: false, error: 'smtp_not_configured' };
  const errors = [];
  for (const prefix of profiles) {
    const tx = createTransporterForProfile(prefix);
    if (!tx) continue;
    try {
      await tx.verify();
    } catch (err) {
      errors.push(`${prefix}: ${err.message}`);
    }
  }
  if (errors.length === profiles.length) {
    return { ok: false, error: errors.join('; ') };
  }
  return { ok: true, warning: errors.length ? errors.join('; ') : undefined };
}

module.exports = {
  createTransporter,
  isSmtpConfigured,
  verifySmtpConnection,
  notifyNewArticle,
  sendAccreditationRequest,
};
