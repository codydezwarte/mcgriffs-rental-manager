import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  getFirestore, collection, getDocs, onSnapshot, query, orderBy
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const firebaseConfig={
  apiKey:"AIzaSyBCYpQcTm0_37GAUy8FK_vfChk8seFCOKI",
  authDomain:"mcgriffsrental.firebaseapp.com",
  projectId:"mcgriffsrental",
  storageBucket:"mcgriffsrental.firebasestorage.app",
  messagingSenderId:"511623270295",
  appId:"1:511623270295:web:d326c6fd852bafa2e6fed2"
};

const PROFILES={
  owner:{name:"Mike Roquet",role:"owner",roleLabel:"Owner",icon:"👑",email:"cody.dezwarte+owner@gmail.com"},
  manager:{name:"Cody DeZwarte",role:"manager",roleLabel:"Manager",icon:"👔",email:"cody.dezwarte@gmail.com"}
};

const app=initializeApp(firebaseConfig);
const auth=getAuth(app);
const db=getFirestore(app);
const $=id=>document.getElementById(id);

const state={
  selectedProfile:null,
  employee:null,
  equipment:[],
  rentals:[],
  reservations:[],
  currentView:"home",
  unsubs:[]
};

function toast(message){
  const el=$("toast");
  el.textContent=message;
  el.classList.add("show");
  setTimeout(()=>el.classList.remove("show"),2500);
}

