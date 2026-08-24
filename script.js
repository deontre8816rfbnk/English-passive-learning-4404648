// ============================================================
// Phrases — Personal Lexicon
// JSONBin.io Multi-Bin Cloud Edition
//
// IMPORTANT DATABASE RULES
// ------------------------------------------------------------
// 1. Every configured bin is treated as an independent database.
// 2. Existing phrases NEVER move between bins.
// 3. Existing phrase order is preserved.
// 4. Editing a phrase only updates its original bin.
// 5. Deleting a phrase only updates its original bin.
// 6. Adding a phrase goes into one available bin.
// 7. A bin that failed to load can NEVER be overwritten.
// 8. Failed bins are NOT treated as empty bins.
// 9. JSONBin uses "expression"; the UI internally uses "text".
// 10. Duplicate IDs are detected instead of silently discarded.
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

// IMPORTANT:
// Replace this with your NEW rotated Master Key.
const JSONBIN_API_KEY = "$2a$10$0dH1LXansfpglhcBp0tRzuqI.DBNyYqAF2iQxCH4fIOhn4MmK02au";


// =======================================================================
// 2. APP STORAGE
// =======================================================================

const STORAGE_KEY = 'phrases.local.cache';
const PINNED_TAGS_KEY = 'phrases.pinnedTags';


// =======================================================================
// 3. DATABASE ENGINE STATE
// =======================================================================
//
// database.bins:
//     binId -> {
//       phrases: [...],
//       loaded: true
//     }
//
// phraseToBin:
//     phraseId -> binId
//
// failedBins:
//     Set of bin IDs that could not be loaded.
//
// This is the important part that prevents the application from
// accidentally rebuilding all eight bins every time something changes.
// =======================================================================

const database = {
  bins: {},
  phraseToBin: new Map(),
  failedBins: new Set(),
  loadedBins: new Set(),
  fullyLoaded: false,
  duplicateIds: new Set()
};


// =======================================================================
// 4. APPLICATION STATE
// =======================================================================

const state = {
  phrases: [],
  search: '',
  activeTags: [],
  editingId: null,
  draftTags: [],
  suppressClick: false,
  isSyncing: false,
  selectionMode: false,
  selectedIds: [],
  pinnedTags: []
};


// =======================================================================
// 5. DOM REFERENCES
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
// 6. SYNC INDICATOR
// =======================================================================

function setSyncStatus(status) {

  if (!els.syncIndicator) return;

  els.syncIndicator.classList.remove(
    'syncing',
    'error'
  );

  if (status === 'syncing') {
    els.syncIndicator.classList.add('syncing');
  }

  if (status === 'error') {
    els.syncIndicator.classList.add('error');
  }
}


// =======================================================================
// 7. TOAST
// =======================================================================

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
// 8. UNIQUE ID GENERATOR
// =======================================================================

function uid() {

  return (
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 9)
  );
}


// =======================================================================
// 9. HTML ESCAPING
// =======================================================================

