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

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

const state = { equipment:[], customers:[], rentals:[], maintenance:[], search:"", view:"dashboard" };
const $ = id => document.getElementById(id);
const money = n => `$${Number(n||0).toFixed(2)}`;
const esc = v => String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
const fmt = v => { if(!v)return""; const d=v?.toDate?v.toDate():new Date(v); return isNaN(d)?String(v):d.toLocaleString(); };
const nowLocal = () => { const d=new Date(); d.setMinutes(d.getMinutes()-d.getTimezoneOffset()); return d.toISOString().slice(0,16); };
const activeRental = equipmentId => state.rentals.find(r=>r.equipmentId===equipmentId&&!r.actualReturnAt);
const revenueFor = equipmentId => state.rentals.filter(r=>r.equipmentId===equipmentId).reduce((s,r)=>s+Number(r.rentalAmount||0),0);
const maintenanceCostFor = equipmentId => state.maintenance.filter(m=>m.equipmentId===equipmentId).reduce((s,m)=>s+Number(m.cost||0),0);

function toast(msg){$("toast").textContent=msg;$("toast").classList.remove("hidden");clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>$("toast").classList.add("hidden"),2200)}
function openModal(title,html){$("modalTitle").textContent=title;$("modalBody").innerHTML=html;$("modal").classList.remove("hidden")}
function closeModal(){$("modal").classList.add("hidden")}
function setView(view){state.view=view;document.querySelectorAll(".view").forEach(v=>v.classList.add("hidden"));$(`${view}View`).classList.remove("hidden");document.querySelectorAll(".nav").forEach(b=>b.classList.toggle("active",b.dataset.view===view));$("pageTitle").textContent=view==="dashboard"?"Dashboard":view[0].toUpperCase()+view.slice(1)}
function render(){renderStats();renderCategories();renderEquipment();renderUpcoming();renderCustomers();renderRentals();renderMaintenance();renderReports()}

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
  const revenue=revenueFor(e.id), cost=Number(e.purchaseCost||0), maint=maintenanceCostFor(e.id), profit=revenue-cost-maint;
  const status=e.status==="Maintenance"?"Maintenance":active?"Rented Out":"Available";
  const cls=status==="Available"?"available":status==="Maintenance"?"maintenance":"rented";
  const photo=e.photoUrl?`<img src="${esc(e.photoUrl)}" alt="${esc(e.name)}">`:`<div class="photo-empty">${esc(e.name)}<br><small>No photo</small></div>`;
  return `<article class="card">
    <div class="photo">${photo}<span class="badge overlay ${cls}">${status}</span></div>
    <div class="card-body">
      <h3>${esc(e.name)}</h3><p class="category">${esc(e.category||"Uncategorized")}</p>
      ${active?`<div class="metrics"><strong>Rented to:</strong> ${esc(active.customerName)}<br><strong>Due:</strong> ${fmt(active.dueAt)}</div>`:""}
      <div class="metrics"><strong>Item Cost:</strong> ${money(cost)}<br><strong>Rental Revenue:</strong> ${money(revenue)}<br><strong>Maintenance:</strong> ${money(maint)}<br><strong>Profit:</strong> ${money(profit)}</div>
      <div class="rates">
        <div class="rate-row"><span>Hourly</span><strong>${money(e.hourlyRate)}</strong></div>
        <div class="rate-row"><span>Half Day</span><strong>${money(e.halfDayRate)}</strong></div>
        <div class="rate-row"><span>Daily</span><strong>${money(e.fullDayRate)}</strong></div>
        <div class="rate-row"><span>Weekly</span><strong>${money(e.weeklyRate)}</strong></div>
        <div class="rate-row"><span>Monthly</span><strong>${money(e.monthlyRate)}</strong></div>
      </div>
      <div class="button-row">
        ${active?`<button data-action="return" data-id="${active.id}">Return Item</button>`:`<button data-action="rent" data-id="${e.id}" ${status!=="Available"?"disabled":""}>Rent This</button>`}
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
  $("rentalsTable").innerHTML=rows.length?`<table><thead><tr><th>Equipment</th><th>Customer</th><th>Out</th><th>Due</th><th>Returned</th><th>Amount</th><th>Status</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.equipmentName)}</td><td>${esc(r.customerName)}</td><td>${fmt(r.startAt)}</td><td>${fmt(r.dueAt)}</td><td>${fmt(r.actualReturnAt)}</td><td>${money(r.rentalAmount)}</td><td><span class="badge ${r.actualReturnAt?"available":"rented"}">${r.actualReturnAt?"Returned":"Out"}</span></td></tr>`).join("")}</tbody></table>`:"<p>No rentals yet.</p>";
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
      <div><label>Photo URL</label><input id="eqPhoto" value="${esc(e.photoUrl||"")}"></div>
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
  $("eqStatus").value=e.status||"Available";
  $("saveEquipment").onclick=async()=>{const data={name:$("eqName").value.trim(),category:$("eqCategory").value.trim(),serialNumber:$("eqSerial").value.trim(),photoUrl:$("eqPhoto").value.trim(),hourlyRate:Number($("eqHourly").value||0),halfDayRate:Number($("eqHalf").value||0),fullDayRate:Number($("eqFull").value||0),weeklyRate:Number($("eqWeekly").value||0),monthlyRate:Number($("eqMonthly").value||0),purchaseCost:Number($("eqCost").value||0),status:$("eqStatus").value,notes:$("eqNotes").value.trim(),updatedAt:serverTimestamp()};if(!data.name)return alert("Equipment name is required.");e.id?await updateDoc(doc(db,"equipment",e.id),data):await addDoc(collection(db,"equipment"),{...data,createdAt:serverTimestamp()});closeModal();toast("Equipment saved")};
  if(e.id)$("deleteEquipment").onclick=async()=>{if(activeRental(e.id))return alert("Return this item before deleting it.");if(!confirm(`Delete ${e.name}? Rental history will remain.`))return;await deleteDoc(doc(db,"equipment",e.id));closeModal();toast("Equipment deleted")};
}

