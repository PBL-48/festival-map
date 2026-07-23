import { supabase } from './supabaseClient.js';
import { requireAuth } from './sessionGuard.js';
import { buildEventLabel, loadEventsWithRange } from './eventUtils.js';

const whoEl = document.getElementById('who');
const logoutBtn = document.getElementById('logout-btn');
const messageEl = document.getElementById('shift-message');

const shiftForm = document.getElementById('shift-form');
const groupCheckboxesEl = document.getElementById('shift-group-checkboxes');
const circleMembersEl = document.getElementById('circle-members');
const eventSelect = document.getElementById('shift-event-select');
const boothInput = document.getElementById('shift-booth-input');
const boothIdInput = document.getElementById('shift-booth-id');
const boothSuggestions = document.getElementById('shift-booth-suggestions');

let eventBooths = [];
let groups = [];
let selectedGroupIds = new Set();

function showMessage(text, type) {
  messageEl.textContent = text;
  messageEl.className = `message ${type}`;
}
function translateError(error) {
  return `エラーが発生しました: ${error?.message || ''}`;
}

function fillSelect(select, items, placeholder) {
  select.innerHTML = `<option value="">${placeholder}</option>`;
  for (const item of items) {
    const opt = document.createElement('option');
    opt.value = item.id;
    opt.textContent = item.label ?? item.name;
    select.appendChild(opt);
  }
}

// ---------- グループ ----------
async function loadMyGroups(userId) {
  const { data, error } = await supabase
    .from('group_members')
    .select('groups(id, name, event_id)')
    .eq('user_id', userId);

  if (error) { showMessage(translateError(error), 'error'); return []; }
  return (data || []).map((row) => row.groups).filter(Boolean);
}

function renderGroupCheckboxes(targetEventId) {
  groupCheckboxesEl.innerHTML = '';
  selectedGroupIds = new Set();

  const groupsForEvent = groups.filter((group) => group.event_id === targetEventId);
  if (!targetEventId) {
    groupCheckboxesEl.innerHTML = '<p class="group-empty">イベントを選択すると表示されます</p>';
    return;
  }
  if (groupsForEvent.length === 0) {
    groupCheckboxesEl.innerHTML = '<p class="group-empty">このイベントのグループがありません</p>';
    return;
  }

  for (const group of groupsForEvent) {
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = group.id;
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        selectedGroupIds.add(group.id);
      } else {
        selectedGroupIds.delete(group.id);
      }
      renderCircleMembers([...selectedGroupIds]);
    });
    label.append(checkbox, document.createTextNode(group.name));
    groupCheckboxesEl.appendChild(label);
  }
}

async function renderCircleMembers(groupIds) {
  circleMembersEl.innerHTML = '';
  if (!groupIds.length) {
    circleMembersEl.innerHTML = '<li class="empty">グループを選択するとメンバーが表示されます</li>';
    return;
  }

  const { data, error } = await supabase
    .from('group_members')
    .select('profiles(display_name)')
    .in('group_id', groupIds);

  if (error) {
    showMessage(translateError(error), 'error');
    circleMembersEl.innerHTML = '<li class="empty">メンバーが見つかりませんでした</li>';
    return;
  }

  const names = [...new Set((data || []).map((row) => row.profiles?.display_name).filter(Boolean))];
  if (names.length === 0) {
    circleMembersEl.innerHTML = '<li class="empty">メンバーが見つかりませんでした</li>';
    return;
  }

  for (const name of names) {
    const li = document.createElement('li');
    li.textContent = name;
    circleMembersEl.appendChild(li);
  }
}

// ---------- イベント・ブース ----------
async function loadEvents() {
  const result = await loadEventsWithRange(supabase);
  if (result.error) { showMessage(translateError(result.error), 'error'); return []; }
  return result.events.map((event) => ({ ...event, label: buildEventLabel(event) }));
}