function escapeHtml(value) {

  return String(value ?? '').replace(
    /[&<>"']/g,
    char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[char]
  );
}


// =======================================================================
// 10. NORMALIZE JSONBIN PHRASE
// =======================================================================
//
// Your actual JSON uses:
//
// {
//   "id": "...",
//   "expression": "...",
//   "tags": []
// }
//
// The application uses:
//
// {
//   "id": "...",
//   "text": "...",
//   "tags": []
// }
//
// We convert only in memory.
// The cloud database remains "expression".
// =======================================================================

function normalizePhrase(raw) {

  if (!raw || typeof raw !== 'object') {
    return null;
  }

  if (!raw.id) {

    console.warn(
      'Skipping phrase without ID:',
      raw
    );

    return null;
  }


  const expression =
    typeof raw.expression === 'string'
      ? raw.expression
      : typeof raw.text === 'string'
        ? raw.text
        : '';


  if (!expression.trim()) {

    console.warn(
      'Skipping phrase without expression/text:',
      raw
    );

    return null;
  }


  return {
    id: String(raw.id),

    text: expression,

    meaning:
      typeof raw.meaning === 'string'
        ? raw.meaning
        : '',

    tags:
      Array.isArray(raw.tags)
        ? [...raw.tags]
        : [],

    createdAt:
      Number.isFinite(raw.createdAt)
        ? raw.createdAt
        : 0
  };
}


// =======================================================================
// 11. CONVERT APP PHRASE BACK TO JSONBIN FORMAT
// =======================================================================

function denormalizePhrase(phrase) {

  const result = {
    id: phrase.id,
    expression: phrase.text,
    tags: Array.isArray(phrase.tags)
      ? [...phrase.tags]
      : []
  };


  if (phrase.meaning) {
    result.meaning = phrase.meaning;
  }


  if (phrase.createdAt) {
    result.createdAt = phrase.createdAt;
  }


  return result;
}


// =======================================================================
// 12. VALIDATE BIN IDs
// =======================================================================

function getConfiguredBinIds() {

  return [
    ...new Set(
      JSONBIN_BIN_IDS
        .map(id => String(id || '').trim())
        .filter(Boolean)
    )
  ];
}


// =======================================================================
// 13. FETCH ONE BIN
// =======================================================================

async function fetchBinData(binId, retries = 3) {

  if (!binId) {

    return {
      ok: false,
      binId,
      error: 'Empty Bin ID'
    };
  }


  let lastError = null;


  for (
    let attempt = 1;
    attempt <= retries;
    attempt++
  ) {

    try {

      const response = await fetch(
        `https://api.jsonbin.io/v3/b/${encodeURIComponent(binId)}/latest`,
        {
          method: 'GET',

          headers: {
            'X-Master-Key': JSONBIN_API_KEY
          },

          cache: 'no-store'
        }
      );


      const responseText =
        await response.text();


      let data;


      try {

        data = JSON.parse(responseText);

      } catch {

        throw new Error(
          `Invalid JSON response (${response.status})`
        );
      }


      if (!response.ok) {

        throw new Error(
          data?.message ||
          `HTTP ${response.status}`
        );
      }


      if (!data || !data.record) {

        throw new Error(
          'JSONBin returned no record'
        );
      }


      return {
        ok: true,
        binId,
        data
      };


    } catch (error) {

      lastError = error;


      console.warn(
        `Bin ${binId} failed ` +
        `(attempt ${attempt}/${retries}):`,
        error
      );


      if (attempt < retries) {

        const delay =
          700 * Math.pow(2, attempt - 1);

        await new Promise(
          resolve => setTimeout(resolve, delay)
        );
      }
    }
  }


  return {
    ok: false,
    binId,
    error:
      lastError?.message ||
      'Unknown error'
  };
}


// =======================================================================
// 14. EXTRACT PHRASES FROM BIN
// =======================================================================

function extractPhrasesFromBin(data) {

  if (!data || !data.record) {
    return [];
  }


  const record = data.record;


  // Raw array format
  if (Array.isArray(record)) {
    return record;
  }


  // Your current format:
  //
  // {
  //   "status": "active",
  //   "phrases": [...]
  // }

  if (
    record &&
    Array.isArray(record.phrases)
  ) {
    return record.phrases;
  }


  console.warn(
    'Unexpected JSONBin record structure:',
    record
  );


  return [];
}


// =======================================================================
// 15. LOAD ALL EIGHT BINS
// =======================================================================
//
// ALL bins are requested in parallel.
//
// We do NOT wait for bin #1 before requesting bin #2.
//
// A failed bin is recorded as failed and is NEVER treated as empty.
// =======================================================================

async function loadFromCloud() {

  setSyncStatus('syncing');

  state.isSyncing = true;


  database.bins = {};
  database.phraseToBin = new Map();
  database.failedBins = new Set();
  database.loadedBins = new Set();
  database.duplicateIds = new Set();


  const binIds =
    getConfiguredBinIds();


  if (binIds.length === 0) {

    state.phrases = [];

    database.fullyLoaded = false;

    state.isSyncing = false;

    setSyncStatus('error');

    showToast(
      'No JSONBin IDs configured.'
    );

    return false;
  }


  console.log(
    `Loading ${binIds.length} JSONBin databases...`
  );


  // ------------------------------------------------------------
  // REQUEST ALL BINS IN PARALLEL
  // ------------------------------------------------------------

  const results =
    await Promise.all(
      binIds.map(binId =>
        fetchBinData(binId)
      )
    );


  // ------------------------------------------------------------
  // COMBINE RESULTS
  // ------------------------------------------------------------

  const allPhrases = [];


  for (const result of results) {

    if (!result.ok) {

      database.failedBins.add(
        result.binId
      );

      console.error(
        `FAILED BIN: ${result.binId}`,
        result.error
      );

      continue;
    }


    const rawPhrases =
      extractPhrasesFromBin(
        result.data
      );


    const normalizedPhrases = [];


    for (const rawPhrase of rawPhrases) {

      const phrase =
        normalizePhrase(rawPhrase);


      if (!phrase) {
        continue;
      }


      // --------------------------------------------------------
      // DUPLICATE ID PROTECTION
      // --------------------------------------------------------

      if (
        database.phraseToBin.has(
          phrase.id
        )
      ) {

        const existingBin =
          database.phraseToBin.get(
            phrase.id
          );


        database.duplicateIds.add(
          phrase.id
        );


        console.error(
          `Duplicate phrase ID detected: ${phrase.id}`,
          {
            firstBin: existingBin,
            duplicateBin: result.binId
          }
        );


        // Do NOT silently merge duplicates.
        continue;
      }


      database.phraseToBin.set(
        phrase.id,
        result.binId
      );


      normalizedPhrases.push(
        phrase
      );


      allPhrases.push(
        phrase
      );
    }


    // --------------------------------------------------------
    // IMPORTANT:
    // Keep an independent snapshot for this bin.
    // --------------------------------------------------------

    database.bins[result.binId] = {
      phrases: normalizedPhrases,
      loaded: true
    };


    database.loadedBins.add(
      result.binId
    );
  }


  // ------------------------------------------------------------
  // APPLICATION STATE
  // ------------------------------------------------------------

  state.phrases =
    allPhrases;


  database.fullyLoaded =
    database.failedBins.size === 0;


  state.isSyncing = false;


  // ------------------------------------------------------------
  // CACHE ONLY COMPLETE LOADS
  // ------------------------------------------------------------

  if (database.fullyLoaded) {

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(
        state.phrases
      )
    );

    setSyncStatus('synced');

  } else {

    setSyncStatus('error');

    console.error(
      'Some JSONBin databases failed to load.'
    );

    console.error(
      'Failed bins:',
      [...database.failedBins]
    );

    showToast(
      `${database.failedBins.size} bin(s) failed. ` +
      `Cloud database is protected.`
    );
  }


  // ------------------------------------------------------------
  // DATABASE REPORT
  // ------------------------------------------------------------

  console.log(
    '================================================'
  );

  console.log(
    'JSONBIN DATABASE REPORT'
  );

  console.log(
    'Configured bins:',
    binIds.length
  );

  console.log(
    'Loaded bins:',
    database.loadedBins.size
  );

  console.log(
    'Failed bins:',
    database.failedBins.size
  );

  console.log(
    'Total phrases:',
    state.phrases.length
  );

  console.log(
    'Duplicate IDs:',
    database.duplicateIds.size
  );

  if (database.failedBins.size) {

    console.table(
      [...database.failedBins].map(
        binId => ({
          binId,
          status: 'FAILED'
        })
      )
    );
  }


  console.log(
    '================================================'
  );


  return database.fullyLoaded;
}


