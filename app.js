import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  getFirestore, collection, addDoc, updateDoc, deleteDoc, doc,
  onSnapshot, query, orderBy, serverTimestamp, setDoc
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBCYpQcTm0_37GAUy8FK_vfChk8seFCOKI",
  authDomain: "mcgriffsrental.firebaseapp.com",
  projectId: "mcgriffsrental",
  storageBucket: "mcgriffsrental.firebasestorage.app",
  messagingSenderId: "511623270295",
  appId: "1:511623270295:web:d326c6fd852bafa2e6fed2"
};

/*
 * Paste the deployed Google Apps Script /exec URL here after completing
 * the Drive Photo Uploader setup.
 */
const DRIVE_UPLOAD_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbwanrhY_BfmI1n0wjo-BWrbu_dREl1VpRGFTQz2ylOtOHbbxubxxSyEZ-Yyva8T8_4w/exec";

const EMAIL_SERVICE_WEB_APP_URL = "PASTE_EMAIL_REMINDER_WEB_APP_URL_HERE";

function emailServiceReady(){
  return EMAIL_SERVICE_WEB_APP_URL.startsWith("https://script.google.com/macros/s/");
}

function callEmailService(action,payload,statusElement=null){
  if(!emailServiceReady()){
    return Promise.reject(new Error("The email and reminder service has not been connected yet."));
  }

  const callbackId=`mail-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const frameName=`mail-frame-${callbackId}`;
  const iframe=document.createElement("iframe");
  iframe.name=frameName;
  iframe.style.display="none";
  document.body.appendChild(iframe);

  const form=document.createElement("form");
  form.method="POST";
  form.action=EMAIL_SERVICE_WEB_APP_URL;
  form.target=frameName;
  form.style.display="none";

  const fields={action,callbackId,payload:JSON.stringify(payload)};
  Object.entries(fields).forEach(([name,value])=>{
    const input=document.createElement("input");
    input.type="hidden";
    input.name=name;
    input.value=value;
    form.appendChild(input);
  });
  document.body.appendChild(form);

  if(statusElement)statusElement.textContent="Sending...";

  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{
      cleanup();
      reject(new Error("The email service timed out."));
    },120000);

    const onMessage=event=>{
      const data=event.data||{};
      if(data.type!=="mcgriffs-email-service"||data.callbackId!==callbackId)return;
      clearTimeout(timer);
      cleanup();
      data.ok?resolve(data):reject(new Error(data.error||"Email service failed."));
    };

    function cleanup(){
      window.removeEventListener("message",onMessage);
      form.remove();
      iframe.remove();
    }

    window.addEventListener("message",onMessage);
    form.submit();
  });
}

async function loadQrLibrary(){
  if(window.QRCode)return;
  await new Promise((resolve,reject)=>{
    const script=document.createElement("script");
    script.src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";
    script.onload=resolve;
    script.onerror=()=>reject(new Error("The QR-code library could not be loaded."));
    document.head.appendChild(script);
  });
}

function equipmentProfileUrl(equipmentId){
  const url=new URL(window.location.href);
  url.search="";
  url.hash="";
  url.searchParams.set("equipment",equipmentId);
  return url.toString();
}

async function showEquipmentQr(e){
  await loadQrLibrary();
  const profileUrl=equipmentProfileUrl(e.id);

  openModal(`QR Code - ${e.name}`,`
    <div class="qr-label print-area">
      <div class="qr-business">${esc(appSetting("businessName","McGriff's Farm, Home & Rental"))}</div>
      <div class="qr-equipment">${esc(e.name)}</div>
      <div id="equipmentQrCode" class="qr-code"></div>
      <div class="qr-scan-text">SCAN FOR EQUIPMENT PROFILE</div>
      <div class="qr-id">Equipment ID: ${esc(e.id)}</div>
    </div>
    <div class="button-row no-print qr-actions">
      <button id="printEquipmentQr">Print QR Label</button>
      <button class="secondary" id="copyEquipmentLink">Copy Profile Link</button>
      <button class="secondary" id="closeEquipmentQr">Close</button>
    </div>
  `);

  new QRCode($("equipmentQrCode"),{
    text:profileUrl,
    width:260,
    height:260,
    correctLevel:QRCode.CorrectLevel.H
  });

  $("printEquipmentQr").onclick=()=>{
    document.body.classList.add("print-qr-only");
    window.print();
    setTimeout(()=>document.body.classList.remove("print-qr-only"),500);
  };
  $("copyEquipmentLink").onclick=async()=>{
    await navigator.clipboard.writeText(profileUrl);
    toast("Equipment profile link copied");
  };
  $("closeEquipmentQr").onclick=closeModal;
}

let pendingDeepLinkEquipmentId=new URLSearchParams(window.location.search).get("equipment")||"";
let deepLinkOpened=false;

function openPendingEquipmentDeepLink(){
  if(deepLinkOpened||!pendingDeepLinkEquipmentId||!state.equipment.length)return;
  const e=state.equipment.find(x=>x.id===pendingDeepLinkEquipmentId);
  if(!e)return;
  deepLinkOpened=true;
  equipmentProfileView(e.id);
}

function photoUploadReady() {
  return DRIVE_UPLOAD_WEB_APP_URL.startsWith("https://script.google.com/macros/s/");
}

function fileToCompressedDataUrl(file, maxDimension = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) {
      reject(new Error("Please choose an image file."));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The photo could not be read."));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("The photo could not be processed."));
      image.onload = () => {
        const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
        const width = Math.max(1, Math.round(image.width * scale));
        const height = Math.max(1, Math.round(image.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(image, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function uploadPhotoToDrive(file, photoType, statusElement) {
  if (!photoUploadReady()) {
    throw new Error("The Google Drive upload service has not been connected yet.");
  }

  if (file.size > 15 * 1024 * 1024) {
    throw new Error("Please choose a photo smaller than 15 MB.");
  }

  if (statusElement) statusElement.textContent = "Preparing photo...";

  const dataUrl = await fileToCompressedDataUrl(file);
  const callbackId = `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const frameName = `drive-upload-frame-${callbackId}`;
  const iframe = document.createElement("iframe");
  iframe.name = frameName;
  iframe.style.display = "none";
  document.body.appendChild(iframe);

  const form = document.createElement("form");
  form.method = "POST";
  form.action = DRIVE_UPLOAD_WEB_APP_URL;
  form.target = frameName;
  form.style.display = "none";

  const fields = {
    callbackId,
    fileName: file.name || `${photoType}-${Date.now()}.jpg`,
    mimeType: "image/jpeg",
    photoType,
    base64: dataUrl.split(",")[1]
  };

  Object.entries(fields).forEach(([name, value]) => {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  });

  document.body.appendChild(form);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("The photo upload timed out. Please try again."));
    }, 120000);

    const onMessage = event => {
      const data = event.data || {};
      if (data.type !== "mcgriffs-drive-upload" || data.callbackId !== callbackId) return;

      clearTimeout(timeout);
      cleanup();

      if (!data.ok) {
        reject(new Error(data.error || "Photo upload failed."));
        return;
      }

      resolve(data);
    };

    function cleanup() {
      window.removeEventListener("message", onMessage);
      form.remove();
      iframe.remove();
    }

    window.addEventListener("message", onMessage);
    if (statusElement) statusElement.textContent = "Uploading photo...";
    form.submit();
  });
}

function photoUploadControl(prefix, label, existingUrl = "") {
  return `
    <label>${label}</label>
    <input id="${prefix}File" type="file" accept="image/*">
    <input id="${prefix}Url" type="hidden" value="${esc(existingUrl)}">
    <div id="${prefix}Status" style="font-size:13px;font-weight:800;color:#6b7280;margin:-5px 0 10px;">
      ${existingUrl ? "Current photo is saved." : ""}
    </div>
    <img id="${prefix}Preview"
      src="${esc(displayImageUrl(existingUrl))}"
      style="${existingUrl ? "" : "display:none;"}width:100%;max-height:260px;object-fit:contain;border:1px solid #e5e7eb;border-radius:10px;margin-bottom:12px;">
  `;
}

function connectPhotoControl(prefix, photoType) {
  const fileInput = $(`${prefix}File`);
  if (!fileInput) return;

  fileInput.onchange = async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;

    const status = $(`${prefix}Status`);
    const preview = $(`${prefix}Preview`);

    try {
      const result = await uploadPhotoToDrive(file, photoType, status);
      $(`${prefix}Url`).value = result.url;
      preview.src = displayImageUrl(result.url);
      preview.style.display = "block";
      status.textContent = "Photo uploaded.";
      toast("Photo uploaded");
    } catch (error) {
      status.textContent = error.message;
      alert(error.message);
    }
  };
}


const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

const state = { equipment:[], customers:[], rentals:[], reservations:[], maintenance:[], contracts:[], settings:{}, search:"", view:"dashboard" };

const DEFAULT_CONTRACT_TEXT = `EQUIPMENT RENTAL AGREEMENT

The customer assumes all risks connected with possession, transportation, loading, unloading, operation, use, misuse, and storage of the rented equipment. To the fullest extent permitted by law, McGriff's Farm, Home & Rental, its owners, employees, and representatives are not liable for injury, death, property damage, lost income, or other loss arising from the rental or use of the equipment, except where liability cannot legally be waived.

The customer acknowledges that a McGriff's employee demonstrated proper operation, provided an opportunity to ask questions, and explained relevant safety procedures. The customer agrees to operate the equipment only for its intended purpose, follow all instructions, use required safety equipment, and prevent unauthorized, impaired, or unqualified persons from operating it.

Before checkout, the customer and a McGriff's employee inspect the equipment and document pre-existing damage, condition, fuel, hours, and accessories. Damage, missing parts, excessive cleaning, fuel shortage, or abnormal wear discovered at return and not documented at checkout is the customer's responsibility, excluding ordinary wear from correct use.

The customer is responsible for repair or replacement costs caused by negligence, misuse, abuse, theft, loss, improper transportation, unauthorized modification, operation beyond rated capacity, or failure to follow instructions. The customer is responsible for the equipment until it is returned and accepted by a McGriff's employee. Additional rental, cleaning, fuel, recovery, repair, and replacement charges may apply.

The equipment is rented as-is and as-available. Except as required by law, McGriff's disclaims implied warranties. To the fullest extent permitted by law, the customer agrees to defend, indemnify, and hold harmless McGriff's and its representatives from claims arising from the customer's possession, transportation, or use of the equipment.

The customer acknowledges reading and understanding this agreement and voluntarily accepts its terms.`;

function appSetting(key,fallback=""){return state.settings&&state.settings[key]!==undefined?state.settings[key]:fallback;}
const $ = id => document.getElementById(id);
const money = n => `$${Number(n||0).toFixed(2)}`;
const esc = v => String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));

