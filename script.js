// ============================================================
// Phrases — Personal Lexicon
// JSONBin.io Cloud Edition
//
// IMPORTANT:
// 1. Keep your existing 8 BIN IDs below.
// 2. Replace JSONBIN_API_KEY with your NEW/ROTATED API key.
// 3. Database schema:
//      {
//        id: "unique-id",
//        expression: "English expression",
//        tags: ["Descriptive"]
//      }
// ============================================================


// =======================================================================
// 1. JSONBIN.IO CONFIGURATION
// =======================================================================

const JSONBIN_BIN_IDS = [
  "6a8c8eb1f5f4af5e293d4c7d", 
  "6a8ae059f5f4af5e2938446a",
  "6a8c93e2f5f4af5e293d6012",
  "6a8cac9eda38895dfe0c1f64",
  "6a8ca826f5f4af5e293da17b",
  "6a8cb032f5f4af5e293dbe46",
  "6a8cb11df5f4af5e293dc17c",
  "6a8cb1eff5f4af5e293dc3f5"
];
// IMPORTANT: Do NOT use the API key you previously pasted.
// Rotate it in JSONBin and place the new key here.
const JSONBIN_API_KEY = "$2a$10$0dH1LXansfpglhcBp0tRzuqI.DBNyYqAF2iQxCH4fIOhn4MmK02au";


// =======================================================================
// 2. STORAGE CONFIGURATION
// =======================================================================

const STORAGE_KEY = 'phrases.local.cache';
const BIN_INDEX_KEY = 'phrases.bin.index';
const DATABASE_STATS_KEY = 'phrases.database.stats';


// JSONBin is limited in payload size.
// Keep some safety margin instead of using the absolute maximum.
const MAX_BIN_SIZE = 90000;


// =======================================================================
// 3. APPLICATION STATE
// =======================================================================

const state = {

  // All loaded phrases from all bins.
  phrases: [],

  // Search/filter state.
  search: '',
  activeTags: [],

  // Editing.
  editingId: null,
  draftTags: [],

  // UI.
  suppressClick: false,
  isSyncing: false,
  selectionMode: false,
  selectedIds: [],

  // Pinned tags.
  pinnedTags: [],

  // Database information.
  databaseStats: {
    total: 0,
    unique: 0,
    duplicates: 0,
    invalid: 0,
    failedBins: 0,
    bins: []
  }
};


// =======================================================================
// 4. DOM REFERENCES
// =======================================================================

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


// =======================================================================
// 5. BIN INDEX
//
// This maps:
//      phrase ID -> bin ID
//
// Example:
//      {
//        "K7mQ2xV9aL4pR8": "BIN_ID_1",
//        "B4tN8zC1wH6yP3": "BIN_ID_1"
//      }
//
// It allows us to modify only the bin containing a phrase.
// =======================================================================

const phraseBinMap = {};


// =======================================================================
// 6. SYNC STATUS
// =======================================================================

function setSyncStatus(status) {

  if (!els.syncIndicator) return;

  els.syncIndicator.classList.remove('syncing', 'error');

  if (status === 'syncing') {
    els.syncIndicator.classList.add('syncing');
  }

  if (status === 'error') {
    els.syncIndicator.classList.add('error');
  }
}


// =======================================================================
// 7. BASIC UTILITIES
// =======================================================================

function uid() {

  // Generate a reasonably unique ID for NEW records only.
  return (
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 10)
  );
}


function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


function escapeHtml(value) {

  return String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[c]);
}


let toastTimer = null;

function showToast(msg) {

  if (!els.toast) return;

  els.toast.textContent = msg;
  els.toast.classList.add('show');

  clearTimeout(toastTimer);

  toastTimer = setTimeout(() => {
    els.toast.classList.remove('show');
  }, 2500);
}


// =======================================================================
// 8. VALIDATE CONFIGURATION
// =======================================================================

function validateConfiguration() {

  if (!JSONBIN_API_KEY ||
      JSONBIN_API_KEY === 'YOUR_NEW_JSONBIN_MASTER_KEY') {

    throw new Error(
      'JSONBin API key has not been configured.'
    );
  }

  const validBins = JSONBIN_BIN_IDS.filter(
    id => typeof id === 'string' && id.trim()
  );

  if (validBins.length === 0) {

    throw new Error(
      'No JSONBin IDs have been configured.'
    );
  }

  if (validBins.length !== JSONBIN_BIN_IDS.length) {

    console.warn(
      'Some JSONBin IDs are empty. Only configured bins will be used.'
    );
  }

  // Prevent accidental duplicate bin IDs.
  const duplicates = validBins.filter(
    (id, index) => validBins.indexOf(id) !== index
  );

  if (duplicates.length > 0) {

    throw new Error(
      'Duplicate JSONBin IDs detected: ' +
      [...new Set(duplicates)].join(', ')
    );
  }
}


// =======================================================================
// 9. VALIDATE A PHRASE
// =======================================================================
//
// Your actual database uses:
//
//      id
//      expression
//      tags
//
// meaning/createdAt are optional for backwards compatibility,
// but we don't require them.
// =======================================================================

function validatePhrase(phrase) {

  if (!phrase || typeof phrase !== 'object') {
    return {
      valid: false,
      reason: 'Record is not an object.'
    };
  }

  if (
    typeof phrase.id !== 'string' ||
    !phrase.id.trim()
  ) {

    return {
      valid: false,
      reason: 'Missing or invalid ID.'
    };
  }

  if (
    typeof phrase.expression !== 'string' ||
    !phrase.expression.trim()
  ) {

    return {
      valid: false,
      reason: 'Missing or invalid expression.'
    };
  }

  if (
    phrase.tags !== undefined &&
    !Array.isArray(phrase.tags)
  ) {

    return {
      valid: false,
      reason: 'Tags must be an array.'
    };
  }

  return {
    valid: true,
    reason: null
  };
}


// =======================================================================
// 10. NORMALIZE PHRASE
// =======================================================================

function normalizePhrase(phrase) {

  const normalized = {
    id: String(phrase.id).trim(),
    expression: String(phrase.expression).trim(),
    tags: Array.isArray(phrase.tags)
      ? phrase.tags
          .filter(t => typeof t === 'string')
          .map(t => t.trim())
          .filter(Boolean)
      : []
  };

  // Preserve optional fields if they exist.
  if (
    typeof phrase.meaning === 'string' &&
    phrase.meaning.trim()
  ) {
    normalized.meaning = phrase.meaning.trim();
  }

  if (
    typeof phrase.createdAt === 'number'
  ) {
    normalized.createdAt = phrase.createdAt;
  }

  return normalized;
}


