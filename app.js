import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  getFirestore, collection, addDoc, updateDoc, deleteDoc, doc,
  onSnapshot, query, orderBy, serverTimestamp
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

const state = { equipment:[], customers:[], rentals:[], reservations:[], maintenance:[], search:"", view:"dashboard" };
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
function setView(view){state.view=view;document.querySelectorAll(".view").forEach(v=>v.classList.add("hidden"));$(`${view}View`).classList.remove("hidden");document.querySelectorAll(".nav").forEach(b=>b.classList.toggle("active",b.dataset.view===view));$("pageTitle").textContent=view==="dashboard"?"Dashboard":view[0].toUpperCase()+view.slice(1)}
function render(){renderStats();renderCategories();renderEquipment();renderUpcoming();renderCustomers();renderRentals();renderReservations();renderMaintenance();renderReports()}

function renderStats(){
  const active=state.rentals.filter(r=>!r.actualReturnAt);
  const now=new Date();
  const overdue=active.filter(r=>r.dueAt&&new Date(r.dueAt)<now);
  const monthKey=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
  const monthRevenue=state.rentals.filter(r=>String(r.startAt||"").startsWith(monthKey)).reduce((s,r)=>s+Number(r.rentalAmount||0),0);
  const lifetime=state.rentals.reduce((s,r)=>s+Number(r.rentalAmount||0),0);
  $("statOut").textContent=active.length;
  $("statAvailable").textContent=state.equipment.filter(e=>!activeRental(e.id)&&e.status!=="Maintenance").length;
  $("statOverdue").textContent=overdue.length;
  $("statMonthRevenue").textContent=money(monthRevenue);
  $("statLifetimeRevenue").textContent=money(lifetime);
  $("statMaintenance").textContent=state.maintenance.filter(m=>m.status==="Due"||m.status==="Scheduled").length;
}

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
      <h3>${esc(e.name)}</h3><p class="category">${esc(e.category||"Uncategorized")}</p>
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
        <button class="secondary" data-action="edit-equipment" data-id="${e.id}">Edit</button>
      </div>
    </div>
  </article>`;
}

function renderEquipment(){
  const cards=filteredEquipment().map(equipmentCard).join("")||'<p style="color:#6b7280">No equipment found.</p>';
  $("equipmentCards").innerHTML=cards;
  $("equipmentTable").innerHTML=state.equipment.length?`<table><thead><tr><th>Name</th><th>Category</th><th>Status</th><th>Revenue</th><th>Profit</th><th></th></tr></thead><tbody>${state.equipment.map(e=>{const active=activeRental(e.id);const rev=revenueFor(e.id);const profit=rev-Number(e.purchaseCost||0)-maintenanceCostFor(e.id);return`<tr><td><strong>${esc(e.name)}</strong></td><td>${esc(e.category)}</td><td>${active?"Rented Out":e.status||"Available"}</td><td>${money(rev)}</td><td>${money(profit)}</td><td><button class="secondary" data-action="edit-equipment" data-id="${e.id}">Edit</button></td></tr>`}).join("")}</tbody></table>`:"<p>No equipment yet.</p>";
}

function renderUpcoming(){
  const active=state.rentals.filter(r=>!r.actualReturnAt).sort((a,b)=>new Date(a.dueAt||"9999")-new Date(b.dueAt||"9999"));
  const now=new Date();
  const upcoming=active.filter(r=>!r.dueAt||new Date(r.dueAt)>=now).slice(0,5);
  const overdue=active.filter(r=>r.dueAt&&new Date(r.dueAt)<now);
  $("upcomingReturns").innerHTML=upcoming.length?upcoming.map(r=>`<div class="list-item"><strong>${esc(r.equipmentName)}</strong><br>${esc(r.customerName)}<br>${fmt(r.dueAt)}</div>`).join(""):"<p style='color:#6b7280'>Nothing due back soon.</p>";
  $("overdueList").innerHTML=overdue.length?overdue.map(r=>`<div class="list-item"><strong>${esc(r.equipmentName)}</strong><br>${esc(r.customerName)}<br>${fmt(r.dueAt)}</div>`).join(""):"<p style='color:#6b7280'>No overdue equipment.</p>";
}

function renderCustomers(){
  const q=state.search.toLowerCase();const rows=state.customers.filter(c=>!q||[c.name,c.phone,c.address,c.driverLicense,c.licensePlate].join(" ").toLowerCase().includes(q));
  $("customersTable").innerHTML=rows.length?`<table><thead><tr><th>Name</th><th>Phone</th><th>License</th><th>Plate</th><th>Address</th><th></th></tr></thead><tbody>${rows.map(c=>`<tr><td><strong>${esc(c.name)}</strong></td><td>${esc(c.phone)}</td><td>${esc(c.driverLicense)}</td><td>${esc(c.licensePlate)}</td><td>${esc(c.address)}</td><td><button class="secondary" data-action="edit-customer" data-id="${c.id}">Edit</button></td></tr>`).join("")}</tbody></table>`:"<p>No customers found.</p>";
}

function renderRentals(){
  const rows=[...state.rentals].sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
  $("rentalsTable").innerHTML=rows.length?`<table>
    <thead><tr><th>Equipment</th><th>Customer</th><th>Out</th><th>Due</th><th>Returned</th><th>Amount</th><th>Status</th><th></th></tr></thead>
    <tbody>${rows.map(r=>`<tr>
      <td>${esc(r.equipmentName)}</td><td>${esc(r.customerName)}</td>
      <td>${fmt(r.startAt)}</td><td>${fmt(r.dueAt)}</td><td>${fmt(r.actualReturnAt)}</td>
      <td>${money(r.rentalAmount)}</td>
      <td><span class="badge ${r.actualReturnAt?"available":"rented"}">${r.actualReturnAt?"Returned":"Out"}</span></td>
      <td><div class="button-row">
        <button class="secondary" data-action="edit-rental" data-id="${r.id}">Edit</button>
        ${r.actualReturnAt?`<button class="secondary" data-action="receipt" data-id="${r.id}">Receipt</button>`:""}
      </div></td>
    </tr>`).join("")}</tbody></table>`:"<p>No rentals yet.</p>";
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
  $("saveEquipment").onclick=async()=>{const data={name:$("eqName").value.trim(),category:$("eqCategory").value.trim(),serialNumber:$("eqSerial").value.trim(),photoUrl:$("eqPhotoUrl").value.trim(),hourlyRate:Number($("eqHourly").value||0),halfDayRate:Number($("eqHalf").value||0),fullDayRate:Number($("eqFull").value||0),weeklyRate:Number($("eqWeekly").value||0),monthlyRate:Number($("eqMonthly").value||0),purchaseCost:Number($("eqCost").value||0),status:$("eqStatus").value,notes:$("eqNotes").value.trim(),updatedAt:serverTimestamp()};if(!data.name)return alert("Equipment name is required.");e.id?await updateDoc(doc(db,"equipment",e.id),data):await addDoc(collection(db,"equipment"),{...data,createdAt:serverTimestamp()});closeModal();toast("Equipment saved")};
  if(e.id)$("deleteEquipment").onclick=async()=>{if(activeRental(e.id))return alert("Return this item before deleting it.");if(!confirm(`Delete ${e.name}? Rental history will remain.`))return;await deleteDoc(doc(db,"equipment",e.id));closeModal();toast("Equipment deleted")};
}

function customerForm(c={}){
  openModal(c.id?"Edit Customer":"Add Customer",`<div class="form-grid"><div><label>Name</label><input id="cName" value="${esc(c.name||"")}"></div><div><label>Phone</label><input id="cPhone" value="${esc(c.phone||"")}"></div><div><label>Driver License</label><input id="cLicense" value="${esc(c.driverLicense||"")}"></div><div><label>License Plate</label><input id="cPlate" value="${esc(c.licensePlate||"")}"></div></div><label>Address</label><input id="cAddress" value="${esc(c.address||"")}"><label>Notes</label><textarea id="cNotes">${esc(c.notes||"")}</textarea><button id="saveCustomer">Save Customer</button>`);
  $("saveCustomer").onclick=async()=>{const data={name:$("cName").value.trim(),phone:$("cPhone").value.trim(),driverLicense:$("cLicense").value.trim(),licensePlate:$("cPlate").value.trim(),address:$("cAddress").value.trim(),notes:$("cNotes").value.trim(),updatedAt:serverTimestamp()};if(!data.name)return alert("Customer name is required.");c.id?await updateDoc(doc(db,"customers",c.id),data):await addDoc(collection(db,"customers"),{...data,createdAt:serverTimestamp()});closeModal();toast("Customer saved")};
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

function rentForm(e,reservation=null){
  openModal(`Rent - ${e.name}`,`<label>Existing Customer</label><select id="rCustomer"><option value="">Choose or enter new customer</option>${state.customers.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select><div class="form-grid"><div><label>Customer Name</label><input id="rName" value="${esc(reservation?.customerName||"")}"></div><div><label>Phone</label><input id="rPhone" value="${esc(reservation?.phone||"")}"></div><div><label>Driver License</label><input id="rLicense"></div><div><label>License Plate</label><input id="rPlate"></div></div><label>Address</label><input id="rAddress"><div class="form-grid"><div><label>Date/Time Taken</label><input id="rStart" type="datetime-local" value="${esc(reservation?.startAt||nowLocal())}"></div><div><label>Due Back</label><input id="rDue" type="datetime-local" value="${esc(reservation?.endAt||"")}"></div><div><label>Rate Type</label><select id="rRate"><option>Hourly</option><option>Half Day</option><option>Full Day</option><option>Weekly</option><option>Monthly</option></select></div><div><label>Rental Amount</label><input id="rAmount" type="number" value="${Number(reservation?.expectedAmount||0)}"></div><div><label>Deposit Amount</label><input id="rDeposit" type="number" value="${Number(reservation?.depositAmount||0)}"></div><div>${photoUploadControl("rCheckoutPhoto", "Checkout Photo")}</div><div><label>Condition Out</label><input id="rCondition"></div><div><label>Fuel Out</label><input id="rFuel"></div></div><div class="checkline"><input id="rContract" type="checkbox"><label>Contract signed</label></div><div class="checkline"><input id="rPaid" type="checkbox"><label>Paid</label></div><label>Notes</label><textarea id="rNotes">${esc(reservation?.notes||"")}</textarea><button id="saveRental">Save Rental</button>`);
  connectPhotoControl("rCheckoutPhoto","checkout");
  if(reservation?.customerId)$("rCustomer").value=reservation.customerId;
  $("rRate").value=reservation?.rateType||"Hourly";

  const fillRate=()=>{const map={Hourly:e.hourlyRate,"Half Day":e.halfDayRate,"Full Day":e.fullDayRate,Weekly:e.weeklyRate,Monthly:e.monthlyRate};if(!reservation||!Number($("rAmount").value))$("rAmount").value=Number(map[$("rRate").value]||0)};
  fillRate();$("rRate").onchange=fillRate;

  $("rCustomer").onchange=()=>{const c=state.customers.find(x=>x.id===$("rCustomer").value);if(!c)return;$("rName").value=c.name||"";$("rPhone").value=c.phone||"";$("rLicense").value=c.driverLicense||"";$("rPlate").value=c.licensePlate||"";$("rAddress").value=c.address||""};

  $("saveRental").onclick=async()=>{
    const customerName=$("rName").value.trim();
    if(!customerName)return alert("Customer name is required.");
    let customerId=$("rCustomer").value;
    if(!customerId){
      const created=await addDoc(collection(db,"customers"),{
        name:customerName,phone:$("rPhone").value.trim(),driverLicense:$("rLicense").value.trim(),
        licensePlate:$("rPlate").value.trim(),address:$("rAddress").value.trim(),
        createdAt:serverTimestamp(),updatedAt:serverTimestamp()
      });
      customerId=created.id;
    }
    const rentalDoc=await addDoc(collection(db,"rentals"),{
      equipmentId:e.id,equipmentName:e.name,customerId,customerName,
      phone:$("rPhone").value.trim(),driverLicense:$("rLicense").value.trim(),
      licensePlate:$("rPlate").value.trim(),address:$("rAddress").value.trim(),
      startAt:$("rStart").value,dueAt:$("rDue").value,actualReturnAt:"",
      rateType:$("rRate").value,rentalAmount:Number($("rAmount").value||0),
      depositAmount:Number($("rDeposit").value||0),depositReturned:false,
      contractSigned:$("rContract").checked,paid:$("rPaid").checked,
      checkoutPhotoUrl:$("rCheckoutPhotoUrl").value.trim(),returnPhotoUrl:"",
      checkoutCondition:$("rCondition").value.trim(),returnCondition:"",
      checkoutFuel:$("rFuel").value.trim(),returnFuel:"",
      notes:$("rNotes").value.trim(),reservationId:reservation?.id||"",
      createdAt:serverTimestamp(),updatedAt:serverTimestamp()
    });
    if(reservation?.id){
      await updateDoc(doc(db,"reservations",reservation.id),{
        status:"Picked Up",linkedRentalId:rentalDoc.id,pickedUpAt:serverTimestamp(),updatedAt:serverTimestamp()
      });
    }
    closeModal();toast("Rental saved");
  };
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
  openModal(`Return - ${r.equipmentName}`,`<p><strong>Customer:</strong> ${esc(r.customerName)}</p><div class="form-grid"><div><label>Actual Return Time</label><input id="retAt" type="datetime-local" value="${nowLocal()}"></div><div>${photoUploadControl("retPhoto", "Return Photo")}</div><div><label>Condition Returned</label><input id="retCondition"></div><div><label>Fuel Returned</label><input id="retFuel"></div></div><div class="checkline"><input id="retPaid" type="checkbox" ${r.paid?"checked":""}><label>Paid</label></div><div class="checkline"><input id="retDeposit" type="checkbox"><label>Deposit returned</label></div><label>Return / Damage Notes</label><textarea id="retNotes">${esc(r.notes||"")}</textarea><button id="finishReturn">Finish Return</button>`);
  connectPhotoControl("retPhoto","return");
  $("finishReturn").onclick=async()=>{
    const updates={
      actualReturnAt:$("retAt").value,returnPhotoUrl:$("retPhotoUrl").value.trim(),
      returnCondition:$("retCondition").value.trim(),returnFuel:$("retFuel").value.trim(),
      paid:$("retPaid").checked,depositReturned:$("retDeposit").checked,
      notes:$("retNotes").value.trim(),updatedAt:serverTimestamp()
    };
    await updateDoc(doc(db,"rentals",r.id),updates);
    toast("Item returned");
    showReceipt({...r,...updates});
  };
}

function maintenanceForm(equipmentId=""){
  const e=state.equipment.find(x=>x.id===equipmentId);
  openModal("Add Maintenance",`<label>Equipment</label><select id="mEquipment">${state.equipment.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join("")}</select><div class="form-grid"><div><label>Date</label><input id="mDate" type="date"></div><div><label>Type</label><input id="mType"></div><div><label>Status</label><select id="mStatus"><option>Completed</option><option>Due</option><option>Scheduled</option></select></div><div><label>Performed By</label><input id="mBy"></div><div><label>Cost</label><input id="mCost" type="number" value="0"></div></div><label>Notes</label><textarea id="mNotes"></textarea><button id="saveMaintenance">Save Maintenance</button>`);
  if(e)$("mEquipment").value=e.id;
  $("saveMaintenance").onclick=async()=>{const eq=state.equipment.find(x=>x.id===$("mEquipment").value);await addDoc(collection(db,"maintenance"),{equipmentId:eq.id,equipmentName:eq.name,date:$("mDate").value,type:$("mType").value.trim(),status:$("mStatus").value,performedBy:$("mBy").value.trim(),cost:Number($("mCost").value||0),notes:$("mNotes").value.trim(),createdAt:serverTimestamp(),updatedAt:serverTimestamp()});closeModal();toast("Maintenance saved")};
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
  if(b.dataset.action==="edit-customer")customerForm(state.customers.find(c=>c.id===id));
});
$("loginButton").onclick=async()=>{try{$("loginError").textContent="";await signInWithEmailAndPassword(auth,$("loginEmail").value.trim(),$("loginPassword").value)}catch(e){$("loginError").textContent=e.message}};
$("logoutButton").onclick=()=>signOut(auth);$("closeModalButton").onclick=closeModal;$("addEquipmentButton").onclick=()=>equipmentForm();$("addEquipmentButton2").onclick=()=>equipmentForm();$("addCustomerButton").onclick=()=>customerForm();$("addMaintenanceButton").onclick=()=>maintenanceForm();$("addReservationButton").onclick=()=>reservationForm();$("equipmentSearch").oninput=renderEquipment;$("categoryFilter").onchange=renderEquipment;$("globalSearch").oninput=e=>{state.search=e.target.value;render()};document.querySelectorAll(".nav").forEach(b=>b.onclick=()=>setView(b.dataset.view));

let unsubs=[];
onAuthStateChanged(auth,user=>{
  unsubs.forEach(fn=>fn());unsubs=[];
  if(!user){$("loginView").classList.remove("hidden");$("appView").classList.add("hidden");return}
  $("signedInAs").textContent=user.email;$("loginView").classList.add("hidden");$("appView").classList.remove("hidden");
  unsubs.push(onSnapshot(query(collection(db,"equipment"),orderBy("name")),s=>{state.equipment=s.docs.map(d=>({id:d.id,...d.data()}));render()}));
  unsubs.push(onSnapshot(query(collection(db,"customers"),orderBy("name")),s=>{state.customers=s.docs.map(d=>({id:d.id,...d.data()}));render()}));
  unsubs.push(onSnapshot(collection(db,"rentals"),s=>{state.rentals=s.docs.map(d=>({id:d.id,...d.data()}));render()}));
  unsubs.push(onSnapshot(collection(db,"reservations"),s=>{state.reservations=s.docs.map(d=>({id:d.id,...d.data()}));render()}));
  unsubs.push(onSnapshot(collection(db,"maintenance"),s=>{state.maintenance=s.docs.map(d=>({id:d.id,...d.data()}));render()}));
});