// =======================================================================
// 16. GET BIN THAT OWNS A PHRASE
// =======================================================================

function getPhraseBin(id) {

  return (
    database.phraseToBin.get(
      id
    ) || null
  );
}


// =======================================================================
// 17. CALCULATE JSON SIZE
// =======================================================================

function getPayloadSizeBytes(
  phrases
) {

  const payload = {
    status: 'active',

    phrases:
      phrases.map(
        denormalizePhrase
      )
  };


  return new Blob([
    JSON.stringify(payload)
  ]).size;
}


// =======================================================================
// 18. FIND A BIN FOR A NEW PHRASE
// =======================================================================
//
// Existing phrases are NEVER moved.
//
// We look for the first successfully-loaded bin that can safely
// accept the new phrase without approaching the 100 KB limit.
//
// We intentionally use a conservative 90 KB ceiling.
// =======================================================================

function findBinForNewPhrase(
  phrase
) {

  const MAX_SAFE_SIZE =
    90 * 1024;


  const binIds =
    getConfiguredBinIds();


  for (const binId of binIds) {

    // Never touch a bin that failed to load.
    if (
      database.failedBins.has(
        binId
      )
    ) {
      continue;
    }


    const bin =
      database.bins[binId];


    if (!bin || !bin.loaded) {
      continue;
    }


    const testPhrases = [
      ...bin.phrases,
      phrase
    ];


    const size =
      getPayloadSizeBytes(
        testPhrases
      );


    if (size < MAX_SAFE_SIZE) {

      return binId;
    }
  }


  return null;
}


// =======================================================================
// 19. WRITE EXACTLY ONE BIN
// =======================================================================
//
// This is the most important safety function in the entire script.
//
// It is IMPOSSIBLE for this function to write to a bin that failed
// to load during the current session.
// =======================================================================