// =======================================================================
// 11. FETCH ONE BIN
// =======================================================================

async function fetchBinData(binId, retries = 2) {

  try {

    const res = await fetch(
      `https://api.jsonbin.io/v3/b/${encodeURIComponent(binId)}/latest`,
      {
        method: 'GET',
        headers: {
          'X-Master-Key': JSONBIN_API_KEY
        },
        cache: 'no-store'
      }
    );

    if (!res.ok) {

      throw new Error(
        `HTTP ${res.status} ${res.statusText}`
      );
    }

    const data = await res.json();

    if (!data || !data.record) {

      throw new Error(
        'JSONBin response does not contain a record.'
      );
    }

    return data;

  } catch (err) {

    if (retries > 0) {

      await sleep(700);

      return fetchBinData(
        binId,
        retries - 1
      );
    }

    console.error(
      `Failed to load bin ${binId}:`,
      err
    );

    return null;
  }
}


// =======================================================================
// 12. EXTRACT PHRASES FROM BIN
// =======================================================================

function extractPhrasesFromBin(data) {

  if (!data || !data.record) {
    return [];
  }

  const record = data.record;

  // Your current structure:
  //
  // {
  //   status: "active",
  //   phrases: [...]
  // }

  if (Array.isArray(record.phrases)) {
    return record.phrases;
  }

  // Also support a raw array for compatibility.
  if (Array.isArray(record)) {
    return record;
  }

  return [];
}


// =======================================================================
// 13. LOAD ALL BINS
// =======================================================================
//
// IMPORTANT:
// This function NEVER writes anything to JSONBin.
//
// It only reads.
//
// It also does NOT generate IDs for damaged records.
// =======================================================================

async function loadFromCloud() {

  validateConfiguration();

  setSyncStatus('syncing');

  state.isSyncing = true;

  try {

    // Clear the old index.
    Object.keys(phraseBinMap).forEach(
      id => delete phraseBinMap[id]
    );

    const configuredBins =
      JSONBIN_BIN_IDS.filter(
        id => typeof id === 'string' && id.trim()
      );

    const results = await Promise.all(
      configuredBins.map(binId =>
        fetchBinData(binId)
      )
    );

    const allPhrases = [];

    const seenIds = new Map();

    const duplicateIds = [];

    const invalidRecords = [];

    const binStats = [];

    results.forEach((data, index) => {

      const binId = configuredBins[index];

      if (!data) {

        binStats.push({
          binId,
          loaded: false,
          count: 0
        });

        return;
      }

      const rawPhrases =
        extractPhrasesFromBin(data);

      let validCount = 0;
      let invalidCount = 0;

      rawPhrases.forEach((rawPhrase, phraseIndex) => {

        const validation =
          validatePhrase(rawPhrase);

        if (!validation.valid) {

          invalidCount++;

          invalidRecords.push({
            binId,
            index: phraseIndex,
            reason: validation.reason,
            record: rawPhrase
          });

          return;
        }

        const phrase =
          normalizePhrase(rawPhrase);

        validCount++;

        // Detect duplicate IDs.
        if (seenIds.has(phrase.id)) {

          duplicateIds.push({
            id: phrase.id,
            firstBin: seenIds.get(phrase.id),
            duplicateBin: binId
          });

          // IMPORTANT:
          // We DO NOT silently add the duplicate.
          // The first copy remains canonical.
          return;
        }

        seenIds.set(
          phrase.id,
          binId
        );

        phraseBinMap[phrase.id] =
          binId;

        allPhrases.push(phrase);
      });

      binStats.push({
        binId,
        loaded: true,
        count: rawPhrases.length,
        valid: validCount,
        invalid: invalidCount
      });
    });


    // ------------------------------------------------------------
    // Database statistics
    // ------------------------------------------------------------

    const totalRaw =
      binStats.reduce(
        (sum, bin) => sum + bin.count,
        0
      );

    const unique =
      allPhrases.length;

    const duplicates =
      duplicateIds.length;

    const invalid =
      invalidRecords.length;

    const failedBins =
      binStats.filter(
        bin => !bin.loaded
      ).length;


    state.databaseStats = {
      total: totalRaw,
      unique,
      duplicates,
      invalid,
      failedBins,
      bins: binStats
    };


    // ------------------------------------------------------------
    // Keep the successfully loaded unique records.
    // ------------------------------------------------------------

    state.phrases = allPhrases;


    // ------------------------------------------------------------
    // Local cache
    // ------------------------------------------------------------

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(state.phrases)
    );


    // Store diagnostics locally.
    localStorage.setItem(
      DATABASE_STATS_KEY,
      JSON.stringify(state.databaseStats)
    );


    // Store the ID -> bin map.
    localStorage.setItem(
      BIN_INDEX_KEY,
      JSON.stringify(phraseBinMap)
    );


    // ------------------------------------------------------------
    // Diagnostics
    // ------------------------------------------------------------

    console.group(
      '%cPhrases Database',
      'font-weight:bold'
    );

    console.log(
      'Raw records:',
      totalRaw
    );

    console.log(
      'Unique records:',
      unique
    );

    console.log(
      'Duplicate IDs:',
      duplicates
    );

    console.log(
      'Invalid records:',
      invalid
    );

    console.log(
      'Failed bins:',
      failedBins
    );

    console.table(binStats);

    if (duplicateIds.length) {
      console.warn(
        'Duplicate IDs detected:',
        duplicateIds
      );
    }

    if (invalidRecords.length) {
      console.warn(
        'Invalid records detected:',
        invalidRecords
      );
    }

    console.groupEnd();


    // ------------------------------------------------------------
    // Status
    // ------------------------------------------------------------

    if (failedBins > 0) {

      setSyncStatus('error');

      showToast(
        `${failedBins} bin(s) failed to load. Check console.`
      );

    } else {

      setSyncStatus('synced');

      if (duplicates > 0) {

        showToast(
          `${unique} loaded. ${duplicates} duplicate ID(s) detected.`
        );

      } else if (invalid > 0) {

        showToast(
          `${unique} loaded. ${invalid} invalid record(s) detected.`
        );
      }
    }


    state.isSyncing = false;

    return {
      success: failedBins === 0,
      phrases: allPhrases,
      stats: state.databaseStats,
      duplicateIds,
      invalidRecords
    };


  } catch (error) {

    console.error(
      'Cloud loading failed:',
      error
    );

    state.isSyncing = false;

    setSyncStatus('error');

    // ----------------------------------------------------------
    // FALLBACK TO LOCAL CACHE
    // ----------------------------------------------------------

    try {

      const raw =
        localStorage.getItem(STORAGE_KEY);

      state.phrases =
        raw ? JSON.parse(raw) : [];

      // Rebuild local map from cache.
      Object.keys(phraseBinMap).forEach(
        id => delete phraseBinMap[id]
      );

      const savedIndex =
        localStorage.getItem(BIN_INDEX_KEY);

      if (savedIndex) {

        const parsed =
          JSON.parse(savedIndex);

        Object.assign(
          phraseBinMap,
          parsed
        );
      }

      showToast(
        'Offline: showing last saved phrases.'
      );

    } catch (cacheError) {

      console.error(
        'Local cache failed:',
        cacheError
      );

      state.phrases = [];

      showToast(
        'Database could not be loaded.'
      );
    }

    return {
      success: false,
      phrases: state.phrases,
      stats: state.databaseStats
    };
  }
}


