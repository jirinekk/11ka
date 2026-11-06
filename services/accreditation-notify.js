const accreditation = require('./accreditation');
const foto = require('./foto');
const {
  sendAccreditationRequest,
  sendAccreditationApplicantReceived,
  sendAccreditationMatchDayReminder,
} = require('./mail');

async function afterAccreditationCreated(requestId, data) {
  let albumId = null;
  if (data && data.accreditation_type === 'photo') {
    try {
      const album = foto.createAlbumFromAccreditation(data);
      if (album && album.id) {
        albumId = album.id;
        accreditation.linkAlbum(requestId, albumId);
        foto.logEvent({
          actorEmail: data.email,
          actorName: data.name,
          action: 'create_album',
          albumId,
          detail: `Automaticky z žádosti o akreditaci #${requestId}`,
        });
      } else if (album && album.error) {
        console.error('[11ka] auto album from acc failed:', album.error);
      }
    } catch (err) {
      console.error('[11ka] auto album from acc:', err && err.message);
    }
  }

  const applicant = await sendAccreditationApplicantReceived({
    email: data.email,
    name: data.name,
    match: data.match,
    matchDate: data.match_date,
    accreditationType: data.accreditation_type,
    albumId,
  });
  if (applicant.ok) accreditation.markApplicantEmailSent(requestId);

  const staff = await sendAccreditationRequest({
    email: data.email,
    phone: data.phone,
    name: data.name,
    match: data.match,
    matchDate: data.match_date,
    accreditationType: data.accreditation_type,
  });
  if (staff.ok) accreditation.markEmailSent(requestId);

  return { albumId, applicant, staff };
}

async function sendDueMatchDayReminders() {
  const rows = accreditation.listDueMatchDay();
  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    const result = await sendAccreditationMatchDayReminder({
      email: row.email,
      name: row.name,
      match_name: row.match_name,
      match_date: row.match_date,
      album_id: row.album_id,
    });
    if (result.ok) {
      accreditation.markMatchDayEmailSent(row.id);
      sent += 1;
    } else {
      failed += 1;
    }
  }
  return { scanned: rows.length, sent, failed };
}

module.exports = {
  afterAccreditationCreated,
  sendDueMatchDayReminders,
};
