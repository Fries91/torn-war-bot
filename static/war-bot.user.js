// ==UserScript==
// @name         War Hub ⚔️
// @namespace    fries91-war-hub
// @version      3.2.3
// @description  War Hub by Fries91. Faction-license aware overlay with draggable icon, draggable overlay, PDA friendly, shared war tools, faction member management, and payment lock handling.
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
  font-size: 22px !important;\n\
  line-height: 1 !important;\n\
  cursor: grab !important;\n\
  user-select: none !important;\n\
  -webkit-user-select: none !important;\n\
  -webkit-touch-callout: none !important;\n\
  touch-action: none !important;\n\
  box-shadow: 0 8px 24px rgba(0,0,0,.45) !important;\n\
  border: 1px solid rgba(255,255,255,.10) !important;\n\
  background: radial-gradient(circle at 30% 20%, rgba(220,75,75,.98), rgba(110,12,12,.98) 55%, rgba(48,6,6,.98)) !important;\n\
  color: #fff !important;\n\
  top: 120px !important;\n\
  right: 14px !important;\n\
  left: auto !important;\n\
  bottom: auto !important;\n\
  opacity: 1 !important;\n\
  visibility: visible !important;\n\
  pointer-events: auto !important;\n\
}\n\
#warhub-shield.dragging { cursor: grabbing !important; }\n\
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
  right: 12px !important;\n\
  top: 170px !important;\n\
  width: min(96vw, 520px) !important;\n\
  height: min(88vh, 900px) !important;\n\
  max-height: 88vh !important;\n\
  min-height: 420px !important;\n\
  overflow: hidden !important;\n\
  border-radius: 14px !important;\n\
  background: linear-gradient(180deg, #171717, #0c0c0c) !important;\n\
  color: #f2f2f2 !important;\n\
  border: 1px solid rgba(255,255,255,.08) !important;\n\
  box-shadow: 0 16px 38px rgba(0,0,0,.54) !important;\n\
  display: none !important;\n\
  font-family: -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif !important;\n\
  left: auto !important;\n\
  bottom: auto !important;\n\
  flex-direction: column !important;\n\
  box-sizing: border-box !important;\n\
  opacity: 1 !important;\n\
  visibility: visible !important;\n\
}\n\
#warhub-overlay.open { display: flex !important; }\n\
\n\
#warhub-overlay *,\n\
#warhub-overlay *::before,\n\
#warhub-overlay *::after {\n\
  box-sizing: border-box !important;\n\
}\n\
\n\
.warhub-head {\n\
  padding: 10px 12px 9px !important;\n\
  border-bottom: 1px solid rgba(255,255,255,.08) !important;\n\
  background: linear-gradient(180deg, rgba(170,18,18,.30), rgba(20,20,20,.20)) !important;\n\
  cursor: grab !important;\n\
  user-select: none !important;\n\
  -webkit-user-select: none !important;\n\
  -webkit-touch-callout: none !important;\n\
  touch-action: none !important;\n\
  flex: 0 0 auto !important;\n\
  display: block !important;\n\
  width: 100% !important;\n\
  min-height: 54px !important;\n\
}\n\
.warhub-head.dragging { cursor: grabbing !important; }\n\
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
  border-radius: 9px !important;\n\
  background: rgba(255,255,255,.08) !important;\n\
  color: #fff !important;\n\
  padding: 5px 9px !important;\n\
  font-weight: 700 !important;\n\
  cursor: pointer !important;\n\
  font-size: 12px !important;\n\
  flex: 0 0 auto !important;\n\
  display: inline-flex !important;\n\
  align-items: center !important;\n\
  justify-content: center !important;\n\
  min-height: 30px !important;\n\
}\n\
\n\
.warhub-tab {\n\
  appearance: none !important;\n\
  -webkit-appearance: none !important;\n\
  border: 1px solid rgba(255,255,255,.16) !important;\n\
  background: rgba(255,255,255,.10) !important;\n\
  color: #ffffff !important;\n\
  border-radius: 10px !important;\n\
  padding: 9px 13px !important;\n\
  min-height: 36px !important;\n\
  font-size: 13px !important;\n\
  font-weight: 800 !important;\n\
  letter-spacing: .2px !important;\n\
  line-height: 1 !important;\n\
  white-space: nowrap !important;\n\
  cursor: pointer !important;\n\
  box-shadow: inset 0 1px 0 rgba(255,255,255,.06) !important;\n\
  flex: 0 0 auto !important;\n\
  text-shadow: 0 1px 0 rgba(0,0,0,.35) !important;\n\
}\n\
.warhub-tab.active {\n\
  background: linear-gradient(180deg, rgba(220,50,50,.95), rgba(145,18,18,.98)) !important;\n\
  border-color: rgba(255,255,255,.22) !important;\n\
  box-shadow: 0 6px 16px rgba(0,0,0,.28), inset 0 1px 0 rgba(255,255,255,.10) !important;\n\
}\n\
\n\
.warhub-tabs {\n\
  display: flex !important;\n\
  flex-wrap: nowrap !important;\n\
  overflow-x: auto !important;\n\
  overflow-y: hidden !important;\n\
  gap: 8px !important;\n\
  padding: 9px 10px !important;\n\
  border-bottom: 1px solid rgba(255,255,255,.08) !important;\n\
  background: rgba(255,255,255,.03) !important;\n\
  -webkit-overflow-scrolling: touch !important;\n\
  scrollbar-width: none !important;\n\
}\n\
.warhub-tabs::-webkit-scrollbar {\n\
  display: none !important;\n\
}\n\
\n\
.warhub-body {\n\
  flex: 1 1 auto !important;\n\
  min-height: 0 !important;\n\
  overflow: auto !important;\n\
  padding: 10px !important;\n\
}\n\
\n\
.warhub-status-wrap {\n\
  margin: 0 0 10px !important;\n\
}\n\
\n\
.warhub-grid {\n\
  display: grid !important;\n\
  gap: 10px !important;\n\
}\n\
\n\
.warhub-card {\n\
  background: rgba(255,255,255,.04) !important;\n\
  border: 1px solid rgba(255,255,255,.08) !important;\n\
  border-radius: 12px !important;\n\
  padding: 10px !important;\n\
  box-shadow: inset 0 1px 0 rgba(255,255,255,.03) !important;\n\
}\n\
\n\
.warhub-card h3,\n\
.warhub-card h4 {\n\
  margin: 0 0 8px !important;\n\
  color: #fff !important;\n\
}\n\
\n\
.warhub-muted {\n\
  opacity: .72 !important;\n\
}\n\
\n\
.warhub-row {\n\
  display: flex !important;\n\
  align-items: center !important;\n\
  gap: 8px !important;\n\
  flex-wrap: wrap !important;\n\
}\n\
\n\
.warhub-col {\n\
  display: flex !important;\n\
  flex-direction: column !important;\n\
  gap: 8px !important;\n\
}\n\
\n\
.warhub-space {\n\
  height: 8px !important;\n\
}\n\
\n\
.warhub-label {\n\
  font-size: 12px !important;\n\
  font-weight: 700 !important;\n\
  opacity: .85 !important;\n\
}\n\
\n\
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
  font-size: 14px !important;\n\
}\n\
\n\
.warhub-textarea {\n\
  min-height: 110px !important;\n\
  resize: vertical !important;\n\
}\n\
\n\
.warhub-btn {\n\
  appearance: none !important;\n\
  -webkit-appearance: none !important;\n\
  border: 1px solid rgba(255,255,255,.12) !important;\n\
  background: linear-gradient(180deg, rgba(220,50,50,.95), rgba(145,18,18,.98)) !important;\n\
  color: #fff !important;\n\
  border-radius: 10px !important;\n\
  padding: 9px 12px !important;\n\
  min-height: 36px !important;\n\
  font-size: 13px !important;\n\
  font-weight: 800 !important;\n\
  cursor: pointer !important;\n\
}\n\
.warhub-btn.ghost {\n\
  background: rgba(255,255,255,.08) !important;\n\
}\n\
.warhub-btn.gray {\n\
  background: rgba(255,255,255,.10) !important;\n\
}\n\
.warhub-btn.green {\n\
  background: linear-gradient(180deg, rgba(42,168,95,.98), rgba(21,120,64,.98)) !important;\n\
}\n\
.warhub-btn.warn {\n\
  background: linear-gradient(180deg, rgba(226,154,27,.98), rgba(163,102,8,.98)) !important;\n\
}\n\
\n\
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
.warhub-pill.good {\n\
  background: rgba(36,140,82,.35) !important;\n\
}\n\
.warhub-pill.bad {\n\
  background: rgba(170,32,32,.35) !important;\n\
}\n\
.warhub-pill.neutral {\n\
  background: rgba(255,255,255,.08) !important;\n\
}\n\
.warhub-pill.online {\n\
  background: rgba(42,168,95,.35) !important;\n\
}\n\
.warhub-pill.idle {\n\
  background: rgba(197,142,32,.35) !important;\n\
}\n\
.warhub-pill.travel {\n\
  background: rgba(66,124,206,.35) !important;\n\
}\n\
.warhub-pill.jail {\n\
  background: rgba(120,85,160,.35) !important;\n\
}\n\
.warhub-pill.hospital {\n\
  background: rgba(199,70,70,.35) !important;\n\
}\n\
.warhub-pill.offline {\n\
  background: rgba(105,105,105,.35) !important;\n\
}\n\
\n\
.warhub-kv {\n\
  display: grid !important;\n\
  grid-template-columns: 1fr auto !important;\n\
  gap: 8px !important;\n\
  align-items: center !important;\n\
  padding: 8px 0 !important;\n\
  border-bottom: 1px solid rgba(255,255,255,.05) !important;\n\
}\n\
.warhub-kv:last-child {\n\
  border-bottom: 0 !important;\n\
}\n\
\n\
.warhub-member-group {\n\
  border: 1px solid rgba(255,255,255,.08) !important;\n\
  border-radius: 12px !important;\n\
  overflow: hidden !important;\n\
  background: rgba(255,255,255,.03) !important;\n\
}\n\
\n\
.warhub-member-group-head {\n\
  display: flex !important;\n\
  align-items: center !important;\n\
  justify-content: space-between !important;\n\
  gap: 8px !important;\n\
  padding: 10px !important;\n\
  background: rgba(255,255,255,.05) !important;\n\
  cursor: pointer !important;\n\
}\n\
\n\
.warhub-member-list {\n\
  display: flex !important;\n\
  flex-direction: column !important;\n\
}\n\
\n\
.warhub-member-row {\n\
  display: flex !important;\n\
  flex-direction: column !important;\n\
  gap: 8px !important;\n\
  padding: 10px !important;\n\
  border-top: 1px solid rgba(255,255,255,.06) !important;\n\
}\n\
\n\
.warhub-member-main {\n\
  display: flex !important;\n\
  align-items: center !important;\n\
  justify-content: space-between !important;\n\
  gap: 8px !important;\n\
  flex-wrap: wrap !important;\n\
}\n\
\n\
.warhub-member-name {\n\
  font-weight: 800 !important;\n\
  color: #fff !important;\n\
  text-decoration: none !important;\n\
}\n\
\n\
.warhub-statline {\n\
  display: flex !important;\n\
  align-items: center !important;\n\
  gap: 10px !important;\n\
  flex-wrap: wrap !important;\n\
  font-size: 12px !important;\n\
  opacity: .95 !important;\n\
}\n\
\n\
.warhub-spy-box {\n\
  width: 100% !important;\n\
  border-radius: 10px !important;\n\
  background: rgba(0,0,0,.25) !important;\n\
  border: 1px solid rgba(255,255,255,.08) !important;\n\
  padding: 8px !important;\n\
  font-size: 12px !important;\n\
}\n\
\n\
.warhub-hero-card {\n\
  padding: 12px !important;\n\
  border-radius: 14px !important;\n\
  background: linear-gradient(180deg, rgba(160,18,18,.20), rgba(255,255,255,.03)) !important;\n\
  border: 1px solid rgba(255,255,255,.08) !important;\n\
}\n\
\n\
.warhub-mini-grid {\n\
  display: grid !important;\n\
  grid-template-columns: repeat(2, minmax(0, 1fr)) !important;\n\
  gap: 8px !important;\n\
}\n\
\n\
.warhub-section-scroll {\n\
  max-height: 38vh !important;\n\
  overflow: auto !important;\n\
}\n\
\n\
@media (max-width: 520px) {\n\
  #warhub-overlay {\n\
    width: min(98vw, 520px) !important;\n\
    right: 1vw !important;\n\
    top: 160px !important;\n\
  }\n\
  .warhub-mini-grid {\n\
    grid-template-columns: 1fr !important;\n\
  }\n\
  .warhub-section-scroll {\n\
    max-height: 34vh !important;\n\
  }\n\
  .warhub-tabs {\n\
    min-height: 50px !important;\n\
    max-height: 50px !important;\n\
    padding: 8px 6px !important;\n\
    gap: 6px !important;\n\
  }\n\
  .warhub-tab {\n\
    font-size: 12px !important;\n\
    padding: 8px 10px !important;\n\
    min-height: 34px !important;\n\
  }\n\
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
        return Number.isFinite(n) ? "$".concat(n.toLocaleString()) : '—';
    }

    function fmtHosp(v, txt) {
        if (txt) return txt;
        var n = Number(v);
        return Number.isFinite(n) && n > 0 ? "".concat(n, "s") : '—';
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
            var self = this, args = arguments;
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
                    resolve({
                        ok: false,
                        status: 0,
                        json: null,
                        text: ''
                    });
                },
                ontimeout: function () {
                    resolve({
                        ok: false,
                        status: 0,
                        json: null,
                        text: ''
                    });
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
        return {
            w: Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0),
            h: Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0)
        };
    }

    function clamp(n, min, max) {
        return Math.max(min, Math.min(max, n));
    }

    function loadPos(key, fallback) {
        var raw = GM_getValue(key, null);
        if (!raw || typeof raw !== 'object') return Object.assign({}, fallback);
        return {
            left: Number.isFinite(Number(raw.left)) ? Number(raw.left) : fallback.left,
            top: Number.isFinite(Number(raw.top)) ? Number(raw.top) : fallback.top
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
        var vp = getViewport();
        var pos = loadPos(K_SHIELD_POS, { left: vp.w - 56, top: 120 });
        var left = clamp(pos.left, 6, vp.w - 48);
        var top = clamp(pos.top, 6, vp.h - 48);

        shield.style.left = left + 'px';
        shield.style.top = top + 'px';
        shield.style.right = 'auto';
        shield.style.bottom = 'auto';

        savePos(K_SHIELD_POS, { left: left, top: top });
        positionBadge();
    }

    function applyOverlayPos() {
        if (!overlay) return;
        var vp = getViewport();
        var fallback = { left: Math.max(6, vp.w - Math.min(vp.w * 0.96, 520) - 12), top: 170 };
        var pos = loadPos(K_OVERLAY_POS, fallback);

        var width = overlay.offsetWidth || Math.min(vp.w * 0.96, 520);
        var height = overlay.offsetHeight || Math.min(vp.h * 0.88, 900);

        var left = clamp(pos.left, 4, Math.max(4, vp.w - width - 4));
        var top = clamp(pos.top, 4, Math.max(4, vp.h - height - 4));

        overlay.style.left = left + 'px';
        overlay.style.top = top + 'px';
        overlay.style.right = 'auto';
        overlay.style.bottom = 'auto';

        savePos(K_OVERLAY_POS, { left: left, top: top });
    }

    function positionBadge() {
        if (!badge || !shield) return;
        var rect = shield.getBoundingClientRect();
        badge.style.left = Math.round(rect.right - 6) + 'px';
        badge.style.top = Math.round(rect.top - 6) + 'px';
    }

    function makeDraggable(handle, target, key) {
        if (!handle || !target) return;

        var dragging = false;
        var startX = 0;
        var startY = 0;
        var startLeft = 0;
        var startTop = 0;

        function onStart(clientX, clientY) {
            dragging = true;
            dragMoved = false;
            startX = clientX;
            startY = clientY;

            var rect = target.getBoundingClientRect();
            startLeft = rect.left;
            startTop = rect.top;

            handle.classList.add('dragging');
        }

        function onMove(clientX, clientY) {
            if (!dragging) return;

            var dx = clientX - startX;
            var dy = clientY - startY;

            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragMoved = true;

            var vp = getViewport();
            var width = target.offsetWidth || 40;
            var height = target.offsetHeight || 40;

            var left = clamp(startLeft + dx, 4, Math.max(4, vp.w - width - 4));
            var top = clamp(startTop + dy, 4, Math.max(4, vp.h - height - 4));

            target.style.left = left + 'px';
            target.style.top = top + 'px';
            target.style.right = 'auto';
            target.style.bottom = 'auto';

            if (key) savePos(key, { left: left, top: top });
            if (target === shield) positionBadge();
        }

        function onEnd() {
            if (!dragging) return;
            dragging = false;
            handle.classList.remove('dragging');
            setTimeout(function () {
                dragMoved = false;
            }, 0);
        }

        handle.addEventListener('mousedown', function (e) {
            if (e.button !== 0) return;
            onStart(e.clientX, e.clientY);
            e.preventDefault();
        });

        document.addEventListener('mousemove', function (e) {
            onMove(e.clientX, e.clientY);
        });

        document.addEventListener('mouseup', function () {
            onEnd();
        });

        handle.addEventListener('touchstart', function (e) {
            if (!e.touches || !e.touches.length) return;
            var t = e.touches[0];
            onStart(t.clientX, t.clientY);
        }, { passive: true });

        document.addEventListener('touchmove', function (e) {
            if (!e.touches || !e.touches.length) return;
            var t = e.touches[0];
            onMove(t.clientX, t.clientY);
        }, { passive: true });

        document.addEventListener('touchend', function () {
            onEnd();
        });
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
                renderBody();
                return null;
            }

            var res = yield authedReq('GET', '/api/state');
            if (!res.ok) {
                if (res.status === 401 || res.status === 403) {
                    GM_deleteValue(K_SESSION);
                    state = null;
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

            if (state.war && typeof state.war === 'object') {
                warEnemiesFactionId = String(state.war.enemy_faction_id || '');
                warEnemiesFactionName = String(state.war.enemy_faction_name || '');
            } else {
                warEnemiesFactionId = '';
                warEnemiesFactionName = '';
            }

            if (Array.isArray(state.enemies)) {
                warEnemiesCache = state.enemies.slice();
                warEnemiesLoadedAt = Date.now();
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

            state = res.json;
            currentFactionMembers = arr(state.members);
            factionMembersCache = currentFactionMembers.slice();
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

            if (!force && warEnemiesCache && warEnemiesCache.length && (Date.now() - warEnemiesLoadedAt) < 15000) {
                return warEnemiesCache;
            }

            var res = yield authedReq('GET', '/api/enemies');
            if (!res.ok || !res.json) return warEnemiesCache || [];

            var payload = res.json || {};
            var enemies = arr(payload.enemies);

            warEnemiesCache = enemies.slice();
            warEnemiesFactionId = String(payload.enemy_faction_id || warEnemiesFactionId || '');
            warEnemiesFactionName = String(payload.enemy_faction_name || warEnemiesFactionName || '');
            warEnemiesLoadedAt = Date.now();

            state = state || {};
            state.enemies = enemies.slice();
            state.war = Object.assign({}, state.war || {}, {
                enemy_faction_id: warEnemiesFactionId,
                enemy_faction_name: warEnemiesFactionName
            });

            return warEnemiesCache;
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

    // ============================================================
    // 13. TAB / POLLING FLOW
    // ============================================================

    function tabNeedsLivePolling(tab) {
        return tab === 'summary' || tab === 'enemies';
    }

    function restartPolling() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }

        var refreshMs = Number(GM_getValue(K_REFRESH, 30000) || 30000);
        if (!Number.isFinite(refreshMs) || refreshMs < 5000) refreshMs = 5000;

        pollTimer = setInterval(function () {
            tick();
        }, refreshMs);
    }

    function restartPollingForCurrentTab() {
        restartPolling();
    }

    function tick() {
        return _tick.apply(this, arguments);
    }

    function _tick() {
        _tick = _asyncToGenerator(function* () {
            if (loadInFlight) return;
            if (!isLoggedIn()) return;

            loadInFlight = true;
            try {
                yield loadState();

                if (tabNeedsLivePolling(currentTab)) {
                    yield tickCurrentTab();
                }

                if (canManageFaction()) {
                    yield refreshFactionPaymentData();
                }

                if (canSeeAdmin() && currentTab === 'admin') {
                    yield loadAdminDashboard(true);
                    yield loadAdminTopFive(true);
                }

                renderBody();
            } catch (err) {
                console.error('War Hub tick error:', err);
            } finally {
                loadInFlight = false;
            }
        });
        return _tick.apply(this, arguments);
    }

    function tickCurrentTab() {
        return _tickCurrentTab.apply(this, arguments);
    }

    function _tickCurrentTab() {
        _tickCurrentTab = _asyncToGenerator(function* () {
            if (!isLoggedIn()) return;

            try {
                if (currentTab === 'summary') {
                    yield loadLiveSummary(true);
                    return;
                }

                if (currentTab === 'enemies') {
                    yield loadWarData(true);
                    yield loadEnemies(true);
                    return;
                }
            } catch (err) {
                console.error('War Hub tab tick error:', err);
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

            try {
                if (currentTab === 'members') {
                    yield loadFactionMembers(true);
                    membersLiveStamp = Date.now();
                } else if (currentTab === 'enemies') {
                    yield loadWarData(true);
                    yield loadEnemies(true);
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
                    yield loadState();
                }
            } catch (err) {
                console.error('War Hub tab load error:', err);
            }

            renderBody();
            restartPollingForCurrentTab();
        });
        return _handleTabClick.apply(this, arguments);
    }

    // ============================================================
    // 14. OVERLAY MOUNT / DOM
    // ============================================================

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

        makeDraggable(shield, shield, K_SHIELD_POS);
        makeDraggable(overlay.querySelector('#warhub-head'), overlay, K_OVERLAY_POS);

        shield.addEventListener('click', function () {
            if (dragMoved) return;
            toggleOverlay();
        });

        overlay.querySelector('#warhub-close').addEventListener('click', function () {
            setOverlayOpen(false);
        });

        overlay.addEventListener('click', function (e) {
            var tabBtn = e.target.closest('[data-tab]');
            if (tabBtn) {
                handleTabClick(tabBtn.getAttribute('data-tab'));
                return;
            }

            var act = e.target.closest('[data-action]');
            if (act) {
                handleActionClick(act);
                return;
            }

            var groupHead = e.target.closest('[data-group-toggle]');
            if (groupHead) {
                var key = groupHead.getAttribute('data-group-toggle');
                toggleGroup(key);
                return;
            }
        });

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
            renderBody();
        }
    }

    function toggleOverlay() {
        setOverlayOpen(!isOpen);
    }

    function ensureMounted() {
        if (document.body && !mounted) {
            mount();
        }
    }

    // ============================================================
    // 15. GROUP COLLAPSE STATE
    // ============================================================

    function getGroupState() {
        var raw = GM_getValue('warhub_group_state_v1', null);
        return raw && typeof raw === 'object' ? raw : {};
    }

    function setGroupState(v) {
        GM_setValue('warhub_group_state_v1', v && typeof v === 'object' ? v : {});
    }

    function isGroupOpen(key, defaultOpen) {
        var st = getGroupState();
        if (typeof st[key] === 'boolean') return st[key];
        return !!defaultOpen;
    }

    function toggleGroup(key) {
        var st = getGroupState();
        st[key] = !isGroupOpen(key, true);
        setGroupState(st);
        renderBody();
    }

    // ============================================================
    // 16. RENDER SHELL
    // ============================================================

    function renderTabsInto(el, row) {
        if (!el) return;
        var visible = getVisibleTabs(row);

        el.innerHTML = visible.map(function (pair) {
            var key = pair[0];
            var label = pair[1];
            var active = currentTab === key ? ' active' : '';
            return '<button type="button" class="warhub-tab' + active + '" data-tab="' + esc(key) + '">' + esc(label) + '</button>';
        }).join('');
    }

    function renderBody() {
        if (!overlay) return;

        renderTabsInto(overlay.querySelector('#warhub-tabs-row-1'), TAB_ROW_1);
        renderTabsInto(overlay.querySelector('#warhub-tabs-row-2'), TAB_ROW_2);
        renderStatus();

        var content = overlay.querySelector('#warhub-content');
        if (!content) return;

        if (!isLoggedIn()) {
            stopMembersCountdownLoop();
            content.innerHTML = renderLoginView();
            return;
        }

        if (currentTab === 'overview') {
            stopMembersCountdownLoop();
            content.innerHTML = renderOverviewTab();
        } else if (currentTab === 'members') {
            content.innerHTML = renderMembersTab();
            startMembersCountdownLoop();
            tickMembersCountdowns();
        } else if (currentTab === 'enemies') {
            stopMembersCountdownLoop();
            content.innerHTML = renderEnemiesTab();
        } else if (currentTab === 'hospital') {
            stopMembersCountdownLoop();
            content.innerHTML = renderHospitalTab();
        } else if (currentTab === 'chain') {
            stopMembersCountdownLoop();
            content.innerHTML = renderChainTab();
        } else if (currentTab === 'targets') {
            stopMembersCountdownLoop();
            content.innerHTML = renderTargetsTab();
        } else if (currentTab === 'meddeals') {
            stopMembersCountdownLoop();
            content.innerHTML = renderMedDealsTab();
        } else if (currentTab === 'terms') {
            stopMembersCountdownLoop();
            content.innerHTML = renderTermsTab();
        } else if (currentTab === 'summary') {
            stopMembersCountdownLoop();
            content.innerHTML = renderSummaryTab();
        } else if (currentTab === 'faction') {
            stopMembersCountdownLoop();
            content.innerHTML = renderFactionTab();
        } else if (currentTab === 'settings') {
            stopMembersCountdownLoop();
            content.innerHTML = renderSettingsTab();
        } else if (currentTab === 'instructions') {
            stopMembersCountdownLoop();
            content.innerHTML = renderInstructionsTab();
        } else if (currentTab === 'wartop5') {
            stopMembersCountdownLoop();
            content.innerHTML = renderWarTop5Tab();
        } else if (currentTab === 'admin') {
            stopMembersCountdownLoop();
            content.innerHTML = renderAdminTab();
        } else {
            stopMembersCountdownLoop();
            content.innerHTML = renderOverviewTab();
        }

        renderStatus();
    }

    // ============================================================
    // 17. COMMON FORMAT HELPERS
    // ============================================================

    function stateLabel(member) {
        var s = String(
            member && (
                member.presence ||
                member.status_state ||
                member.status ||
                member.state
            ) || ''
        ).toLowerCase();

        if (s.indexOf('online') >= 0) return 'online';
        if (s.indexOf('idle') >= 0) return 'idle';
        if (s.indexOf('travel') >= 0) return 'travel';
        if (s.indexOf('jail') >= 0) return 'jail';
        if (s.indexOf('hospital') >= 0) return 'hospital';
        return 'offline';
    }

    function humanStateLabel(key) {
        key = String(key || '').toLowerCase();
        if (key === 'online') return 'Online';
        if (key === 'idle') return 'Idle';
        if (key === 'travel') return 'Travel';
        if (key === 'jail') return 'Jail';
        if (key === 'hospital') return 'Hospital';
        return 'Offline';
    }

    function getMemberId(member) {
        return String(
            (member && (
                member.user_id ||
                member.id ||
                member.player_id
            )) || ''
        );
    }

    function getMemberName(member) {
        return String(
            (member && (
                member.name ||
                member.username ||
                member.player_name
            )) || 'Unknown'
        );
    }

    function profileUrl(member) {
        var id = getMemberId(member);
        return id ? 'https://www.torn.com/profiles.php?XID=' + encodeURIComponent(id) : '#';
    }

    function attackUrl(member) {
        var id = getMemberId(member);
        return id ? 'https://www.torn.com/loader.php?sid=attack&user2ID=' + encodeURIComponent(id) : '#';
    }

    function bountyUrl(member) {
        var id = getMemberId(member);
        return id ? 'https://www.torn.com/bounties.php?p=add&userID=' + encodeURIComponent(id) : '#';
    }

    function memberSearchText(member) {
        return [
            getMemberName(member),
            getMemberId(member),
            String(member && member.position || ''),
            String(member && member.status || ''),
            String(member && member.presence || ''),
            String(member && member.status_detail || '')
        ].join(' ').toLowerCase();
    }

    function shortCd(secs, readyLabel) {
        var n = Number(secs || 0);
        if (!Number.isFinite(n) || n <= 0) return readyLabel || 'Ready';
        return formatCountdown(n);
    }

    function medCdValue(member) {
        return Number(
            (member && (
                member.med_cd ||
                member.medical_cd ||
                member.medical_cooldown ||
                member.drug_cd
            )) || 0
        ) || 0;
    }

    function lifeText(member) {
        var cur = Number(member && (member.life_current || member.life || member.hp || 0)) || 0;
        var max = Number(member && (member.life_max || member.max_life || 0)) || 0;
        if (max > 0) return cur.toLocaleString() + '/' + max.toLocaleString();
        return cur > 0 ? cur.toLocaleString() : '—';
    }

    function energyText(member) {
        var cur = Number(member && (member.energy_current || member.energy || 0)) || 0;
        var max = Number(member && (member.energy_max || 150)) || 150;
        if (max > 0) return cur.toLocaleString() + '/' + max.toLocaleString();
        return cur > 0 ? cur.toLocaleString() : '—';
    }

    function statusCountdownValue(member) {
        return Number(
            (member && (
                member.status_until_seconds ||
                member.until ||
                member.seconds_left ||
                member.hospital_seconds ||
                member.jail_seconds ||
                member.travel_seconds
            )) || 0
        ) || 0;
    }

    function spyText(member) {
        if (!member) return '';
        if (member.spy_report) return String(member.spy_report);
        if (member.spy && typeof member.spy === 'object') {
            var parts = [];
            if (member.spy.total) parts.push('Total: ' + fmtNum(member.spy.total));
            if (member.spy.strength) parts.push('STR: ' + fmtNum(member.spy.strength));
            if (member.spy.speed) parts.push('SPD: ' + fmtNum(member.spy.speed));
            if (member.spy.dexterity) parts.push('DEX: ' + fmtNum(member.spy.dexterity));
            if (member.spy.defense) parts.push('DEF: ' + fmtNum(member.spy.defense));
            return parts.join(' | ');
        }
        return '';
    }

    function sortMembersByName(items) {
        return arr(items).slice().sort(function (a, b) {
            return getMemberName(a).localeCompare(getMemberName(b));
        });
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
            var key = stateLabel(m);
            if (!grouped[key]) key = 'offline';
            grouped[key].push(m);
        });

        Object.keys(grouped).forEach(function (k) {
            grouped[k] = sortMembersByName(grouped[k]);
        });

        return grouped;
    }

    function renderGroupBlock(key, items, renderRowFn, defaultOpen) {
    var list = arr(items);
    var open = isGroupOpen(key, defaultOpen);
    var labelKey = String(key || '').replace(/^members_/, '').replace(/^enemies_/, '').replace(/^hospital_/, '');

    return [
        '<div class="warhub-member-group">',
            '<div class="warhub-member-group-head" data-group-toggle="' + esc(key) + '">',
                '<div class="warhub-row">',
                    '<span class="warhub-pill ' + esc(labelKey) + '">' + esc(humanStateLabel(labelKey)) + '</span>',
                    '<span class="warhub-muted">' + esc(String(list.length)) + '</span>',
                '</div>',
                '<div class="warhub-muted">' + (open ? 'Hide' : 'Show') + '</div>',
            '</div>',
            open ? '<div class="warhub-member-list">' + list.map(renderRowFn).join('') + '</div>' : '',
        '</div>'
    ].join('');
}
    function renderMemberRow(member) {
    var id = getMemberId(member);
    var name = getMemberName(member);
    var st = stateLabel(member);
    var med = medCdValue(member);
    var statusCd = statusCountdownValue(member);
    var pos = String(member && (member.position || member.role || '') || '').trim();

    return [
        '<div class="warhub-member-row" data-state-name="' + esc(st) + '" data-medcd-base="' + esc(String(med)) + '" data-statuscd-base="' + esc(String(statusCd)) + '">',
            '<div class="warhub-member-main">',
                '<div class="warhub-row">',
                    '<a class="warhub-member-name" href="' + esc(profileUrl(member)) + '" target="_blank" rel="noopener noreferrer">' + esc(name) + '</a>',
                    id ? '<span class="warhub-pill neutral">#' + esc(id) + '</span>' : '',
                    pos ? '<span class="warhub-pill neutral">' + esc(pos) + '</span>' : '',
                    '<span class="warhub-pill ' + esc(st) + '" data-statuscd>' + esc(humanStateLabel(st)) + '</span>',
                '</div>',
                '<div class="warhub-row">',
                    '<a class="warhub-btn ghost" href="' + esc(bountyUrl(member)) + '" target="_blank" rel="noopener noreferrer">Bounty</a>',
                '</div>',
            '</div>',
            '<div class="warhub-statline">',
                '<span>⚡ ' + esc(energyText(member)) + '</span>',
                '<span>✚ ' + esc(lifeText(member)) + '</span>',
                '<span>💊 <span data-medcd>' + esc(shortCd(med, 'Ready')) + '</span></span>',
            '</div>',
        '</div>'
    ].join('');
}

    function renderEnemyRow(member) {
        var id = getMemberId(member);
        var name = getMemberName(member);
        var st = stateLabel(member);
        var spy = spyText(member);

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
    var access = normalizeAccessCache((state && state.access) || accessState);
    var war = (state && state.war) || {};
    var license = (state && state.license) || {};
    var viewer = (state && state.viewer) || {};
    var ownFaction = (state && state.faction) || {};
    var ownName = String(ownFaction.name || license.faction_name || 'Your Faction');
    var enemyName = String(war.enemy_faction_name || 'No current enemy');
    var memberCount = arr((state && state.members) || []).length;
    var enemyCount = arr((state && state.enemies) || []).length;

    return [
        '<div class="warhub-grid">',

            '<div class="warhub-hero-card">',
                '<div class="warhub-title">War Overview</div>',
                '<div class="warhub-sub">' + esc(ownName) + (enemyName && enemyName !== 'No current enemy' ? ' vs ' + esc(enemyName) : '') + '</div>',
            '</div>',

            '<div class="warhub-mini-grid">',
                '<div class="warhub-card">',
                    '<h3>Your Faction</h3>',
                    '<div class="warhub-kv"><div>Name</div><div>' + esc(ownName) + '</div></div>',
                    '<div class="warhub-kv"><div>Faction ID</div><div>' + esc(String(ownFaction.faction_id || license.faction_id || '—')) + '</div></div>',
                    '<div class="warhub-kv"><div>Loaded members</div><div>' + esc(String(memberCount)) + '</div></div>',
                '</div>',

                '<div class="warhub-card">',
                    '<h3>Enemy Faction</h3>',
                    '<div class="warhub-kv"><div>Name</div><div>' + esc(enemyName) + '</div></div>',
                    '<div class="warhub-kv"><div>Faction ID</div><div>' + esc(String(war.enemy_faction_id || '—')) + '</div></div>',
                    '<div class="warhub-kv"><div>Loaded enemies</div><div>' + esc(String(enemyCount)) + '</div></div>',
                '</div>',
            '</div>',

            '<div class="warhub-card">',
                '<h3>War Status</h3>',
                '<div class="warhub-kv"><div>War ID</div><div>' + esc(String(war.war_id || '—')) + '</div></div>',
                '<div class="warhub-kv"><div>Phase</div><div>' + esc(String(war.war_phase || war.phase || '—')) + '</div></div>',
                '<div class="warhub-kv"><div>Type</div><div>' + esc(String(war.war_type || '—')) + '</div></div>',
                '<div class="warhub-kv"><div>Can use features</div><div>' + (canUseFeatures() ? 'Yes' : 'No') + '</div></div>',
            '</div>',

            '<div class="warhub-card">',
                '<h3>Access</h3>',
                '<div class="warhub-kv"><div>Status</div><div>' + esc(access.status || '—') + '</div></div>',
                '<div class="warhub-kv"><div>Message</div><div>' + esc(access.message || '—') + '</div></div>',
                '<div class="warhub-kv"><div>Leader</div><div>' + (access.is_faction_leader ? 'Yes' : 'No') + '</div></div>',
                '<div class="warhub-kv"><div>Member enabled</div><div>' + (access.member_enabled ? 'Yes' : 'No') + '</div></div>',
                '<div class="warhub-kv"><div>User exempt</div><div>' + (access.is_user_exempt ? 'Yes' : 'No') + '</div></div>',
                '<div class="warhub-kv"><div>Faction exempt</div><div>' + (access.is_faction_exempt ? 'Yes' : 'No') + '</div></div>',
            '</div>',

            '<div class="warhub-card">',
                '<h3>Viewer</h3>',
                '<div class="warhub-kv"><div>Name</div><div>' + esc(String(viewer.name || '—')) + '</div></div>',
                '<div class="warhub-kv"><div>User ID</div><div>' + esc(String(viewer.user_id || '—')) + '</div></div>',
                '<div class="warhub-kv"><div>Payment player</div><div>' + esc(String(license.payment_player || PAYMENT_PLAYER)) + '</div></div>',
                '<div class="warhub-kv"><div>Price per member</div><div>' + esc(String(license.payment_per_member || PRICE_PER_MEMBER)) + ' Xanax</div></div>',
                '<div class="warhub-kv"><div>Enabled members</div><div>' + esc(String(license.enabled_member_count || 0)) + '</div></div>',
                '<div class="warhub-kv"><div>Renewal cost</div><div>' + esc(String(license.renewal_cost || 0)) + ' Xanax</div></div>',
                '<div class="warhub-kv"><div>Paid until</div><div>' + esc(fmtTs(license.paid_until_at)) + '</div></div>',
            '</div>',

        '</div>'
    ].join('');
}
    function renderMembersTab() {
    var members = arr((state && state.members) || currentFactionMembers || factionMembersCache || []);
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
                '<div class="warhub-sub">Own faction only</div>',
            '</div>',

            '<div class="warhub-card">',
                '<div class="warhub-row">',
                    '<input id="warhub-members-search" class="warhub-input" type="text" value="' + esc(search) + '" placeholder="Search name, ID, status, position" />',
                    '<button type="button" class="warhub-btn ghost" data-action="members-refresh">Refresh</button>',
                '</div>',
                '<div class="warhub-space"></div>',
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
        var enemies = arr((state && state.enemies) || warEnemiesCache || []);
        var war = (state && state.war) || {};
        var enemyFactionName = String(war.enemy_faction_name || warEnemiesFactionName || 'Enemy Faction');
        var search = String(GM_getValue('warhub_enemies_search', '') || '').trim().toLowerCase();

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
                    '<div class="warhub-kv"><div>Enemy faction ID</div><div>' + esc(String(war.enemy_faction_id || warEnemiesFactionId || '—')) + '</div></div>',
                    '<div class="warhub-kv"><div>Loaded members</div><div>' + esc(String(filtered.length)) + '</div></div>',
                '</div>',

                '<div class="warhub-card">',
                    '<div class="warhub-row">',
                        '<input id="warhub-enemies-search" class="warhub-input" type="text" value="' + esc(search) + '" placeholder="Search enemy name or ID" />',
                        '<button type="button" class="warhub-btn ghost" data-action="enemies-refresh">Refresh</button>',
                    '</div>',
                '</div>',

                enemies.length ? [
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
    // 19. TAB RENDERS: HOSPITAL / CHAIN / TARGETS / MED DEALS
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

        return [
            '<div class="warhub-grid">',
                '<div class="warhub-hero-card">',
                    '<div class="warhub-title">Targets</div>',
                    '<div class="warhub-sub">Shared target tools</div>',
                '</div>',
                targets.length ? [
                    '<div class="warhub-card warhub-col">',
                        targets.map(function (t) {
                            return [
                                '<div class="warhub-member-row">',
                                    '<div class="warhub-member-main">',
                                        '<div class="warhub-row">',
                                            '<span class="warhub-member-name">' + esc(String(t.name || 'Target')) + '</span>',
                                            t.user_id ? '<span class="warhub-pill neutral">#' + esc(String(t.user_id)) + '</span>' : '',
                                        '</div>',
                                        '<div class="warhub-row">',
                                            t.user_id ? '<a class="warhub-btn" href="https://www.torn.com/loader.php?sid=attack&user2ID=' + esc(String(t.user_id)) + '" target="_blank" rel="noopener noreferrer">Attack</a>' : '',
                                        '</div>',
                                    '</div>',
                                    t.note ? '<div class="warhub-spy-box">' + esc(String(t.note)) + '</div>' : '',
                                '</div>'
                            ].join('');
                        }).join(''),
                    '</div>'
                ].join('') : '<div class="warhub-card">No targets saved.</div>',
            '</div>'
        ].join('');
    }

    function renderMedDealsTab() {
        var deals = arr((state && state.med_deals) || []);

        return [
            '<div class="warhub-grid">',
                '<div class="warhub-hero-card">',
                    '<div class="warhub-title">Med Deals</div>',
                    '<div class="warhub-sub">Shared faction med deal notes</div>',
                '</div>',
                deals.length ? [
                    '<div class="warhub-card warhub-col">',
                        deals.map(function (d) {
                            return [
                                '<div class="warhub-kv">',
                                    '<div>' + esc(String(d.name || d.user || 'Entry')) + '</div>',
                                    '<div>' + esc(String(d.amount || '—')) + '</div>',
                                '</div>',
                                d.note ? '<div class="warhub-spy-box">' + esc(String(d.note)) + '</div>' : ''
                            ].join('');
                        }).join(''),
                    '</div>'
                ].join('') : '<div class="warhub-card">No med deals saved.</div>',
            '</div>'
        ].join('');
    }

    // ============================================================
    // 20. TAB RENDERS: TERMS / SUMMARY / FACTION
    // ============================================================

    function renderTermsTab() {
        var terms = String((state && state.terms && state.terms.text) || '');
        var summary = String((state && state.terms && state.terms.summary) || '');

        if (!canManageFaction()) {
            return [
                '<div class="warhub-grid">',
                    '<div class="warhub-hero-card">',
                        '<div class="warhub-title">Terms</div>',
                        '<div class="warhub-sub">Leader/Admin managed</div>',
                    '</div>',
                    '<div class="warhub-card">',
                        '<h3>War Terms</h3>',
                        '<div>' + (terms ? esc(terms).replace(/\n/g, '<br>') : 'No terms saved.') + '</div>',
                    '</div>',
                    '<div class="warhub-card">',
                        '<h3>War Summary Notes</h3>',
                        '<div>' + (summary ? esc(summary).replace(/\n/g, '<br>') : 'No summary saved.') + '</div>',
                    '</div>',
                '</div>'
            ].join('');
        }

        return [
            '<div class="warhub-grid">',
                '<div class="warhub-hero-card">',
                    '<div class="warhub-title">Terms</div>',
                    '<div class="warhub-sub">Leader/Admin war notes</div>',
                '</div>',

                '<div class="warhub-card warhub-col">',
                    '<h3>War Terms</h3>',
                    '<textarea id="warhub-terms-text" class="warhub-textarea" placeholder="Write war terms here...">' + esc(terms) + '</textarea>',
                    '<div class="warhub-row">',
                        '<button type="button" class="warhub-btn" data-action="save-terms">Save</button>',
                        '<button type="button" class="warhub-btn gray" data-action="clear-terms">Delete</button>',
                    '</div>',
                '</div>',

                '<div class="warhub-card warhub-col">',
                    '<h3>War Summary / Improvements</h3>',
                    '<textarea id="warhub-summary-text" class="warhub-textarea" placeholder="Write war summary and needed improvements...">' + esc(summary) + '</textarea>',
                    '<div class="warhub-row">',
                        '<button type="button" class="warhub-btn" data-action="save-summary-notes">Save</button>',
                        '<button type="button" class="warhub-btn gray" data-action="clear-summary-notes">Delete</button>',
                    '</div>',
                '</div>',
            '</div>'
        ].join('');
    }

    function renderSummaryTab() {
        if (!canSeeSummary()) {
            return '<div class="warhub-card">Summary is available to faction leaders/admin only.</div>';
        }

        var data = liveSummaryCache || {};
        var metrics = data.metrics || {};
        var top = data.top || {};

        return [
            '<div class="warhub-grid">',
                '<div class="warhub-hero-card">',
                    '<div class="warhub-title">War Summary</div>',
                    '<div class="warhub-sub">Leader/Admin only</div>',
                '</div>',

                '<div class="warhub-mini-grid">',
                    '<div class="warhub-card"><h3>Total Hits</h3><div>' + esc(fmtNum(metrics.total_hits || 0)) + '</div></div>',
                    '<div class="warhub-card"><h3>Total Respect</h3><div>' + esc(fmtNum(metrics.total_respect || 0)) + '</div></div>',
                    '<div class="warhub-card"><h3>Net Respect</h3><div>' + netPill(metrics.net_respect || 0, '') + '</div></div>',
                    '<div class="warhub-card"><h3>Members Tracked</h3><div>' + esc(fmtNum(metrics.members_tracked || 0)) + '</div></div>',
                '</div>',

                '<div class="warhub-card">',
                    '<h3>Top Hitter</h3>',
                    '<div>' + esc(String((top.top_hitter && top.top_hitter.name) || '—')) + '</div>',
                    '<div class="warhub-muted">' + esc(fmtNum((top.top_hitter && top.top_hitter.hits) || 0)) + ' hits</div>',
                '</div>',

                '<div class="warhub-card">',
                    '<h3>Top Respect Gain</h3>',
                    '<div>' + esc(String((top.top_respect_gain && top.top_respect_gain.name) || '—')) + '</div>',
                    '<div class="warhub-muted">' + esc(fmtNum((top.top_respect_gain && top.top_respect_gain.respect) || 0)) + ' respect</div>',
                '</div>',

                '<div class="warhub-card">',
                    '<h3>Top Points Bleeder</h3>',
                    '<div>' + esc(String((top.top_points_bleeder && top.top_points_bleeder.name) || '—')) + '</div>',
                    '<div class="warhub-muted">' + esc(fmtNum((top.top_points_bleeder && top.top_points_bleeder.respect_lost) || 0)) + ' respect lost</div>',
                '</div>',

                liveSummaryError ? '<div class="warhub-card">' + esc(liveSummaryError) + '</div>' : '',
            '</div>'
        ].join('');
    }

    function renderFactionTab() {
        if (!canManageFaction()) {
            return '<div class="warhub-card">Faction management is available to faction leaders/admin only.</div>';
        }

        var license = (state && state.license) || {};
        var members = arr((state && state.members) || currentFactionMembers || []);
        var enabledMap = {};
        arr(license.enabled_members || []).forEach(function (x) {
            enabledMap[String(x)] = true;
        });

        return [
            '<div class="warhub-grid">',
                '<div class="warhub-hero-card">',
                    '<div class="warhub-title">Faction</div>',
                    '<div class="warhub-sub">Leader/Admin member activation and billing</div>',
                '</div>',

                '<div class="warhub-card">',
                    '<div class="warhub-kv"><div>Payment player</div><div>' + esc(String(license.payment_player || PAYMENT_PLAYER)) + '</div></div>',
                    '<div class="warhub-kv"><div>Per member</div><div>' + esc(String(license.payment_per_member || PRICE_PER_MEMBER)) + ' Xanax</div></div>',
                    '<div class="warhub-kv"><div>Enabled members</div><div>' + esc(String(license.enabled_member_count || 0)) + '</div></div>',
                    '<div class="warhub-kv"><div>Renewal cost</div><div>' + esc(String(license.renewal_cost || 0)) + ' Xanax</div></div>',
                    '<div class="warhub-kv"><div>Paid until</div><div>' + esc(fmtTs(license.paid_until_at)) + '</div></div>',
                '</div>',

                '<div class="warhub-card warhub-col">',
                    '<h3>Faction Members</h3>',
                    members.map(function (m) {
                        var id = getMemberId(m);
                        var enabled = !!enabledMap[String(id)] || !!m.enabled || !!m.member_enabled;

                        return [
                            '<div class="warhub-member-row">',
                                '<div class="warhub-member-main">',
                                    '<div class="warhub-row">',
                                        '<a class="warhub-member-name" href="' + esc(profileUrl(m)) + '" target="_blank" rel="noopener noreferrer">' + esc(getMemberName(m)) + '</a>',
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
                    '<div class="warhub-sub">Quick setup and usage</div>',
                '</div>',
                '<div class="warhub-card warhub-col">',
                    '<div>1. Enter your Torn API key in Settings or Login.</div>',
                    '<div>2. Leader activates faction members in the Faction tab.</div>',
                    '<div>3. Members tab shows only your faction roster.</div>',
                    '<div>4. Enemies tab shows only the enemy faction from the current registered/active war.</div>',
                    '<div>5. Admin tools are visible only to the owner/admin session.</div>',
                '</div>',
            '</div>'
        ].join('');
    }

    function renderWarTop5Tab() {
        var data = adminTopFiveCache || {};
        var rows = arr(data.rows || data.top5 || []);

        return [
            '<div class="warhub-grid">',
                '<div class="warhub-hero-card">',
                    '<div class="warhub-title">War Top 5</div>',
                    '<div class="warhub-sub">Top performers</div>',
                '</div>',
                rows.length ? [
                    '<div class="warhub-card warhub-col">',
                        rows.map(function (r, i) {
                            return '<div class="warhub-kv"><div>#' + (i + 1) + ' ' + esc(String(r.name || '—')) + '</div><div>' + esc(fmtNum(r.value || 0)) + '</div></div>';
                        }).join(''),
                    '</div>'
                ].join('') : '<div class="warhub-card">No top 5 data loaded.</div>',
            '</div>'
        ].join('');
    }

    function renderAdminTab() {
        if (!canSeeAdmin()) {
            return '<div class="warhub-card">Admin tab is restricted.</div>';
        }

        var dash = analyticsCache || {};
        var licenses = arr(dash.licenses || []);
        var recent = arr(dash.recent || []);

        return [
            '<div class="warhub-grid">',
                '<div class="warhub-hero-card">',
                    '<div class="warhub-title">Admin</div>',
                    '<div class="warhub-sub">Owner/admin controls</div>',
                '</div>',

                '<div class="warhub-mini-grid">',
                    '<div class="warhub-card"><h3>Total Factions</h3><div>' + esc(fmtNum(dash.total_factions || 0)) + '</div></div>',
                    '<div class="warhub-card"><h3>Active Licenses</h3><div>' + esc(fmtNum(dash.active_licenses || 0)) + '</div></div>',
                    '<div class="warhub-card"><h3>Exempt Users</h3><div>' + esc(fmtNum(dash.user_exemptions || 0)) + '</div></div>',
                    '<div class="warhub-card"><h3>Exempt Factions</h3><div>' + esc(fmtNum(dash.faction_exemptions || 0)) + '</div></div>',
                '</div>',

                '<div class="warhub-card warhub-col">',
                    '<h3>Recent Activity</h3>',
                    recent.length
                        ? recent.map(function (r) {
                            return '<div class="warhub-kv"><div>' + esc(String(r.note || r.kind || 'Entry')) + '</div><div>' + esc(fmtTs(r.created_at)) + '</div></div>';
                        }).join('')
                        : '<div>No recent admin activity.</div>',
                '</div>',

                '<div class="warhub-card warhub-col">',
                    '<h3>Faction Licenses</h3>',
                    licenses.length
                        ? licenses.map(function (l) {
                            return [
                                '<div class="warhub-member-row">',
                                    '<div class="warhub-member-main">',
                                        '<div class="warhub-row">',
                                            '<span class="warhub-member-name">' + esc(String(l.faction_name || 'Unknown Faction')) + '</span>',
                                            l.faction_id ? '<span class="warhub-pill neutral">#' + esc(String(l.faction_id)) + '</span>' : '',
                                        '</div>',
                                        '<div class="warhub-row">',
                                            l.faction_id ? '<button type="button" class="warhub-btn ghost" data-action="admin-history" data-faction-id="' + esc(String(l.faction_id)) + '">History</button>' : '',
                                            l.faction_id ? '<button type="button" class="warhub-btn green" data-action="admin-renew" data-faction-id="' + esc(String(l.faction_id)) + '">Renew</button>' : '',
                                            l.faction_id ? '<button type="button" class="warhub-btn gray" data-action="admin-expire" data-faction-id="' + esc(String(l.faction_id)) + '">Expire</button>' : '',
                                        '</div>',
                                    '</div>',
                                '</div>'
                            ].join('');
                        }).join('')
                        : '<div>No faction license rows.</div>',
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

                if (action === 'logout') {
                    doLogout();
                    return;
                }

                if (action === 'members-refresh') {
                    setStatus('Refreshing members...', false);
                    yield loadFactionMembers(true);
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

                if (action === 'save-terms') {
                    var termsText = overlay && overlay.querySelector('#warhub-terms-text');
                    var terms = cleanInputValue(termsText && termsText.value);

                    var saveTermsRes = yield authedReq('POST', '/api/terms', {
                        text: terms
                    });

                    if (!saveTermsRes.ok) {
                        setStatus((saveTermsRes.json && saveTermsRes.json.error) || 'Failed to save war terms.', true);
                        return;
                    }

                    state = state || {};
                    state.terms = state.terms || {};
                    state.terms.text = terms;
                    renderBody();
                    setStatus('War terms saved.', false);
                    return;
                }

                if (action === 'clear-terms') {
                    var clearTermsRes = yield authedReq('POST', '/api/terms', {
                        text: ''
                    });

                    if (!clearTermsRes.ok) {
                        setStatus((clearTermsRes.json && clearTermsRes.json.error) || 'Failed to clear war terms.', true);
                        return;
                    }

                    state = state || {};
                    state.terms = state.terms || {};
                    state.terms.text = '';
                    renderBody();
                    setStatus('War terms cleared.', false);
                    return;
                }

                if (action === 'save-summary-notes') {
                    var summaryText = overlay && overlay.querySelector('#warhub-summary-text');
                    var summary = cleanInputValue(summaryText && summaryText.value);

                    var saveSummaryRes = yield authedReq('POST', '/api/terms/summary', {
                        summary: summary
                    });

                    if (!saveSummaryRes.ok) {
                        setStatus((saveSummaryRes.json && saveSummaryRes.json.error) || 'Failed to save summary notes.', true);
                        return;
                    }

                    state = state || {};
                    state.terms = state.terms || {};
                    state.terms.summary = summary;
                    renderBody();
                    setStatus('Summary notes saved.', false);
                    return;
                }

                if (action === 'clear-summary-notes') {
                    var clearSummaryRes = yield authedReq('POST', '/api/terms/summary', {
                        summary: ''
                    });

                    if (!clearSummaryRes.ok) {
                        setStatus((clearSummaryRes.json && clearSummaryRes.json.error) || 'Failed to clear summary notes.', true);
                        return;
                    }

                    state = state || {};
                    state.terms = state.terms || {};
                    state.terms.summary = '';
                    renderBody();
                    setStatus('Summary notes cleared.', false);
                    return;
                }

                if (action === 'activate-member') {
                    var activateUserId = el.getAttribute('data-user-id');
                    if (!activateUserId) return;

                    var activateRes = yield authedReq('POST', '/api/faction/members/activate', {
                        user_id: activateUserId
                    });

                    if (!activateRes.ok) {
                        setStatus((activateRes.json && activateRes.json.error) || 'Failed to activate member.', true);
                        return;
                    }

                    yield loadState();
                    yield loadFactionMembers(true);
                    renderBody();
                    setStatus('Member activated.', false);
                    return;
                }

                if (action === 'remove-member') {
                    var removeUserId = el.getAttribute('data-user-id');
                    if (!removeUserId) return;

                    var removeRes = yield authedReq('POST', '/api/faction/members/remove', {
                        user_id: removeUserId
                    });

                    if (!removeRes.ok) {
                        setStatus((removeRes.json && removeRes.json.error) || 'Failed to remove member.', true);
                        return;
                    }

                    yield loadState();
                    yield loadFactionMembers(true);
                    renderBody();
                    setStatus('Member removed.', false);
                    return;
                }

                if (action === 'admin-history') {
                    var historyFactionId = el.getAttribute('data-faction-id');
                    if (!historyFactionId) return;

                    var histRes = yield adminReq('GET', '/api/admin/faction-licenses/' + encodeURIComponent(historyFactionId) + '/history');
                    if (!histRes.ok) {
                        setStatus((histRes.json && histRes.json.error) || 'Failed to load history.', true);
                        return;
                    }

                    var items = arr(histRes.json && histRes.json.history);
                    pushLocalNotification('info', 'Loaded history for faction ' + historyFactionId + ' (' + items.length + ' entries)');
                    setStatus('History loaded. Check notifications.', false);
                    return;
                }

                if (action === 'admin-renew') {
                    var renewFactionId = el.getAttribute('data-faction-id');
                    if (!renewFactionId) return;

                    var renewRes = yield adminReq('POST', '/api/admin/faction-licenses/' + encodeURIComponent(renewFactionId) + '/renew', {});
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

                    var expireRes = yield adminReq('POST', '/api/admin/faction-licenses/' + encodeURIComponent(expireFactionId) + '/expire', {});
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
    // 23. INPUT BINDINGS
    // ============================================================

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