// =======================================================================
// 14. GET A BIN'S CURRENT CONTENT
// =======================================================================
//
// This is used immediately before modifying a bin.
//
// We do NOT trust stale local data when writing.
// =======================================================================

async function fetchCurrentBin(binId) {

  const data =
    await fetchBinData(binId, 2);

  if (!data) {

    throw new Error(
      `Unable to retrieve bin ${binId} before modification.`
    );
  }

  const phrases =
    extractPhrasesFromBin(data);

  return {
    status:
      data.record?.status || 'active',

    phrases
  };
}


// =======================================================================
// 15. WRITE ONE BIN
// =======================================================================

async function writeBin(
  binId,
  phrases,
  status = 'active'
) {

  const payload = {
    status,
    phrases
  };

  const serialized =
    JSON.stringify(payload);

  // ------------------------------------------------------------
  // Size protection
  // ------------------------------------------------------------

  const size =
    new Blob([serialized]).size;

  if (size >= MAX_BIN_SIZE) {

    throw new Error(
      `Bin ${binId} is too large (${size} bytes).`
    );
  }


  const res = await fetch(
    `https://api.jsonbin.io/v3/b/${encodeURIComponent(binId)}`,
    {
      method: 'PUT',

      headers: {
        'Content-Type': 'application/json',
        'X-Master-Key': JSONBIN_API_KEY
      },

      body: serialized,

      cache: 'no-store'
    }
  );


  if (!res.ok) {

    const errorText =
      await res.text().catch(() => '');

    throw new Error(
      `Failed to save bin ${binId}: ` +
      `${res.status} ${errorText}`
    );
  }


  return await res.json();
}


// =======================================================================
// 16. FIND A BIN FOR A NEW PHRASE
// =======================================================================
//
// IMPORTANT:
// Existing phrases are NEVER moved.
//
// We only find a bin with enough remaining space.
// =======================================================================

async function findBinForNewPhrase(
  phrase
) {

  const configuredBins =
    JSONBIN_BIN_IDS.filter(
      id => typeof id === 'string' && id.trim()
    );


  for (const binId of configuredBins) {

    const current =
      await fetchCurrentBin(binId);

    const testPhrases = [
      ...current.phrases,
      phrase
    ];

    const payload = JSON.stringify({
      status: current.status,
      phrases: testPhrases
    });

    const size =
      new Blob([payload]).size;

    if (size < MAX_BIN_SIZE) {

      return {
        binId,
        current
      };
    }
  }


  throw new Error(
    'No JSONBin has enough available space for this phrase.'
  );
}


// =======================================================================
// 17. SAVE A NEW PHRASE
// =======================================================================
//
// Only ONE bin is modified.
// =======================================================================

async function addPhraseToCloud(
  phrase
) {

  const {
    binId,
    current
  } = await findBinForNewPhrase(
    phrase
  );


  // Make sure this ID doesn't already exist.
  if (phraseBinMap[phrase.id]) {

    throw new Error(
      `Generated ID collision: ${phrase.id}`
    );
  }


  const updated =
    [
      ...current.phrases,
      phrase
    ];


  await writeBin(
    binId,
    updated,
    current.status
  );


  // Update local index only AFTER cloud save succeeds.
  phraseBinMap[phrase.id] =
    binId;


  localStorage.setItem(
    BIN_INDEX_KEY,
    JSON.stringify(phraseBinMap)
  );


  return binId;
}


// =======================================================================
// 18. UPDATE AN EXISTING PHRASE
// =======================================================================
//
// Only the bin containing this ID is modified.
// =======================================================================

async function updatePhraseInCloud(
  phraseId,
  updatedPhrase
) {

  const binId =
    phraseBinMap[phraseId];


  if (!binId) {

    throw new Error(
      `No bin mapping found for phrase ${phraseId}.`
    );
  }


  const current =
    await fetchCurrentBin(binId);


  let found = false;


  const updatedPhrases =
    current.phrases.map(
      phrase => {

        if (String(phrase.id) === String(phraseId)) {

          found = true;

          return {
            ...phrase,
            ...updatedPhrase,
            id: phraseId
          };
        }

        return phrase;
      }
    );


  if (!found) {

    throw new Error(
      `Phrase ${phraseId} was not found in bin ${binId}.`
    );
  }


  // Validate the resulting database records.
  updatedPhrases.forEach(
    phrase => {

      const validation =
        validatePhrase(phrase);

      if (!validation.valid) {

        throw new Error(
          `Refusing to save invalid record ` +
          `${phrase.id}: ${validation.reason}`
        );
      }
    }
  );


  await writeBin(
    binId,
    updatedPhrases,
    current.status
  );


  return binId;
}


// =======================================================================
// 19. DELETE AN EXISTING PHRASE
// =======================================================================
//
// Again: only ONE bin is modified.
// =======================================================================

async function deletePhraseFromCloud(
  phraseId
) {

  const binId =
    phraseBinMap[phraseId];


  if (!binId) {

    throw new Error(
      `No bin mapping found for phrase ${phraseId}.`
    );
  }


  const current =
    await fetchCurrentBin(binId);


  const before =
    current.phrases.length;


  const updatedPhrases =
    current.phrases.filter(
      phrase =>
        String(phrase.id) !== String(phraseId)
    );


  if (updatedPhrases.length === before) {

    throw new Error(
      `Phrase ${phraseId} was not found in bin ${binId}.`
    );
  }


  await writeBin(
    binId,
    updatedPhrases,
    current.status
  );


  delete phraseBinMap[phraseId];


  localStorage.setItem(
    BIN_INDEX_KEY,
    JSON.stringify(phraseBinMap)
  );


  return binId;
}


// =======================================================================
// 20. SAFE CLOUD SAVE HELPER
// =======================================================================
//
// This replaces the old "rebuild all bins" save mechanism.
//
// There is intentionally NO function here that takes state.phrases
// and rewrites all eight bins.
// =======================================================================