function driveFileIdFromUrl(url) {
  const text = String(url || "").trim();
  if (!text) return "";

  const patterns = [
    /[?&]id=([^&]+)/i,
    /\/d\/([^/?#]+)/i,
    /googleusercontent\.com\/d\/([^=/?#]+)/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) return decodeURIComponent(match[1]);
  }

  return "";
}

function displayImageUrl(url) {
  const text = String(url || "").trim();
  const fileId = driveFileIdFromUrl(text);

  if (fileId) {
    return `https://lh3.googleusercontent.com/d/${encodeURIComponent(fileId)}=w1600`;
  }

  return text;
}

const fmt = v => { if(!v)return""; const d=v?.toDate?v.toDate():new Date(v); return isNaN(d)?String(v):d.toLocaleString(); };
const nowLocal = () => { const d=new Date(); d.setMinutes(d.getMinutes()-d.getTimezoneOffset()); return d.toISOString().slice(0,16); };
const activeRental = equipmentId => state.rentals.find(r=>r.equipmentId===equipmentId&&!r.actualReturnAt);
const activeReservationsFor = equipmentId => state.reservations
  .filter(r => r.equipmentId === equipmentId && r.status === "Reserved")
  .sort((a,b) => new Date(a.startAt||0) - new Date(b.startAt||0));
const nextReservation = equipmentId => activeReservationsFor(equipmentId)[0] || null;
const rangesOverlap = (startA,endA,startB,endB) =>
  new Date(startA) < new Date(endB) && new Date(endA) > new Date(startB);
const revenueFor = equipmentId => state.rentals.filter(r=>r.equipmentId===equipmentId).reduce((s,r)=>s+Number(r.rentalAmount||0),0);
const maintenanceCostFor = equipmentId => state.maintenance.filter(m=>m.equipmentId===equipmentId).reduce((s,m)=>s+Number(m.cost||0),0);

function toast(msg){$("toast").textContent=msg;$("toast").classList.remove("hidden");clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>$("toast").classList.add("hidden"),2200)}
function openModal(title,html){$("modalTitle").textContent=title;$("modalBody").innerHTML=html;$("modal").classList.remove("hidden")}
function closeModal(){$("modal").classList.add("hidden")}
function setView(view){
  state.view=view;
  document.querySelectorAll(".view").forEach(v=>v.classList.add("hidden"));
  const target=$(`${view}View`);
  if(target)target.classList.remove("hidden");
  document.querySelectorAll(".nav").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
  const labels={
    dashboard:["Dashboard","Welcome back, Cody!"],
    equipment:["Equipment","Manage inventory and profitability."],
    customers:["Customers","Customer records and rental history."],
    reservations:["Reservations","Future bookings and pickups."],
    contracts:["Contracts","Agreements, signatures, and signed copies."],calendar:["Calendar","Pickups, returns, and reservations."],equipmentProfile:["Equipment Profile","Complete equipment history."],customerProfile:["Customer Profile","Customer history and activity."],rentalDetail:["Rental Details","Customer, equipment, contract, receipt, and timeline."],
    financials:["Financials","Revenue, deposits, costs, and profit."],
    maintenance:["Maintenance","Service history and upcoming work."],
    reports:["Reports","Performance and business analytics."],
    settings:["Settings","Business and system settings."],
    rentals:["Rentals","Complete rental history."]
  };
  $("pageTitle").textContent=labels[view]?.[0]||view;
  $("pageSubtitle").textContent=labels[view]?.[1]||"";
}
function render(){
  renderStats();
  renderDashboardV5();
  renderCategories();
  renderEquipment();
  renderCustomers();
  renderRentals();
  renderReservations();
  renderMaintenance();
  renderReports();
  renderFinancialsV5();
  renderContractsV5();renderCalendarV5();renderSettingsV5();
}

function renderStats(){
  const active=state.rentals.filter(r=>!r.actualReturnAt);
  const now=new Date();
  const todayKey=now.toISOString().slice(0,10);
  const monthKey=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
  const todayRevenue=state.rentals.filter(r=>String(r.startAt||"").startsWith(todayKey)).reduce((s,r)=>s+Number(r.rentalAmount||0),0);
  const monthRevenue=state.rentals.filter(r=>String(r.startAt||"").startsWith(monthKey)).reduce((s,r)=>s+Number(r.rentalAmount||0),0);
  $("statTodayRevenue").textContent=money(todayRevenue);
  $("statMonthRevenue").textContent=money(monthRevenue);
  $("statOut").textContent=active.length;
  $("statReservations").textContent=state.reservations.filter(r=>r.status==="Reserved").length;
  $("statReturnsToday").textContent=active.filter(r=>String(r.dueAt||"").startsWith(todayKey)).length;
  $("statMaintenance").textContent=state.maintenance.filter(m=>m.status==="Due"||m.status==="Scheduled").length;
}


function renderDashboardV5(){
  const now=new Date();
  const todayKey=now.toISOString().slice(0,10);
  const active=state.rentals.filter(r=>!r.actualReturnAt);
  const goingOut=state.rentals.filter(r=>String(r.startAt||"").startsWith(todayKey));
  const returning=active.filter(r=>String(r.dueAt||"").startsWith(todayKey));
  const overdue=active.filter(r=>r.dueAt&&new Date(r.dueAt)<now);
  const maintenanceDue=state.maintenance.filter(m=>m.status==="Due"||m.status==="Scheduled");
  const startingReservations=state.reservations.filter(r=>r.status==="Reserved"&&String(r.startAt||"").startsWith(todayKey));

  const scheduleRow=(time,title,customer)=>`<div class="schedule-item"><span>${esc(time||"")}</span><strong>${esc(title||"")}</strong><span>${esc(customer||"")}</span></div>`;
  $("goingOutToday").innerHTML=goingOut.length?goingOut.map(r=>scheduleRow(String(r.startAt||"").slice(11,16),r.equipmentName,r.customerName)).join(""):'<p class="muted">Nothing going out today.</p>';
  $("returnsDueToday").innerHTML=returning.length?returning.map(r=>scheduleRow(String(r.dueAt||"").slice(11,16),r.equipmentName,r.customerName)).join(""):'<p class="muted">Nothing due back today.</p>';

  const alerts=[];
  overdue.forEach(r=>alerts.push(["!","Rental Overdue",`${r.equipmentName} — ${r.customerName}`]));
  startingReservations.forEach(r=>alerts.push(["▣","Reservation Starts Today",`${r.equipmentName} — ${r.customerName}`]));
  if(maintenanceDue.length)alerts.push(["🔧",`${maintenanceDue.length} Maintenance Due`,maintenanceDue.map(m=>m.equipmentName).slice(0,2).join(", ")]);
  const awaiting=state.rentals.filter(r=>!r.contractSigned).length;
  if(awaiting)alerts.push(["i",`${awaiting} Contracts Awaiting Signature`,"Review rental agreements"]);
  $("alertsList").innerHTML=alerts.length?alerts.slice(0,5).map(a=>`<div class="alert-item"><div class="alert-dot">${a[0]}</div><div><strong>${esc(a[1])}</strong><div class="muted">${esc(a[2])}</div></div></div>`).join(""):'<p class="muted">No active alerts.</p>';

  const monthKey=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
  const monthly=state.equipment.map(e=>{
    const rentals=state.rentals.filter(r=>r.equipmentId===e.id&&String(r.startAt||"").startsWith(monthKey));
    return {name:e.name,count:rentals.length,revenue:rentals.reduce((s,r)=>s+Number(r.rentalAmount||0),0)};
  }).sort((a,b)=>b.revenue-a.revenue).slice(0,5);
  $("topEquipmentTable").innerHTML=monthly.length?`<table><thead><tr><th>#</th><th>Equipment</th><th>Rentals</th><th>Revenue</th></tr></thead><tbody>${monthly.map((x,i)=>`<tr><td>${i+1}</td><td><strong>${esc(x.name)}</strong></td><td>${x.count}</td><td>${money(x.revenue)}</td></tr>`).join("")}</tbody></table>`:'<p class="muted">No rental activity this month.</p>';

  const available=state.equipment.filter(e=>!activeRental(e.id)&&e.status!=="Maintenance"&&!nextReservation(e.id)).length;
  const reserved=state.equipment.filter(e=>!!nextReservation(e.id)&&!activeRental(e.id)).length;
  const maintenance=state.equipment.filter(e=>e.status==="Maintenance").length;
  $("statusTotal").textContent=state.equipment.length;
  $("statusLegend").innerHTML=[
    ["#16a34a","Available",available],["#1f6fe5","Rented Out",active.length],
    ["#f59e0b","Reserved",reserved],["#ef4444","Maintenance",maintenance]
  ].map(x=>`<div class="legend-row"><span class="legend-dot" style="background:${x[0]}"></span><span>${x[1]}</span><strong>${x[2]}</strong></div>`).join("");

  const activities=[];
  [...state.rentals].slice(-5).reverse().forEach(r=>activities.push(`${r.actualReturnAt?"Equipment returned":"Rental created"}: ${r.equipmentName} — ${r.customerName}`));
  [...state.maintenance].slice(-3).reverse().forEach(m=>activities.push(`Maintenance ${m.status||"updated"}: ${m.equipmentName}`));
  $("recentActivity").innerHTML=activities.length?activities.slice(0,6).map(a=>`<div class="activity-item"><span>${esc(a)}</span></div>`).join(""):'<p class="muted">No recent activity.</p>';
}

function renderFinancialsV5(){
  const revenue=state.rentals.reduce((s,r)=>s+Number(r.rentalAmount||0),0);
  const maintenance=state.maintenance.reduce((s,m)=>s+Number(m.cost||0),0);
  const deposits=state.rentals.reduce((s,r)=>s+Number(r.depositAmount||0),0);
  const refundable=state.rentals.filter(r=>r.actualReturnAt&&!r.depositReturned).reduce((s,r)=>s+Number(r.depositAmount||0),0);
  $("financialSummary").innerHTML=`<div class="mini-stat"><strong>${money(revenue)}</strong><span>Lifetime Rental Revenue</span></div><div class="mini-stat"><strong>${money(maintenance)}</strong><span>Maintenance Cost</span></div>`;
  $("depositSummary").innerHTML=`<div class="mini-stat"><strong>${money(deposits)}</strong><span>Total Deposits Recorded</span></div><div class="mini-stat"><strong>${money(refundable)}</strong><span>Awaiting Refund</span></div>`;
  $("financialsTable").innerHTML=$("reportsTable").innerHTML;
}

function renderContractsV5(){
  $("contractsAwaiting").textContent=state.rentals.filter(r=>!r.contractSigned).length;
  $("contractsSigned").textContent=state.rentals.filter(r=>r.contractSigned).length;
  $("contractsUploaded").textContent=state.rentals.filter(r=>r.signedContractUrl).length;
}


function rentalNumber(r){const year=String(r.startAt||new Date().toISOString()).slice(0,4);return r.rentalNumber||`MR-${year}-${String(r.id||"").slice(-6).toUpperCase()}`;}
function contractForRental(r){return state.contracts.find(c=>c.rentalId===r.id)||null;}


function rentalDetailView(id){
  const r=state.rentals.find(x=>x.id===id);if(!r)return;
  const customer=state.customers.find(c=>c.id===r.customerId)||{};
  const equipment=state.equipment.find(e=>e.id===r.equipmentId)||{};
  const contract=contractForRental(r);
  const overdue=!r.actualReturnAt&&r.dueAt&&new Date(r.dueAt)<new Date();
  const status=r.actualReturnAt?"Returned":overdue?"Overdue":"Currently Out";
  const statusClass=r.actualReturnAt?"available":overdue?"rented":"reserved";
  const checkoutPhoto=r.checkoutPhotoUrl?`<img src="${esc(displayImageUrl(r.checkoutPhotoUrl))}">`:`<div class="photo-empty">No checkout photo</div>`;
  const returnPhoto=r.returnPhotoUrl?`<img src="${esc(displayImageUrl(r.returnPhotoUrl))}">`:`<div class="photo-empty">No return photo</div>`;
  const steps=[
    {title:"Rental Created",date:r.createdAt||r.startAt,done:true},
    {title:"Equipment Picked Up",date:r.startAt,done:!!r.startAt},
    {title:r.contractSigned?"Contract Signed":"Contract Unsigned",date:contract?.signedAt,done:!!r.contractSigned,warning:!r.contractSigned},
    {title:r.actualReturnAt?"Equipment Returned":"Awaiting Return",date:r.actualReturnAt,done:!!r.actualReturnAt,warning:overdue},
    {title:r.actualReturnAt?"Receipt Ready":"Receipt Pending",date:r.actualReturnAt,done:!!r.actualReturnAt}
  ];
  $("rentalDetail").innerHTML=`<div class="panel">
    <div class="rental-detail-header"><div><h2>${esc(rentalNumber(r))}</h2><p class="muted">${esc(r.customerName||"")} · ${esc(r.equipmentName||"")}</p><span class="badge ${statusClass}">${status}</span></div>
    <div class="rental-detail-actions"><button class="secondary" id="backToRentals">← Back</button><button class="secondary" data-action="edit-rental" data-id="${r.id}">Edit</button><button data-action="contract" data-id="${r.id}">${r.contractSigned?"View Contract":"Complete Contract"}</button>${!r.actualReturnAt?`<button data-action="return" data-id="${r.id}">Return</button>`:""}${r.actualReturnAt?`<button data-action="receipt" data-id="${r.id}">Print Receipt</button>`:""}<button class="danger" id="deleteRentalRecord">Delete Rental</button></div></div>
    <div class="rental-detail-grid">
      <div class="rental-detail-card"><span>Customer</span><strong>${esc(r.customerName||"")}</strong></div>
      <div class="rental-detail-card"><span>Equipment</span><strong>${esc(r.equipmentName||"")}</strong></div>
      <div class="rental-detail-card"><span>Rental Amount</span><strong>${money(r.rentalAmount)}</strong></div>
      <div class="rental-detail-card"><span>Deposit</span><strong>${money(r.depositAmount)}</strong></div>
      <div class="rental-detail-card"><span>Date Out</span><strong>${fmt(r.startAt)}</strong></div>
      <div class="rental-detail-card"><span>Due Back</span><strong>${fmt(r.dueAt)}</strong></div>
      <div class="rental-detail-card"><span>Returned</span><strong>${fmt(r.actualReturnAt)}</strong></div>
      <div class="rental-detail-card"><span>Paid</span><strong>${r.paid?"Yes":"No"}</strong></div>
    </div>
    <div class="rental-sections">
      <section class="rental-section"><h3>Customer Information</h3><div class="contract-grid"><div><span>Phone</span><strong>${esc(r.phone||customer.phone||"—")}</strong></div><div><span>Address</span><strong>${esc(r.address||customer.address||"—")}</strong></div><div><span>Driver License</span><strong>${esc(r.driverLicense||customer.driverLicense||"—")}</strong></div><div><span>License Plate</span><strong>${esc(r.licensePlate||customer.licensePlate||"—")}</strong></div></div></section>
      <section class="rental-section"><h3>Equipment Information</h3><div class="contract-grid"><div><span>Equipment</span><strong>${esc(r.equipmentName||"")}</strong></div><div><span>Serial Number</span><strong>${esc(equipment.serialNumber||"—")}</strong></div><div><span>Rate Type</span><strong>${esc(r.rateType||"—")}</strong></div><div><span>Contract</span><strong>${r.contractSigned?(r.contractStatus||"Signed"):"Unsigned"}</strong></div></div></section>
      <section class="rental-section full"><h3>Rental Timeline</h3><div class="rental-timeline">${steps.map(s=>`<div class="rental-step ${s.done?"done":""} ${s.warning?"warning":""}"><strong>${esc(s.title)}</strong><span>${fmt(s.date)}</span></div>`).join("")}</div></section>
      <section class="rental-section"><h3>Checkout</h3><div class="contract-grid"><div><span>Condition Out</span><strong>${esc(r.checkoutCondition||"—")}</strong></div><div><span>Fuel Out</span><strong>${esc(r.checkoutFuel||"—")}</strong></div><div><span>Contract Signed</span><strong>${r.contractSigned?"Yes":"No"}</strong></div><div><span>Notes</span><strong>${esc(r.notes||"—")}</strong></div></div></section>
      <section class="rental-section"><h3>Return</h3><div class="contract-grid"><div><span>Condition Returned</span><strong>${esc(r.returnCondition||"—")}</strong></div><div><span>Fuel Returned</span><strong>${esc(r.returnFuel||"—")}</strong></div><div><span>Deposit Returned</span><strong>${r.depositReturned?"Yes":"No"}</strong></div><div><span>Returned At</span><strong>${fmt(r.actualReturnAt)}</strong></div></div></section>
      <section class="rental-section full"><h3>Photos</h3><div class="rental-photo-grid"><div><strong>Checkout Photo</strong><div class="rental-photo">${checkoutPhoto}</div></div><div><strong>Return Photo</strong><div class="rental-photo">${returnPhoto}</div></div></div></section>
    </div></div>`;
  $("backToRentals").onclick=()=>setView("rentals");
  $("deleteRentalRecord").onclick=async()=>{if(!confirm(`Delete rental ${rentalNumber(r)}? This permanently removes its revenue and history.`))return;await deleteDoc(doc(db,"rentals",r.id));for(const c of state.contracts.filter(c=>c.rentalId===r.id))await deleteDoc(doc(db,"contracts",c.id));setView("rentals");toast("Rental deleted")};
  setView("rentalDetail");
}
function equipmentProfileView(id){
  const e=state.equipment.find(x=>x.id===id);if(!e)return;
  const rentals=state.rentals.filter(r=>r.equipmentId===id),maint=state.maintenance.filter(m=>m.equipmentId===id),res=state.reservations.filter(r=>r.equipmentId===id&&r.status==="Reserved");
  const revenue=rentals.reduce((s,r)=>s+Number(r.rentalAmount||0),0),mc=maint.reduce((s,m)=>s+Number(m.cost||0),0),cost=Number(e.purchaseCost||0);
  const photo=e.photoUrl?`<img src="${esc(displayImageUrl(e.photoUrl))}">`:`<div class="photo-empty">No photo</div>`;
  const events=[];
  rentals.forEach(r=>{events.push({d:r.startAt,t:"Rental started",x:`${r.customerName} — ${money(r.rentalAmount)}`});if(r.actualReturnAt)events.push({d:r.actualReturnAt,t:"Rental returned",x:r.returnCondition||"Returned"})});
  maint.forEach(m=>events.push({d:m.date||m.createdAt,t:`Maintenance: ${m.type||"Service"}`,x:`${m.status||""} ${money(m.cost||0)}`}));
  res.forEach(r=>events.push({d:r.startAt,t:"Reservation",x:`${r.customerName} through ${fmt(r.endAt)}`}));
  events.sort((a,b)=>new Date(b.d?.toDate?b.d.toDate():b.d||0)-new Date(a.d?.toDate?a.d.toDate():a.d||0));
  $("equipmentProfile").innerHTML=`<div class="panel"><div class="panel-head"><div><h2>${esc(e.name)}</h2><p class="muted">${esc(e.category||"")}</p></div><div class="button-row"><button data-action="rent" data-id="${e.id}">Rent</button><button class="secondary" data-action="reserve" data-id="${e.id}">Reserve</button><button class="secondary" data-action="edit-equipment" data-id="${e.id}">Edit</button><button class="secondary" data-action="equipment-qr" data-id="${e.id}">QR Code</button></div></div><div class="profile-hero"><div class="profile-photo">${photo}</div><div class="profile-summary"><div class="profile-stat"><span>Status</span><strong>${activeRental(e.id)?"Rented Out":e.status||"Available"}</strong></div><div class="profile-stat"><span>Purchase Cost</span><strong>${money(cost)}</strong></div><div class="profile-stat"><span>Revenue</span><strong>${money(revenue)}</strong></div><div class="profile-stat"><span>Profit</span><strong>${money(revenue-cost-mc)}</strong></div><div class="profile-stat"><span>Rentals</span><strong>${rentals.length}</strong></div><div class="profile-stat"><span>Maintenance</span><strong>${money(mc)}</strong></div><div class="profile-stat"><span>Serial Number</span><strong>${esc(e.serialNumber||"—")}</strong></div><div class="profile-stat"><span>Reservations</span><strong>${res.length}</strong></div></div></div><h3>Equipment Timeline</h3><div class="timeline">${events.length?events.map(ev=>`<div class="timeline-item"><strong>${esc(ev.t)}</strong><div class="muted">${fmt(ev.d)}</div><p>${esc(ev.x||"")}</p></div>`).join(""):'<p class="muted">No activity yet.</p>'}</div></div>`;
  setView("equipmentProfile");
}

function customerProfileView(id){
  const c=state.customers.find(x=>x.id===id);if(!c)return;
  const rentals=state.rentals.filter(r=>r.customerId===id||r.customerName===c.name),res=state.reservations.filter(r=>r.customerId===id||r.customerName===c.name);
  const spent=rentals.reduce((s,r)=>s+Number(r.rentalAmount||0),0),late=rentals.filter(r=>r.actualReturnAt&&r.dueAt&&new Date(r.actualReturnAt)>new Date(r.dueAt)).length;
  $("customerProfile").innerHTML=`<div class="panel"><div class="panel-head"><div><h2>${esc(c.name)}</h2><p class="muted">${esc(c.phone||"")} · ${esc(c.address||"")}</p></div><button class="secondary" data-action="edit-customer" data-id="${c.id}">Edit</button></div><div class="profile-summary"><div class="profile-stat"><span>Lifetime Rentals</span><strong>${rentals.length}</strong></div><div class="profile-stat"><span>Lifetime Spending</span><strong>${money(spent)}</strong></div><div class="profile-stat"><span>Reservations</span><strong>${res.length}</strong></div><div class="profile-stat"><span>Late Returns</span><strong>${late}</strong></div></div><div class="panel" style="margin-top:16px"><h3>Customer Information</h3><div class="contract-grid"><div><span>Phone</span><strong>${esc(c.phone||"—")}</strong></div><div><span>Email</span><strong>${esc(c.email||"—")}</strong></div><div><span>Driver License</span><strong>${esc(c.driverLicense||"—")}</strong></div><div><span>License Plate</span><strong>${esc(c.licensePlate||"—")}</strong></div><div><span>Address</span><strong>${esc(c.address||"—")}</strong></div><div><span>Notes</span><strong>${esc(c.notes||"—")}</strong></div></div></div><div class="panel" style="margin-top:16px"><h3>Rental History</h3>${rentals.length?`<table><thead><tr><th>Equipment</th><th>Out</th><th>Returned</th><th>Amount</th><th></th></tr></thead><tbody>${rentals.map(r=>`<tr><td>${esc(r.equipmentName)}</td><td>${fmt(r.startAt)}</td><td>${fmt(r.actualReturnAt)}</td><td>${money(r.rentalAmount)}</td><td><button class="secondary" data-action="contract" data-id="${r.id}">Contract</button></td></tr>`).join("")}</tbody></table>`:'<p class="muted">No rentals yet.</p>'}</div></div>`;
  setView("customerProfile");
}

let signaturePadState={};
function setupSignaturePad(){
  const canvas=$("signaturePad");if(!canvas)return;
  const rect=canvas.getBoundingClientRect();canvas.width=Math.max(700,Math.round(rect.width*2));canvas.height=360;
  const ctx=canvas.getContext("2d"),sx=canvas.width/rect.width,sy=canvas.height/rect.height;ctx.lineWidth=2.2*sx;ctx.lineCap="round";ctx.strokeStyle="#111827";
  let drawing=false,last=null;
  const point=e=>{const r=canvas.getBoundingClientRect(),s=e.touches?e.touches[0]:e;return{x:(s.clientX-r.left)*sx,y:(s.clientY-r.top)*sy}};
  const start=e=>{e.preventDefault();drawing=true;last=point(e)},move=e=>{if(!drawing)return;e.preventDefault();const p=point(e);ctx.beginPath();ctx.moveTo(last.x,last.y);ctx.lineTo(p.x,p.y);ctx.stroke();last=p},end=e=>{if(e)e.preventDefault();drawing=false};
  canvas.addEventListener("mousedown",start);canvas.addEventListener("mousemove",move);window.addEventListener("mouseup",end);canvas.addEventListener("touchstart",start,{passive:false});canvas.addEventListener("touchmove",move,{passive:false});canvas.addEventListener("touchend",end,{passive:false});
  signaturePadState={canvas,ctx};const clearButton=$("clearSignature")||$("clearCheckoutSignature");
  if(clearButton)clearButton.onclick=()=>ctx.clearRect(0,0,canvas.width,canvas.height);
}

function openContractBuilder(r){
  const customer=state.customers.find(c=>c.id===r.customerId)||{},equipment=state.equipment.find(e=>e.id===r.equipmentId)||{},existing=contractForRental(r);
  openModal(`Contract - ${rentalNumber(r)}`,`<div class="contract-document print-area"><h1>${esc(appSetting("businessName","McGriff's Farm, Home & Rental"))}</h1><h2>Equipment Rental Agreement</h2><p style="text-align:center"><strong>${esc(rentalNumber(r))}</strong></p><div class="contract-section"><h3>Customer & Equipment</h3><div class="contract-grid"><div><span>Customer</span><strong>${esc(r.customerName||"")}</strong></div><div><span>Phone</span><strong>${esc(r.phone||customer.phone||"")}</strong></div><div><span>Address</span><strong>${esc(r.address||customer.address||"")}</strong></div><div><span>Driver License</span><strong>${esc(r.driverLicense||customer.driverLicense||"")}</strong></div><div><span>Equipment</span><strong>${esc(r.equipmentName||"")}</strong></div><div><span>Serial Number</span><strong>${esc(equipment.serialNumber||"")}</strong></div><div><span>Date Out</span><strong>${fmt(r.startAt)}</strong></div><div><span>Due Back</span><strong>${fmt(r.dueAt)}</strong></div><div><span>Rate</span><strong>${esc(r.rateType||"")} — ${money(r.rentalAmount)}</strong></div><div><span>Deposit</span><strong>${money(r.depositAmount)}</strong></div></div></div><div class="contract-section"><h3>Terms and Conditions</h3><div style="white-space:pre-wrap;line-height:1.5">${esc(existing?.contractText||appSetting("contractText",DEFAULT_CONTRACT_TEXT))}</div></div><div class="contract-section"><h3>Customer Signature</h3>${existing?.signatureDataUrl?`<img src="${existing.signatureDataUrl}" style="max-width:420px;max-height:160px">`:`<label>Typed Name</label><input id="contractSignerName" value="${esc(r.customerName||"")}"><div class="signature-wrap"><canvas id="signaturePad" class="signature-pad"></canvas></div><button class="secondary no-print" id="clearSignature">Clear Signature</button>`}<p><strong>Signed:</strong> ${existing?.signedAt?fmt(existing.signedAt):"Not signed"}</p></div><div class="contract-section document-upload no-print"><h3>Physical Signature Option</h3>${photoUploadControl("signedContract","Upload Signed Paper Contract",existing?.signedPaperUrl||"")}</div><div class="contract-actions no-print">${existing?.signatureDataUrl?'':'<button id="saveDigitalContract">Save Digital Signature</button>'}<button id="printContract">Print Contract</button><button class="secondary" id="savePaperContract">Attach Paper Contract</button><button class="secondary" id="closeContract">Close</button></div></div>`);
  connectPhotoControl("signedContract","contract");if(!existing?.signatureDataUrl)setupSignaturePad();
  $("printContract").onclick=()=>window.print();$("closeContract").onclick=closeModal;
  if($("saveDigitalContract"))$("saveDigitalContract").onclick=async()=>{const signer=$("contractSignerName").value.trim();if(!signer)return alert("Enter the customer's typed name.");const data={rentalId:r.id,rentalNumber:rentalNumber(r),customerId:r.customerId,customerName:r.customerName,equipmentId:r.equipmentId,equipmentName:r.equipmentName,contractText:appSetting("contractText",DEFAULT_CONTRACT_TEXT),signerName:signer,signatureDataUrl:signaturePadState.canvas.toDataURL("image/png"),signedAt:new Date().toISOString(),signedPaperUrl:$("signedContractUrl").value.trim(),updatedAt:serverTimestamp()};existing?await updateDoc(doc(db,"contracts",existing.id),data):await addDoc(collection(db,"contracts"),{...data,createdAt:serverTimestamp()});await updateDoc(doc(db,"rentals",r.id),{contractSigned:true,contractStatus:"Signed Digitally",updatedAt:serverTimestamp()});closeModal();toast("Contract signed and attached")};
  $("savePaperContract").onclick=async()=>{const url=$("signedContractUrl").value.trim();if(!url)return alert("Upload the signed paper contract first.");const data={rentalId:r.id,rentalNumber:rentalNumber(r),customerId:r.customerId,customerName:r.customerName,equipmentId:r.equipmentId,equipmentName:r.equipmentName,contractText:appSetting("contractText",DEFAULT_CONTRACT_TEXT),signedPaperUrl:url,signedAt:new Date().toISOString(),updatedAt:serverTimestamp()};existing?await updateDoc(doc(db,"contracts",existing.id),data):await addDoc(collection(db,"contracts"),{...data,createdAt:serverTimestamp()});await updateDoc(doc(db,"rentals",r.id),{contractSigned:true,contractStatus:"Signed Paper Uploaded",signedContractUrl:url,updatedAt:serverTimestamp()});closeModal();toast("Signed paper contract attached")};
}

function renderCalendarV5(){
  const grid=$("calendarGrid");if(!grid)return;
  const now=new Date(),year=now.getFullYear(),month=now.getMonth(),first=new Date(year,month,1),start=new Date(year,month,1-first.getDay()),cells=[];
  for(let i=0;i<42;i++){const day=new Date(start);day.setDate(start.getDate()+i);const key=day.toISOString().slice(0,10),events=[];
    state.rentals.filter(r=>String(r.startAt||"").startsWith(key)).forEach(r=>events.push(`<div class="calendar-event rental">Out: ${esc(r.equipmentName)}</div>`));
    state.rentals.filter(r=>String(r.dueAt||"").startsWith(key)&&!r.actualReturnAt).forEach(r=>events.push(`<div class="calendar-event return">Due: ${esc(r.equipmentName)}</div>`));
    state.reservations.filter(r=>r.status==="Reserved"&&String(r.startAt||"").startsWith(key)).forEach(r=>events.push(`<div class="calendar-event reservation">Reserved: ${esc(r.equipmentName)}</div>`));
    cells.push(`<div class="calendar-cell ${day.getMonth()!==month?"other-month":""}"><div class="calendar-date">${day.getDate()}</div>${events.join("")}</div>`);
  }grid.innerHTML=cells.join("");
}

function renderSettingsV5(){
  if(!$("settingsBusinessName"))return;
  $("settingsBusinessName").value=appSetting("businessName","McGriff's Farm, Home & Rental");$("settingsLocation").value=appSetting("location","New Sharon, Iowa");$("settingsPhone").value=appSetting("phone","(641) 636-3796");$("settingsReceiptFooter").value=appSetting("receiptFooter","Thank you for renting from McGriff's Farm, Home & Rental.");$("settingsDefaultDeposit").value=Number(appSetting("defaultDeposit",0));$("settingsLateFee").value=Number(appSetting("lateFee",0));$("settingsTaxRate").value=Number(appSetting("taxRate",0));if($("settingsReminderHours"))$("settingsReminderHours").value=Number(appSetting("reminderHours",3));$("settingsContractText").value=appSetting("contractText",DEFAULT_CONTRACT_TEXT);
}
async function saveSettings(fields){await setDoc(doc(db,"settings","business"),fields,{merge:true});toast("Settings saved");}
function renderCategories(){
  const select=$("categoryFilter");const old=select.value;
  const cats=[...new Set(state.equipment.map(e=>e.category).filter(Boolean))].sort();
  select.innerHTML='<option value="">All Categories</option>'+cats.map(c=>`<option>${esc(c)}</option>`).join("");
  select.value=old;
}

function filteredEquipment(){
  const q=($("equipmentSearch").value||state.search).trim().toLowerCase();
  const cat=$("categoryFilter").value;
  return state.equipment.filter(e=>(!q||[e.name,e.category,e.serialNumber,e.status].join(" ").toLowerCase().includes(q))&&(!cat||e.category===cat));
}

function equipmentCard(e){
  const active=activeRental(e.id);
  const reservation=nextReservation(e.id);
  const revenue=revenueFor(e.id), cost=Number(e.purchaseCost||0), maint=maintenanceCostFor(e.id), profit=revenue-cost-maint;
  const status=e.status==="Maintenance"?"Maintenance":active?"Rented Out":reservation?"Reserved":"Available";
  const cls=status==="Available"?"available":status==="Maintenance"?"maintenance":status==="Reserved"?"reserved":"rented";
  const photo=e.photoUrl
    ? `<img src="${esc(displayImageUrl(e.photoUrl))}" alt="${esc(e.name)}" onerror="this.style.display='none';this.parentElement.insertAdjacentHTML('afterbegin','<div class=&quot;photo-empty&quot;>Photo could not load</div>')">`
    : `<div class="photo-empty">${esc(e.name)}<br><small>No photo</small></div>`;

  return `<article class="card">
    <div class="photo">${photo}<span class="badge overlay ${cls}">${status}</span></div>
    <div class="card-body">
      <h3><button class="link-button" data-action="equipment-profile" data-id="${e.id}">${esc(e.name)}</button></h3><p class="category">${esc(e.category||"Uncategorized")}</p>
      ${active?`<div class="metrics"><strong>Rented to:</strong> ${esc(active.customerName)}<br><strong>Due:</strong> ${fmt(active.dueAt)}</div>`:""}
      ${reservation?`<div class="reservation-banner"><strong>Reserved for:</strong> ${esc(reservation.customerName)}<br><strong>Dates:</strong> ${fmt(reservation.startAt)} – ${fmt(reservation.endAt)}</div>`:""}
      <div class="metrics"><strong>Item Cost:</strong> ${money(cost)}<br><strong>Rental Revenue:</strong> ${money(revenue)}<br><strong>Maintenance:</strong> ${money(maint)}<br><strong>Profit:</strong> ${money(profit)}</div>
      <div class="rates">
        <div class="rate-row"><span>Hourly</span><strong>${money(e.hourlyRate)}</strong></div>
        <div class="rate-row"><span>Half Day</span><strong>${money(e.halfDayRate)}</strong></div>
        <div class="rate-row"><span>Daily</span><strong>${money(e.fullDayRate)}</strong></div>
        <div class="rate-row"><span>Weekly</span><strong>${money(e.weeklyRate)}</strong></div>
        <div class="rate-row"><span>Monthly</span><strong>${money(e.monthlyRate)}</strong></div>
      </div>
      <div class="button-row">
        ${active
          ? `<button data-action="return" data-id="${active.id}">Return Item</button>`
          : `<button data-action="rent" data-id="${e.id}" ${e.status==="Maintenance"?"disabled":""}>Rent This</button>`}
        ${reservation&&!active?`<button data-action="start-reservation" data-id="${reservation.id}">Start Reserved Rental</button>`:""}
        ${!active?`<button class="secondary" data-action="reserve" data-id="${e.id}">Reserve This</button>`:""}
        <button class="secondary" data-action="history" data-id="${e.id}">History</button>
        <button class="secondary" data-action="maintenance" data-id="${e.id}">Service</button>
        <button class="secondary" data-action="edit-equipment" data-id="${e.id}">Edit</button><button class="secondary" data-action="equipment-qr" data-id="${e.id}">QR Code</button>
      </div>
    </div>
  </article>`;
}

function renderEquipment(){
  const cards=filteredEquipment().map(equipmentCard).join("")||'<p style="color:#6b7280">No equipment found.</p>';
  $("equipmentCards").innerHTML=cards;
  $("equipmentTable").innerHTML=state.equipment.length?`<table><thead><tr><th>Name</th><th>Category</th><th>Status</th><th>Revenue</th><th>Profit</th><th></th></tr></thead><tbody>${state.equipment.map(e=>{const active=activeRental(e.id);const rev=revenueFor(e.id);const profit=rev-Number(e.purchaseCost||0)-maintenanceCostFor(e.id);return`<tr><td><strong>${esc(e.name)}</strong></td><td>${esc(e.category)}</td><td>${active?"Rented Out":e.status||"Available"}</td><td>${money(rev)}</td><td>${money(profit)}</td><td><button class="secondary" data-action="edit-equipment" data-id="${e.id}">Edit</button><button class="secondary" data-action="equipment-qr" data-id="${e.id}">QR Code</button></td></tr>`}).join("")}</tbody></table>`:"<p>No equipment yet.</p>";
}

function renderUpcoming(){}

function renderCustomers(){
  const q=state.search.toLowerCase();const rows=state.customers.filter(c=>!q||[c.name,c.phone,c.address,c.driverLicense,c.licensePlate].join(" ").toLowerCase().includes(q));
  $("customersTable").innerHTML=rows.length?`<table><thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>License</th><th>Plate</th><th>Address</th><th></th></tr></thead><tbody>${rows.map(c=>`<tr><td><button class="link-button" data-action="customer-profile" data-id="${c.id}"><strong>${esc(c.name)}</strong></button></td><td>${esc(c.phone)}</td><td>${esc(c.email||"")}</td><td>${esc(c.driverLicense)}</td><td>${esc(c.licensePlate)}</td><td>${esc(c.address)}</td><td><button class="secondary" data-action="edit-customer" data-id="${c.id}">Edit</button></td></tr>`).join("")}</tbody></table>`:"<p>No customers found.</p>";
}

function renderRentals(){
  const q=($("rentalsSearch")?.value||"").toLowerCase();
  const filter=$("rentalsStatusFilter")?.value||"";
  const now=new Date();
  let rows=[...state.rentals].sort((a,b)=>(b.createdAt?.seconds||new Date(b.startAt||0).getTime())-(a.createdAt?.seconds||new Date(a.startAt||0).getTime()));
  rows=rows.filter(r=>{
    const hay=`${rentalNumber(r)} ${r.customerName||""} ${r.equipmentName||""}`.toLowerCase();
    if(q&&!hay.includes(q))return false;
    const overdue=!r.actualReturnAt&&r.dueAt&&new Date(r.dueAt)<now;
    if(filter==="out"&&r.actualReturnAt)return false;
    if(filter==="overdue"&&!overdue)return false;
    if(filter==="returned"&&!r.actualReturnAt)return false;
    if(filter==="unsigned"&&r.contractSigned)return false;
    return true;
  });
  $("rentalsTable").innerHTML=rows.length?`<table><thead><tr><th>Rental #</th><th>Customer</th><th>Equipment</th><th>Out</th><th>Due</th><th>Amount</th><th>Status</th><th>Contract</th><th></th></tr></thead><tbody>${rows.map(r=>{
    const overdue=!r.actualReturnAt&&r.dueAt&&new Date(r.dueAt)<now;
    const status=r.actualReturnAt?"Returned":overdue?"Overdue":"Out";
    const cls=r.actualReturnAt?"available":overdue?"rented":"reserved";
    return `<tr><td><strong>${esc(rentalNumber(r))}</strong></td><td>${esc(r.customerName||"")}</td><td>${esc(r.equipmentName||"")}</td><td>${fmt(r.startAt)}</td><td>${fmt(r.dueAt)}</td><td>${money(r.rentalAmount)}</td><td><span class="badge ${cls}">${status}</span></td><td>${r.contractSigned?'<span class="badge available">Signed</span>':'<span class="badge maintenance">Unsigned</span>'}</td><td><div class="button-row"><button data-action="view-rental" data-id="${r.id}">View</button>${!r.actualReturnAt?`<button class="secondary" data-action="return" data-id="${r.id}">Return</button>`:""}${r.actualReturnAt?`<button class="secondary" data-action="receipt" data-id="${r.id}">Receipt</button>`:""}</div></td></tr>`;
  }).join("")}</tbody></table>`:'<p class="muted">No rentals match those filters.</p>';
}

function renderReservations(){
  const rows=[...state.reservations].sort((a,b)=>new Date(a.startAt||0)-new Date(b.startAt||0));
  $("reservationsTable").innerHTML=rows.length?`<table>
    <thead><tr><th>Equipment</th><th>Customer</th><th>Start</th><th>End</th><th>Amount</th><th>Status</th><th></th></tr></thead>
    <tbody>${rows.map(r=>`<tr>
      <td><strong>${esc(r.equipmentName)}</strong></td><td>${esc(r.customerName)}</td>
      <td>${fmt(r.startAt)}</td><td>${fmt(r.endAt)}</td><td>${money(r.expectedAmount)}</td>
      <td><span class="badge ${r.status==="Reserved"?"reserved":r.status==="Picked Up"?"available":"maintenance"}">${esc(r.status||"Reserved")}</span></td>
      <td><div class="button-row">
        ${r.status==="Reserved"?`<button data-action="start-reservation" data-id="${r.id}">Start Rental</button>`:""}
        ${r.status==="Reserved"?`<button class="secondary" data-action="edit-reservation" data-id="${r.id}">Edit</button>`:""}
        ${r.status==="Reserved"?`<button class="danger" data-action="cancel-reservation" data-id="${r.id}">Cancel</button>`:""}
      </div></td>
    </tr>`).join("")}</tbody></table>`:"<p>No reservations yet.</p>";
}

function renderMaintenance(){
  const rows=[...state.maintenance].sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
  $("maintenanceTable").innerHTML=rows.length?`<table><thead><tr><th>Equipment</th><th>Date</th><th>Type</th><th>Status</th><th>Performed By</th><th>Cost</th><th>Notes</th></tr></thead><tbody>${rows.map(m=>`<tr><td>${esc(m.equipmentName)}</td><td>${esc(m.date)}</td><td>${esc(m.type)}</td><td>${esc(m.status)}</td><td>${esc(m.performedBy)}</td><td>${money(m.cost)}</td><td>${esc(m.notes)}</td></tr>`).join("")}</tbody></table>`:"<p>No maintenance records yet.</p>";
}

function renderReports(){
  const rows=state.equipment.map(e=>{const revenue=revenueFor(e.id),maint=maintenanceCostFor(e.id),cost=Number(e.purchaseCost||0),profit=revenue-cost-maint,count=state.rentals.filter(r=>r.equipmentId===e.id).length;return{e,revenue,maint,cost,profit,count,roi:cost>0?((profit/cost)*100):0}}).sort((a,b)=>b.profit-a.profit);
  $("reportsTable").innerHTML=rows.length?`<table><thead><tr><th>Equipment</th><th>Cost</th><th>Revenue</th><th>Maintenance</th><th>Profit</th><th>Rentals</th><th>ROI</th></tr></thead><tbody>${rows.map(x=>`<tr><td><strong>${esc(x.e.name)}</strong></td><td>${money(x.cost)}</td><td>${money(x.revenue)}</td><td>${money(x.maint)}</td><td>${money(x.profit)}</td><td>${x.count}</td><td>${x.cost>0?x.roi.toFixed(0)+"%":"—"}</td></tr>`).join("")}</tbody></table>`:"<p>No equipment yet.</p>";
}

function equipmentForm(e={}){
  openModal(e.id?"Edit Equipment":"Add Equipment",`
    <div class="form-grid">
      <div><label>Equipment Name</label><input id="eqName" value="${esc(e.name||"")}"></div>
      <div><label>Category</label><input id="eqCategory" value="${esc(e.category||"")}"></div>
      <div><label>Serial Number</label><input id="eqSerial" value="${esc(e.serialNumber||"")}"></div>
      <div>${photoUploadControl("eqPhoto", "Equipment Photo", e.photoUrl || "")}</div>
      <div><label>Hourly Rate</label><input id="eqHourly" type="number" value="${Number(e.hourlyRate||0)}"></div>
      <div><label>Half-Day Rate</label><input id="eqHalf" type="number" value="${Number(e.halfDayRate||0)}"></div>
      <div><label>Full-Day Rate</label><input id="eqFull" type="number" value="${Number(e.fullDayRate||0)}"></div>
      <div><label>Weekly Rate</label><input id="eqWeekly" type="number" value="${Number(e.weeklyRate||0)}"></div>
      <div><label>Monthly Rate</label><input id="eqMonthly" type="number" value="${Number(e.monthlyRate||0)}"></div>
      <div><label>What You Paid</label><input id="eqCost" type="number" value="${Number(e.purchaseCost||0)}"></div>
      <div><label>Status</label><select id="eqStatus"><option>Available</option><option>Maintenance</option></select></div>
    </div>
    <label>Notes</label><textarea id="eqNotes">${esc(e.notes||"")}</textarea>
    <div class="button-row"><button id="saveEquipment">Save Equipment</button>${e.id?'<button id="deleteEquipment" class="danger">Delete Equipment</button>':""}</div>`);
  $("eqStatus").value=e.status||"Available";connectPhotoControl("eqPhoto","equipment");
  $("saveEquipment").onclick=async()=>{
    const data={
      name:$("eqName").value.trim(),
      category:$("eqCategory").value.trim(),
      serialNumber:$("eqSerial").value.trim(),
      photoUrl:$("eqPhotoUrl").value.trim(),
      hourlyRate:Number($("eqHourly").value||0),
      halfDayRate:Number($("eqHalf").value||0),
      fullDayRate:Number($("eqFull").value||0),
      weeklyRate:Number($("eqWeekly").value||0),
      monthlyRate:Number($("eqMonthly").value||0),
      purchaseCost:Number($("eqCost").value||0),
      status:$("eqStatus").value,
      notes:$("eqNotes").value.trim(),
      updatedAt:serverTimestamp()
    };
    if(!data.name)return alert("Equipment name is required.");

    if(e.id){
      await updateDoc(doc(db,"equipment",e.id),data);
      closeModal();
      toast("Equipment saved");
    }else{
      const created=await addDoc(collection(db,"equipment"),{...data,createdAt:serverTimestamp()});
      closeModal();
      toast("Equipment saved — QR code created");
      setTimeout(()=>showEquipmentQr({id:created.id,...data}),250);
    }
  };
  if(e.id)$("deleteEquipment").onclick=async()=>{if(activeRental(e.id))return alert("Return this item before deleting it.");if(!confirm(`Delete ${e.name}? Rental history will remain.`))return;await deleteDoc(doc(db,"equipment",e.id));closeModal();toast("Equipment deleted")};
}

function customerForm(c={}){
  openModal(c.id?"Edit Customer":"Add Customer",`
    <div class="form-grid">
      <div><label>Name</label><input id="cName" value="${esc(c.name||"")}"></div>
      <div><label>Phone</label><input id="cPhone" value="${esc(c.phone||"")}"></div>
      <div><label>Email</label><input id="cEmail" type="email" value="${esc(c.email||"")}"></div>
      <div><label>Driver License</label><input id="cLicense" value="${esc(c.driverLicense||"")}"></div>
      <div><label>License Plate</label><input id="cPlate" value="${esc(c.licensePlate||"")}"></div>
    </div>
    <label>Address</label><input id="cAddress" value="${esc(c.address||"")}">
    <div class="checkline">
      <input id="cEmailConsent" type="checkbox" ${c.emailConsent===false?"":"checked"}>
      <label>Customer agrees to receive contracts, receipts, and rental reminders by email</label>
    </div>
    <label>Notes</label><textarea id="cNotes">${esc(c.notes||"")}</textarea>
    <button id="saveCustomer">Save Customer</button>
  `);

  $("saveCustomer").onclick=async()=>{
    const email=$("cEmail").value.trim();
    if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return alert("Enter a valid email address.");

    const data={
      name:$("cName").value.trim(),
      phone:$("cPhone").value.trim(),
      email,
      emailConsent:$("cEmailConsent").checked,
      driverLicense:$("cLicense").value.trim(),
      licensePlate:$("cPlate").value.trim(),
      address:$("cAddress").value.trim(),
      notes:$("cNotes").value.trim(),
      updatedAt:serverTimestamp()
    };

    if(!data.name)return alert("Customer name is required.");
    c.id
      ? await updateDoc(doc(db,"customers",c.id),data)
      : await addDoc(collection(db,"customers"),{...data,createdAt:serverTimestamp()});

    closeModal();
    toast("Customer saved");
  };
}


function reservationForm(equipment=null,reservation={}){
  const chosenEquipment=equipment||state.equipment.find(e=>e.id===reservation.equipmentId)||state.equipment[0];
  openModal(reservation.id?"Edit Reservation":"New Reservation",`
    <label>Equipment</label>
    <select id="resEquipment">${state.equipment.map(e=>`<option value="${e.id}">${esc(e.name)}</option>`).join("")}</select>
    <label>Existing Customer</label>
    <select id="resCustomer"><option value="">Choose or enter new customer</option>${state.customers.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select>
    <div class="form-grid">
      <div><label>Customer Name</label><input id="resName" value="${esc(reservation.customerName||"")}"></div>
      <div><label>Phone</label><input id="resPhone" value="${esc(reservation.phone||"")}"></div>
      <div><label>Start Date/Time</label><input id="resStart" type="datetime-local" value="${esc(reservation.startAt||"")}"></div>
      <div><label>End Date/Time</label><input id="resEnd" type="datetime-local" value="${esc(reservation.endAt||"")}"></div>
      <div><label>Rate Type</label><select id="resRate"><option>Hourly</option><option>Half Day</option><option>Full Day</option><option>Weekly</option><option>Monthly</option></select></div>
      <div><label>Expected Amount</label><input id="resAmount" type="number" value="${Number(reservation.expectedAmount||0)}"></div>
      <div><label>Deposit Taken</label><input id="resDeposit" type="number" value="${Number(reservation.depositAmount||0)}"></div>
    </div>
    <label>Notes</label><textarea id="resNotes">${esc(reservation.notes||"")}</textarea>
    <button id="saveReservation">Save Reservation</button>
  `);

  if(chosenEquipment)$("resEquipment").value=chosenEquipment.id;
  if(reservation.customerId)$("resCustomer").value=reservation.customerId;
  $("resRate").value=reservation.rateType||"Full Day";

  const fillCustomer=()=>{const c=state.customers.find(x=>x.id===$("resCustomer").value);if(!c)return;$("resName").value=c.name||"";$("resPhone").value=c.phone||""};
  $("resCustomer").onchange=fillCustomer;

  const fillAmount=()=>{const e=state.equipment.find(x=>x.id===$("resEquipment").value);if(!e)return;const map={Hourly:e.hourlyRate,"Half Day":e.halfDayRate,"Full Day":e.fullDayRate,Weekly:e.weeklyRate,Monthly:e.monthlyRate};if(!reservation.id||!Number($("resAmount").value))$("resAmount").value=Number(map[$("resRate").value]||0)};
  $("resRate").onchange=fillAmount;$("resEquipment").onchange=fillAmount;fillAmount();

  $("saveReservation").onclick=async()=>{
    const equipmentId=$("resEquipment").value;
    const e=state.equipment.find(x=>x.id===equipmentId);
    const startAt=$("resStart").value,endAt=$("resEnd").value;
    const customerName=$("resName").value.trim();
    if(!equipmentId||!customerName||!startAt||!endAt)return alert("Equipment, customer, start, and end are required.");
    if(new Date(endAt)<=new Date(startAt))return alert("Reservation end must be after the start.");

    const conflict=state.reservations.find(r =>
      r.id!==reservation.id && r.equipmentId===equipmentId && r.status==="Reserved" &&
      rangesOverlap(startAt,endAt,r.startAt,r.endAt)
    );
    if(conflict)return alert(`This item is already reserved for ${conflict.customerName} during those dates.`);

    const currentRental=activeRental(equipmentId);
    if(currentRental && rangesOverlap(startAt,endAt,currentRental.startAt,currentRental.dueAt||"2999-12-31T23:59")){
      return alert("This item is currently rented during part of that reservation.");
    }

    let customerId=$("resCustomer").value;
    if(!customerId){
      const created=await addDoc(collection(db,"customers"),{
        name:customerName,phone:$("resPhone").value.trim(),
        createdAt:serverTimestamp(),updatedAt:serverTimestamp()
      });
      customerId=created.id;
    }

    const data={
      equipmentId,equipmentName:e.name,customerId,customerName,
      phone:$("resPhone").value.trim(),startAt,endAt,
      rateType:$("resRate").value,expectedAmount:Number($("resAmount").value||0),
      depositAmount:Number($("resDeposit").value||0),notes:$("resNotes").value.trim(),
      status:reservation.status||"Reserved",updatedAt:serverTimestamp()
    };

    reservation.id
      ? await updateDoc(doc(db,"reservations",reservation.id),data)
      : await addDoc(collection(db,"reservations"),{...data,createdAt:serverTimestamp()});

    closeModal();toast("Reservation saved");
  };
}

async function cancelReservation(reservation){
  if(!confirm(`Cancel the reservation for ${reservation.customerName}?`))return;
  await updateDoc(doc(db,"reservations",reservation.id),{
    status:"Cancelled",cancelledAt:serverTimestamp(),updatedAt:serverTimestamp()
  });
  toast("Reservation cancelled");
}



let pendingCheckoutDraft = null;
let pendingPreInspection = null;

function inspectionChecklistHtml(prefix, values={}){
  const checks=[["tires","Tires / Wheels"],["fluids","Fluids / Leaks"],["engine","Engine Starts / Runs"],["controls","Controls Operate Properly"],["guards","Guards / Safety Shields"],["lights","Lights / Indicators"],["accessories","Accessories Included"],["clean","Cleanliness"],["fuel","Fuel Level Recorded"],["hours","Hour Meter Recorded"]];
  return `<div class="inspection-checklist">${checks.map(([key,label])=>`<label class="inspection-check"><input type="checkbox" id="${prefix}_${key}" ${values[key]?"checked":""}><span>${label}</span></label>`).join("")}</div>`;
}

function collectInspection(prefix){
  const keys=["tires","fluids","engine","controls","guards","lights","accessories","clean","fuel","hours"],checklist={};
  keys.forEach(key=>checklist[key]=!!$(`${prefix}_${key}`)?.checked);
  return {checklist,condition:$(`${prefix}Condition`)?.value.trim()||"",fuel:$(`${prefix}Fuel`)?.value.trim()||"",hours:$(`${prefix}Hours`)?.value.trim()||"",notes:$(`${prefix}Notes`)?.value.trim()||"",photoUrl:$(`${prefix}PhotoUrl`)?.value.trim()||"",damageFound:!!$(`${prefix}DamageFound`)?.checked};
}

function preInspectionForm(e,reservation=null,existing={},rentalDraft=null){
  openModal(`Pre-Rental Inspection - ${e.name}`,`
    <div class="checkout-progress"><div class="checkout-step active"><strong>1</strong><span>Pre-Inspection</span></div><div class="checkout-step"><strong>2</strong><span>Rental Details</span></div><div class="checkout-step"><strong>3</strong><span>Contract & Signature</span></div><div class="checkout-step"><strong>4</strong><span>Print Packet</span></div></div>
    <div class="inspection-header"><div><h3>${esc(e.name)}</h3><p class="muted">Inspect the equipment with the customer before it leaves.</p></div><span class="badge available">Pre-Rental</span></div>
    <h3>Inspection Checklist</h3>${inspectionChecklistHtml("pre",existing.checklist||{})}
    <div class="form-grid"><div><label>Overall Condition</label><input id="preCondition" value="${esc(existing.condition||"")}"></div><div><label>Fuel Level</label><input id="preFuel" value="${esc(existing.fuel||"")}"></div><div><label>Hour Meter</label><input id="preHours" value="${esc(existing.hours||"")}"></div><div><label>Any Existing Damage?</label><div class="checkline"><input id="preDamageFound" type="checkbox" ${existing.damageFound?"checked":""}><label>Yes, damage or wear is present</label></div></div></div>
    ${photoUploadControl("prePhoto","Pre-Inspection Photo",existing.photoUrl||"")}
    <label>Pre-Inspection Notes / Existing Damage</label><textarea id="preNotes" placeholder="Document scratches, dents, worn parts, or anything already present.">${esc(existing.notes||"")}</textarea>
    <div class="inspection-notice">The customer and employee should review this inspection together before the rental begins.</div>
    <div class="button-row"><button id="continueToRentalDetails">Next: Rental Details →</button><button class="secondary" id="cancelPreInspection">Cancel</button></div>`);
  connectPhotoControl("prePhoto","pre-inspection");
  $("cancelPreInspection").onclick=closeModal;
  $("continueToRentalDetails").onclick=()=>{pendingPreInspection=collectInspection("pre");rentalDetailsForm(e,reservation,rentalDraft,pendingPreInspection)};
}

function rentForm(e,reservation=null){pendingPreInspection=null;pendingCheckoutDraft=null;preInspectionForm(e,reservation)}

function collectRentalDraft(e,reservation=null,preInspection=null){
  const customerName=$("rName").value.trim();if(!customerName)throw new Error("Customer name is required.");if(!$("rStart").value)throw new Error("Date and time taken are required.");if(!$("rDue").value)throw new Error("Due-back date and time are required.");
  return {equipment:e,reservation,preInspection:preInspection||pendingPreInspection||{},customerId:$("rCustomer").value,customerName,phone:$("rPhone").value.trim(),driverLicense:$("rLicense").value.trim(),licensePlate:$("rPlate").value.trim(),address:$("rAddress").value.trim(),startAt:$("rStart").value,dueAt:$("rDue").value,rateType:$("rRate").value,rentalAmount:Number($("rAmount").value||0),depositAmount:Number($("rDeposit").value||0),paid:$("rPaid").checked,notes:$("rNotes").value.trim()};
}

function rentalDetailsForm(e,reservation=null,draft=null,preInspection=null){
  const d=draft||{},pre=preInspection||d.preInspection||pendingPreInspection||{};
  openModal(`Rental Details - ${e.name}`,`
    <div class="checkout-progress"><div class="checkout-step done"><strong>✓</strong><span>Pre-Inspection</span></div><div class="checkout-step active"><strong>2</strong><span>Rental Details</span></div><div class="checkout-step"><strong>3</strong><span>Contract & Signature</span></div><div class="checkout-step"><strong>4</strong><span>Print Packet</span></div></div>
    <div class="inspection-summary"><strong>Pre-Inspection Saved</strong><span>${esc(pre.condition||"No condition entered")} · Fuel: ${esc(pre.fuel||"Not entered")} · Hours: ${esc(pre.hours||"Not entered")}</span><button class="secondary" id="editPreInspection">Edit Inspection</button></div>
    <label>Existing Customer</label><select id="rCustomer"><option value="">Choose or enter new customer</option>${state.customers.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select>
    <div class="form-grid"><div><label>Customer Name</label><input id="rName" value="${esc(d.customerName||reservation?.customerName||"")}"></div><div><label>Phone</label><input id="rPhone" value="${esc(d.phone||reservation?.phone||"")}"></div><div><label>Email</label><input id="rEmail" type="email" value="${esc(d.email||reservation?.email||"")}"></div><div><label>Driver License</label><input id="rLicense" value="${esc(d.driverLicense||"")}"></div><div><label>License Plate</label><input id="rPlate" value="${esc(d.licensePlate||"")}"></div></div>
    <label>Address</label><input id="rAddress" value="${esc(d.address||"")}">
    <div class="form-grid"><div><label>Date/Time Taken</label><input id="rStart" type="datetime-local" value="${esc(d.startAt||reservation?.startAt||nowLocal())}"></div><div><label>Due Back</label><input id="rDue" type="datetime-local" value="${esc(d.dueAt||reservation?.endAt||"")}"></div><div><label>Rate Type</label><select id="rRate"><option>Hourly</option><option>Half Day</option><option>Full Day</option><option>Weekly</option><option>Monthly</option></select></div><div><label>Rental Amount</label><input id="rAmount" type="number" value="${Number(d.rentalAmount??reservation?.expectedAmount??0)}"></div><div><label>Deposit Amount</label><input id="rDeposit" type="number" value="${Number(d.depositAmount??reservation?.depositAmount??appSetting("defaultDeposit",0))}"></div></div>
    <div class="checkline"><input id="rPaid" type="checkbox" ${d.paid?"checked":""}><label>Paid</label></div><label>Rental Notes</label><textarea id="rNotes">${esc(d.notes||reservation?.notes||"")}</textarea>
    <div class="button-row"><button id="reviewContractButton">Next: Contract & Sign →</button><button class="secondary" id="saveRentalWithoutContract">Save Without Signed Contract</button></div>`);
  if(d.customerId||reservation?.customerId)$("rCustomer").value=d.customerId||reservation.customerId;$("rRate").value=d.rateType||reservation?.rateType||"Hourly";
  const fillRate=()=>{const map={Hourly:e.hourlyRate,"Half Day":e.halfDayRate,"Full Day":e.fullDayRate,Weekly:e.weeklyRate,Monthly:e.monthlyRate};if(!draft&&!reservation?.expectedAmount)$("rAmount").value=Number(map[$("rRate").value]||0)};if(!draft)fillRate();$("rRate").onchange=fillRate;
  $("rCustomer").onchange=()=>{const c=state.customers.find(x=>x.id===$("rCustomer").value);if(!c)return;$("rName").value=c.name||"";$("rPhone").value=c.phone||"";$("rEmail").value=c.email||"";$("rLicense").value=c.driverLicense||"";$("rPlate").value=c.licensePlate||"";$("rAddress").value=c.address||""};
  $("editPreInspection").onclick=()=>{let current;try{current=collectRentalDraft(e,reservation,pre)}catch(_){current={equipment:e,reservation,preInspection:pre}};preInspectionForm(e,reservation,pre,current)};
  $("reviewContractButton").onclick=()=>{try{pendingCheckoutDraft=collectRentalDraft(e,reservation,pre);openCheckoutContractReview(pendingCheckoutDraft)}catch(error){alert(error.message)}};
  $("saveRentalWithoutContract").onclick=async()=>{try{const rentalDraft=collectRentalDraft(e,reservation,pre);if(!confirm("Save this rental without a signed contract?"))return;const saved=await saveCheckoutRental(rentalDraft,false);closeModal();toast("Rental saved without signed contract");rentalDetailView(saved.id)}catch(error){alert(error.message||String(error))}};
}

function checkoutContractDocument(draft,signatureDataUrl="",signedAt=""){
  const contractText=appSetting("contractText",DEFAULT_CONTRACT_TEXT),pre=draft.preInspection||{};
  return `<div class="contract-document"><h1>${esc(appSetting("businessName","McGriff's Farm, Home & Rental"))}</h1><h2>Equipment Rental Agreement</h2><p style="text-align:center">${esc(appSetting("location","New Sharon, Iowa"))} · ${esc(appSetting("phone","(641) 636-3796"))}</p>
  <div class="contract-section"><h3>Customer and Rental Information</h3><div class="contract-grid"><div><span>Customer</span><strong>${esc(draft.customerName)}</strong></div><div><span>Phone</span><strong>${esc(draft.phone||"—")}</strong></div><div><span>Email</span><strong>${esc(draft.email||"—")}</strong></div><div><span>Address</span><strong>${esc(draft.address||"—")}</strong></div><div><span>Driver License</span><strong>${esc(draft.driverLicense||"—")}</strong></div><div><span>License Plate</span><strong>${esc(draft.licensePlate||"—")}</strong></div><div><span>Equipment</span><strong>${esc(draft.equipment.name)}</strong></div><div><span>Serial Number</span><strong>${esc(draft.equipment.serialNumber||"—")}</strong></div><div><span>Date Out</span><strong>${fmt(draft.startAt)}</strong></div><div><span>Due Back</span><strong>${fmt(draft.dueAt)}</strong></div><div><span>Rental Rate</span><strong>${esc(draft.rateType)} — ${money(draft.rentalAmount)}</strong></div><div><span>Deposit</span><strong>${money(draft.depositAmount)}</strong></div><div><span>Paid</span><strong>${draft.paid?"Yes":"No"}</strong></div></div></div>
  <div class="contract-section"><h3>Pre-Rental Inspection</h3><div class="contract-grid"><div><span>Condition</span><strong>${esc(pre.condition||"Not entered")}</strong></div><div><span>Fuel</span><strong>${esc(pre.fuel||"Not entered")}</strong></div><div><span>Hours</span><strong>${esc(pre.hours||"Not entered")}</strong></div><div><span>Existing Damage</span><strong>${pre.damageFound?"Yes":"No"}</strong></div><div><span>Inspection Photo</span><strong>${pre.photoUrl?"Attached":"Not attached"}</strong></div><div><span>Notes</span><strong>${esc(pre.notes||"None")}</strong></div></div></div>
  <div class="contract-section"><h3>Terms and Conditions</h3><div class="contract-terms">${esc(contractText)}</div></div><div class="contract-section"><h3>Customer Acknowledgment</h3><p>By signing below, the customer confirms that the equipment inspection and agreement were reviewed and accepts the rental terms.</p>${signatureDataUrl?`<div class="saved-signature"><img src="${signatureDataUrl}"></div><p><strong>Signed by:</strong> ${esc(draft.customerName)} &nbsp; <strong>Date:</strong> ${fmt(signedAt)}</p>`:""}</div></div>`;
}

function openCheckoutContractReview(draft){
  openModal("Review Contract & Customer Signature",`<div class="checkout-progress"><div class="checkout-step done"><strong>✓</strong><span>Pre-Inspection</span></div><div class="checkout-step done"><strong>✓</strong><span>Rental Details</span></div><div class="checkout-step active"><strong>3</strong><span>Contract & Signature</span></div><div class="checkout-step"><strong>4</strong><span>Print Packet</span></div></div>${checkoutContractDocument(draft)}<div class="signature-panel no-print"><h3>Customer Signature</h3><label>Customer’s Typed Name</label><input id="checkoutSignerName" value="${esc(draft.customerName)}"><div class="signature-wrap"><canvas id="signaturePad" class="signature-pad"></canvas></div><div class="button-row" style="margin-top:10px"><button class="secondary" id="clearCheckoutSignature">Clear Signature</button></div></div><div class="contract-actions no-print"><button class="secondary" id="backToRentalForm">← Back to Rental Details</button><button id="saveRentalAndContract">Save Rental & Signed Contract</button></div>`);
  setupSignaturePad();$("backToRentalForm").onclick=()=>rentalDetailsForm(draft.equipment,draft.reservation,draft,draft.preInspection);
  $("saveRentalAndContract").onclick=async()=>{const button=$("saveRentalAndContract"),originalText=button.textContent;try{const signerName=$("checkoutSignerName").value.trim();if(!signerName)return alert("Enter the customer's typed name.");if(!signaturePadState.canvas)return alert("The signature pad did not initialize.");if(isSignatureCanvasBlank(signaturePadState.canvas))return alert("Please have the customer sign.");button.disabled=true;button.textContent="Saving Rental & Contract...";const signatureDataUrl=signaturePadState.canvas.toDataURL("image/png"),signedAt=new Date().toISOString(),saved=await saveCheckoutRental(draft,true,{signerName,signatureDataUrl,signedAt});showCheckoutPrintPacket(saved.rental,saved.contract)}catch(error){console.error(error);alert("The rental could not be saved: "+(error?.message||String(error)));button.disabled=false;button.textContent=originalText}};
}

function isSignatureCanvasBlank(canvas){const blank=document.createElement("canvas");blank.width=canvas.width;blank.height=canvas.height;return canvas.toDataURL()===blank.toDataURL()}
async function ensureCheckoutCustomer(draft){if(draft.customerId)return draft.customerId;const created=await addDoc(collection(db,"customers"),{name:draft.customerName,phone:draft.phone,email:draft.email,emailConsent:true,driverLicense:draft.driverLicense,licensePlate:draft.licensePlate,address:draft.address,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});return created.id}

async function saveCheckoutRental(draft,contractSigned,signature=null){
  const customerId=await ensureCheckoutCustomer(draft),pre=draft.preInspection||{};
  const rentalData={equipmentId:draft.equipment.id,equipmentName:draft.equipment.name,customerId,customerName:draft.customerName,phone:draft.phone,email:draft.email,driverLicense:draft.driverLicense,licensePlate:draft.licensePlate,address:draft.address,startAt:draft.startAt,dueAt:draft.dueAt,actualReturnAt:"",rateType:draft.rateType,rentalAmount:draft.rentalAmount,depositAmount:draft.depositAmount,depositReturned:false,contractSigned,contractStatus:contractSigned?"Signed at Checkout":"Unsigned",paid:draft.paid,checkoutPhotoUrl:pre.photoUrl||"",returnPhotoUrl:"",checkoutCondition:pre.condition||"",returnCondition:"",checkoutFuel:pre.fuel||"",returnFuel:"",checkoutHours:pre.hours||"",returnHours:"",preInspectionChecklist:pre.checklist||{},preInspectionNotes:pre.notes||"",preInspectionDamageFound:!!pre.damageFound,customerTrained:true,notes:draft.notes,reservationId:draft.reservation?.id||"",createdAt:serverTimestamp(),updatedAt:serverTimestamp()};
  const rentalDoc=await addDoc(collection(db,"rentals"),rentalData),rental={id:rentalDoc.id,...rentalData};let contract=null;
  if(contractSigned&&signature){contract={rentalId:rentalDoc.id,rentalNumber:rentalNumber(rental),customerId,customerName:draft.customerName,equipmentId:draft.equipment.id,equipmentName:draft.equipment.name,contractText:appSetting("contractText",DEFAULT_CONTRACT_TEXT),signerName:signature.signerName,signatureDataUrl:signature.signatureDataUrl,signedAt:signature.signedAt,signedPaperUrl:"",createdAt:serverTimestamp(),updatedAt:serverTimestamp()};const contractDoc=await addDoc(collection(db,"contracts"),contract);contract={id:contractDoc.id,...contract}}
  if(draft.reservation?.id)await updateDoc(doc(db,"reservations",draft.reservation.id),{status:"Picked Up",linkedRentalId:rentalDoc.id,pickedUpAt:serverTimestamp(),updatedAt:serverTimestamp()});return contractSigned?{rental,contract}:{id:rentalDoc.id,rental,contract:null};
}

function checkoutReceiptHtml(r){return `<div class="receipt-shell"><div class="receipt-header"><h2>${esc(appSetting("businessName","McGriff's Farm, Home & Rental"))}</h2><p>Rental Checkout Receipt</p><p><strong>${esc(rentalNumber(r))}</strong></p></div><div class="receipt-grid"><div><span>Customer</span><strong>${esc(r.customerName)}</strong></div><div><span>Phone</span><strong>${esc(r.phone||"—")}</strong></div><div><span>Email</span><strong>${esc(r.email||"—")}</strong></div><div><span>Equipment</span><strong>${esc(r.equipmentName)}</strong></div><div><span>Rate Type</span><strong>${esc(r.rateType)}</strong></div><div><span>Date Out</span><strong>${fmt(r.startAt)}</strong></div><div><span>Due Back</span><strong>${fmt(r.dueAt)}</strong></div><div><span>Deposit</span><strong>${money(r.depositAmount)}</strong></div><div><span>Paid</span><strong>${r.paid?"Yes":"No"}</strong></div><div><span>Condition Out</span><strong>${esc(r.checkoutCondition||"—")}</strong></div><div><span>Fuel Out</span><strong>${esc(r.checkoutFuel||"—")}</strong></div><div><span>Hours Out</span><strong>${esc(r.checkoutHours||"—")}</strong></div><div><span>Existing Damage</span><strong>${r.preInspectionDamageFound?"Yes":"No"}</strong></div></div><p><strong>Pre-Inspection Notes:</strong> ${esc(r.preInspectionNotes||"None")}</p><p><strong>Rental Notes:</strong> ${esc(r.notes||"None")}</p><div class="receipt-total">Rental Charge: ${money(r.rentalAmount)}</div><p class="receipt-note">${esc(appSetting("receiptFooter","Thank you for renting from McGriff's Farm, Home & Rental."))}</p></div>`}


function contractEmailHtml(rental,contract){
  const equipment=state.equipment.find(e=>e.id===rental.equipmentId)||{name:rental.equipmentName};
  return `
    <h2>${esc(appSetting("businessName","McGriff's Farm, Home & Rental"))}</h2>
    <p>Attached is your signed equipment-rental agreement.</p>
    <p><strong>Rental:</strong> ${esc(rentalNumber(rental))}<br>
    <strong>Equipment:</strong> ${esc(rental.equipmentName)}<br>
    <strong>Date Out:</strong> ${fmt(rental.startAt)}<br>
    <strong>Due Back:</strong> ${fmt(rental.dueAt)}<br>
    <strong>Rental Charge:</strong> ${money(rental.rentalAmount)}</p>
    ${checkoutContractDocument({
      equipment,
      customerName:rental.customerName,
      phone:rental.phone,
      email:rental.email,
      address:rental.address,
      driverLicense:rental.driverLicense,
      licensePlate:rental.licensePlate,
      startAt:rental.startAt,
      dueAt:rental.dueAt,
      rateType:rental.rateType,
      rentalAmount:rental.rentalAmount,
      depositAmount:rental.depositAmount,
      paid:rental.paid,
      preInspection:{
        condition:rental.checkoutCondition,
        fuel:rental.checkoutFuel,
        hours:rental.checkoutHours,
        photoUrl:rental.checkoutPhotoUrl,
        notes:rental.preInspectionNotes,
        damageFound:rental.preInspectionDamageFound,
        checklist:rental.preInspectionChecklist
      }
    },contract.signatureDataUrl,contract.signedAt)}
  `;
}

async function sendContractAndScheduleReminder(rental,contract,statusElement=null){
  if(!rental.email)return {skipped:true,reason:"No customer email"};
  const customer=state.customers.find(c=>c.id===rental.customerId);
  if(customer&&customer.emailConsent===false)return {skipped:true,reason:"Customer declined email"};

  const reminderHours=Number(appSetting("reminderHours",3));
  const response=await callEmailService("sendContractAndScheduleReminder",{
    to:rental.email,
    customerName:rental.customerName,
    rentalNumber:rentalNumber(rental),
    equipmentName:rental.equipmentName,
    dueAt:rental.dueAt,
    reminderHours,
    businessName:appSetting("businessName","McGriff's Farm, Home & Rental"),
    businessPhone:appSetting("phone","(641) 636-3796"),
    subject:`Signed rental agreement - ${rentalNumber(rental)}`,
    html:contractEmailHtml(rental,contract)
  },statusElement);

  await updateDoc(doc(db,"rentals",rental.id),{
    contractEmailSent:true,
    contractEmailSentAt:new Date().toISOString(),
    reminderScheduled:true,
    reminderHours,
    updatedAt:serverTimestamp()
  });

  return response;
}
function showCheckoutPrintPacket(rental,contract){
  const printableContract=checkoutContractDocument({equipment:state.equipment.find(e=>e.id===rental.equipmentId)||{name:rental.equipmentName},customerName:rental.customerName,phone:rental.phone,email:rental.email,address:rental.address,driverLicense:rental.driverLicense,licensePlate:rental.licensePlate,startAt:rental.startAt,dueAt:rental.dueAt,rateType:rental.rateType,rentalAmount:rental.rentalAmount,depositAmount:rental.depositAmount,paid:rental.paid,preInspection:{condition:rental.checkoutCondition,fuel:rental.checkoutFuel,hours:rental.checkoutHours,photoUrl:rental.checkoutPhotoUrl,notes:rental.preInspectionNotes,damageFound:rental.preInspectionDamageFound,checklist:rental.preInspectionChecklist}},contract.signatureDataUrl,contract.signedAt);
  openModal("Rental Saved — Print Customer Packet",`<div class="checkout-progress no-print"><div class="checkout-step done"><strong>✓</strong><span>Pre-Inspection</span></div><div class="checkout-step done"><strong>✓</strong><span>Rental Details</span></div><div class="checkout-step done"><strong>✓</strong><span>Contract Signed</span></div><div class="checkout-step active"><strong>4</strong><span>Print Packet</span></div></div><div class="success-banner no-print"><strong>Rental and signed contract saved successfully.</strong></div><div class="print-area checkout-print-packet"><section class="print-page">${checkoutReceiptHtml(rental)}</section><section class="print-page">${printableContract}</section></div><div class="button-row no-print checkout-print-actions"><button id="printCheckoutPacket">Print Receipt & Signed Contract</button>${rental.email?`<button class="secondary" id="resendContractEmail">Email Contract Again</button>`:""}<button class="secondary" id="printSignedContractOnly">Print Signed Contract Only</button><button class="secondary" id="viewSavedRental">View Saved Rental</button><button class="secondary" id="closeCheckoutPacket">Close</button></div>`);
  if(rental.email){
    sendContractAndScheduleReminder(rental,contract,$("contractEmailStatus"))
      .then(()=>$("contractEmailStatus").textContent=`Contract emailed to ${rental.email}. Reminder scheduled.`)
      .catch(error=>$("contractEmailStatus").textContent=`Email setup needed: ${error.message}`);

    if($("resendContractEmail"))$("resendContractEmail").onclick=async()=>{
      const button=$("resendContractEmail");
      button.disabled=true;
      button.textContent="Sending...";
      try{
        await sendContractAndScheduleReminder(rental,contract,$("contractEmailStatus"));
        $("contractEmailStatus").textContent=`Contract emailed again to ${rental.email}.`;
      }catch(error){
        alert(error.message);
      }finally{
        button.disabled=false;
        button.textContent="Email Contract Again";
      }
    };
  }
  $("printCheckoutPacket").onclick=()=>{document.body.classList.remove("print-contract-only");window.print()};$("printSignedContractOnly").onclick=()=>{document.body.classList.add("print-contract-only");window.print();setTimeout(()=>document.body.classList.remove("print-contract-only"),500)};$("viewSavedRental").onclick=()=>rentalDetailView(rental.id);$("closeCheckoutPacket").onclick=closeModal;
}


function editRentalForm(r){
  openModal(`Edit Rental - ${r.equipmentName}`,`
    <div class="form-grid">
      <div><label>Customer Name</label><input id="erName" value="${esc(r.customerName||"")}"></div>
      <div><label>Phone</label><input id="erPhone" value="${esc(r.phone||"")}"></div>
      <div><label>Start</label><input id="erStart" type="datetime-local" value="${esc(r.startAt||"")}"></div>
      <div><label>Due</label><input id="erDue" type="datetime-local" value="${esc(r.dueAt||"")}"></div>
      <div><label>Actual Return</label><input id="erReturned" type="datetime-local" value="${esc(r.actualReturnAt||"")}"></div>
      <div><label>Rate Type</label><select id="erRate"><option>Hourly</option><option>Half Day</option><option>Full Day</option><option>Weekly</option><option>Monthly</option></select></div>
      <div><label>Rental Amount</label><input id="erAmount" type="number" value="${Number(r.rentalAmount||0)}"></div>
      <div><label>Deposit Amount</label><input id="erDeposit" type="number" value="${Number(r.depositAmount||0)}"></div>
    </div>
    <div class="checkline"><input id="erPaid" type="checkbox" ${r.paid?"checked":""}><label>Paid</label></div>
    <div class="checkline"><input id="erDepositReturned" type="checkbox" ${r.depositReturned?"checked":""}><label>Deposit returned</label></div>
    <label>Notes</label><textarea id="erNotes">${esc(r.notes||"")}</textarea>
    <button id="saveRentalEdits">Save Changes</button>
  `);
  $("erRate").value=r.rateType||"Hourly";
  $("saveRentalEdits").onclick=async()=>{
    await updateDoc(doc(db,"rentals",r.id),{
      customerName:$("erName").value.trim(),phone:$("erPhone").value.trim(),
      startAt:$("erStart").value,dueAt:$("erDue").value,
      actualReturnAt:$("erReturned").value,rateType:$("erRate").value,
      rentalAmount:Number($("erAmount").value||0),depositAmount:Number($("erDeposit").value||0),
      paid:$("erPaid").checked,depositReturned:$("erDepositReturned").checked,
      notes:$("erNotes").value.trim(),updatedAt:serverTimestamp()
    });
    closeModal();toast("Rental updated");
  };
}

function receiptHtml(r){
  return `<div class="receipt-shell print-area">
    <div class="receipt-header">
      <h2>McGriff's Farm, Home & Rental</h2>
      <p>Rental Return Receipt</p>
      <p>Receipt #${esc((r.id||"").slice(0,10).toUpperCase())}</p>
    </div>
    <div class="receipt-grid">
      <div><span>Customer</span><strong>${esc(r.customerName||"")}</strong></div>
      <div><span>Phone</span><strong>${esc(r.phone||"")}</strong></div>
      <div><span>Equipment</span><strong>${esc(r.equipmentName||"")}</strong></div>
      <div><span>Rate Type</span><strong>${esc(r.rateType||"")}</strong></div>
      <div><span>Checked Out</span><strong>${fmt(r.startAt)}</strong></div>
      <div><span>Due Back</span><strong>${fmt(r.dueAt)}</strong></div>
      <div><span>Returned</span><strong>${fmt(r.actualReturnAt)}</strong></div>
      <div><span>Paid</span><strong>${r.paid?"Yes":"No"}</strong></div>
      <div><span>Deposit</span><strong>${money(r.depositAmount)}</strong></div>
      <div><span>Deposit Returned</span><strong>${r.depositReturned?"Yes":"No"}</strong></div>
      <div><span>Return Condition</span><strong>${esc(r.returnCondition||"")}</strong></div>
      <div><span>Fuel Returned</span><strong>${esc(r.returnFuel||"")}</strong></div>
    </div>
    <p><strong>Notes:</strong> ${esc(r.notes||"None")}</p>
    <div class="receipt-total">Rental Charge: ${money(r.rentalAmount)}</div>
    <p class="receipt-note">Thank you for renting from McGriff's Farm, Home & Rental.</p>
  </div>`;
}

function showReceipt(r){
  openModal("Return Receipt",`${receiptHtml(r)}<div class="button-row no-print" style="margin-top:16px"><button id="printReceipt">Print Receipt</button><button class="secondary" id="closeReceipt">Close</button></div>`);
  $("printReceipt").onclick=()=>window.print();
  $("closeReceipt").onclick=closeModal;
}


function returnForm(r){
  openModal(`Post-Rental Inspection - ${r.equipmentName}`,`<div class="checkout-progress return-progress"><div class="checkout-step active"><strong>1</strong><span>Post-Inspection</span></div><div class="checkout-step"><strong>2</strong><span>Deposit Decision</span></div><div class="checkout-step"><strong>3</strong><span>Save & Receipt</span></div></div><div class="inspection-header"><div><h3>${esc(r.equipmentName)}</h3><p class="muted">Compare the returned equipment to the checkout condition and photos.</p></div><span class="badge reserved">Return Inspection</span></div><div class="comparison-strip"><div><span>Condition Out</span><strong>${esc(r.checkoutCondition||"Not recorded")}</strong></div><div><span>Fuel Out</span><strong>${esc(r.checkoutFuel||"Not recorded")}</strong></div><div><span>Hours Out</span><strong>${esc(r.checkoutHours||"Not recorded")}</strong></div><div><span>Existing Damage</span><strong>${r.preInspectionDamageFound?"Yes":"No"}</strong></div></div><h3>Post-Inspection Checklist</h3>${inspectionChecklistHtml("post",{})}<div class="form-grid"><div><label>Actual Return Date/Time</label><input id="postReturnAt" type="datetime-local" value="${nowLocal()}"></div><div><label>Condition Returned</label><input id="postCondition"></div><div><label>Fuel Returned</label><input id="postFuel"></div><div><label>Hour Meter Returned</label><input id="postHours"></div></div><div class="checkline"><input id="postDamageFound" type="checkbox"><label>New damage, missing parts, or abnormal wear found</label></div>${photoUploadControl("postPhoto","Post-Inspection / Return Photo","")}<label>Post-Inspection Notes / New Damage</label><textarea id="postNotes" placeholder="Describe condition, damage, missing parts, cleaning needed, or anything different from checkout."></textarea><div class="button-row"><button id="continueToDepositDecision">Next: Deposit Decision →</button><button class="secondary" id="cancelPostInspection">Cancel</button></div>`);
  connectPhotoControl("postPhoto","post-inspection");$("cancelPostInspection").onclick=closeModal;$("continueToDepositDecision").onclick=()=>{const post=collectInspection("post");post.returnAt=$("postReturnAt").value;openDepositDecision(r,post)};
}

function openDepositDecision(r,post){
  openModal(`Deposit Decision - ${r.equipmentName}`,`<div class="checkout-progress return-progress"><div class="checkout-step done"><strong>✓</strong><span>Post-Inspection</span></div><div class="checkout-step active"><strong>2</strong><span>Deposit Decision</span></div><div class="checkout-step"><strong>3</strong><span>Save & Receipt</span></div></div><div class="deposit-card"><span>Deposit Collected</span><strong>${money(r.depositAmount)}</strong></div><h3>Should the customer receive the deposit back?</h3><div class="deposit-choice-grid"><label class="deposit-choice"><input type="radio" name="depositDecision" value="returned" checked><strong>Return Full Deposit</strong><span>No reason to retain the deposit.</span></label><label class="deposit-choice"><input type="radio" name="depositDecision" value="retained"><strong>Do Not Return Deposit</strong><span>Retain the deposit because of damage, cleaning, fuel, late return, or another charge.</span></label><label class="deposit-choice"><input type="radio" name="depositDecision" value="partial"><strong>Partial Deposit Return</strong><span>Return only part of the deposit.</span></label></div><div class="form-grid"><div><label>Amount Returned</label><input id="depositReturnedAmount" type="number" value="${Number(r.depositAmount||0)}"></div><div><label>Amount Retained</label><input id="depositRetainedAmount" type="number" value="0"></div></div><label>Deposit Decision Reason / Additional Charges</label><textarea id="depositDecisionNotes" placeholder="Required if any portion of the deposit is retained."></textarea><div class="checkline"><input id="returnPaid" type="checkbox" ${r.paid?"checked":""}><label>Rental and all additional charges are paid</label></div><div class="button-row"><button class="secondary" id="backToPostInspection">← Back to Inspection</button><button id="finishReturnWithInspection">Save Return & Create Receipt</button></div>`);
  const full=Number(r.depositAmount||0);document.querySelectorAll('input[name="depositDecision"]').forEach(radio=>radio.onchange=()=>{const v=document.querySelector('input[name="depositDecision"]:checked').value;if(v==="returned"){$("depositReturnedAmount").value=full;$("depositRetainedAmount").value=0}if(v==="retained"){$("depositReturnedAmount").value=0;$("depositRetainedAmount").value=full}if(v==="partial"){$("depositReturnedAmount").value="";$("depositRetainedAmount").value=""}});
  $("depositReturnedAmount").oninput=()=>{$("depositRetainedAmount").value=Math.max(0,full-Number($("depositReturnedAmount").value||0)).toFixed(2)};$("depositRetainedAmount").oninput=()=>{$("depositReturnedAmount").value=Math.max(0,full-Number($("depositRetainedAmount").value||0)).toFixed(2)};$("backToPostInspection").onclick=()=>returnForm(r);
  $("finishReturnWithInspection").onclick=async()=>{const decision=document.querySelector('input[name="depositDecision"]:checked').value,returned=Number($("depositReturnedAmount").value||0),retained=Number($("depositRetainedAmount").value||0),reason=$("depositDecisionNotes").value.trim();if((decision==="retained"||decision==="partial")&&!reason)return alert("Enter the reason for retaining all or part of the deposit.");if(Math.abs(returned+retained-full)>.01)return alert("Returned and retained amounts must equal the original deposit.");const updates={actualReturnAt:post.returnAt,returnPhotoUrl:post.photoUrl,returnCondition:post.condition,returnFuel:post.fuel,returnHours:post.hours,postInspectionChecklist:post.checklist,postInspectionNotes:post.notes,postInspectionDamageFound:post.damageFound,depositReturned:returned===full,depositDecision:decision,depositReturnedAmount:returned,depositRetainedAmount:retained,depositDecisionNotes:reason,paid:$("returnPaid").checked,updatedAt:serverTimestamp()};await updateDoc(doc(db,"rentals",r.id),updates);const completed={...r,...updates};toast("Item returned and post-inspection saved");showReturnInspectionReceipt(completed)};
}

function showReturnInspectionReceipt(r){
  openModal("Return Complete — Print Final Receipt",`<div class="success-banner no-print"><strong>Return and post-inspection saved.</strong><span>Review the deposit decision and print the final receipt.</span></div><div class="print-area">${receiptHtml(r)}<div class="return-inspection-print"><h3>Post-Rental Inspection</h3><div class="receipt-grid"><div><span>Condition Returned</span><strong>${esc(r.returnCondition||"—")}</strong></div><div><span>Fuel Returned</span><strong>${esc(r.returnFuel||"—")}</strong></div><div><span>Hours Returned</span><strong>${esc(r.returnHours||"—")}</strong></div><div><span>New Damage Found</span><strong>${r.postInspectionDamageFound?"Yes":"No"}</strong></div><div><span>Deposit Returned</span><strong>${money(r.depositReturnedAmount||0)}</strong></div><div><span>Deposit Retained</span><strong>${money(r.depositRetainedAmount||0)}</strong></div></div><p><strong>Post-Inspection Notes:</strong> ${esc(r.postInspectionNotes||"None")}</p><p><strong>Deposit Decision:</strong> ${esc(r.depositDecisionNotes||"Full deposit returned")}</p></div></div><div class="button-row no-print"><button id="printFinalReturnReceipt">Print Final Return Receipt</button><button class="secondary" id="viewReturnedRental">View Rental</button><button class="secondary" id="closeReturnReceipt">Close</button></div>`);$("printFinalReturnReceipt").onclick=()=>window.print();$("viewReturnedRental").onclick=()=>rentalDetailView(r.id);$("closeReturnReceipt").onclick=closeModal;
}

function historyView(e){
  const rentals=state.rentals.filter(r=>r.equipmentId===e.id).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
  openModal(`History - ${e.name}`,rentals.length?rentals.map(r=>`<div class="history-record"><div class="history-grid"><div><span>Customer</span><strong>${esc(r.customerName)}</strong></div><div><span>Out</span><strong>${fmt(r.startAt)}</strong></div><div><span>Returned</span><strong>${fmt(r.actualReturnAt)||"Still Out"}</strong></div><div><span>Amount</span><strong>${money(r.rentalAmount)}</strong></div><div><span>Paid</span><strong>${r.paid?"Yes":"No"}</strong></div><div><span>Deposit Returned</span><strong>${r.depositReturned?"Yes":"No"}</strong></div></div><div class="photo-links">${r.checkoutPhotoUrl?`<a href="${esc(displayImageUrl(r.checkoutPhotoUrl))}" target="_blank">Checkout Photo</a>`:""}${r.returnPhotoUrl?`<a href="${esc(displayImageUrl(r.returnPhotoUrl))}" target="_blank">Return Photo</a>`:""}</div><p>${esc(r.notes||"")}</p></div>`).join(""):"<p>No rental history yet.</p>");
}

document.addEventListener("click",ev=>{
  const b=ev.target.closest("button[data-action]");
  if(!b)return;
  const id=b.dataset.id;
  if(b.dataset.action==="rent")rentForm(state.equipment.find(e=>e.id===id));
  if(b.dataset.action==="return")returnForm(state.rentals.find(r=>r.id===id));
  if(b.dataset.action==="reserve")reservationForm(state.equipment.find(e=>e.id===id));
  if(b.dataset.action==="start-reservation"){
    const reservation=state.reservations.find(r=>r.id===id);
    rentForm(state.equipment.find(e=>e.id===reservation.equipmentId),reservation);
  }
  if(b.dataset.action==="edit-reservation")reservationForm(null,state.reservations.find(r=>r.id===id));
  if(b.dataset.action==="cancel-reservation")cancelReservation(state.reservations.find(r=>r.id===id));
  if(b.dataset.action==="edit-rental")editRentalForm(state.rentals.find(r=>r.id===id));
  if(b.dataset.action==="receipt")showReceipt(state.rentals.find(r=>r.id===id));
  if(b.dataset.action==="history")historyView(state.equipment.find(e=>e.id===id));
  if(b.dataset.action==="maintenance")maintenanceForm(id);
  if(b.dataset.action==="edit-equipment")equipmentForm(state.equipment.find(e=>e.id===id));
  if(b.dataset.action==="edit-customer")customerForm(state.customers.find(c=>c.id===id));if(b.dataset.action==="equipment-profile")equipmentProfileView(id);if(b.dataset.action==="customer-profile")customerProfileView(id);if(b.dataset.action==="contract")openContractBuilder(state.rentals.find(r=>r.id===id));if(b.dataset.action==="view-rental")rentalDetailView(id);if(b.dataset.action==="equipment-qr")showEquipmentQr(state.equipment.find(e=>e.id===id));
});

$("saveBusinessSettings").onclick=()=>saveSettings({businessName:$("settingsBusinessName").value.trim(),location:$("settingsLocation").value.trim(),phone:$("settingsPhone").value.trim(),receiptFooter:$("settingsReceiptFooter").value.trim()});
$("saveRentalSettings").onclick=()=>saveSettings({defaultDeposit:Number($("settingsDefaultDeposit").value||0),lateFee:Number($("settingsLateFee").value||0),taxRate:Number($("settingsTaxRate").value||0),reminderHours:Number($("settingsReminderHours").value||3)});
$("saveContractSettings").onclick=()=>saveSettings({contractText:$("settingsContractText").value});
$("rentalsSearch").oninput=renderRentals;$("rentalsStatusFilter").onchange=renderRentals;$("rentalsNewRental").onclick=()=>setView("equipment");
$("loginButton").onclick=async()=>{try{$("loginError").textContent="";await signInWithEmailAndPassword(auth,$("loginEmail").value.trim(),$("loginPassword").value)}catch(e){$("loginError").textContent=e.message}};
$("logoutButton").onclick=()=>signOut(auth);
$("closeModalButton").onclick=closeModal;
$("addEquipmentButton2").onclick=()=>equipmentForm();
$("addCustomerButton").onclick=()=>customerForm();
$("addMaintenanceButton").onclick=()=>maintenanceForm();
$("addReservationButton").onclick=()=>reservationForm();
$("equipmentSearch").oninput=renderEquipment;
$("categoryFilter").onchange=renderEquipment;
$("globalSearch").oninput=e=>{state.search=e.target.value;render()};
document.querySelectorAll(".nav").forEach(b=>b.onclick=()=>setView(b.dataset.view));
$("quickReservation").onclick=()=>reservationForm();
$("quickCustomer").onclick=()=>setView("customers");
$("quickEquipment").onclick=()=>setView("equipment");
$("quickReturn").onclick=()=>setView("rentals");
$("quickNewRental").onclick=()=>setView("equipment");
$("newContractButton").onclick=()=>alert("Open a rental and choose Contract. The contract builder is the next V5 module.");

let unsubs=[];
onAuthStateChanged(auth,user=>{
  unsubs.forEach(fn=>fn());unsubs=[];
  if(!user){$("loginView").classList.remove("hidden");$("appView").classList.add("hidden");return}
  $("signedInAs").textContent=user.email;$("loginView").classList.add("hidden");$("appView").classList.remove("hidden");
  unsubs.push(onSnapshot(query(collection(db,"equipment"),orderBy("name")),s=>{state.equipment=s.docs.map(d=>({id:d.id,...d.data()}));render();openPendingEquipmentDeepLink()}));
  unsubs.push(onSnapshot(query(collection(db,"customers"),orderBy("name")),s=>{state.customers=s.docs.map(d=>({id:d.id,...d.data()}));render()}));
  unsubs.push(onSnapshot(collection(db,"rentals"),s=>{state.rentals=s.docs.map(d=>({id:d.id,...d.data()}));render()}));
  unsubs.push(onSnapshot(collection(db,"reservations"),s=>{state.reservations=s.docs.map(d=>({id:d.id,...d.data()}));render()}));
  unsubs.push(onSnapshot(collection(db,"maintenance"),s=>{state.maintenance=s.docs.map(d=>({id:d.id,...d.data()}));render()}));
  unsubs.push(onSnapshot(collection(db,"contracts"),s=>{state.contracts=s.docs.map(d=>({id:d.id,...d.data()}));render()}));
  unsubs.push(onSnapshot(doc(db,"settings","business"),s=>{state.settings=s.exists()?s.data():{};render()}));
});
