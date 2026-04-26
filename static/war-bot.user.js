// ==UserScript==
// @name         War and Chain ⚔️
// @namespace    fries91-war-hub
// @version      3.7.2
// @description  War and Chain by Fries91. Free-access rebuild with admin and leader/co-leader restrictions kept.
// @match        https://www.torn.com/*
// @match        https://torn.com/*
// @downloadURL  https://torn-war-bot.onrender.com/static/war-bot.user.js
// @updateURL    https://torn-war-bot.onrender.com/static/war-bot.user.js
// @run-at       document-idle
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @grant        GM_info
// @connect      torn-war-bot.onrender.com
// @connect      ffscouter.com
// ==/UserScript==

(function () {
    'use strict';


    // Fresh guard for this fixed build. This prevents an older/stale loader flag
    // from hiding the launcher after updates on PDA/Tampermonkey.
    if (window.__WAR_HUB_HEADER_ICON_FIX_V371__) return;
    window.__WAR_HUB_HEADER_ICON_FIX_V371__ = true;
    try { window.__WAR_HUB_V291__ = false; } catch (_e_guard) {}

    // ============================================================
    // 01. CORE CONFIG / STORAGE KEYS
    // ============================================================

    var BASE_URL = 'https://torn-war-bot.onrender.com';

    var K_API_KEY = 'warhub_api_key_v3';
    var K_ADMIN_KEY = 'warhub_admin_key_v3';
    var K_OWNER_TOKEN = 'warhub_owner_token_v3';
    var K_SESSION = 'warhub_session_v3';
    var K_OPEN = 'warhub_open_v3';
    var K_TAB = 'warhub_tab_v3';
    var K_SHIELD_POS = 'warhub_shield_pos_v6';
    var K_OVERLAY_POS = 'warhub_overlay_pos_v3';
    var K_REFRESH = 'warhub_refresh_ms_v3';
    var K_LOCAL_NOTIFICATIONS = 'warhub_local_notifications_v3';
    var K_ACCESS_CACHE = 'warhub_access_cache_v3';
    var K_OVERVIEW_BOXES = 'warhub_overview_boxes_v3';
    var K_OVERLAY_SCROLL = 'warhub_overlay_scroll_v3';
    var K_FF_SCOUTER_KEY = 'warhub_ff_scouter_key_v1';
    var K_FF_SCOUTER_CACHE = 'warhub_ff_scouter_cache_v1';
    var K_TARGETS_LOCAL = 'warhub_targets_local_v1';
    var K_PENDING_BOUNTY = 'warhub_pending_bounty_v3';

    
    // ============================================================
    // 02. OWNER CONFIG
    // ============================================================

    var OWNER_NAME = 'Fries91';
    var OWNER_USER_ID = '3679030';

    // ============================================================
    // 03. TAB ORDER
    // ============================================================

    var TAB_ROW_1 = [
        ['overview', 'Overview'],
        ['chain', 'Chain'],
        ['members', 'Members'],
        ['enemies', 'Enemies'],
        ['hospital', 'Hospital']
    ];

    var TAB_ROW_2 = [
        ['meddeals', 'Med Deals'],
        ['terms', 'Terms'],
        ['settings', 'Settings'],
        ['instructions', 'Help'],
        ['admin', 'Admin']
    ];

    // ============================================================
    // 04. RUNTIME STATE / CACHES
    // ============================================================

    var state = null;
    var analyticsCache = null;
    var adminTopFiveCache = null;
    var factionMembersCache = null;
    var currentFactionMembers = [];
    var liveSummaryCache = null;
    var liveSummaryLoading = false;
    var liveSummaryError = '';
    var liveSummaryLastAt = 0;
    var warEnemiesCache = [];
    var warEnemiesFactionName = '';
    var warEnemiesFactionId = '';
    var warEnemiesLoadedAt = 0;
    var warEnemyStatsCache = {};
    var warEnemyStatsLoadedAt = 0;

    var overlay = null;
    var shield = null;
    var badge = null;

    var mounted = false;
    var dragMoved = false;
    var isOpen = !!GM_getValue(K_OPEN, false);
    var currentTab = GM_getValue(K_TAB, 'settings');
    if (currentTab === 'owner') currentTab = 'admin';
    if (currentTab === 'summary' || currentTab === 'wartop5' || currentTab === 'faction') currentTab = 'overview';

    var pollTimer = null;
    var remountTimer = null;
    var loadInFlight = false;
    var factionHydratePending = false;

    var membersCountdownTimer = null;
    var membersLiveStamp = 0;

    var lastStatusMsg = '';
    var lastStatusErr = false;

    var accessState = normalizeAccessCache(GM_getValue(K_ACCESS_CACHE, null));

    var FF_SCOUTER_CACHE_MS = 30 * 1000; function getFfScouterKey() {
        return String(GM_getValue(K_FF_SCOUTER_KEY, '') || '').trim();
    }

    function getFfScouterCacheMap() {
        var raw = GM_getValue(K_FF_SCOUTER_CACHE, '{}');
        try {
            var parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (_e) {
            return {};
        }
    }

    function setFfScouterCacheMap(map) {
        try {
            GM_setValue(K_FF_SCOUTER_CACHE, JSON.stringify(map || {}));
        } catch (_e) {}
    }

    function getFfScouterData(member) {
        var id = String(getMemberId(member) || '').trim();
        if (!id) return null;
        var direct = warEnemyStatsCache && warEnemyStatsCache[id];
        if (direct && direct.ffscouter) return direct.ffscouter;
        return null;
    }

    function getFfScouterCached(id) {
        var map = getFfScouterCacheMap();
        var item = map[String(id || '')];
        if (!item || !item.fetched_at || !item.payload) return null;
        if ((Date.now() - Number(item.fetched_at || 0)) > FF_SCOUTER_CACHE_MS) {
            delete map[String(id || '')];
            setFfScouterCacheMap(map);
            return null;
        }
        return item.payload;
    }

    function setFfScouterCached(id, payload) {
        if (!id || !payload) return;
        var map = getFfScouterCacheMap();
        map[String(id)] = { fetched_at: Date.now(), payload: payload };
        setFfScouterCacheMap(map);
    }

    function ffDifficultyLabel(ff) {
        ff = Number(ff || 0);
        if (!Number.isFinite(ff) || ff <= 0) return '';
        if (ff <= 1) return 'Extremely easy';
        if (ff <= 2) return 'Easy';
        if (ff <= 3.5) return 'Moderately difficult';
        if (ff <= 4.5) return 'Difficult';
        return 'May be impossible';
    }

    function normalizeFfScouterItem(raw) {
        if (!raw || typeof raw !== 'object') return null;
        var ff = Number(raw.fair_fight);
        var bsEstimate = Number(raw.bs_estimate || 0);
        var bsEstimateHuman = String(raw.bs_estimate_human || '').trim();
        var updated = raw.last_updated || '';
        var noData = raw.no_data === true || raw.fair_fight == null;
        var estimateMillions = 0;
        if (Number.isFinite(bsEstimate) && bsEstimate > 0) {
            estimateMillions = bsEstimate / 1000000;
        } else if (bsEstimateHuman) {
            estimateMillions = parseBattleNumber(bsEstimateHuman);
        }
        return {
            fair_fight: Number.isFinite(ff) ? ff : 0,
            difficulty: ffDifficultyLabel(ff),
            bs_estimate: Number.isFinite(bsEstimate) ? bsEstimate : 0,
            bs_estimate_human: bsEstimateHuman,
            estimate_m: Number.isFinite(estimateMillions) ? estimateMillions : 0,
            last_updated: updated,
            no_data: noData
        };
    }

    function fetchFfScouterStatsBatch(ids) {
        var key = getFfScouterKey();
        ids = arr(ids).map(function (id) { return String(id || '').trim(); }).filter(Boolean);
        if (!key || !ids.length) return Promise.resolve({});

        var url = 'https://ffscouter.com/api/v1/get-stats?key=' + encodeURIComponent(key) + '&targets=' + encodeURIComponent(ids.join(','));

        return new Promise(function (resolve) {
            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                onload: function (resp) {
                    try {
                        var data = JSON.parse((resp && resp.responseText) || '[]');
                        var out = {};
                        arr(data).forEach(function (item) {
                            if (!item || !item.player_id) return;
                            out[String(item.player_id)] = normalizeFfScouterItem(item);
                            setFfScouterCached(String(item.player_id), item);
                        });
                        resolve(out);
                    } catch (_e) {
                        resolve({});
                    }
                },
                onerror: function () { resolve({}); }
            });
        });
    }

    function queueEnemyFfPredictions(list) {
        var members = arr(list);
        if (!members.length) return;

        warEnemyStatsCache = warEnemyStatsCache || {};
        var idsToFetch = [];

        members.forEach(function (member) {
            var id = String(getMemberId(member) || '').trim();
            if (!id) return;
            if (!warEnemyStatsCache[id]) warEnemyStatsCache[id] = {};

            var cached = getFfScouterCached(id);
            if (cached) {
                warEnemyStatsCache[id].ffscouter = normalizeFfScouterItem(cached);
            } else if (!warEnemyStatsCache[id].ff_loading) {
                warEnemyStatsCache[id].ff_loading = true;
                idsToFetch.push(id);
            }
        });

        if (!idsToFetch.length) return;

        fetchFfScouterStatsBatch(idsToFetch).then(function (map) {
            idsToFetch.forEach(function (id) {
                if (!warEnemyStatsCache[id]) warEnemyStatsCache[id] = {};
                warEnemyStatsCache[id].ff_loading = false;
                if (map[id]) warEnemyStatsCache[id].ffscouter = map[id];
            });
            if (currentTab === 'enemies' && overlay && overlay.classList.contains('open')) {
                renderBody();
            }
        }).catch(function () {
            idsToFetch.forEach(function (id) {
                if (!warEnemyStatsCache[id]) warEnemyStatsCache[id] = {};
                warEnemyStatsCache[id].ff_loading = false;
            });
        });
    }


    // ============================================================
    // 05. STYLES
    // ============================================================

    var css = "\n\
#warhub-shield {\n\
  position: fixed !important;\n\
  z-index: 2147483647 !important;\n\
  width: 36px !important;\n\
  height: 36px !important;\n\
  border-radius: 10px !important;\n\
  display: flex !important;\n\
  align-items: center !important;\n\
  justify-content: center !important;\n\
  font-size: 18px !important;\n\
  line-height: 1 !important;\n\
  cursor: pointer !important;\n\
  user-select: none !important;\n\
  -webkit-user-select: none !important;\n\
  -webkit-touch-callout: none !important;\n\
  -webkit-tap-highlight-color: transparent !important;\n\
  touch-action: none !important;\n\
  box-shadow: 0 8px 24px rgba(0,0,0,.45) !important;\n\
  border: 1px solid rgba(255,255,255,.10) !important;\n\
  background: radial-gradient(circle at 30% 20%, rgba(220,75,75,.98), rgba(110,12,12,.98) 55%, rgba(48,6,6,.98)) !important;\n\
  color: #fff !important;\n\
  left: auto !important;\n\
  right: 14px !important;\n\
  top: 50% !important;\n\
  bottom: auto !important;\n\
  transform: translateY(-50%) !important;\n\
  opacity: 1 !important;\n\
  visibility: visible !important;\n\
  pointer-events: auto !important;\n\
}\n\
\n\
#warhub-badge {\n\
  position: fixed !important;\n\
  z-index: 2147483647 !important;\n\
  min-width: 16px !important;\n\
  height: 16px !important;\n\
  padding: 0 4px !important;\n\
  border-radius: 999px !important;\n\
  background: #ffd54a !important;\n\
  color: #111 !important;\n\
  font-size: 10px !important;\n\
  line-height: 16px !important;\n\
  text-align: center !important;\n\
  font-weight: 800 !important;\n\
  box-shadow: 0 3px 12px rgba(0,0,0,.45) !important;\n\
  display: none !important;\n\
  pointer-events: none !important;\n\
}\n\
#warhub-overlay {\n\
  position: fixed !important;\n\
  z-index: 2147483646 !important;\n\
  left: 8px !important;\n\
  right: 8px !important;\n\
  top: 8px !important;\n\
  bottom: 8px !important;\n\
  width: auto !important;\n\
  max-width: 520px !important;\n\
  margin: 0 auto !important;\n\
  border-radius: 14px !important;\n\
  background: linear-gradient(180deg, #171717, #0c0c0c) !important;\n\
  color: #f2f2f2 !important;\n\
  border: 1px solid rgba(255,255,255,.08) !important;\n\
  box-shadow: 0 16px 38px rgba(0,0,0,.54) !important;\n\
  display: none !important;\n\
  flex-direction: column !important;\n\
  box-sizing: border-box !important;\n\
  overflow: hidden !important;\n\
  opacity: 1 !important;\n\
  visibility: visible !important;\n\
  overscroll-behavior: contain !important;\n\
}\n\
#warhub-overlay.open {\n\
  display: flex !important;\n\
}\n\
#warhub-overlay *,\n\
#warhub-overlay *::before,\n\
#warhub-overlay *::after {\n\
  box-sizing: border-box !important;\n\
}\n\
\n\
.warhub-head {\n\
  flex: 0 0 auto !important;\n\
  padding: 12px 12px 10px !important;\n\
  border-bottom: 1px solid rgba(255,255,255,.08) !important;\n\
  background: rgba(255,255,255,.03) !important;\n\
  touch-action: none !important;\n\
}\n\
\n\
.warhub-toprow {\n\
  display: flex !important;\n\
  align-items: center !important;\n\
  justify-content: space-between !important;\n\
  gap: 10px !important;\n\
  width: 100% !important;\n\
}\n\
\n\
.warhub-title {\n\
  font-weight: 800 !important;\n\
  font-size: 16px !important;\n\
  letter-spacing: .2px !important;\n\
  color: #fff !important;\n\
}\n\
.warhub-sub {\n\
  opacity: .72 !important;\n\
  font-size: 11px !important;\n\
  margin-top: 2px !important;\n\
  color: #fff !important;\n\
}\n\
\n\
.warhub-close {\n\
  appearance: none !important;\n\
  -webkit-appearance: none !important;\n\
  border: 0 !important;\n\
  border-radius: 10px !important;\n\
  background: rgba(255,255,255,.08) !important;\n\
  color: #fff !important;\n\
  padding: 6px 10px !important;\n\
  font-weight: 700 !important;\n\
  cursor: pointer !important;\n\
  font-size: 12px !important;\n\
  flex: 0 0 auto !important;\n\
  display: inline-flex !important;\n\
  align-items: center !important;\n\
  justify-content: center !important;\n\
  min-height: 34px !important;\n\
  min-width: 58px !important;\n\
  -webkit-tap-highlight-color: transparent !important;\n\
}\n\
\n\
.warhub-tabs {\n\
  display: flex !important;\n\
  gap: 4px !important;\n\
  padding: 6px 8px !important;\n\
  overflow-x: auto !important;\n\
  overflow-y: hidden !important;\n\
  -webkit-overflow-scrolling: touch !important;\n\
  scrollbar-width: none !important;\n\
  flex-wrap: nowrap !important;\n\
}\n\
.warhub-tabs::-webkit-scrollbar {\n\
  display: none !important;\n\
}\n\
.warhub-tab {\n\
  appearance: none !important;\n\
  -webkit-appearance: none !important;\n\
  border: 1px solid rgba(255,255,255,.10) !important;\n\
  background: rgba(255,255,255,.06) !important;\n\
  color: #fff !important;\n\
  border-radius: 10px !important;\n\
  padding: 7px 9px !important;\n\
  min-height: 34px !important;\n\
  min-width: 78px !important;\n\
  font-size: 12px !important;\n\
  font-weight: 700 !important;\n\
  line-height: 1.1 !important;\n\
  white-space: nowrap !important;\n\
  flex: 0 0 auto !important;\n\
}\n\
.warhub-tab.active {\n\
  background: linear-gradient(180deg, rgba(220,50,50,.95), rgba(145,18,18,.98)) !important;\n\
  border-color: rgba(255,255,255,.16) !important;\n\
}\n\
.warhub-body {\n\
  flex: 1 1 auto !important;\n\
  min-height: 0 !important;\n\
  overflow-y: auto !important;\n\
  overflow-x: hidden !important;\n\
  -webkit-overflow-scrolling: touch !important;\n\
  padding: 12px !important;\n\
}\n\
\n\
.warhub-status-wrap {\n\
  margin: 0 0 10px !important;\n\
}\n\
\n\
.warhub-grid { display: grid !important; gap: 10px !important; }\n\
.warhub-card {\n\
  background: rgba(255,255,255,.04) !important;\n\
  border: 1px solid rgba(255,255,255,.08) !important;\n\
  border-radius: 12px !important;\n\
  padding: 10px !important;\n\
  box-shadow: inset 0 1px 0 rgba(255,255,255,.03) !important;\n\
}\n\
.warhub-card h3,\n\
.warhub-card h4 {\n\
  margin: 0 0 8px !important;\n\
  color: #fff !important;\n\
}\n\
.warhub-muted { opacity: .72 !important; }\n\
.warhub-row {\n\
  display: flex !important;\n\
  align-items: center !important;\n\
  gap: 8px !important;\n\
  flex-wrap: wrap !important;\n\
}\n\
.warhub-col {\n\
  display: flex !important;\n\
  flex-direction: column !important;\n\
  gap: 8px !important;\n\
}\n\
.warhub-space { height: 8px !important; }\n\
.warhub-label {\n\
  font-size: 12px !important;\n\
  font-weight: 700 !important;\n\
  opacity: .85 !important;\n\
}\n\
.warhub-input,\n\
.warhub-textarea,\n\
.warhub-select {\n\
  width: 100% !important;\n\
  padding: 10px 11px !important;\n\
  border-radius: 10px !important;\n\
  border: 1px solid rgba(255,255,255,.12) !important;\n\
  background: rgba(255,255,255,.07) !important;\n\
  color: #fff !important;\n\
  outline: none !important;\n\
  font-size: 16px !important;\n\
}\n\
.warhub-textarea {\n\
  min-height: 110px !important;\n\
  resize: vertical !important;\n\
}\n\
.warhub-btn {\n\
  appearance: none !important;\n\
  -webkit-appearance: none !important;\n\
  border: 1px solid rgba(255,255,255,.12) !important;\n\
  background: linear-gradient(180deg, rgba(220,50,50,.95), rgba(145,18,18,.98)) !important;\n\
  color: #fff !important;\n\
  border-radius: 10px !important;\n\
  padding: 9px 12px !important;\n\
  min-height: 38px !important;\n\
  font-size: 13px !important;\n\
  font-weight: 800 !important;\n\
  cursor: pointer !important;\n\
  -webkit-tap-highlight-color: transparent !important;\n\
}\n\
.warhub-btn.ghost { background: rgba(255,255,255,.08) !important; }\n\
.warhub-btn.gray { background: rgba(255,255,255,.10) !important; }\n\
.warhub-btn.green { background: linear-gradient(180deg, rgba(42,168,95,.98), rgba(21,120,64,.98)) !important; }\n\
.warhub-btn.available { background: linear-gradient(180deg, rgba(42,168,95,.98), rgba(21,120,64,.98)) !important; }\n\
.warhub-btn.unavailable { background: linear-gradient(180deg, rgba(190,36,36,.98), rgba(118,14,14,.98)) !important; }\n\
.warhub-btn.warn { background: linear-gradient(180deg, rgba(226,154,27,.98), rgba(163,102,8,.98)) !important; }\n\.warhub-btn.bounty { background: linear-gradient(180deg, rgba(220,50,50,.98), rgba(145,18,18,.98)) !important; border-color: rgba(255,255,255,.14) !important; }\n\
.warhub-pill {\n\
  display: inline-flex !important;\n\
  align-items: center !important;\n\
  justify-content: center !important;\n\
  min-height: 24px !important;\n\
  padding: 4px 8px !important;\n\
  border-radius: 999px !important;\n\
  font-size: 12px !important;\n\
  font-weight: 800 !important;\n\
  line-height: 1 !important;\n\
  border: 1px solid rgba(255,255,255,.10) !important;\n\
  background: rgba(255,255,255,.08) !important;\n\
  color: #fff !important;\n\
}\n\
.warhub-pill.good { background: rgba(36,140,82,.35) !important; }\n\
.warhub-pill.bad { background: rgba(170,32,32,.35) !important; }\n\
.warhub-pill.neutral { background: rgba(255,255,255,.08) !important; }\n\
.warhub-pill.online { background: rgba(42,168,95,.35) !important; }\n\
.warhub-pill.idle { background: rgba(197,142,32,.35) !important; }\n\
.warhub-pill.travel { background: rgba(66,124,206,.35) !important; }\n\
.warhub-pill.jail { background: rgba(120,85,160,.35) !important; }\n\
.warhub-pill.hospital { background: rgba(199,70,70,.35) !important; }\n\
.warhub-pill.offline { background: rgba(105,105,105,.35) !important; }\n\
.warhub-kv {\n\
  display: grid !important;\n\
  grid-template-columns: 1fr auto !important;\n\
  gap: 8px !important;\n\
  align-items: center !important;\n\
  padding: 8px 0 !important;\n\
  border-bottom: 1px solid rgba(255,255,255,.05) !important;\n\
}\n\
.warhub-kv:last-child { border-bottom: 0 !important; }\n\
.warhub-member-group {\n\
  border: 1px solid rgba(255,255,255,.08) !important;\n\
  border-radius: 12px !important;\n\
  overflow: hidden !important;\n\
  background: rgba(255,255,255,.03) !important;\n\
}\n\
.warhub-member-group-head {\n\
  display: flex !important;\n\
  align-items: center !important;\n\
  justify-content: space-between !important;\n\
  gap: 8px !important;\n\
  padding: 10px !important;\n\
  background: rgba(255,255,255,.05) !important;\n\
  cursor: pointer !important;\n\
  -webkit-tap-highlight-color: transparent !important;\n\
}\n\
.warhub-member-list {\n\
  display: flex !important;\n\
  flex-direction: column !important;\n\
}\n\
.warhub-member-row {\n\
  display: flex !important;\n\
  flex-direction: column !important;\n\
  gap: 8px !important;\n\
  padding: 10px !important;\n\
  border-top: 1px solid rgba(255,255,255,.06) !important;\n\
}\n\
.warhub-member-main {\n\
  display: flex !important;\n\
  align-items: center !important;\n\
  justify-content: space-between !important;\n\
  gap: 8px !important;\n\
  flex-wrap: wrap !important;\n\
}\n\
.warhub-member-name {\n\
  font-weight: 800 !important;\n\
  color: #fff !important;\n\
  text-decoration: none !important;\n\
}\n\
.warhub-statline {\n\
  display: flex !important;\n\
  align-items: center !important;\n\
  gap: 10px !important;\n\
  flex-wrap: wrap !important;\n\
  font-size: 12px !important;\n\
  opacity: .95 !important;\n\
}\n\
.warhub-spy-box {\n\
  width: 100% !important;\n\
  border-radius: 10px !important;\n\
  background: rgba(0,0,0,.25) !important;\n\
  border: 1px solid rgba(255,255,255,.08) !important;\n\
  padding: 8px !important;\n\
  font-size: 12px !important;\n\
}\n\
.warhub-hero-card {\n\
  padding: 12px !important;\n\
  border-radius: 14px !important;\n\
  background: linear-gradient(180deg, rgba(160,18,18,.20), rgba(255,255,255,.03)) !important;\n\
  border: 1px solid rgba(255,255,255,.08) !important;\n\
}\n\
.warhub-mini-grid {\n\
  display: grid !important;\n\
  grid-template-columns: repeat(2, minmax(0, 1fr)) !important;\n\
  gap: 8px !important;\n\
}\n\
.warhub-section-scroll {\n\
  max-height: 38vh !important;\n\
  overflow: auto !important;\n\
  -webkit-overflow-scrolling: touch !important;\n\
}\n\
.warhub-overview-hero {\n\
  display: flex !important;\n\
  flex-direction: column !important;\n\
  gap: 10px !important;\n\
}\n\
.warhub-war-head {\n\
  display: grid !important;\n\
  grid-template-columns: 1fr auto 1fr !important;\n\
  gap: 10px !important;\n\
  align-items: center !important;\n\
}\n\
.warhub-war-side {\n\
  min-width: 0 !important;\n\
  border-radius: 12px !important;\n\
  background: rgba(255,255,255,.05) !important;\n\
  border: 1px solid rgba(255,255,255,.08) !important;\n\
  padding: 10px !important;\n\
}\n\
.warhub-war-side.right { text-align: right !important; }\n\
.warhub-war-side-label {\n\
  font-size: 11px !important;\n\
  opacity: .72 !important;\n\
  margin-bottom: 4px !important;\n\
}\n\
.warhub-war-side-name {\n\
  font-size: 14px !important;\n\
  font-weight: 800 !important;\n\
  color: #fff !important;\n\
  line-height: 1.25 !important;\n\
  word-break: break-word !important;\n\
}\n\
.warhub-war-vs {\n\
  font-size: 12px !important;\n\
  font-weight: 900 !important;\n\
  letter-spacing: .8px !important;\n\
  opacity: .78 !important;\n\
}\n\
.warhub-overview-stats {\n\
  display: grid !important;\n\
  grid-template-columns: repeat(2, minmax(0, 1fr)) !important;\n\
  gap: 8px !important;\n\
}\n\
.warhub-stat-card {\n\
  border-radius: 12px !important;\n\
  background: rgba(255,255,255,.05) !important;\n\
  border: 1px solid rgba(255,255,255,.08) !important;\n\
  padding: 10px !important;\n\
}\n\
.warhub-stat-card.good {\n\
  border-color: rgba(90,200,120,.22) !important;\n\
  background: linear-gradient(180deg, rgba(90,200,120,.10), rgba(255,255,255,.04)) !important;\n\
}\n\
.warhub-stat-card.bad {\n\
  border-color: rgba(220,90,90,.22) !important;\n\
  background: linear-gradient(180deg, rgba(220,90,90,.10), rgba(255,255,255,.04)) !important;\n\
}\n\
.warhub-stat-label {\n\
  font-size: 11px !important;\n\
  opacity: .74 !important;\n\
  margin-bottom: 5px !important;\n\
}\n\
.warhub-stat-value {\n\
  font-size: 22px !important;\n\
  line-height: 1 !important;\n\
  font-weight: 900 !important;\n\
  color: #fff !important;\n\
}\n\
.warhub-overview-link-card {\n\
  min-height: 152px !important;\n\
  display: flex !important;\n\
  flex-direction: column !important;\n\
}\n\
   .warhub-alert-grid {\n\
  display: grid !important;\n\
  grid-template-columns: 1fr 1fr !important;\n\
  gap: 8px !important;\n\
}\n\
.warhub-alert-card {\n\
  border-radius: 12px !important;\n\
  background: rgba(255,255,255,.05) !important;\n\
  border: 1px solid rgba(255,255,255,.08) !important;\n\
  padding: 10px !important;\n\
}\n\
.warhub-alert-card h4 {\n\
  margin: 0 0 8px !important;\n\
  font-size: 13px !important;\n\
  color: #fff !important;\n\
}\n\
.warhub-summary-list {\n\
  display: flex !important;\n\
  flex-direction: column !important;\n\
  gap: 6px !important;\n\
}\n\
.warhub-summary-item {\n\
  display: flex !important;\n\
  justify-content: space-between !important;\n\
  align-items: center !important;\n\
  gap: 8px !important;\n\
  padding: 7px 8px !important;\n\
  border-radius: 10px !important;\n\
  background: rgba(0,0,0,.22) !important;\n\
  border: 1px solid rgba(255,255,255,.06) !important;\n\
}\n\
.warhub-summary-name {\n\
  font-weight: 800 !important;\n\
  color: #fff !important;\n\
}\n\
.warhub-summary-meta {\n\
  opacity: .78 !important;\n\
  font-size: 11px !important;\n\
}\n\
.warhub-table-wrap {\n\
  width: 100% !important;\n\
  overflow-x: auto !important;\n\
  -webkit-overflow-scrolling: touch !important;\n\
  border-radius: 12px !important;\n\
  border: 1px solid rgba(255,255,255,.08) !important;\n\
}\n\
.warhub-table {\n\
  width: 100% !important;\n\
  min-width: 860px !important;\n\
  border-collapse: collapse !important;\n\
  font-size: 12px !important;\n\
}\n\
.warhub-table th,\n\
.warhub-table td {\n\
  padding: 8px 9px !important;\n\
  border-bottom: 1px solid rgba(255,255,255,.06) !important;\n\
  text-align: left !important;\n\
  vertical-align: middle !important;\n\
}\n\
.warhub-table th {\n\
  position: sticky !important;\n\
  top: 0 !important;\n\
  background: #121212 !important;\n\
  z-index: 1 !important;\n\
  font-size: 11px !important;\n\
  letter-spacing: .2px !important;\n\
}\n\
.warhub-flag-row {\n\
  display: flex !important;\n\
  flex-wrap: wrap !important;\n\
  gap: 4px !important;\n\
}\n\
.warhub-flag {\n\
  display: inline-flex !important;\n\
  align-items: center !important;\n\
  min-height: 20px !important;\n\
  padding: 2px 7px !important;\n\
  border-radius: 999px !important;\n\
  font-size: 10px !important;\n\
  font-weight: 800 !important;\n\
  background: rgba(255,255,255,.08) !important;\n\
  border: 1px solid rgba(255,255,255,.08) !important;\n\
}\n\
.warhub-dropbox {\n\
  border-radius: 12px !important;\n\
  border: 1px solid rgba(255,255,255,.08) !important;\n\
  background: rgba(255,255,255,.04) !important;\n\
  overflow: hidden !important;\n\
}\n\
.warhub-dropbox-head {\n\
  cursor: pointer !important;\n\
  list-style: none !important;\n\
  padding: 10px !important;\n\
  font-weight: 800 !important;\n\
}\n\
.warhub-dropbox-head::-webkit-details-marker {\n\
  display: none !important;\n\
}\n\
.warhub-dropbox-body {\n\
  padding: 0 10px 10px !important;\n\
}\n\
@media (max-width: 520px) {\n\
  .warhub-alert-grid {\n\
    grid-template-columns: 1fr !important;\n\
  }\n\
}\n\
.warhub-overview-link-card .warhub-spy-box { flex: 1 1 auto !important; }\n\
.warhub-overview-link-card .warhub-row { margin-top: auto !important; }\n\
.warhub-overview-link-card.terms { border-color: rgba(255,255,255,.10) !important; }\n\
.warhub-overview-link-card.meddeals { border-color: rgba(90,200,120,.18) !important; }\n\
.warhub-overview-link-card.dibs { border-color: rgba(220,90,90,.18) !important; }\n\
@media (max-width: 520px) {\n\
  #warhub-shield {\n\
    width: 44px !important;\n\
    height: 44px !important;\n\
    font-size: 22px !important;\n\
    border-radius: 12px !important;\n\
  }\n\
  #warhub-overlay {\n\
    left: 6px !important;\n\
    right: 6px !important;\n\
    top: 6px !important;\n\
    bottom: 6px !important;\n\
    max-width: none !important;\n\
    border-radius: 12px !important;\n\
  }\n\
  .warhub-mini-grid { grid-template-columns: 1fr !important; }\n\
  .warhub-war-head { grid-template-columns: 1fr !important; }\n\
  .warhub-war-vs { text-align: center !important; }\n\
  .warhub-overview-stats { grid-template-columns: 1fr 1fr !important; }\n\
  .warhub-section-scroll { max-height: 34vh !important; }\n\
  .warhub-tabs {\n\
    min-height: 50px !important;\n\
    max-height: 50px !important;\n\
    padding: 8px 6px !important;\n\
    gap: 6px !important;\n\
  }\n\
    .warhub-tabs {\n\
    min-height: 46px !important;\n\
    max-height: 46px !important;\n\
    padding: 6px 5px !important;\n\
    gap: 4px !important;\n\
  }\n\
  .warhub-tab {\n\
    font-size: 11px !important;\n\
    padding: 7px 8px !important;\n\
    min-height: 34px !important;\n\
    min-width: 70px !important;\n\
  }\n\
  .warhub-body { padding: 10px !important; }\n\
}\n\
";

    GM_addStyle(css);
    GM_addStyle([
        '#warhub-header-slot { display: inline-flex !important; align-items: center !important; justify-content: center !important; flex: 0 0 auto !important; width: 34px !important; height: 34px !important; margin: 3px 6px 3px 8px !important; vertical-align: middle !important; position: relative !important; z-index: 50 !important; }',
        '#warhub-shield.warhub-header-mounted { position: static !important; left: auto !important; right: auto !important; top: auto !important; bottom: auto !important; transform: none !important; width: 32px !important; height: 32px !important; min-width: 32px !important; min-height: 32px !important; max-width: 32px !important; max-height: 32px !important; border-radius: 8px !important; background: transparent !important; border: 0 !important; box-shadow: none !important; margin: 0 !important; padding: 0 !important; display: inline-flex !important; align-items: center !important; justify-content: center !important; opacity: 1 !important; visibility: visible !important; pointer-events: auto !important; z-index: 50 !important; }',
        '#warhub-shield.warhub-header-mounted button { width: 32px !important; height: 32px !important; min-width: 32px !important; min-height: 32px !important; border-radius: 8px !important; border: 1px solid rgba(205,164,74,.50) !important; background: linear-gradient(180deg, rgba(90,12,18,.96), rgba(35,8,10,.98)) !important; color: #f5df9d !important; font-size: 18px !important; line-height: 1 !important; font-weight: 900 !important; box-shadow: 0 2px 8px rgba(0,0,0,.35) !important; padding: 0 !important; margin: 0 !important; cursor: pointer !important; display: inline-flex !important; align-items: center !important; justify-content: center !important; }',
        '#warhub-shield:not(.warhub-header-mounted) { display: none !important; }',
        '#warhub-badge.warhub-header-badge { position: absolute !important; right: -4px !important; top: -5px !important; left: auto !important; z-index: 60 !important; }'
    ].join('\n'));

    // ============================================================
    // 06. BASIC UTILITIES
    // ============================================================

    function esc(v) {
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function fmtNum(v) {
        var n = Number(v);
        return Number.isFinite(n) ? n.toLocaleString() : '—';
    }

    function netPill(value, label) {
        var n = Number(value || 0);
        var cls = n > 0 ? 'good' : (n < 0 ? 'bad' : 'neutral');
        return '<span class="warhub-pill ' + cls + '">' + esc(label || 'Net') + ' ' + fmtNum(n) + '</span>';
    }

    function fmtMoney(v) {
        var n = Number(v);
        return Number.isFinite(n) ? '$' + n.toLocaleString() : '—';
    }

    function fmtHosp(v, txt) {
        if (txt) return txt;
        var n = Number(v);
        return Number.isFinite(n) && n > 0 ? String(n) + 's' : '—';
    }

    function fmtTs(v) {
        if (!v) return '—';
        try {
            var d = new Date(v);
            if (Number.isNaN(d.getTime())) return String(v);
            return d.toLocaleString();
        } catch (_unused) {
            return String(v);
        }
    }

    function fmtDaysLeftFromIso(v) {
        if (!v) return null;
        try {
            var ms = new Date(v).getTime() - Date.now();
            if (!Number.isFinite(ms)) return null;
            return Math.ceil(ms / 86400000);
        } catch (_unused2) {
            return null;
        }
    }


    function shouldKeepOverviewDib(item) {
        if (!item || typeof item !== 'object') return false;
        if (item.in_hospital) return true;

        var now = Date.now();
        var leftAt = item.left_hospital_at ? new Date(item.left_hospital_at).getTime() : 0;
        if (Number.isFinite(leftAt) && leftAt > 0) {
            return (now - leftAt) <= 30000;
        }

        var removeAt = Number(item.overview_remove_after_ts || 0);
        if (Number.isFinite(removeAt) && removeAt > 0) {
            return (removeAt * 1000) > now;
        }

        return false;
    }

    function arr(v) {
        return Array.isArray(v) ? v : [];
    }

    function cleanInputValue(v) {
        return String(v || '')
            .replace(/[\u200B-\u200D\uFEFF]/g, '')
            .trim()
            .replace(/^['"]+|['"]+$/g, '')
            .trim();
    }

    function getSideLocks() { return { members: {}, enemies: {}, war_id: '' }; }

    function saveSideLocks() { return { members: {}, enemies: {}, war_id: '' }; }

    function clearSideLocksIfWarChanged() { return { members: {}, enemies: {}, war_id: '' }; }

    function rememberMemberLocks() { return { members: {}, enemies: {}, war_id: '' }; }

    function rememberEnemyLocks() { return { members: {}, enemies: {}, war_id: '' }; }

    function formatCountdown(totalSecs) {
        totalSecs = Math.max(0, Number(totalSecs || 0) | 0);

        var h = Math.floor(totalSecs / 3600);
        var m = Math.floor((totalSecs % 3600) / 60);
        var s = totalSecs % 60;

        if (h > 0) return h + 'h ' + String(m).padStart(2, '0') + 'm ' + String(s).padStart(2, '0') + 's';
        if (m > 0) return m + 'm ' + String(s).padStart(2, '0') + 's';
        return s + 's';
    }

    function stopMembersCountdownLoop() {
        if (membersCountdownTimer) {
            clearInterval(membersCountdownTimer);
            membersCountdownTimer = null;
        }
    }

    function tickMembersCountdowns() {
        if (!overlay) return;
        if (currentTab !== 'overview' && currentTab !== 'members' && currentTab !== 'hospital' && currentTab !== 'enemies') return;

        var chainTimers = overlay.querySelectorAll('[data-chain-hit-timer]');
        chainTimers.forEach(function (timerEl) {
            var base = Number(timerEl.getAttribute('data-chain-hit-base') || 0);
            var renderedAt = Number(timerEl.getAttribute('data-chain-hit-rendered-at') || Date.now());
            var elapsedTimer = Math.floor((Date.now() - renderedAt) / 1000);
            var live = Math.max(0, base - elapsedTimer);
            timerEl.textContent = 'Hit Timer: ' + (live > 0 ? formatCountdown(live) : 'Ready');
        });

        if (!membersLiveStamp) return;

        var elapsed = Math.floor((Date.now() - membersLiveStamp) / 1000);
        var rows = overlay.querySelectorAll('.warhub-member-row');

        rows.forEach(function (row) {
            var medEl = row.querySelector('[data-medcd]');
            var statusEl = row.querySelector('[data-statuscd]');
            var etaEl = row.querySelector('[data-hospital-eta]');

            if (medEl) {
                var baseMed = Number(row.getAttribute('data-medcd-base') || 0);
                var liveMed = Math.max(0, baseMed - elapsed);
                medEl.textContent = liveMed > 0 ? formatCountdown(liveMed) : 'Ready';
            }

            var baseStatus = Number(row.getAttribute('data-statuscd-base') || 0);
            var stateName = String(row.getAttribute('data-state-name') || '').toLowerCase();
            var liveStatus = Math.max(0, baseStatus - elapsed);

            if (statusEl) {
                if (stateName === 'hospital') {
                    statusEl.textContent = liveStatus > 0 ? 'Hospital (' + formatCountdown(liveStatus) + ')' : 'Hospital';
                } else if (stateName === 'jail') {
                    statusEl.textContent = liveStatus > 0 ? 'Jail (' + formatCountdown(liveStatus) + ')' : 'Jail';
                } else if (stateName === 'travel') {
                    statusEl.textContent = liveStatus > 0 ? 'Travel (' + formatCountdown(liveStatus) + ')' : 'Travel';
                } else if (stateName === 'idle') {
                    statusEl.textContent = 'Idle';
                } else if (stateName === 'online') {
                    statusEl.textContent = 'Online';
                } else {
                    statusEl.textContent = 'Offline';
                }
            }

            if (etaEl) {
                etaEl.textContent = liveStatus > 0 ? formatCountdown(liveStatus) : 'Out now';
            }
        });
    }

    function startMembersCountdownLoop() {
        stopMembersCountdownLoop();
        if (currentTab !== 'overview' && currentTab !== 'members' && currentTab !== 'hospital' && currentTab !== 'enemies') return;

        membersCountdownTimer = setInterval(function () {
            tickMembersCountdowns();
        }, 1000);
    }

    // ============================================================
    // 07. LOCAL NOTIFICATIONS / STATUS
    // ============================================================

    function getLocalNotifications() {
        return arr(GM_getValue(K_LOCAL_NOTIFICATIONS, []));
    }

    function setLocalNotifications(v) {
        GM_setValue(K_LOCAL_NOTIFICATIONS, arr(v));
    }

    function pushLocalNotification(kind, text) {
        var items = getLocalNotifications();
        items.unshift({
            id: String(Date.now()) + '_' + Math.random().toString(36).slice(2, 8),
            kind: String(kind || 'info'),
            text: String(text || ''),
            created_at: new Date().toISOString()
        });
        if (items.length > 50) items = items.slice(0, 50);
        setLocalNotifications(items);
        updateBadge();
    }

    function setStatus(msg, isErr) {
        lastStatusMsg = String(msg || '');
        lastStatusErr = !!isErr;
        renderStatus();
    }

    function renderStatus() {
        if (!overlay) return;
        var box = overlay.querySelector('#warhub-status');
        if (!box) return;

        if (!lastStatusMsg) {
            box.style.display = 'none';
            box.innerHTML = '';
            return;
        }

        box.style.display = 'block';
        box.innerHTML = '<div class="warhub-pill ' + (lastStatusErr ? 'bad' : 'good') + '">' + esc(lastStatusMsg) + '</div>';
    }

    function updateBadge() {
        if (!badge) return;
        var count = getLocalNotifications().filter(function (x) { return !x.seen; }).length;

        if (!count) {
            badge.style.display = 'none';
            badge.textContent = '';
            return;
        }

        badge.style.display = 'block';
        badge.textContent = count > 99 ? '99+' : String(count);
        positionBadge();
    }

    // ============================================================
    // 08. ASYNC / REQUEST HELPERS
    // ============================================================

    function _asyncToGenerator(fn) {
        return function () {
            var self = this;
            var args = arguments;

            return new Promise(function (resolve, reject) {
                var gen = fn.apply(self, args);

                function step(key, arg) {
                    var info;
                    try {
                        info = gen[key](arg);
                    } catch (error) {
                        reject(error);
                        return;
                    }

                    var value = info.value;
                    if (info.done) {
                        resolve(value);
                    } else {
                        Promise.resolve(value).then(function (val) {
                            step('next', val);
                        }, function (err) {
                            step('throw', err);
                        });
                    }
                }

                step('next');
            });
        };
    }

    function req(method, path, body, extraHeaders) {
        return new Promise(function (resolve) {
            var headers = Object.assign({
                'Content-Type': 'application/json'
            }, extraHeaders || {});

            GM_xmlhttpRequest({
                method: method || 'GET',
                url: BASE_URL + path,
                headers: headers,
                data: body ? JSON.stringify(body) : undefined,
                timeout: 30000,
                onload: function (res) {
                    var json = null;
                    try {
                        json = JSON.parse(res.responseText || '{}');
                    } catch (_unused3) {
                        json = null;
                    }

                    resolve({
                        ok: res.status >= 200 && res.status < 300,
                        status: res.status,
                        json: json,
                        text: res.responseText || ''
                    });
                },
                onerror: function () {
                    resolve({ ok: false, status: 0, json: null, text: '' });
                },
                ontimeout: function () {
                    resolve({ ok: false, status: 0, json: null, text: '' });
                }
            });
        });
    }

    function getSessionToken() {
        return cleanInputValue(GM_getValue(K_SESSION, ''));
    }

    function getApiKey() {
        return cleanInputValue(GM_getValue(K_API_KEY, ''));
    }

    function getAdminKey() {
        return cleanInputValue(GM_getValue(K_ADMIN_KEY, ''));
    }

    function getOwnerToken() {
        return cleanInputValue(GM_getValue(K_OWNER_TOKEN, ''));
    }

    function isLoggedIn() {
        return !!getSessionToken();
    }

    function authedReq(method, path, body, extraHeaders) {
        var token = getSessionToken();
        var headers = Object.assign({}, extraHeaders || {});
        if (token) headers['X-Session-Token'] = token;
        return req(method, path, body, headers);
    }

    function adminReq(method, path, body, extraHeaders) {
        var headers = Object.assign({}, extraHeaders || {});
        var token = getOwnerToken() || getAdminKey();
        if (token) headers['X-License-Admin'] = token;
        return authedReq(method, path, body, headers);
    }

    // ============================================================
    // 09. ACCESS / ROLE HELPERS
    // ============================================================

    function normalizeAccessCache(v) { if (!v || typeof v !== 'object') { return { status: 'logged_out', message: 'Not logged in.', can_use_features: false, is_faction_leader: false, is_admin: false, member_enabled: false, blocked: false }; } return { status: String(v.status || 'unknown'), message: String(v.message || ''), can_use_features: !!v.can_use_features, is_faction_leader: !!v.is_faction_leader, is_admin: !!v.is_admin, member_enabled: !!v.member_enabled, blocked: !!v.blocked }; } function setAccessCache(v) {
        accessState = normalizeAccessCache(v);
        GM_setValue(K_ACCESS_CACHE, accessState);
    }

    function viewerUserId() {
        return String(
            (state && state.viewer && state.viewer.user_id) ||
            (state && state.me && state.me.user_id) ||
            ''
        );
    }

    function viewerName() {
        return String(
            (state && state.viewer && state.viewer.name) ||
            (state && state.me && state.me.name) ||
            ''
        );
    }

    function isOwnerSession() {
        var uid = viewerUserId();
        var name = viewerName().toLowerCase();
        if (uid && uid === String(OWNER_USER_ID)) return true;
        if (name && name === String(OWNER_NAME).toLowerCase()) return true;
        return !!getOwnerToken();
    }

    function canManageFaction() {
        var a = normalizeAccessCache((state && state.access) || accessState);
        return !!(a.is_faction_leader || a.is_admin || isOwnerSession());
    }

    function canSeeSummary() {
        return canManageFaction();
    }

    function canSeeAdmin() {
        return !!(isOwnerSession() || ((state && state.access && state.access.is_admin) ? true : false));
    }

    function canUseFeatures() {
        var a = normalizeAccessCache((state && state.access) || accessState);
        return !!(a.can_use_features || a.is_admin || isOwnerSession());
    }

    function shouldShowTab(key) {
        if (key === 'admin') return canSeeAdmin();
        if (key === 'faction') return false;
        if (key === 'summary') return false;
        return true;
    }

    function getVisibleTabs(rows) {
        return rows.filter(function (pair) {
            return shouldShowTab(pair[0]);
        });
    }

    // ============================================================
    // 10. POSITION / DRAG HELPERS
    // ============================================================

    function getViewport() {
        var de = document.documentElement || {};
        return {
            w: Math.max(de.clientWidth || 0, window.innerWidth || 0, 320),
            h: Math.max(de.clientHeight || 0, window.innerHeight || 0, 320)
        };
    }

    function clamp(n, min, max) {
        n = Number(n || 0);
        if (!isFinite(n)) n = 0;
        return Math.max(min, Math.min(max, n));
    }

    function loadPos(key, fallback) {
        var raw = GM_getValue(key, null);

        if (!raw) return { left: fallback.left, top: fallback.top };

        if (typeof raw === 'string') {
            try {
                raw = JSON.parse(raw);
            } catch (_unused4) {
                return { left: fallback.left, top: fallback.top };
            }
        }

        if (!raw || typeof raw !== 'object') {
            return { left: fallback.left, top: fallback.top };
        }

        return {
            left: isFinite(Number(raw.left)) ? Number(raw.left) : fallback.left,
            top: isFinite(Number(raw.top)) ? Number(raw.top) : fallback.top
        };
    }

    function savePos(key, pos) {
        GM_setValue(key, {
            left: Math.round(Number(pos.left || 0)),
            top: Math.round(Number(pos.top || 0))
        });
    }


function isVisibleHeaderElement(el) {
    if (!el || el === document.body || el === document.documentElement) return false;
    if (el.id === 'warhub-header-slot' || el.id === 'warhub-shield' || el.id === 'warhub-overlay') return false;
    var rect = null;
    try { rect = el.getBoundingClientRect(); } catch (_e) { return false; }
    if (!rect || rect.width < 220 || rect.height < 24 || rect.height > 90) return false;
    if (rect.top < 55 || rect.top > Math.max(260, window.innerHeight * 0.42)) return false;
    var style = null;
    try { style = window.getComputedStyle(el); } catch (_e2) { return false; }
    if (!style || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) === 0) return false;
    var txt = String(el.innerText || el.textContent || '');
    if (txt.indexOf('War and Chain') >= 0) return false;
    return true;
}

function isStatHeaderHost(el) {
    if (!isVisibleHeaderElement(el)) return false;
    var txt = String(el.innerText || el.textContent || '');
    return /\$\s*[0-9]/.test(txt) || /[0-9]+\s*\/\s*[0-9]+/.test(txt) || /merit|money|point|happy|energy|nerve/i.test(txt);
}

function isLowerHeaderHost(el) {
    if (!isVisibleHeaderElement(el)) return false;
    var rect = el.getBoundingClientRect();
    var txt = String(el.innerText || el.textContent || '');

    // Keep the sword in the lower Torn header strip, not beside chain stats.
    if (isStatHeaderHost(el)) return false;
    if (/messages|events|awards|home|items|city|stocks|forums|missions|news/i.test(txt) && rect.height <= 85) return true;
    if (rect.height >= 28 && rect.height <= 72 && rect.top >= 80) return true;
    return false;
}

function scoreLowerHeaderHost(el) {
    var rect = el.getBoundingClientRect();
    var txt = String(el.innerText || el.textContent || '');
    var score = 0;
    if (/messages|events|awards|home|items|city|stocks|forums|missions|news/i.test(txt)) score += 60;
    if (rect.top >= 90) score += 25;
    if (rect.top >= 120) score += 10;
    if (rect.height <= 55) score += 15;
    if (rect.width > 300) score += 10;
    score -= Math.abs(rect.left) / 10;
    score -= Math.max(0, el.querySelectorAll('*').length - 80) / 2;
    return score;
}

function findTornHeaderHost() {
    var existing = document.getElementById('warhub-header-slot');
    if (existing && existing.parentNode && document.body && document.body.contains(existing.parentNode)) {
        var parentRect = null;
        try { parentRect = existing.parentNode.getBoundingClientRect(); } catch (_e0) { parentRect = null; }
        if (parentRect && parentRect.width > 0 && parentRect.height > 0 && isLowerHeaderHost(existing.parentNode)) return existing.parentNode;
    }

    var selectors = [
        '[class*=areas]',
        '[class*=menu]',
        '[class*=nav]',
        '[class*=links]',
        '[class*=icons]',
        '#header-root',
        '#topHeader',
        'nav',
        'ul',
        'section',
        'div'
    ];

    var seen = [];
    var candidates = [];
    selectors.forEach(function (sel) {
        Array.prototype.slice.call(document.querySelectorAll(sel)).forEach(function (el) {
            if (seen.indexOf(el) >= 0) return;
            seen.push(el);
            if (isLowerHeaderHost(el)) candidates.push(el);
        });
    });

    candidates.sort(function (a, b) { return scoreLowerHeaderHost(b) - scoreLowerHeaderHost(a); });
    if (candidates[0]) return candidates[0];

    var statFallbacks = Array.prototype.slice.call(document.querySelectorAll('div, ul, nav, section'))
        .filter(isStatHeaderHost)
        .sort(function (a, b) {
            var ar = a.getBoundingClientRect();
            var br = b.getBoundingClientRect();
            return br.top - ar.top;
        });

    return statFallbacks[0] || null;
}

function getOrCreateOwnHeaderSlot() {
    var host = findTornHeaderHost();
    if (!host) return null;

    var slot = document.getElementById('warhub-header-slot');
    if (!slot) {
        slot = document.createElement('span');
        slot.id = 'warhub-header-slot';
        slot.setAttribute('aria-label', 'War and Chain launcher slot');
    }

    if (slot.parentNode !== host) {
        try {
            host.insertBefore(slot, host.firstChild || null);
        } catch (_e) {
            try { host.appendChild(slot); } catch (_e2) { return null; }
        }
    }

    return slot;
}

function mountShieldIntoHeader() {
    if (!shield) return false;
    var slot = getOrCreateOwnHeaderSlot();
    if (!slot) return false;
    if (shield.parentNode !== slot) slot.appendChild(shield);
    shield.classList.add('warhub-header-mounted');
    return true;
}

function applyShieldPos() {
    if (!shield) return;

    if (mountShieldIntoHeader()) {
        shield.style.position = 'static';
        shield.style.left = 'auto';
        shield.style.top = 'auto';
        shield.style.bottom = 'auto';
        shield.style.right = 'auto';
        shield.style.width = '32px';
        shield.style.height = '32px';
        shield.style.display = 'inline-flex';
        shield.style.opacity = '1';
        shield.style.visibility = 'visible';
        shield.style.pointerEvents = 'auto';
        shield.style.transform = 'none';
        shield.style.zIndex = '50';
    } else {
        shield.classList.remove('warhub-header-mounted');
    }

    positionBadge();
}

    function applyOverlayPos() {
        if (!overlay) return;

        var vp = getViewport();
        var width = Math.min(520, vp.w - 12);
        var left = Math.max(6, Math.round((vp.w - width) / 2));

        overlay.style.left = left + 'px';
        overlay.style.right = 'auto';
        overlay.style.top = '60px';
        overlay.style.bottom = '6px';
        overlay.style.width = width + 'px';
        overlay.style.maxWidth = '520px';
    }

    function positionBadge() {
        if (!badge || !shield) return;

        if (shield.classList && shield.classList.contains('warhub-header-mounted')) {
            var slot = document.getElementById('warhub-header-slot');
            if (slot && badge.parentNode !== slot) slot.appendChild(badge);
            badge.classList.add('warhub-header-badge');
            badge.style.left = 'auto';
            badge.style.top = '-5px';
            badge.style.right = '-4px';
            return;
        }

        var rect = shield.getBoundingClientRect();
        badge.classList.remove('warhub-header-badge');
        if (document.body && badge.parentNode !== document.body) document.body.appendChild(badge);
        badge.style.left = Math.round(rect.right - 6) + 'px';
        badge.style.top = Math.round(rect.top - 6) + 'px';
        badge.style.right = 'auto';
    }

function makeHoldDraggable(handle, target, key) {
    if (!handle || !target) {
        return {
            didMove: function () { return false; },
            isDragging: function () { return false; }
        };
    }

    var dragging = false;
    var moved = false;
    var startX = 0;
    var startY = 0;
    var startLeft = 0;
    var startTop = 0;
    var pointerId = null;
    var DRAG_THRESHOLD = 6;

    function viewportClamp(left, top) {
        var vp = getViewport();
        return {
            left: Math.min(Math.max(8, Math.round(left)), Math.max(8, vp.w - 44)),
            top: Math.min(Math.max(8, Math.round(top)), Math.max(8, vp.h - 44))
        };
    }

    function getPoint(ev) {
        if (ev.touches && ev.touches.length) return ev.touches[0];
        if (ev.changedTouches && ev.changedTouches.length) return ev.changedTouches[0];
        return ev;
    }

    function onDown(ev) {
        var pt = getPoint(ev);
        dragging = true;
        moved = false;
        pointerId = pt && pt.identifier != null ? pt.identifier : 'mouse';
        startX = Number(pt.clientX || 0);
        startY = Number(pt.clientY || 0);
        var rect = target.getBoundingClientRect();
        startLeft = rect.left;
        startTop = rect.top;
        if (ev.cancelable) ev.preventDefault();
        ev.stopPropagation();
    }

    function onMove(ev) {
        if (!dragging) return;
        var pt = getPoint(ev);
        var dx = Number(pt.clientX || 0) - startX;
        var dy = Number(pt.clientY || 0) - startY;
        if (!moved && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) moved = true;
        if (!moved) return;
        var pos = viewportClamp(startLeft + dx, startTop + dy);
        target.style.left = pos.left + 'px';
        target.style.top = pos.top + 'px';
        target.style.right = 'auto';
        target.style.bottom = 'auto';
        target.style.transform = 'none';
        positionBadge();
        if (ev.cancelable) ev.preventDefault();
    }

    function onUp(ev) {
        if (!dragging) return;
        dragging = false;
        var rect = target.getBoundingClientRect();
        var pos = viewportClamp(rect.left, rect.top);
        target.style.left = pos.left + 'px';
        target.style.top = pos.top + 'px';
        savePos(key, pos);
        positionBadge();
        if (!moved) setOverlayOpen(!isOpen);
        if (ev && ev.cancelable) ev.preventDefault();
    }

    handle.addEventListener('mousedown', onDown);
    handle.addEventListener('touchstart', onDown, { passive: false });
    window.addEventListener('mousemove', onMove, { passive: false });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('mouseup', onUp, { passive: false });
    window.addEventListener('touchend', onUp, { passive: false });
    handle.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });

    return {
        didMove: function () { return moved; },
        isDragging: function () { return dragging; }
    };
}

    // ============================================================
    // 11. AUTH / LOGIN
    // ============================================================

    function doLogin() {
        return _doLogin.apply(this, arguments);
    }

    function _doLogin() {
        _doLogin = _asyncToGenerator(function* () {
            var input = overlay && overlay.querySelector('#warhub-api-key');
            var ownerInput = overlay && overlay.querySelector('#warhub-owner-token');
            var ffInput = overlay && overlay.querySelector('#warhub-ff-key');
            var key = cleanInputValue(input && input.value);
            var ownerToken = cleanInputValue(ownerInput && ownerInput.value);
            var ffKey = cleanInputValue(ffInput && ffInput.value);
            var storedKey = cleanInputValue(getApiKey());
            var maskedOnly = /^\*+$/.test(String(key || ''));

            if ((!key || maskedOnly) && storedKey) {
                key = storedKey;
            }

            if (!key) {
                setStatus('Enter your Torn Limited API key.', true);
                return;
            }

            GM_setValue(K_API_KEY, key);
            if (ownerToken) GM_setValue(K_OWNER_TOKEN, ownerToken);
            if (ffKey || ffInput) GM_setValue(K_FF_SCOUTER_KEY, ffKey);

            setStatus('Logging in...', false);

            var res = yield req('POST', '/api/auth', {
                api_key: key
            });

            if (!res.ok || !res.json || !res.json.token) {
                setStatus((res.json && res.json.error) || 'Login failed.', true);
                return;
            }

            GM_setValue(K_SESSION, String(res.json.token));

            if (res.json.state && typeof res.json.state === 'object') {
                state = res.json.state;
                if (!state.viewer && res.json.viewer) state.viewer = res.json.viewer;
                if (!state.user && res.json.user) state.user = res.json.user;
                if (!state.access && res.json.access) state.access = res.json.access;
                try { setAccessCache(state.access || {}); } catch (_e0) {}
            } else if (res.json.viewer || res.json.user || res.json.access) {
                state = state || {};
                if (res.json.viewer) state.viewer = res.json.viewer;
                if (res.json.user) state.user = res.json.user;
                if (res.json.access) {
                    state.access = res.json.access;
                    try { setAccessCache(res.json.access || {}); } catch (_e00) {}
                }
            }

            if (res.json.viewer && res.json.viewer.name) {
                pushLocalNotification('info', 'Logged in as ' + res.json.viewer.name);
            } else {
                pushLocalNotification('info', 'Logged in.');
            }

            try {
                yield loadState();
                renderBody();
                restartPolling();
            } catch (refreshErr) {
                console.error('War and Chain post-login refresh error:', refreshErr);
                try { renderBody(); } catch (_e) {}
                try { restartPolling(); } catch (_e2) {}
            }
            setStatus('Logged in successfully.', false);
        });

        return _doLogin.apply(this, arguments);
    }

    function doLogout() {
        GM_deleteValue(K_SESSION);
        state = null;
        currentFactionMembers = [];
        factionMembersCache = null;
        liveSummaryCache = null;
        liveSummaryError = '';
        warEnemiesCache = [];
        warEnemiesFactionName = '';
        warEnemiesFactionId = '';
        membersLiveStamp = 0;

        setAccessCache({
            status: 'logged_out',
            message: 'Logged out.',
            can_use_features: false
        });

        stopMembersCountdownLoop();
        setStatus('Logged out.', false);
        renderBody();
        updateBadge();
    }

    // ============================================================
    // 12. DATA LOADERS
    // ============================================================

    function loadState() {
    return _loadState.apply(this, arguments);
}


function _loadState() {
    _loadState = _asyncToGenerator(function* () {
        if (!isLoggedIn()) {
            state = null;
            currentFactionMembers = [];
            factionMembersCache = [];
            warEnemiesCache = [];
            warEnemiesFactionId = '';
            warEnemiesFactionName = '';
            renderBody();
            return null;
        }

        var res = yield authedReq('GET', '/api/state');
        if (!res.ok) {
            if (res.status === 401 || res.status === 403) {
                GM_deleteValue(K_SESSION);
                state = null;
                currentFactionMembers = [];
                factionMembersCache = [];
                warEnemiesCache = [];
                warEnemiesFactionId = '';
                warEnemiesFactionName = '';
                setAccessCache({
                    status: 'unauthorized',
                    message: 'Session expired. Please log in again.',
                    can_use_features: false
                });
                renderBody();
            }
            return null;
        }

        state = (res.json && typeof res.json === 'object') ? res.json : {};
        setAccessCache(state.access || {});

        if (!state.war || typeof state.war !== 'object') state.war = {};
        if (!state.faction || typeof state.faction !== 'object') state.faction = {};
        if (!Array.isArray(state.targets)) state.targets = [];
        state.targets = mergeTargets(state.targets, getLocalTargets());
        if (!state.hospital || typeof state.hospital !== 'object') state.hospital = { items: [] };

        warEnemiesFactionId = String(state.war.enemy_faction_id || '');
        warEnemiesFactionName = String(state.war.enemy_faction_name || '');

        currentFactionMembers = arr(factionMembersCache).slice();

        return state;
    });

    return _loadState.apply(this, arguments);
}
    
function loadFactionMembers(force) {
    return _loadFactionMembers.apply(this, arguments);
}


function _loadFactionMembers() {
    _loadFactionMembers = _asyncToGenerator(function* (force) {
        if (!isLoggedIn()) return [];

        if (!force && Array.isArray(factionMembersCache) && factionMembersCache.length) {
            return factionMembersCache.slice();
        }

        var res = yield authedReq('GET', '/api/faction/members');

        if (!res.ok || !res.json || typeof res.json !== 'object') {
            factionMembersCache = [];
            currentFactionMembers = [];
            membersLiveStamp = 0;
            return [];
        }

        var payload = res.json || {};
        var members = arr(payload.items || payload.members || []);
        var meId = String(
            (state && state.viewer && state.viewer.user_id)
            || (state && state.me && state.me.user_id)
            || (payload && payload.viewer_user_id)
            || ''
        ).trim();

        if (meId) {
            members = members.map(function (member) {
                var row = member && typeof member === 'object' ? Object.assign({}, member) : {};
                var rowId = String((row && (row.user_id || row.id || row.player_id)) || '').trim();
                if (rowId && rowId === meId) {
                    row.online_state = 'online';
                    row.status = 'Online';
                    row.status_detail = '';
                    row.last_action = 'Online';
                }
                return row;
            });
        }

        state = state || {};
        state.faction = Object.assign({}, state.faction || {}, {
            faction_id: payload.faction_id || '',
            faction_name: payload.faction_name || '',
            name: payload.faction_name || ''
        });

        members = ensureViewerInMembersList(members);

        var existingMembers = mergeMemberLists(
            arr(factionMembersCache),
            arr(currentFactionMembers),
            arr(state && state.faction && state.faction.members)
        );

        var mergedMembers = mergeMemberLists(existingMembers, members);

        // If the API only gives the logged-in user on a limited key, keep the fuller list
        // that was already loaded or learned from script/chain activity.
        if (members.length <= 1 && existingMembers.length > members.length) {
            mergedMembers = mergeMemberLists(existingMembers, members);
        }

        factionMembersCache = mergedMembers.slice();
        currentFactionMembers = mergedMembers.slice();
        membersLiveStamp = Date.now();
        state.faction.members = mergedMembers.slice();

        return factionMembersCache.slice();
    });

    return _loadFactionMembers.apply(this, arguments);
}

    function loadWarData(force) {
        return _loadWarData.apply(this, arguments);
    }

    function _loadWarData() {
        _loadWarData = _asyncToGenerator(function* (force) {
            if (!isLoggedIn()) return null;

            if (!force && state && state.war && (Date.now() - warEnemiesLoadedAt) < 15000) {
                return state.war;
            }

            var res = yield authedReq('GET', '/api/war');
            if (!res.ok || !res.json) return (state && state.war) || null;

            state = state || {};
            state.war = res.json.war || res.json || null;

            if (state.war) {
                warEnemiesFactionId = String(state.war.enemy_faction_id || '');
                warEnemiesFactionName = String(state.war.enemy_faction_name || '');
            }

            return state.war;
        });

        return _loadWarData.apply(this, arguments);
    }

function loadEnemies(force) {
    return _loadEnemies.apply(this, arguments);
}

function loadHospital(force) {
    return _loadHospital.apply(this, arguments);
}

function _loadHospital() {
    _loadHospital = _asyncToGenerator(function* (force) {
        if (!isLoggedIn()) return [];

        if (!force && state && state.hospital && Array.isArray(state.hospital.items) && state.hospital.items.length && (Date.now() - warEnemiesLoadedAt) < 15000) {
            return state.hospital.items;
        }

        var res = yield authedReq('GET', '/api/hospital');
        if (!res.ok || !res.json) return (state && state.hospital && state.hospital.items) || [];

        state = state || {};
        state.hospital = res.json || { items: [] };

        var war = (res.json && res.json.war && typeof res.json.war === 'object') ? res.json.war : {};
        if (war.enemy_faction_id || war.enemy_faction_name) {
            state.war = Object.assign({}, state.war || {}, war, {
                enemy_faction_id: war.enemy_faction_id || (state.war && state.war.enemy_faction_id) || '',
                enemy_faction_name: war.enemy_faction_name || (state.war && state.war.enemy_faction_name) || ''
            });
            warEnemiesFactionId = String(state.war.enemy_faction_id || '');
            warEnemiesFactionName = String(state.war.enemy_faction_name || '');
        }

        return arr(state.hospital.items);
    });

    return _loadHospital.apply(this, arguments);
}


function _loadEnemies() {
    _loadEnemies = _asyncToGenerator(function* (force) {
        if (!isLoggedIn()) return [];

        if (!force && warEnemiesCache && warEnemiesCache.length && (Date.now() - warEnemiesLoadedAt) < 15000) {
            return warEnemiesCache;
        }

        var res = yield authedReq('GET', '/api/enemies');
        if (!res.ok || !res.json) return warEnemiesCache || [];

        var payload = res.json || {};
        var war = (payload.war && typeof payload.war === 'object') ? payload.war : {};

        var enemies = arr(payload.items || []);
        warEnemiesCache = enemies.slice();
        warEnemiesFactionId = String(payload.faction_id || war.enemy_faction_id || '');
        warEnemiesFactionName = String(payload.faction_name || war.enemy_faction_name || '');
        warEnemiesLoadedAt = Date.now();

        state = state || {};
        state.enemies = enemies.slice();
        state.war = Object.assign({}, state.war || {}, war, {
            enemy_faction_id: warEnemiesFactionId,
            enemy_faction_name: warEnemiesFactionName
        });

        queueEnemyFfPredictions(enemies);

        return enemies.slice();
    });

    return _loadEnemies.apply(this, arguments);
}
    function loadLiveSummary(force) {
        return _loadLiveSummary.apply(this, arguments);
    }

    function _loadLiveSummary() {
        _loadLiveSummary = _asyncToGenerator(function* (force) {
            if (!isLoggedIn()) return null;
            if (!canSeeSummary()) return null;
            if (liveSummaryLoading) return liveSummaryCache;
            if (!force && liveSummaryCache && (Date.now() - liveSummaryLastAt) < 15000) return liveSummaryCache;

            liveSummaryLoading = true;
            liveSummaryError = '';

            try {
                var res = yield authedReq('GET', '/api/live-summary');
                if (!res.ok || !res.json) {
                    liveSummaryError = (res.json && res.json.error) || 'Unable to load live summary.';
                    return liveSummaryCache;
                }

                liveSummaryCache = res.json;
                liveSummaryLastAt = Date.now();
                return liveSummaryCache;
            } finally {
                liveSummaryLoading = false;
            }
        });

        return _loadLiveSummary.apply(this, arguments);
    }
    function loadAdminDashboard(force) {
        return _loadAdminDashboard.apply(this, arguments);
    }

    function _loadAdminDashboard() {
        _loadAdminDashboard = _asyncToGenerator(function* (force) {
            if (!canSeeAdmin()) return null;

            if (!force && analyticsCache) return analyticsCache;

            var res = yield adminReq('GET', '/api/admin/dashboard');
            if (!res.ok || !res.json) return analyticsCache;

            analyticsCache = res.json;
            if (analyticsCache.summary && typeof analyticsCache.summary === 'object') {
                Object.keys(analyticsCache.summary).forEach(function (key) {
                    if (analyticsCache[key] == null) analyticsCache[key] = analyticsCache.summary[key];
                });
            }
            if (!analyticsCache.faction_licenses && Array.isArray(analyticsCache.items)) {
                analyticsCache.faction_licenses = analyticsCache.items.slice();
            }
            return analyticsCache;
        });

        return _loadAdminDashboard.apply(this, arguments);
    }

    function loadAdminTopFive(force) {
        return _loadAdminTopFive.apply(this, arguments);
    }

    function _loadAdminTopFive() {
        _loadAdminTopFive = _asyncToGenerator(function* (force) {
            if (!canSeeAdmin()) return null;

            if (!force && adminTopFiveCache) return adminTopFiveCache;

            var res = yield adminReq('GET', '/api/admin/top-five');
            if (!res.ok || !res.json) return adminTopFiveCache;

            adminTopFiveCache = res.json;
            return adminTopFiveCache;
        });

        return _loadAdminTopFive.apply(this, arguments);
    }

        function loadOverviewLive() {
        return _loadOverviewLive.apply(this, arguments);
    }

    function _loadOverviewLive() {
        _loadOverviewLive = _asyncToGenerator(function* () {
            if (!isLoggedIn()) return null;

            var res = yield authedReq('GET', '/api/overview/live');
            if (!res.ok || !res.json || !res.json.overview) {
                return yield loadState();
            }

            state = state || {};
            state.war = Object.assign({}, state.war || {}, res.json.overview || {});
            state.faction = Object.assign({}, state.faction || {}, {
                faction_id: (res.json.overview && res.json.overview.faction_id) || '',
                faction_name: (res.json.overview && res.json.overview.faction_name) || '',
                name: (res.json.overview && res.json.overview.faction_name) || ''
            });

            return res.json.overview;
        });

        return _loadOverviewLive.apply(this, arguments);
    }

            function refreshOverviewLive() {
        return _refreshOverviewLive.apply(this, arguments);
    }

    function _refreshOverviewLive() {
        _refreshOverviewLive = _asyncToGenerator(function* () {
            yield loadOverviewLive();
        });

        return _refreshOverviewLive.apply(this, arguments);
    }

    function refreshMembersLive() {
        return _refreshMembersLive.apply(this, arguments);
    }

    function _refreshMembersLive() {
        _refreshMembersLive = _asyncToGenerator(function* () {
            yield loadState();
            yield loadFactionMembers(true);
            membersLiveStamp = Date.now();
        });

        return _refreshMembersLive.apply(this, arguments);
    }

    function refreshEnemiesLive() {
    return _refreshEnemiesLive.apply(this, arguments);
}

function _refreshEnemiesLive() {
    _refreshEnemiesLive = _asyncToGenerator(function* () {
        yield loadWarData(true);
        yield loadEnemies(true);
    });

    return _refreshEnemiesLive.apply(this, arguments);
}

    function refreshHospitalLive() {
        return _refreshHospitalLive.apply(this, arguments);
    }

    function _refreshHospitalLive() {
        _refreshHospitalLive = _asyncToGenerator(function* () {
            yield loadWarData(true);
            yield loadEnemies(true);
            if (typeof loadHospital === 'function') {
                yield loadHospital(true);
            }
        });

        return _refreshHospitalLive.apply(this, arguments);
    }

    function refreshSummaryLive() {
        return _refreshSummaryLive.apply(this, arguments);
    }

    function _refreshSummaryLive() {
        _refreshSummaryLive = _asyncToGenerator(function* () {
            yield loadLiveSummary(true);
        });

        return _refreshSummaryLive.apply(this, arguments);
    }

    // ============================================================
    // 13. TAB / POLLING FLOW
    // ============================================================

    function tabNeedsLivePolling(tab) {
        return tab === 'overview'
            || tab === 'members'
            || tab === 'enemies'
            || tab === 'hospital'
            || tab === 'chain'
            || tab === 'faction';
    }

    function getTabPollMs(tab) {
        if (tab === 'hospital') return 6000;
        if (tab === 'enemies') return 7000;
        if (tab === 'members') return 10000;
        if (tab === 'chain') return 10000;
        if (tab === 'overview') return 12000;
        if (tab === 'summary') return 12000;
        if (tab === 'faction') return 30000;
        if (tab === 'admin') return 30000;
        return 0;
    }

    function restartPolling() {
        restartPollingForCurrentTab();
    }

    function tickCurrentTab() {
        return _tickCurrentTab.apply(this, arguments);
    }

    function _tickCurrentTab() {
        _tickCurrentTab = _asyncToGenerator(function* () {
            if (loadInFlight) return;
            if (!isLoggedIn()) return;
            if (!tabNeedsLivePolling(currentTab)) return;

            loadInFlight = true;
            try {
                if (currentTab === 'overview') {
                    yield refreshOverviewLive();
                    renderLiveTabOnly();
                    return;
                }

                if (currentTab === 'members') {
                    yield refreshMembersLive();
                    renderLiveTabOnly();
                    return;
                }

                if (currentTab === 'chain') {
                    yield refreshMembersLive();
                    renderLiveTabOnly();
                    return;
                }

                if (currentTab === 'enemies') {
                    yield refreshEnemiesLive();
                    renderLiveTabOnly();
                    return;
}

                if (currentTab === 'hospital') {
                    yield refreshHospitalLive();
                    renderLiveTabOnly();
                    return;
                }

                if (currentTab === 'faction') {
                    currentTab = 'overview';
                    GM_setValue(K_TAB, currentTab);
                    yield refreshOverviewLive();
                    renderLiveTabOnly();
                    return;
                }
            } catch (err) {
                console.error('War and Chain tab tick error:', err);
            } finally {
                loadInFlight = false;
            }
        });

        return _tickCurrentTab.apply(this, arguments);
    }

    function handleTabClick(tab) {
    return _handleTabClick.apply(this, arguments);
}

function _handleTabClick() {
    _handleTabClick = _asyncToGenerator(function* (tab) {
        currentTab = String(tab || 'overview');
        GM_setValue(K_TAB, currentTab);

        state = state || {};
        if (currentTab === 'targets' && !Array.isArray(state.targets)) state.targets = [];
        renderBody();
        restartPollingForCurrentTab();

        if (loadInFlight) return;

        loadInFlight = true;
        try {
            if (currentTab === 'members') {
                yield loadState();
                yield loadFactionMembers(true);
                membersLiveStamp = Date.now();
            } else if (currentTab === 'chain') {
                yield loadFactionMembers(true);
                membersLiveStamp = Date.now();
            } else if (currentTab === 'enemies') {
                yield loadWarData(true);
                yield loadEnemies(true);
            } else if (currentTab === 'hospital') {
                yield loadWarData(true);
                yield loadEnemies(true);
                if (typeof loadHospital === 'function') {
                    yield loadHospital(true);
                }
            } else if (currentTab === 'targets') {
                yield loadWarData(true);
                yield loadEnemies(true);
                state = state || {};
                if (!Array.isArray(state.targets)) state.targets = [];
            } else if (currentTab === 'admin') {
                if (canSeeAdmin()) {
                    yield loadAdminDashboard(true);
                    yield loadAdminTopFive(true);
                }
            } else if (currentTab === 'overview') {
                yield refreshOverviewLive();
            }
        } catch (err) {
            console.error('War and Chain tab load error:', err);
        } finally {
            loadInFlight = false;
        }

        renderBody();
        restartPollingForCurrentTab();
    });

    return _handleTabClick.apply(this, arguments);
}
    // ============================================================
    // 14. VISIBILITY / OPEN STATE
    // ============================================================

    function isOverlayOpen() {
        return !!(overlay && overlay.classList.contains('open'));
    }

    function shouldRunLivePolling() {
        if (!isLoggedIn()) return false;
        if (!tabNeedsLivePolling(currentTab)) return false;
        if (document.hidden) return false;
        if (!isOverlayOpen()) return false;
        return true;
    }

    function restartPollingForCurrentTab() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }

        if (!shouldRunLivePolling()) return;

        var refreshMs = getTabPollMs(currentTab);
        if (!Number.isFinite(refreshMs) || refreshMs < 5000) refreshMs = 5000;

        pollTimer = setInterval(function () {
            if (!shouldRunLivePolling()) {
                if (pollTimer) {
                    clearInterval(pollTimer);
                    pollTimer = null;
                }
                return;
            }
            tickCurrentTab();
        }, refreshMs);
    }

    function bindVisibilityPolling() {
        document.addEventListener('visibilitychange', function () {
            restartPollingForCurrentTab();
        });
    }
    // ============================================================
    // 14. OVERLAY MOUNT / DOM
    // ============================================================

    function bindTap(el, handler) {
        if (!el) return;

        el.addEventListener('touchend', function (e) {
            if (e.cancelable) e.preventDefault();
            e.stopPropagation();
            handler(e);
        }, { passive: false });
    }

    function mount() {
        if (mounted) return;
        if (!document.body) return;

        ['warhub-shield', 'warhub-badge', 'warhub-overlay'].forEach(function (id) {
            var old = document.getElementById(id);
            if (old && old.parentNode) old.parentNode.removeChild(old);
        });

        shield = document.createElement('div');
        shield.id = 'warhub-shield';
        shield.innerHTML = '<button type="button" aria-label="Open War and Chain">⚔️</button>';
shield.setAttribute('aria-label', 'Open War and Chain');
        shield.setAttribute('title', 'War and Chain');

        badge = document.createElement('div');
        badge.id = 'warhub-badge';
        
        overlay = document.createElement('div');
        overlay.id = 'warhub-overlay';
        overlay.innerHTML = [
            '<div class="warhub-head" id="warhub-head">',
                '<div class="warhub-toprow">',
                    '<div>',
                        '<div class="warhub-title">War and Chain ⚔️</div>',
                        '<div class="warhub-sub">Faction tools, access, and war support</div>',
                    '</div>',
                    '<button class="warhub-close" id="warhub-close" type="button">Close</button>',
                '</div>',
            '</div>',
            '<div class="warhub-tabs" id="warhub-tabs-row-1"></div>',
            '<div class="warhub-tabs" id="warhub-tabs-row-2"></div>',
            '<div class="warhub-body" id="warhub-body">',
                '<div class="warhub-status-wrap"><div id="warhub-status" style="display:none;"></div></div>',
                '<div id="warhub-content"></div>',
            '</div>'
        ].join('');

        document.body.appendChild(shield);
        document.body.appendChild(badge);
        document.body.appendChild(overlay);

        applyShieldPos();
        applyOverlayPos();
        updateBadge();
        positionBadge();

        function shieldTapBlocked() {
            return false;
        }

        bindTap(shield, function () {
            if (shieldTapBlocked()) return;
            toggleOverlay();
        });

        bindTap(overlay.querySelector('#warhub-close'), function () {
            setOverlayOpen(false);
        });

        overlay.addEventListener('touchend', function (e) {
            var tabBtn = e.target.closest('[data-tab]');
            if (tabBtn) {
                if (e.cancelable) e.preventDefault();
                e.stopPropagation();
                handleTabClick(tabBtn.getAttribute('data-tab'));
                return;
            }

            var act = e.target.closest('[data-action]');
            if (act) {
                if (e.cancelable) e.preventDefault();
                e.stopPropagation();
                handleActionClick(act);
                return;
            }

            var groupHead = e.target.closest('[data-group-toggle]');
            if (groupHead) {
                if (e.cancelable) e.preventDefault();
                e.stopPropagation();
                var key = groupHead.getAttribute('data-group-toggle');
                toggleGroup(key);
                return;
            }
        }, { passive: false });

        overlay.addEventListener('change', function (e) {
            var t = e.target;

            if (t && t.id === 'warhub-api-key') {
                GM_setValue(K_API_KEY, cleanInputValue(t.value));
            }
            if (t && t.id === 'warhub-owner-token') {
                GM_setValue(K_OWNER_TOKEN, cleanInputValue(t.value));
            }
            if (t && t.id === 'warhub-ff-key') {
                GM_setValue(K_FF_SCOUTER_KEY, cleanInputValue(t.value));
            }
            if (t && t.id === 'warhub-ff-key') {
                GM_setValue(K_FF_SCOUTER_KEY, cleanInputValue(t.value));
            }
        });

        overlay.addEventListener('input', function (e) {
            var t = e.target;

            if (t && t.id === 'warhub-api-key') {
                GM_setValue(K_API_KEY, cleanInputValue(t.value));
            }
            if (t && t.id === 'warhub-owner-token') {
                GM_setValue(K_OWNER_TOKEN, cleanInputValue(t.value));
            }
            if (t && t.id === 'warhub-ff-key') {
                GM_setValue(K_FF_SCOUTER_KEY, cleanInputValue(t.value));
            }
        });

        window.addEventListener('resize', function () {
            applyShieldPos();
            applyOverlayPos();
            positionBadge();
        });

        mounted = true;
        bindVisibilityPolling();
        setOverlayOpen(isOpen);
        renderBody();
    }

        function setOverlayOpen(open) {
        isOpen = !!open;
        GM_setValue(K_OPEN, isOpen);

        if (!overlay) return;

        overlay.classList.toggle('open', isOpen);

        if (isOpen) {
            applyOverlayPos();
            positionBadge();
            renderBody();
            restartPollingForCurrentTab();
        } else {
            if (pollTimer) {
                clearInterval(pollTimer);
                pollTimer = null;
            }
        }
    }
    function toggleOverlay() {
        setOverlayOpen(!isOpen);
    }
        // ============================================================
    // 15. GROUP COLLAPSE STATE
    // ============================================================

    function isGroupOpen(key, defaultOpen) {
        var raw = GM_getValue('warhub_group_' + String(key), null);
        if (raw === null || raw === undefined) return !!defaultOpen;
        return !!raw;
    }

    function toggleGroup(key) {
        var k = 'warhub_group_' + String(key);
        GM_setValue(k, !isGroupOpen(key, true));
        renderBody();
    }

    // ============================================================
    // 16. MEMBER / WAR HELPERS
    // ============================================================

    function shortCd(v, fallback) {
        var n = Number(v || 0);
        if (!Number.isFinite(n) || n <= 0) return String(fallback || 'Ready');

        var h = Math.floor(n / 3600);
        var m = Math.floor((n % 3600) / 60);
        var s = Math.floor(n % 60);

        if (h > 0) return h + 'h ' + String(m).padStart(2, '0') + 'm';
        if (m > 0) return m + 'm ' + String(s).padStart(2, '0') + 's';
        return s + 's';
    }

    function getMemberId(member) {
        return String(
            (member && (member.user_id || member.id || member.player_id)) ||
            ''
        );
    }

    function getMemberName(member) {
        return String(
            (member && (
                member.name ||
                member.user_name ||
                member.player_name ||
                member.username ||
                member.member_name
            )) ||
            'Unknown'
        );
    }

    function pickBarCurrent(bar) {
        if (!bar || typeof bar !== 'object') return null;
        var keys = ['current', 'amount', 'value', 'now', 'used', 'remaining_current'];
        for (var i = 0; i < keys.length; i += 1) {
            var n = Number(bar[keys[i]]);
            if (Number.isFinite(n)) return n;
        }
        return null;
    }

    function pickBarMaximum(bar) {
        if (!bar || typeof bar !== 'object') return null;
        var keys = ['maximum', 'max', 'total', 'full', 'capacity'];
        for (var i = 0; i < keys.length; i += 1) {
            var n = Number(bar[keys[i]]);
            if (Number.isFinite(n)) return n;
        }
        return null;
    }

    function energyValue(member) {
        member = member || {};
        var direct = Number(member.energy_current || member.energy || member.current_energy);
        if (Number.isFinite(direct)) return direct;
        return pickBarCurrent(member.energy);
    }

    function lifeValue(member) {
        member = member || {};
        var lifeBar = member.life || {};
        var cur = Number(member.life_current);
        if (!Number.isFinite(cur)) cur = pickBarCurrent(lifeBar);
        var max = Number(member.life_max || member.max_life);
        if (!Number.isFinite(max)) max = pickBarMaximum(lifeBar);
        if (Number.isFinite(cur) && Number.isFinite(max) && max > 0) return String(cur) + '/' + String(max);
        if (Number.isFinite(cur)) return String(cur);
        return '—';
    }

    function medCooldownValue(member) {
        member = member || {};
        var raw = Number(member.med_cd || member.med_cooldown || member.medical_cooldown || 0);
        if (Number.isFinite(raw) && raw > 0) return shortCd(raw, 'Ready');
        var txt = String(member.medical_cooldown_text || member.med_cooldown_text || '').trim();
        return txt || 'Ready';
    }

    function boosterCooldownValue(member) {
        member = member || {};
        var raw = Number(member.booster_cd || member.booster_cooldown || member.drug_cooldown || member.boosters_cooldown || 0);
        if (Number.isFinite(raw) && raw > 0) return shortCd(raw, 'Ready');
        var txt = String(member.booster_cooldown_text || member.booster_cd_text || member.drug_cooldown_text || '').trim();
        return txt || 'Ready';
    }

    function mergeChainMember(item) {
        item = item || {};
        var uid = String(item.user_id || item.id || item.player_id || '').trim();
        if (!uid) return item;
        var pools = [];
        if (state && state.faction && Array.isArray(state.faction.members)) pools.push(state.faction.members);
        if (Array.isArray(factionMembersCache)) pools.push(factionMembersCache);
        if (Array.isArray(currentFactionMembers)) pools.push(currentFactionMembers);
        for (var i = 0; i < pools.length; i += 1) {
            var list = pools[i] || [];
            for (var j = 0; j < list.length; j += 1) {
                var row = list[j] || {};
                var rid = String(row.user_id || row.id || row.player_id || '').trim();
                if (rid && rid === uid) {
                    return Object.assign({}, row, item, {
                        user_id: uid,
                        user_name: item.user_name || row.user_name || row.name || '',
                        name: item.name || row.name || row.user_name || item.user_name || ''
                    });
                }
            }
        }
        return item;
    }

    function getChainSitterItems() {
        var chain = (state && state.chain) || {};
        return arr(chain.sitter_items).map(mergeChainMember).filter(function (item) {
            return !!String((item && (item.user_id || item.id || item.player_id || item.name || item.user_name)) || '').trim();
        });
    }

    function getActiveChainSitterItems() {
        var chain = (state && state.chain) || {};
        var out = [];
        var seen = {};

        function addItem(item) {
            item = mergeChainMember(item || {});
            var uid = String((item && (item.user_id || item.id || item.player_id)) || '').trim();
            var nm = getMemberName(item);
            var key = uid || nm.toLowerCase();
            if (!key || seen[key]) return;
            seen[key] = true;
            out.push(Object.assign({}, item, { sitter_enabled: true }));
        }

        arr(chain.sitter_items).forEach(function (item) {
            if (item && item.sitter_enabled === false) return;
            addItem(item);
        });

        arr(chain.available_items).forEach(function (item) {
            if (item && (item.sitter_enabled || item.chain_sitter || item.is_chain_sitter)) addItem(item);
        });

        if (chain.sitter_enabled) {
            addItem({
                user_id: viewerUserId(),
                name: viewerName(),
                user_name: viewerName(),
                sitter_enabled: true
            });
        }

        return out;
    }

    function getActiveChainSitterNames(limit) {
        var names = getActiveChainSitterItems().map(function (item) { return getMemberName(item); }).filter(Boolean);
        if (!names.length) return '';
        limit = Number(limit || 5);
        var shown = names.slice(0, limit);
        if (names.length > shown.length) shown.push('+' + String(names.length - shown.length) + ' more');
        return shown.join(', ');
    }

    function renderActiveChainSittersPill(limit) {
        var activeNames = getActiveChainSitterNames(limit || 5);
        var activeCount = getActiveChainSitterItems().length;
        return '<span class="warhub-pill ' + (activeCount ? 'warn' : 'neutral') + '">Active Chain Sitters: ' + esc(activeNames || 'None') + '</span>';
    }

    function getChainSitterNames(limit) {
        var names = getChainSitterItems().map(function (item) { return getMemberName(item); }).filter(Boolean);
        if (!names.length) return '';
        limit = Number(limit || 4);
        var shown = names.slice(0, limit);
        if (names.length > shown.length) shown.push('+' + String(names.length - shown.length) + ' more');
        return shown.join(', ');
    }

    function getChainHitSeconds() {
        var chain = (state && state.chain) || {};
        var raw = Number(
            chain.cooldown ||
            chain.chain_cooldown ||
            chain.hit_timer ||
            chain.hit_timer_seconds ||
            chain.next_hit_timer ||
            chain.next_hit_seconds ||
            chain.chain_timer ||
            chain.chain_timer_seconds ||
            chain.timer ||
            chain.timer_seconds ||
            chain.time_left ||
            chain.time_left_seconds ||
            chain.timeout ||
            chain.timeout_seconds ||
            0
        );
        if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);

        var until = Number(
            chain.cooldown_until_ts ||
            chain.chain_timeout_ts ||
            chain.timer_until_ts ||
            chain.expires_at_ts ||
            chain.chain_expires_at_ts ||
            chain.next_hit_due_ts ||
            0
        );
        if (Number.isFinite(until) && until > 0) {
            return Math.max(0, Math.floor(until - (Date.now() / 1000)));
        }
        return 0;
    }

    function renderChainHitTimerPill() {
        var seconds = getChainHitSeconds();
        var renderedAt = Date.now();
        var label = seconds > 0 ? formatCountdown(seconds) : 'Ready';
        return '<span class="warhub-pill warn" data-chain-hit-timer="1" data-chain-hit-base="' + esc(String(seconds)) + '" data-chain-hit-rendered-at="' + esc(String(renderedAt)) + '">Hit Timer: ' + esc(label) + '</span>';
    }

    function humanStateLabel(st) {
        st = String(st || '').toLowerCase();
        if (st === 'online') return 'Online';
        if (st === 'idle') return 'Idle';
        if (st === 'travel') return 'Travel';
        if (st === 'jail') return 'Jail';
        if (st === 'hospital') return 'Hospital';
        return 'Offline';
    }

    function stateLabel(member) {
        member = member || {};
        var nowSec = Math.floor(Date.now() / 1000);
        var inHospital = !!(member.in_hospital || member.is_hospitalized || member.hospitalized);
        var hospitalUntilTs = Number(member.hospital_until_ts || member.hospital_until || member.status_until || member.until || 0);
        var hospitalSeconds = Number(member.hospital_seconds || member.hospital_time_left || member.hospital_eta_seconds || member.seconds_left || 0);
        if (inHospital || hospitalSeconds > 0 || hospitalUntilTs > nowSec) return 'hospital';
        var raw = String((member.state || member.presence || member.status || member.status_state || member.online_state || '')).toLowerCase();
        if (raw.indexOf('hospital') >= 0) return 'hospital';
        if (raw.indexOf('jail') >= 0) return 'jail';
        if (raw.indexOf('travel') >= 0) return 'travel';
        if (raw.indexOf('idle') >= 0) return 'idle';
        if (raw.indexOf('online') >= 0) return 'online';
        if (raw.indexOf('offline') >= 0) return 'offline';
        var detail = String(member.status_detail || member.detail || member.description || '').toLowerCase();
        if (detail.indexOf('hospital') >= 0) return 'hospital';
        if (detail.indexOf('jail') >= 0) return 'jail';
        if (detail.indexOf('travel') >= 0 || detail.indexOf('abroad') >= 0) return 'travel';
        if (member.online === true || member.is_online === true) return 'online';
        var lastAction = String(member.last_action || member.lastAction || '').toLowerCase();
        if (lastAction.indexOf('idle') >= 0) return 'idle';
        if (lastAction.indexOf('online') >= 0) return 'online';
        return 'offline';
    }

    function stateCountdown(member) {
        member = member || {};
        var nowSec = Math.floor(Date.now() / 1000);
        var until = Number(member.hospital_until_ts || member.hospital_until || member.jail_until || member.travel_until || member.status_until || member.until || 0);
        if (Number.isFinite(until) && until > nowSec) return Math.max(0, until - nowSec);
        var seconds = Number(member.hospital_seconds || member.hospital_time_left || member.hospital_eta_seconds || member.time_left || member.seconds_left || 0);
        if (Number.isFinite(seconds) && seconds > 0) return Math.max(0, seconds);
        return 0;
    }

    function travelDestinationText(member) {
        member = member || {};
        var parts = [
            member.travel_destination,
            member.destination,
            member.travel_to,
            member.traveling_to,
            member.status_detail,
            member.detail,
            member.description
        ].filter(function (v) { return !!String(v || '').trim(); }).map(function (v) {
            return String(v || '').trim();
        });

        for (var i = 0; i < parts.length; i++) {
            var txt = parts[i];
            if (/travel|flying|landing|arriv|abroad/i.test(txt)) return txt;
        }
        return parts.length ? parts[0] : '';
    }

    function travelArrivalText(member) {
        member = member || {};
        var nowSec = Math.floor(Date.now() / 1000);
        var until = Number(member.travel_until || member.arrive_ts || member.arrival_ts || member.until || member.status_until || 0);
        if (Number.isFinite(until) && until > nowSec) {
            return 'Arrives in ' + formatCountdown(until - nowSec);
        }
        var sec = Number(member.travel_seconds || member.travel_time_left || member.time_left || member.seconds_left || 0);
        if (Number.isFinite(sec) && sec > 0) {
            return 'Arrives in ' + formatCountdown(sec);
        }
        return '';
    }


    function spyText(member) {
        return String(
            (member && (
                member.spy_report ||
                member.spy ||
                member.spy_text ||
                member.stats_summary
            )) || ''
        ).trim();
    }

    function profileUrl(member) {
        var id = getMemberId(member);
        return id ? ('https://www.torn.com/profiles.php?XID=' + encodeURIComponent(id)) : '#';
    }

    function attackUrl(member) {
        var id = getMemberId(member);
        return id ? ('https://www.torn.com/loader.php?sid=attack&user2ID=' + encodeURIComponent(id)) : '#';
    }

    function bountyUrl(member) {
        var id = getMemberId(member);
        return id ? ('https://www.torn.com/bounties.php?p=add&XID=' + encodeURIComponent(id) + '&reward=250000') : '#';
    }

    function chainAvailableIdMap() {
        var out = {};
        var chain = (state && state.chain) || {};
        arr(chain.available_items || chain.available_members || []).forEach(function (item) {
            var id = String(getMemberId(item) || (item && (item.user_id || item.id || item.player_id)) || '').trim();
            if (id) out[id] = true;
        });

        var viewerId = viewerUserId();
        if (viewerId && chain.available === true) out[String(viewerId)] = true;
        return out;
    }

    function isMemberChainAvailable(member) {
        var id = String(getMemberId(member) || '').trim();
        if (!id) return false;
        return !!chainAvailableIdMap()[id];
    }

    function isViewerMemberRow(member) {
        var id = String(getMemberId(member) || '').trim();
        var viewerId = String(viewerUserId() || '').trim();
        return !!(id && viewerId && id === viewerId);
    }

    function mergeMemberLists() {
        var out = [];
        var index = {};

        function add(member) {
            if (!member || typeof member !== 'object') return;
            var id = String(getMemberId(member) || member.user_id || member.id || member.player_id || '').trim();
            var name = getMemberName(member);
            var key = id || String(name || '').toLowerCase();
            if (!key || key === 'unknown') return;

            var clean = Object.assign({}, member);
            if (id) {
                clean.user_id = id;
                clean.id = clean.id || id;
                clean.player_id = clean.player_id || id;
            }
            if (!clean.name || clean.name === 'Unknown') clean.name = name;

            if (index[key] == null) {
                index[key] = out.length;
                out.push(clean);
            } else {
                out[index[key]] = Object.assign({}, out[index[key]], clean);
            }
        }

        for (var i = 0; i < arguments.length; i += 1) {
            arr(arguments[i]).forEach(add);
        }

        return out;
    }

    function getMembersFromScriptState() {
        var chain = (state && state.chain) || {};
        var faction = (state && state.faction) || {};
        return mergeMemberLists(
            arr(currentFactionMembers),
            arr(factionMembersCache),
            arr(faction.members),
            arr(faction.items),
            arr(faction.member_items),
            arr(state && state.members),
            arr(state && state.users),
            arr(state && state.script_users),
            arr(state && state.bot_users),
            arr(state && state.active_users),
            arr(chain.available_items),
            arr(chain.available_members),
            arr(chain.sitter_items),
            arr(chain.sitter_members),
            arr(chain.members),
            arr(chain.users)
        );
    }

    function getMembersForMembersTab() {
        var members = getMembersFromScriptState();
        members = ensureViewerInMembersList(members);
        return mergeMemberLists(members).sort(function (a, b) {
            if (isViewerMemberRow(a)) return -1;
            if (isViewerMemberRow(b)) return 1;
            return getMemberName(a).localeCompare(getMemberName(b));
        });
    }

    function ensureViewerInMembersList(members) {
        members = arr(members).slice();
        var viewer = (state && (state.viewer || state.me || state.user)) || {};
        var viewerId = String(
            viewer.user_id ||
            viewer.id ||
            viewer.player_id ||
            viewerUserId() ||
            ''
        ).trim();
        if (!viewerId) return members;

        var exists = members.some(function (member) {
            return String(getMemberId(member) || '').trim() === viewerId;
        });
        if (exists) return members;

        var viewerRow = Object.assign({}, viewer, {
            user_id: viewerId,
            id: viewerId,
            name: String(viewer.name || viewerName() || 'You'),
            online_state: 'online',
            status: 'Online',
            status_detail: '',
            last_action: 'Online',
            position: String(viewer.position || viewer.role || 'You')
        });

        members.unshift(viewerRow);
        return members;
    }

    function rememberBountyTarget(member) {
        var id = String(getMemberId(member) || '').trim();
        var name = String(getMemberName(member) || '').trim();
        if (!id) return;
        try {
            GM_setValue(K_PENDING_BOUNTY, JSON.stringify({
                id: id,
                name: name,
                reward: 250000,
                saved_at: Date.now()
            }));
        } catch (_e) {}
    }

    function openBountyForMember(member) {
        rememberBountyTarget(member);
        var url = bountyUrl(member);
        if (!url || url === '#') return;
        try { window.open(url, '_blank', 'noopener,noreferrer'); }
        catch (_e) { window.location.href = url; }
    }

    function getPendingBountyTarget() {
        try {
            var raw = GM_getValue(K_PENDING_BOUNTY, '');
            var item = raw ? JSON.parse(raw) : null;
            if (!item || !item.id) return null;
            if (item.saved_at && (Date.now() - Number(item.saved_at)) > 10 * 60 * 1000) return null;
            return item;
        } catch (_e) {
            return null;
        }
    }

    function fillInputLikeHuman(input, value) {
        if (!input || value == null) return false;
        try {
            input.focus();
            input.value = String(value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        } catch (_e) {
            try { input.value = String(value); return true; } catch (_e2) { return false; }
        }
    }

    function findBountyTargetInput() {
        var inputs = Array.prototype.slice.call(document.querySelectorAll('input'));
        return inputs.find(function (input) {
            var txt = String((input.placeholder || '') + ' ' + (input.name || '') + ' ' + (input.id || '') + ' ' + (input.getAttribute('aria-label') || '')).toLowerCase();
            return txt.indexOf('target') >= 0 || txt.indexOf('search') >= 0 || txt.indexOf('user') >= 0;
        }) || inputs[0] || null;
    }

    function findBountyRewardInput() {
        var inputs = Array.prototype.slice.call(document.querySelectorAll('input'));
        return inputs.find(function (input) {
            var txt = String((input.placeholder || '') + ' ' + (input.name || '') + ' ' + (input.id || '') + ' ' + (input.getAttribute('aria-label') || '')).toLowerCase();
            return txt.indexOf('reward') >= 0 || txt.indexOf('amount') >= 0 || txt.indexOf('money') >= 0 || txt.indexOf('price') >= 0;
        }) || inputs.find(function (input) {
            return String(input.type || '').toLowerCase() === 'number' || input.inputMode === 'numeric';
        }) || inputs[1] || null;
    }

    function autoFillBountyPageFromWarHub() {
        if (!/\/bounties\.php/i.test(String(location.pathname || ''))) return;
        var item = getPendingBountyTarget();
        if (!item) return;

        var targetValue = item.name ? (item.name + ' [' + item.id + ']') : String(item.id);
        var rewardValue = String(item.reward || 250000);

        fillInputLikeHuman(findBountyTargetInput(), targetValue);
        fillInputLikeHuman(findBountyRewardInput(), rewardValue);

        [800, 1600, 3000].forEach(function (ms) {
            setTimeout(function () {
                fillInputLikeHuman(findBountyTargetInput(), targetValue);
                fillInputLikeHuman(findBountyRewardInput(), rewardValue);
            }, ms);
        });
    }

    function memberSearchText(member) {
        return [
            getMemberName(member),
            getMemberId(member),
            stateLabel(member),
            String((member && member.position) || ''),
            String((member && member.role) || '')
        ].join(' ').toLowerCase();
    }

    function groupMembers(items) {
        var grouped = {
            online: [],
            idle: [],
            travel: [],
            jail: [],
            hospital: [],
            offline: []
        };

        arr(items).forEach(function (m) {
            var st = stateLabel(m);
            if (!grouped[st]) st = 'offline';
            grouped[st].push(m);
        });

        return grouped;
    }

    function renderGroupBlock(key, items, rowRenderer, defaultOpen) {
        var open = isGroupOpen(key, defaultOpen);
        var title = String(key || '')
            .replace(/^members_/, '')
            .replace(/^enemies_/, '')
            .replace(/^hospital_/, '')
            .replace(/_/g, ' ');

        title = humanStateLabel(title);

        return [
            '<div class="warhub-member-group">',
                '<div class="warhub-member-group-head" data-group-toggle="' + esc(key) + '">',
                    '<div class="warhub-row">',
                        '<span class="warhub-pill ' + esc(String(title).toLowerCase()) + '">' + esc(title) + '</span>',
                        '<span class="warhub-pill neutral">' + esc(String(arr(items).length)) + '</span>',
                    '</div>',
                    '<div class="warhub-pill neutral">' + (open ? 'Hide' : 'Show') + '</div>',
                '</div>',
                open
                    ? '<div class="warhub-member-list">' + arr(items).map(rowRenderer).join('') + '</div>'
                    : '',
            '</div>'
        ].join('');
    }

    function statCard(label, value, sub) {
        return [
            '<div class="warhub-stat-card">',
                '<div class="warhub-stat-label">' + esc(label) + '</div>',
                '<div class="warhub-stat-value">' + esc(String(value == null ? '—' : value)) + '</div>',
                sub ? '<div class="warhub-sub" style="margin-top:6px;">' + esc(sub) + '</div>' : '',
            '</div>'
        ].join('');
    }

    // ============================================================
    // 17. ROW RENDERERS
    // ============================================================

    function renderMemberRow(member) {
        var id = getMemberId(member);
        var name = getMemberName(member);
        var st = stateLabel(member);
        var stateCd = stateCountdown(member);
        var energy = energyValue(member);
        var life = lifeValue(member);
        var med = medCooldownValue(member);
        var position = String((member && (member.position || member.faction_position || member.role || '')) || '').trim();
        var memberAvailable = isMemberChainAvailable(member);
        var availabilityLabel = memberAvailable ? 'Available' : 'Unavailable';
        var availabilityClass = memberAvailable ? 'available' : 'unavailable';
        var canToggleAvailability = isViewerMemberRow(member);

        return [
            '<div class="warhub-member-row" ' +
                'data-medcd-base="' + esc(String(Number(member && (member.med_cd || member.med_cooldown || member.medical_cooldown || 0)) || 0)) + '" ' +
                'data-statuscd-base="' + esc(String(stateCd)) + '" ' +
                'data-state-name="' + esc(st) + '">',
                '<div class="warhub-member-main">',
                    '<div class="warhub-row" style="gap:8px;min-width:0;flex:1;align-items:center;">',
                        '<a class="warhub-member-name" href="' + esc(profileUrl(member)) + '" target="_blank" rel="noopener noreferrer">' + esc(name) + '</a>',
                        (position ? '<span class="warhub-pill neutral">' + esc(position) + '</span>' : ''),
                        '<span class="warhub-pill ' + esc(st) + '" data-statuscd>' + esc(
                            st === 'hospital' ? (stateCd > 0 ? 'Hospital (' + shortCd(stateCd, 'Hospital') + ')' : 'Hospital') :
                            st === 'jail' ? (stateCd > 0 ? 'Jail (' + shortCd(stateCd, 'Jail') + ')' : 'Jail') :
                            st === 'travel' ? (stateCd > 0 ? 'Travel (' + shortCd(stateCd, 'Travel') + ')' : 'Travel') :
                            humanStateLabel(st)
                        ) + '</span>',
                    '</div>',
                    '<div class="warhub-row">',
                        '<button type="button" class="warhub-btn bounty" data-action="bounty-user" data-user-id="' + esc(id) + '" data-user-name="' + esc(name) + '">Bounty</button>',
                        '<button type="button" class="warhub-btn ' + esc(availabilityClass) + '" data-action="member-availability-toggle" data-user-id="' + esc(id) + '" data-user-name="' + esc(name) + '" data-current="' + esc(memberAvailable ? '1' : '0') + '" title="' + esc(canToggleAvailability ? 'Tap to toggle your availability' : 'Shown for all members. Only that member can change it.') + '">' + esc(availabilityLabel) + '</button>',
                    '</div>',
                '</div>',
                '<div class="warhub-statline">',
                    '<span title="Energy">⚡ ' + esc(energy == null ? '—' : String(energy)) + '</span>',
                    '<span title="Life">❤️ ' + esc(life) + '</span>',
                    '<span title="Medical Cooldown">💊 <span data-medcd>' + esc(med) + '</span></span>',
                '</div>',
            '</div>'
        ].join('');
    }

function getMyBattleStatsMillions() {
    var viewer = (state && state.viewer) || {};
    var direct = Number(viewer && (viewer.battle_stats_total_m || viewer.battle_stats_m || viewer.total_battle_stats_m));
    if (Number.isFinite(direct) && direct > 0) return direct;

    var total = Number(viewer && (viewer.battle_stats_total || viewer.total_battle_stats || 0));
    if (Number.isFinite(total) && total > 0) {
        return total >= 100000 ? (total / 1000000) : total;
    }
    return 0;
}

function formatBattleMillions(n) {
    var v = Number(n);
    if (!Number.isFinite(v) || v <= 0) return '—';
    var abs = Math.abs(v);
    var rounded = Math.round(abs * 10) / 10;
    return (v < 0 ? '-' : '') + rounded.toFixed(abs >= 100 ? 0 : 1) + 'm';
}

function parseBattleNumber(token) {
    var s = String(token || '').trim().toLowerCase().replace(/,/g, '');
    if (!s) return null;
    var m = s.match(/^(\d+(?:\.\d+)?)([kmbt])?$/);
    if (!m) return null;
    var n = Number(m[1]);
    if (!Number.isFinite(n)) return null;
    var unit = m[2] || '';
    if (unit === 'k') n /= 1000;
    else if (unit === 'b') n *= 1000;
    else if (unit === 't') n *= 1000000;
    return n;
}

function parseEnemyBattleStatsMillions(member) {
    var ff = getFfScouterData(member);
    if (ff && ff.estimate_m > 0) {
        return Number(ff.estimate_m.toFixed(2));
    }
    return 0;
}

function predictionMeta(member) {
    var ff = getFfScouterData(member);
    if (!ff) {
        return {
            source: 'FF Scouter',
            confidence: 'Waiting',
            summary: 'Waiting for FF Scouter data for this target.',
            updated_at: ''
        };
    }

    if (ff.no_data) {
        return {
            source: 'FF Scouter',
            confidence: 'No data',
            summary: 'FF Scouter has no current fair-fight data for this target.',
            updated_at: ff.last_updated || ''
        };
    }

    return {
        source: 'FF Scouter',
        confidence: 'Fair Fight',
        summary: ff.fair_fight > 0 ? ('FF Scouter fair-fight ' + ff.fair_fight.toFixed(2) + '.') : 'FF Scouter fair-fight —.',
        updated_at: ff.last_updated || ''
    };
}

function enemyPredictionData(member) {
    var ff = getFfScouterData(member);
    var color = 'neutral';
    var tier = 'Waiting';
    var summary = 'Waiting for FF Scouter data.';

    if (ff) {
        if (ff.no_data) {
            color = 'offline';
            tier = 'No data';
            summary = 'FF Scouter has no data for this target.';
        } else if (ff.fair_fight > 0) {
            if (ff.fair_fight <= 2) color = 'good';
            else if (ff.fair_fight <= 3.5) color = 'neutral';
            else if (ff.fair_fight <= 4.5) color = 'warn';
            else color = 'bad';
            tier = ff.fair_fight.toFixed(2);
            summary = 'FF ' + ff.fair_fight.toFixed(2);
        }
    }

    var meta = predictionMeta(member);
    if (meta.summary) summary = meta.summary;

    return {
        color: color,
        tier: tier,
        summary: summary,
        source: meta.source,
        confidence: meta.confidence,
        updated_at: meta.updated_at
    };
}

function renderEnemyPredictionBox(member) {
    var pred = enemyPredictionData(member);
    return '<div class="warhub-sub">' + esc(pred.summary || '') + '</div>';
}

function renderEnemyRow(member, opts) {
    opts = opts || {};
    var id = getMemberId(member);
    var name = getMemberName(member);
    var st = stateLabel(member);
    var spy = spyText(member);
    var stateCd = stateCountdown(member);
    var dibbedBy = String((member && (member.dibbed_by_name || member.dibbedByName)) || '').trim();
    var dibText = dibbedBy ? ('Dibbed by ' + dibbedBy) : '';
    var pred = enemyPredictionData(member);
    var ff = getFfScouterData(member);
    var ffBubbleText = getFfScouterKey() ? 'FF …' : 'FF key';
    if (ff) {
        if (ff.no_data) ffBubbleText = 'FF n/a';
        else if (ff.fair_fight > 0) ffBubbleText = 'FF ' + ff.fair_fight.toFixed(2);
    }
    var travelDetail = st === 'travel' ? travelDestinationText(member) : '';
    var travelArrival = st === 'travel' ? travelArrivalText(member) : '';
    var actionHtml = '';

    if (state && state.members && arr(state.members).length) {
        var ownIds = {};
        arr(state.members).forEach(function (m) {
            var ownId = String((m && (m.user_id || m.id)) || '').trim();
            if (ownId) ownIds[ownId] = true;
        });
        if (id && ownIds[String(id)]) return '';
    }

    if (opts.mode === 'hospital') {
        var dibsAvailable = !!(member && member.dibs_available);
        var dibsLocked = !!(member && member.dibs_locked);
        actionHtml = '<button type="button" class="warhub-btn ' + (dibsAvailable ? 'warn' : 'ghost') + '" data-action="hospital-dibs" data-user-id="' + esc(id) + '" ' + ((dibsAvailable && !dibbedBy && !dibsLocked) ? '' : 'disabled') + '>Dibs</button>';
    } else {
        actionHtml = '<a class="warhub-btn" href="' + esc(attackUrl(member)) + '" target="_blank" rel="noopener noreferrer">Attack</a>';
    }

    return [
        '<div class="warhub-member-row" data-statuscd-base="' + esc(String(stateCd)) + '" data-state-name="' + esc(st) + '">',
            '<div class="warhub-member-main">',
                '<div class="warhub-row" style="justify-content:space-between;gap:8px;flex-wrap:nowrap;align-items:center;">',
                    '<div class="warhub-row" style="gap:8px;min-width:0;flex:1;flex-wrap:nowrap;align-items:center;">',
                        '<a class="warhub-member-name" href="' + esc(profileUrl(member)) + '" target="_blank" rel="noopener noreferrer">' + esc(name) + '</a>',
                        '<span class="warhub-pill ' + esc(pred.color || 'neutral') + '">' + esc(ffBubbleText) + '</span>',
                        '<span class="warhub-pill ' + esc(st) + '" data-statuscd>' + esc(
                            st === 'hospital' ? (stateCd > 0 ? 'Hospital (' + shortCd(stateCd, 'Hospital') + ')' : 'Hospital') :
                            st === 'jail' ? (stateCd > 0 ? 'Jail (' + shortCd(stateCd, 'Jail') + ')' : 'Jail') :
                            st === 'travel' ? (stateCd > 0 ? 'Travel (' + shortCd(stateCd, 'Travel') + ')' : 'Travel') :
                            humanStateLabel(st)
                        ) + '</span>',
                        (opts.mode === 'hospital' ? '' : (dibText ? '<span class="warhub-pill warn">' + esc(dibText) + '</span>' : '')),
                    '</div>',
                    actionHtml,
                '</div>',
            '</div>',
            (st === 'travel' && travelDetail) ? '<div class="warhub-spy-box">' + esc(travelDetail) + (travelArrival ? '<div class="warhub-sub" style="margin-top:6px;">' + esc(travelArrival) + '</div>' : '') + '</div>' : '',
            spy ? '<div class="warhub-spy-box">' + esc(spy) + '</div>' : '',
        '</div>'
    ].join('');
}

    // ============================================================
    // 18. TAB RENDERS: LOGIN / OVERVIEW / MEMBERS / ENEMIES
    // ============================================================

    function renderLoginView() {
        return [
            '<div class="warhub-grid">',
                '<div class="warhub-hero-card">',
                    '<div class="warhub-title">Login</div>',
                    '<div class="warhub-sub">Use your Torn Limited API key to connect to War and Chain. Limited API key used.</div>',
                '</div>',
                '<div class="warhub-card warhub-col">',
                    '<label class="warhub-label" for="warhub-api-key">Torn Limited API Key</label>',
                    '<input id="warhub-api-key" class="warhub-input" type="password" value="' + esc(getApiKey()) + '" placeholder="Enter Limited API key" />',
                    '<label class="warhub-label" for="warhub-owner-token">Owner/Admin Token (optional)</label>',
                    '<input id="warhub-owner-token" class="warhub-input" type="password" value="' + esc(getOwnerToken()) + '" placeholder="Owner/admin token" />',
                    '<label class="warhub-label" for="warhub-ff-key">FF Scouter Limited Key (optional)</label>',
                    '<input id="warhub-ff-key" class="warhub-input" type="password" value="' + esc(getFfScouterKey()) + '" placeholder="FF Scouter key for fair-fight values" />',
                    '<div class="warhub-row">',
                        '<button type="button" class="warhub-btn" data-action="login">Login</button>',
                    '</div>',
                '</div>',
                '<div class="warhub-card">',
                    '<div class="warhub-kv"><div>Status</div><div>Logged out</div></div>',
                    '',
                    '',
                '</div>',
            '</div>'
        ].join('');
    }

function renderOverviewTab() {
    var war = (state && state.war) || {};
    var ownFaction = (state && state.faction) || {};

    var ownName = String(
        ownFaction.name ||
        war.our_faction_name ||
        war.faction_name ||
        'Your Faction'
    );

    var enemyName = String(
        war.enemy_faction_name ||
        'No current enemy'
    );

    var scoreUs = Number(war.score_us || war.our_score || 0);
    var scoreThem = Number(war.score_them || war.enemy_score || 0);
    var chainUs = Number(war.chain_us || 0);
    var chainThem = Number(war.chain_them || 0);
    var chainSittersText = getActiveChainSitterNames(5);

    var termsText = String((state && state.terms_summary && state.terms_summary.text) || '');
    var medDealsText = String((state && state.med_deals && state.med_deals.text) || '');

    var overviewDibs = arr(state && state.hospital && state.hospital.overview_items).filter(function (item) {
        return shouldKeepOverviewDib(item);
    });

    var dibsText = overviewDibs.length ? overviewDibs.map(function (item) {
        var dibbedBy = String((item && item.dibbed_by_name) || 'Unknown').trim();
        var dibEnemyName = String((item && item.enemy_name) || 'Enemy').trim();
        var suffix = '';
        if (item && item.in_hospital) {
            suffix = ' (In hospital)';
        } else if (item && item.left_hospital_at) {
            var leftAt = new Date(item.left_hospital_at).getTime();
            var secsLeft = Number.isFinite(leftAt) && leftAt > 0 ? Math.max(0, 30 - Math.floor((Date.now() - leftAt) / 1000)) : 0;
            suffix = secsLeft > 0 ? ' (Out ' + secsLeft + 's)' : '';
        }
        return dibbedBy + ' → ' + dibEnemyName + suffix;
    }).join('\n') : '';

    return [
        '<div class="warhub-grid">',
            '<div class="warhub-hero-card warhub-overview-hero">',
                '<div class="warhub-title">War Overview</div>',
                '<div class="warhub-sub">Faction vs enemy war view with chain, score, med deals, terms, and dibs.</div>',
                '<div class="warhub-row">',
                    renderChainHitTimerPill(),
                    renderActiveChainSittersPill(5),
                '</div>',
                '<div class="warhub-war-head">',
                    '<div class="warhub-war-side">',
                        '<div class="warhub-war-side-label">Your faction</div>',
                        '<div class="warhub-war-side-name">' + esc(ownName) + '</div>',
                    '</div>',
                    '<div class="warhub-war-vs">VS</div>',
                    '<div class="warhub-war-side right">',
                        '<div class="warhub-war-side-label">Enemy faction</div>',
                        '<div class="warhub-war-side-name">' + esc(enemyName) + '</div>',
                    '</div>',
                '</div>',
            '</div>',
            '<div class="warhub-overview-stats">',
                '<div class="warhub-stat-card good"><div class="warhub-stat-label">Our Score</div><div class="warhub-stat-value">' + esc(fmtNum(scoreUs)) + '</div></div>',
                '<div class="warhub-stat-card bad"><div class="warhub-stat-label">Enemy Score</div><div class="warhub-stat-value">' + esc(fmtNum(scoreThem)) + '</div></div>',
                '<div class="warhub-stat-card good"><div class="warhub-stat-label">Our Chain</div><div class="warhub-stat-value">' + esc(fmtNum(chainUs)) + '</div></div>',
                '<div class="warhub-stat-card bad"><div class="warhub-stat-label">Enemy Chain</div><div class="warhub-stat-value">' + esc(fmtNum(chainThem)) + '</div></div>',
            '</div>',
            '<div class="warhub-alert-grid">',
                '<div class="warhub-card warhub-overview-link-card terms"><h4>Terms</h4><div class="warhub-spy-box">' + esc(termsText || 'No terms saved yet.') + '</div></div>',
                '<div class="warhub-card warhub-overview-link-card meddeals"><h4>Med Deals</h4><div class="warhub-spy-box">' + esc(medDealsText || 'No med deals saved yet.') + '</div></div>',
                '<div class="warhub-card warhub-overview-link-card dibs"><h4>Dibs</h4><div class="warhub-spy-box">' + esc(dibsText || 'No dibs claimed yet.') + '</div></div>',
            '</div>',
        '</div>'
    ].join('');
}

function renderMembersTab() {
    var members = getMembersForMembersTab();

    var search = String(GM_getValue('warhub_members_search', '') || '').trim().toLowerCase();

    var filtered = members.filter(function (m) {
        if (!search) return true;
        if (isViewerMemberRow(m)) return true;
        return memberSearchText(m).indexOf(search) >= 0;
    });

    var grouped = groupMembers(filtered);
    var total = filtered.length;

    return [
        '<div class="warhub-grid">',
            '<div class="warhub-hero-card">',
                '<div class="warhub-title">Members</div>',
                '<div class="warhub-sub">Members using War and Chain plus faction roster when available. Availability starts Unavailable, can be toggled beside Bounty, and everyone can see it.</div>',
            '</div>',

            '<div class="warhub-card">',
                '<div class="warhub-row">',
                    '<input id="warhub-members-search" class="warhub-input" type="text" value="' + esc(search) + '" placeholder="Search member name, ID, status or position" />',
                    '<button type="button" class="warhub-btn ghost" data-action="members-refresh">Refresh</button>',
                '</div>',
            '</div>',

            '<div class="warhub-card">',
                '<div class="warhub-row">',
                    '<span class="warhub-pill neutral">Total ' + esc(String(total)) + '</span>',
                    '<span class="warhub-pill online">Online ' + esc(String(grouped.online.length)) + '</span>',
                    '<span class="warhub-pill idle">Idle ' + esc(String(grouped.idle.length)) + '</span>',
                    '<span class="warhub-pill travel">Travel ' + esc(String(grouped.travel.length)) + '</span>',
                    '<span class="warhub-pill jail">Jail ' + esc(String(grouped.jail.length)) + '</span>',
                    '<span class="warhub-pill hospital">Hospital ' + esc(String(grouped.hospital.length)) + '</span>',
                    '<span class="warhub-pill offline">Offline ' + esc(String(grouped.offline.length)) + '</span>',
                '</div>',
            '</div>',

            total ? renderGroupBlock('members_online', grouped.online, renderMemberRow, true) : '<div class="warhub-card">No faction members loaded yet.</div>',
            total ? renderGroupBlock('members_idle', grouped.idle, renderMemberRow, true) : '',
            total ? renderGroupBlock('members_travel', grouped.travel, renderMemberRow, false) : '',
            total ? renderGroupBlock('members_jail', grouped.jail, renderMemberRow, false) : '',
            total ? renderGroupBlock('members_hospital', grouped.hospital, renderMemberRow, true) : '',
            total ? renderGroupBlock('members_offline', grouped.offline, renderMemberRow, false) : '',
        '</div>'
    ].join('');
}
    
function renderEnemiesTab() {
    var enemies = arr(warEnemiesCache || (state && state.enemies) || []).filter(function (m) {
        var id = String((m && (m.user_id || m.id)) || '').trim();
        return !!id;
    });
    if (enemies.length) queueEnemyFfPredictions(enemies);
    var war = (state && state.war) || {};
    var enemyFactionId = String(war.enemy_faction_id || warEnemiesFactionId || '').trim();
    var enemyFactionName = String(war.enemy_faction_name || warEnemiesFactionName || 'Enemy Faction');
    var grouped = groupMembers(enemies);
    return [
        '<div class="warhub-grid">',
            '<div class="warhub-hero-card">',
                '<div class="warhub-title">Enemies</div>',
                '<div class="warhub-sub">' + esc(enemyFactionId ? (enemyFactionName + ' #' + enemyFactionId) : enemyFactionName) + '</div>',
                '<div class="warhub-sub">Real-time enemy faction status</div>',
            '</div>',
            enemyFactionId || enemies.length ? '' : '<div class="warhub-card">No current enemy faction detected yet.</div>',
            renderGroupBlock('enemies_online', grouped.online, function (m) { return renderEnemyRow(m); }, true),
            renderGroupBlock('enemies_idle', grouped.idle, function (m) { return renderEnemyRow(m); }, true),
            renderGroupBlock('enemies_travel', grouped.travel, function (m) { return renderEnemyRow(m); }, false),
            renderGroupBlock('enemies_jail', grouped.jail, function (m) { return renderEnemyRow(m); }, false),
            renderGroupBlock('enemies_hospital', grouped.hospital, function (m) { return renderEnemyRow(m); }, true),
            renderGroupBlock('enemies_offline', grouped.offline, function (m) { return renderEnemyRow(m); }, false),
        '</div>'
    ].join('');
}


    


    function renderHospitalTab() {
        var hospitalState = (state && state.hospital) || {};
        var enemies = arr((hospitalState && hospitalState.items) || []);
        var nowSec = Math.floor(Date.now() / 1000);
        var hospitalOnly = enemies.filter(function (m) {
            var untilTs = Number((m && (m.hospital_until_ts || m.hospital_until || m.status_until || m.until)) || 0);
            var seconds = Number((m && (m.hospital_seconds || m.hospital_time_left || m.hospital_eta_seconds)) || 0);
            return !!(m && (m.in_hospital || m.is_hospitalized)) || stateLabel(m) === 'hospital' || seconds > 0 || untilTs > nowSec;
        }).sort(function (a, b) {
            var aCd = Number(stateCountdown(a) || 0);
            var bCd = Number(stateCountdown(b) || 0);
            if (aCd !== bCd) return aCd - bCd;
            return getMemberName(a).localeCompare(getMemberName(b));
        });
        return [
            '<div class="warhub-grid">',
                '<div class="warhub-hero-card">',
                    '<div class="warhub-title">Hospital</div>',
                    '<div class="warhub-sub">Current enemy hospital list, lowest timer first, kept live from current war</div>',
                '</div>',
                hospitalOnly.length ? renderGroupBlock('hospital_enemies', hospitalOnly, function (m) { return renderEnemyRow(m, { mode: 'hospital' }); }, true) : '<div class="warhub-card">No hospital enemies right now.</div>',
            '</div>'
        ].join('');
    }

    

    function renderChainTab() {
        var chain = (state && state.chain) || {};
        var ownFactionName = String(((state && state.faction && (state.faction.faction_name || state.faction.name)) || 'Your Faction'));
        var availableItems = arr(chain.available_items).map(mergeChainMember).slice().sort(function (a, b) {
            return getMemberName(a).localeCompare(getMemberName(b));
        });
        var sitterItems = arr(chain.sitter_items).map(mergeChainMember).slice().sort(function (a, b) {
            return getMemberName(a).localeCompare(getMemberName(b));
        });
        var current = Number(chain.current || 0);
        var cooldown = Number(chain.cooldown || 0);
        var isAvailable = !!chain.available;
        var isSitter = !!chain.sitter_enabled;
        var viewerIsUnavailable = !isAvailable;
        var yourStatus = isAvailable ? (isSitter ? 'Available · Chain Sitter On' : 'Available') : (isSitter ? 'Unavailable · Chain Sitter On' : 'Unavailable');
        var bonusTiers = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];
        var nextBonus = 0;
        var previousBonus = 0;
        var i;
        for (i = 0; i < bonusTiers.length; i += 1) {
            if (current < bonusTiers[i]) {
                nextBonus = bonusTiers[i];
                previousBonus = i > 0 ? bonusTiers[i - 1] : 0;
                break;
            }
            previousBonus = bonusTiers[i];
        }
        if (!nextBonus) {
            previousBonus = bonusTiers[bonusTiers.length - 1];
            nextBonus = previousBonus + 50000;
        }
        var hitsToBonus = Math.max(0, nextBonus - current);
        var progressBase = Math.max(1, nextBonus - previousBonus);
        var progressValue = Math.max(0, current - previousBonus);
        var meterPct = Math.max(6, Math.min(100, Math.round((progressValue / progressBase) * 100)));
        var bonusCountdown = hitsToBonus <= 0 ? 'Bonus hit ready now' : (hitsToBonus === 1 ? '1 hit to next bonus' : (fmtNum(hitsToBonus) + ' hits to next bonus'));
        var tierLabel = previousBonus > 0 ? (fmtNum(previousBonus) + ' → ' + fmtNum(nextBonus)) : ('0 → ' + fmtNum(nextBonus));
        var chainColorClass = current >= nextBonus ? 'good' : (hitsToBonus <= 3 ? 'warn' : 'neutral');

        function chainBtnClass(activeClass, isActive) {
            return 'warhub-btn ' + (isActive ? activeClass : 'gray');
        }

        function renderChainPersonRow(item, mode) {
            item = mergeChainMember(item);
            var uid = String((item && item.user_id) || '');
            var name = getMemberName(item);
            var profile = uid ? profileUrl(uid) : '';
            var energy = energyValue(item);
            var booster = boosterCooldownValue(item);
            var med = medCooldownValue(item);
            var statusText = mode === 'sitter'
                ? ((item && item.sitter_enabled) ? 'Chain sitter enabled' : 'Chain sitter disabled')
                : 'Marked available';
            return [
                '<div class="chain-person-row warhub-member-row">',
                    '<div class="warhub-member-main">',
                        '<div class="warhub-col" style="min-width:0;flex:1;">',
                            profile
                                ? '<a class="warhub-member-name" href="' + esc(profile) + '" target="_blank" rel="noopener noreferrer">' + esc(name) + '</a>'
                                : '<div class="warhub-member-name">' + esc(name) + '</div>',
                            '<div class="warhub-summary-meta">' + esc(statusText) + '</div>',
                        '</div>',
                        '<div class="warhub-flag-row">',
                            mode === 'sitter'
                                ? '<span class="warhub-pill warn">Sitter</span>'
                                : '<span class="warhub-pill good">Available</span>',
                        '</div>',
                    '</div>',
                    '<div class="warhub-statline">',
                        '<span title="Energy">⚡ ' + esc(energy == null ? '—' : String(energy)) + '</span>',
                        '<span title="Booster Cooldown">🧪 ' + esc(booster) + '</span>',
                        '<span title="Medical Cooldown">💊 ' + esc(med) + '</span>',
                    '</div>',
                '</div>'
            ].join('');
        }

        return [
            '<div class="warhub-grid">',
                '<div class="warhub-hero-card chain-hero" style="background:linear-gradient(180deg, rgba(165,24,24,.35), rgba(140,96,22,.18) 55%, rgba(255,255,255,.04)); border-color: rgba(255,208,82,.22);">',
                    '<div class="warhub-title">Chain Rack</div>',
                    '<div class="warhub-sub">' + esc(ownFactionName) + ' live chain control</div>',
                    '<div class="warhub-space"></div>',
                    '<div class="chain-stat-grid">',
                        '<div class="chain-stat-box" style="background:linear-gradient(180deg, rgba(188,34,34,.22), rgba(255,255,255,.04)); border:1px solid rgba(255,98,98,.18); border-radius:12px; padding:10px;">',
                            '<div class="label">Chain Score</div>',
                            '<div class="value" style="font-size:28px; color:#ffdf7d;">' + esc(fmtNum(current)) + '</div>',
                        '</div>',
                        '<div class="chain-stat-box" style="background:linear-gradient(180deg, rgba(214,151,28,.22), rgba(255,255,255,.04)); border:1px solid rgba(255,208,82,.20); border-radius:12px; padding:10px;">',
                            '<div class="label">Next Bonus Hit</div>',
                            '<div class="value" style="font-size:24px; color:#ffe48e;">' + esc(fmtNum(nextBonus)) + '</div>',
                            '<div class="warhub-summary-meta">Tier ' + esc(tierLabel) + '</div>',
                        '</div>',
                        '<div class="chain-stat-box" style="background:linear-gradient(180deg, rgba(48,138,88,.22), rgba(255,255,255,.04)); border:1px solid rgba(90,200,120,.18); border-radius:12px; padding:10px;">',
                            '<div class="label">Bonus Countdown</div>',
                            '<div class="value" style="font-size:18px; color:#b8ffd1;">' + esc(bonusCountdown) + '</div>',
                            '<div class="warhub-summary-meta">Cooldown ' + esc(shortCd(cooldown, 'Ready')) + '</div>',
                        '</div>',
                        '<div class="chain-stat-box" style="background:linear-gradient(180deg, rgba(73,86,190,.18), rgba(255,255,255,.04)); border:1px solid rgba(112,132,255,.16); border-radius:12px; padding:10px;">',
                            '<div class="label">Your Status</div>',
                            '<div class="value" style="font-size:18px; color:#dfe5ff;">' + esc(yourStatus) + '</div>',
                        '</div>',
                    '</div>',
                    '<div class="warhub-space"></div>',
                    '<div class="chain-meter" style="background:rgba(255,255,255,.08); border-radius:999px; overflow:hidden; border:1px solid rgba(255,255,255,.08);">',
                        '<div class="chain-meter-fill" style="width:' + esc(String(meterPct)) + '%; height:14px; background:linear-gradient(90deg, rgba(255,208,82,.95), rgba(255,104,104,.92));"></div>',
                    '</div>',
                    '<div class="warhub-space"></div>',
                    '<div class="warhub-row">',
                        '<span class="warhub-pill ' + (isAvailable ? 'good' : 'bad') + '">' + esc(isAvailable ? 'Available' : 'Unavailable') + '</span>',
                        '<span class="warhub-pill ' + (isSitter ? 'warn' : 'neutral') + '">' + esc(isSitter ? 'Chain Sitter On' : 'Chain Sitter Off') + '</span>',
                        '<span class="warhub-pill online">Available ' + esc(String(availableItems.length)) + '</span>',
                        '<span class="warhub-pill idle">Sitters ' + esc(String(sitterItems.length)) + '</span>',
                        '<span class="warhub-pill ' + esc(chainColorClass) + '">Next ' + esc(fmtNum(nextBonus)) + '</span>',
                    '</div>',
                '</div>',
                '<div class="warhub-card">',
                    '<div class="warhub-row">',
                        '<button type="button" class="' + esc(chainBtnClass('green', isAvailable)) + '" data-action="chain-available">Available</button>',
                        '<button type="button" class="' + esc(chainBtnClass('', viewerIsUnavailable)) + '" data-action="chain-unavailable">Unavailable</button>',
                        '<button type="button" class="' + esc(chainBtnClass('warn', isSitter)) + '" data-action="chain-toggle-sitter">Toggle sitter</button>',
                    '</div>',
                '</div>',
                '<div class="warhub-card">',
                    '<h3>Available</h3>',
                    availableItems.length
                        ? availableItems.map(function (item) { return renderChainPersonRow(item, 'available'); }).join('')
                        : '<div class="warhub-muted">No members marked available.</div>',
                '</div>',
                '<div class="warhub-card">',
                    '<h3>Chain Sitters</h3>',
                    sitterItems.length
                        ? sitterItems.map(function (item) { return renderChainPersonRow(item, 'sitter'); }).join('')
                        : '<div class="warhub-muted">No chain sitters enabled.</div>',
                '</div>',
            '</div>'
        ].join('');
    }

    function sortMembers(list) {
        return arr(list).slice().sort(function (a, b) {
            var aState = stateLabel(a);
            var bState = stateLabel(b);
            var rank = { online: 0, idle: 1, hospital: 2, jail: 3, travel: 4, offline: 5 };
            var diff = (rank[aState] ?? 99) - (rank[bState] ?? 99);
            if (diff) return diff;
            return getMemberName(a).localeCompare(getMemberName(b));
        });
    }

    function renderTargetsTab() {
    var targets = mergeTargets((state && state.targets) || [], getLocalTargets());
    var enemyPool = [];
    enemyPool = enemyPool.concat(arr(warEnemiesCache || []));
    enemyPool = enemyPool.concat(arr((state && state.enemies) || []));
    enemyPool = enemyPool.concat(arr((((state || {}).hospital || {}).items) || []));
    var seenEnemyIds = {};
    var enemies = sortMembers(enemyPool.filter(function (m) {
        var id = getMemberId(m);
        if (!id || seenEnemyIds[id]) return false;
        seenEnemyIds[id] = true;
        return true;
    }));

    return [
        '<div class="warhub-grid">',
            '<div class="warhub-hero-card">',
                '<div class="warhub-title">Targets</div>',
                '<div class="warhub-sub">Save one or more war enemies and manage them here</div>',
            '</div>',

            '<div class="warhub-card warhub-col">',
                '<h3>Saved Enemy</h3>',
                targets.length ? targets.map(function (t) {
                    var id = String(t.user_id || t.target_user_id || t.id || t.player_id || '');
                    var name = String(t.name || t.target_name || t.player_name || 'Enemy');
                    var note = String(t.note || '');

                    return [
                        '<div class="warhub-member-row">',
                            '<div class="warhub-member-main">',
                                '<div class="warhub-row" style="justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">',
                                    '<a class="warhub-member-name" href="https://www.torn.com/profiles.php?XID=' + esc(id) + '" target="_blank" rel="noopener noreferrer">' + esc(name) + '</a>',
                                    '<div class="warhub-row" style="gap:8px;flex-wrap:wrap;">',
                                        id ? '<a class="warhub-btn" href="https://www.torn.com/loader.php?sid=attack&user2ID=' + esc(id) + '" target="_blank" rel="noopener noreferrer">Attack</a>' : '',
                                        id ? '<button type="button" class="warhub-btn gray" data-action="target-delete" data-user-id="' + esc(id) + '">Delete</button>' : '',
                                    '</div>',
                                '</div>',
                                note ? '<div class="warhub-spy-box">' + esc(note) + '</div>' : '',
                            '</div>',
                        '</div>'
                    ].join('');
                }).join('') : '<div class="warhub-muted">No enemy saved yet.</div>',
            '</div>',

            '<div class="warhub-card warhub-col">',
                '<label class="warhub-label" for="warhub-target-name">Enemy</label>',
                '<select id="warhub-target-name" class="warhub-select">',
                    '<option value="">Select enemy member</option>',
                    enemies.map(function (m) {
                        var id = getMemberId(m);
                        var name = getMemberName(m);
                        return '<option value="' + esc(id) + '">' + esc(name) + '</option>';
                    }).join(''),
                '</select>',

                '<label class="warhub-label" for="warhub-target-note">Note (optional)</label>',
                '<textarea id="warhub-target-note" class="warhub-textarea" placeholder="Optional note for yourself"></textarea>',

                '<div class="warhub-row">',
                    '<button type="button" class="warhub-btn green" data-action="target-save">Save Enemy</button>',
                '</div>',
            '</div>',
        '</div>'
    ].join('');
}
    function renderMedDealsTab() {
        var medDeals = (state && state.med_deals) || {};
        var items = arr(medDeals.items || []);
        var enemies = sortMembers(arr((state && state.enemies) || warEnemiesCache || []));
        var viewer = (state && state.viewer) || {};
        var viewerUserId = String(viewer.user_id || '').trim();
        var viewerName = String(viewer.name || 'You');
        var mine = items.find(function (row) {
            return String((row && row.user_id) || '').trim() === viewerUserId;
        }) || {};
        var selectedEnemyUserId = String(mine.enemy_user_id || '');

        return [
            '<div class="warhub-grid">',
                '<div class="warhub-hero-card">',
                    '<div class="warhub-title">Med Deals</div>',
                    '<div class="warhub-sub">Pick your enemy from current war. Shared on Overview for the faction.</div>',
                '</div>',
                '<div class="warhub-card warhub-col">',
                    '<div class="warhub-kv"><div>Your member</div><div>' + esc(viewerName) + '</div></div>',
                    '<label class="warhub-label" for="warhub-meddeals-enemy">Enemy player</label>',
                    '<select id="warhub-meddeals-enemy" class="warhub-select">',
                        '<option value="">Select enemy player</option>',
                        enemies.map(function (m) {
                            if (typeof m === 'string') return m;
                            var id = getMemberId(m);
                            var name = getMemberName(m);
                            var selected = id && selectedEnemyUserId && String(id) === String(selectedEnemyUserId) ? ' selected' : '';
                            return '<option value="' + esc(id) + '"' + selected + '>' + esc(name) + '</option>';
                        }).join(''),
                    '</select>',
                    '<div class="warhub-row">',
                        '<button type="button" class="warhub-btn" data-action="meddeals-save">Save</button>',
                        '<button type="button" class="warhub-btn gray" data-action="meddeals-clear">Delete</button>',
                    '</div>',
                '</div>',
                items.length ? [
                    '<div class="warhub-card warhub-col">',
                        '<h3>Current Med Deals</h3>',
                        items.map(function (row) {
                            var userName = String(row.user_name || row.user_id || 'Member');
                            var enemyName = String(row.enemy_name || row.enemy_user_id || 'Enemy');
                            return '<div class="warhub-spy-box">' + esc(userName + ' → ' + enemyName) + '</div>';
                        }).join(''),
                    '</div>'
                ].join('') : '<div class="warhub-card">No med deals posted yet.</div>',
            '</div>'
        ].join('');
    }