async function saveNewPhraseSafely(
  phrase
) {

  setSyncStatus('syncing');

  try {

    const binId =
      await addPhraseToCloud(
        phrase
      );

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(state.phrases)
    );

    setSyncStatus('synced');

    console.log(
      `New phrase saved to bin ${binId}`
    );

    return true;

  } catch (error) {

    console.error(
      'Failed to save new phrase:',
      error
    );

    setSyncStatus('error');

    showToast(
      'Cloud save failed. Your database was not modified.'
    );

    return false;
  }
}


async function updatePhraseSafely(
  phraseId,
  updatedPhrase
) {

  setSyncStatus('syncing');

  try {

    const binId =
      await updatePhraseInCloud(
        phraseId,
        updatedPhrase
      );

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(state.phrases)
    );

    setSyncStatus('synced');

    console.log(
      `Phrase ${phraseId} updated in bin ${binId}`
    );

    return true;

  } catch (error) {

    console.error(
      'Failed to update phrase:',
      error
    );

    setSyncStatus('error');

    showToast(
      'Cloud update failed. Your database was not modified.'
    );

    return false;
  }
}


async function deletePhraseSafely(
  phraseId
) {

  setSyncStatus('syncing');

  try {

    const binId =
      await deletePhraseFromCloud(
        phraseId
      );

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(state.phrases)
    );

    setSyncStatus('synced');

    console.log(
      `Phrase ${phraseId} deleted from bin ${binId}`
    );

    return true;

  } catch (error) {

    console.error(
      'Failed to delete phrase:',
      error
    );

    setSyncStatus('error');

    showToast(
      'Cloud deletion failed. Your database was not modified.'
    );

    return false;
  }
}


// =======================================================================
// 21. TAG FUNCTIONS
// =======================================================================

function getAllTags(includePinned = false) {

  const counts = {};

  state.phrases.forEach(
    phrase => {

      (phrase.tags || []).forEach(
        tag => {

          if (
            includePinned ||
            !state.pinnedTags.includes(tag)
          ) {

            counts[tag] =
              (counts[tag] || 0) + 1;
          }
        }
      );
    }
  );


  return Object.entries(counts)
    .sort(
      (a, b) =>
        b[1] - a[1] ||
        a[0].localeCompare(b[0])
    )
    .map(
      ([tag, count]) => ({
        tag,
        count
      })
    );
}


// =======================================================================
// 22. FILTERING
// =======================================================================

function getFiltered() {

  const q =
    state.search
      .toLowerCase()
      .trim();


  let filtered =
    state.phrases.filter(
      phrase => {

        if (
          state.activeTags.length > 0
        ) {

          const hasTag =
            (phrase.tags || [])
              .some(
                tag =>
                  state.activeTags.includes(tag)
              );

          if (!hasTag) {
            return false;
          }
        }


        if (!q) {
          return true;
        }


        const haystack = [

          phrase.expression || '',

          phrase.meaning || '',

          ...(phrase.tags || [])

        ]
          .join(' ')
          .toLowerCase();


        return haystack.includes(q);
      }
    );


  // ------------------------------------------------------------
  // Random feed
  // ------------------------------------------------------------

  if (
    state.activeTags.length === 0 &&
    q === ''
  ) {

    for (
      let i = filtered.length - 1;
      i > 0;
      i--
    ) {

      const j =
        Math.floor(
          Math.random() * (i + 1)
        );

      [
        filtered[i],
        filtered[j]
      ] =
      [
        filtered[j],
        filtered[i]
      ];
    }


    filtered =
      filtered.slice(0, 20);

  } else {

    filtered.sort(
      (a, b) =>
        (b.createdAt || 0) -
        (a.createdAt || 0)
    );
  }


  return filtered;
}


// =======================================================================
// 23. RENDER
// =======================================================================

function render(
  animateCards = false
) {

  renderTags();
  renderPinnedTags();
  renderList(animateCards);
  renderCount();
}


// =======================================================================
// 24. DATABASE COUNT
// =======================================================================

function renderCount() {

  const n =
    state.databaseStats.unique ||
    state.phrases.length;


  if (n === 0) {

    els.count.textContent =
      'No phrases';

  } else if (n === 1) {

    els.count.textContent =
      '01 phrase';

  } else {

    els.count.textContent =
      String(n).padStart(2, '0') +
      ' phrases';
  }
}


// =======================================================================
// 25. TAG FILTER RENDERING
// =======================================================================

function renderTags() {

  const tags =
    getAllTags(false);


  els.tagsFilter.innerHTML = '';


  const all =
    document.createElement('button');


  all.className =
    'tag-chip' +
    (
      state.activeTags.length === 0
        ? ' active'
        : ''
    );


  all.innerHTML =
    `All <span class="count">${state.phrases.length}</span>`;


  all.onclick = () => {

    state.activeTags = [];

    render(false);
  };


  els.tagsFilter.appendChild(all);


  tags.forEach(
    ({ tag, count }) => {

      const b =
        document.createElement('button');


      b.className =
        'tag-chip' +
        (
          state.activeTags.includes(tag)
            ? ' active'
            : ''
        );


      b.innerHTML = `
        ${escapeHtml(tag)}
        <span class="count">${count}</span>

        <span class="tag-action pin">
          <svg viewBox="0 0 24 24"
               fill="none"
               stroke="currentColor"
               stroke-linecap="round"
               stroke-linejoin="round">
            <path d="M12 17v5"/>
            <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>
          </svg>
        </span>

        <span class="tag-action delete">
          <svg viewBox="0 0 24 24"
               fill="none"
               stroke="currentColor"
               stroke-linecap="round"
               stroke-linejoin="round">
            <path d="M3 6h18"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </span>
      `;


      b.onclick = () => {

        if (
          !b.classList.contains('editing')
        ) {

          if (
            state.activeTags.includes(tag)
          ) {

            state.activeTags =
              state.activeTags.filter(
                t => t !== tag
              );

          } else {

            state.activeTags.push(tag);
          }

          render(false);
        }
      };


      attachTagHoldHandlers(
        b,
        tag,
        false
      );


      els.tagsFilter.appendChild(b);
    }
  );
}


// =======================================================================
// 26. PINNED TAGS
// =======================================================================

