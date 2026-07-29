const STORE = {
  name: "McGriff's Equipment Rentals",
  email: "mcgriffsrental@gmail.com",
  phone: "641-637-4010",
  address: "1352 US 63, New Sharon, Iowa 50207",
  holdHours: 2,
  scheduleSheetName: "Reservation Email Schedule",
  activitySheetName: "Email Activity Log"
};

function doGet() {
  return json_({
    ok: true,
    service: "McGriff's reservation email automation",
    version: "1.0-production",
    time: new Date().toISOString()
  });
}

function doPost(e) {
  let data = {};
  try {
    const body = e && e.postData && e.postData.contents;
    if (!body) throw new Error("Request body is empty");
    data = JSON.parse(body);
    const action = data.action || data.event;
    if (!action) throw new Error("Missing action/event");

    ensureSetup_();
    logEmail_(action, data, "received", "Request received by Apps Script");

    switch (action) {
      case "reservationApproved": handleApproved_(data); break;
      case "reservationDeclined": handleDeclined_(data); break;
      case "reservationReleased": handleReleased_(data); break;
      case "reservationRescheduled": handleRescheduled_(data); break;
      case "healthCheck": break;
      default: throw new Error(`Unsupported action: ${action}`);
    }

    return json_({ ok: true, action });
  } catch (err) {
    console.error(err);
    try { logEmail_(data.action || data.event || "unknown", data, "failed", String(err)); } catch (_) {}
    return json_({ ok: false, error: String(err) });
  }
}

function setup() {
  ensureSetup_(true);
  return SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty("SCHEDULE_SHEET_ID")).getUrl();
}

function ensureSetup_(resetTrigger) {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty("SCHEDULE_SHEET_ID");
  let ss;
  try { ss = id ? SpreadsheetApp.openById(id) : null; } catch (_) { ss = null; }
  if (!ss) {
    ss = SpreadsheetApp.create("McGriff's Rental Email Schedule");
    props.setProperty("SCHEDULE_SHEET_ID", ss.getId());
  }

  const schedule = getOrCreateSheet_(ss, STORE.scheduleSheetName);
  if (schedule.getLastRow() === 0) {
    schedule.appendRow(["requestId","reservationId","requestNumber","firstName","customerName","email","phone","equipmentName","pickupAt","returnAt","status","confirmationSentAt","reminder24SentAt","warning1HourSentAt","releasedAt","updatedAt"]);
  }

  const activity = getOrCreateSheet_(ss, STORE.activitySheetName);
  if (activity.getLastRow() === 0) {
    activity.appendRow(["timestamp","action","status","recipient","requestNumber","equipmentName","requestId","reservationId","message"]);
  }

  const triggers = ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === "processScheduledEmails");
  if (resetTrigger || triggers.length === 0) {
    triggers.forEach(t => ScriptApp.deleteTrigger(t));
    ScriptApp.newTrigger("processScheduledEmails").timeBased().everyMinutes(15).create();
  }
  return ss;
}

