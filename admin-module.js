// admin-module.js
import { db, state } from './config.js';
import { showNotification, updateCalendar, renderWeekendDuty } from './ui.js';
import { doc, collection, addDoc, query, orderBy, getDocs, writeBatch, serverTimestamp, where, onSnapshot, updateDoc, getDoc } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

let allLoadedLogs = [];
let dailyUpdateInterval = null;
let activeTool = null; 

// --- FUNÇÕES DE NAVEGAÇÃO E UI ---

export function switchAdminView(view) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const screens = ['Daily', 'Edit', 'Approvals', 'Logs'];
    screens.forEach(s => {
        const el = document.getElementById(`screen${s}`);
        const btn = document.getElementById(`btnNav${s}`);
        if(el) el.classList.toggle('hidden', s.toLowerCase() !== view.toLowerCase());
        if(btn) { btn.classList.remove('active'); if(s.toLowerCase() === view.toLowerCase()) btn.classList.add('active'); }
    });
    if (view === 'daily') renderDailyDashboard();
    const toolbar = document.getElementById('editToolbar');
    if (toolbar) { if (view === 'edit') toolbar.classList.remove('hidden'); else toolbar.classList.add('hidden'); } 
    else if (view === 'edit') { renderEditToolbar(); }
}

export function initAdminUI() {
    document.getElementById('adminTabNav')?.classList.remove('hidden');
    document.getElementById('adminControls')?.classList.remove('hidden'); 
    const btnSave = document.getElementById('btnSaveConfirm');
    if(btnSave) btnSave.onclick = confirmSaveToCloud;
    const searchInput = document.getElementById('logQuickSearch');
    if(searchInput) searchInput.oninput = (e) => internalRenderLogsTable(e.target.value);
    populateEmployeeSelect();
    internalApplyLogFilter(); 
    renderEditToolbar(); 
    initApprovalsTab(); 
    switchAdminView('daily');
    if (dailyUpdateInterval) clearInterval(dailyUpdateInterval);
    // Atualiza a cada 1 min para pegar virada de turno em tempo real
    dailyUpdateInterval = setInterval(() => { if (!document.getElementById('screenDaily').classList.contains('hidden')) renderDailyDashboard(); }, 60 * 1000);
}

function renderEditToolbar() {
    const calendarContainer = document.getElementById('calendarContainer');
    if (!calendarContainer) return;
    if (document.getElementById('editToolbar')) return;
    const toolbar = document.createElement('div');
    toolbar.id = 'editToolbar';
    toolbar.className = "flex flex-wrap justify-center gap-1.5 mb-4 animate-fade-in";
    const tools = [ { id: null, label: 'Auto', icon: 'fa-sync', color: 'text-gray-400', border: 'border-white/10' }, { id: 'T', label: 'T', icon: 'fa-briefcase', color: 'text-emerald-400', border: 'border-emerald-500/50' }, { id: 'F', label: 'F', icon: 'fa-coffee', color: 'text-amber-400', border: 'border-amber-500/50' }, { id: 'FS', label: 'Sab', icon: 'fa-sun', color: 'text-[var(--color-sat)]', border: 'border-[var(--color-sat)]' }, { id: 'FD', label: 'Dom', icon: 'fa-sun', color: 'text-[var(--color-sun)]', border: 'border-[var(--color-sun)]' }, { id: 'FE', label: 'Fér', icon: 'fa-plane', color: 'text-red-400', border: 'border-red-500/50' }, { id: 'A', label: 'Af', icon: 'fa-user-injured', color: 'text-orange-400', border: 'border-orange-500/50' }, { id: 'LM', label: 'LM', icon: 'fa-baby', color: 'text-pink-400', border: 'border-pink-500/50' } ];
    toolbar.innerHTML = tools.map(t => ` <button onclick="window.setEditTool('${t.id}')" class="tool-btn group relative px-2.5 py-1.5 rounded-lg bg-white/5 border ${t.border} hover:bg-white/10 transition-all active:scale-95 flex items-center gap-1.5 ${activeTool === t.id ? 'bg-white/20 ring-1 ring-white/50' : 'opacity-60 hover:opacity-100'}"> <i class="fas ${t.icon} ${t.color} text-[9px]"></i> <span class="text-[8px] font-bold uppercase text-white tracking-wider">${t.label}</span> ${activeTool === t.id ? '<div class="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-white"></div>' : ''} </button> `).join('');
    const grid = document.getElementById('calendarGrid');
    if(grid) calendarContainer.insertBefore(toolbar, grid);
}
window.setEditTool = (toolId) => { activeTool = toolId === 'null' ? null : toolId; document.getElementById('editToolbar')?.remove(); renderEditToolbar(); };