function renderTermsTab() {
    var box = (state && state.terms_summary) || {};
    var text = String(box.text || '');

    return [
        '<div class="warhub-grid">',
            '<div class="warhub-hero-card">',
                '<div class="warhub-title">Terms</div>',
                '<div class="warhub-sub">Leader shared Terms / Summary box for the whole faction</div>',
            '</div>',

            '<div class="warhub-card warhub-col">',
                '<label class="warhub-label" for="warhub-terms-summary-text">Terms / Summary</label>',
                '<textarea id="warhub-terms-summary-text" class="warhub-textarea" placeholder="Write terms, summary, instructions, or improvements here...">' + esc(text) + '</textarea>',
                '<div class="warhub-row">',
                    '<button type="button" class="warhub-btn" data-action="terms-summary-save">Save</button>',
                    '<button type="button" class="warhub-btn gray" data-action="terms-summary-clear">Delete</button>',
                '</div>',
            '</div>',
        '</div>'
    ].join('');
}
    function renderSummaryTab() {
    var summary = liveSummaryCache || {};
    var cards = arr(summary.cards);
    var top = summary.top || {};
    var rows = arr(summary.rows);
    if (!rows.length) {
        rows = arr((state && state.members) || []).map(function (m) {
            var uid = String((m && (m.user_id || m.id)) || '');
            return {
                user_id: uid,
                name: getMemberName(m),
                role: String((m && (m.position || (m.member_access && m.member_access.position))) || 'Member'),
                status: String((m && (m.status || m.online_state)) || '—'),
                profile_url: uid ? profileUrl(uid) : '',
                enabled: !!(m && (m.enabled || (m.member_access && m.member_access.enabled))),
                member_access: (m && m.member_access) || {},
                has_stored_api_key: !!(m && (m.has_stored_api_key || (m.member_access && m.member_access.member_api_key))),
                online_state: String((m && m.online_state) || '').toLowerCase(),
                hits: 0,
                respect_gain: 0,
                respect_lost: 0,
                net_impact: 0,
                hits_taken: 0,
                efficiency: 0,
                last_action: String((m && m.last_action) || ''),
                hospital_eta: '',
                hospital_eta_seconds: 0,
                no_show: true,
                recovering_soon: false,
                flags: []
            };
        });
    }
    var topFive = summary.top_five || {};
    var alerts = summary.alerts || {};
    var trend = summary.trend || {};
    var war = summary.war || (state && state.war) || {};

    function num(v, fallback) {
        var n = Number(v);
        return Number.isFinite(n) ? n : Number(fallback || 0);
    }

    function txt(v, fallback) {
        var s = String(v == null ? '' : v).trim();
        return s || String(fallback || '—');
    }

    function pickList() {
        for (var i = 0; i < arguments.length; i++) {
            if (Array.isArray(arguments[i])) return arguments[i];
        }
        return [];
    }

    function renderAlertList(title, items, metricLabel) {
        items = arr(items).slice(0, 5);

        return [
            '<div class="warhub-alert-card">',
                '<h4>' + esc(title) + '</h4>',
                items.length
                    ? [
                        '<div class="warhub-summary-list">',
                            items.map(function (item) {
                                var name = txt(item.name || item.user_name || item.player_name, 'Player');
                                var metric = item.metric_label || item.label || metricLabel || '';
                                var value = item.metric_value != null ? item.metric_value : (
                                    item.value != null ? item.value : (
                                        item.net_impact != null ? fmtNum(item.net_impact) : '—'
                                    )
                                );

                                return [
                                    '<div class="warhub-summary-item">',
                                        '<div>',
                                            '<div class="warhub-summary-name">' + esc(name) + '</div>',
                                            metric ? '<div class="warhub-summary-meta">' + esc(metric) + '</div>' : '',
                                        '</div>',
                                        '<div class="warhub-pill neutral">' + esc(String(value)) + '</div>',
                                    '</div>'
                                ].join('');
                            }).join(''),
                        '</div>'
                    ].join('')
                    : '<div class="warhub-sub">No data yet.</div>',
            '</div>'
        ].join('');
    }

    function renderTrendCard(title, box) {
        box = box || {};
        return [
            '<div class="warhub-stat-card">',
                '<div class="warhub-stat-label">' + esc(title) + '</div>',
                '<div class="warhub-kv"><div>Respect Gained</div><div>' + esc(fmtNum(num(box.respect_gain))) + '</div></div>',
                '<div class="warhub-kv"><div>Respect Lost</div><div>' + esc(fmtNum(num(box.respect_lost))) + '</div></div>',
                '<div class="warhub-kv"><div>Net</div><div>' + netPill(num(box.net), '') + '</div></div>',
                '<div class="warhub-kv"><div>Hits</div><div>' + esc(fmtNum(num(box.hits))) + '</div></div>',
                '<div class="warhub-kv"><div>Hits Taken</div><div>' + esc(fmtNum(num(box.hits_taken))) + '</div></div>',
            '</div>'
        ].join('');
    }

    function renderFlags(flags) {
        flags = arr(flags);
        if (!flags.length) return '—';

        return [
            '<div class="warhub-flag-row">',
                flags.map(function (flag) {
                    return '<span class="warhub-flag">' + esc(String(flag)) + '</span>';
                }).join(''),
            '</div>'
        ].join('');
    }

    function renderTableRows(items) {
        items = arr(items);

        if (!items.length) {
            return '<tr><td colspan="14">No summary rows yet.</td></tr>';
        }

        return items.map(function (r) {
            var userId = txt(r.user_id, '');
            var name = txt(r.name || r.user_name || r.player_name, 'Player');
            var hits = num(r.hits);
            var gained = num(r.respect_gain);
            var lost = num(r.respect_lost);
            var net = num(r.net_impact, gained - lost);
            var taken = num(r.hits_taken);
            var efficiency = num(r.efficiency);
            var lastAction = txt(r.last_action, '—');
            var hospitalEta = txt(r.hospital_eta, '—');
            var role = txt(r.role, 'Member');
            var status = txt(r.status, '—');
            var isEnabled = !!r.enabled;
            var hasLogin = !!r.has_stored_api_key;
            var onlineState = txt(r.online_state, '').toLowerCase();
            var profile = txt(r.profile_url, '') || (userId ? 'https://www.torn.com/profiles.php?XID=' + encodeURIComponent(userId) : '');

            return [
                '<tr>',
                    '<td>',
                        profile
                            ? '<a class="warhub-member-name" href="' + esc(profile) + '" target="_blank" rel="noopener noreferrer">' + esc(name) + '</a>'
                            : '<span class="warhub-member-name">' + esc(name) + '</span>',
                    '</td>',
                    '<td>' + esc(role) + '</td>',
                    '<td>' + (isEnabled ? '<span class="warhub-pill good">Enabled</span>' : '<span class="warhub-pill bad">Off</span>') + '</td>',
                    '<td>' + (hasLogin ? '<span class="warhub-pill good">Logged In</span>' : '<span class="warhub-pill neutral">No Login</span>') + '</td>',
                    '<td>' + (onlineState ? '<span class="warhub-pill ' + esc(onlineState) + '">' + esc(status) + '</span>' : esc(status)) + '</td>',
                    '<td>' + esc(fmtNum(hits)) + '</td>',
                    '<td>' + esc(fmtNum(gained)) + '</td>',
                    '<td>' + esc(fmtNum(lost)) + '</td>',
                    '<td>' + netPill(net, '') + '</td>',
                    '<td>' + esc(fmtNum(taken)) + '</td>',
                    '<td>' + esc(efficiency ? efficiency.toFixed(2) : '0.00') + '</td>',
                    '<td>' + esc(lastAction) + '</td>',
                    '<td>' + esc(hospitalEta) + '</td>',
                    '<td>' + renderFlags(r.flags) + '</td>',
                '</tr>'
            ].join('');
        }).join('');
    }

    function renderTopFiveBox(title, rowsList, emptyText) {
        rowsList = arr(rowsList).slice(0, 5);

        return [
            '<div class="warhub-card warhub-col">',
                '<h3>' + esc(title) + '</h3>',
                rowsList.length ? [
                    '<div class="warhub-col">',
                        rowsList.map(function (row, idx) {
                            var userId = txt(row.user_id, '');
                            var name = txt(row.name || row.user_name || row.player_name, 'Player');
                            var gained = num(row.respect_gain);
                            var lost = num(row.respect_lost);
                            var net = num(row.net_impact, gained - lost);
                            var hits = num(row.hits);
                            var taken = num(row.hits_taken);
                            var efficiency = num(row.efficiency);
                            var role = txt(row.role, 'Member');
                            var status = txt(row.status, '—');
                            var isEnabled = !!row.enabled;
                            var hasLogin = !!row.has_stored_api_key;
                            var onlineState = txt(row.online_state, '').toLowerCase();
                            var profile = txt(row.profile_url, '') || (userId ? 'https://www.torn.com/profiles.php?XID=' + encodeURIComponent(userId) : '');

                            return [
                                '<details class="warhub-dropbox">',
                                    '<summary class="warhub-dropbox-head">#' + esc(String(idx + 1)) + ' ' + esc(name) + '</summary>',
                                    '<div class="warhub-dropbox-body">',
                                        '<div class="warhub-row" style="margin-bottom:8px;">',
                                            profile ? '<a class="warhub-btn ghost" href="' + esc(profile) + '" target="_blank" rel="noopener noreferrer">Open Profile</a>' : '',
                                            '<span class="warhub-pill neutral">' + esc(role) + '</span>',
                                            (isEnabled ? '<span class="warhub-pill good">Enabled</span>' : '<span class="warhub-pill bad">Off</span>'),
                                            (hasLogin ? '<span class="warhub-pill good">Logged In</span>' : '<span class="warhub-pill neutral">No Login</span>'),
                                            (onlineState ? '<span class="warhub-pill ' + esc(onlineState) + '">' + esc(status) + '</span>' : '<span class="warhub-pill neutral">' + esc(status) + '</span>'),
                                        '</div>',
                                        '<div class="warhub-kv"><div>Hits</div><div>' + esc(fmtNum(hits)) + '</div></div>',
                                        '<div class="warhub-kv"><div>Respect Gained</div><div>' + esc(fmtNum(gained)) + '</div></div>',
                                        '<div class="warhub-kv"><div>Respect Lost</div><div>' + esc(fmtNum(lost)) + '</div></div>',
                                        '<div class="warhub-kv"><div>Net Impact</div><div>' + esc(fmtNum(net)) + '</div></div>',
                                        '<div class="warhub-kv"><div>Hits Taken</div><div>' + esc(fmtNum(taken)) + '</div></div>',
                                        '<div class="warhub-kv"><div>Efficiency</div><div>' + esc(efficiency ? efficiency.toFixed(2) : '0.00') + '</div></div>',
                                    '</div>',
                                '</details>'
                            ].join('');
                        }).join(''),
                    '</div>'
                ].join('') : '<div class="warhub-sub">' + esc(emptyText || 'No data yet.') + '</div>',
            '</div>'
        ].join('');
    }

    return [
        '<div class="warhub-grid">',
            '<div class="warhub-hero-card">',
                '<div class="warhub-title">War Summary</div>',
                '<div class="warhub-sub">Leader command board for live war performance</div>',
            '</div>',

            liveSummaryError
                ? '<div class="warhub-card"><span class="warhub-pill bad">' + esc(liveSummaryError) + '</span></div>'
                : '',

            cards.length ? [
                '<div class="warhub-overview-stats">',
                    cards.map(function (c) {
                        return [
                            '<div class="warhub-stat-card ' + esc(String(c.cls || '')) + '">',
                                '<div class="warhub-stat-label">' + esc(txt(c.label, 'Metric')) + '</div>',
                                '<div class="warhub-stat-value">' + esc(String(c.value == null ? '—' : c.value)) + '</div>',
                                c.sub ? '<div class="warhub-sub" style="margin-top:6px;">' + esc(String(c.sub)) + '</div>' : '',
                            '</div>'
                        ].join('');
                    }).join(''),
                '</div>'
            ].join('') : '',

            '<div class="warhub-card warhub-col">',
                '<h3>War Snapshot</h3>',
                '<div class="warhub-kv"><div>Our Faction</div><div>' + esc(txt(war.our_faction_name || war.faction_name, 'Your Faction')) + '</div></div>',
                '<div class="warhub-kv"><div>Enemy Faction</div><div>' + esc(txt(war.enemy_faction_name, '—')) + '</div></div>',
                '<div class="warhub-kv"><div>Top Hitter</div><div>' + esc(txt(top.top_hitter, '—')) + '</div></div>',
                '<div class="warhub-kv"><div>Most Respect Gained</div><div>' + esc(txt(top.top_respect_gain, '—')) + '</div></div>',
                '<div class="warhub-kv"><div>Most Respect Lost</div><div>' + esc(txt(top.top_respect_lost || top.top_points_bleeder, '—')) + '</div></div>',
                '<div class="warhub-kv"><div>Most Hits Taken</div><div>' + esc(txt(top.top_hits_taken, '—')) + '</div></div>',
                '<div class="warhub-kv"><div>Best Efficiency</div><div>' + esc(txt(top.best_efficiency, '—')) + '</div></div>',
                '<div class="warhub-kv"><div>Best Finisher</div><div>' + esc(txt(top.best_finisher, '—')) + '</div></div>',
            '</div>',

            '<div class="warhub-overview-stats">',
                renderTrendCard('Last 15m', trend.last_15m),
                renderTrendCard('Last 60m', trend.last_60m),
                renderTrendCard('Overall', trend.overall),
            '</div>',

            '<div class="warhub-alert-grid">',
                renderAlertList('No Shows', alerts.no_shows, '0 hits'),
                renderAlertList('Bleeding', alerts.bleeding, 'High respect lost'),
                renderAlertList('Under Fire', alerts.under_fire, 'High hits taken'),
                renderAlertList('Recovering Soon', alerts.recovering_soon, 'Leaving hospital soon'),
                renderAlertList('Carrying', alerts.carrying, 'Top positive impact'),
            '</div>',

            '<div class="warhub-card warhub-col">',
                '<div class="warhub-row" style="justify-content:space-between;align-items:center;">',
                    '<h3>Member Performance</h3>',
                    '<span class="warhub-sub">Shows leader activation, login presence, live status, and war output together</span>',
                    '<span class="warhub-pill neutral">' + esc(fmtNum(rows.length)) + ' rows</span>',
                '</div>',
                '<div class="warhub-table-wrap">',
                    '<table class="warhub-table">',
                        '<thead>',
                            '<tr>',
                                '<th>Name</th>',
                                '<th>Role</th>',
                                '<th>Access</th>',
                                '<th>Login</th>',
                                '<th>Status</th>',
                                '<th>Hits</th>',
                                '<th>Respect Gained</th>',
                                '<th>Respect Lost</th>',
                                '<th>Net Impact</th>',
                                '<th>Hits Taken</th>',
                                '<th>Efficiency</th>',
                                '<th>Last Action</th>',
                                '<th>Hospital ETA</th>',
                                '<th>Flags</th>',
                            '</tr>',
                        '</thead>',
                        '<tbody>',
                            renderTableRows(rows),
                        '</tbody>',
                    '</table>',
                '</div>',
            '</div>',

            renderTopFiveBox('Top 5 Hitters', pickList(topFive.top_hitters, topFive.top_hitter), 'No hitter data yet.'),
            renderTopFiveBox('Top 5 Respect Gained', pickList(topFive.top_respect_gain, topFive.top_respect_gained), 'No respect gain data yet.'),
            renderTopFiveBox('Top 5 Respect Lost', pickList(topFive.top_respect_lost, topFive.top_points_bleeder), 'No respect lost data yet.'),
            renderTopFiveBox('Top 5 Hits Taken', pickList(topFive.top_hits_taken), 'No hits taken data yet.'),
            renderTopFiveBox('Top 5 Net Impact', pickList(topFive.top_net_impact), 'No net impact data yet.'),
            renderTopFiveBox('No Shows', pickList(topFive.no_shows), 'No no-show list right now.'),
            renderTopFiveBox('Recovering Soon', pickList(topFive.recovering_soon), 'No recovering-soon list right now.'),
        '</div>'
    ].join('');
}
        // ============================================================
    // 20. TAB RENDERS: FACTION
    // ============================================================

    function renderFactionTab() {
    var faction = (state && state.faction) || {};
    var members = arr(factionMembersCache);
    var factionName = String((faction && (faction.name || faction.faction_name)) || 'Your Faction');
    var factionId = String((faction && faction.faction_id) || '');
    var search = String(GM_getValue('warhub_faction_search', '') || '').trim().toLowerCase();

    members = members.filter(function (m) {
        return !!String(getMemberId(m) || '').trim();
    }).slice().sort(function (a, b) {
        var aEnabled = !!(a && (a.enabled || a.member_enabled || a.active_for_cycle || a.is_active || a.activated || a.is_enabled || a.active));
        var bEnabled = !!(b && (b.enabled || b.member_enabled || b.active_for_cycle || b.is_active || b.activated || b.is_enabled || b.active));
        if (aEnabled !== bEnabled) return aEnabled ? -1 : 1;
        return getMemberName(a).localeCompare(getMemberName(b));
    });

    var filtered = members.filter(function (m) {
        if (!search) return true;
        return memberSearchText(m).indexOf(search) >= 0;
    });

    var enabledCount = Number(members.filter(function (m) {
        return !!(m && (m.enabled || m.member_enabled || m.active_for_cycle || m.is_active || m.activated || m.is_enabled || m.active));
    }).length || 0);

    var visibleCanManage = canManageFaction();

    function renderFactionMemberRow(m) {
        var id = getMemberId(m);
        var name = getMemberName(m);
        var enabled = !!(m && (m.enabled || m.member_enabled || m.active_for_cycle || m.is_active || m.activated || m.is_enabled || m.active));
        var role = String((m && (m.position || m.role || (m.member_access && m.member_access.position))) || '').trim() || 'Member';
        var st = stateLabel(m);
        var stateCd = stateCountdown(m);
        var energy = energyValue(m);
        var life = lifeValue(m);
        var medBase = Number(m && (m.med_cd || m.med_cooldown || m.medical_cooldown || 0)) || 0;
        var medText = medCooldownValue(m);

        return [
            '<div class="warhub-member-row" ' +
                'data-medcd-base="' + esc(String(medBase)) + '" ' +
                'data-statuscd-base="' + esc(String(stateCd)) + '" ' +
                'data-state-name="' + esc(st) + '">',
                '<div class="warhub-member-main">',
                    '<div class="warhub-row" style="gap:8px;min-width:0;flex:1;">',
                        '<a class="warhub-member-name" href="' + esc(profileUrl(m)) + '" target="_blank" rel="noopener noreferrer">' + esc(name) + '</a>',
                        '<span class="warhub-pill neutral">' + esc(role) + '</span>',
                        '<span class="warhub-pill ' + esc(st) + '" data-statuscd>' + esc(
                            st === 'hospital' ? (stateCd > 0 ? 'Hospital (' + shortCd(stateCd, 'Hospital') + ')' : 'Hospital') :
                            st === 'jail' ? (stateCd > 0 ? 'Jail (' + shortCd(stateCd, 'Jail') + ')' : 'Jail') :
                            st === 'travel' ? (stateCd > 0 ? 'Travel (' + shortCd(stateCd, 'Travel') + ')' : 'Travel') :
                            humanStateLabel(st)
                        ) + '</span>',
                        '<span class="warhub-pill ' + (enabled ? 'good' : 'bad') + '">' + (enabled ? 'Enabled' : 'Disabled') + '</span>',
                    '</div>',
                    visibleCanManage ? '<div class="warhub-row">' + (
                        enabled
                            ? '<button type="button" class="warhub-btn gray" data-action="remove-member" data-user-id="' + esc(id) + '">Disable</button>'
                            : '<button type="button" class="warhub-btn green" data-action="activate-member" data-user-id="' + esc(id) + '">Enable</button>'
                    ) + '</div>' : '',
                '</div>',
                '<div class="warhub-statline">',
                    '<span>⚡ ' + esc(energy == null ? '—' : String(energy)) + '</span>',
                    '<span>✚ ' + esc(life) + '</span>',
                    '<span>💊 <span data-medcd>' + esc(medText) + '</span></span>',
                    '<span>#' + esc(id || '—') + '</span>',
                '</div>',
            '</div>'
        ].join('');
    }

    return [
        '<div class="warhub-grid">',
            '<div class="warhub-hero-card">',
                '<div class="warhub-title">Faction</div>',
                '<div class="warhub-sub">All faction members with live energy, life, and medical cooldown for admin, leaders, and co-leaders</div>',
            '</div>',

            '<div class="warhub-card">',
                '<div class="warhub-row" style="justify-content:space-between;align-items:flex-start;gap:8px;">',
                    '<div>',
                        '<div class="warhub-member-name">' + esc(factionName) + '</div>',
                        '<div class="warhub-sub">Faction #' + esc(factionId || '—') + '</div>',
                    '</div>',
                    '<div class="warhub-row" style="flex-wrap:wrap;justify-content:flex-end;">',
                        '<span class="warhub-pill good">Enabled ' + esc(String(enabledCount)) + '</span>',
                        '<span class="warhub-pill neutral">Members ' + esc(String(members.length)) + '</span>',
                        '<span class="warhub-pill neutral">Shown ' + esc(String(filtered.length)) + '</span>',
                    '</div>',
                '</div>',
                '<div class="warhub-sub" style="margin-top:10px;">Live bars only show when the backend has usable Torn data for that member. No fake fallback values are shown.</div>',
            '</div>',

            '<div class="warhub-card">',
                '<div class="warhub-row">',
                    '<input id="warhub-faction-search" class="warhub-input" type="text" value="' + esc(search) + '" placeholder="Search member name, ID, status or position" />',
                    '<button type="button" class="warhub-btn ghost" data-action="faction-refresh">Refresh</button>',
                '</div>',
            '</div>',

            '<div class="warhub-card warhub-col">',
                '<div class="warhub-row" style="justify-content:space-between;align-items:center;">',
                    '<h3>Faction Members</h3>',
                    '<span class="warhub-pill neutral">' + esc(fmtNum(filtered.length)) + ' shown</span>',
                '</div>',
                filtered.length
                    ? '<div class="warhub-col">' + filtered.map(renderFactionMemberRow).join('') + '</div>'
                    : '<div class="warhub-empty">No faction members found.</div>',
            '</div>',
        '</div>'
    ].join('');
} function renderSettingsTab() {
    var viewer = (state && state.viewer) || {};
    var access = normalizeAccessCache((state && state.access) || accessState);
    var maskedKey = getApiKey() ? '********' : '';
    var bs = (viewer && viewer.battle_stats) || viewer.stats || {};
    var strength = Number((bs && (bs.strength || bs.str || viewer.strength)) || 0);
    var speed = Number((bs && (bs.speed || bs.spd || viewer.speed)) || 0);
    var defense = Number((bs && (bs.defense || bs.defence || bs.def || viewer.defense || viewer.defence)) || 0);
    var dexterity = Number((bs && (bs.dexterity || bs.dex || viewer.dexterity)) || 0);
    var totalRaw = Number((viewer && (viewer.battle_stats_total || viewer.total_battle_stats || viewer.total || (strength + speed + defense + dexterity))) || 0);
    var totalM = Number((viewer && (viewer.battle_stats_total_m || viewer.total_battle_stats_m)) || 0);
    if ((!Number.isFinite(totalM) || totalM <= 0) && Number.isFinite(totalRaw) && totalRaw > 0) {
        totalM = totalRaw >= 100000 ? (totalRaw / 1000000) : totalRaw;
    }
    var totalText = Number.isFinite(totalRaw) && totalRaw > 0 ? fmtNum(totalRaw) : '0';
    var totalMillionsText = Number.isFinite(totalM) && totalM > 0 ? formatBattleMillions(totalM) : '0.0m';
    return [
        '<div class="warhub-grid">',
            '<div class="warhub-hero-card">',
                '<div class="warhub-title">Settings</div>',
                '<div class="warhub-sub">Account and local script settings</div>',
            '</div>',
            '<div class="warhub-card warhub-col">',
                '<label class="warhub-label" for="warhub-api-key">Torn Limited API Key</label>',
                '<input id="warhub-api-key" class="warhub-input" type="password" value="" placeholder="' + esc(maskedKey ? 'Saved Limited API key' : 'Enter Limited API key') + '" />',
                '<label class="warhub-label" for="warhub-ff-key">FF Scouter Limited Key</label>',
                '<input id="warhub-ff-key" class="warhub-input" type="password" value="' + esc(getFfScouterKey()) + '" placeholder="Optional FF Scouter key for fair-fight values" />',
                '<div class="warhub-sub">FF Scouter key powers the fair-fight values in enemy rows and refreshes automatically while Enemies is open.</div>',
                '<div class="warhub-row">',
                    '<button type="button" class="warhub-btn" data-action="login">Re-login</button>',
                    '<button type="button" class="warhub-btn gray" data-action="logout">Logout</button>',
                '</div>',
            '</div>',

            '<div class="warhub-card">',
                '<div class="warhub-kv"><div>User</div><div>' + esc(String(viewer.name || 'Logged out')) + '</div></div>',
                '<div class="warhub-kv"><div>User ID</div><div>' + esc(String(viewer.user_id || '—')) + '</div></div>',
                '<div class="warhub-kv"><div>Faction active</div><div>' + (canUseFeatures() ? 'Yes' : 'No') + '</div></div>',
                '<div class="warhub-kv"><div>Leader activated</div><div>' + (access.member_enabled ? 'Yes' : 'No') + '</div></div>',
            '</div>',

        '</div>'
    ].join('');
}



    function renderInstructionsTab() {
    return [
        '<div class="warhub-grid">',

            '<div class="warhub-hero-card">',
                '<div class="warhub-title">Help & API Terms</div>',
                '<div class="warhub-sub">Colorful quick guide for setup, faction use, and Torn API key rules</div>',
                '<div class="warhub-row" style="margin-top:8px;gap:6px;">',
                    '<span class="warhub-pill good">Setup</span>',
                    '<span class="warhub-pill online">Faction Tools</span>',
                    '<span class="warhub-pill travel">API Key Safety</span>',
                    '<span class="warhub-pill hospital">ToS</span>',
                '</div>',
            '</div>',

            '<div class="warhub-card warhub-col">',
                '<h3>Quick start</h3>',
                '<div class="warhub-spy-box">',
                    '<div><b>1.</b> Open <b>Settings</b> and paste your Torn Limited API key.</div>',
                    '<div><b>2.</b> Press <b>Re-login</b> to create a backend session and load your faction-linked state.</div>',
                    '<div><b>3.</b> Open <b>Members</b>, <b>Enemies</b>, <b>Hospital</b>, and <b>Chain</b> to pull live faction war tools.</div>',
                    '<div><b>4.</b> Leaders and co-leaders can activate members and manage faction-only tools.</div>',
                    '<div><b>5.</b> Refresh a tab when you want a fresh pull right away.</div>',
                '</div>',
            '</div>',

            '<div class="warhub-card warhub-col">',
                '<h3>What this script does</h3>',
                '<div class="warhub-mini-grid">',
                    '<div class="warhub-stat-card good"><div class="warhub-stat-label">Members</div><div class="warhub-summary-meta">View faction members, live bars, med cooldowns, and status buckets.</div></div>',
                    '<div class="warhub-stat-card bad"><div class="warhub-stat-label">Enemies</div><div class="warhub-summary-meta">Track enemy roster, hospital timing, dibs, and attack links during war.</div></div>',
                    '<div class="warhub-stat-card"><div class="warhub-stat-label">Chain</div><div class="warhub-summary-meta">Show availability, sitter status, chain numbers, and faction coordination tools.</div></div>',
                    '<div class="warhub-stat-card"><div class="warhub-stat-label">Shared faction view</div><div class="warhub-summary-meta">Activated members can appear in faction tools so teammates can coordinate faster.</div></div>',
                '</div>',
            '</div>',

            '<div class="warhub-card warhub-col">',
                '<h3>Torn API ToS summary</h3>',
                '<div class="warhub-spy-box">',
                    '<div>Torn says users must know <b>how their key is used</b>, what is stored, who can access the data, and what access level is needed.</div>',
                    '<div style="margin-top:6px;">Torn also says scripts should <b>never ask for passwords</b>, should keep keys <b>secure and confidential</b>, and should request <b>only the data needed</b>.</div>',
                    '<div style="margin-top:6px;">If a tool stores or shares data beyond the local browser, the ToS should be shown clearly where the key is entered.</div>',
                '</div>',
                '<div class="warhub-space"></div>',
                '<div class="warhub-kv"><div>Passwords requested</div><div><span class="warhub-pill good">No</span></div></div>',
                '<div class="warhub-kv"><div>Key owner awareness</div><div><span class="warhub-pill travel">Required</span></div></div>',
                '<div class="warhub-kv"><div>Use least data needed</div><div><span class="warhub-pill online">Yes</span></div></div>',
                '<div class="warhub-kv"><div>Keep keys confidential</div><div><span class="warhub-pill hospital">Yes</span></div></div>',
            '</div>',

            '<div class="warhub-card warhub-col">',
                '<h3>War and Chain ToS snapshot</h3>',
                '<div class="warhub-kv"><div>Data storage</div><div><span class="warhub-pill bad">Remote + local</span></div></div>',
                '<div class="warhub-summary-meta">This build stores local preferences in userscript storage and also sends your API key to the backend for login, sessions, and faction-linked features.</div>',
                '<div class="warhub-kv"><div>Data sharing</div><div><span class="warhub-pill online">Faction tools</span></div></div>',
                '<div class="warhub-summary-meta">Faction-linked outputs such as shared member or war coordination views may be visible to other users in the same faction who are using the script.</div>',
                '<div class="warhub-kv"><div>Purpose of use</div><div><span class="warhub-pill travel">War support</span></div></div>',
                '<div class="warhub-summary-meta">Used for faction organization, war tracking, member access, chain coordination, enemy tracking, and related quality-of-life features.</div>',
                '<div class="warhub-kv"><div>Key storage & use</div><div><span class="warhub-pill hospital">Automation</span></div></div>',
                '<div class="warhub-summary-meta">Your key is used by the backend to authenticate you, build your session, and pull the live Torn data needed for enabled features.</div>',
                '<div class="warhub-kv"><div>Recommended key access</div><div><span class="warhub-pill good">Lowest needed</span></div></div>',
                '<div class="warhub-summary-meta">Use the lowest access or custom key that still supports the tabs you want to use.</div>',
            '</div>',

            '<div class="warhub-card warhub-col">',
                '<h3>API key storage and safety</h3>',
                '<div class="warhub-spy-box">',
                    '<div><b>Local storage:</b> the userscript saves your session token, open tab, overlay state, FF key, and other convenience settings in userscript storage on your device/browser.</div>',
                    '<div style="margin-top:6px;"><b>Backend use:</b> when you log in, your Limited API key is sent to the War and Chain backend and used to authenticate your account and power faction-linked live features.</div>',
                    '<div style="margin-top:6px;"><b>Best practice:</b> do not share your key, do not paste someone else\'s key, and do not use more access than the script actually needs.</div>',
                    '<div style="margin-top:6px;"><b>Important:</b> if you think your key has been misused, replace it in Torn and log in again with a fresh one.</div>',
                '</div>',
            '</div>',

            '<div class="warhub-card warhub-col">',
                '<h3>Using the script safely</h3>',
                '<div>• Only use your own Torn Limited API key.</div>',
                '<div>• Never give your Torn password to any script or website.</div>',
                '<div>• Leaders and co-leaders should only activate members who should have faction access.</div>',
                '<div>• Data shown in the overlay depends on Torn API responses, backend state, and your current session.</div>',
                '<div>• If something looks wrong, refresh the tab or re-login before assuming the data is final.</div>',
            '</div>',

            '<div class="warhub-card warhub-col">',
                '<h3>Good key setup</h3>',
                '<div class="warhub-row">',
                    '<span class="warhub-pill good">Custom key</span>',
                    '<span class="warhub-pill online">Needed selections only</span>',
                    '<span class="warhub-pill travel">Rotate if unsure</span>',
                '</div>',
                '<div class="warhub-space"></div>',
                '<div>For best safety, build a custom key with only the selections needed for the features you use most.</div>',
                '<div>If a tab stops working after changing key access, raise the access only as much as needed instead of using a wider key by default.</div>',
            '</div>',

        '</div>'
    ].join('');
}


    function renderWarTop5Tab() {
    var summary = liveSummaryCache || {};
    var topFive = summary.top_five || {};

    function txt(v, fallback) {
        var s = String(v == null ? '' : v).trim();
        return s || String(fallback || '—');
    }

    function num(v, fallback) {
        var n = Number(v);
        return Number.isFinite(n) ? n : Number(fallback || 0);
    }

    function pickList() {
        for (var i = 0; i < arguments.length; i++) {
            if (Array.isArray(arguments[i])) return arguments[i];
        }
        return [];
    }

    function renderQuickBox(title, rows) {
        rows = arr(rows).slice(0, 5);

        return [
            '<div class="warhub-card warhub-col">',
                '<h3>' + esc(title) + '</h3>',
                rows.length ? rows.map(function (row, idx) {
                    var userId = txt(row.user_id, '');
                    var name = txt(row.name || row.user_name || row.player_name, 'Player');
                    var hits = num(row.hits);
                    var gain = num(row.respect_gain);
                    var lost = num(row.respect_lost);
                    var taken = num(row.hits_taken);
                    var net = num(row.net_impact, gain - lost);
                    var role = txt(row.role, 'Member');
                    var isEnabled = !!row.enabled;
                    var hasLogin = !!row.has_stored_api_key;
                    var profile = txt(row.profile_url, '') || (userId ? 'https://www.torn.com/profiles.php?XID=' + encodeURIComponent(userId) : '');

                    return [
                        '<details class="warhub-dropbox">',
                            '<summary class="warhub-dropbox-head">#' + esc(String(idx + 1)) + ' ' + esc(name) + '</summary>',
                            '<div class="warhub-dropbox-body">',
                                '<div class="warhub-row" style="margin-bottom:8px;">',
                                    profile ? '<a class="warhub-btn ghost" href="' + esc(profile) + '" target="_blank" rel="noopener noreferrer">Open Profile</a>' : '',
                                    '<span class="warhub-pill neutral">' + esc(role) + '</span>',
                                    (isEnabled ? '<span class="warhub-pill good">Enabled</span>' : '<span class="warhub-pill bad">Off</span>'),
                                    (hasLogin ? '<span class="warhub-pill good">Logged In</span>' : '<span class="warhub-pill neutral">No Login</span>'),
                                '</div>',
                                '<div class="warhub-summary-meta">Hits ' + esc(fmtNum(hits)) + ' • Gain ' + esc(fmtNum(gain)) + ' • Lost ' + esc(fmtNum(lost)) + ' • Taken ' + esc(fmtNum(taken)) + ' • Net ' + esc(fmtNum(net)) + '</div>',
                            '</div>',
                        '</details>'
                    ].join('');
                }).join('') : '<div class="warhub-sub">No data yet.</div>',
            '</div>'
        ].join('');
    }

    return [
        '<div class="warhub-grid">',
            '<div class="warhub-hero-card">',
                '<div class="warhub-title">Top 5</div>',
                '<div class="warhub-sub">Quick leader ranking view with profile, login, and activation status</div>',
            '</div>',

            renderQuickBox('Top Hitters', pickList(topFive.top_hitters, topFive.top_hitter)),
            renderQuickBox('Top Respect Gained', pickList(topFive.top_respect_gain, topFive.top_respect_gained)),
            renderQuickBox('Top Respect Lost', pickList(topFive.top_respect_lost, topFive.top_points_bleeder)),
            renderQuickBox('Top Hits Taken', pickList(topFive.top_hits_taken)),
            renderQuickBox('Top Net Impact', pickList(topFive.top_net_impact)),
            renderQuickBox('Recovering Soon', pickList(topFive.recovering_soon)),
        '</div>'
    ].join('');
}