async function writeBin(
  binId,
  phrases
) {

  if (!binId) {

    throw new Error(
      'Cannot write: missing Bin ID.'
    );
  }


  // ------------------------------------------------------------
  // SAFETY LOCK #1
  // ------------------------------------------------------------

  if (
    database.failedBins.has(
      binId
    )
  ) {

    throw new Error(
      `SAFETY LOCK: ${binId} failed to load. ` +
      `Refusing to overwrite it.`
    );
  }


  // ------------------------------------------------------------
  // SAFETY LOCK #2
  // ------------------------------------------------------------

  if (
    !database.loadedBins.has(
      binId
    )
  ) {

    throw new Error(
      `SAFETY LOCK: ${binId} was not successfully loaded.`
    );
  }


  // ------------------------------------------------------------
  // SAFETY LOCK #3
  // ------------------------------------------------------------

  if (
    !database.bins[binId]
  ) {

    throw new Error(
      `SAFETY LOCK: No database snapshot exists for ${binId}.`
    );
  }


  const payload = {
    status: 'active',

    phrases:
      phrases.map(
        denormalizePhrase
      )
  };


  const response =
    await fetch(
      `https://api.jsonbin.io/v3/b/${encodeURIComponent(binId)}`,
      {
        method: 'PUT',

        headers: {
          'Content-Type':
            'application/json',

          'X-Master-Key':
            JSONBIN_API_KEY,

          // Enable JSONBin version control.
          'X-Bin-Versioning':
            'true'
        },

        body:
          JSON.stringify(
            payload
          )
      }
    );


  const responseText =
    await response.text();


  if (!response.ok) {

    let message =
      responseText;


    try {

      const parsed =
        JSON.parse(
          responseText
        );


      message =
        parsed.message ||
        responseText;

    } catch {
      // Keep original response text.
    }


    throw new Error(
      `JSONBin update failed for ${binId}: ${message}`
    );
  }


  // ------------------------------------------------------------
  // Update local snapshot only AFTER successful cloud write.
  // ------------------------------------------------------------

  database.bins[binId] = {
    phrases:
      phrases.map(
        phrase => ({
          ...phrase,
          tags: [
            ...(phrase.tags || [])
          ]
        })
      ),

    loaded: true
  };


  console.log(
    `Successfully updated bin: ${binId}`
  );
}


// =======================================================================
// 20. SAVE / UPDATE ONE PHRASE
// =======================================================================

async function savePhraseToCloud(
  phrase
) {

  const existingBinId =
    getPhraseBin(
      phrase.id
    );


  // ============================================================
  // EXISTING PHRASE
  // ============================================================

  if (existingBinId) {

    const bin =
      database.bins[
        existingBinId
      ];


    if (!bin) {

      throw new Error(
        `Original bin ${existingBinId} is unavailable.`
      );
    }


    const index =
      bin.phrases.findIndex(
        p =>
          p.id === phrase.id
      );


    if (index === -1) {

      throw new Error(
        `Phrase ${phrase.id} ` +
        `cannot be found in its original bin.`
      );
    }


    // Preserve its exact position.
    bin.phrases[index] = {
      ...phrase
    };


    await writeBin(
      existingBinId,
      bin.phrases
    );


    return;
  }


  // ============================================================
  // NEW PHRASE
  // ============================================================

  const targetBinId =
    findBinForNewPhrase(
      phrase
    );


  if (!targetBinId) {

    throw new Error(
      'No loaded bin has enough safe space for this new phrase.'
    );
  }


  const bin =
    database.bins[
      targetBinId
    ];


  // New phrase is appended.
  // Existing phrases remain untouched.
  bin.phrases.push(
    phrase
  );


  // Register ownership BEFORE writing.
  database.phraseToBin.set(
    phrase.id,
    targetBinId
  );


  try {

    await writeBin(
      targetBinId,
      bin.phrases
    );

  } catch (error) {

    // Roll back local changes if cloud write fails.
    bin.phrases.pop();

    database.phraseToBin.delete(
      phrase.id
    );

    throw error;
  }
}


// =======================================================================
// 21. DELETE ONE PHRASE FROM CLOUD
// =======================================================================

async function deletePhraseFromCloud(
  id
) {

  const binId =
    getPhraseBin(id);


  if (!binId) {

    throw new Error(
      `Cannot find database bin for phrase ${id}.`
    );
  }


  const bin =
    database.bins[binId];


  if (!bin) {

    throw new Error(
      `Database snapshot missing for bin ${binId}.`
    );
  }


  const index =
    bin.phrases.findIndex(
      p =>
        p.id === id
    );


  if (index === -1) {

    throw new Error(
      `Phrase ${id} not found in bin ${binId}.`
    );
  }


  // Keep a backup in case PUT fails.
  const previous =
    [...bin.phrases];


  bin.phrases =
    bin.phrases.filter(
      p =>
        p.id !== id
    );


  try {

    await writeBin(
      binId,
      bin.phrases
    );


    database.phraseToBin.delete(
      id
    );

  } catch (error) {

    // Roll back.
    bin.phrases =
      previous;

    throw error;
  }
}


// =======================================================================
// 22. DELETE MULTIPLE PHRASES
// =======================================================================
//
// Multiple selected phrases may belong to different bins.
// We group them by bin and update each affected bin exactly once.
// =======================================================================