// --- DASHBOARD INTELIGENTE (Lógica Noturna Corrigida) ---
export function renderDailyDashboard() {
    const today = new Date().getDate() - 1; 
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const groups = { Ativo: [], Encerrado: [], Folga: [], Ferias: [] };
    const listEnc = document.getElementById('listEncerrado');
    if(listEnc) { const header = listEnc.parentElement.querySelector('span'); if(header && header.classList.contains('text-gray-500')) { header.classList.remove('text-gray-500'); header.classList.add('text-purple-500'); } }

    Object.values(state.scheduleData).sort((a,b) => a.name.localeCompare(b.name)).forEach(emp => {
        const sToday = emp.schedule[today] || 'F';
        const sYesterday = emp.schedule[today - 1] || 'F'; 
        
        let isNightShift = false;
        let startMin = 0, endMin = 0;

        if (emp.horario) {
            const parts = emp.horario.toLowerCase().split('às').map(s => s.trim());
            if (parts.length === 2) {
                const [h1, m1] = parts[0].split(':').map(Number);
                const [h2, m2] = parts[1].split(':').map(Number);
                startMin = h1 * 60 + m1;
                endMin = h2 * 60 + m2;
                if (endMin < startMin) isNightShift = true; // Ex: 19:00 -> 07:00
            }
        }

        let finalGroup = null;

        // 1. Prioridade: Está terminando o turno de ONTEM? (Ex: Bruno Cipola)
        // Se é turno noturno, ontem foi T, e ainda é antes das 07:00 da manhã
        if (isNightShift && sYesterday === 'T' && currentMinutes < endMin) {
            finalGroup = 'Ativo';
        }
        
        // 2. Verifica o status do dia de HOJE
        else if (['FE', 'A', 'LM'].includes(sToday)) {
            finalGroup = 'Ferias';
        } 
        else if (['F', 'FS', 'FD'].includes(sToday)) {
            finalGroup = 'Folga';
        } 
        else if (sToday === 'T') {
            // Leandro: Hoje é dia de trabalho (T)
            if (isNightShift) {
                // Se for noturno, ele só está ATIVO se já passou das 19:00
                if (currentMinutes >= startMin) {
                    finalGroup = 'Ativo';
                } else {
                    // Se for 10:00 da manhã, ele está esperando dar 19:00 -> OFF
                    finalGroup = 'Encerrado';
                }
            } else {
                // Turno Diurno Normal (08:00 as 17:00)
                if (currentMinutes >= startMin && currentMinutes < endMin) {
                    finalGroup = 'Ativo';
                } else {
                    finalGroup = 'Encerrado';
                }
            }
        }

        // Distribuição final
        if (finalGroup === 'Ativo') groups.Ativo.push({ ...emp, status: 'T' });
        else if (finalGroup === 'Encerrado') groups.Encerrado.push({ ...emp, status: 'OE' });
        else if (finalGroup === 'Folga') groups.Folga.push({ ...emp, status: sToday });
        else if (finalGroup === 'Ferias') groups.Ferias.push({ ...emp, status: sToday });
    });

    const getStatusColor = (status) => { switch(status) { case 'A': return 'bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.5)]'; case 'LM': return 'bg-pink-500 shadow-[0_0_8px_rgba(236,72,153,0.5)]'; case 'FE': return 'bg-[#ef4444] shadow-[0_0_8px_rgba(239,68,68,0.5)]'; case 'T': return 'bg-[#10b981] shadow-[0_0_8px_#10b981]'; case 'OE': return 'bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.5)]'; default: return 'bg-[#fbbf24]'; } };
    const renderList = (key, list) => { const el = document.getElementById(`list${key}`); const count = document.getElementById(`count${key}`); if(count) count.innerText = list.length; if(el) { el.innerHTML = list.map(u => { const dotColor = getStatusColor(u.status); return ` <div class="dashboard-pill group"> <div class="flex items-center gap-2 overflow-hidden w-full"> <div class="pill-indicator ${dotColor}"></div> <div class="flex flex-col min-w-0 w-full"> <span class="text-[9px] font-bold text-white truncate leading-tight">${u.name}</span> <div class="flex items-center gap-1.5 mt-0.5"> <span class="px-1 py-px rounded bg-white/10 border border-white/5 text-[6px] font-bold uppercase text-white/50 tracking-wider shrink-0">${u.cargo || u.role}</span> <span class="text-[6px] font-bold uppercase text-blue-400 tracking-wider truncate">${u.setorID || '-'}</span> </div> </div> </div> <span class="text-[8px] font-black opacity-40 ml-1 text-white shrink-0">${u.status}</span> </div>` }).join(''); } };
    renderList('Ativo', groups.Ativo); renderList('Encerrado', groups.Encerrado); renderList('Folga', groups.Folga); renderList('Ferias', groups.Ferias);
}