function renderAdminTab() { var dash = analyticsCache || {}; var recent = arr(dash.recent_activity || dash.recent || []); var recentHtml = recent.length ? recent.map(function (row) { return [ '<div class="warhub-member-row">', '<div class="warhub-member-main">', '<div class="warhub-row"><span class="warhub-member-name">' + esc(String(row.title || row.kind || 'Activity')) + '</span></div>', '<div class="warhub-row"><span class="warhub-pill neutral">' + esc(fmtTs(row.created_at || row.at || '')) + '</span></div>', '</div>', row.text ? '<div class="warhub-spy-box">' + esc(String(row.text)) + '</div>' : '', '</div>' ].join(''); }).join('') : '<div class="warhub-empty">No recent activity.</div>'; return [ '<div class="warhub-grid">', '<div class="warhub-hero-card">', '<div class="warhub-title">Admin</div>', '<div class="warhub-sub">Owner-only overview and activity</div>', '</div>', '<div class="warhub-row">', '<span class="warhub-pill neutral">Factions: ' + esc(fmtNum(dash.total_factions || dash.faction_licenses_total || 0)) + '</span>', '<span class="warhub-pill neutral">Users: ' + esc(fmtNum(dash.users_using_script || dash.members_using_bot || 0)) + '</span>', '<span class="warhub-pill neutral">Leaders: ' + esc(fmtNum(dash.leaders_using_bot || 0)) + '</span>', '</div>', '<div class="warhub-card"><div class="warhub-sub">This free-access rebuild keeps owner-only admin access but removes paid-access management from the interface.</div></div>', '<div class="warhub-card warhub-col"><h3>Recent Activity</h3>' + recentHtml + '</div>', '</div>' ].join(''); } function handleActionClick(el) {
    return _handleActionClick.apply(this, arguments);
}