async function loadBooths(eventId) {
  const { data, error } = await supabase.from('booths').select('id, name').eq('event_id', eventId).order('name');
  if (error) { showMessage(translateError(error), 'error'); return []; }
  return data || [];
}

function syncBoothSelection() {
  const value = boothInput.value.trim();
  if (!value) {
    boothIdInput.value = '';
    boothInput.setCustomValidity('');
    return;
  }

  const matchedBooth = eventBooths.find((booth) => booth.name.toLowerCase() === value.toLowerCase());
  if (matchedBooth) {
    boothIdInput.value = matchedBooth.id;
    boothInput.setCustomValidity('');
  } else {
    boothIdInput.value = '';
    boothInput.setCustomValidity('候補からブースを選んでください');
  }
}

function renderBoothSuggestions(booths) {
  boothSuggestions.innerHTML = '';
  for (const booth of booths) {
    const opt = document.createElement('option');
    opt.value = booth.name;
    boothSuggestions.appendChild(opt);
  }
}

eventSelect.addEventListener('change', async () => {
  const eventId = eventSelect.value;
  renderGroupCheckboxes(eventId);
  await renderCircleMembers([]);
  boothInput.value = '';
  boothIdInput.value = '';
  boothInput.setCustomValidity('');
  boothSuggestions.innerHTML = '';

  if (!eventId) {
    boothInput.disabled = true;
    return;
  }

  boothInput.disabled = false;
  eventBooths = await loadBooths(eventId);
  renderBoothSuggestions(eventBooths);
});

boothInput.addEventListener('input', syncBoothSelection);
boothInput.addEventListener('change', syncBoothSelection);

// ---------- シフト提出 ----------
function initShiftSubmit(userId) {
  shiftForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    syncBoothSelection();
    if (boothInput.value.trim() && !boothIdInput.value) {
      showMessage('候補からブースを選んでください', 'error');
      return;
    }
    if (selectedGroupIds.size === 0) {
      showMessage('提出するグループを1つ以上選択してください', 'error');
      return;
    }
    if (!eventSelect.value) {
      showMessage('イベントを選択してください', 'error');
      return;
    }

    const commonPayload = {
      user_id: userId,
      event_id: eventSelect.value,
      booth_id: boothIdInput.value || null,
      shift_date: document.getElementById('shift-date').value,
      start_time: document.getElementById('shift-start').value,
      end_time: document.getElementById('shift-end').value,
      note: document.getElementById('shift-note').value.trim() || null,
    };

    const payloads = [...selectedGroupIds].map((groupId) => ({
      ...commonPayload,
      group_id: groupId,
    }));

    const { error } = await supabase.from('shifts').insert(payloads);
    if (error) { showMessage(translateError(error), 'error'); return; }

    showMessage('シフトを提出しました', 'success');
    shiftForm.reset();
    selectedGroupIds = new Set();
    groupCheckboxesEl.innerHTML = '<p class="group-empty">イベントを選択すると表示されます</p>';
    boothInput.disabled = true;
    boothSuggestions.innerHTML = '';
    boothIdInput.value = '';
    boothInput.setCustomValidity('');
    circleMembersEl.innerHTML = '<li class="empty">グループを選択するとメンバーが表示されます</li>';
  });
}

// ---------- 初期化 ----------
const user = await requireAuth();
if (user) {
  const { data: profile } = await supabase.from('profiles').select('display_name').eq('id', user.id).single();
  whoEl.textContent = `${profile?.display_name ?? user.email} でログイン中`;

  groups = await loadMyGroups(user.id);

  const events = await loadEvents();
  fillSelect(eventSelect, events, 'イベントを選択してください');
  boothInput.disabled = true;
  groupCheckboxesEl.innerHTML = '<p class="group-empty">イベントを選択すると表示されます</p>';

  initShiftSubmit(user.id);
}

logoutBtn.addEventListener('click', async () => {
  await supabase.auth.signOut();
  window.location.href = 'auth.html';
});