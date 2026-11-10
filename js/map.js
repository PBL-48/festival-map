import { supabase } from './supabaseClient.js';
import { requireAuth } from './sessionGuard.js';

const whoEl = document.getElementById('who');
const logoutBtn = document.getElementById('logout-btn');
const messageEl = document.getElementById('map-message');
const eventSelect = document.getElementById('event-select');
const eventSelectCard = document.getElementById('event-select-card');
const groupCheckboxesEl = document.getElementById('group-checkboxes');
const shiftListEl = document.getElementById('onshift-list'); // シフト一覧の器（id は既存のまま）

function showMessage(text, type) {
  if (!messageEl) return;
  messageEl.textContent = text;
  messageEl.className = `message ${type}`;
}
function clearMessage() {
  if (!messageEl) return;
  messageEl.textContent = '';
  messageEl.className = 'message';
}
function translateError(error) {
  return `エラーが発生しました: ${error?.message || ''}`;
}
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}
function formatTime(t) { return t ? String(t).slice(0, 5) : ''; }

const pad2 = (n) => String(n).padStart(2, '0');
const hm = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const dateKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
function formatDateLabel(d) {
  const wd = '日月火水木金土'[d.getDay()];
  const isToday = dateKey(d) === dateKey(new Date());
  return `${d.getMonth() + 1}/${d.getDate()}(${wd})${isToday ? ' 今日' : ''}`;
}

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
let loadSeq = 0;              // イベント切替・絞り込みの競合防止用

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

// ---------- 時刻判定（ローカル時刻・日付またぎ対応） ----------
// 'YYYY-MM-DDTHH:MM'（タイムゾーン指定なし）はローカル時刻として解釈される
function getShiftRange(shift) {
  if (!shift.shift_date || !shift.start_time || !shift.end_time) return null;
  const start = new Date(`${shift.shift_date}T${formatTime(shift.start_time)}`);
  const end = new Date(`${shift.shift_date}T${formatTime(shift.end_time)}`);
  if (isNaN(start) || isNaN(end)) return null;
  if (end <= start) end.setDate(end.getDate() + 1); // 22:00〜02:00 など
  return { start, end };
}

function isShiftActiveNow(shift, now = new Date()) {
  const r = getShiftRange(shift);
  return !!r && r.start <= now && now < r.end;
}

function isShiftUpcomingOrActive(shift, now = new Date()) {
  const r = getShiftRange(shift);
  return !!r && r.end > now; // 終了済みは除外
}

function isBoothActiveNow(boothId, now = new Date()) {
  return shifts.some((s) => s.booth_id === boothId && selectedGroupIds.has(s.group_id) && isShiftActiveNow(s, now));
}