function renderPinnedTags() {

  els.pinnedTagsFilter.innerHTML = '';


  if (
    state.pinnedTags.length === 0
  ) {

    els.pinnedTagsFilter.style.display =
      'none';

    return;
  }


  els.pinnedTagsFilter.style.display =
    'flex';


  state.pinnedTags.forEach(
    tag => {

      const b =
        document.createElement('button');


      b.className =
        'tag-chip pinned' +
        (
          state.activeTags.includes(tag)
            ? ' active'
            : ''
        );


      const count =
        state.phrases.filter(
          p =>
            (p.tags || []).includes(tag)
        ).length;


      b.innerHTML = `
        ${escapeHtml(tag)}
        <span class="count">${count}</span>

        <span class="tag-action unpin">
          <svg viewBox="0 0 24 24"
               fill="none"
               stroke="currentColor"
               stroke-linecap="round"
               stroke-linejoin="round">
            <path d="M3 21l18-18"/>
            <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7"/>
          </svg>
        </span>

        <span class="tag-action delete">
          <svg viewBox="0 0 24 24"
               fill="none"
               stroke="currentColor"
               stroke-linecap="round"
               stroke-linejoin="round">
            <path d="M3 6h18"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </span>
      `;


      b.onclick = () => {

        if (
          !b.classList.contains('editing')
        ) {

          if (
            state.activeTags.includes(tag)
          ) {

            state.activeTags =
              state.activeTags.filter(
                t => t !== tag
              );

          } else {

            state.activeTags.push(tag);
          }

          render(false);
        }
      };


      attachTagHoldHandlers(
        b,
        tag,
        true
      );


      els.pinnedTagsFilter.appendChild(b);
    }
  );
}


// =======================================================================
// 27. TAG HOLD HANDLERS
// =======================================================================

function attachTagHoldHandlers(
  btn,
  tag,
  isPinned
) {

  let pressTimer = null;

  const start = () => {

    document
      .querySelectorAll(
        '.tag-chip.editing'
      )
      .forEach(
        c => {
          if (c !== btn) {
            c.classList.remove(
              'editing'
            );
          }
        }
      );


    pressTimer =
      setTimeout(() => {

        btn.classList.add(
          'editing'
        );

        if (navigator.vibrate) {
          navigator.vibrate(10);
        }

        state.suppressClick = true;

        setTimeout(() => {
          state.suppressClick = false;
        }, 100);

      }, 480);
  };


  const cancel = () => {
    clearTimeout(pressTimer);
  };


  btn.addEventListener(
    'touchstart',
    start,
    { passive: true }
  );

  btn.addEventListener(
    'touchmove',
    cancel,
    { passive: true }
  );

  btn.addEventListener(
    'touchend',
    cancel
  );

  btn.addEventListener(
    'mousedown',
    start
  );

  btn.addEventListener(
    'mousemove',
    cancel
  );

  btn.addEventListener(
    'mouseup',
    cancel
  );

  btn.addEventListener(
    'mouseleave',
    cancel
  );


  const pinAction =
    btn.querySelector(
      isPinned
        ? '.unpin'
        : '.pin'
    );


  const delAction =
    btn.querySelector('.delete');


  if (pinAction) {

    pinAction.onclick = async e => {

      e.stopPropagation();

      if (isPinned) {

        state.pinnedTags =
          state.pinnedTags.filter(
            t => t !== tag
          );

      } else {

        state.pinnedTags.push(tag);
      }

      savePinnedTags();

      render(false);
    };
  }


  if (delAction) {

    delAction.onclick = async e => {

      e.stopPropagation();

      await deleteTagFromAllCards(tag);

      if (isPinned) {

        state.pinnedTags =
          state.pinnedTags.filter(
            t => t !== tag
          );

        savePinnedTags();
      }

      render(false);
    };
  }
}


// =======================================================================
// 28. DELETE TAG FROM ALL CARDS
// =======================================================================
//
// This legitimately modifies multiple bins.
//
// We determine which bins actually contain the affected phrases,
// then update ONLY those bins.
// =======================================================================

async function deleteTagFromAllCards(tag) {

  const affectedIds = [];

  state.phrases.forEach(
    phrase => {

      if (
        (phrase.tags || []).includes(tag)
      ) {

        affectedIds.push(
          phrase.id
        );
      }
    }
  );


  if (affectedIds.length === 0) {
    return;
  }


  const affectedBins =
    new Set();


  affectedIds.forEach(
    id => {

      const binId =
        phraseBinMap[id];

      if (binId) {
        affectedBins.add(binId);
      }
    }
  );


  showToast(
    `Updating ${affectedBins.size} bin(s)...`
  );


  setSyncStatus('syncing');


  try {

    for (
      const binId of affectedBins
    ) {

      const current =
        await fetchCurrentBin(binId);


      const updated =
        current.phrases.map(
          phrase => {

            if (
              (phrase.tags || [])
                .includes(tag)
            ) {

              return {
                ...phrase,
                tags:
                  (phrase.tags || [])
                    .filter(
                      t => t !== tag
                    )
              };
            }

            return phrase;
          }
        );


      await writeBin(
        binId,
        updated,
        current.status
      );
    }


    // Update local state only after all cloud writes succeed.
    state.phrases.forEach(
      phrase => {

        phrase.tags =
          (phrase.tags || [])
            .filter(
              t => t !== tag
            );
      }
    );


    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(state.phrases)
    );


    setSyncStatus('synced');

    showToast(
      'Tag deleted successfully.'
    );


  } catch (error) {

    console.error(
      'Tag deletion failed:',
      error
    );

    setSyncStatus('error');

    showToast(
      'Tag deletion failed. Check console.'
    );
  }
}


// =======================================================================
// 29. PINNED TAG STORAGE
// =======================================================================

function savePinnedTags() {

  localStorage.setItem(
    'phrases.pinnedTags',
    JSON.stringify(
      state.pinnedTags
    )
  );
}


function loadPinnedTags() {

  const raw =
    localStorage.getItem(
      'phrases.pinnedTags'
    );

  state.pinnedTags =
    raw
      ? JSON.parse(raw)
      : [];
}


// =======================================================================
// 30. RENDER LIST
// =======================================================================