export function populateEmployeeSelect() {
    const s = document.getElementById('employeeSelect');
    if(!s) return;
    s.innerHTML = '<option value="">Selecionar...</option>';
    if(state.scheduleData) { Object.keys(state.scheduleData).sort().forEach(n => { const opt = document.createElement('option'); opt.value = n; opt.textContent = n; s.appendChild(opt); }); }
}

export function handleAdminCellClick(name, i) {
    const user = state.scheduleData[name];
    if(!user) return;
    if (activeTool) { user.schedule[i] = activeTool; } else { const seq = ['T', 'F', 'FS', 'FD', 'FE', 'A', 'LM']; user.schedule[i] = seq[(seq.indexOf(user.schedule[i]||'F') + 1) % seq.length]; }
    updateCalendar(name, user.schedule);
    renderWeekendDuty();
}

async function confirmSaveToCloud() {
    const btn = document.getElementById('btnSaveConfirm');
    const selectedEmp = document.getElementById('employeeSelect').value;
    if (!selectedEmp) return showNotification("Selecione um colaborador", "error");
    const originalText = btn.innerText;
    btn.innerText = "Salvando...";
    btn.disabled = true;
    btn.classList.add('opacity-50', 'cursor-not-allowed');
    try {
        const user = state.scheduleData[selectedEmp];
        const docId = `${state.selectedMonthObj.year}-${String(state.selectedMonthObj.month+1).padStart(2,'0')}`;
        const safeSchedule = Array.from(user.schedule || []).map(v => v || 'F');
        const batch = writeBatch(db);
        batch.set(doc(db, "escalas", docId, "plantonistas", user.uid), { calculatedSchedule: safeSchedule }, { merge: true });
        await batch.commit();
        await addAuditLog("Edição", selectedEmp);
        showNotification("Escala salva!");
        renderDailyDashboard();
        renderWeekendDuty();
    } catch (error) { console.error("Erro ao salvar:", error); showNotification("Erro de conexão.", "error"); } 
    finally { btn.innerText = originalText; btn.disabled = false; btn.classList.remove('opacity-50', 'cursor-not-allowed'); }
}

// --- LOGS ---
async function internalApplyLogFilter() {
    let q = query(collection(db, "logs_auditoria"), orderBy("timestamp", "desc"));
    onSnapshot(q, (snap) => {
        allLoadedLogs = snap.docs.map(doc => ({ 
            date: doc.data().timestamp?.toDate().toLocaleString('pt-PT') || '-', 
            admin: doc.data().adminEmail || 'Sistema', 
            action: doc.data().action || 'Ação', 
            target: doc.data().target || '-'
        }));
        internalRenderLogsTable();
    });
}

