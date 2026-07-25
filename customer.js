import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getFirestore, doc, onSnapshot } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const firebaseConfig={
  apiKey:"AIzaSyBCYpQcTm0_37GAUy8FK_vfChk8seFCOKI",
  authDomain:"mcgriffsrental.firebaseapp.com",
  projectId:"mcgriffsrental",
  storageBucket:"mcgriffsrental.firebasestorage.app",
  messagingSenderId:"511623270295",
  appId:"1:511623270295:web:d326c6fd852bafa2e6fed2"
};

const app=initializeApp(firebaseConfig);
const db=getFirestore(app);
const $=id=>document.getElementById(id);
const equipmentId=new URLSearchParams(window.location.search).get("equipment");

function driveFileIdFromUrl(url){
  const text=String(url||"").trim();
  const patterns=[/[?&]id=([^&]+)/i,/\/d\/([^/?#]+)/i,/googleusercontent\.com\/d\/([^=/?#]+)/i];
  for(const pattern of patterns){const match=text.match(pattern);if(match?.[1])return decodeURIComponent(match[1]);}
  return "";
}
function displayImageUrl(url){
  const id=driveFileIdFromUrl(url);
  return id?`https://lh3.googleusercontent.com/d/${encodeURIComponent(id)}=w1600`:String(url||"");
}
function toDateValue(value){
  if(!value)return null;
  const date=value?.toDate?value.toDate():new Date(value);
  return Number.isNaN(date.getTime())?null:date;
}
function formatDate(value){
  if(!value)return "";
  const date=value?.toDate?value.toDate():new Date(value);
  if(Number.isNaN(date.getTime()))return "";
  return date.toLocaleString([], {weekday:"long",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
}
function phoneHref(phone){return `tel:${String(phone||"641-637-4010").replace(/[^+\d]/g,"")}`;}
function showSection(sectionId,contentId,value){
  const text=String(value||"").trim();
  if(!text)return;
  $(contentId).textContent=text;
  $(sectionId).classList.remove("hidden");
}
function addResource(container,label,url,icon="↗"){
  if(!url)return;
  const link=document.createElement("a");
  link.className="resource-link";
  link.href=url;
  link.target="_blank";
  link.rel="noopener";
  link.innerHTML=`<span class="resource-icon">${icon}</span><span>${label}</span>`;
  container.appendChild(link);
}
function youtubeEmbedUrl(url){
  const text=String(url||"");
  let match=text.match(/youtu\.be\/([^?&#/]+)/i)||text.match(/[?&]v=([^?&#/]+)/i)||text.match(/youtube\.com\/shorts\/([^?&#/]+)/i)||text.match(/youtube\.com\/embed\/([^?&#/]+)/i);
  return match?.[1]?`https://www.youtube.com/embed/${match[1]}`:"";
}
function renderVideo(container,item,index){
  const url=typeof item==="string"?item:item?.url;
  const label=typeof item==="string"?`How-To Video ${index+1}`:(item?.label||`How-To Video ${index+1}`);
  if(!url)return;
  const embed=youtubeEmbedUrl(url);
  if(embed){const card=document.createElement("article");card.className="video-card";card.innerHTML=`<h3>${label}</h3><div class="video-frame"><iframe src="${embed}" title="${label}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`;container.appendChild(card);return;}
  if(/\.(mp4|webm|ogg)([?#].*)?$/i.test(url)){const card=document.createElement("article");card.className="video-card";card.innerHTML=`<h3>${label}</h3><video controls preload="metadata" src="${url}"></video>`;container.appendChild(card);return;}
  addResource(container,label,url,"▶");
}
function renderEquipment(e){
  $("loadingCard").classList.add("hidden");
  $("errorCard").classList.add("hidden");
  $("equipmentPage").classList.remove("hidden");
  $("equipmentName").textContent=e.name||"Equipment";
  $("equipmentCategory").textContent=e.category||"Rental Equipment";
  document.title=`${e.name||"Equipment"} | McGriff's`;

  const photo=displayImageUrl(e.photoUrl);
  $("equipmentPhoto").innerHTML=photo?`<img src="${photo}" alt="${String(e.name||"Equipment").replace(/"/g,"&quot;")}">`:'<div class="photo-placeholder">🚜</div>';

  const status=String(e.status||"Available");
  const statusKey=status.toLowerCase();
  const badge=$("statusBadge");
  badge.className=`status-badge status-${statusKey}`;
  badge.textContent=status;

  let note="This equipment is currently available.";
  if(status==="Rented"){
    const due=toDateValue(e.expectedBack);
    if(due)note=due<new Date()?`Overdue — it was due back ${formatDate(e.expectedBack)}. Please contact McGriff's.`:`Due back ${formatDate(e.expectedBack)}.`;
    else note="This equipment is currently rented.";
  }
  if(status==="Reserved")note=e.reservedFrom?`Reserved beginning ${formatDate(e.reservedFrom)}.`:"This equipment is currently reserved.";
  if(status==="Maintenance")note="This equipment is temporarily unavailable while it is being serviced.";
  $("availabilityNote").textContent=note;

  showSection("quickStartSection","quickStart",e.quickStart);
  showSection("beforeStartSection","beforeYouStart",e.beforeYouStart);
  showSection("includedSection","includedAccessories",e.includedAccessories);
  showSection("returnSection","beforeReturning",e.beforeReturning);

  const resources=$("resourceLinks");
  const manuals=Array.isArray(e.manualUrls)&&e.manualUrls.length?e.manualUrls:(e.manualUrl?[{label:"Owner's Manual",url:e.manualUrl}]:[]);
  manuals.forEach((item,index)=>{const url=typeof item==="string"?item:item?.url;const label=typeof item==="string"?`Owner's Manual ${index+1}`:(item?.label||`Owner's Manual ${index+1}`);addResource(resources,label,url,"📖")});
  (Array.isArray(e.videoUrls)?e.videoUrls:[]).forEach((item,index)=>renderVideo(resources,item,index));
  (Array.isArray(e.safetyDocuments)?e.safetyDocuments:[]).forEach((item,index)=>{
    const url=typeof item==="string"?item:item?.url;
    const label=typeof item==="string"?`Safety Document ${index+1}`:(item?.label||`Safety Document ${index+1}`);
    addResource(resources,label,url,"⚠");
  });
  if(resources.children.length)$("resourcesSection").classList.remove("hidden");

  const phone=e.supportPhone||"641-637-4010";
  $("callButton").href=phoneHref(phone);
  $("callButton").textContent=`Call McGriff's · ${phone}`;
  const textNumber=String(e.emergencyTextNumber||"").trim();
  if(textNumber){$("textButton").href=`sms:${textNumber.replace(/[^+\d]/g,"")}`;$("textButton").textContent=`Emergency Text · ${textNumber}`;$("textButton").classList.remove("hidden");}
}
function showError(message){
  $("loadingCard").classList.add("hidden");
  $("equipmentPage").classList.add("hidden");
  $("errorCard").classList.remove("hidden");
  $("errorMessage").textContent=message;
}

if(!equipmentId){
  showError("This QR code does not include an equipment number.");
}else{
  onSnapshot(doc(db,"publicEquipment",equipmentId),snapshot=>{
    if(!snapshot.exists())showError("This equipment portal has not been published yet. Please call the store for help.");
    else if(snapshot.data().portalEnabled===false)showError("This equipment resource page is temporarily unavailable. Please call the store for help.");
    else renderEquipment({id:snapshot.id,...snapshot.data()});
  },error=>{
    console.error(error);
    showError("The equipment information could not be loaded. Please call the store for help.");
  });
}