function renderList(animate) {

  const filtered =
    getFiltered();


  els.list.innerHTML = '';


  if (state.phrases.length === 0) {

    els.list.innerHTML = `
      <div class="empty-state">
        <div class="icon">"</div>
        <h3>A blank page, waiting.</h3>
        <p>Tap the + to save your first phrase.</p>
      </div>
    `;

    return;
  }


  if (filtered.length === 0) {

    els.list.innerHTML =
      `<div class="no-results">
        Nothing matches your search.
      </div>`;

    return;
  }


  filtered.forEach(
    (phrase, index) => {

      const card =
        document.createElement('article');


      card.className =
        'phrase-card' +
        (
          animate
            ? ' animate-in'
            : ''
        );


      if (state.selectionMode) {

        card.classList.add(
          'selectable'
        );

        if (
          state.selectedIds.includes(
            phrase.id
          )
        ) {

          card.classList.add(
            'selected'
          );
        }
      }


      card.dataset.id =
        phrase.id;


      if (animate) {

        card.style.animationDelay =
          (
            Math.min(index, 8) *
            35
          ) + 'ms';
      }


      let actionsHTML = '';


      if (state.selectionMode) {

        if (
          state.selectedIds.includes(
            phrase.id
          )
        ) {

          actionsHTML = `
            <button
              class="selection-delete-btn"
              aria-label="Delete selected">

              <svg viewBox="0 0 24 24"
                   fill="none"
                   stroke="currentColor"
                   stroke-width="2"
                   stroke-linecap="round"
                   stroke-linejoin="round">

                <path d="M3 6h18"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
                <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>

            </button>
          `;
        }

      } else {

        actionsHTML = `
          <div class="card-actions">

            <button
              class="action-btn select"
              data-action="select"
              aria-label="Select phrase">

              <svg viewBox="0 0 24 24"
                   fill="none"
                   stroke="currentColor"
                   stroke-width="2"
                   stroke-linecap="round"
                   stroke-linejoin="round">

                <path d="M20 6 9 17l-5-5"/>

              </svg>

            </button>


            <button
              class="action-btn edit"
              data-action="edit"
              aria-label="Edit phrase">

              <svg viewBox="0 0 24 24"
                   fill="none"
                   stroke="currentColor"
                   stroke-width="2"
                   stroke-linecap="round"
                   stroke-linejoin="round">

                <path d="M12 20h9"/>
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/>

              </svg>

            </button>


            <button
              class="action-btn delete"
              data-action="delete"
              aria-label="Delete phrase">

              <svg viewBox="0 0 24 24"
                   fill="none"
                   stroke="currentColor"
                   stroke-width="2"
                   stroke-linecap="round"
                   stroke-linejoin="round">

                <path d="M3 6h18"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
                <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                <line x1="10" y1="11" x2="10" y2="17"/>
                <line x1="14" y1="11" x2="14" y2="17"/>

              </svg>

            </button>

          </div>

          <div class="press-indicator"></div>
        `;
      }


      // ----------------------------------------------------------
      // IMPORTANT:
      //
      // Database field is "expression", NOT "text".
      // ----------------------------------------------------------

      card.innerHTML = `

        <div class="phrase-text">
          ${escapeHtml(
            phrase.expression
          )}
        </div>


        ${
          phrase.meaning
            ? `
              <div class="phrase-meaning">
                ${escapeHtml(
                  phrase.meaning
                )}
              </div>
            `
            : ''
        }


        ${
          (phrase.tags || []).length
            ? `
              <div class="phrase-tags">

                ${
                  phrase.tags
                    .map(
                      tag =>
                        `<span class="phrase-tag">
                          ${escapeHtml(tag)}
                        </span>`
                    )
                    .join('')
                }

              </div>
            `
            : ''
        }


        ${actionsHTML}

      `;


      attachCardHandlers(
        card,
        phrase
      );


      els.list.appendChild(card);
    }
  );


  if (
    state.activeTags.length === 0 &&
    state.search === '' &&
    state.phrases.length > 20
  ) {

    const msg =
      document.createElement('div');


    msg.className =
      'no-results';


    msg.style.fontSize =
      '13px';

    msg.style.fontStyle =
      'normal';

    msg.style.fontFamily =
      'var(--sans)';

    msg.style.color =
      'var(--text-faint)';

    msg.style.marginTop =
      '20px';


    msg.innerHTML =
      `Showing 20 random phrases out of ${
        state.phrases.length
      }.<br>Refresh the page to discover more.`;


    els.list.appendChild(msg);
  }
}


// =======================================================================
// 31. CARD HANDLERS
// =======================================================================

function attachCardHandlers(
  card,
  phrase
) {

  if (state.selectionMode) {

    card.addEventListener(
      'click',
      e => {

        if (
          e.target.closest(
            '.selection-delete-btn'
          )
        ) {

          e.stopPropagation();

          deleteSelected();

          return;
        }


        toggleSelection(
          phrase.id
        );
      }
    );

    return;
  }


  let pressTimer = null;
  let pressing = false;
  let longPressed = false;

  let startX = 0;
  let startY = 0;

  const MOVE_THRESHOLD = 10;


  function start(e) {

    if (
      e.target.closest('.action-btn')
    ) {
      return;
    }


    pressing = true;
    longPressed = false;


    const touch =
      e.touches
        ? e.touches[0]
        : e;


    startX =
      touch.clientX;

    startY =
      touch.clientY;


    card.classList.add(
      'pressing'
    );


    pressTimer =
      setTimeout(
        () => {

          document
            .querySelectorAll(
              '.phrase-card.revealed'
            )
            .forEach(
              c => {

                if (c !== card) {
                  c.classList.remove(
                    'revealed'
                  );
                }
              }
            );


          card.classList.add(
            'revealed'
          );

          card.classList.remove(
            'pressing'
          );


          pressing = false;
          longPressed = true;


          if (navigator.vibrate) {
            navigator.vibrate(12);
          }


          state.suppressClick = true;


          setTimeout(() => {

            state.suppressClick =
              false;

          }, 60);

        },
        480
      );
  }


  function move(e) {

    if (!pressing) return;


    const touch =
      e.touches
        ? e.touches[0]
        : e;


    if (
      Math.abs(
        touch.clientX - startX
      ) > MOVE_THRESHOLD ||
      Math.abs(
        touch.clientY - startY
      ) > MOVE_THRESHOLD
    ) {

      cancel();
    }
  }


  function cancel() {

    clearTimeout(
      pressTimer
    );

    card.classList.remove(
      'pressing'
    );

    pressing = false;
  }


  function end() {

    clearTimeout(
      pressTimer
    );

    card.classList.remove(
      'pressing'
    );

    pressing = false;
  }


  card.addEventListener(
    'touchstart',
    start,
    { passive: true }
  );

  card.addEventListener(
    'touchmove',
    move,
    { passive: true }
  );

  card.addEventListener(
    'touchend',
    end
  );

  card.addEventListener(
    'touchcancel',
    cancel
  );

  card.addEventListener(
    'mousedown',
    start
  );

  card.addEventListener(
    'mousemove',
    move
  );

  card.addEventListener(
    'mouseup',
    end
  );

  card.addEventListener(
    'mouseleave',
    end
  );


  const selectBtn =
    card.querySelector(
      '[data-action="select"]'
    );

  const editBtn =
    card.querySelector(
      '[data-action="edit"]'
    );

  const delBtn =
    card.querySelector(
      '[data-action="delete"]'
    );


  if (selectBtn) {

    selectBtn.addEventListener(
      'click',
      e => {

        e.stopPropagation();

        enterSelectionMode(
          phrase.id
        );
      }
    );
  }


  if (editBtn) {

    editBtn.addEventListener(
      'click',
      e => {

        e.stopPropagation();

        openModal(
          phrase.id
        );
      }
    );
  }


  if (delBtn) {

    delBtn.addEventListener(
      'click',
      e => {

        e.stopPropagation();

        deletePhrase(
          phrase.id
        );
      }
    );
  }
}


