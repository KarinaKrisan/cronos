// main.js - Orquestrador Central
import { db, auth, state, hideLoader, availableMonths } from './config.js';
import * as Admin from './admin-module.js';
import * as Collab from './collab-module.js';
import { updatePersonalView, switchSubTab, renderMonthSelector, renderWeekendDuty, showNotification } from './ui.js'; 
import { doc, getDoc, collection, getDocs } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

// Funções Globais
window.switchSubTab = switchSubTab;
window.updatePersonalView = updatePersonalView;
window.switchAdminView = Admin.switchAdminView;
window.renderDailyDashboard = Admin.renderDailyDashboard;
window.handleCellClick = (name, dayIndex) => {
    if(state.currentViewMode === 'admin') Admin.handleAdminCellClick(name, dayIndex);
    else Collab.handleCollabCellClick(name, dayIndex);
};

// Logout
async function performLogout() {
    try { await signOut(auth); window.location.href = "start.html"; } 
    catch (e) { console.error("Erro ao sair:", e); }
}
const btnLogout = document.getElementById('btnLogout');
const btnLogoutMobile = document.getElementById('btnLogoutMobile');
if(btnLogout) btnLogout.onclick = performLogout;
if(btnLogoutMobile) btnLogoutMobile.onclick = performLogout;

// Toggle de Modo Duplo
const btnDualMode = document.getElementById('btnDualMode');
if(btnDualMode) {
    btnDualMode.onclick = () => {
        const newMode = state.currentViewMode === 'admin' ? 'collab' : 'admin';
        setInterfaceMode(newMode);
    };
}

// Carregamento de Dados
async function loadData() {
    const docId = `${state.selectedMonthObj.year}-${String(state.selectedMonthObj.month + 1).padStart(2, '0')}`;
    try {
        const rosterRef = collection(db, "escalas", docId, "plantonistas");
        const rosterSnap = await getDocs(rosterRef);

        const detailsRef = collection(db, "colaboradores");
        const detailsSnap = await getDocs(detailsRef);
        
        const detailsMap = {};
        detailsSnap.forEach(doc => { detailsMap[doc.id] = doc.data(); });

        await processScheduleData(rosterSnap, detailsMap);
        
        renderMonthSelector(() => handleMonthChange(-1), () => handleMonthChange(1));

        // Inicializa a interface baseada no modo atual
        setInterfaceMode(state.currentViewMode);
        
        renderWeekendDuty();

    } catch (error) { 
        console.error("Erro ao carregar dados:", error); 
    } finally { 
        hideLoader(); 
    }
}

async function processScheduleData(querySnapshot, detailsMap) {
    const processed = {};
    querySnapshot.forEach((doc) => {
        const emp = doc.data();
        const uid = doc.id;
        const cleanName = (emp.nome || "").trim();
        const extraDetails = detailsMap[uid] || {};

        if (cleanName) {
            processed[cleanName] = {
                uid: uid,
                name: cleanName,
                role: extraDetails.role || emp.role || 'Operador',
                cargo: extraDetails.cargo || emp.cargo || extraDetails.role || 'Operador', 
                setorID: extraDetails.celula || emp.setorID || 'NOC', 
                horario: extraDetails.horario || "08:00 às 17:00", 
                schedule: Array.isArray(emp.calculatedSchedule) ? [...emp.calculatedSchedule] : [],
                email: emp.email || ""
            };
        }
    });
    state.scheduleData = processed;
}

// --- LÓGICA DE ALTERNÂNCIA DE MODO ---
function setInterfaceMode(mode) {
    state.currentViewMode = mode;
    
    const headerIndicator = document.getElementById('headerIndicator');
    const headerSuffix = document.getElementById('headerSuffix');
    const dualText = document.getElementById('dualModeText');
    const dualIcon = document.getElementById('dualModeIcon');
    const btnDual = document.getElementById('btnDualMode');

    // Força a exibição do botão se for Dual Role
    if (state.isDualRole && btnDual) {
        btnDual.classList.remove('hidden');
        btnDual.classList.add('flex');
    }

    if (mode === 'admin') {
        state.isAdmin = true; 
        Admin.initAdminUI();
        Collab.destroyCollabUI(); 

        if(headerIndicator) headerIndicator.className = "w-1 h-5 md:h-8 bg-purple-600 rounded-full shadow-[0_0_15px_#9333ea] transition-colors";
        if(headerSuffix) { headerSuffix.className = "text-purple-500 text-[10px] align-top ml-1"; headerSuffix.innerText = "ADMIN"; }
        
        if(dualText) dualText.innerText = "Colaborador";
        if(dualIcon) dualIcon.className = "fas fa-user-astronaut text-[9px] text-gray-400 group-hover:text-blue-400";
        
    } else {
        state.isAdmin = false; 
        Collab.initCollabUI();
        // Esconde telas de admin explicitamente
        ['screenDaily', 'screenLogs', 'screenApprovals', 'adminTabNav', 'editToolbar'].forEach(id => document.getElementById(id)?.classList.add('hidden'));
        document.getElementById('screenEdit').classList.remove('hidden');

        if(headerIndicator) headerIndicator.className = "w-1 h-5 md:h-8 bg-blue-600 rounded-full shadow-[0_0_15px_#2563eb] transition-colors";
        if(headerSuffix) { headerSuffix.className = "text-blue-500 text-[10px] align-top ml-1"; headerSuffix.innerText = "COLLAB"; }

        if(dualText) dualText.innerText = "Admin";
        if(dualIcon) dualIcon.className = "fas fa-shield-alt text-[9px] text-gray-400 group-hover:text-purple-400";
        
        const myName = state.profile.name || state.profile.nome;
        updatePersonalView(myName);
    }
}

// --- AUTENTICAÇÃO DUPLA ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        state.currentUser = user;
        
        try {
            // Verifica as duas coleções
            const [adminSnap, collabSnap] = await Promise.all([
                getDoc(doc(db, "administradores", user.uid)),
                getDoc(doc(db, "colaboradores", user.uid))
            ]);

            const isAdmin = adminSnap.exists();
            const isCollab = collabSnap.exists();

            state.isDualRole = (isAdmin && isCollab);
            
            console.log(`Login check: Admin=${isAdmin}, Collab=${isCollab}, Dual=${state.isDualRole}`);

            if (state.isDualRole) {
                // Se for ambos, prioriza perfil de Admin para permissões, mas habilita a troca
                state.profile = { ...collabSnap.data(), ...adminSnap.data() }; // Merge para ter dados de ambos
                state.currentViewMode = 'admin'; 
            } else if (isAdmin) {
                state.profile = adminSnap.data();
                state.currentViewMode = 'admin';
            } else if (isCollab) {
                state.profile = collabSnap.data();
                state.currentViewMode = 'collab';
            } else {
                window.location.href = "start.html"; 
                return;
            }

            await loadData();

        } catch (e) {
            console.error("Erro no login:", e);
            window.location.href = "start.html";
        }
    } else { 
        window.location.href = "start.html"; 
    }
});

async function handleMonthChange(direction) {
    const currentIndex = availableMonths.findIndex(m => m.year === state.selectedMonthObj.year && m.month === state.selectedMonthObj.month);
    const newIndex = currentIndex + direction;
    if (newIndex >= 0 && newIndex < availableMonths.length) {
        state.selectedMonthObj = availableMonths[newIndex];
        await loadData();
    }
} 