// 企画名があれば「企画名(場所)」、なければ「場所」だけ
function shiftLocationLabel(shift) {
  const booth = booths.find((b) => b.id === shift.booth_id);
  const program = programs.find((p) => p.id === shift.program_id);
  return program
    ? `${program.name}(${booth?.name ?? '場所未設定'})`
    : (booth?.name ?? '場所未設定');
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

// ---------- シフト一覧パネル ----------
function renderShiftList() {
  if (!shiftListEl) return;
  const now = new Date();

  const list = shifts
    .filter((s) => selectedGroupIds.has(s.group_id) && isShiftUpcomingOrActive(s, now))
    .sort((a, b) => getShiftRange(a).start - getShiftRange(b).start);

  shiftListEl.innerHTML = '';
  if (list.length === 0) {
    shiftListEl.innerHTML = '<p class="group-empty">これからのシフトはありません</p>';
    return;
  }

  let lastDateKey = null;
  for (const s of list) {
    const { start, end } = getShiftRange(s);

    // 日付が変わるごとに見出しを入れる
    const key = dateKey(start);
    if (key !== lastDateKey) {
      const heading = document.createElement('div');
      heading.className = 'shift-date-heading';
      heading.textContent = formatDateLabel(start);
      shiftListEl.appendChild(heading);
      lastDateKey = key;
    }

    const active = isShiftActiveNow(s, now);
    const booth = booths.find((b) => b.id === s.booth_id);

    const div = document.createElement('div');
    div.className = 'onshift-item';
    if (active) div.classList.add('onshift-item--active');
    if (booth) div.classList.add('onshift-item--clickable');

    div.innerHTML = `
      <span class="onshift-time">
        ${hm(start)}〜${hm(end)}
        ${active ? '<span class="onshift-badge">シフト中</span>' : ''}
      </span>
      <span class="onshift-name">${escapeHtml(s.profiles?.display_name ?? '')}</span>
      <span class="booth">${escapeHtml(shiftLocationLabel(s))}</span>
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

    shiftListEl.appendChild(div);
  }
}

// ---------- ポップアップ ----------
function shiftLineHtml(s) {
  const isActive = isShiftActiveNow(s);
  return `<span class="${isActive ? 'shift-active-now' : 'shift-inactive-now'}">`
    + `${isActive ? '● ' : ''}${escapeHtml(s.profiles?.display_name ?? '')} ${formatTime(s.start_time)}〜${formatTime(s.end_time)}`
    + `</span>`;
}

function boothPopupHtml(booth) {
  const boothPrograms = programs.filter((p) => p.booth_id === booth.id);
  const boothShifts = shifts.filter((s) => s.booth_id === booth.id && selectedGroupIds.has(s.group_id));

  let html = `<div class="booth-popup"><h3>${escapeHtml(booth.name)}</h3>`;

  if (boothPrograms.length > 0) {
    // 企画ごとにシフトを表示
    for (const prog of boothPrograms) {
      const progShifts = boothShifts.filter((s) => s.program_id === prog.id);

      html += `<div class="popup-program">`;
      html += `<span class="popup-program-name">${escapeHtml(prog.name)}`;
      if (prog.organizer) html += `<span class="popup-organizer">(${escapeHtml(prog.organizer)})</span>`;
      html += `</span>`;

      if (progShifts.length > 0) {
        html += `<div class="popup-shifts">${progShifts.map(shiftLineHtml).join('<br>')}</div>`;
      }
      html += `</div>`;
    }

    // 企画と紐づいていないシフト
    const orphanShifts = boothShifts.filter((s) => !s.program_id);
    if (orphanShifts.length > 0) {
      html += `<div class="popup-section"><span class="label">その他のシフト</span><br>`;
      html += orphanShifts.map(shiftLineHtml).join('<br>');
      html += `</div>`;
    }
  } else {
    // 企画未登録ブース
    html += `<div class="popup-section"><span class="label">企画</span>未登録</div>`;
    if (boothShifts.length > 0) {
      html += `<div class="popup-section"><span class="label">シフト</span><br>`;
      html += boothShifts.map(shiftLineHtml).join('<br>');
      html += `</div>`;
    }
  }

  html += `</div>`;
  return html;
}

// ---------- マーカー描画 ----------
function renderMarkers({ fit = false } = {}) {
  if (!markerLayer) return;
  markerLayer.clearLayers();
  boothMarkers.clear();

  const now = new Date();
  for (const booth of booths) {
    const icon = isBoothActiveNow(booth.id, now) ? boothIconActive : boothIconInactive;
    const marker = L.marker([booth.lat, booth.lng], { icon });
    marker.bindPopup(() => boothPopupHtml(booth), {
      className: 'booth-tooltip',
      maxWidth: 260,
      autoPan: true,
    });
    marker.addTo(markerLayer);
    boothMarkers.set(booth.id, marker); // クリックジャンプ用に保持
  }

  // 表示範囲の自動調整はイベント読み込み時のみ（定期更新で視点が戻らないように）
  if (fit && booths.length > 0) {
    const bounds = L.latLngBounds(booths.map((b) => [b.lat, b.lng]));
    leafletMap.fitBounds(bounds, { padding: [40, 40], maxZoom: 18 });
  }
}

// 定期更新用：マーカーを作り直さずアイコンだけ切り替える（開いているポップアップを閉じない）
function updateMarkerIcons() {
  const now = new Date();
  for (const [boothId, marker] of boothMarkers) {
    marker.setIcon(isBoothActiveNow(boothId, now) ? boothIconActive : boothIconInactive);
  }
}

// ---------- 更新 ----------
async function refreshShiftsAndPanels() {
  const seq = ++loadSeq;
  const result = await loadShifts([...selectedGroupIds]);
  if (seq !== loadSeq) return; // より新しい操作が走っていれば破棄
  shifts = result;
  renderShiftList();
  renderMarkers();
}

async function loadEventData(eventId) {
  const seq = ++loadSeq;
  clearMessage();
  currentEventId = eventId;
  groupsForEvent = allUserGroups.filter((g) => g.eventId === eventId);
  selectedGroupIds = new Set(groupsForEvent.map((g) => g.id));
  renderGroupCheckboxes();

  const [b, p, s] = await Promise.all([
    loadBooths(eventId),
    loadProgramsForEvent(eventId),
    loadShifts([...selectedGroupIds]),
  ]);
  if (seq !== loadSeq) return; // 読み込み中に別イベントへ切り替えられた場合は破棄

  booths = b;
  programs = p;
  shifts = s;

  renderMarkers({ fit: true });
  renderShiftList();
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

// 1分ごとに再判定（ハイライト更新・終了済みシフトの除外）
setInterval(() => {
  if (!markerLayer) return;
  renderShiftList();
  updateMarkerIcons();
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
    if (eventSelect) {
      eventSelect.innerHTML = eventList
        .map((ev) => `<option value="${escapeHtml(ev.id)}">${escapeHtml(ev.name || '(名称未設定のイベント)')}</option>`)
        .join('');
      eventSelect.value = eventList[0].id;
      eventSelect.addEventListener('change', () => loadEventData(eventSelect.value));
      // 複数イベントのときだけ表示（常に表示したいなら条件を外す）
      if (eventSelectCard) eventSelectCard.hidden = eventList.length <= 1;
      else eventSelect.hidden = eventList.length <= 1;
    }
    await loadEventData(eventList[0].id);
  }
}

logoutBtn.addEventListener('click', async () => {
  await supabase.auth.signOut();
  window.location.href = 'auth.html';
});