// =======================================================================
// 32. SELECTION
// =======================================================================

function toggleSelection(id) {

  if (
    state.selectedIds.includes(id)
  ) {

    state.selectedIds =
      state.selectedIds.filter(
        i => i !== id
      );


    if (
      state.selectedIds.length === 0
    ) {

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

  els.selCount.textContent =
    `${state.selectedIds.length} selected`;


  if (
    state.selectedIds.length > 0
  ) {

    els.selectionBar.classList.add(
      'show'
    );

  } else {

    els.selectionBar.classList.remove(
      'show'
    );
  }
}


function toggleSelectionMode() {

  state.selectionMode =
    !state.selectionMode;


  state.selectedIds = [];


  if (!state.selectionMode) {

    els.selectionBar.classList.remove(
      'show'
    );
  }


  updateSelectionUI();

  render(false);
}


// =======================================================================
// 33. DELETE SELECTED
// =======================================================================
//
// Groups selected records by their bin.
// Each affected bin is modified once.
// =======================================================================

async function deleteSelected() {

  const ids =
    [...state.selectedIds];


  if (ids.length === 0) {
    return;
  }


  const affectedBins =
    new Map();


  ids.forEach(
    id => {

      const binId =
        phraseBinMap[id];

      if (!binId) return;


      if (
        !affectedBins.has(binId)
      ) {

        affectedBins.set(
          binId,
          new Set()
        );
      }


      affectedBins
        .get(binId)
        .add(id);
    }
  );


  if (affectedBins.size === 0) {

    showToast(
      'Could not locate selected phrases.'
    );

    return;
  }


  setSyncStatus('syncing');


  try {

    for (
      const [
        binId,
        idsInBin
      ]
      of affectedBins
    ) {

      const current =
        await fetchCurrentBin(binId);


      const updated =
        current.phrases.filter(
          phrase =>
            !idsInBin.has(
              phrase.id
            )
        );


      await writeBin(
        binId,
        updated,
        current.status
      );
    }


    // Only update local state after cloud success.
    state.phrases =
      state.phrases.filter(
        phrase =>
          !ids.includes(
            phrase.id
          )
      );


    ids.forEach(
      id => {
        delete phraseBinMap[id];
      }
    );


    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(
        state.phrases
      )
    );


    localStorage.setItem(
      BIN_INDEX_KEY,
      JSON.stringify(
        phraseBinMap
      )
    );


    state.selectedIds = [];

    state.selectionMode = false;

    updateSelectionUI();

    render(false);

    setSyncStatus('synced');

    showToast(
      `${ids.length} phrase(s) deleted.`
    );


  } catch (error) {

    console.error(
      'Bulk deletion failed:',
      error
    );

    setSyncStatus('error');

    showToast(
      'Deletion failed. Database was not fully modified.'
    );
  }
}


// =======================================================================
// 34. GLOBAL CLICK
// =======================================================================

document.addEventListener(
  'click',
  e => {

    if (state.suppressClick) {
      return;
    }


    if (
      e.target.closest('.action-btn')
    ) {
      return;
    }


    if (
      e.target.closest('.tag-action')
    ) {
      return;
    }


    document
      .querySelectorAll(
        '.tag-chip.editing'
      )
      .forEach(
        c =>
          c.classList.remove(
            'editing'
          )
      );


    const card =
      e.target.closest(
        '.phrase-card'
      );


    if (
      card &&
      card.classList.contains(
        'revealed'
      )
    ) {
      return;
    }


    document
      .querySelectorAll(
        '.phrase-card.revealed'
      )
      .forEach(
        c =>
          c.classList.remove(
            'revealed'
          )
      );
  }
);


// =======================================================================
// 35. MODAL
// =======================================================================

function openModal(id = null) {

  document
    .querySelectorAll(
      '.phrase-card.revealed'
    )
    .forEach(
      c =>
        c.classList.remove(
          'revealed'
        )
    );


  state.editingId = id;

  state.draftTags = [];


  if (id) {

    const phrase =
      state.phrases.find(
        p => p.id === id
      );


    if (!phrase) {
      return;
    }


    els.modalTitle.textContent =
      'Edit phrase';


    els.phraseInput.value =
      phrase.expression || '';


    els.meaningInput.value =
      phrase.meaning || '';


    state.draftTags =
      [...(phrase.tags || [])];


    els.saveBtn.textContent =
      'Update phrase';


  } else {

    els.modalTitle.textContent =
      'New phrase';


    els.form.reset();


    state.draftTags = [];


    els.saveBtn.textContent =
      'Save phrase';
  }


  renderTagEditor();

  renderSuggestions();


  els.modal.classList.add(
    'open'
  );


  document.body.style.overflow =
    'hidden';


  setTimeout(
    () =>
      els.phraseInput.focus(),
    280
  );
}


function closeModal() {

  els.modal.classList.remove(
    'open'
  );


  document.body.style.overflow =
    '';


  state.editingId = null;

  state.draftTags = [];
}


// =======================================================================
// 36. TAG EDITOR
// =======================================================================

function renderTagEditor() {

  [...els.tagEditor.children]
    .forEach(
      child => {

        if (
          child !== els.tagInput
        ) {

          child.remove();
        }
      }
    );


  state.draftTags.forEach(
    tag => {

      const pill =
        document.createElement(
          'span'
        );


      pill.className =
        'tag-pill';


      pill.innerHTML =
        `${escapeHtml(tag)}
         <button
           type="button"
           class="remove"
           aria-label="Remove ${escapeHtml(tag)}">
           ×
         </button>`;


      pill
        .querySelector('.remove')
        .onclick = () => {

          state.draftTags =
            state.draftTags.filter(
              t => t !== tag
            );

          renderTagEditor();

          renderSuggestions();
        };


      els.tagEditor.insertBefore(
        pill,
        els.tagInput
      );
    }
  );
}


function renderSuggestions() {

  const all =
    getAllTags(true)
      .map(
        item => item.tag
      );


  const available =
    all
      .filter(
        tag =>
          !state.draftTags.includes(
            tag
          )
      )
      .slice(0, 8);


  els.tagSuggestions.innerHTML =
    '';


  if (
    available.length === 0
  ) {

    els.tagSuggestions.style.display =
      'none';

    return;
  }


  els.tagSuggestions.style.display =
    'flex';


  available.forEach(
    tag => {

      const b =
        document.createElement(
          'button'
        );


      b.type =
        'button';

      b.className =
        'tag-suggestion';

      b.textContent =
        '+ ' + tag;


      b.onclick = () => {

        if (
          !state.draftTags.includes(tag)
        ) {

          state.draftTags.push(tag);

          renderTagEditor();

          renderSuggestions();
        }
      };


      els.tagSuggestions.appendChild(b);
    }
  );
}


function addTagFromInput() {

  let value =
    els.tagInput.value.trim();


  value =
    value
      .replace(/,+$/, '')
      .trim();


  if (!value) {
    return;
  }


  if (value.length > 30) {

    value =
      value.slice(0, 30);
  }


  if (
    !state.draftTags.includes(value)
  ) {

    state.draftTags.push(value);
  }


  renderTagEditor();

  renderSuggestions();


  els.tagInput.value =
    '';
}


els.tagInput.addEventListener(
  'keydown',
  e => {

    if (
      e.key === 'Enter' ||
      e.key === ',' ||
      e.key === 'Tab'
    ) {

      if (
        els.tagInput.value.trim()
      ) {

        e.preventDefault();

        addTagFromInput();
      }


    } else if (
      e.key === 'Backspace' &&
      !els.tagInput.value &&
      state.draftTags.length
    ) {

      state.draftTags.pop();

      renderTagEditor();

      renderSuggestions();
    }
  }
);


els.tagEditor.addEventListener(
  'click',
  e => {

    if (
      e.target === els.tagEditor
    ) {

      els.tagInput.focus();
    }
  }
);


// =======================================================================
// 37. CREATE / EDIT PHRASE
// =======================================================================

async function savePhrase(e) {

  e.preventDefault();


  if (
    els.tagInput.value.trim()
  ) {

    addTagFromInput();
  }


  const expression =
    els.phraseInput.value.trim();


  const meaning =
    els.meaningInput.value.trim();


  if (!expression) {

    els.phraseInput.focus();

    return;
  }


  // ============================================================
  // EDIT EXISTING
  // ============================================================

  if (state.editingId) {

    const phrase =
      state.phrases.find(
        p =>
          p.id === state.editingId
      );


    if (!phrase) {

      showToast(
        'Phrase no longer exists.'
      );

      return;
    }


    const updatedPhrase = {

      id: phrase.id,

      expression,

      tags: [
        ...state.draftTags
      ]
    };


    if (meaning) {

      updatedPhrase.meaning =
        meaning;
    }


    showToast(
      'Updating cloud...'
    );


    const success =
      await updatePhraseSafely(
        phrase.id,
        updatedPhrase
      );


    if (!success) {
      return;
    }


    // Update local state AFTER cloud success.
    Object.assign(
      phrase,
      updatedPhrase
    );


    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(
        state.phrases
      )
    );


    render(false);

    closeModal();


    return;
  }


  // ============================================================
  // CREATE NEW
  // ============================================================

  const newPhrase = {

    id: uid(),

    expression,

    tags: [
      ...state.draftTags
    ],

    createdAt: Date.now()
  };


  // Include meaning only if supplied.
  if (meaning) {

    newPhrase.meaning =
      meaning;
  }


  showToast(
    'Saving to cloud...'
  );


  // IMPORTANT:
  // We do NOT add it to state yet.
  //
  // The cloud must succeed first.
  const success =
    await saveNewPhraseSafely(
      newPhrase
    );


  if (!success) {

    showToast(
      'Phrase was NOT added. Cloud save failed.'
    );

    return;
  }


  // Cloud succeeded.
  state.phrases.unshift(
    newPhrase
  );


  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(
      state.phrases
    )
  );


  render(false);

  closeModal();


  showToast(
    'Phrase saved successfully.'
  );
}


