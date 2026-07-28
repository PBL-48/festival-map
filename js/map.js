import { supabase } from './supabaseClient.js';
import { requireAuth } from './sessionGuard.js';

const whoEl = document.getElementById('who');
const logoutBtn = document.getElementById('logout-btn');
const messageEl = document.getElementById('map-message');
const eventSelect = document.getElementById('event-select');
const groupCheckboxesEl = document.getElementById('group-checkboxes');
const onshiftListEl = document.getElementById('onshift-list');

function showMessage(text, type) {
  messageEl.textContent = text;
  messageEl.className = `message ${type}`;
}
function translateError(error) {
  return `エラーが発生しました: ${error?.message || ''}`;
}
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}
function formatTime(t) { return t ? t.slice(0, 5) : ''; }

// ---------- 状態 ----------
let currentUser = null;
let allUserGroups = [];
let currentEventId = null;
let groupsForEvent = [];
let selectedGroupIds = new Set();
let booths = [];
let programs = [];
let shifts = [];
let leafletMap = null;
let markerLayer = null;
let boothMarkers = new Map(); // booth.id → Leaflet marker

// ---------- アイコン ----------
const boothIconActive = L.divIcon({
  className: 'booth-pin booth-pin-active',
  html: `<svg viewBox="0 0 24 32" xmlns="http://www.w3.org/2000/svg">
    <path style="fill:var(--color-error)" d="M12 0C5.4 0 0 5.4 0 12c0 9 12 20 12 20s12-11 12-20C24 5.4 18.6 0 12 0z"/>
    <circle cx="12" cy="12" r="5" fill="#fff"/>
  </svg>`,
  iconSize: [28, 38],
  iconAnchor: [14, 38],
});

const boothIconInactive = L.divIcon({
  className: 'booth-pin booth-pin-inactive',
  html: `<svg viewBox="0 0 24 32" xmlns="http://www.w3.org/2000/svg">
    <path style="fill:#B7AF9E" d="M12 0C5.4 0 0 5.4 0 12c0 9 12 20 12 20s12-11 12-20C24 5.4 18.6 0 12 0z"/>
    <circle cx="12" cy="12" r="5" fill="#fff"/>
  </svg>`,
  iconSize: [28, 38],
  iconAnchor: [14, 38],
});

// ---------- データ取得 ----------
async function loadUserGroups(userId) {
  const { data, error } = await supabase
    .from('group_members')
    .select('groups(id, name, event_id, events(name))')
    .eq('user_id', userId);
  if (error) { showMessage(translateError(error), 'error'); return []; }
  return (data || []).filter((row) => row.groups).map((row) => ({
    id: row.groups.id,
    name: row.groups.name,
    eventId: row.groups.event_id,
    eventName: row.groups.events?.name ?? '',
  }));
}

async function loadBooths(eventId) {
  const { data, error } = await supabase.from('booths').select('id, name, lat, lng').eq('event_id', eventId);
  if (error) { showMessage(translateError(error), 'error'); return []; }
  return (data || []).filter((b) => b.lat != null && b.lng != null);
}

async function loadProgramsForEvent(eventId) {
  if (!eventId) return [];
  const { data, error } = await supabase
    .from('programs')
    .select('id, booth_id, name, organizer, booths!inner(event_id)')
    .eq('booths.event_id', eventId);
  if (error) { showMessage(translateError(error), 'error'); return []; }
  return data || [];
}

async function loadShifts(groupIds) {
  if (groupIds.length === 0) return [];
  const { data, error } = await supabase
    .from('shifts')
    .select('id, group_id, booth_id, program_id, shift_date, start_time, end_time, note, profiles(display_name)')
    .in('group_id', groupIds);
  if (error) { showMessage(translateError(error), 'error'); return []; }
  return data || [];
}

// ---------- アクティブ判定 ----------
function isShiftActiveNow(shift) {
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const nowTime = now.toTimeString().slice(0, 5);
  return shift.shift_date === todayStr &&
    (shift.start_time?.slice(0, 5) ?? '') <= nowTime &&
    nowTime <= (shift.end_time?.slice(0, 5) ?? '');
}

function isBoothActiveNow(boothId) {
  return shifts.some((s) => s.booth_id === boothId && selectedGroupIds.has(s.group_id) && isShiftActiveNow(s));
}