function internalRenderLogsTable(search = "") {
    const body = document.getElementById('logsTableBody');
    if (!body) return;
    const term = search.toLowerCase();
    const filtered = allLoadedLogs.filter(l => l.admin.toLowerCase().includes(term) || l.target.toLowerCase().includes(term) || l.action.toLowerCase().includes(term));
    if(filtered.length === 0) { body.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-[9px] text-gray-600 uppercase">Vazio</td></tr>`; return; }
    body.innerHTML = filtered.map(l => ` <tr class="border-b border-white/5 hover:bg-white/[0.02]"> <td class="p-2 text-[8px] text-gray-400 font-mono">${l.date}</td> <td class="p-2 text-[8px] font-bold text-blue-400">${l.admin}</td> <td class="p-2 text-[8px] uppercase font-black text-gray-300">${l.action}</td> <td class="p-2 text-[8px] text-white">${l.target}</td> </tr>`).join('');
}

async function addAuditLog(action, target) {
    if(!state.currentUser) return;
    try { await addDoc(collection(db, "logs_auditoria"), { adminEmail: state.currentUser.email, action, target, timestamp: serverTimestamp() }); } catch(e) { console.error("Erro ao gravar log:", e); }
}

function initApprovalsTab() {
    const list = document.getElementById('adminRequestsListSide');
    if(!list) return;
    const docId = `${state.selectedMonthObj.year}-${String(state.selectedMonthObj.month+1).padStart(2,'0')}`;
    const q = query(collection(db, "solicitacoes"), where("monthId", "==", docId), where("status", "==", "pending_leader"));
    onSnapshot(q, (snap) => {
        list.innerHTML = snap.empty ? '<p class="text-center text-gray-500 text-[10px] py-4 opacity-50">Nada pendente.</p>' : '';
        snap.forEach(d => {
            const r = d.data();
            const reqId = d.id;
            const isTurno = r.type === 'troca_turno';
            const accentColor = isTurno ? 'bg-purple-500' : 'bg-orange-500';
            const detailLabel = isTurno ? 'Turno' : 'Com';
            const detailValue = isTurno ? r.desiredShift : r.target;
            list.innerHTML += ` <div class="group relative overflow-hidden rounded-xl bg-[#18181b] border border-white/5 p-3 mb-3 shadow-lg animate-fade-in"> <div class="absolute left-0 top-0 bottom-0 w-1 ${accentColor}"></div> <div class="flex justify-between items-start mb-2 pl-2"> <div class="flex items-center gap-2"> <div class="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center border border-white/10 text-white font-bold text-xs shadow-inner"> ${r.requester.charAt(0)} </div> <div> <h3 class="text-xs font-bold text-white leading-tight">${r.requester}</h3> <div class="text-[8px] text-gray-500 uppercase tracking-widest mt-0.5 font-semibold"> ${r.type.replace(/_/g, ' ')} </div> </div> </div> <div class="text-right"> <div class="text-[8px] font-bold text-white/80 bg-white/5 px-1.5 py-0.5 rounded border border-white/5 tracking-wider"> DIA ${r.dayIndex + 1} </div> </div> </div> <div class="pl-2 mb-3 space-y-2"> <div class="p-2 rounded-lg bg-black/20 border border-white/5 flex items-center justify-between"> <span class="text-[9px] text-gray-500 uppercase font-bold tracking-wider"> ${detailLabel} </span> <span class="text-[10px] font-bold text-white">${detailValue}</span> </div> </div> <div class="pl-2 flex gap-2"> <button onclick="window.processAdminDecision('${reqId}', true)" class="flex-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 border border-emerald-500/20 py-2 rounded-lg text-[9px] font-bold uppercase transition-all"> Aprovar </button> <button onclick="window.processAdminDecision('${reqId}', false)" class="flex-1 bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20 py-2 rounded-lg text-[9px] font-bold uppercase transition-all"> Recusar </button> </div> </div>`;
        });
    });
}

window.processAdminDecision = async (reqId, isApproved) => {
    if (!isApproved) {
        await updateDoc(doc(db, "solicitacoes", reqId), { status: 'rejected' });
        showNotification("Recusada.", "success");
        return;
    }
    try {
        const reqRef = doc(db, "solicitacoes", reqId);
        const reqSnap = await getDoc(reqRef);
        const r = reqSnap.data();
        const docId = r.monthId;
        const batch = writeBatch(db);
        batch.update(reqRef, { status: 'approved' });
        if (r.type === 'troca_turno') {
            const profileRef = doc(db, "colaboradores", r.requesterUid);
            batch.update(profileRef, { horario: r.desiredShift }); 
            const requesterRef = doc(db, "escalas", docId, "plantonistas", r.requesterUid);
            const reqEsc = await getDoc(requesterRef);
            if(reqEsc.exists()) {
                const schedule = reqEsc.data().calculatedSchedule;
                schedule[r.dayIndex] = 'T'; 
                batch.update(requesterRef, { horario: r.desiredShift, calculatedSchedule: schedule });
            }
            await addAuditLog("Mudança Turno", `${r.requester} -> ${r.desiredShift}`);
        } 
        else {
            const requesterRef = doc(db, "escalas", docId, "plantonistas", r.requesterUid);
            const targetRef = doc(db, "escalas", docId, "plantonistas", r.targetUid);
            const [reqEsc, targetEsc] = await Promise.all([getDoc(requesterRef), getDoc(targetRef)]);
            if (!reqEsc.exists() || !targetEsc.exists()) throw new Error("Erro escalas.");
            const reqSchedule = reqEsc.data().calculatedSchedule;
            const targetSchedule = targetEsc.data().calculatedSchedule;
            const idx = r.dayIndex;
            const temp = reqSchedule[idx];
            reqSchedule[idx] = targetSchedule[idx];
            targetSchedule[idx] = temp;
            batch.update(requesterRef, { calculatedSchedule: reqSchedule });
            batch.update(targetRef, { calculatedSchedule: targetSchedule });
            await addAuditLog("Troca Realizada", `${r.requester} <=> ${r.target} (Dia ${idx+1})`);
        }
        await batch.commit();
        showNotification("Aprovado!", "success");
        if (typeof renderDailyDashboard === 'function') renderDailyDashboard();
    } catch (e) { console.error(e); showNotification("Erro.", "error"); }
};

window.switchAdminView = switchAdminView;
window.renderDailyDashboard = renderDailyDashboard;
window.renderLogsTable = internalRenderLogsTable;
window.applyLogFilter = internalApplyLogFilter;
window.exportLogsToCSV = () => { console.log("CSV pending"); }