// =======================================================================
// 38. DELETE ONE PHRASE
// =======================================================================

async function deletePhrase(id) {

  const phrase =
    state.phrases.find(
      p => p.id === id
    );


  if (!phrase) {
    return;
  }


  showToast(
    'Deleting from cloud...'
  );


  const success =
    await deletePhraseSafely(
      id
    );


  if (!success) {
    return;
  }


  state.phrases =
    state.phrases.filter(
      p => p.id !== id
    );


  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(
      state.phrases
    )
  );


  render(false);

  showToast(
    'Phrase deleted.'
  );
}


// =======================================================================
// 39. EVENT WIRING
// =======================================================================

els.addBtn.addEventListener(
  'click',
  () =>
    openModal()
);


els.btnDeleteSelected.addEventListener(
  'click',
  deleteSelected
);


els.btnCancelSelection.addEventListener(
  'click',
  toggleSelectionMode
);


els.modalClose.addEventListener(
  'click',
  closeModal
);


els.modal.addEventListener(
  'click',
  e => {

    if (
      e.target === els.modal
    ) {

      closeModal();
    }
  }
);


els.form.addEventListener(
  'submit',
  savePhrase
);


els.searchInput.addEventListener(
  'input',
  e => {

    state.search =
      e.target.value;


    els.clearBtn.style.display =
      state.search
        ? 'flex'
        : 'none';


    renderList(false);
  }
);


els.clearBtn.addEventListener(
  'click',
  () => {

    els.searchInput.value =
      '';

    state.search =
      '';

    els.clearBtn.style.display =
      'none';

    renderList(false);

    els.searchInput.focus();
  }
);


document.addEventListener(
  'keydown',
  e => {

    if (
      e.key === 'Escape' &&
      els.modal.classList.contains(
        'open'
      )
    ) {

      closeModal();
    }


    if (
      e.key === 'Escape' &&
      state.selectionMode
    ) {

      toggleSelectionMode();
    }
  }
);


// =======================================================================
// 40. INITIALIZATION
// =======================================================================

async function init() {

  try {

    loadPinnedTags();

    await loadFromCloud();

    render(true);


    console.log(
      '%cPhrases initialized successfully.',
      'font-weight:bold'
    );


    console.log(
      'Total unique phrases:',
      state.databaseStats.unique
    );


  } catch (error) {

    console.error(
      'Initialization failed:',
      error
    );

    setSyncStatus('error');

    showToast(
      'Initialization failed. Check console.'
    );
  }
}


init();