async function deleteMultipleFromCloud(
  ids
) {

  const idsSet =
    new Set(ids);


  const affectedBins =
    new Map();


  // ------------------------------------------------------------
  // Group deleted phrases by their original bin.
  // ------------------------------------------------------------

  for (const id of idsSet) {

    const binId =
      getPhraseBin(id);


    if (!binId) {

      throw new Error(
        `Cannot determine bin for phrase ${id}.`
      );
    }


    if (
      !affectedBins.has(
        binId
      )
    ) {

      affectedBins.set(
        binId,
        []
      );
    }


    affectedBins
      .get(binId)
      .push(id);
  }


  // ------------------------------------------------------------
  // Backups
  // ------------------------------------------------------------

  const backups =
    new Map();


  for (
    const [
      binId,
      idsInBin
    ]
    of affectedBins
  ) {

    const bin =
      database.bins[binId];


    if (!bin) {

      throw new Error(
        `Missing database snapshot for ${binId}.`
      );
    }


    backups.set(
      binId,
      [...bin.phrases]
    );


    const remaining =
      bin.phrases.filter(
        phrase =>
          !idsInBin.includes(
            phrase.id
          )
      );


    bin.phrases =
      remaining;
  }


  try {

    // ----------------------------------------------------------
    // Update each affected bin ONCE.
    // ----------------------------------------------------------

    for (
      const [
        binId
      ]
      of affectedBins
    ) {

      await writeBin(
        binId,
        database.bins[binId].phrases
      );
    }


    // ----------------------------------------------------------
    // Remove ownership mappings.
    // ----------------------------------------------------------

    for (const id of idsSet) {

      database.phraseToBin.delete(
        id
      );
    }

  } catch (error) {

    // ----------------------------------------------------------
    // Roll back every affected bin locally.
    // ----------------------------------------------------------

    for (
      const [
        binId,
        backup
      ]
      of backups
    ) {

      database.bins[binId].phrases =
        backup;
    }


    throw error;
  }
}


// =======================================================================
// 23. LOCAL CACHE
// =======================================================================

function saveLocalCache() {

  try {

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(
        state.phrases
      )
    );

  } catch (error) {

    console.warn(
      'Could not save local cache:',
      error
    );
  }
}


// =======================================================================
// 24. LOAD PINNED TAGS
// =======================================================================

function loadPinnedTags() {

  try {

    const raw =
      localStorage.getItem(
        PINNED_TAGS_KEY
      );


    state.pinnedTags =
      raw
        ? JSON.parse(raw)
        : [];


    if (
      !Array.isArray(
        state.pinnedTags
      )
    ) {

      state.pinnedTags = [];
    }

  } catch {

    state.pinnedTags = [];
  }
}


// =======================================================================
// 25. SAVE PINNED TAGS
// =======================================================================

function savePinnedTags() {

  localStorage.setItem(
    PINNED_TAGS_KEY,
    JSON.stringify(
      state.pinnedTags
    )
  );
}


// =======================================================================
// 26. TAGS
// =======================================================================

function getAllTags(
  includePinned = false
) {

  const counts = {};


  state.phrases.forEach(
    phrase => {

      (
        phrase.tags || []
      ).forEach(
        tag => {

          if (
            includePinned ||
            !state.pinnedTags.includes(
              tag
            )
          ) {

            counts[tag] =
              (counts[tag] || 0) + 1;
          }
        }
      );
    }
  );


  return Object.entries(
    counts
  )
    .sort(
      (a, b) =>
        b[1] - a[1] ||
        a[0].localeCompare(
          b[0]
        )
    )
    .map(
      ([tag, count]) => ({
        tag,
        count
      })
    );
}


// =======================================================================
// 27. FILTERING
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
            (
              phrase.tags || []
            ).some(
              tag =>
                state.activeTags.includes(
                  tag
                )
            );


          if (!hasTag) {
            return false;
          }
        }


        if (!q) {
          return true;
        }


        const haystack =
          [
            phrase.text,
            phrase.meaning || '',
            ...(phrase.tags || [])
          ]
            .join(' ')
            .toLowerCase();


        return haystack.includes(
          q
        );
      }
    );


  // ------------------------------------------------------------
  // RANDOM HOME FEED
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
          Math.random() *
          (i + 1)
        );


      [
        filtered[i],
        filtered[j]
      ] = [
        filtered[j],
        filtered[i]
      ];
    }


    filtered =
      filtered.slice(
        0,
        20
      );

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
// 28. MAIN RENDER
// =======================================================================

function render(
  animateCards = false
) {

  renderTags();
  renderPinnedTags();
  renderList(
    animateCards
  );
  renderCount();
}


// =======================================================================
// 29. TOTAL COUNT
// =======================================================================

function renderCount() {

  const count =
    state.phrases.length;


  if (count === 0) {

    els.count.textContent =
      'No phrases';

  } else if (count === 1) {

    els.count.textContent =
      '01 phrase';

  } else {

    els.count.textContent =
      String(count)
        .padStart(2, '0') +
      ' phrases';
  }
}


// =======================================================================
// 30. TAG FILTER UI
// =======================================================================