function customerForm(c={}){
  openModal(c.id?"Edit Customer":"Add Customer",`<div class="form-grid"><div><label>Name</label><input id="cName" value="${esc(c.name||"")}"></div><div><label>Phone</label><input id="cPhone" value="${esc(c.phone||"")}"></div><div><label>Driver License</label><input id="cLicense" value="${esc(c.driverLicense||"")}"></div><div><label>License Plate</label><input id="cPlate" value="${esc(c.licensePlate||"")}"></div></div><label>Address</label><input id="cAddress" value="${esc(c.address||"")}"><label>Notes</label><textarea id="cNotes">${esc(c.notes||"")}</textarea><button id="saveCustomer">Save Customer</button>`);
  $("saveCustomer").onclick=async()=>{const data={name:$("cName").value.trim(),phone:$("cPhone").value.trim(),driverLicense:$("cLicense").value.trim(),licensePlate:$("cPlate").value.trim(),address:$("cAddress").value.trim(),notes:$("cNotes").value.trim(),updatedAt:serverTimestamp()};if(!data.name)return alert("Customer name is required.");c.id?await updateDoc(doc(db,"customers",c.id),data):await addDoc(collection(db,"customers"),{...data,createdAt:serverTimestamp()});closeModal();toast("Customer saved")};
}

