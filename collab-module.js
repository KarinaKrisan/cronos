// collab-module.js
import { db, state, isValidShiftStartDate, monthNames, pad } from './config.js';
import { addDoc, collection, serverTimestamp, query, where, onSnapshot, doc, updateDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { updatePersonalView, updateWeekendTable, showNotification } from './ui.js';

const availableShifts = ["07:00 às 19:00", "07:30 às 18:18", "08:00 às 17:48", "08:30 às 18:18", "12:12 às 22:00", "19:00 às 07:00", "22:00 às 07:48"];
let miniCalState = { year: new Date().getFullYear(), month: new Date().getMonth(), selectedDate: null };

export function initCollabUI() {
    ['adminControls', 'adminTabNav', 'editToolbar'].forEach(id => document.getElementById(id)?.classList.add('hidden'));
    ['collabHeader', 'collabControls'].forEach(id => document.getElementById(id)?.classList.remove('hidden'));
    
    const userName = (state.profile?.name || state.profile?.nome);
    if(document.getElementById('welcomeUser') && userName) document.getElementById('welcomeUser').textContent = `Olá, ${userName.split(' ')[0]}`;

    if(userName) {
        const select = document.getElementById('employeeSelect');
        if(select) { select.innerHTML = `<option value="${userName}">${userName}</option>`; select.value = userName; select.disabled = true; }
        updatePersonalView(userName);
        initRequestsTab(); 
        initInboxTab();    
        updateWeekendTable(userName);
    }
    setupEventListeners();
    initMiniCalendarLogic();
}

export function destroyCollabUI() {
    ['collabHeader', 'collabControls'].forEach(id => document.getElementById(id)?.classList.add('hidden'));
    const select = document.getElementById('employeeSelect');
    if(select) select.disabled = false;
}

// --- MINI CALENDAR ---
function initMiniCalendarLogic() {
    const trigger = document.getElementById('datePickerTrigger');
    const dropdown = document.getElementById('miniCalendarDropdown');
    const btnPrev = document.getElementById('miniPrev');
    const btnNext = document.getElementById('miniNext');
    if(!trigger) return;
    trigger.onclick = (e) => { e.preventDefault(); dropdown.classList.toggle('hidden'); renderMiniCalendar(); };
    btnPrev.onclick = (e) => { e.preventDefault(); changeMiniMonth(-1); };
    btnNext.onclick = (e) => { e.preventDefault(); changeMiniMonth(1); };
    document.addEventListener('click', (e) => { if (!trigger.contains(e.target) && !dropdown.contains(e.target)) { dropdown.classList.add('hidden'); } });
}
function changeMiniMonth(dir) {
    miniCalState.month += dir;
    if (miniCalState.month > 11) { miniCalState.month = 0; miniCalState.year++; }
    else if (miniCalState.month < 0) { miniCalState.month = 11; miniCalState.year--; }
    renderMiniCalendar();
}
function renderMiniCalendar() {
    const grid = document.getElementById('miniCalendarGrid');
    const label = document.getElementById('miniMonthLabel');
    if(!grid || !label) return;
    label.textContent = `${monthNames[miniCalState.month]} ${miniCalState.year}`;
    grid.innerHTML = '';
    const date = new Date(miniCalState.year, miniCalState.month, 1);
    const days = [];
    while (date.getMonth() === miniCalState.month) { days.push(new Date(date)); date.setDate(date.getDate() + 1); }
    for (let i = 0; i < days[0].getDay(); i++) { grid.innerHTML += `<div class="mini-day is-empty"></div>`; }
    const todayStr = new Date().toISOString().split('T')[0];
    days.forEach(day => {
        const dStr = `${day.getFullYear()}-${pad(day.getMonth()+1)}-${pad(day.getDate())}`;
        const isSelected = miniCalState.selectedDate === dStr;
        const isToday = dStr === todayStr;
        const cell = document.createElement('div');
        cell.className = `mini-day ${isSelected ? 'is-selected' : ''} ${isToday ? 'is-today' : ''}`;
        cell.textContent = day.getDate();
        cell.onclick = () => selectMiniDate(dStr);
        grid.appendChild(cell);
    });
}
function selectMiniDate(dateStr) {
    miniCalState.selectedDate = dateStr;
    document.getElementById('reqDateManual').value = dateStr;
    const [y, m, d] = dateStr.split('-');
    const txt = document.getElementById('datePickerText');
    txt.textContent = `${d}/${m}/${y}`;
    txt.classList.remove('text-gray-400'); txt.classList.add('text-white');
    document.getElementById('miniCalendarDropdown').classList.add('hidden');
}

// --- REQUESTS ---
window.deleteRequest = async (reqId) => {
    if(!confirm("Excluir?")) return;
    try { await deleteDoc(doc(db, "solicitacoes", reqId)); showNotification("Excluído.", "success"); } 
    catch (e) { showNotification("Erro.", "error"); }
};

function setupEventListeners() {
    const btnNew = document.getElementById('btnNewRequestDynamic');
    if(btnNew) { btnNew.onclick = null; btnNew.onclick = openManualRequestModal; }
    const btnSend = document.getElementById('btnSendRequest');
    if(btnSend) { btnSend.onclick = null; btnSend.onclick = sendRequest; }
    const typeSelect = document.getElementById('reqType');
    if(typeSelect) typeSelect.onchange = handleTypeChange;
}
export function handleCollabCellClick() { showNotification("Use a Central de Trocas.", "error"); }
function openManualRequestModal() { 
    document.getElementById('requestModal').classList.remove('hidden'); 
    setupModalTargetSelect(); setupShiftSelect(); handleTypeChange(); 
    document.getElementById('reqDateManual').value = "";
    const txt = document.getElementById('datePickerText');
    txt.textContent = "Data..."; txt.classList.add('text-gray-400'); txt.classList.remove('text-white');
    miniCalState.selectedDate = null;
}
function handleTypeChange() {
    const type = document.getElementById('reqType').value;
    const divTarget = document.getElementById('divReqTarget');
    const divShift = document.getElementById('divReqShift');
    if (type === 'troca_turno') { divTarget.classList.add('hidden'); divShift.classList.remove('hidden'); } 
    else { divTarget.classList.remove('hidden'); divShift.classList.add('hidden'); }
}
function setupModalTargetSelect() {
    const s = document.getElementById('reqTargetEmployee');
    if(!s) return;
    s.innerHTML = '<option value="">Selecione...</option>';
    if(state.scheduleData) {
        const myName = state.profile?.name || state.profile?.nome;
        Object.keys(state.scheduleData).sort().forEach(n => { if(n !== myName) { const opt = document.createElement('option'); opt.value = n; opt.textContent = n; s.appendChild(opt); }});
    }
}
function setupShiftSelect() {
    const s = document.getElementById('reqNewShift');
    if(!s) return;
    s.innerHTML = '';
    availableShifts.forEach(sh => { const opt = document.createElement('option'); opt.value = sh; opt.textContent = sh; s.appendChild(opt); });
}
async function sendRequest() {
    const type = document.getElementById('reqType').value;
    const dateVal = document.getElementById('reqDateManual').value;
    const reason = document.getElementById('reqReason').value;
    let targetName = null, targetUid = null, desiredShift = null;
    try {
        if(!dateVal) throw new Error("Data inválida.");
        if (type === 'troca_turno') {
            if(!isValidShiftStartDate(dateVal)) throw new Error("Apenas após dia 25.");
            desiredShift = document.getElementById('reqNewShift').value;
            if(!desiredShift) throw new Error("Selecione horário.");
            targetName = 'LÍDER'; targetUid = 'ADMIN';
        } else {
            targetName = document.getElementById('reqTargetEmployee').value;
            if(!targetName) throw new Error("Selecione colega.");
            const targetUser = Object.values(state.scheduleData).find(u => u.name === targetName);
            targetUid = targetUser ? targetUser.uid : null;
        }
        const docId = `${state.selectedMonthObj.year}-${String(state.selectedMonthObj.month+1).padStart(2,'0')}`;
        const dayIdx = parseInt(dateVal.split('-')[2]) - 1;
        await addDoc(collection(db, "solicitacoes"), {
            monthId: docId, requester: (state.profile.name || state.profile.nome), requesterUid: state.currentUser.uid,
            dayIndex: dayIdx, type: type, target: targetName, targetUid: targetUid, desiredShift: desiredShift, reason: reason,
            status: type === 'troca_turno' ? 'pending_leader' : 'pending_peer', createdAt: serverTimestamp()
        });
        document.getElementById('requestModal').classList.add('hidden');
        showNotification("Enviado!");
    } catch(e) { showNotification(e.message, "error"); }
}

function initRequestsTab() {
    const docId = `${state.selectedMonthObj.year}-${String(state.selectedMonthObj.month+1).padStart(2,'0')}`;
    const name = (state.profile.name || state.profile.nome);
    const qSent = query(collection(db, "solicitacoes"), where("monthId", "==", docId), where("requester", "==", name));
    onSnapshot(qSent, (snap) => {
        const list = document.getElementById('sentRequestsList');
        if(!list) return;
        if (snap.empty) { list.innerHTML = '<p class="text-center py-2 text-[9px] text-gray-500 uppercase">Vazio</p>'; return; }
        list.innerHTML = '';
        snap.forEach(d => {
            const r = d.data();
            const info = r.type === 'troca_turno' ? `${r.desiredShift}` : `${r.target}`;
            const statusMap = { 'pending_peer': 'Aguardando', 'pending_leader': 'Em Análise', 'approved': 'Aprovado', 'rejected': 'Recusado' };
            const statusColor = r.status === 'approved' ? 'text-emerald-400' : (r.status === 'rejected' ? 'text-red-400' : 'text-yellow-400');
            list.innerHTML += `<div class="apple-glass p-2 mb-2 text-[9px] relative group"><div class="flex justify-between font-bold text-gray-500 mb-1"><span>${r.type.replace(/_/g,' ').toUpperCase()} • DIA ${r.dayIndex+1}</span><button onclick="window.deleteRequest('${d.id}')" class="text-gray-600 hover:text-red-400"><i class="fas fa-trash"></i></button></div><div class="text-gray-300 font-medium">${info}</div><div class="mt-1 text-right font-bold ${statusColor}">${statusMap[r.status] || r.status}</div></div>`;
        });
    });
}

function initInboxTab() {
    const docId = `${state.selectedMonthObj.year}-${String(state.selectedMonthObj.month+1).padStart(2,'0')}`;
    const myUid = state.currentUser.uid;
    const qInbox = query(collection(db, "solicitacoes"), where("monthId", "==", docId), where("targetUid", "==", myUid), where("status", "==", "pending_peer"));
    onSnapshot(qInbox, (snap) => {
        const list = document.getElementById('inboxRequestsList');
        const container = document.getElementById('inboxContainer');
        if(!list || !container) return;
        if (snap.empty) { container.classList.add('hidden'); } 
        else {
            container.classList.remove('hidden');
            list.innerHTML = '';
            snap.forEach(d => {
                const r = d.data();
                const reqId = d.id;
                list.innerHTML += `
                <div class="apple-glass p-2 mb-2 border border-blue-500/30 shadow-[0_0_10px_rgba(59,130,246,0.1)]">
                    <div class="text-[9px] text-gray-300 mb-2"><strong class="text-white">${r.requester}</strong>: <strong class="text-blue-400">${r.type === 'troca_folga' ? 'FOLGA' : 'DIA'}</strong> (Dia ${r.dayIndex+1})</div>
                    <div class="flex gap-2">
                        <button onclick="window.handlePeerResponse('${reqId}', 'approve')" class="flex-1 bg-emerald-500/20 text-emerald-400 border border-emerald-500/50 py-1 rounded text-[8px] font-bold uppercase">Aceitar</button>
                        <button onclick="window.handlePeerResponse('${reqId}', 'reject')" class="flex-1 bg-red-500/20 text-red-400 border border-red-500/50 py-1 rounded text-[8px] font-bold uppercase">Recusar</button>
                    </div>
                </div>`;
            });
        }
    });
}

window.handlePeerResponse = async (reqId, action) => {
    try {
        const ref = doc(db, "solicitacoes", reqId);
        if (action === 'approve') { await updateDoc(ref, { status: 'pending_leader' }); showNotification("Enviado p/ Admin.", "success"); } 
        else { await updateDoc(ref, { status: 'rejected' }); showNotification("Recusado.", "success"); }
    } catch (e) { showNotification("Erro.", "error"); }
};