function renderTags() {

  const tags =
    getAllTags(false);


  els.tagsFilter.innerHTML =
    '';


  const all =
    document.createElement(
      'button'
    );


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


  els.tagsFilter.appendChild(
    all
  );


  tags.forEach(
    ({ tag, count }) => {

      const button =
        document.createElement(
          'button'
        );


      button.className =
        'tag-chip' +
        (
          state.activeTags.includes(
            tag
          )
            ? ' active'
            : ''
        );


      button.innerHTML = `
        ${escapeHtml(tag)}

        <span class="count">
          ${count}
        </span>

        <span class="tag-action pin">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M12 17v5"/>
            <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>
          </svg>
        </span>

        <span class="tag-action delete">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M3 6h18"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </span>
      `;


      button.onclick = () => {

        if (
          button.classList.contains(
            'editing'
          )
        ) {
          return;
        }


        if (
          state.activeTags.includes(
            tag
          )
        ) {

          state.activeTags =
            state.activeTags.filter(
              t => t !== tag
            );

        } else {

          state.activeTags.push(
            tag
          );
        }


        render(false);
      };


      attachTagHoldHandlers(
        button,
        tag,
        false
      );


      els.tagsFilter.appendChild(
        button
      );
    }
  );
}


// =======================================================================
// 31. PINNED TAG UI
// =======================================================================

function renderPinnedTags() {

  els.pinnedTagsFilter.innerHTML =
    '';


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

      const button =
        document.createElement(
          'button'
        );


      button.className =
        'tag-chip pinned' +
        (
          state.activeTags.includes(
            tag
          )
            ? ' active'
            : ''
        );


      const count =
        state.phrases.filter(
          phrase =>
            (
              phrase.tags || []
            ).includes(tag)
        ).length;


      button.innerHTML = `
        ${escapeHtml(tag)}

        <span class="count">
          ${count}
        </span>

        <span class="tag-action unpin">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M3 21l18-18"/>
            <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7"/>
          </svg>
        </span>

        <span class="tag-action delete">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M3 6h18"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </span>
      `;


      button.onclick = () => {

        if (
          button.classList.contains(
            'editing'
          )
        ) {
          return;
        }


        if (
          state.activeTags.includes(
            tag
          )
        ) {

          state.activeTags =
            state.activeTags.filter(
              t => t !== tag
            );

        } else {

          state.activeTags.push(
            tag
          );
        }


        render(false);
      };


      attachTagHoldHandlers(
        button,
        tag,
        true
      );


      els.pinnedTagsFilter.appendChild(
        button
      );
    }
  );
}


// =======================================================================
// 32. TAG LONG-PRESS ACTIONS
// =======================================================================

function attachTagHoldHandlers(
  button,
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
        chip => {

          if (
            chip !== button
          ) {

            chip.classList.remove(
              'editing'
            );
          }
        }
      );


    pressTimer =
      setTimeout(
        () => {

          button.classList.add(
            'editing'
          );


          if (
            navigator.vibrate
          ) {

            navigator.vibrate(
              10
            );
          }


          state.suppressClick =
            true;


          setTimeout(
            () => {
              state.suppressClick =
                false;
            },
            100
          );

        },
        480
      );
  };


  const cancel = () => {

    clearTimeout(
      pressTimer
    );
  };


  button.addEventListener(
    'touchstart',
    start,
    { passive: true }
  );


  button.addEventListener(
    'touchmove',
    cancel,
    { passive: true }
  );


  button.addEventListener(
    'touchend',
    cancel
  );


  button.addEventListener(
    'mousedown',
    start
  );


  button.addEventListener(
    'mousemove',
    cancel
  );


  button.addEventListener(
    'mouseup',
    cancel
  );


  button.addEventListener(
    'mouseleave',
    cancel
  );


  const pinAction =
    button.querySelector(
      isPinned
        ? '.unpin'
        : '.pin'
    );


  const deleteAction =
    button.querySelector(
      '.delete'
    );


  if (pinAction) {

    pinAction.onclick =
      event => {

        event.stopPropagation();


        if (isPinned) {

          state.pinnedTags =
            state.pinnedTags.filter(
              t =>
                t !== tag
            );

        } else {

          if (
            !state.pinnedTags.includes(
              tag
            )
          ) {

            state.pinnedTags.push(
              tag
            );
          }
        }


        savePinnedTags();

        render(false);
      };
  }


  if (deleteAction) {

    deleteAction.onclick =
      async event => {

        event.stopPropagation();

        await deleteTagFromAllCards(
          tag
        );

        if (isPinned) {

          state.pinnedTags =
            state.pinnedTags.filter(
              t =>
                t !== tag
            );

          savePinnedTags();
        }

        render(false);
      };
  }
}


// =======================================================================
// 33. DELETE TAG FROM ALL CARDS
// =======================================================================
//
// This can affect multiple bins.
// We group changes by bin and update each affected bin once.
// =======================================================================