function rentForm(e){
  openModal(`Rent - ${e.name}`,`<label>Existing Customer</label><select id="rCustomer"><option value="">Choose or enter new customer</option>${state.customers.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select><div class="form-grid"><div><label>Customer Name</label><input id="rName"></div><div><label>Phone</label><input id="rPhone"></div><div><label>Driver License</label><input id="rLicense"></div><div><label>License Plate</label><input id="rPlate"></div></div><label>Address</label><input id="rAddress"><div class="form-grid"><div><label>Date/Time Taken</label><input id="rStart" type="datetime-local" value="${nowLocal()}"></div><div><label>Due Back</label><input id="rDue" type="datetime-local"></div><div><label>Rate Type</label><select id="rRate"><option>Hourly</option><option>Half Day</option><option>Full Day</option><option>Weekly</option><option>Monthly</option></select></div><div><label>Rental Amount</label><input id="rAmount" type="number"></div><div><label>Deposit Amount</label><input id="rDeposit" type="number" value="0"></div><div><label>Checkout Photo URL</label><input id="rCheckoutPhoto"></div><div><label>Condition Out</label><input id="rCondition"></div><div><label>Fuel Out</label><input id="rFuel"></div></div><div class="checkline"><input id="rContract" type="checkbox"><label>Contract signed</label></div><div class="checkline"><input id="rPaid" type="checkbox"><label>Paid</label></div><label>Notes</label><textarea id="rNotes"></textarea><button id="saveRental">Save Rental</button>`);
  const fillRate=()=>{const map={Hourly:e.hourlyRate,"Half Day":e.halfDayRate,"Full Day":e.fullDayRate,Weekly:e.weeklyRate,Monthly:e.monthlyRate};$("rAmount").value=Number(map[$("rRate").value]||0)};fillRate();$("rRate").onchange=fillRate;
  $("rCustomer").onchange=()=>{const c=state.customers.find(x=>x.id===$("rCustomer").value);if(!c)return;$("rName").value=c.name||"";$("rPhone").value=c.phone||"";$("rLicense").value=c.driverLicense||"";$("rPlate").value=c.licensePlate||"";$("rAddress").value=c.address||""};
  $("saveRental").onclick=async()=>{const customerName=$("rName").value.trim();if(!customerName)return alert("Customer name is required.");let customerId=$("rCustomer").value;if(!customerId){const created=await addDoc(collection(db,"customers"),{name:customerName,phone:$("rPhone").value.trim(),driverLicense:$("rLicense").value.trim(),licensePlate:$("rPlate").value.trim(),address:$("rAddress").value.trim(),createdAt:serverTimestamp(),updatedAt:serverTimestamp()});customerId=created.id}await addDoc(collection(db,"rentals"),{equipmentId:e.id,equipmentName:e.name,customerId,customerName,phone:$("rPhone").value.trim(),driverLicense:$("rLicense").value.trim(),licensePlate:$("rPlate").value.trim(),address:$("rAddress").value.trim(),startAt:$("rStart").value,dueAt:$("rDue").value,actualReturnAt:"",rateType:$("rRate").value,rentalAmount:Number($("rAmount").value||0),depositAmount:Number($("rDeposit").value||0),depositReturned:false,contractSigned:$("rContract").checked,paid:$("rPaid").checked,checkoutPhotoUrl:$("rCheckoutPhoto").value.trim(),returnPhotoUrl:"",checkoutCondition:$("rCondition").value.trim(),returnCondition:"",checkoutFuel:$("rFuel").value.trim(),returnFuel:"",notes:$("rNotes").value.trim(),createdAt:serverTimestamp(),updatedAt:serverTimestamp()});closeModal();toast("Rental saved")};
}

function returnForm(r){
  openModal(`Return - ${r.equipmentName}`,`<p><strong>Customer:</strong> ${esc(r.customerName)}</p><div class="form-grid"><div><label>Actual Return Time</label><input id="retAt" type="datetime-local" value="${nowLocal()}"></div><div><label>Return Photo URL</label><input id="retPhoto"></div><div><label>Condition Returned</label><input id="retCondition"></div><div><label>Fuel Returned</label><input id="retFuel"></div></div><div class="checkline"><input id="retPaid" type="checkbox" ${r.paid?"checked":""}><label>Paid</label></div><div class="checkline"><input id="retDeposit" type="checkbox"><label>Deposit returned</label></div><label>Return / Damage Notes</label><textarea id="retNotes">${esc(r.notes||"")}</textarea><button id="finishReturn">Finish Return</button>`);
  $("finishReturn").onclick=async()=>{await updateDoc(doc(db,"rentals",r.id),{actualReturnAt:$("retAt").value,returnPhotoUrl:$("retPhoto").value.trim(),returnCondition:$("retCondition").value.trim(),returnFuel:$("retFuel").value.trim(),paid:$("retPaid").checked,depositReturned:$("retDeposit").checked,notes:$("retNotes").value.trim(),updatedAt:serverTimestamp()});closeModal();toast("Item returned")};
}

function maintenanceForm(equipmentId=""){
  const e=state.equipment.find(x=>x.id===equipmentId);
  openModal("Add Maintenance",`<label>Equipment</label><select id="mEquipment">${state.equipment.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join("")}</select><div class="form-grid"><div><label>Date</label><input id="mDate" type="date"></div><div><label>Type</label><input id="mType"></div><div><label>Status</label><select id="mStatus"><option>Completed</option><option>Due</option><option>Scheduled</option></select></div><div><label>Performed By</label><input id="mBy"></div><div><label>Cost</label><input id="mCost" type="number" value="0"></div></div><label>Notes</label><textarea id="mNotes"></textarea><button id="saveMaintenance">Save Maintenance</button>`);
  if(e)$("mEquipment").value=e.id;
  $("saveMaintenance").onclick=async()=>{const eq=state.equipment.find(x=>x.id===$("mEquipment").value);await addDoc(collection(db,"maintenance"),{equipmentId:eq.id,equipmentName:eq.name,date:$("mDate").value,type:$("mType").value.trim(),status:$("mStatus").value,performedBy:$("mBy").value.trim(),cost:Number($("mCost").value||0),notes:$("mNotes").value.trim(),createdAt:serverTimestamp(),updatedAt:serverTimestamp()});closeModal();toast("Maintenance saved")};
}