function _handleActionClick() {
    _handleActionClick = _asyncToGenerator(function* (el) {
        var action = el && el.getAttribute('data-action');
        if (!action) return;

        try {
            if (action === 'bounty-user') {
                var member = {
                    user_id: el.getAttribute('data-user-id') || '',
                    name: el.getAttribute('data-user-name') || ''
                };
                openBountyForMember(member);
                return;
            }

            if (action === 'member-availability-toggle') {
                var rowUserId = String(el.getAttribute('data-user-id') || '').trim();
                var myUserId = String(viewerUserId() || '').trim();
                if (!rowUserId || !myUserId || rowUserId !== myUserId) {
                    setStatus('You can only change your own availability. Everyone can see the status.', true);
                    return;
                }

                var currentlyAvailable = el.getAttribute('data-current') === '1';
                var nextAvailable = !currentlyAvailable;
                setStatus(nextAvailable ? 'Marking you available...' : 'Marking you unavailable...', false);

                var memberAvailRes = yield authedReq('POST', '/api/chain', { available: nextAvailable });
                if (!memberAvailRes.ok) {
                    setStatus((memberAvailRes.json && memberAvailRes.json.error) || 'Failed to update availability.', true);
                    return;
                }

                state = state || {};
                state.chain = Object.assign({}, state.chain || {}, memberAvailRes.json || {}, { available: nextAvailable });
                yield loadState();
                yield loadFactionMembers(true);
                membersLiveStamp = Date.now();
                renderBody();
                setStatus(nextAvailable ? 'Marked available.' : 'Marked unavailable.', false);
                return;
            }

            if (action === 'login') {
                yield doLogin();
                return;
            }

                if (action === 'logout') {
                doLogout();
                return;
            }

            if (action === 'members-refresh') {
                setStatus('Refreshing members...', false);
                yield loadFactionMembers(true);
                membersLiveStamp = Date.now();
                renderBody();
                setStatus('Members refreshed.', false);
                return;
            }

            if (action === 'faction-refresh') {
                setStatus('Refreshing faction...', false);
                yield loadFactionMembers(true);
                membersLiveStamp = Date.now();
                renderBody();
                setStatus('Faction refreshed.', false);
                return;
            }

            if (action === 'enemies-refresh') {
                setStatus('Refreshing enemies...', false);
                yield loadWarData(true);
                yield loadEnemies(true);
                renderBody();
                setStatus('Enemies refreshed.', false);
                return;
            }

            if (action === 'meddeals-save') {
                var medDealsEnemyEl = overlay && overlay.querySelector('#warhub-meddeals-enemy');
                var chosenEnemyUserId = cleanInputValue(medDealsEnemyEl && medDealsEnemyEl.value);
                var enemiesForMedDeals = sortMembers(arr((state && state.enemies) || warEnemiesCache || []));
                var chosenEnemy = enemiesForMedDeals.find(function (m) {
                    return String(getMemberId(m)) === String(chosenEnemyUserId);
                }) || {};

                if (!chosenEnemyUserId) {
                    setStatus('Select an enemy player first.', true);
                    return;
                }

                var saveMedDealsRes = yield authedReq('POST', '/api/meddeals', {
                    user_id: String((state && state.viewer && state.viewer.user_id) || ''),
                    user_name: String((state && state.viewer && state.viewer.name) || ''),
                    enemy_user_id: chosenEnemyUserId,
                    enemy_name: String(getMemberName(chosenEnemy) || chosenEnemyUserId)
                });

                if (!saveMedDealsRes.ok) {
                    setStatus((saveMedDealsRes.json && saveMedDealsRes.json.error) || 'Failed to save med deals.', true);
                    return;
                }

                state = state || {};
                state.med_deals = state.med_deals || {};
                state.med_deals.items = arr(saveMedDealsRes.json && saveMedDealsRes.json.items);
                state.med_deals.text = state.med_deals.items.map(function (row) {
                    return String((row.user_name || row.user_id || '') + ' → ' + (row.enemy_name || row.enemy_user_id || '')).trim();
                }).filter(Boolean).join('\n');
                renderBody();
                setStatus('Med deal saved.', false);
                return;
            }

            if (action === 'meddeals-clear') {
                var viewerIdForClear = String((state && state.viewer && state.viewer.user_id) || '').trim();
                var myDeal = arr((state && state.med_deals && state.med_deals.items) || []).find(function (row) {
                    return String((row && row.user_id) || '').trim() === viewerIdForClear;
                }) || {};
                var clearEnemyUserId = String((myDeal && myDeal.enemy_user_id) || '').trim();

                if (!clearEnemyUserId) {
                    state = state || {};
                    state.med_deals = state.med_deals || {};
                    state.med_deals.items = arr(state.med_deals.items).filter(function (row) {
                        return String((row && row.user_id) || '').trim() !== viewerIdForClear;
                    });
                    state.med_deals.text = state.med_deals.items.map(function (row) {
                        return String((row.user_name || row.user_id || '') + ' → ' + (row.enemy_name || row.enemy_user_id || '')).trim();
                    }).filter(Boolean).join('\n');
                    renderBody();
                    setStatus('No med deal to clear.', false);
                    return;
                }

                var clearMedDealsRes = yield authedReq('DELETE', '/api/meddeals/' + encodeURIComponent(clearEnemyUserId), null);
                if (!clearMedDealsRes.ok && clearMedDealsRes.status === 405) {
                    clearMedDealsRes = yield authedReq('POST', '/api/meddeals/' + encodeURIComponent(clearEnemyUserId), {});
                }

                if (!clearMedDealsRes.ok) {
                    setStatus((clearMedDealsRes.json && clearMedDealsRes.json.error) || 'Failed to clear med deals.', true);
                    return;
                }

                state = state || {};
                state.med_deals = state.med_deals || {};
                state.med_deals.items = arr(clearMedDealsRes.json && clearMedDealsRes.json.items);
                state.med_deals.text = state.med_deals.items.map(function (row) {
                    return String((row.user_name || row.user_id || '') + ' → ' + (row.enemy_name || row.enemy_user_id || '')).trim();
                }).filter(Boolean).join('\n');
                renderBody();
                setStatus('Med deal cleared.', false);
                return;
            }

            if (action === 'terms-summary-save') {
                var boxEl = overlay && overlay.querySelector('#warhub-terms-summary-text');
                var boxText = String((boxEl && boxEl.value) || '');

                var saveBoxRes = yield authedReq('POST', '/api/terms', {
                    text: boxText
                });

                if (!saveBoxRes.ok) {
                    setStatus((saveBoxRes.json && saveBoxRes.json.error) || 'Failed to save Terms / Summary.', true);
                    return;
                }

                state = state || {};
                state.terms_summary = state.terms_summary || {};
                state.terms_summary.text = boxText;
                renderBody();
                setStatus('Terms / Summary saved.', false);
                return;
            }

            if (action === 'terms-summary-clear') {
                var clearBoxRes = yield authedReq('POST', '/api/terms', {
                    text: ''
                });

                if (!clearBoxRes.ok) {
                    setStatus((clearBoxRes.json && clearBoxRes.json.error) || 'Failed to clear Terms / Summary.', true);
                    return;
                }

                state = state || {};
                state.terms_summary = state.terms_summary || {};
                state.terms_summary.text = '';
                renderBody();
                setStatus('Terms / Summary cleared.', false);
                return;
            }

            if (action === 'target-save') {
                var targetSelectEl = overlay && overlay.querySelector('#warhub-target-name');
                var targetNoteEl = overlay && overlay.querySelector('#warhub-target-note');

                var selectedUserId = cleanInputValue(targetSelectEl && targetSelectEl.value);
                if (!selectedUserId) {
                    setStatus('Select an enemy target first.', true);
                    return;
                }

                var enemies = arr((state && state.enemies) || []);
                var picked = enemies.find(function (m) {
                    return getMemberId(m) === selectedUserId;
                });

                if (!picked) {
                    setStatus('Selected enemy was not found in current war list.', true);
                    return;
                }

                var targetPayload = {
                    name: getMemberName(picked),
                    user_id: selectedUserId,
                    note: String((targetNoteEl && targetNoteEl.value) || '').trim()
                };

                var nextTargets = mergeTargets([targetPayload], mergeTargets((state && state.targets) || [], getLocalTargets()));
                state = state || {};
                state.targets = nextTargets.slice();
                setLocalTargets(nextTargets);
                renderBody();

                var targetRes = yield authedReq('POST', '/api/targets', targetPayload);
                if (!targetRes.ok) {
                    setStatus((targetRes.json && targetRes.json.error) || 'Failed to save target.', true);
                    return;
                }

                if (targetRes.json && Array.isArray(targetRes.json.items)) {
                    state.targets = mergeTargets(targetRes.json.items, state.targets || []);
                    setLocalTargets(state.targets);
                }

                renderBody();
                setStatus('Target saved.', false);
                return;
            }

            if (action === 'target-delete') {
                var deleteTargetUserId = cleanInputValue(el && el.getAttribute('data-user-id'));
                if (!deleteTargetUserId) {
                    setStatus('Missing target ID.', true);
                    return;
                }

                state = state || {};
                state.targets = mergeTargets(state.targets || [], getLocalTargets()).filter(function (t) {
                    return targetItemId(t) !== deleteTargetUserId;
                });
                setLocalTargets(state.targets);
                renderBody();

                var deleteTargetRes = yield authedReq('DELETE', '/api/targets/' + encodeURIComponent(deleteTargetUserId), null);
                if (!deleteTargetRes.ok && deleteTargetRes.status === 405) {
                    deleteTargetRes = yield authedReq('POST', '/api/targets/' + encodeURIComponent(deleteTargetUserId), {});
                }
                if (!deleteTargetRes.ok) {
                    yield loadState();
                    renderBody();
                    setStatus((deleteTargetRes.json && deleteTargetRes.json.error) || 'Failed to delete target.', true);
                    return;
                }

                if (deleteTargetRes.json && Array.isArray(deleteTargetRes.json.items)) {
                    state.targets = mergeTargets(deleteTargetRes.json.items, []);
                    setLocalTargets(state.targets);
                }
                renderBody();
                setStatus('Target deleted.', false);
                return;
            }

            if (action === 'activate-member') {
                var activateUserId = el.getAttribute('data-user-id');
                if (!activateUserId) return;

                var activateRes = yield authedReq('POST', '/api/faction/members/' + encodeURIComponent(activateUserId) + '/activate', {});
                if (!activateRes.ok) {
                    setStatus((activateRes.json && activateRes.json.error) || 'Failed to activate member.', true);
                    return;
                }

                yield loadFactionMembers(true);
                renderBody();
                setStatus('Member activated.', false);
                return;
            }

            if (action === 'remove-member') {
                var removeUserId = el.getAttribute('data-user-id');
                if (!removeUserId) return;

                var removeRes = yield authedReq('POST', '/api/faction/members/' + encodeURIComponent(removeUserId) + '/remove', {});
                if (!removeRes.ok) {
                    setStatus((removeRes.json && removeRes.json.error) || 'Failed to remove member.', true);
                    return;
                }

                yield loadFactionMembers(true);
                renderBody();
                setStatus('Member removed.', false);
                return;
            }

            if (action === 'hospital-dibs') {
                var dibEnemyId = String(el.getAttribute('data-user-id') || '').trim();
                if (!dibEnemyId) return;

                state = state || {};
                state.hospital = Object.assign({}, state.hospital || {});
                var viewerDibName = String(
                    (state.viewer && state.viewer.name) ||
                    (state.me && state.me.name) ||
                    ''
                ).trim();

                if (Array.isArray(state.hospital.items)) {
                    state.hospital.items = state.hospital.items.map(function (item) {
                        var row = item && typeof item === 'object' ? Object.assign({}, item) : {};
                        var rowId = String((row.enemy_user_id || row.user_id || row.id || '')).trim();
                        if (rowId === dibEnemyId) {
                            row.dibbed_by_name = viewerDibName || String(row.dibbed_by_name || '');
                            row.dibbed_by_user_id = String(
                                (state.viewer && state.viewer.user_id) ||
                                (state.me && state.me.user_id) ||
                                row.dibbed_by_user_id ||
                                ''
                            ).trim();
                            row.dibs_available = false;
                            row.dibs_locked = false;
                        }
                        return row;
                    });
                }

                renderBody();
                setStatus('Claiming dibs...', false);

                var dibRes = yield authedReq('POST', '/api/hospital/dibs/' + encodeURIComponent(dibEnemyId), {});
                if (!dibRes.ok) {
                    yield loadHospital(true);
                    renderBody();
                    setStatus((dibRes.json && dibRes.json.error) || 'Failed to claim dibs.', true);
                    return;
                }

                if (dibRes.json && Array.isArray(dibRes.json.hospital_items)) {
                    state.hospital.items = dibRes.json.hospital_items.slice();
                    state.hospital.count = Number(dibRes.json.hospital_count || state.hospital.items.length || 0);
                } else {
                    yield loadHospital(true);
                }

                if (dibRes.json && Array.isArray(dibRes.json.overview_items)) {
                    state.hospital.overview_items = dibRes.json.overview_items.slice();
                    state.hospital.overview_count = Number(dibRes.json.overview_count || state.hospital.overview_items.length || 0);
                }

                renderBody();
                setStatus('Dibs claimed.', false);
                return;
            }

            if (action === 'chain-available') {
                var chainAvailableRes = yield authedReq('POST', '/api/chain', { available: true });
                if (!chainAvailableRes.ok) {
                    setStatus((chainAvailableRes.json && chainAvailableRes.json.error) || 'Failed to update chain.', true);
                    return;
                }

                state = state || {};
                state.chain = Object.assign({}, state.chain || {}, chainAvailableRes.json || {}, { available: true });
                renderBody();
                setStatus('Chain marked available.', false);
                return;
            }

            if (action === 'chain-unavailable') {
                var chainUnavailableRes = yield authedReq('POST', '/api/chain', { available: false });
                if (!chainUnavailableRes.ok) {
                    setStatus((chainUnavailableRes.json && chainUnavailableRes.json.error) || 'Failed to update chain.', true);
                    return;
                }

                state = state || {};
                state.chain = Object.assign({}, state.chain || {}, chainUnavailableRes.json || {}, { available: false });
                renderBody();
                setStatus('Chain marked unavailable.', false);
                return;
            }

            if (action === 'chain-toggle-sitter') {
                var current = !!(state && state.chain && state.chain.sitter_enabled);
                var chainSitterRes = yield authedReq('POST', '/api/chain', { sitter_enabled: !current });
                if (!chainSitterRes.ok) {
                    setStatus((chainSitterRes.json && chainSitterRes.json.error) || 'Failed to update chain sitter.', true);
                    return;
                }

                state = state || {};
                state.chain = Object.assign({}, state.chain || {}, chainSitterRes.json || {}, { sitter_enabled: !current });
                renderBody();
                setStatus('Chain sitter updated.', false);
                return;
            }
        } catch (err) {
            console.error('War and Chain action error:', action, err);
            setStatus('Action failed: ' + action, true);
        }
    });

    return _handleActionClick.apply(this, arguments);
}
    // ============================================================
    // 23. MAIN RENDER / INPUT BINDINGS
    // ============================================================

    function renderTabsRow(rowId, rows) {
        var host = overlay && overlay.querySelector('#' + rowId);
        if (!host) return;

        host.innerHTML = getVisibleTabs(rows).map(function (pair) {
            var key = pair[0];
            var label = pair[1];
            var active = key === currentTab ? ' active' : '';
            return '<button type="button" class="warhub-tab' + active + '" data-tab="' + esc(key) + '">' + esc(label) + '</button>';
        }).join('');
    }

    function renderCurrentTab() {
        if (!isLoggedIn()) return renderLoginView();

        if (currentTab === 'overview') return renderOverviewTab();
        if (currentTab === 'members') return renderMembersTab();
        if (currentTab === 'enemies') return renderEnemiesTab();
        if (currentTab === 'hospital') return renderHospitalTab();
        if (currentTab === 'chain') return renderChainTab();
        if (currentTab === 'targets') return renderTargetsTab();
        if (currentTab === 'meddeals') return renderMedDealsTab();
        if (currentTab === 'terms') return renderTermsTab();
        if (currentTab === 'faction') return canManageFaction() ? renderFactionTab() : '<div class="warhub-card">Faction tab is leader only.</div>';
        if (currentTab === 'settings') return renderSettingsTab();
        if (currentTab === 'instructions') return renderInstructionsTab();
        if (currentTab === 'admin') return canSeeAdmin() ? renderAdminTab() : '<div class="warhub-card">Admin only.</div>';

        return renderOverviewTab();
    }

    function renderBody() {
        if (!overlay) return;

        renderTabsRow('warhub-tabs-row-1', TAB_ROW_1);
        renderTabsRow('warhub-tabs-row-2', TAB_ROW_2);

        var content = overlay.querySelector('#warhub-content');
        if (content) {
            content.innerHTML = renderCurrentTab();
        }

        renderStatus();

        if (currentTab === 'overview' || currentTab === 'members' || currentTab === 'enemies' || currentTab === 'hospital' || currentTab === 'faction') {
            startMembersCountdownLoop();
        } else {
            stopMembersCountdownLoop();
        }

        var body = overlay.querySelector('#warhub-body');
        if (body) {
            var scrollTop = Number(GM_getValue(K_OVERLAY_SCROLL, 0) || 0);
            if (Number.isFinite(scrollTop) && scrollTop > 0) {
                body.scrollTop = scrollTop;
            }

            if (!body.__warhubScrollBound) {
                body.__warhubScrollBound = true;
                body.addEventListener('scroll', function () {
                    GM_setValue(K_OVERLAY_SCROLL, body.scrollTop || 0);
                }, { passive: true });
            }
        }
    }

        function renderLiveTabOnly() {
        if (!overlay) return;

        var content = overlay.querySelector('#warhub-content');
        if (content) {
            content.innerHTML = renderCurrentTab();
        }

        renderStatus();

        if (currentTab === 'overview' || currentTab === 'members' || currentTab === 'enemies' || currentTab === 'hospital' || currentTab === 'faction') {
            startMembersCountdownLoop();
        } else {
            stopMembersCountdownLoop();
        }

        bindDynamicInputs();
    }

    function bindDynamicInputs() {
        if (!overlay) return;

        var membersSearch = overlay.querySelector('#warhub-members-search');
        if (membersSearch && !membersSearch.__warhubBound) {
            membersSearch.__warhubBound = true;
            membersSearch.addEventListener('input', function () {
                GM_setValue('warhub_members_search', String(membersSearch.value || ''));
            });
        }

        var enemiesSearch = overlay.querySelector('#warhub-enemies-search');
        if (enemiesSearch && !enemiesSearch.__warhubBound) {
            enemiesSearch.__warhubBound = true;
            enemiesSearch.addEventListener('input', function () {
                GM_setValue('warhub_enemies_search', String(enemiesSearch.value || ''));
                if (currentTab === 'members' || currentTab === 'enemies') renderBody();
            });
        }

        var factionSearch = overlay.querySelector('#warhub-faction-search');
        if (factionSearch && !factionSearch.__warhubBound) {
            factionSearch.__warhubBound = true;
            factionSearch.addEventListener('input', function () {
                GM_setValue('warhub_faction_search', String(factionSearch.value || ''));
                if (currentTab === 'faction') renderBody();
            });
        }
    }

    var _renderBodyOriginal = renderBody;
    renderBody = function () {
        _renderBodyOriginal();
        bindDynamicInputs();
    };

    // ============================================================
    // 24. REMOUNT / BOOT
    // ============================================================

    function ensureMounted() {
        if (!document.body) {
            setTimeout(ensureMounted, 250);
            return;
        }

        var hasShield = !!document.getElementById('warhub-shield');
        var hasOverlay = !!document.getElementById('warhub-overlay');

        if (!hasShield || !hasOverlay || !shield || !overlay) {
            mounted = false;
            shield = null;
            badge = null;
            overlay = null;
            mount();
        }
    }

    function startRemountWatch() {
        if (remountTimer) {
            clearInterval(remountTimer);
            remountTimer = null;
        }

        remountTimer = setInterval(function () {
            try {
                if (!document.body) return;

                if (!document.getElementById('warhub-shield') || !document.getElementById('warhub-overlay')) {
                    mounted = false;
                    shield = null;
                    badge = null;
                    overlay = null;
                    ensureMounted();
                    renderBody();
                } else {
                    applyShieldPos();
                    positionBadge();
                }
            } catch (err) {
                console.error('War and Chain remount watch error:', err);
            }
        }, 2000);
    }

    function boot() {
        if (!document.body) {
            setTimeout(boot, 250);
            return;
        }

        ensureMounted();
        restartPolling();
        startRemountWatch();
        try { setTimeout(autoFillBountyPageFromWarHub, 500); } catch (_e_fill) {}

        if (isLoggedIn()) {
            loadState().then(function () {
                renderBody();
            }).catch(function (err) {
                console.error('War and Chain initial load error:', err);
                renderBody();
            });
        } else {
            renderBody();
        }
    }

    function startWarHubBoot() {
        try { boot(); } catch (err) {
            console.error('War and Chain boot error:', err);
            setTimeout(function () { try { ensureMounted(); renderBody(); } catch (_e) {} }, 500);
        }
        setTimeout(function () { try { ensureMounted(); } catch (_e) {} }, 1000);
        setTimeout(function () { try { ensureMounted(); } catch (_e) {} }, 2500);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startWarHubBoot, { once: true });
        setTimeout(startWarHubBoot, 1000);
    } else {
        startWarHubBoot();
    }

})();
