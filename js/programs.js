import { supabase } from './supabaseClient.js';
import { requireAuth } from './sessionGuard.js';
import { buildEventLabel, loadEventsWithRange } from './eventUtils.js';

const whoEl = document.getElementById('who');
const logoutBtn = document.getElementById('logout-btn');
const messageEl = document.getElementById('program-message');

const eventSelect = document.getElementById('program-event-select');
const boothInput = document.getElementById('program-booth-input');
const boothIdInput = document.getElementById('program-booth-id');
const boothSuggestions = document.getElementById('program-booth-suggestions');
const createProgramForm = document.getElementById('create-program-form');
const programNameInput = document.getElementById('program-name');
const programOrganizerInput = document.getElementById('program-organizer');
const programListEl = document.getElementById('program-list');

let currentEventId = '';
let eventBooths = [];

function showMessage(text, type) {
  messageEl.textContent = text;
  messageEl.className = `message ${type}`;
}
function translateError(error) {
  return `エラーが発生しました: ${error?.message || ''}`;
}

async function loadEvents() {
  const result = await loadEventsWithRange(supabase);
  if (result.error) showMessage(translateError(result.error), 'error');
  return result.events;
}

async function loadBooths(eventId) {
  if (!eventId) return [];
  const { data, error } = await supabase.from('booths').select('id, name').eq('event_id', eventId).order('name');
  if (error) { showMessage(translateError(error), 'error'); return []; }
  return data || [];
}

async function loadPrograms(boothIds) {
  if (boothIds.length === 0) return [];
  const { data, error } = await supabase
    .from('programs')
    .select('id, booth_id, name, organizer')
    .in('booth_id', boothIds)
    .order('name');
  if (error) { showMessage(translateError(error), 'error'); return []; }
  return data || [];
}

// ---------- ブース入力(文字入力+候補) ----------
function renderBoothSuggestions(booths) {
  boothSuggestions.innerHTML = '';
  for (const booth of booths) {
    const opt = document.createElement('option');
    opt.value = booth.name;
    boothSuggestions.appendChild(opt);
  }
}

function syncBoothSelection() {
  const value = boothInput.value.trim();
  if (!value) {
    boothIdInput.value = '';
    boothInput.setCustomValidity('');
    return;
  }
  const matched = eventBooths.find((b) => b.name.toLowerCase() === value.toLowerCase());
  if (matched) {
    boothIdInput.value = matched.id;
    boothInput.setCustomValidity('');
  } else {
    boothIdInput.value = '';
    boothInput.setCustomValidity('候補からブースを選んでください');
  }
}

boothInput.addEventListener('input', syncBoothSelection);
boothInput.addEventListener('change', syncBoothSelection);

function renderProgramList(programs, booths) {
  programListEl.innerHTML = '';
  if (programs.length === 0) {
    programListEl.innerHTML = '<li class="group-empty">まだ企画がありません</li>';
    return;
  }

  for (const program of programs) {
    const booth = booths.find((b) => b.id === program.booth_id);
    const li = document.createElement('li');
    li.className = 'group-item';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'name';
    nameSpan.textContent = program.organizer ? `${program.name}(${program.organizer})` : program.name;
    if (booth) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = booth.name;
      nameSpan.appendChild(badge);
    }

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'button-secondary';
    editBtn.textContent = '編集';
    editBtn.addEventListener('click', () => startEditProgram(li, program));

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'button-secondary';
    deleteBtn.textContent = '削除';
    deleteBtn.addEventListener('click', () => deleteProgram(program.id));

    const actions = document.createElement('div');
    actions.className = 'item-actions';
    actions.append(editBtn, deleteBtn);

    li.append(nameSpan, actions);
    programListEl.appendChild(li);
  }
}

function startEditProgram(li, program) {
  li.innerHTML = '';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.value = program.name;
  nameInput.placeholder = '企画名';

  const organizerInput = document.createElement('input');
  organizerInput.type = 'text';
  organizerInput.value = program.organizer ?? '';
  organizerInput.placeholder = '出展団体';

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'button-secondary';
  saveBtn.textContent = '保存';
  saveBtn.addEventListener('click', async () => {
    const newName = nameInput.value.trim();
    if (!newName) return;
    const { error } = await supabase
      .from('programs')
      .update({ name: newName, organizer: organizerInput.value.trim() || null })
      .eq('id', program.id);
    if (error) { showMessage(translateError(error), 'error'); return; }
    showMessage('企画を更新しました', 'success');
    await refreshSelectedEvent(currentEventId);
  });

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'link-button';
  cancelBtn.textContent = 'キャンセル';
  cancelBtn.addEventListener('click', () => refreshSelectedEvent(currentEventId));

  const row = document.createElement('div');
  row.className = 'item-edit-row';
  row.append(nameInput, organizerInput, saveBtn, cancelBtn);
  li.appendChild(row);
}

async function deleteProgram(programId) {
  if (!confirm('この企画を削除しますか?')) return;
  const { error } = await supabase.from('programs').delete().eq('id', programId);
  if (error) { showMessage(translateError(error), 'error'); return; }
  showMessage('企画を削除しました', 'success');
  await refreshSelectedEvent(currentEventId);
}

async function refreshSelectedEvent(eventId) {
  currentEventId = eventId;
  eventBooths = await loadBooths(eventId);
  renderBoothSuggestions(eventBooths);
  boothInput.value = '';
  boothIdInput.value = '';
  boothInput.setCustomValidity('');

  const programs = await loadPrograms(eventBooths.map((b) => b.id));
  renderProgramList(programs, eventBooths);
}

async function initEventSelect() {
  const events = await loadEvents();
  eventSelect.innerHTML = '<option value="">イベントを選択してください</option>';
  for (const ev of events) {
    const opt = document.createElement('option');
    opt.value = ev.id;
    opt.textContent = buildEventLabel(ev);
    eventSelect.appendChild(opt);
  }

  const params = new URLSearchParams(window.location.search);
  const paramEventId = params.get('eventId');

  if (paramEventId && events.some((ev) => ev.id === paramEventId)) {
    eventSelect.value = paramEventId;
  } else if (events.length > 0) {
    eventSelect.value = events[0].id;
  }

  await refreshSelectedEvent(eventSelect.value);
}

eventSelect.addEventListener('change', () => refreshSelectedEvent(eventSelect.value));

createProgramForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  syncBoothSelection();

  const boothId = boothIdInput.value;
  const name = programNameInput.value.trim();
  if (!currentEventId || !name) return;
  if (!boothId) {
    showMessage('候補からブースを選んでください', 'error');
    return;
  }

  const { error } = await supabase.from('programs').insert({
    booth_id: boothId,
    name,
    organizer: programOrganizerInput.value.trim() || null,
  });

  if (error) { showMessage(translateError(error), 'error'); return; }

  programNameInput.value = '';
  programOrganizerInput.value = '';
  showMessage('企画を登録しました', 'success');
  await refreshSelectedEvent(currentEventId);
});

const user = await requireAuth();
if (user) {
  const { data: profile } = await supabase.from('profiles').select('display_name').eq('id', user.id).single();
  whoEl.textContent = `${profile?.display_name ?? user.email} でログイン中`;
  await initEventSelect();
}

logoutBtn.addEventListener('click', async () => {
  await supabase.auth.signOut();
  window.location.href = 'auth.html';
});