async function deleteTagFromAllCards(
  tag
) {

  // ------------------------------------------------------------
  // Determine which bins contain this tag.
  // ------------------------------------------------------------

  const changedBins =
    new Map();


  for (
    const [
      binId,
      bin
    ]
    of Object.entries(
      database.bins
    )
  ) {

    const hasTag =
      bin.phrases.some(
        phrase =>
          (
            phrase.tags || []
          ).includes(tag)
      );


    if (!hasTag) {
      continue;
    }


    // Safety: failed bins should never exist here.
    if (
      database.failedBins.has(
        binId
      )
    ) {

      throw new Error(
        `Cannot modify failed bin ${binId}.`
      );
    }


    changedBins.set(
      binId,
      bin.phrases.map(
        phrase => ({
          ...phrase,

          tags:
            (
              phrase.tags || []
            ).filter(
              t =>
                t !== tag
            )
        })
      )
    );
  }


  if (
    changedBins.size === 0
  ) {

    showToast(
      'Tag not found.'
    );

    return;
  }


  showToast(
    `Updating ${changedBins.size} bin(s)...`
  );


  // Backups
  const backups =
    new Map();


  for (
    const [
      binId
    ]
    of changedBins
  ) {

    backups.set(
      binId,
      database.bins[binId].phrases.map(
        phrase => ({
          ...phrase,
          tags: [
            ...(phrase.tags || [])
          ]
        })
      )
    );
  }


  try {

    for (
      const [
        binId,
        updatedPhrases
      ]
      of changedBins
    ) {

      database.bins[binId].phrases =
        updatedPhrases;


      await writeBin(
        binId,
        updatedPhrases
      );
    }


    // Update global state after success.
    state.phrases =
      state.phrases.map(
        phrase => ({

          ...phrase,

          tags:
            (
              phrase.tags || []
            ).filter(
              t =>
                t !== tag
            )
        })
      );


    saveLocalCache();


    showToast(
      'Tag deleted.'
    );

  } catch (error) {

    // Roll back local bin snapshots.
    for (
      const [
        binId,
        backup
      ]
      of backups
    ) {

      database.bins[binId].phrases =
        backup;
    }


    throw error;
  }
}


// =======================================================================
// 34. RENDER LIST
// =======================================================================