// ---------- グループチェックボックス ----------
function renderGroupCheckboxes() {
  groupCheckboxesEl.innerHTML = '';
  if (groupsForEvent.length === 0) {
    groupCheckboxesEl.innerHTML = '<p class="group-empty">このイベントに参加しているグループがありません</p>';
    return;
  }
  for (const g of groupsForEvent) {
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selectedGroupIds.has(g.id);
    checkbox.addEventListener('change', async () => {
      if (checkbox.checked) selectedGroupIds.add(g.id);
      else selectedGroupIds.delete(g.id);
      await refreshShiftsAndPanels();
    });
    label.append(checkbox, document.createTextNode(g.name));
    groupCheckboxesEl.appendChild(label);
  }
}

// ---------- 現在シフト中パネル ----------
function renderOnShiftPanel() {
  const active = shifts.filter((s) => selectedGroupIds.has(s.group_id) && isShiftActiveNow(s));

  onshiftListEl.innerHTML = '';
  if (active.length === 0) {
    onshiftListEl.innerHTML = '<p class="group-empty">現在シフト中のメンバーはいません</p>';
    return;
  }

  for (const s of active) {
    const booth = booths.find((b) => b.id === s.booth_id);
    const program = programs.find((p) => p.id === s.program_id);

    const div = document.createElement('div');
    div.className = 'onshift-item';
    if (booth) div.classList.add('onshift-item--clickable');

    // 企画名があれば「企画名(場所)」、なければ「場所」だけ
    const locationLabel = program
      ? `${program.name}(${booth?.name ?? '場所未設定'})`
      : (booth?.name ?? '場所未設定');

    div.innerHTML = `
      <span class="onshift-name">${escapeHtml(s.profiles?.display_name ?? '')}</span>
      <span class="booth">${escapeHtml(locationLabel)}</span>
    `;

    // クリックで該当ピンを開く
    if (booth) {
      div.addEventListener('click', () => {
        const marker = boothMarkers.get(booth.id);
        if (!marker) return;
        leafletMap.setView([booth.lat, booth.lng], Math.max(leafletMap.getZoom(), 17), { animate: true });
        marker.openPopup();
      });
    }

    onshiftListEl.appendChild(div);
  }
}

// ---------- ポップアップ ----------
function boothPopupHtml(booth) {
  const boothPrograms = programs.filter((p) => p.booth_id === booth.id);
  const boothShifts = shifts.filter((s) => s.booth_id === booth.id && selectedGroupIds.has(s.group_id));

  let html = `<div class="booth-popup"><h3>${escapeHtml(booth.name)}</h3>`;

  // 企画一覧(シフトと統合して企画ごとに表示)
  if (boothPrograms.length > 0) {
    for (const prog of boothPrograms) {
      const progShifts = boothShifts.filter((s) => s.program_id === prog.id);
      const unlinkedShifts = boothShifts.filter((s) => !s.program_id);

      html += `<div class="popup-program">`;
      html += `<span class="popup-program-name">${escapeHtml(prog.name)}`;
      if (prog.organizer) html += `<span class="popup-organizer">(${escapeHtml(prog.organizer)})</span>`;
      html += `</span>`;

      if (progShifts.length > 0) {
        html += `<div class="popup-shifts">`;
        for (const s of progShifts) {
          const isActive = isShiftActiveNow(s);
          html += `<span class="${isActive ? 'shift-active-now' : 'shift-inactive-now'}">`;
          html += `${isActive ? '● ' : ''}${escapeHtml(s.profiles?.display_name ?? '')} ${formatTime(s.start_time)}〜${formatTime(s.end_time)}`;
          html += `</span><br>`;
        }
        html += `</div>`;
      }

      html += `</div>`;
    }

    // program_idがないシフト(企画と紐づいていないシフト)があれば最後に表示
    const orphanShifts = boothShifts.filter((s) => !s.program_id);
    if (orphanShifts.length > 0) {
      html += `<div class="popup-section"><span class="label">その他のシフト</span><br>`;
      html += orphanShifts.map((s) => {
        const isActive = isShiftActiveNow(s);
        return `<span class="${isActive ? 'shift-active-now' : 'shift-inactive-now'}">${isActive ? '● ' : ''}${escapeHtml(s.profiles?.display_name ?? '')} ${formatTime(s.start_time)}〜${formatTime(s.end_time)}</span>`;
      }).join('<br>');
      html += `</div>`;
    }
  } else {
    // 企画未登録ブース
    html += `<div class="popup-section"><span class="label">企画</span>未登録</div>`;
    if (boothShifts.length > 0) {
      html += `<div class="popup-section"><span class="label">シフト</span><br>`;
      html += boothShifts.map((s) => {
        const isActive = isShiftActiveNow(s);
        return `<span class="${isActive ? 'shift-active-now' : 'shift-inactive-now'}">${isActive ? '● ' : ''}${escapeHtml(s.profiles?.display_name ?? '')} ${formatTime(s.start_time)}〜${formatTime(s.end_time)}</span>`;
      }).join('<br>');
      html += `</div>`;
    }
  }

  html += `</div>`;
  return html;
}

