// ============================================================
// Phrases — a personal lexicon (JSONBin.io Cloud Edition)
// ============================================================

// =======================================================================
// 1. JSONBIN.IO CONFIGURATION
// Paste your Bin ID and API Key (X-Master-Key) below.
// =======================================================================
const JSONBIN_BIN_IDS = [
  "6a8c8eb1f5f4af5e293d4c7d", 
  "6a8ae059f5f4af5e2938446a",
  "6a8c93e2f5f4af5e293d6012"
]; 
const JSONBIN_API_KEY = "$2a$10$t5QN0KmGt2KYGRZx79SWEOq0i8ZKfx1l1G2aIKYdzgflYdqFHvsaW";
const phraseBinMap = {}; // =======================================================================

const STORAGE_KEY = 'phrases.local.cache'; 

// ============ State ============
const state = {
  phrases: [],
  search: '',
  activeTags: [], // Array to support multiple tags
  editingId: null,
  draftTags: [],
  suppressClick: false,
  isSyncing: false,
  selectionMode: false,
  selectedIds: [],
  pinnedTags: []
};

// ============ DOM refs ============
const $ = (sel) => document.querySelector(sel);
const els = {
  list:               $('#phrases-list'),
  tagsFilter:         $('#tags-filter'),
  pinnedTagsFilter:   $('#pinned-tags-filter'),
  searchInput:        $('#search-input'),
  clearBtn:           $('#clear-btn'),
  addBtn:             $('#add-btn'),
  count:              $('#count-display'),
  syncIndicator:      $('#sync-indicator'),
  modal:              $('#modal-backdrop'),
  modalTitle:         $('#modal-title'),
  modalClose:         $('#modal-close'),
  form:               $('#phrase-form'),
  phraseInput:        $('#phrase-input'),
  meaningInput:       $('#meaning-input'),
  tagEditor:          $('#tag-editor'),
  tagInput:           $('#tag-input'),
  tagSuggestions:     $('#tag-suggestions'),
  saveBtn:            $('#save-btn'),
  toast:              $('#toast'),
  selectionBar:       $('#selection-bar'),
  selCount:           $('#sel-count'),
  btnDeleteSelected:  $('#btn-delete-selected'),
  btnCancelSelection: $('#btn-cancel-selection')
};

// ============ Sync Indicator ============
function setSyncStatus(status) {
  els.syncIndicator.classList.remove('syncing', 'error');
  if (status === 'syncing') els.syncIndicator.classList.add('syncing');
  if (status === 'error') els.syncIndicator.classList.add('error');
}

// ============ Cloud Storage (JSONBin) ============
async function loadFromCloud() {
  setSyncStatus('syncing');
  try {
    // Fetch all bins in parallel
    const fetchPromises = JSONBIN_BIN_IDS.map(id => 
      fetch(`https://api.jsonbin.io/v3/b/${id}/latest`, {
        method: 'GET',
        headers: { 'X-Master-Key': JSONBIN_API_KEY }
      }).then(res => {
        if (!res.ok) throw new Error(`Failed to load bin ${id}`);
        return res.json();
      }).catch(err => {
        console.warn(`Failed to load bin ${id}:`, err);
        return null; // Don't break everything if one bin fails
      })
    );

    const results = await Promise.all(fetchPromises);
    
    const allPhrases = [];

    results.forEach((data, index) => {
      const binId = JSONBIN_BIN_IDS[index];
      if (data && data.record && Array.isArray(data.record.phrases)) {
        data.record.phrases.forEach(p => {
          if (p.id && !phraseBinMap[p.id]) { 
            allPhrases.push(p);
            phraseBinMap[p.id] = binId; // Remember which bin this phrase lives in
          }
        });
      }
    });

    state.phrases = allPhrases;
    
    // Save combined array to local cache
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.phrases));
    setSyncStatus('synced');
    return true;
  } catch (e) {
    console.warn('Cloud load failed, trying local cache:', e);
    setSyncStatus('error');
    
    const raw = localStorage.getItem(STORAGE_KEY);
    state.phrases = raw ? JSON.parse(raw) : [];
    showToast('Offline: Showing last saved phrases');
    return false;
  }
}