function renderList(
  animate
) {

  const filtered =
    getFiltered();


  els.list.innerHTML =
    '';


  if (
    state.phrases.length === 0
  ) {

    els.list.innerHTML = `
      <div class="empty-state">
        <div class="icon">"</div>
        <h3>A blank page, waiting.</h3>
        <p>Tap the + to save your first phrase.</p>
      </div>
    `;

    return;
  }


  if (
    filtered.length === 0
  ) {

    els.list.innerHTML =
      `
        <div class="no-results">
          Nothing matches your search.
        </div>
      `;

    return;
  }


  filtered.forEach(
    (phrase, index) => {

      const card =
        document.createElement(
          'article'
        );


      card.className =
        'phrase-card' +
        (
          animate
            ? ' animate-in'
            : ''
        );


      if (
        state.selectionMode
      ) {

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
            Math.min(
              index,
              8
            ) * 35
          ) +
          'ms';
      }


      let actionsHTML =
        '';


      // ==========================================================
      // SELECTION MODE
      // ==========================================================

      if (
        state.selectionMode
      ) {

        if (
          state.selectedIds.includes(
            phrase.id
          )
        ) {

          actionsHTML = `
            <button
              class="selection-delete-btn"
              aria-label="Delete selected"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M3 6h18"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
                <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
            </button>
          `;
        }


      } else {

        // ========================================================
        // NORMAL MODE
        // ========================================================

        actionsHTML = `
          <div class="card-actions">

            <button
              class="action-btn select"
              data-action="select"
              aria-label="Select phrase"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M20 6 9 17l-5-5"/>
              </svg>
            </button>

            <button
              class="action-btn edit"
              data-action="edit"
              aria-label="Edit phrase"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M12 20h9"/>
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/>
              </svg>
            </button>

            <button
              class="action-btn delete"
              data-action="delete"
              aria-label="Delete phrase"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
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


      // ==========================================================
      // CARD HTML
      // ==========================================================

      card.innerHTML = `
        <div class="phrase-text">
          ${escapeHtml(
            phrase.text
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
          (
            phrase.tags || []
          ).length
            ? `
              <div class="phrase-tags">
                ${
                  phrase.tags
                    .map(
                      tag =>
                        `
                          <span class="phrase-tag">
                            ${escapeHtml(
                              tag
                            )}
                          </span>
                        `
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


      els.list.appendChild(
        card
      );
    }
  );


  // ------------------------------------------------------------
  // RANDOM FEED MESSAGE
  // ------------------------------------------------------------

  if (
    state.activeTags.length === 0 &&
    state.search === '' &&
    state.phrases.length > 20
  ) {

    const message =
      document.createElement(
        'div'
      );


    message.className =
      'no-results';


    message.style.fontSize =
      '13px';

    message.style.fontStyle =
      'normal';

    message.style.fontFamily =
      'var(--sans)';

    message.style.color =
      'var(--text-faint)';

    message.style.marginTop =
      '20px';


    message.innerHTML =
      `
        Showing 20 random phrases out of
        ${state.phrases.length}.
        <br>
        Refresh the page to discover more.
      `;


    els.list.appendChild(
      message
    );
  }
}


// =======================================================================
// 35. CARD HANDLERS
// =======================================================================

function attachCardHandlers(
  card,
  phrase
) {

  // ------------------------------------------------------------
  // SELECTION MODE
  // ------------------------------------------------------------

  if (
    state.selectionMode
  ) {

    card.addEventListener(
      'click',
      event => {

        if (
          event.target.closest(
            '.selection-delete-btn'
          )
        ) {

          event.stopPropagation();

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


  // ------------------------------------------------------------
  // LONG PRESS
  // ------------------------------------------------------------

  let pressTimer = null;
  let pressing = false;
  let longPressed = false;

  let startX = 0;
  let startY = 0;

  const MOVE_THRESHOLD = 10;


  function start(event) {

    if (
      event.target.closest(
        '.action-btn'
      )
    ) {
      return;
    }


    pressing = true;
    longPressed = false;


    const point =
      event.touches
        ? event.touches[0]
        : event;


    startX =
      point.clientX;


    startY =
      point.clientY;


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
              other => {

                if (
                  other !== card
                ) {

                  other.classList.remove(
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


          if (
            navigator.vibrate
          ) {

            navigator.vibrate(
              12
            );
          }


          state.suppressClick =
            true;


          setTimeout(
            () => {

              state.suppressClick =
                false;

            },
            60
          );

        },
        480
      );
  }


  function move(event) {

    if (!pressing) {
      return;
    }


    const point =
      event.touches
        ? event.touches[0]
        : event;


    if (
      Math.abs(
        point.clientX -
        startX
      ) > MOVE_THRESHOLD ||

      Math.abs(
        point.clientY -
        startY
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


    if (
      !longPressed &&
      pressing &&
      card.classList.contains(
        'revealed'
      )
    ) {

      card.classList.remove(
        'revealed'
      );
    }


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


  // ------------------------------------------------------------
  // ACTION BUTTONS
  // ------------------------------------------------------------

  const selectButton =
    card.querySelector(
      '[data-action="select"]'
    );


  const editButton =
    card.querySelector(
      '[data-action="edit"]'
    );


  const deleteButton =
    card.querySelector(
      '[data-action="delete"]'
    );


  if (selectButton) {

    selectButton.addEventListener(
      'click',
      event => {

        event.stopPropagation();

        enterSelectionMode(
          phrase.id
        );
      }
    );
  }


  if (editButton) {

    editButton.addEventListener(
      'click',
      event => {

        event.stopPropagation();

        openModal(
          phrase.id
        );
      }
    );
  }


  if (deleteButton) {

    deleteButton.addEventListener(
      'click',
      event => {

        event.stopPropagation();

        deletePhrase(
          phrase.id
        );
      }
    );
  }
}


// =======================================================================
// 36. SELECTION
// =======================================================================

function toggleSelection(
  id
) {

  if (
    state.selectedIds.includes(
      id
    )
  ) {

    state.selectedIds =
      state.selectedIds.filter(
        selectedId =>
          selectedId !== id
      );


    if (
      state.selectedIds.length === 0
    ) {

      toggleSelectionMode();

      return;
    }

  } else {

    state.selectedIds.push(
      id
    );
  }


  updateSelectionUI();

  renderList(false);
}


function enterSelectionMode(
  id
) {

  state.selectionMode =
    true;


  state.selectedIds =
    [id];


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


  state.selectedIds =
    [];


  if (
    !state.selectionMode
  ) {

    els.selectionBar.classList.remove(
      'show'
    );
  }


  updateSelectionUI();

  render(false);
}


// =======================================================================
// 37. DELETE SELECTED
// =======================================================================

async function deleteSelected() {

  const ids =
    [...state.selectedIds];


  if (
    ids.length === 0
  ) {
    return;
  }


  const count =
    ids.length;


  try {

    showToast(
      `Deleting ${count} phrase(s)...`
    );


    await deleteMultipleFromCloud(
      ids
    );


    state.phrases =
      state.phrases.filter(
        phrase =>
          !ids.includes(
            phrase.id
          )
      );


    state.selectedIds =
      [];


    state.selectionMode =
      false;


    saveLocalCache();

    updateSelectionUI();

    render(false);

    setSyncStatus('synced');


  } catch (error) {

    console.error(
      'Bulk delete failed:',
     