// ---------- マーカー描画 ----------
function renderMarkers() {
  markerLayer.clearLayers();
  boothMarkers.clear();

  for (const booth of booths) {
    const icon = isBoothActiveNow(booth.id) ? boothIconActive : boothIconInactive;
    const marker = L.marker([booth.lat, booth.lng], { icon });
    marker.bindPopup(() => boothPopupHtml(booth), {
      className: 'booth-tooltip',
      maxWidth: 260,
      autoPan: true,
    });
    marker.addTo(markerLayer);
    boothMarkers.set(booth.id, marker); // クリックジャンプ用に保持
  }

  if (booths.length > 0) {
    const bounds = L.latLngBounds(booths.map((b) => [b.lat, b.lng]));
    leafletMap.fitBounds(bounds, { padding: [40, 40], maxZoom: 18 });
  }
}

// ---------- 更新 ----------
async function refreshShiftsAndPanels() {
  shifts = await loadShifts([...selectedGroupIds]);
  renderOnShiftPanel();
  renderMarkers();
}

async function loadEventData(eventId) {
  currentEventId = eventId;
  groupsForEvent = allUserGroups.filter((g) => g.eventId === eventId);
  selectedGroupIds = new Set(groupsForEvent.map((g) => g.id));
  renderGroupCheckboxes();

  booths = await loadBooths(eventId);
  programs = await loadProgramsForEvent(eventId);
  shifts = await loadShifts([...selectedGroupIds]);

  renderMarkers();
  renderOnShiftPanel();
}

// ---------- 地図初期化 ----------
function initLeafletMap() {
  leafletMap = L.map('leaflet-map').setView([35.6812, 139.7671], 16);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(leafletMap);
  markerLayer = L.layerGroup().addTo(leafletMap);

  const resizeMap = () => leafletMap.invalidateSize();
  window.addEventListener('resize', resizeMap);
  window.addEventListener('orientationchange', resizeMap);
  requestAnimationFrame(() => setTimeout(resizeMap, 50));
}

// 1分ごとに再判定
setInterval(() => {
  renderOnShiftPanel();
  renderMarkers();
}, 60000);

// ---------- 初期化 ----------
currentUser = await requireAuth();
if (currentUser) {
  const { data: profile } = await supabase.from('profiles').select('display_name').eq('id', currentUser.id).single();
  whoEl.textContent = `${profile?.display_name ?? currentUser.email} でログイン中`;

  allUserGroups = await loadUserGroups(currentUser.id);
  const eventMap = new Map();
  for (const g of allUserGroups) {
    if (g.eventId) eventMap.set(g.eventId, g.eventName);
  }
  const eventList = [...eventMap.entries()].map(([id, name]) => ({ id, name }));

  initLeafletMap();

  if (eventList.length === 0) {
    showMessage('まだどのグループにも参加していません。先に「グループ」からグループの作成・参加を行ってください。', 'error');
  } else {
    if (eventList.length > 1) {
      eventSelect.hidden = false;
      eventSelect.innerHTML = eventList.map((ev) => `<option value="${ev.id}">${escapeHtml(ev.name)}</option>`).join('');
      eventSelect.addEventListener('change', () => loadEventData(eventSelect.value));
    }
    await loadEventData(eventList[0].id);
  }
}

logoutBtn.addEventListener('click', async () => {
  await supabase.auth.signOut();
  window.location.href = 'auth.html';
});