async function saveToCloud() {
  setSyncStatus('syncing');
  try {
    const binsData = {};
    JSONBIN_BIN_IDS.forEach(id => binsData[id] = []);

    const MAX_BIN_SIZE = 90000; // 90KB limit to be safe (JSONBin max is 100kb)
    let binsAreFull = false;

    state.phrases.forEach(p => {
      let targetBin = phraseBinMap[p.id];
      
      // If it's a new phrase, find a bin that has enough space
      if (!targetBin) {
        targetBin = JSONBIN_BIN_IDS[JSONBIN_BIN_IDS.length - 1]; // fallback to the last bin
        
        for (let i = 0; i < JSONBIN_BIN_IDS.length; i++) {
          const binId = JSONBIN_BIN_IDS[i];
          const currentPayload = JSON.stringify({ status: "active", phrases: binsData[binId] });
          
          // Check size in bytes
          if (new Blob([currentPayload]).size < MAX_BIN_SIZE) {
            targetBin = binId;
            break;
          }
        }
        
        // If we couldn't find a bin with space, we fallback to the last bin, but flag it as full
        const fallbackPayload = JSON.stringify({ status: "active", phrases: binsData[targetBin] });
        if (new Blob([fallbackPayload]).size >= MAX_BIN_SIZE) {
          binsAreFull = true;
        }
      }
      
      // Add phrase to its bin and update the map
      binsData[targetBin].push(p);
      phraseBinMap[p.id] = targetBin;
    });

    // Save each bin
    const savePromises = JSONBIN_BIN_IDS.map(binId => {
      const payload = JSON.stringify({ status: "active", phrases: binsData[binId] });
      return fetch(`https://api.jsonbin.io/v3/b/${binId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Master-Key': JSONBIN_API_KEY
        },
        body: payload
      }).then(res => {
        if (!res.ok) throw new Error(`Save failed for bin ${binId}`);
        return res.json();
      }).catch(err => {
        console.error(`Failed to save bin ${binId}:`, err);
        return null;
      });
    });

    await Promise.all(savePromises);
    
    // Warn the user if they need to make a new bin
    if (binsAreFull) {
      showToast('Warning: All bins are full! Create a new bin ID.');
    }
    
    // Update local cache on success
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.phrases));
    setSyncStatus('synced');
    return true;
  } catch (e) {
    console.warn('Cloud save failed:', e);
    setSyncStatus('error');
    showToast('Offline: Saved locally, will sync later');
    return false;
  }
}
// ============ Utilities ============
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function getAllTags(includePinned = false) {
  const counts = {};
  state.phrases.forEach(p => {
    (p.tags || []).forEach(t => {
      if (includePinned || !state.pinnedTags.includes(t)) {
        counts[t] = (counts[t] || 0) + 1;
      }
    });
  });
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag, count]) => ({ tag, count }));
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
  )[c]);
}

let toastTimer = null;
function showToast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2000);
}

// ============ Filtering ============
function getFiltered() {
  const q = state.search.toLowerCase().trim();
  let filtered = state.phrases.filter(p => {
    // If tags are selected, check if the card has ANY of the selected tags
    if (state.activeTags.length > 0) {
      const hasTag = (p.tags || []).some(t => state.activeTags.includes(t));
      if (!hasTag) return false;
    }
    if (!q) return true;
    const hay = (p.text + ' ' + (p.meaning || '') + ' ' + (p.tags || []).join(' ')).toLowerCase();
    return hay.includes(q);
  });

  // RANDOM FEED LOGIC
  // If no tags are selected AND no search is active, pick 20 random cards
  if (state.activeTags.length === 0 && q === '') {
    // Fisher-Yates shuffle for randomness
    for (let i = filtered.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [filtered[i], filtered[j]] = [filtered[j], filtered[i]];
    }
    filtered = filtered.slice(0, 20); // Show only 20
  } else {
    // Otherwise, sort by date
    filtered.sort((a, b) => b.createdAt - a.createdAt);
  }

  return filtered;
}

// ============ Render ============
function render(animateCards = false) {
  renderTags();
  renderPinnedTags();
  renderList(animateCards);
  renderCount();
}

function renderCount() {
  const n = state.phrases.length;
  if (n === 0) els.count.textContent = 'No phrases';
  else if (n === 1) els.count.textContent = '01 phrase';
  else els.count.textContent = String(n).padStart(2, '0') + ' phrases';
}

function renderTags() {
  const tags = getAllTags(false); 
  els.tagsFilter.innerHTML = '';

  const all = document.createElement('button');
  all.className = 'tag-chip' + (state.activeTags.length === 0 ? ' active' : '');
  all.innerHTML = `All <span class="count">${state.phrases.length}</span>`;
  all.onclick = () => { state.activeTags = []; render(false); };
  els.tagsFilter.appendChild(all);

  tags.forEach(({ tag, count }) => {
    const b = document.createElement('button');
    b.className = 'tag-chip' + (state.activeTags.includes(tag) ? ' active' : '');
    b.innerHTML = `
      ${escapeHtml(tag)} 
      <span class="count">${count}</span> 
      <span class="tag-action pin">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>
      </span>
      <span class="tag-action delete">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </span>
    `;
    b.onclick = () => {
      if (!b.classList.contains('editing')) {
        if (state.activeTags.includes(tag)) {
          state.activeTags = state.activeTags.filter(t => t !== tag);
        } else {
          state.activeTags.push(tag);
        }
        render(false);
      }
    };
    attachTagHoldHandlers(b, tag, false);
    els.tagsFilter.appendChild(b);
  });
}

function renderPinnedTags() {
  els.pinnedTagsFilter.innerHTML = '';
  if (state.pinnedTags.length === 0) {
    els.pinnedTagsFilter.style.display = 'none';
    return;
  }
  els.pinnedTagsFilter.style.display = 'flex';
  
  state.pinnedTags.forEach(tag => {
    const b = document.createElement('button');
    b.className = 'tag-chip pinned' + (state.activeTags.includes(tag) ? ' active' : '');
    const count = state.phrases.filter(p => (p.tags || []).includes(tag)).length;
    b.innerHTML = `
      ${escapeHtml(tag)} 
      <span class="count">${count}</span> 
      <span class="tag-action unpin">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21l18-18"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7"/></svg>
      </span>
      <span class="tag-action delete">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </span>
    `;
    b.onclick = () => {
      if (!b.classList.contains('editing')) {
        if (state.activeTags.includes(tag)) {
          state.activeTags = state.activeTags.filter(t => t !== tag);
        } else {
          state.activeTags.push(tag);
        }
        render(false);
      }
    };
    attachTagHoldHandlers(b, tag, true);
    els.pinnedTagsFilter.appendChild(b);
  });
}

function attachTagHoldHandlers(btn, tag, isPinned) {
  let pressTimer = null;
  let isHolding = false;

  const start = () => {
    isHolding = true;
    document.querySelectorAll('.tag-chip.editing').forEach(c => {
      if (c !== btn) c.classList.remove('editing');
    });
    pressTimer = setTimeout(() => {
      btn.classList.add('editing');
      isHolding = false;
      if (navigator.vibrate) navigator.vibrate(10);
      state.suppressClick = true;
      setTimeout(() => { state.suppressClick = false; }, 100);
    }, 480);
  };

  const move = () => { clearTimeout(pressTimer); isHolding = false; };
  const end = () => { clearTimeout(pressTimer); };

  btn.addEventListener('touchstart', start, { passive: true });
  btn.addEventListener('touchmove', move, { passive: true });
  btn.addEventListener('touchend', end);
  btn.addEventListener('mousedown', start);
  btn.addEventListener('mousemove', move);
  btn.addEventListener('mouseup', end);
  btn.addEventListener('mouseleave', end);

  const pinAction = btn.querySelector(isPinned ? '.unpin' : '.pin');
  const delAction = btn.querySelector('.delete');

  if (pinAction) {
    pinAction.onclick = (e) => {
      e.stopPropagation();
      if (isPinned) {
        state.pinnedTags = state.pinnedTags.filter(t => t !== tag);
      } else {
        state.pinnedTags.push(tag);
      }
      savePinnedTags();
      render(false);
    };
  }

  if (delAction) {
    delAction.onclick = (e) => {
      e.stopPropagation();
      deleteTagFromAllCards(tag);
      if (isPinned) {
        state.pinnedTags = state.pinnedTags.filter(t => t !== tag);
        savePinnedTags();
      }
      render(false);
    };
  }
}

async function deleteTagFromAllCards(tag) {
  state.phrases.forEach(p => {
    if (p.tags) p.tags = p.tags.filter(t => t !== tag);
  });
  showToast('Deleting tag from cloud...');
  await saveToCloud();
}

function savePinnedTags() {
  localStorage.setItem('phrases.pinnedTags', JSON.stringify(state.pinnedTags));
}

function loadPinnedTags() {
  const raw = localStorage.getItem('phrases.pinnedTags');
  state.pinnedTags = raw ? JSON.parse(raw) : [];
}

function renderList(animate) {
  const filtered = getFiltered();
  els.list.innerHTML = '';

  if (state.phrases.length === 0) {
    els.list.innerHTML = `
      <div class="empty-state">
        <div class="icon">"</div>
        <h3>A blank page, waiting.</h3>
        <p>Tap the + to save your first phrase.</p>
      </div>`;
    return;
  }

  if (filtered.length === 0) {
    els.list.innerHTML = `<div class="no-results">Nothing matches your search.</div>`;
    return;
  }

  filtered.forEach((p, i) => {
    const card = document.createElement('article');
    card.className = 'phrase-card' + (animate ? ' animate-in' : '');
    
    if (state.selectionMode) {
      card.classList.add('selectable');
      if (state.selectedIds.includes(p.id)) {
        card.classList.add('selected');
      }
    }
    
    card.dataset.id = p.id;
    if (animate) card.style.animationDelay = (Math.min(i, 8) * 35) + 'ms';

    let actionsHTML = '';
    
    if (state.selectionMode) {
      if (state.selectedIds.includes(p.id)) {
        actionsHTML = `
          <button class="selection-delete-btn" aria-label="Delete selected">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        `;
      }
    } else {
      actionsHTML = `
        <div class="card-actions">
          <button class="action-btn select" data-action="select" aria-label="Select phrase">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 6 9 17l-5-5"/>
            </svg>
          </button>
          <button class="action-btn edit" data-action="edit" aria-label="Edit phrase">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/>
            </svg>
          </button>
          <button class="action-btn delete" data-action="delete" aria-label="Delete phrase">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>
            </svg>
          </button>
        </div>
        <div class="press-indicator"></div>
      `;
    }

    card.innerHTML = `
      <div class="phrase-text">${escapeHtml(p.text)}</div>
      ${p.meaning ? `<div class="phrase-meaning">${escapeHtml(p.meaning)}</div>` : ''}
      ${(p.tags || []).length ? `
        <div class="phrase-tags">
          ${p.tags.map(t => `<span class="phrase-tag">${escapeHtml(t)}</span>`).join('')}
        </div>` : ''
      }
      ${actionsHTML}
    `;

    attachCardHandlers(card, p);
    els.list.appendChild(card);
  }); // END of forEach loop

  // Add the "Refresh" message ONLY ONCE after all cards are done
  if (state.activeTags.length === 0 && state.search === '' && state.phrases.length > 20) {
    const msg = document.createElement('div');
    msg.className = 'no-results';
    msg.style.fontSize = '13px';
    msg.style.fontStyle = 'normal';
    msg.style.fontFamily = 'var(--sans)';
    msg.style.color = 'var(--text-faint)';
    msg.style.marginTop = '20px';
    msg.innerHTML = `Showing 20 random phrases out of ${state.phrases.length}.<br>Refresh the page to discover more.`;
    els.list.appendChild(msg);
  }
} // END of renderList function

// ============ Press-and-hold & Selection ============
function attachCardHandlers(card, phrase) {
  
  if (state.selectionMode) {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.selection-delete-btn')) {
        e.stopPropagation();
        deleteSelected();
        return;
      }
      toggleSelection(phrase.id);
    });
    return;
  }

  let pressTimer = null;
  let pressing = false;
  let longPressed = false;
  let startX = 0, startY = 0;
  const MOVE_THRESHOLD = 10;

  function start(e) {
    if (e.target.closest('.action-btn')) return;
    pressing = true;
    longPressed = false;
    const t = e.touches ? e.touches[0] : e;
    startX = t.clientX;
    startY = t.clientY;
    card.classList.add('pressing');

    pressTimer = setTimeout(() => {
      document.querySelectorAll('.phrase-card.revealed').forEach(c => {
        if (c !== card) c.classList.remove('revealed');
      });
      card.classList.add('revealed');
      card.classList.remove('pressing');
      pressing = false;
      longPressed = true;
      if (navigator.vibrate) navigator.vibrate(12);
      state.suppressClick = true;
      setTimeout(() => { state.suppressClick = false; }, 60);
    }, 480);
  }

  function move(e) {
    if (!pressing) return;
    const t = e.touches ? e.touches[0] : e;
    if (Math.abs(t.clientX - startX) > MOVE_THRESHOLD ||
        Math.abs(t.clientY - startY) > MOVE_THRESHOLD) {
      cancel();
    }
  }

  function cancel() {
    clearTimeout(pressTimer);
    card.classList.remove('pressing');
    pressing = false;
  }

  function end() {
    clearTimeout(pressTimer);
    card.classList.remove('pressing');
    if (!longPressed && pressing && card.classList.contains('revealed')) {
      card.classList.remove('revealed');
    }
    pressing = false;
  }

  card.addEventListener('touchstart',  start, { passive: true });
  card.addEventListener('touchmove',  move,  { passive: true });
  card.addEventListener('touchend',   end);
  card.addEventListener('touchcancel', cancel);
  card.addEventListener('mousedown',   start);
  card.addEventListener('mousemove',   move);
  card.addEventListener('mouseup',     end);
  card.addEventListener('mouseleave',   end);

  const selectBtn = card.querySelector('[data-action="select"]');
  const editBtn = card.querySelector('[data-action="edit"]');
  const delBtn = card.querySelector('[data-action="delete"]');
  
  if (selectBtn) {
    selectBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      enterSelectionMode(phrase.id);
    });
  }
  if (editBtn) {
    editBtn.addEventListener('click', (e) => { 
      e.stopPropagation(); 
      openModal(phrase.id); 
    });
  }
  if (delBtn) {
    delBtn.addEventListener('click', (e) => { 
      e.stopPropagation(); 
      deletePhrase(phrase.id); 
    });
  }
}

function toggleSelection(id) {
  if (state.selectedIds.includes(id)) {
    state.selectedIds = state.selectedIds.filter(i => i !== id);
    if (state.selectedIds.length === 0) {
      toggleSelectionMode();
      return;
    }
  } else {
    state.selectedIds.push(id);
  }
  updateSelectionUI();
  renderList(false);
}

function enterSelectionMode(id) {
  state.selectionMode = true;
  state.selectedIds = [id];
  updateSelectionUI();
  render(false);
}

function updateSelectionUI() {
  els.selCount.textContent = `${state.selectedIds.length} selected`;
  if (state.selectedIds.length > 0) {
    els.selectionBar.classList.add('show');
  } else {
    els.selectionBar.classList.remove('show');
  }
}

function toggleSelectionMode() {
  state.selectionMode = !state.selectionMode;
  if (state.selectionMode) {
    state.selectedIds = [];
  } else {
    state.selectedIds = [];
    els.selectionBar.classList.remove('show');
  }
  updateSelectionUI();
  render(false);
}

async function deleteSelected() {
  const count = state.selectedIds.length;
  state.phrases = state.phrases.filter(p => !state.selectedIds.includes(p.id));
  state.selectedIds = [];
  toggleSelectionMode();
  showToast(`Deleting ${count} phrases from cloud...`);
  await saveToCloud();
}

document.addEventListener('click', (e) => {
  if (state.suppressClick) return;
  if (e.target.closest('.action-btn')) return;
  if (e.target.closest('.tag-action')) return; 
  
  document.querySelectorAll('.tag-chip.editing').forEach(c => c.classList.remove('editing'));
  
  const card = e.target.closest('.phrase-card');
  if (card && card.classList.contains('revealed')) return;
  document.querySelectorAll('.phrase-card.revealed').forEach(c => c.classList.remove('revealed'));
});

// ============ Modal ============
function openModal(id = null) {
  document.querySelectorAll('.phrase-card.revealed').forEach(c => c.classList.remove('revealed'));

  state.editingId = id;
  state.draftTags = [];

  if (id) {
    const p = state.phrases.find(x => x.id === id);
    if (!p) return;
    els.modalTitle.textContent = 'Edit phrase';
    els.phraseInput.value = p.text;
    els.meaningInput.value = p.meaning || '';
    state.draftTags = [...(p.tags || [])];
    els.saveBtn.textContent = 'Update phrase';
  } else {
    els.modalTitle.textContent = 'New phrase';
    els.form.reset();
    els.saveBtn.textContent = 'Save phrase';
  }

  renderTagEditor();
  renderSuggestions();
  els.modal.classList.add('open');
  document.body.style.overflow = 'hidden';
  setTimeout(() => els.phraseInput.focus(), 280);
}

function closeModal() {
  els.modal.classList.remove('open');
  document.body.style.overflow = '';
  state.editingId = null;
  state.draftTags = [];
}

// ============ Tag editor ============
function renderTagEditor() {
  [...els.tagEditor.children].forEach(c => {
    if (c !== els.tagInput) c.remove();
  });
  state.draftTags.forEach(tag => {
    const pill = document.createElement('span');
    pill.className = 'tag-pill';
    pill.innerHTML = `${escapeHtml(tag)}<button type="button" class="remove" aria-label="Remove ${escapeHtml(tag)}">×</button>`;
    pill.querySelector('.remove').onclick = () => {
      state.draftTags = state.draftTags.filter(t => t !== tag);
      renderTagEditor();
      renderSuggestions();
    };
    els.tagEditor.insertBefore(pill, els.tagInput);
  });
}

function renderSuggestions() {
  const all = getAllTags(true).map(t => t.tag); 
  const available = all.filter(t => !state.draftTags.includes(t)).slice(0, 8);
  els.tagSuggestions.innerHTML = '';
  if (available.length === 0) {
    els.tagSuggestions.style.display = 'none';
    return;
  }
  els.tagSuggestions.style.display = 'flex';
  available.forEach(tag => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tag-suggestion';
    b.textContent = '+ ' + tag;
    b.onclick = () => {
      if (!state.draftTags.includes(tag)) {
        state.draftTags.push(tag);
        renderTagEditor();
        renderSuggestions();
      }
    };
    els.tagSuggestions.appendChild(b);
  });
}

function addTagFromInput() {
  let v = els.tagInput.value.trim();
  v = v.replace(/,+$/, '').trim();
  if (!v) return;
  if (v.length > 30) v = v.slice(0, 30);
  if (!state.draftTags.includes(v)) {
    state.draftTags.push(v);
    renderTagEditor();
    renderSuggestions();
  }
  els.tagInput.value = '';
}

els.tagInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ',' || e.key === 'Tab') {
    if (els.tagInput.value.trim()) {
      e.preventDefault();
      addTagFromInput();
    }
  } else if (e.key === 'Backspace' && !els.tagInput.value && state.draftTags.length) {
    state.draftTags.pop();
    renderTagEditor();
    renderSuggestions();
  }
});

els.tagEditor.addEventListener('click', (e) => {
  if (e.target === els.tagEditor) els.tagInput.focus();
});

// ============ CRUD ============
async function savePhrase(e) {
  e.preventDefault();
  if (els.tagInput.value.trim()) addTagFromInput();

  const text = els.phraseInput.value.trim();
  const meaning = els.meaningInput.value.trim();
  if (!text) { els.phraseInput.focus(); return; }

  if (state.editingId) {
    const p = state.phrases.find(x => x.id === state.editingId);
    if (p) {
      p.text = text;
      p.meaning = meaning;
      p.tags = [...state.draftTags];
    }
    showToast('Updating cloud...');
  } else {
    state.phrases.unshift({
      id: uid(),
      text,
      meaning,
      tags: [...state.draftTags],
      createdAt: Date.now()
    });
    showToast('Saving to cloud...');
  }

  render(false);
  closeModal();
  await saveToCloud();
}

async function deletePhrase(id) {
  state.phrases = state.phrases.filter(p => p.id !== id);
  render(false);
  showToast('Deleting from cloud...');
  await saveToCloud();
}

// ============ Event wiring ============
els.addBtn.addEventListener('click', () => openModal());
els.btnDeleteSelected.addEventListener('click', deleteSelected);
els.btnCancelSelection.addEventListener('click', toggleSelectionMode);
els.modalClose.addEventListener('click', closeModal);
els.modal.addEventListener('click', (e) => {
  if (e.target === els.modal) closeModal();
});
els.form.addEventListener('submit', savePhrase);

els.searchInput.addEventListener('input', (e) => {
  state.search = e.target.value;
  els.clearBtn.style.display = state.search ? 'flex' : 'none';
  renderList(false);
});

els.clearBtn.addEventListener('click', () => {
  els.searchInput.value = '';
  state.search = '';
  els.clearBtn.style.display = 'none';
  renderList(false);
  els.searchInput.focus();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && els.modal.classList.contains('open')) closeModal();
  if (e.key === 'Escape' && state.selectionMode) toggleSelectionMode();
});

// ============ Init ============
async function init() {
  loadPinnedTags();
  await loadFromCloud();
  render(true);
}

init();
