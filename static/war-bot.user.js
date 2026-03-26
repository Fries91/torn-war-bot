// ==UserScript==
// @name         War Hub ⚔️
// @namespace    fries91-war-hub
// @version      3.2.4
// @description  War Hub by Fries91. Faction-license aware overlay with draggable icon, PDA friendly, shared war tools, faction member management, and payment lock handling.
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
// @connect      torn-war-bot.onrender.com
// ==/UserScript==

(function () {
    'use strict';


    if (window.__WAR_HUB_V287__ && document.getElementById('warhub-shield')) return;
    window.__WAR_HUB_V287__ = true;

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
    var K_SHIELD_POS = 'warhub_shield_pos_v3';
    GM_deleteValue(K_SHIELD_POS);
    var K_OVERLAY_POS = 'warhub_overlay_pos_v3';
    var K_REFRESH = 'warhub_refresh_ms_v3';
    var K_LOCAL_NOTIFICATIONS = 'warhub_local_notifications_v3';
    var K_ACCESS_CACHE = 'warhub_access_cache_v3';
    var K_OVERVIEW_BOXES = 'warhub_overview_boxes_v3';
    var K_OVERLAY_SCROLL = 'warhub_overlay_scroll_v3';

    
    // ============================================================
    // 02. PAYMENT / OWNER CONFIG
    // ============================================================

    var PAYMENT_PLAYER = 'Fries91';
    var OWNER_NAME = 'Fries91';
    var OWNER_USER_ID = '3679030';
    var PRICE_PER_MEMBER = 3;

    // ============================================================
    // 03. TAB ORDER
    // ============================================================

    var TAB_ROW_1 = [
        ['overview', 'Overview'],
        ['members', 'Members'],
        ['enemies', 'Enemies'],
        ['hospital', 'Hospital'],
        ['chain', 'Chain'],
        ['targets', 'Targets']
    ];

    var TAB_ROW_2 = [
        ['meddeals', 'Med Deals'],
        ['terms', 'Terms'],
        ['summary', 'Summary'],
        ['faction', 'Faction'],
        ['settings', 'Settings'],
        ['instructions', 'Help'],
        ['wartop5', 'Top 5'],
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

    var pollTimer = null;
    var remountTimer = null;
    var loadInFlight = false;

    var membersCountdownTimer = null;
    var membersLiveStamp = 0;

    var lastStatusMsg = '';
    var lastStatusErr = false;

    var accessState = normalizeAccessCache(GM_getValue(K_ACCESS_CACHE, null));

    // ============================================================
    // 05. STYLES
    // ============================================================

    var css = "\n\
#warhub-shield {\n\
  position: fixed !important;\n\
  z-index: 2147483647 !important;\n\
  width: 42px !important;\n\
  height: 42px !important;\n\
  border-radius: 12px !important;\n\
  display: flex !important;\n\
  align-items: center !important;\n\
  justify-content: center !important;\n\
  font-size: 21px !important;\n\
  line-height: 1 !important;\n\
  cursor: pointer !important;\n\
  user-select: none !important;\n\
  -webkit-user-select: none !important;\n\
  -webkit-touch-callout: none !important;\n\
  -webkit-tap-highlight-color: transparent !important;\n\
  touch-action: manipulation !important;\n\
  box-shadow: 0 8px 24px rgba(0,0,0,.45) !important;\n\
  border: 1px solid rgba(255,255,255,.10) !important;\n\
  background: radial-gradient(circle at 30% 20%, rgba(220,75,75,.98), rgba(110,12,12,.98) 55%, rgba(48,6,6,.98)) !important;\n\
  color: #fff !important;\n\
  left: auto !important;\n\
  right: 12px !important;\n\
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
\n\
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
.warhub-btn.warn { background: linear-gradient(180deg, rgba(226,154,27,.98), rgba(163,102,8,.98)) !important; }\n\
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
        if (!overlay || currentTab !== 'members') return;
        if (!membersLiveStamp) return;

        var elapsed = Math.floor((Date.now() - membersLiveStamp) / 1000);
        var rows = overlay.querySelectorAll('.warhub-member-row');

        rows.forEach(function (row) {
            var medEl = row.querySelector('[data-medcd]');
            var statusEl = row.querySelector('[data-statuscd]');

            if (medEl) {
                var baseMed = Number(row.getAttribute('data-medcd-base') || 0);
                var liveMed = Math.max(0, baseMed - elapsed);
                medEl.textContent = liveMed > 0 ? formatCountdown(liveMed) : 'Ready';
            }

            if (statusEl) {
                var baseStatus = Number(row.getAttribute('data-statuscd-base') || 0);
                var stateName = String(row.getAttribute('data-state-name') || '').toLowerCase();
                var liveStatus = Math.max(0, baseStatus - elapsed);

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
        });
    }

    function startMembersCountdownLoop() {
        stopMembersCountdownLoop();
        if (currentTab !== 'members') return;

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

    function normalizeAccessCache(v) {
        if (!v || typeof v !== 'object') {
            return {
                status: 'logged_out',
                message: 'Not logged in.',
                can_use_features: false,
                is_faction_leader: false,
                is_admin: false,
                is_user_exempt: false,
                is_faction_exempt: false,
                member_enabled: false,
                payment_required: false,
                trial_active: false,
                expired: false,
                blocked: false
            };
        }

        return {
            status: String(v.status || 'unknown'),
            message: String(v.message || ''),
            can_use_features: !!v.can_use_features,
            is_faction_leader: !!v.is_faction_leader,
            is_admin: !!v.is_admin,
            is_user_exempt: !!v.is_user_exempt,
            is_faction_exempt: !!v.is_faction_exempt,
            member_enabled: !!v.member_enabled,
            payment_required: !!v.payment_required,
            trial_active: !!v.trial_active,
            expired: !!v.expired,
            blocked: !!v.blocked
        };
    }

    function setAccessCache(v) {
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
        if (key === 'faction') return canManageFaction();
        if (key === 'summary') return canSeeSummary();
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

function applyShieldPos() {
    if (!shield) return;

    shield.style.left = 'auto';
    shield.style.right = '12px';
    shield.style.top = '50%';
    shield.style.bottom = 'auto';
    shield.style.transform = 'translateY(-50%)';

    positionBadge();
}

    function applyOverlayPos() {
        if (!overlay) return;

        var vp = getViewport();
        var width = Math.min(520, vp.w - 12);
        var left = Math.max(6, Math.round((vp.w - width) / 2));

        overlay.style.left = left + 'px';
        overlay.style.right = 'auto';
        overlay.style.top = '6px';
        overlay.style.bottom = '6px';
        overlay.style.width = width + 'px';
        overlay.style.maxWidth = '520px';
    }

    function positionBadge() {
        if (!badge || !shield) return;

        var rect = shield.getBoundingClientRect();
        badge.style.left = Math.round(rect.right - 6) + 'px';
        badge.style.top = Math.round(rect.top - 6) + 'px';
    }

function makeHoldDraggable(handle, target, key) {
    return {
        didMove: function () { return false; },
        isDragging: function () { return false; }
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
            var key = cleanInputValue(input && input.value);
            var ownerToken = cleanInputValue(ownerInput && ownerInput.value);

            if (!key) {
                setStatus('Enter your Torn API key.', true);
                return;
            }

            GM_setValue(K_API_KEY, key);
            if (ownerToken) GM_setValue(K_OWNER_TOKEN, ownerToken);

            setStatus('Logging in...', false);

            var res = yield req('POST', '/api/auth', {
                api_key: key
            });

            if (!res.ok || !res.json || !res.json.token) {
                setStatus((res.json && res.json.error) || 'Login failed.', true);
                return;
            }

            GM_setValue(K_SESSION, String(res.json.token));

            if (res.json.viewer && res.json.viewer.name) {
                pushLocalNotification('info', 'Logged in as ' + res.json.viewer.name);
            } else {
                pushLocalNotification('info', 'Logged in.');
            }

            yield loadState();
            renderBody();
            restartPolling();
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

        currentFactionMembers = arr(state.members);
        factionMembersCache = currentFactionMembers.slice();
        state.members = factionMembersCache.slice();

        if (state.war && typeof state.war === 'object') {
            warEnemiesFactionId = String(state.war.enemy_faction_id || '');
            warEnemiesFactionName = String(state.war.enemy_faction_name || '');
        } else {
            warEnemiesFactionId = '';
            warEnemiesFactionName = '';
            state.war = {};
        }

        if (Array.isArray(state.enemies)) {
            warEnemiesCache = state.enemies.slice();
            warEnemiesLoadedAt = Date.now();
        } else {
            warEnemiesCache = [];
            state.enemies = [];
        }

        if (!Array.isArray(state.targets)) {
            state.targets = [];
        }

        if (!state.faction || typeof state.faction !== 'object') {
            state.faction = {};
        }

        membersLiveStamp = Date.now();
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
        if (!force && factionMembersCache && factionMembersCache.length) return factionMembersCache;

        var res = yield authedReq('GET', '/api/state');
        if (!res.ok || !res.json) return factionMembersCache || [];

        state = (res.json && typeof res.json === 'object') ? res.json : {};
        currentFactionMembers = arr(state.members);
        factionMembersCache = currentFactionMembers.slice();
        state.members = factionMembersCache.slice();
        membersLiveStamp = Date.now();

        return factionMembersCache;
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

function _loadEnemies() {
    _loadEnemies = _asyncToGenerator(function* (force) {
        if (!isLoggedIn()) return [];

        if (!force && state && Array.isArray(state.enemies) && state.enemies.length && (Date.now() - warEnemiesLoadedAt) < 15000) {
            warEnemiesCache = state.enemies.slice();
            return state.enemies.slice();
        }

        var res = yield authedReq('GET', '/api/enemies');
        if (!res.ok || !res.json) return arr((state && state.enemies) || warEnemiesCache || []);

        var payload = res.json || {};
        var war = (payload.war && typeof payload.war === 'object') ? payload.war : {};

        var ownFactionId = String(
            (state && state.faction && (state.faction.faction_id || state.faction.id)) ||
            (state && state.viewer && state.viewer.faction_id) ||
            (state && state.me && state.me.faction_id) ||
            (state && state.license && state.license.faction_id) ||
            war.my_faction_id ||
            ''
        ).trim();

        var ownFactionName = String(
            (state && state.faction && (state.faction.faction_name || state.faction.name)) ||
            (state && state.viewer && state.viewer.faction_name) ||
            (state && state.me && state.me.faction_name) ||
            (state && state.license && state.license.faction_name) ||
            war.my_faction_name ||
            ''
        ).trim().toLowerCase();

        var rawEnemyFactionId = String(
            payload.faction_id ||
            war.enemy_faction_id ||
            ''
        ).trim();

        var rawEnemyFactionName = String(
            payload.faction_name ||
            war.enemy_faction_name ||
            ''
        ).trim();

        var apiEnemies = arr(payload.items || payload.enemies || []);
        var enemies = apiEnemies.filter(function (m) {
            var memberFactionId = String(
                (m && (m.faction_id || m.source_faction_id || m.enemy_faction_id)) || ''
            ).trim();

            var memberFactionName = String(
                (m && (m.faction_name || m.source_faction_name || m.enemy_faction_name)) || ''
            ).trim().toLowerCase();

            if (ownFactionId && memberFactionId && memberFactionId === ownFactionId) return false;
            if (ownFactionName && memberFactionName && memberFactionName === ownFactionName) return false;
            return true;
        });

        var enemyFactionId = rawEnemyFactionId;
        var enemyFactionName = rawEnemyFactionName;

        if (
            !enemyFactionId ||
            (ownFactionId && enemyFactionId === ownFactionId) ||
            (enemyFactionName && ownFactionName && enemyFactionName.trim().toLowerCase() === ownFactionName)
        ) {
            enemyFactionId = '';
            enemyFactionName = '';
            enemies = [];
        }

        warEnemiesCache = enemies.slice();
        warEnemiesFactionId = enemyFactionId;
        warEnemiesFactionName = enemyFactionName;
        warEnemiesLoadedAt = Date.now();

        state = state || {};
        state.enemies = enemies.slice();
        state.war = Object.assign({}, state.war || {}, war, {
            enemy_faction_id: warEnemiesFactionId,
            enemy_faction_name: warEnemiesFactionName
        });

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

    function loadFactionPaymentData(force) {
        return _loadFactionPaymentData.apply(this, arguments);
    }

    function _loadFactionPaymentData() {
        _loadFactionPaymentData = _asyncToGenerator(function* (force) {
            if (!isLoggedIn()) return null;
            if (!canManageFaction()) return null;

            if (!force && state && state.license) return state.license;

            var res = yield authedReq('GET', '/api/state');
            if (!res.ok || !res.json) return (state && state.license) || null;

            state = res.json;
            return state.license || null;
        });

        return _loadFactionPaymentData.apply(this, arguments);
    }

    function refreshFactionPaymentData() {
        return _refreshFactionPaymentData.apply(this, arguments);
    }

    function _refreshFactionPaymentData() {
        _refreshFactionPaymentData = _asyncToGenerator(function* () {
            return yield loadFactionPaymentData(true);
        });

        return _refreshFactionPaymentData.apply(this, arguments);
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
            || tab === 'summary';
    }

    function getTabPollMs(tab) {
        if (tab === 'hospital') return 6000;
        if (tab === 'enemies') return 7000;
        if (tab === 'members') return 10000;
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

                if (currentTab === 'summary') {
                    yield refreshSummaryLive();
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
            } catch (err) {
                console.error('War Hub tab tick error:', err);
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

        if (loadInFlight) return;

        loadInFlight = true;
        try {
            if (currentTab === 'members') {
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
                yield loadState();
            } else if (currentTab === 'summary') {
                yield loadLiveSummary(true);
            } else if (currentTab === 'faction') {
                if (canManageFaction()) {
                    yield loadFactionMembers(true);
                    yield refreshFactionPaymentData();
                }
            } else if (currentTab === 'admin') {
                if (canSeeAdmin()) {
                    yield loadAdminDashboard(true);
                    yield loadAdminTopFive(true);
                }
            } else if (currentTab === 'overview') {
                yield refreshOverviewLive();
            }
        } catch (err) {
            console.error('War Hub tab load error:', err);
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

        shield = document.createElement('div');
        shield.id = 'warhub-shield';
        shield.textContent = '⚔️';
        shield.setAttribute('aria-label', 'Open War Hub');
        shield.setAttribute('title', 'War Hub');

        badge = document.createElement('div');
        badge.id = 'warhub-badge';
        
        overlay = document.createElement('div');
        overlay.id = 'warhub-overlay';
        overlay.innerHTML = [
            '<div class="warhub-head" id="warhub-head">',
                '<div class="warhub-toprow">',
                    '<div>',
                        '<div class="warhub-title">War Hub ⚔️</div>',
                        '<div class="warhub-sub">Faction tools, payments, access, and war data</div>',
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
        });

        overlay.addEventListener('input', function (e) {
            var t = e.target;

            if (t && t.id === 'warhub-api-key') {
                GM_setValue(K_API_KEY, cleanInputValue(t.value));
            }
            if (t && t.id === 'warhub-owner-token') {
                GM_setValue(K_OWNER_TOKEN, cleanInputValue(t.value));
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
            (member && (member.name || member.player_name || member.username)) ||
            'Unknown'
        );
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
        var raw = String(
            (member && (
                member.state ||
                member.presence ||
                member.status ||
                member.status_state ||
                member.online_state
            )) || ''
        ).toLowerCase();

        if (raw.indexOf('hospital') >= 0) return 'hospital';
        if (raw.indexOf('jail') >= 0) return 'jail';
        if (raw.indexOf('travel') >= 0) return 'travel';
        if (raw.indexOf('idle') >= 0) return 'idle';
        if (raw.indexOf('online') >= 0) return 'online';
        if (raw.indexOf('offline') >= 0) return 'offline';

        var detail = String(
            (member && (member.status_detail || member.detail || member.description)) || ''
        ).toLowerCase();

        if (detail.indexOf('hospital') >= 0) return 'hospital';
        if (detail.indexOf('jail') >= 0) return 'jail';
        if (detail.indexOf('travel') >= 0 || detail.indexOf('abroad') >= 0) return 'travel';

        var until = Number(
            (member && (
                member.status_until ||
                member.until ||
                member.hospital_until ||
                member.jail_until ||
                member.travel_until
            )) || 0
        );

        var nowSec = Math.floor(Date.now() / 1000);
        if (until > nowSec) {
            if (detail.indexOf('hospital') >= 0) return 'hospital';
            if (detail.indexOf('jail') >= 0) return 'jail';
            if (detail.indexOf('travel') >= 0) return 'travel';
        }

        var online = member && (member.online === true || member.is_online === true);
        if (online) return 'online';

        var lastAction = String(
            (member && (member.last_action || member.lastAction || '')) || ''
        ).toLowerCase();

        if (lastAction.indexOf('idle') >= 0) return 'idle';
        if (lastAction.indexOf('online') >= 0) return 'online';

        return 'offline';
    }

    function stateCountdown(member) {
        var nowSec = Math.floor(Date.now() / 1000);

        var until = Number(
            (member && (
                member.status_until ||
                member.until ||
                member.hospital_until ||
                member.jail_until ||
                member.travel_until
            )) || 0
        );

        if (!Number.isFinite(until) || until <= nowSec) return 0;
        return Math.max(0, until - nowSec);
    }

    function energyValue(member) {
        var v = Number(member && (member.energy_current || member.energy || member.energ));
        return Number.isFinite(v) ? v : null;
    }

    function lifeValue(member) {
        var cur = Number(member && (member.life_current || member.life || member.hp));
        var max = Number(member && (member.life_max || member.max_life || member.hp_max));

        if (Number.isFinite(cur) && Number.isFinite(max) && max > 0) {
            return cur + '/' + max;
        }
        if (Number.isFinite(cur)) return String(cur);
        return '—';
    }

    function medCooldownValue(member) {
        var v = Number(member && (
            member.med_cd ||
            member.med_cooldown ||
            member.medical_cooldown ||
            member.drug_cd
        ));
        if (!Number.isFinite(v) || v <= 0) return 'Ready';
        return shortCd(v, 'Ready');
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
        return id ? ('https://www.torn.com/bounties.php?p=add&userID=' + encodeURIComponent(id)) : '#';
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

        return [
            '<div class="warhub-member-row" ' +
                'data-medcd-base="' + esc(String(Number(member && (member.med_cd || member.med_cooldown || member.medical_cooldown || 0)) || 0)) + '" ' +
                'data-statuscd-base="' + esc(String(stateCd)) + '" ' +
                'data-state-name="' + esc(st) + '">',
                '<div class="warhub-member-main">',
                    '<div class="warhub-row">',
                        '<a class="warhub-member-name" href="' + esc(profileUrl(member)) + '" target="_blank" rel="noopener noreferrer">' + esc(name) + '</a>',
                        '<span class="warhub-pill ' + esc(st) + '" data-statuscd>' + esc(
                            st === 'hospital' ? (stateCd > 0 ? 'Hospital (' + shortCd(stateCd, 'Hospital') + ')' : 'Hospital') :
                            st === 'jail' ? (stateCd > 0 ? 'Jail (' + shortCd(stateCd, 'Jail') + ')' : 'Jail') :
                            st === 'travel' ? (stateCd > 0 ? 'Travel (' + shortCd(stateCd, 'Travel') + ')' : 'Travel') :
                            humanStateLabel(st)
                        ) + '</span>',
                    '</div>',
                    '<div class="warhub-row">',
                        '<a class="warhub-btn ghost" href="' + esc(bountyUrl(member)) + '" target="_blank" rel="noopener noreferrer">Bounty</a>',
                    '</div>',
                '</div>',
                '<div class="warhub-statline">',
                    '<span>⚡ ' + esc(energy == null ? '—' : String(energy)) + '</span>',
                    '<span>✚ ' + esc(life) + '</span>',
                    '<span>💊 <span data-medcd>' + esc(med) + '</span></span>',
                '</div>',
            '</div>'
        ].join('');
    }

function renderEnemyRow(member) {
    var id = getMemberId(member);
    var name = getMemberName(member);
    var st = stateLabel(member);
    var spy = spyText(member);

    if (state && state.members && arr(state.members).length) {
        var ownIds = {};
        arr(state.members).forEach(function (m) {
            var ownId = String((m && (m.user_id || m.id)) || '').trim();
            if (ownId) ownIds[ownId] = true;
        });

        if (id && ownIds[String(id)]) {
            return '';
        }
    }

    return [
        '<div class="warhub-member-row">',
            '<div class="warhub-member-main">',
                '<div class="warhub-row">',
                    '<a class="warhub-member-name" href="' + esc(profileUrl(member)) + '" target="_blank" rel="noopener noreferrer">' + esc(name) + '</a>',
                    id ? '<span class="warhub-pill neutral">#' + esc(id) + '</span>' : '',
                    '<span class="warhub-pill ' + esc(st) + '">' + esc(humanStateLabel(st)) + '</span>',
                '</div>',
                '<div class="warhub-row">',
                    '<a class="warhub-btn" href="' + esc(attackUrl(member)) + '" target="_blank" rel="noopener noreferrer">Attack</a>',
                '</div>',
            '</div>',
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
                    '<div class="warhub-sub">Use your Torn API key to connect to War Hub.</div>',
                '</div>',
                '<div class="warhub-card warhub-col">',
                    '<label class="warhub-label" for="warhub-api-key">Torn API Key</label>',
                    '<input id="warhub-api-key" class="warhub-input" type="password" value="' + esc(getApiKey()) + '" placeholder="Enter API key" />',
                    '<label class="warhub-label" for="warhub-owner-token">Owner/Admin Token (optional)</label>',
                    '<input id="warhub-owner-token" class="warhub-input" type="password" value="' + esc(getOwnerToken()) + '" placeholder="Owner/admin token" />',
                    '<div class="warhub-row">',
                        '<button type="button" class="warhub-btn" data-action="login">Login</button>',
                    '</div>',
                '</div>',
                '<div class="warhub-card">',
                    '<div class="warhub-kv"><div>Status</div><div>Logged out</div></div>',
                    '<div class="warhub-kv"><div>Payment player</div><div>' + esc(PAYMENT_PLAYER) + '</div></div>',
                    '<div class="warhub-kv"><div>Price per member</div><div>' + esc(String(PRICE_PER_MEMBER)) + ' Xanax</div></div>',
                '</div>',
            '</div>'
        ].join('');
    }

function renderOverviewTab() {
    var war = (state && state.war) || {};
    var license = (state && state.license) || {};
    var ownFaction = (state && state.faction) || {};

    var ownName = String(
        ownFaction.name ||
        war.our_faction_name ||
        war.faction_name ||
        license.faction_name ||
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

    var termsText = String((state && state.terms_summary && state.terms_summary.text) || '');
    var medDealsText = String((state && state.med_deals && state.med_deals.text) || '');
    var dibsText = String((state && state.dibs && state.dibs.text) || '');

    return [
        '<div class="warhub-grid">',
            '<div class="warhub-overview-hero warhub-hero-card">',
                '<div class="warhub-title">Overview</div>',
                '<div class="warhub-sub">Current war and faction access summary</div>',

                '<div class="warhub-war-head">',
                    '<div class="warhub-war-side">',
                        '<div class="warhub-war-side-label">Our Faction</div>',
                        '<div class="warhub-war-side-name">' + esc(ownName) + '</div>',
                    '</div>',
                    '<div class="warhub-war-vs">VS</div>',
                    '<div class="warhub-war-side right">',
                        '<div class="warhub-war-side-label">Enemy Faction</div>',
                        '<div class="warhub-war-side-name">' + esc(enemyName) + '</div>',
                    '</div>',
                '</div>',
            '</div>',

            '<div class="warhub-overview-stats">',
                '<div class="warhub-stat-card good">',
                    '<div class="warhub-stat-label">Our Score</div>',
                    '<div class="warhub-stat-value">' + esc(String(scoreUs)) + '</div>',
                '</div>',
                '<div class="warhub-stat-card bad">',
                    '<div class="warhub-stat-label">Enemy Score</div>',
                    '<div class="warhub-stat-value">' + esc(String(scoreThem)) + '</div>',
                '</div>',
                '<div class="warhub-stat-card">',
                    '<div class="warhub-stat-label">Our Chain</div>',
                    '<div class="warhub-stat-value">' + esc(String(chainUs)) + '</div>',
                '</div>',
                '<div class="warhub-stat-card">',
                    '<div class="warhub-stat-label">Enemy Chain</div>',
                    '<div class="warhub-stat-value">' + esc(String(chainThem)) + '</div>',
                '</div>',
            '</div>',

            '<div class="warhub-mini-grid">',
                '<div class="warhub-card warhub-overview-link-card terms">',
                    '<div class="warhub-row" style="justify-content:space-between;">',
                        '<h3>📜 Terms / Summary</h3>',
                    '</div>',
                    '<div class="warhub-spy-box">' + esc(termsText || 'No terms / summary added yet.') + '</div>',
                '</div>',

                '<div class="warhub-card warhub-overview-link-card meddeals">',
                    '<div class="warhub-row" style="justify-content:space-between;">',
                        '<h3>🤝 Med Deals</h3>',
                    '</div>',
                    '<div class="warhub-spy-box">' + esc(medDealsText || 'No med deals posted yet.') + '</div>',
                '</div>',

                '<div class="warhub-card warhub-overview-link-card dibs">',
                    '<div class="warhub-row" style="justify-content:space-between;">',
                        '<h3>🎯 Dibs</h3>',
                    '</div>',
                    '<div class="warhub-spy-box">' + esc(dibsText || 'No dibs posted yet.') + '</div>',
                '</div>',
            '</div>',
        '</div>'
    ].join('');
}
    function renderMembersTab() {
        var members = arr((state && state.members) || []);
        var search = String(GM_getValue('warhub_members_search', '') || '').trim().toLowerCase();

        var filtered = members.filter(function (m) {
            if (!search) return true;
            return memberSearchText(m).indexOf(search) >= 0;
        });

        var grouped = groupMembers(filtered);

        return [
            '<div class="warhub-grid">',
                '<div class="warhub-hero-card">',
                    '<div class="warhub-title">Members</div>',
                    '<div class="warhub-sub">Your faction only</div>',
                '</div>',

                '<div class="warhub-card">',
                    '<div class="warhub-row">',
                        '<input id="warhub-members-search" class="warhub-input" type="text" value="' + esc(search) + '" placeholder="Search member name, ID, status or position" />',
                        '<button type="button" class="warhub-btn ghost" data-action="members-refresh">Refresh</button>',
                    '</div>',
                '</div>',

                '<div class="warhub-card">',
                    '<div class="warhub-row">',
                        '<span class="warhub-pill online">Online ' + esc(String(grouped.online.length)) + '</span>',
                        '<span class="warhub-pill idle">Idle ' + esc(String(grouped.idle.length)) + '</span>',
                        '<span class="warhub-pill travel">Travel ' + esc(String(grouped.travel.length)) + '</span>',
                        '<span class="warhub-pill jail">Jail ' + esc(String(grouped.jail.length)) + '</span>',
                                    '<span class="warhub-pill hospital">Hospital ' + esc(String(grouped.hospital.length)) + '</span>',
                        '<span class="warhub-pill offline">Offline ' + esc(String(grouped.offline.length)) + '</span>',
                    '</div>',
                '</div>',

                renderGroupBlock('members_online', grouped.online, renderMemberRow, true),
                renderGroupBlock('members_idle', grouped.idle, renderMemberRow, true),
                renderGroupBlock('members_travel', grouped.travel, renderMemberRow, false),
                renderGroupBlock('members_jail', grouped.jail, renderMemberRow, false),
                renderGroupBlock('members_hospital', grouped.hospital, renderMemberRow, true),
                renderGroupBlock('members_offline', grouped.offline, renderMemberRow, false),
            '</div>'
        ].join('');
    }

function renderEnemiesTab() {
    var enemies = arr((state && state.enemies) || []);
    var war = (state && state.war) || {};

    var ownFactionId = String(
        (state && state.faction && state.faction.id) ||
        (state && state.faction && state.faction.faction_id) ||
        (state && state.me && state.me.faction_id) ||
        (state && state.license && state.license.faction_id) ||
        war.my_faction_id ||
        ''
    ).trim();

    var ownFactionName = String(
        (state && state.faction && state.faction.name) ||
        (state && state.me && state.me.faction_name) ||
        (state && state.license && state.license.faction_name) ||
        war.my_faction_name ||
        ''
    ).trim().toLowerCase();

    var enemyFactionId = String(war.enemy_faction_id || warEnemiesFactionId || '').trim();
    var enemyFactionName = String(war.enemy_faction_name || warEnemiesFactionName || 'Enemy Faction');
    var enemyFactionNameLc = enemyFactionName.trim().toLowerCase();

    var ownMembers = arr(
        (state && state.members) ||
        currentFactionMembers ||
        factionMembersCache ||
        []
    );

    var ownIds = {};
    ownMembers.forEach(function (m) {
        var id = String((m && (m.user_id || m.id)) || '').trim();
        if (id) ownIds[id] = true;
    });

    enemies = enemies.filter(function (m) {
        var id = String((m && (m.user_id || m.id)) || '').trim();
        if (!id) return false;
        if (ownIds[id]) return false;
        return true;
    });

    if (
        !enemyFactionId ||
        (ownFactionId && enemyFactionId === ownFactionId) ||
        (enemyFactionNameLc && ownFactionName && enemyFactionNameLc === ownFactionName)
    ) {
        enemies = [];
    }

    var searchRaw = String(GM_getValue('warhub_enemies_search', '') || '').trim();
    var search = searchRaw.toLowerCase();

    var filtered = enemies.filter(function (m) {
        if (!search) return true;
        return memberSearchText(m).indexOf(search) >= 0;
    });

    var grouped = groupMembers(filtered);

    return [
        '<div class="warhub-grid">',
            '<div class="warhub-hero-card">',
                '<div class="warhub-title">Enemies</div>',
                '<div class="warhub-sub">' + esc(enemyFactionName) + '</div>',
            '</div>',

            '<div class="warhub-card">',
                '<div class="warhub-kv"><div>Enemy faction</div><div>' + esc(enemyFactionName) + '</div></div>',
                '<div class="warhub-kv"><div>Enemy faction ID</div><div>' + esc(String(enemyFactionId || '—')) + '</div></div>',
                '<div class="warhub-kv"><div>Loaded members</div><div>' + esc(String(filtered.length)) + '</div></div>',
            '</div>',

            '<div class="warhub-card">',
                '<div class="warhub-row">',
                    '<input id="warhub-enemies-search" class="warhub-input" type="text" value="' + esc(searchRaw) + '" placeholder="Search enemy name or ID" />',
                    '<button type="button" class="warhub-btn ghost" data-action="enemies-refresh">Refresh</button>',
                '</div>',
            '</div>',

            filtered.length ? [
                '<div class="warhub-grid">',
                    renderGroupBlock('enemies_online', grouped.online, renderEnemyRow, true),
                    renderGroupBlock('enemies_idle', grouped.idle, renderEnemyRow, true),
                    renderGroupBlock('enemies_travel', grouped.travel, renderEnemyRow, false),
                    renderGroupBlock('enemies_jail', grouped.jail, renderEnemyRow, false),
                    renderGroupBlock('enemies_hospital', grouped.hospital, renderEnemyRow, true),
                    renderGroupBlock('enemies_offline', grouped.offline, renderEnemyRow, false),
                '</div>'
            ].join('') : '<div class="warhub-card">No enemy members loaded from the current war.</div>',
        '</div>'
    ].join('');
}
        // ============================================================
    // 19. TAB RENDERS: HOSPITAL / CHAIN / TARGETS / MED DEALS / TERMS / SUMMARY
    // ============================================================

    function renderHospitalTab() {
        var enemies = arr((state && state.enemies) || warEnemiesCache || []);
        var hospitalOnly = enemies.filter(function (m) {
            return stateLabel(m) === 'hospital';
        });

        return [
            '<div class="warhub-grid">',
                '<div class="warhub-hero-card">',
                    '<div class="warhub-title">Hospital</div>',
                    '<div class="warhub-sub">Enemy hospital list from current war</div>',
                '</div>',
                hospitalOnly.length
                    ? renderGroupBlock('hospital_enemies', hospitalOnly, renderEnemyRow, true)
                    : '<div class="warhub-card">No hospital enemies right now.</div>',
            '</div>'
        ].join('');
    }

    function renderChainTab() {
        var chain = (state && state.chain) || {};
        var ownFactionName = String((state && state.faction && state.faction.name) || 'Your Faction');

        return [
            '<div class="warhub-grid">',
                '<div class="warhub-hero-card">',
                    '<div class="warhub-title">Chain</div>',
                    '<div class="warhub-sub">' + esc(ownFactionName) + ' only</div>',
                '</div>',
                '<div class="warhub-card">',
                    '<div class="warhub-kv"><div>Status</div><div>' + esc(String(chain.available ? 'Available' : 'Unavailable')) + '</div></div>',
                    '<div class="warhub-kv"><div>Current</div><div>' + esc(fmtNum(chain.current || 0)) + '</div></div>',
                    '<div class="warhub-kv"><div>Cooldown</div><div>' + esc(shortCd(chain.cooldown || 0, 'Ready')) + '</div></div>',
                    '<div class="warhub-kv"><div>Chain sitter</div><div>' + esc(String(chain.sitter_enabled ? 'Enabled' : 'Disabled')) + '</div></div>',
                '</div>',
                '<div class="warhub-card">',
                    '<div class="warhub-row">',
                        '<button type="button" class="warhub-btn ghost" data-action="chain-available">Available</button>',
                        '<button type="button" class="warhub-btn gray" data-action="chain-unavailable">Unavailable</button>',
                        '<button type="button" class="warhub-btn warn" data-action="chain-toggle-sitter">Toggle sitter</button>',
                    '</div>',
                '</div>',
            '</div>'
        ].join('');
    }

    function renderTargetsTab() {
    var targets = arr((state && state.targets) || []);
    var enemies = sortMembers(arr((state && state.enemies) || []));

    return [
        '<div class="warhub-grid">',
            '<div class="warhub-hero-card">',
                '<div class="warhub-title">Targets</div>',
                '<div class="warhub-sub">Personal target picks from current war enemies</div>',
            '</div>',

            targets.length ? [
                '<div class="warhub-card warhub-col">',
                    '<h3>Saved Targets</h3>',
                    targets.map(function (t) {
                        var id = String(t.user_id || t.target_user_id || t.id || t.player_id || '');
                        var name = String(t.name || t.target_name || t.player_name || 'Target');
                        var note = String(t.note || '');

                        return [
                            '<div class="warhub-member-row">',
                                '<div class="warhub-member-main">',
                                    '<div class="warhub-row">',
                                        '<a class="warhub-member-name" href="https://www.torn.com/profiles.php?XID=' + esc(id) + '" target="_blank" rel="noopener noreferrer">' + esc(name) + '</a>',
                                    '</div>',
                                    '<div class="warhub-row">',
                                        id ? '<a class="warhub-btn" href="https://www.torn.com/loader.php?sid=attack&user2ID=' + esc(id) + '" target="_blank" rel="noopener noreferrer">Attack</a>' : '',
                                        id ? '<button type="button" class="warhub-btn gray" data-action="target-delete" data-user-id="' + esc(id) + '">Delete Target</button>' : '',
                                    '</div>',
                                '</div>',
                                note ? '<div class="warhub-spy-box">' + esc(note) + '</div>' : '',
                            '</div>'
                        ].join('');
                    }).join(''),
                '</div>'
            ].join('') : '<div class="warhub-card">No saved targets yet.</div>',

            '<div class="warhub-card warhub-col">',
                '<label class="warhub-label" for="warhub-target-name">Target name</label>',
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
                    '<button type="button" class="warhub-btn green" data-action="target-save">Save Target</button>',
                '</div>',
            '</div>',
        '</div>'
    ].join('');
}
    function renderMedDealsTab() {
        var medDeals = (state && state.med_deals) || {};
        var text = String(medDeals.text || '');

        return [
            '<div class="warhub-grid">',
                '<div class="warhub-hero-card">',
                    '<div class="warhub-title">Med Deals</div>',
                    '<div class="warhub-sub">Shared with faction members</div>',
                '</div>',
                '<div class="warhub-card warhub-col">',
                    '<label class="warhub-label" for="warhub-meddeals-text">Med deals</label>',
                    '<textarea id="warhub-meddeals-text" class="warhub-textarea" placeholder="Write med deal info here...">' + esc(text) + '</textarea>',
                    '<div class="warhub-row">',
                        '<button type="button" class="warhub-btn" data-action="meddeals-save">Save</button>',
                        '<button type="button" class="warhub-btn gray" data-action="meddeals-clear">Delete</button>',
                    '</div>',
                '</div>',
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

        return [
            '<div class="warhub-grid">',
                '<div class="warhub-hero-card">',
                    '<div class="warhub-title">War Summary</div>',
                    '<div class="warhub-sub">Leader / admin live war metrics</div>',
                '</div>',

                liveSummaryError
                    ? '<div class="warhub-card"><span class="warhub-pill bad">' + esc(liveSummaryError) + '</span></div>'
                    : '',

                cards.length ? [
                    '<div class="warhub-overview-stats">',
                        cards.map(function (c) {
                            return [
                                '<div class="warhub-stat-card ' + esc(String(c.cls || '')) + '">',
                                    '<div class="warhub-stat-label">' + esc(String(c.label || 'Metric')) + '</div>',
                                    '<div class="warhub-stat-value">' + esc(String(c.value == null ? '—' : c.value)) + '</div>',
                                    c.sub ? '<div class="warhub-sub" style="margin-top:6px;">' + esc(String(c.sub)) + '</div>' : '',
                                '</div>'
                            ].join('');
                        }).join(''),
                    '</div>'
                ].join('') : '',

                '<div class="warhub-card warhub-col">',
                    '<div class="warhub-kv"><div>Top hitter</div><div>' + esc(String(top.top_hitter || '—')) + '</div></div>',
                    '<div class="warhub-kv"><div>Top respect gain</div><div>' + esc(String(top.top_respect_gain || '—')) + '</div></div>',
                    '<div class="warhub-kv"><div>Top points bleeder</div><div>' + esc(String(top.top_points_bleeder || '—')) + '</div></div>',
                    '<div class="warhub-kv"><div>Best finisher</div><div>' + esc(String(top.best_finisher || '—')) + '</div></div>',
                '</div>',
            '</div>'
        ].join('');
    }
        // ============================================================
    // 20. TAB RENDERS: FACTION
    // ============================================================

    function renderFactionTab() {
        var license = (state && state.license) || {};
        var members = arr((state && state.members) || currentFactionMembers || factionMembersCache || []);
        var factionName = String(
            (state && state.faction && state.faction.name) ||
            license.faction_name ||
            'Your Faction'
        );
        var factionId = String(
            (state && state.faction && state.faction.faction_id) ||
            license.faction_id ||
            ''
        );
        var renewalCost = license.renewal_cost != null ? license.renewal_cost : ((license.enabled_member_count || 0) * PRICE_PER_MEMBER);
        var daysLeft = license.days_left != null ? license.days_left : (fmtDaysLeftFromIso(license.paid_until_at) || 0);
        var enabledCount = Number(license.enabled_member_count || 0);

        return [
            '<div class="warhub-grid">',
                '<div class="warhub-hero-card">',
                    '<div class="warhub-title">Faction</div>',
                    '<div class="warhub-sub">Leader activation and billing</div>',
                '</div>',

                '<div class="warhub-card">',
                    '<div class="warhub-row" style="justify-content:space-between;align-items:flex-start;gap:8px;">',
                        '<div>',
                            '<div class="warhub-member-name">', esc(factionName), '</div>',
                            '<div class="warhub-sub">Faction #', esc(factionId || '—'), '</div>',
                        '</div>',
                        '<div class="warhub-row" style="flex-wrap:wrap;justify-content:flex-end;">',
                            '<span class="warhub-pill neutral">Days Left: ', esc(String(daysLeft)), '</span>',
                            '<span class="warhub-pill good">Enabled: ', esc(String(enabledCount)), '</span>',
                        '</div>',
                    '</div>',

                    '<div class="warhub-mini-grid" style="margin-top:10px;">',
                        statCard('Enabled', enabledCount),
                        statCard('Renewal', renewalCost, '3 Xanax/member'),
                    '</div>',
                '</div>',

                '<div class="warhub-card warhub-col">',
                    '<div class="warhub-row" style="justify-content:space-between;align-items:center;">',
                        '<h3>Faction Members</h3>',
                        '<span class="warhub-pill neutral">', esc(fmtNum(members.length)), ' shown</span>',
                    '</div>',

                    '<div class="warhub-col">',
                        members.map(function (m) {
                            var id = getMemberId(m);
                            var name = getMemberName(m);
                            var enabled = !!(m && (m.enabled || m.member_enabled || m.active_for_cycle));

                            return [
                                '<div class="warhub-member-row">',
                                    '<div class="warhub-member-main">',
                                        '<div class="warhub-row">',
                                            '<span class="warhub-member-name">', esc(name), '</span>',
                                            id ? '<span class="warhub-pill neutral">#' + esc(id) + '</span>' : '',
                                            '<span class="warhub-pill ' + (enabled ? 'good' : 'bad') + '">' + (enabled ? 'Activated' : 'Inactive') + '</span>',
                                        '</div>',
                                        '<div class="warhub-row">',
                                            enabled
                                                ? '<button type="button" class="warhub-btn gray" disabled>Activated</button>'
                                                : '<button type="button" class="warhub-btn green" data-action="activate-member" data-user-id="' + esc(String(id)) + '">Activate</button>',
                                            !enabled
                                                ? '<button type="button" class="warhub-btn gray" data-action="remove-member" data-user-id="' + esc(String(id)) + '">Remove</button>'
                                                : '',
                                        '</div>',
                                    '</div>',
                                '</div>'
                            ].join('');
                        }).join(''),
                    '</div>',
                '</div>',
            '</div>'
        ].join('');
    }

    // ============================================================
    // 21. TAB RENDERS: SETTINGS / INSTRUCTIONS / TOP 5 / ADMIN
    // ============================================================

    function renderSettingsTab() {
        var viewer = (state && state.viewer) || {};
        var access = normalizeAccessCache((state && state.access) || accessState);
        var maskedKey = getApiKey() ? '********' : '';

        return [
            '<div class="warhub-grid">',
                '<div class="warhub-hero-card">',
                    '<div class="warhub-title">Settings</div>',
                    '<div class="warhub-sub">Account and local script settings</div>',
                '</div>',

                '<div class="warhub-card warhub-col">',
                    '<label class="warhub-label" for="warhub-api-key">Torn API Key</label>',
                    '<input id="warhub-api-key" class="warhub-input" type="password" value="' + esc(maskedKey) + '" placeholder="Saved API key" />',
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

                '<div class="warhub-card">',
                    '<h3>Suggestions</h3>',
                    '<div class="warhub-col">',
                        '<div>• Keep using backend-fed data for members and enemies only.</div>',
                        '<div>• Avoid page scraping for war members.</div>',
                        '<div>• Keep live polling only on Summary and Enemies.</div>',
                    '</div>',
                '</div>',
            '</div>'
        ].join('');
    }

    function renderInstructionsTab() {
        return [
            '<div class="warhub-grid">',
                '<div class="warhub-hero-card">',
                    '<div class="warhub-title">Instructions</div>',
                    '<div class="warhub-sub">How to use War Hub</div>',
                '</div>',

                '<div class="warhub-card warhub-col">',
                    '<h3>Getting started</h3>',
                    '<div>1. Open Settings and log in with your Torn API key.</div>',
                    '<div>2. Leaders can activate faction members in the Faction tab.</div>',
                    '<div>3. Members get Overview, Members, Enemies, Hospital and other shared tools once access is enabled.</div>',
                '</div>',

                '<div class="warhub-card warhub-col">',
                    '<h3>Live tabs</h3>',
                    '<div>• Summary and Enemies use live polling when open.</div>',
                    '<div>• Members uses backend faction data only.</div>',
                    '<div>• Enemies uses current war enemy data only.</div>',
                '</div>',

                '<div class="warhub-card warhub-col">',
                    '<h3>PDA tips</h3>',
                    '<div>• Tap the shield to open or close the overlay.</div>',
                    '<div>• Hold the shield briefly, then drag to move it.</div>',
                    '<div>• Tabs scroll sideways on smaller screens.</div>',
                '</div>',
            '</div>'
        ].join('');
    }

    function renderWarTop5Tab() {
        var top = adminTopFiveCache || {};
        var items = arr(top.items || top.top5 || []);

        return [
            '<div class="warhub-grid">',
                '<div class="warhub-hero-card">',
                    '<div class="warhub-title">War Top 5</div>',
                    '<div class="warhub-sub">Top recent rows</div>',
                '</div>',
                items.length ? [
                    '<div class="warhub-card warhub-col">',
                        items.map(function (row, idx) {
                            return [
                                '<div class="warhub-member-row">',
                                    '<div class="warhub-member-main">',
                                        '<div class="warhub-row">',
                                            '<span class="warhub-pill neutral">#' + esc(String(idx + 1)) + '</span>',
                                            '<span class="warhub-member-name">' + esc(String(row.name || row.player_name || 'Player')) + '</span>',
                                        '</div>',
                                        '<div class="warhub-row">',
                                            '<span class="warhub-pill good">' + esc(fmtNum(row.value || row.score || 0)) + '</span>',
                                        '</div>',
                                    '</div>',
                                '</div>'
                            ].join('');
                        }).join(''),
                    '</div>'
                ].join('') : '<div class="warhub-card">No top 5 rows loaded.</div>',
            '</div>'
        ].join('');
    }

function renderAdminTab() {
    var dash = analyticsCache || {};
    var recent = arr(dash.recent_activity || dash.recent || []);
    var licenses = arr(dash.faction_licenses || dash.licenses || []);

    var summaryPills = [
        '<span class="warhub-pill neutral">Total Factions: ' + esc(fmtNum(dash.total_factions || 0)) + '</span>',
        '<span class="warhub-pill good">Active: ' + esc(fmtNum(dash.active_licenses || 0)) + '</span>',
        '<span class="warhub-pill neutral">User Exempt: ' + esc(fmtNum(dash.user_exemptions || 0)) + '</span>',
        '<span class="warhub-pill neutral">Faction Exempt: ' + esc(fmtNum(dash.faction_exemptions || 0)) + '</span>'
    ].join('');

    var recentHtml = recent.length
        ? recent.map(function (row) {
            return [
                '<div class="warhub-member-row">',
                    '<div class="warhub-member-main">',
                        '<div class="warhub-row">',
                            '<span class="warhub-member-name">' + esc(String(row.title || row.kind || 'Activity')) + '</span>',
                        '</div>',
                        '<div class="warhub-row">',
                            '<span class="warhub-pill neutral">' + esc(fmtTs(row.created_at || row.at || '')) + '</span>',
                        '</div>',
                    '</div>',
                    row.text ? '<div class="warhub-spy-box">' + esc(String(row.text)) + '</div>' : '',
                '</div>'
            ].join('');
        }).join('')
        : '<div class="warhub-empty">No recent activity.</div>';

    var licensesHtml = licenses.length
        ? licenses.map(function (row) {
            var factionName = String(row.faction_name || 'Faction');
            var factionId = String(row.faction_id || '');
            var active = !!row.active;
            var exemptFaction = !!row.is_faction_exempt;
            var daysLeft = row.days_left != null ? row.days_left : 0;
            var enabledCount = Number(row.enabled_member_count || 0);
            var renewalCost = row.renewal_cost != null ? row.renewal_cost : (enabledCount * PRICE_PER_MEMBER);

            return [
                '<div class="warhub-overview-link-card">',
                    '<div class="warhub-row" style="justify-content:space-between;align-items:flex-start;gap:8px;">',
                        '<div>',
                            '<div class="warhub-member-name">', esc(factionName), '</div>',
                            '<div class="warhub-sub">Faction #', esc(factionId || '—'), '</div>',
                        '</div>',
                        '<div class="warhub-row" style="flex-wrap:wrap;justify-content:flex-end;">',
                            active
                                ? '<span class="warhub-pill good">Active</span>'
                                : '<span class="warhub-pill bad">Inactive</span>',
                            exemptFaction
                                ? '<span class="warhub-pill neutral">Exempt</span>'
                                : '',
                            '<span class="warhub-pill neutral">Days Left: ' + esc(String(daysLeft)) + '</span>',
                        '</div>',
                    '</div>',

                    '<div class="warhub-mini-grid" style="margin-top:10px;">',
                        statCard('Enabled', enabledCount),
                        statCard('Renewal', renewalCost, '3 Xanax/member'),
                    '</div>',

                    '<div class="warhub-row" style="margin-top:12px;flex-wrap:wrap;">',
                        factionId
                            ? '<button type="button" class="warhub-btn ghost" data-action="admin-history" data-faction-id="' + esc(factionId) + '">History</button>'
                            : '',
                        factionId
                            ? '<button type="button" class="warhub-btn green" data-action="admin-renew" data-faction-id="' + esc(factionId) + '">Renew</button>'
                            : '',
                        factionId
                            ? '<button type="button" class="warhub-btn gray" data-action="admin-expire" data-faction-id="' + esc(factionId) + '">Expire</button>'
                            : '',
                        factionId
                            ? '<button type="button" class="warhub-btn warn" data-action="admin-faction-exempt-add" data-faction-id="' + esc(factionId) + '" data-faction-name="' + esc(factionName) + '">Exempt Faction</button>'
                            : '',
                    '</div>',
                '</div>'
            ].join('');
        }).join('')
        : '<div class="warhub-empty">No faction license rows.</div>';

    return [
        '<div class="warhub-grid">',

            '<div class="warhub-hero-card">',
                '<div class="warhub-title">Admin</div>',
                '<div class="warhub-sub">Owner/admin controls</div>',
                '<div class="warhub-row" style="margin-top:10px;flex-wrap:wrap;">',
                    summaryPills,
                '</div>',
            '</div>',

            '<div class="warhub-mini-grid">',
                statCard('Total Factions', dash.total_factions || 0),
                statCard('Active Licenses', dash.active_licenses || 0),
                statCard('Exempt Users', dash.user_exemptions || 0),
                statCard('Exempt Factions', dash.faction_exemptions || 0),
            '</div>',

            '<div class="warhub-card warhub-col">',
                '<h3>Faction Exemption</h3>',
                '<label class="warhub-label" for="warhub-admin-faction-id">Faction ID</label>',
                '<input id="warhub-admin-faction-id" class="warhub-input" type="text" placeholder="Faction ID" />',
                '<label class="warhub-label" for="warhub-admin-faction-name">Faction Name (optional)</label>',
                '<input id="warhub-admin-faction-name" class="warhub-input" type="text" placeholder="Faction name" />',
                '<label class="warhub-label" for="warhub-admin-faction-note">Note (optional)</label>',
                '<textarea id="warhub-admin-faction-note" class="warhub-textarea" placeholder="Reason for exemption"></textarea>',
                '<div class="warhub-row">',
                    '<button type="button" class="warhub-btn green" data-action="admin-faction-exempt-save">Save Faction Exemption</button>',
                    '<button type="button" class="warhub-btn gray" data-action="admin-faction-exempt-delete">Delete Faction Exemption</button>',
                '</div>',
                '<div class="warhub-sub">Faction exemption = no pay required and all faction members can use member features.</div>',
            '</div>',

            '<div class="warhub-card warhub-col">',
                '<h3>Player Exemption</h3>',
                '<label class="warhub-label" for="warhub-admin-user-id">Player ID</label>',
                '<input id="warhub-admin-user-id" class="warhub-input" type="text" placeholder="Player ID" />',
                '<label class="warhub-label" for="warhub-admin-user-name">Player Name (optional)</label>',
                '<input id="warhub-admin-user-name" class="warhub-input" type="text" placeholder="Player name" />',
                '<label class="warhub-label" for="warhub-admin-user-faction-id">Faction ID (optional)</label>',
                        '<input id="warhub-admin-user-faction-id" class="warhub-input" type="text" placeholder="Faction ID" />',
                '<label class="warhub-label" for="warhub-admin-user-faction-name">Faction Name (optional)</label>',
                '<input id="warhub-admin-user-faction-name" class="warhub-input" type="text" placeholder="Faction name" />',
                '<label class="warhub-label" for="warhub-admin-user-note">Note (optional)</label>',
                '<textarea id="warhub-admin-user-note" class="warhub-textarea" placeholder="Reason for exemption"></textarea>',
                '<div class="warhub-row">',
                    '<button type="button" class="warhub-btn green" data-action="admin-user-exempt-save">Save Player Exemption</button>',
                    '<button type="button" class="warhub-btn gray" data-action="admin-user-exempt-delete">Delete Player Exemption</button>',
                '</div>',
                '<div class="warhub-sub">Player exemption = script free and member features unlocked for that player.</div>',
            '</div>',

            '<div class="warhub-card warhub-col">',
                '<h3>Recent Activity</h3>',
                recentHtml,
            '</div>',

            '<div class="warhub-card warhub-col">',
                '<div class="warhub-row" style="justify-content:space-between;align-items:center;">',
                    '<h3>Faction Licenses</h3>',
                    '<span class="warhub-pill neutral">', esc(fmtNum(licenses.length)), ' shown</span>',
                '</div>',
                licensesHtml,
            '</div>',

        '</div>'
    ].join('');
}
        // ============================================================
    // 22. ACTION HANDLERS
    // ============================================================

function handleActionClick(el) {
    return _handleActionClick.apply(this, arguments);
}

function _handleActionClick() {
    _handleActionClick = _asyncToGenerator(function* (el) {
        var action = el && el.getAttribute('data-action');
        if (!action) return;

        try {
            if (action === 'login') {
                yield doLogin();
                return;
            }

            if (action === 'admin-faction-exempt-save') {
                var factionIdEl = overlay && overlay.querySelector('#warhub-admin-faction-id');
                var factionNameEl = overlay && overlay.querySelector('#warhub-admin-faction-name');
                var factionNoteEl = overlay && overlay.querySelector('#warhub-admin-faction-note');

                var factionId = cleanInputValue(factionIdEl && factionIdEl.value);
                var factionName = String((factionNameEl && factionNameEl.value) || '').trim();
                var note = String((factionNoteEl && factionNoteEl.value) || '').trim();

                if (!factionId) {
                    setStatus('Enter a faction ID first.', true);
                    return;
                }

                var saveFactionExemptRes = yield adminReq('POST', '/api/admin/exemptions/factions', {
                    faction_id: factionId,
                    faction_name: factionName,
                    note: note
                });

                if (!saveFactionExemptRes.ok) {
                    setStatus((saveFactionExemptRes.json && saveFactionExemptRes.json.error) || 'Failed to save faction exemption.', true);
                    return;
                }

                yield loadAdminDashboard(true);
                setStatus('Faction exemption saved.', false);
                renderBody();
                return;
            }

            if (action === 'admin-faction-exempt-delete') {
                var deleteFactionIdEl = overlay && overlay.querySelector('#warhub-admin-faction-id');
                var deleteFactionId = cleanInputValue(deleteFactionIdEl && deleteFactionIdEl.value);

                if (!deleteFactionId) {
                    setStatus('Enter a faction ID to delete.', true);
                    return;
                }

                var deleteFactionExemptRes = yield adminReq('DELETE', '/api/admin/exemptions/factions/' + encodeURIComponent(deleteFactionId), null);

                if (!deleteFactionExemptRes.ok) {
                    setStatus((deleteFactionExemptRes.json && deleteFactionExemptRes.json.error) || 'Failed to delete faction exemption.', true);
                    return;
                }

                yield loadAdminDashboard(true);
                setStatus('Faction exemption deleted.', false);
                renderBody();
                return;
            }

            if (action === 'admin-user-exempt-save') {
                var userIdEl = overlay && overlay.querySelector('#warhub-admin-user-id');
                var userNameEl = overlay && overlay.querySelector('#warhub-admin-user-name');
                var userFactionIdEl = overlay && overlay.querySelector('#warhub-admin-user-faction-id');
                var userFactionNameEl = overlay && overlay.querySelector('#warhub-admin-user-faction-name');
                var userNoteEl = overlay && overlay.querySelector('#warhub-admin-user-note');

                var userId = cleanInputValue(userIdEl && userIdEl.value);
                var userName = String((userNameEl && userNameEl.value) || '').trim();
                var userFactionId = cleanInputValue(userFactionIdEl && userFactionIdEl.value);
                var userFactionName = String((userFactionNameEl && userFactionNameEl.value) || '').trim();
                var userNote = String((userNoteEl && userNoteEl.value) || '').trim();

                if (!userId) {
                    setStatus('Enter a player ID first.', true);
                    return;
                }

                var saveUserExemptRes = yield adminReq('POST', '/api/admin/exemptions/users', {
                    user_id: userId,
                    user_name: userName,
                    faction_id: userFactionId,
                    faction_name: userFactionName,
                    note: userNote
                });

                if (!saveUserExemptRes.ok) {
                    setStatus((saveUserExemptRes.json && saveUserExemptRes.json.error) || 'Failed to save player exemption.', true);
                    return;
                }

                yield loadAdminDashboard(true);
                setStatus('Player exemption saved.', false);
                renderBody();
                return;
            }

            if (action === 'admin-user-exempt-delete') {
                var deleteUserIdEl = overlay && overlay.querySelector('#warhub-admin-user-id');
                var deleteUserId = cleanInputValue(deleteUserIdEl && deleteUserIdEl.value);

                if (!deleteUserId) {
                    setStatus('Enter a player ID to delete.', true);
                    return;
                }

                var deleteUserExemptRes = yield adminReq('DELETE', '/api/admin/exemptions/users/' + encodeURIComponent(deleteUserId), null);

                if (!deleteUserExemptRes.ok) {
                    setStatus((deleteUserExemptRes.json && deleteUserExemptRes.json.error) || 'Failed to delete player exemption.', true);
                    return;
                }

                yield loadAdminDashboard(true);
                setStatus('Player exemption deleted.', false);
                renderBody();
                return;
            }

            if (action === 'admin-faction-exempt-add') {
                var quickFactionId = cleanInputValue(el.getAttribute('data-faction-id'));
                var quickFactionName = String(el.getAttribute('data-faction-name') || '').trim();

                if (!quickFactionId) {
                    setStatus('Missing faction ID.', true);
                    return;
                }

                var quickFactionExemptRes = yield adminReq('POST', '/api/admin/exemptions/factions', {
                    faction_id: quickFactionId,
                    faction_name: quickFactionName,
                    note: 'Added from Admin faction license card'
                });

                if (!quickFactionExemptRes.ok) {
                    setStatus((quickFactionExemptRes.json && quickFactionExemptRes.json.error) || 'Failed to exempt faction.', true);
                    return;
                }

                yield loadAdminDashboard(true);
                setStatus('Faction marked exempt.', false);
                renderBody();
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

            if (action === 'enemies-refresh') {
                setStatus('Refreshing enemies...', false);
                yield loadWarData(true);
                yield loadEnemies(true);
                renderBody();
                setStatus('Enemies refreshed.', false);
                return;
            }

            if (action === 'meddeals-save') {
                var medDealsTextEl = overlay && overlay.querySelector('#warhub-meddeals-text');
                var medDealsText = String((medDealsTextEl && medDealsTextEl.value) || '');

                var saveMedDealsRes = yield authedReq('POST', '/api/meddeals', {
                    text: medDealsText
                });

                if (!saveMedDealsRes.ok) {
                    setStatus((saveMedDealsRes.json && saveMedDealsRes.json.error) || 'Failed to save med deals.', true);
                    return;
                }

                state = state || {};
                state.med_deals = state.med_deals || {};
                state.med_deals.text = medDealsText;
                renderBody();
                setStatus('Med deals saved.', false);
                return;
            }

            if (action === 'meddeals-clear') {
                var clearMedDealsRes = yield authedReq('POST', '/api/meddeals', {
                    text: ''
                });

                if (!clearMedDealsRes.ok) {
                    setStatus((clearMedDealsRes.json && clearMedDealsRes.json.error) || 'Failed to clear med deals.', true);
                    return;
                }

                state = state || {};
                state.med_deals = state.med_deals || {};
                state.med_deals.text = '';
                renderBody();
                setStatus('Med deals cleared.', false);
                return;
            }

            if (action === 'terms-summary-save') {
                var boxEl = overlay && overlay.querySelector('#warhub-terms-summary-text');
                var boxText = String((boxEl && boxEl.value) || '');

                var saveBoxRes = yield authedReq('POST', '/api/terms-summary', {
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
                var clearBoxRes = yield authedReq('POST', '/api/terms-summary', {
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

                var targetRes = yield authedReq('POST', '/api/targets', targetPayload);
                if (!targetRes.ok) {
                    setStatus((targetRes.json && targetRes.json.error) || 'Failed to save target.', true);
                    return;
                }

                yield loadState();
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

                var deleteTargetRes = yield authedReq('DELETE', '/api/targets/' + encodeURIComponent(deleteTargetUserId), null);
                if (!deleteTargetRes.ok) {
                    setStatus((deleteTargetRes.json && deleteTargetRes.json.error) || 'Failed to delete target.', true);
                    return;
                }

                yield loadState();
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
                yield refreshFactionPaymentData();
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
                yield refreshFactionPaymentData();
                renderBody();
                setStatus('Member removed.', false);
                return;
            }

            if (action === 'admin-history') {
                var historyFactionId = el.getAttribute('data-faction-id');
                if (!historyFactionId) return;

                var historyRes = yield adminReq('GET', '/api/admin/factions/' + encodeURIComponent(historyFactionId) + '/history');
                if (!historyRes.ok) {
                    setStatus((historyRes.json && historyRes.json.error) || 'Failed to load history.', true);
                    return;
                }

                var items = arr(historyRes.json && historyRes.json.items);
                pushLocalNotification('info', 'History loaded for faction ' + historyFactionId + ' (' + items.length + ' rows).');
                updateBadge();
                setStatus('History loaded. See notifications.', false);
                return;
            }

            if (action === 'admin-renew') {
                var renewFactionId = el.getAttribute('data-faction-id');
                if (!renewFactionId) return;

                var renewRes = yield adminReq('POST', '/api/admin/factions/' + encodeURIComponent(renewFactionId) + '/renew', {});
                if (!renewRes.ok) {
                    setStatus((renewRes.json && renewRes.json.error) || 'Failed to renew faction.', true);
                    return;
                }

                yield loadAdminDashboard(true);
                renderBody();
                setStatus('Faction renewed.', false);
                return;
            }

            if (action === 'admin-expire') {
                var expireFactionId = el.getAttribute('data-faction-id');
                if (!expireFactionId) return;

                var expireRes = yield adminReq('POST', '/api/admin/factions/' + encodeURIComponent(expireFactionId) + '/expire', {});
                if (!expireRes.ok) {
                    setStatus((expireRes.json && expireRes.json.error) || 'Failed to expire faction.', true);
                    return;
                }

                yield loadAdminDashboard(true);
                renderBody();
                setStatus('Faction expired.', false);
                return;
            }

            if (action === 'chain-available') {
                var chainAvailableRes = yield authedReq('POST', '/api/chain', { available: true });
                if (!chainAvailableRes.ok) {
                    setStatus((chainAvailableRes.json && chainAvailableRes.json.error) || 'Failed to update chain.', true);
                    return;
                }

                yield loadState();
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

                yield loadState();
                renderBody();
                setStatus('Chain marked unavailable.', false);
                return;
            }

            if (action === 'chain-toggle-sitter') {
                var current = !!(state && state.chain && state.chain.sitter_enabled);
                var chainSitterRes = yield authedReq('POST', '/api/chain/sitter', { enabled: !current });
                if (!chainSitterRes.ok) {
                    setStatus((chainSitterRes.json && chainSitterRes.json.error) || 'Failed to update chain sitter.', true);
                    return;
                }

                yield loadState();
                renderBody();
                setStatus('Chain sitter updated.', false);
                return;
            }
        } catch (err) {
            console.error('War Hub action error:', action, err);
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

    function renderLiveTabOnly() {
        if (!overlay) return;

        var content = overlay.querySelector('#warhub-content');
        if (!content) return;

        content.innerHTML = renderCurrentTab();
        bindDynamicBits();
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
        if (currentTab === 'summary') return canSeeSummary() ? renderSummaryTab() : '<div class="warhub-card">Summary is leader/admin only.</div>';
        if (currentTab === 'faction') return canManageFaction() ? renderFactionTab() : '<div class="warhub-card">Faction tab is leader only.</div>';
        if (currentTab === 'settings') return renderSettingsTab();
        if (currentTab === 'instructions') return renderInstructionsTab();
        if (currentTab === 'wartop5') return renderWarTop5Tab();
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

        if (currentTab === 'members') {
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

        if (currentTab === 'members') {
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
                if (currentTab === 'members') renderBody();
            });
        }

        var enemiesSearch = overlay.querySelector('#warhub-enemies-search');
        if (enemiesSearch && !enemiesSearch.__warhubBound) {
            enemiesSearch.__warhubBound = true;
            enemiesSearch.addEventListener('input', function () {
                GM_setValue('warhub_enemies_search', String(enemiesSearch.value || ''));
                if (currentTab === 'enemies') renderBody();
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
        if (!document.body) return;

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
                }
            } catch (err) {
                console.error('War Hub remount watch error:', err);
            }
        }, 2000);
    }

    function boot() {
        ensureMounted();
        restartPolling();
        startRemountWatch();

        if (isLoggedIn()) {
            loadState().then(function () {
                renderBody();
            }).catch(function (err) {
                console.error('War Hub initial load error:', err);
                renderBody();
            });
        } else {
            renderBody();
        }
    }

    boot();

})();
    


