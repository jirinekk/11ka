#!/usr/bin/env node
/**
 * Test SMTP - spusťte na serveru: node scripts/test-smtp.js
 * Vyžaduje .env se SMTP_HOST, SMTP_USER, SMTP_PASS
 */
require('dotenv').config();
const { verifySmtpConnection, sendAccreditationRequest, isSmtpConfigured } = require('../services/mail');

async function main() {
  if (!isSmtpConfigured()) {
    console.error('Chybí SMTP_HOST nebo SMTP_URL v .env');
    process.exit(1);
  }
  console.log('SMTP_HOST:', process.env.SMTP_HOST);
  console.log('SMTP_PORT:', process.env.SMTP_PORT || '465');
  console.log('SMTP_USER:', process.env.SMTP_USER || '(není)');
  console.log('ACCREDITATION_EMAIL:', process.env.ACCREDITATION_EMAIL || 'akreditace@11ka.cz');
  console.log('NEWSLETTER_MAIL_FROM:', process.env.NEWSLETTER_MAIL_FROM || 'novinky@11ka.cz');
  console.log('ACCREDITATION_MAIL_FROM:', process.env.ACCREDITATION_MAIL_FROM || 'akreditace@11ka.cz');
  console.log('Ověřuji připojení…');
  const verify = await verifySmtpConnection();
  if (!verify.ok) {
    console.error('SMTP verify selhalo:', verify.error);
    process.exit(1);
  }
  console.log('SMTP OK. Odesílám testovací žádost…');
  const result = await sendAccreditationRequest({
    email: 'test@example.com',
    phone: '+420000000000',
    name: 'SMTP test',
    match: 'Test zápas',
    accreditationType: 'photo',
  });
  if (!result.ok) {
    console.error('Odeslání selhalo:', result.error);
    process.exit(1);
  }
  console.log('Testovací e-mail odeslán.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