function historyView(e){
  const rentals=state.rentals.filter(r=>r.equipmentId===e.id).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
  openModal(`History - ${e.name}`,rentals.length?rentals.map(r=>`<div class="history-record"><div class="history-grid"><div><span>Customer</span><strong>${esc(r.customerName)}</strong></div><div><span>Out</span><strong>${fmt(r.startAt)}</strong></div><div><span>Returned</span><strong>${fmt(r.actualReturnAt)||"Still Out"}</strong></div><div><span>Amount</span><strong>${money(r.rentalAmount)}</strong></div><div><span>Paid</span><strong>${r.paid?"Yes":"No"}</strong></div><div><span>Deposit Returned</span><strong>${r.depositReturned?"Yes":"No"}</strong></div></div><div class="photo-links">${r.checkoutPhotoUrl?`<a href="${esc(r.checkoutPhotoUrl)}" target="_blank">Checkout Photo</a>`:""}${r.returnPhotoUrl?`<a href="${esc(r.returnPhotoUrl)}" target="_blank">Return Photo</a>`:""}</div><p>${esc(r.notes||"")}</p></div>`).join(""):"<p>No rental history yet.</p>");
}

document.addEventListener("click",ev=>{const b=ev.target.closest("button[data-action]");if(!b)return;const id=b.dataset.id;if(b.dataset.action==="rent")rentForm(state.equipment.find(e=>e.id===id));if(b.dataset.action==="return")returnForm(state.rentals.find(r=>r.id===id));if(b.dataset.action==="history")historyView(state.equipment.find(e=>e.id===id));if(b.dataset.action==="maintenance")maintenanceForm(id);if(b.dataset.action==="edit-equipment")equipmentForm(state.equipment.find(e=>e.id===id));if(b.dataset.action==="edit-customer")customerForm(state.customers.find(c=>c.id===id))});
$("loginButton").onclick=async()=>{try{$("loginError").textContent="";await signInWithEmailAndPassword(auth,$("loginEmail").value.trim(),$("loginPassword").value)}catch(e){$("loginError").textContent=e.message}};
$("logoutButton").onclick=()=>signOut(auth);$("closeModalButton").onclick=closeModal;$("addEquipmentButton").onclick=()=>equipmentForm();$("addEquipmentButton2").onclick=()=>equipmentForm();$("addCustomerButton").onclick=()=>customerForm();$("addMaintenanceButton").onclick=()=>maintenanceForm();$("equipmentSearch").oninput=renderEquipment;$("categoryFilter").onchange=renderEquipment;$("globalSearch").oninput=e=>{state.search=e.target.value;render()};document.querySelectorAll(".nav").forEach(b=>b.onclick=()=>setView(b.dataset.view));

let unsubs=[];
onAuthStateChanged(auth,user=>{
  unsubs.forEach(fn=>fn());unsubs=[];
  if(!user){$("loginView").classList.remove("hidden");$("appView").classList.add("hidden");return}
  $("signedInAs").textContent=user.email;$("loginView").classList.add("hidden");$("appView").classList.remove("hidden");
  unsubs.push(onSnapshot(query(collection(db,"equipment"),orderBy("name")),s=>{state.equipment=s.docs.map(d=>({id:d.id,...d.data()}));render()}));
  unsubs.push(onSnapshot(query(collection(db,"customers"),orderBy("name")),s=>{state.customers=s.docs.map(d=>({id:d.id,...d.data()}));render()}));
  unsubs.push(onSnapshot(collection(db,"rentals"),s=>{state.rentals=s.docs.map(d=>({id:d.id,...d.data()}));render()}));
  unsubs.push(onSnapshot(collection(db,"maintenance"),s=>{state.maintenance=s.docs.map(d=>({id:d.id,...d.data()}));render()}));
});