function getOrCreateSheet_(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function getSheet_() {
  const ss = ensureSetup_();
  return getOrCreateSheet_(ss, STORE.scheduleSheetName);
}

function getActivitySheet_() {
  const ss = ensureSetup_();
  return getOrCreateSheet_(ss, STORE.activitySheetName);
}

function handleApproved_(d) {
  validateEmailPayload_(d);
  sendConfirmation_(d);
  upsert_(d, "Approved", { confirmationSentAt: new Date().toISOString() });
}

function handleDeclined_(d) {
  validateEmailPayload_(d);
  const reason = safe_(d.declineReason || d.reason || "We are unable to approve the requested reservation dates.");
  const subject = "Update on your McGriff's reservation request";
  const html = layout_("Reservation Request Update",
    `Hi ${safe_(d.firstName || "there")},
    <p>Thank you for requesting <strong>${safe_(d.equipmentName)}</strong>.</p>
    <p>Unfortunately, we are unable to approve this reservation request.</p>
    <div style="background:#f3f4f6;padding:16px;border-radius:10px;margin:18px 0"><strong>Reason:</strong><br>${reason}</div>
    ${details_(d)}
    <p>If your schedule is flexible, please call us at <strong>${STORE.phone}</strong>. We will be glad to help find another available time or similar equipment.</p>
    <p><strong>Please call the store for assistance; this email account is not monitored regularly.</strong></p>`);
  send_(d, subject, html, "reservationDeclined");
  const row = findRow_(d.requestId);
  if (row) {
    const sh = getSheet_();
    sh.getRange(row, 11).setValue("Declined");
    sh.getRange(row, 16).setValue(new Date().toISOString());
  }
}

function handleReleased_(d) {
  validateEmailPayload_(d);
  const subject = "Your McGriff's reservation has been released";
  const html = layout_("Reservation Released", `Hi ${safe_(d.firstName || "there")},<p>Your reservation for <strong>${safe_(d.equipmentName)}</strong> has been released because it was not picked up within two hours of the scheduled pickup time.</p><p>If this was unexpected, please call us at <strong>${STORE.phone}</strong>.</p>`);
  send_(d, subject, html, "reservationReleased");
  const row = findRow_(d.requestId);
  if (row) {
    const sh = getSheet_();
    sh.getRange(row, 11).setValue("Released");
    sh.getRange(row, 15).setValue(new Date().toISOString());
    sh.getRange(row, 16).setValue(new Date().toISOString());
  }
}

function handleRescheduled_(d) {
  validateEmailPayload_(d);
  const row = findRow_(d.requestId);
  if (row) {
    const sh = getSheet_();
    sh.getRange(row, 9).setValue(d.pickupAt);
    sh.getRange(row, 14).clearContent();
    sh.getRange(row, 16).setValue(new Date().toISOString());
  }
  const subject = "Updated pickup time for your McGriff's reservation";
  const html = layout_("Updated Reservation Time", `Hi ${safe_(d.firstName || "there")},<p>Your pickup time for <strong>${safe_(d.equipmentName)}</strong> has been updated.</p>${details_(d)}${holdPolicy_()}`);
  send_(d, subject, html, "reservationRescheduled");
}

function processScheduledEmails() {
  const sh = getSheet_();
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return;
  const now = Date.now();
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (r[10] !== "Approved") continue;
    const pickup = new Date(r[8]).getTime();
    if (!pickup) continue;
    const d = { requestId:r[0], reservationId:r[1], requestNumber:r[2], firstName:r[3], customerName:r[4], email:r[5], phone:r[6], equipmentName:r[7], pickupAt:r[8], returnAt:r[9] };
    if (!r[12] && now >= pickup - 25*60*60*1000 && now <= pickup - 23*60*60*1000) {
      send24Hour_(d); sh.getRange(i+1,13).setValue(new Date().toISOString());
    }
    if (!r[13] && now >= pickup + 60*60*1000 && now < pickup + 2*60*60*1000) {
      sendOneHourWarning_(d); sh.getRange(i+1,14).setValue(new Date().toISOString());
    }
  }
}

function sendConfirmation_(d) {
  send_(d, "Your McGriff's reservation has been confirmed", layout_("Reservation Confirmed", `Hi ${safe_(d.firstName || "there")},<p>Your reservation for <strong>${safe_(d.equipmentName)}</strong> has been confirmed.</p>${details_(d)}${holdPolicy_()}<p>Reservation number: <strong>${safe_(d.requestNumber || "")}</strong></p>`), "reservationApproved");
}
function send24Hour_(d) { send_(d, "Reminder: Your McGriff's reservation is tomorrow", layout_("Your Reservation Is Tomorrow", `Hi ${safe_(d.firstName || "there")},<p>This is a reminder that your reservation for <strong>${safe_(d.equipmentName)}</strong> is scheduled for pickup in about 24 hours.</p>${details_(d)}${holdPolicy_()}`), "reminder24Hour"); }
function sendOneHourWarning_(d) { const release = new Date(new Date(d.pickupAt).getTime()+2*60*60*1000); send_(d, "Action needed: Your McGriff's reservation will be released in 1 hour", layout_("One Hour Remaining", `Hi ${safe_(d.firstName || "there")},<p>Your reservation for <strong>${safe_(d.equipmentName)}</strong> was scheduled for pickup at ${format_(d.pickupAt)}.</p><p><strong>We will hold it until ${format_(release)}.</strong> Please arrive or call ${STORE.phone} within the next hour.</p>`), "warning1Hour"); }