function esc(value){
  return String(value??"")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function dateValue(value){
  if(!value)return null;
  if(typeof value.toDate==="function")return value.toDate();
  const d=new Date(value);
  return Number.isNaN(d.getTime())?null:d;
}

function fmt(value){
  const d=dateValue(value);
  return d?d.toLocaleString([],{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}):"";
}

function activeRental(equipmentId){
  return state.rentals.find(r=>r.equipmentId===equipmentId&&!r.actualReturnAt);
}

function statusFor(equipment){
  if(activeRental(equipment.id))return "rented";
  const raw=String(equipment.status||"available").toLowerCase();
  if(raw.includes("reserve"))return "reserved";
  if(raw.includes("maint"))return "maintenance";
  return "available";
}

function statusLabel(status){
  return {
    available:"Available",
    rented:"Rented Out",
    reserved:"Reserved",
    maintenance:"Maintenance"
  }[status]||status;
}

async function loadEmployee(user){
  const snapshot=await getDocs(collection(db,"employees"));
  const employee=snapshot.docs.map(d=>({id:d.id,...d.data()}))
    .find(x=>x.uid===user.uid||String(x.email||x.Email||"").toLowerCase()===String(user.email||"").toLowerCase());
  if(!employee)throw new Error("No employee profile is connected to this login.");
  if(employee.active===false)throw new Error("This employee profile is disabled.");
  employee.name=employee.name||employee.Name||"Employee";
  employee.role=String(employee.role||employee.Role||"viewer").toLowerCase();
  return employee;
}

function chooseProfile(key){
  const profile=PROFILES[key];
  if(!profile)return;
  state.selectedProfile=key;
  $("profilePicker").classList.add("hidden");
  $("passwordPanel").classList.remove("hidden");
  $("selectedIcon").textContent=profile.icon;
  $("selectedName").textContent=profile.name;
  $("selectedRole").textContent=profile.roleLabel;
  $("passwordInput").value="";
  $("loginError").textContent="";
  setTimeout(()=>$("passwordInput").focus(),50);
}

function showProfiles(){
  state.selectedProfile=null;
  $("profilePicker").classList.remove("hidden");
  $("passwordPanel").classList.add("hidden");
  $("loginError").textContent="";
}

async function login(){
  const profile=PROFILES[state.selectedProfile];
  if(!profile)return;
  const password=$("passwordInput").value;
  if(!password){
    $("loginError").textContent="Enter your password.";
    return;
  }

  const button=$("loginButton");
  button.disabled=true;
  button.textContent="Logging In...";
  $("loginError").textContent="";
  try{
    await signInWithEmailAndPassword(auth,profile.email,password);
  }catch(error){
    console.error(error);
    $("loginError").textContent=
      error?.code==="auth/invalid-credential"?"Incorrect password.":(error.message||String(error));
  }finally{
    button.disabled=false;
    button.textContent="Log In";
  }
}

function startListeners(){
  stopListeners();
  state.unsubs.push(onSnapshot(query(collection(db,"equipment"),orderBy("name")),snapshot=>{
    state.equipment=snapshot.docs.map(d=>({id:d.id,...d.data()}));
    renderAll();
    openDeepLink();
  }));
  state.unsubs.push(onSnapshot(collection(db,"rentals"),snapshot=>{
    state.rentals=snapshot.docs.map(d=>({id:d.id,...d.data()}));
    renderAll();
  }));
  state.unsubs.push(onSnapshot(collection(db,"reservations"),snapshot=>{
    state.reservations=snapshot.docs.map(d=>({id:d.id,...d.data()}));
    renderAll();
  }));
}

function stopListeners(){
  state.unsubs.forEach(fn=>fn());
  state.unsubs=[];
}

function setView(view){
  state.currentView=view;
  document.querySelectorAll(".view").forEach(el=>el.classList.add("hidden"));
  $(`${view}View`)?.classList.remove("hidden");
  const titles={home:"Home",equipment:"Equipment",return:"Return Equipment",scan:"Scan QR Code",profile:"Equipment Profile"};
  $("pageTitle").textContent=titles[view]||"Mobile";
  document.querySelectorAll("[data-view]").forEach(button=>{
    button.classList.toggle("active",button.dataset.view===view);
  });
  window.scrollTo({top:0,behavior:"smooth"});
}

function equipmentCard(e,mode="find"){
  const status=statusFor(e);
  const rental=activeRental(e.id);
  const photo=e.photoUrl||"";
  return `<article class="equipment-card">
    ${photo
      ? `<img class="equipment-photo" src="${esc(photo)}" alt="${esc(e.name)}">`
      : `<div class="equipment-photo"></div>`}
    <div class="equipment-info">
      <h3>${esc(e.name)}</h3>
      <p>${esc(e.category||"Equipment")}</p>
      <span class="status ${status}">${statusLabel(status)}</span>
      ${rental?`<p>Customer: <strong>${esc(rental.customerName||"")}</strong><br>Due: ${esc(fmt(rental.dueAt))}</p>`:""}
      <div class="equipment-actions">
        <button class="secondary" data-equipment="${e.id}" data-command="profile">View</button>
        ${mode==="return"&&rental
          ? `<button class="primary" data-equipment="${e.id}" data-command="return">Return</button>`
          : mode==="rent"&&status==="available"
            ? `<button class="primary" data-equipment="${e.id}" data-command="rent">Rent</button>`
            : ""}
      </div>
    </div>
  </article>`;
}

function renderHome(){
  const counts={available:0,rented:0,reserved:0,maintenance:0};
  state.equipment.forEach(e=>counts[statusFor(e)]++);
  $("availableCount").textContent=counts.available;
  $("rentedCount").textContent=counts.rented;
  $("reservedCount").textContent=counts.reserved;

  const out=state.rentals.filter(r=>!r.actualReturnAt).slice(0,5);
  $("currentlyOutList").innerHTML=out.length
    ? out.map(r=>`<button class="list-item" data-rental-equipment="${esc(r.equipmentId)}">
        <span><strong>${esc(r.equipmentName)}</strong><small>${esc(r.customerName)} · Due ${esc(fmt(r.dueAt))}</small></span>
        <span class="status rented">Out</span>
      </button>`).join("")
    : `<div class="empty">No equipment is currently out.</div>`;
}

function renderEquipment(mode="find"){
  const search=String($("equipmentSearch")?.value||"").trim().toLowerCase();
  const filtered=state.equipment.filter(e=>{
    if(mode==="return"&&!activeRental(e.id))return false;
    if(mode==="rent"&&statusFor(e)!=="available")return false;
    return !search||[e.name,e.category,e.serialNumber].some(v=>String(v||"").toLowerCase().includes(search));
  });

  if(mode==="return"){
    $("returnList").innerHTML=filtered.length
      ? filtered.map(e=>equipmentCard(e,"return")).join("")
      : `<div class="empty">No equipment is currently rented out.</div>`;
  }else{
    $("equipmentList").innerHTML=filtered.length
      ? filtered.map(e=>equipmentCard(e,mode)).join("")
      : `<div class="empty">No matching equipment found.</div>`;
  }
}

function renderAll(){
  renderHome();
  renderEquipment("find");
  renderEquipment("return");
}

function showEquipmentProfile(id){
  const e=state.equipment.find(x=>x.id===id);
  if(!e)return;
  const status=statusFor(e);
  const rental=activeRental(e.id);
  $("equipmentProfile").innerHTML=`
    <div class="panel">
      ${e.photoUrl?`<img src="${esc(e.photoUrl)}" alt="${esc(e.name)}" style="width:100%;height:240px;object-fit:contain;background:#eef2f7;border-radius:14px">`:""}
      <h1>${esc(e.name)}</h1>
      <p>${esc(e.category||"Equipment")}</p>
      <span class="status ${status}">${statusLabel(status)}</span>
      ${e.serialNumber?`<p><strong>Serial:</strong> ${esc(e.serialNumber)}</p>`:""}
      ${rental?`<p><strong>Customer:</strong> ${esc(rental.customerName)}<br><strong>Due:</strong> ${esc(fmt(rental.dueAt))}</p>`:""}
      <div class="equipment-actions">
        ${status==="available"?`<button class="primary" data-equipment="${e.id}" data-command="rent">Rent Equipment</button>`:""}
        ${status==="rented"?`<button class="primary" data-equipment="${e.id}" data-command="return">Return Equipment</button>`:""}
      </div>
    </div>`;
  setView("profile");
}

function openDesktop(action="",equipmentId=""){
  const url=new URL("./index.html",window.location.href);
  url.searchParams.set("view","desktop");
  if(equipmentId)url.searchParams.set("equipment",equipmentId);
  if(action)url.searchParams.set("action",action);
  window.location.href=url.toString();
}

function handleAction(action){
  if(action==="find"){
    setView("equipment");
    $("equipmentSearch").focus();
  }
  if(action==="return"){
    setView("return");
    renderEquipment("return");
  }
  if(action==="rent"){
    setView("equipment");
    renderEquipment("rent");
    toast("Select available equipment, then tap Rent.");
  }
  if(action==="scan")setView("scan");
  if(action==="desktop")openDesktop();
}

function openDeepLink(){
  const id=new URLSearchParams(window.location.search).get("equipment");
  if(id&&state.equipment.length)showEquipmentProfile(id);
}

document.querySelectorAll("[data-profile]").forEach(button=>{
  button.onclick=()=>chooseProfile(button.dataset.profile);
});
$("backProfiles").onclick=showProfiles;
$("loginButton").onclick=login;
$("passwordInput").onkeydown=e=>{if(e.key==="Enter")login()};
$("logoutButton").onclick=()=>signOut(auth);
$("equipmentSearch").oninput=()=>renderEquipment("find");
$("manualEquipmentSearch").onclick=()=>handleAction("find");

document.addEventListener("click",event=>{
  const actionButton=event.target.closest("[data-action]");
  if(actionButton)handleAction(actionButton.dataset.action);

  const viewButton=event.target.closest("[data-view]");
  if(viewButton)setView(viewButton.dataset.view);

  const equipmentButton=event.target.closest("[data-equipment]");
  if(equipmentButton){
    const id=equipmentButton.dataset.equipment;
    const command=equipmentButton.dataset.command;
    if(command==="profile")showEquipmentProfile(id);
    if(command==="rent")openDesktop("rent",id);
    if(command==="return")openDesktop("return",id);
  }

  const rentalButton=event.target.closest("[data-rental-equipment]");
  if(rentalButton)showEquipmentProfile(rentalButton.dataset.rentalEquipment);
});

$("menuButton").onclick=()=>toast("Use the bottom navigation for now.");

onAuthStateChanged(auth,async user=>{
  if(!user){
    stopListeners();
    state.employee=null;
    $("loginView").classList.remove("hidden");
    $("appView").classList.add("hidden");
    showProfiles();
    return;
  }

  try{
    state.employee=await loadEmployee(user);
    $("loginView").classList.add("hidden");
    $("appView").classList.remove("hidden");
    $("headerUser").textContent=`${state.employee.name} · ${state.employee.role}`;
    $("welcomeText").textContent=`Welcome, ${state.employee.name}`;
    startListeners();
    setView("home");
  }catch(error){
    console.error(error);
    await signOut(auth);
    $("loginError").textContent=error.message||String(error);
  }
});
