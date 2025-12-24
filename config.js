// config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyCBKSPH7lfUt0VsQPhJX3a0CQ2wYcziQvM",
    authDomain: "dadosescala.firebaseapp.com",
    projectId: "dadosescala",
    storageBucket: "dadosescala.firebasestorage.app",
    messagingSenderId: "117221956502",
    appId: "1:117221956502:web:e5a7f051daf3306b501bb7"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

const d = new Date();
export const state = {
    isAdmin: false,
    isCollab: false,
    isDualRole: false,
    currentViewMode: 'collab',
    currentUser: null,
    profile: null, 
    scheduleData: {}, 
    selectedMonthObj: { year: 2025, month: 11 }, 
    activeRequestType: 'troca_dia_trabalho'
};

export const monthNames = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];

const generateMonths = () => {
    const list = [{ year: 2025, month: 11 }];
    for (let m = 0; m <= 11; m++) {
        list.push({ year: 2026, month: m });
    }
    return list;
};
export const availableMonths = generateMonths();

// --- FUNÇÕES DE UTILIDADE ---

export function hideLoader() {
    const overlay = document.getElementById('appLoadingOverlay');
    if(overlay) {
        overlay.classList.add('opacity-0');
        setTimeout(() => overlay.classList.add('hidden'), 500);
    }
}

export function pad(n) { return n < 10 ? '0' + n : n; }

export function getDaysInMonth(year, month) {
    const date = new Date(year, month, 1);
    const days = [];
    while (date.getMonth() === month) {
        days.push(new Date(date));
        date.setDate(date.getDate() + 1);
    }
    return days;
}

// --- VALIDAÇÃO DE DATA DE TURNO ---
export function isValidShiftStartDate(dateVal) {
    if (!dateVal) return false;
    // Formato YYYY-MM-DD. Pega o dia (última parte)
    const day = parseInt(dateVal.split('-')[2]);
    // Regra: Somente após o fechamento (dia 25). Logo, dia > 25 (26, 27...)
    return day > 25; 
}

export function isWorkingTime(timeRange) {
    if (!timeRange || typeof timeRange !== 'string' || ['F', 'FS', 'FD', 'FE', 'A', 'LM'].includes(timeRange)) return false; 
    const times = timeRange.match(/(\d{1,2}:\d{2})/g);
    if (!times || times.length < 2) return false;
    
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const [startH, startM] = times[0].split(':').map(Number);
    const [endH, endM] = times[1].split(':').map(Number);
    
    const startTotal = startH * 60 + startM;
    const endTotal = endH * 60 + endM;
    
    if (endTotal < startTotal) { 
        return (currentMinutes >= startTotal || currentMinutes < endTotal);
    }
    return (currentMinutes >= startTotal && currentMinutes < endTotal);
}