function send_(d, subject, html, action) {
  if (!d.email) throw new Error("Customer email is missing");
  try {
    MailApp.sendEmail({ to:d.email, subject, htmlBody:html, name:STORE.name, replyTo:STORE.email, body:strip_(html) });
    logEmail_(action, d, "sent", subject);
  } catch (err) {
    logEmail_(action, d, "failed", String(err));
    throw err;
  }
}

function validateEmailPayload_(d) {
  if (!d.email) throw new Error("Customer email is missing");
  if (!d.equipmentName) throw new Error("Equipment name is missing");
}

function logEmail_(action, d, status, message) {
  const sh = getActivitySheet_();
  sh.appendRow([new Date(), action || "", status || "", d.email || "", d.requestNumber || "", d.equipmentName || "", d.requestId || "", d.reservationId || "", message || ""]);
}

function details_(d) { return `<div style="background:#f3f4f6;padding:16px;border-radius:10px"><p><strong>Equipment:</strong> ${safe_(d.equipmentName)}</p><p><strong>Pickup:</strong> ${format_(d.pickupAt)}</p><p><strong>Return:</strong> ${format_(d.returnAt)}</p><p><strong>Location:</strong> ${STORE.address}</p></div>`; }
function holdPolicy_() { return `<p><strong>Important:</strong> Reserved equipment is held for two hours after the arranged pickup time. Please call ${STORE.phone} if you expect to arrive later.</p>`; }
function layout_(title, body) { return `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#1f2937"><div style="background:#b91c1c;color:white;padding:20px"><h1 style="margin:0;font-size:24px">${title}</h1></div><div style="padding:24px;border:1px solid #e5e7eb">${body}<hr style="border:0;border-top:1px solid #e5e7eb;margin:24px 0"><p><strong>${STORE.name}</strong><br>${STORE.address}<br>${STORE.phone}<br>${STORE.email}</p></div></div>`; }
function upsert_(d, status, extra) { const sh=getSheet_(), row=findRow_(d.requestId), vals=[d.requestId||"",d.reservationId||"",d.requestNumber||"",d.firstName||"",d.customerName||"",d.email||"",d.phone||"",d.equipmentName||"",d.pickupAt||"",d.returnAt||"",status||"Approved",extra.confirmationSentAt||"","","","",new Date().toISOString()]; if(row) sh.getRange(row,1,1,vals.length).setValues([vals]); else sh.appendRow(vals); }
function findRow_(requestId) { if (!requestId) return 0; const sh=getSheet_(), v=sh.getDataRange().getValues(); for(let i=1;i<v.length;i++) if(String(v[i][0])===String(requestId)) return i+1; return 0; }
function format_(value) { if(!value) return "—"; const date=new Date(value); if(isNaN(date.getTime())) return safe_(value); return Utilities.formatDate(date, Session.getScriptTimeZone(), "EEEE, MMMM d, yyyy 'at' h:mm a"); }
function safe_(v) { return String(v||"").replace(/[&<>\"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'\"':"&quot;","'":"&#39;"}[c])); }
function strip_(html) { return html.replace(/<style[\s\S]*?<\/style>/gi,"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim(); }
function json_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }

function testDeclineEmail() {
  ensureSetup_();
  handleDeclined_({
    action:"reservationDeclined", requestId:"TEST-"+Date.now(), requestNumber:"TEST-DECLINE",
    firstName:"Cody", customerName:"Cody DeZwarte", email:STORE.email, phone:STORE.phone,
    equipmentName:"Test Equipment", pickupAt:new Date(Date.now()+86400000).toISOString(),
    returnAt:new Date(Date.now()+2*86400000).toISOString(), declineReason:"This is a test decline email."
  });
}
