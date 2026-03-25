// ==UserScript==
// @name         War Hub ⚔️
// @namespace    fries91-war-hub
// @version      3.2.3
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

    GM_deleteValue('warhub_shield_pos_v3');

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
    var K_PENDING_BOUNTY = 'warhub_pending_bounty_v1';

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
  touch-action: none !important;\n\
  box-shadow: 0 8px 24px rgba(0,0,0,.45) !important;\n\
  border: 1px solid rgba(255,255,255,.10) !important;\n\
  background: radial-gradient(circle at 30% 20%, rgba(220,75,75,.98), rgba(110,12,12,.98) 55%, rgba(48,6,6,.98)) !important;\n\
  color: #fff !important;\n\
  left: auto !important;\n\
  right: auto !important;\n\
  top: auto !important;\n\
  bottom: auto !important;\n\
  opacity: 1 !important;\n\
  visibility: visible !important;\n\
  pointer-events: auto !important;\n\
}\n\
#warhub-shield.dragging {\n\
  cursor: grabbing !important;\n\
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
  background: linear-gradient(180deg, rgba(220,75,75,.95), rgba(120,18,18,.95)) !important;\n\
  border-color: rgba(255,255,255,.24) !important;\n\
}\n\
\n\
.warhub-tabs {\n\
  display: flex !important;\n\
  gap: 8px !important;\n\
  overflow-x: auto !important;\n\
  padding: 10px 12px 0 !important;\n\
  flex: 0 0 auto !important;\n\
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
  padding: 12px !important;\n\
  -webkit-overflow-scrolling: touch !important;\n\
}\n\
\n\
.warhub-card {\n\
  background: rgba(255,255,255,.05) !important;\n\
  border: 1px solid rgba(255,255,255,.08) !important;\n\
  border-radius: 12px !important;\n\
  padding: 12px !important;\n\
  margin-bottom: 12px !important;\n\
}\n\
\n\
.warhub-grid {\n\
  display: grid !important;\n\
  grid-template-columns: 1fr 1fr !important;\n\
  gap: 10px !important;\n\
}\n\
\n\
.warhub-label {\n\
  font-size: 11px !important;\n\
  opacity: .75 !important;\n\
  margin-bottom: 6px !important;\n\
}\n\
\n\
.warhub-value {\n\
  font-size: 15px !important;\n\
  font-weight: 800 !important;\n\
}\n\
\n\
.warhub-input,\n\
.warhub-select,\n\
.warhub-textarea {\n\
  width: 100% !important;\n\
  border-radius: 10px !important;\n\
  border: 1px solid rgba(255,255,255,.12) !important;\n\
  background: rgba(0,0,0,.28) !important;\n\
  color: #fff !important;\n\
  padding: 10px 11px !important;\n\
  font-size: 13px !important;\n\
  outline: none !important;\n\
}\n\
\n\
.warhub-textarea {\n\
  min-height: 110px !important;\n\
  resize: vertical !important;\n\
}\n\
\n\
.warhub-actions {\n\
  display: flex !important;\n\
  flex-wrap: wrap !important;\n\
  gap: 8px !important;\n\
  margin-top: 10px !important;\n\
}\n\
\n\
.warhub-btn {\n\
  appearance: none !important;\n\
  -webkit-appearance: none !important;\n\
  border: 1px solid rgba(255,255,255,.12) !important;\n\
  border-radius: 10px !important;\n\
  background: rgba(255,255,255,.08) !important;\n\
  color: #fff !important;\n\
  padding: 9px 12px !important;\n\
  font-size: 13px !important;\n\
  font-weight: 700 !important;\n\
  cursor: pointer !important;\n\
  text-decoration: none !important;\n\
  display: inline-flex !important;\n\
  align-items: center !important;\n\
  justify-content: center !important;\n\
  min-height: 36px !important;\n\
}\n\
.warhub-btn.primary {\n\
  background: linear-gradient(180deg, rgba(220,75,75,.95), rgba(120,18,18,.95)) !important;\n\
}\n\
.warhub-btn.danger {\n\
  background: linear-gradient(180deg, rgba(190,48,48,.95), rgba(110,14,14,.95)) !important;\n\
}\n\
.warhub-btn.green {\n\
  background: linear-gradient(180deg, rgba(40,160,90,.95), rgba(20,100,55,.95)) !important;\n\
}\n\
\n\
.warhub-note {\n\
  font-size: 12px !important;\n\
  opacity: .78 !important;\n\
  margin-top: 8px !important;\n\
}\n\
\n\
.warhub-status {\n\
  margin-bottom: 12px !important;\n\
  padding: 10px 12px !important;\n\
  border-radius: 10px !important;\n\
  background: rgba(255,255,255,.05) !important;\n\
  border: 1px solid rgba(255,255,255,.08) !important;\n\
  font-size: 12px !important;\n\
}\n\
.warhub-status.error {\n\
  border-color: rgba(255,90,90,.28) !important;\n\
  background: rgba(120,18,18,.24) !important;\n\
}\n\
\n\
.warhub-empty {\n\
  opacity: .75 !important;\n\
  font-size: 12px !important;\n\
}\n\
\n\
.warhub-list {\n\
  display: flex !important;\n\
  flex-direction: column !important;\n\
  gap: 10px !important;\n\
}\n\
\n\
.warhub-member-row {\n\
  background: rgba(255,255,255,.05) !important;\n\
  border: 1px solid rgba(255,255,255,.08) !important;\n\
  border-radius: 12px !important;\n\
  padding: 12px !important;\n\
}\n\
\n\
.warhub-member-main {\n\
  display: flex !important;\n\
  align-items: center !important;\n\
  justify-content: space-between !important;\n\
  gap: 8px !important;\n\
}\n\
\n\
.warhub-row {\n\
  display: flex !important;\n\
  align-items: center !important;\n\
  gap: 8px !important;\n\
  flex-wrap: wrap !important;\n\
}\n\
\n\
.warhub-member-name {\n\
  color: #fff !important;\n\
  text-decoration: none !important;\n\
  font-weight: 800 !important;\n\
  font-size: 14px !important;\n\
}\n\
\n\
.warhub-pill {\n\
  display: inline-flex !important;\n\
  align-items: center !important;\n\
  justify-content: center !important;\n\
  min-height: 24px !important;\n\
  padding: 0 9px !important;\n\
  border-radius: 999px !important;\n\
  font-size: 11px !important;\n\
  font-weight: 800 !important;\n\
  border: 1px solid rgba(255,255,255,.12) !important;\n\
}\n\
.warhub-pill.online { background: rgba(30,160,90,.22) !important; }\n\
.warhub-pill.idle { background: rgba(180,130,0,.25) !important; }\n\
.warhub-pill.offline { background: rgba(110,110,110,.22) !important; }\n\
.warhub-pill.travel { background: rgba(60,120,220,.24) !important; }\n\
.warhub-pill.hospital { background: rgba(180,40,40,.24) !important; }\n\
.warhub-pill.jail { background: rgba(120,70,180,.24) !important; }\n\
\n\
.warhub-statline {\n\
  display: flex !important;\n\
  gap: 12px !important;\n\
  flex-wrap: wrap !important;\n\
  margin-top: 10px !important;\n\
  font-size: 12px !important;\n\
  opacity: .95 !important;\n\
}\n\
\n\
.warhub-spy-box {\n\
  margin-top: 8px !important;\n\
  padding: 8px 10px !important;\n\
  border-radius: 10px !important;\n\
  background: rgba(0,0,0,.22) !important;\n\
  border: 1px solid rgba(255,255,255,.06) !important;\n\
  font-size: 12px !important;\n\
}\n\
\n\
@media (max-width: 520px) {\n\
  .warhub-grid {\n\
    grid-template-columns: 1fr !important;\n\
  }\n\
  .warhub-member-main {\n\
    flex-direction: column !important;\n\
    align-items: flex-start !important;\n\
  }\n\
}\n\
";

    (function injectStyles() {
    var style = document.createElement('style');
    style.id = 'warhub-inline-style';
    style.textContent = css;

    function placeStyle() {
        var head = document.head || document.documentElement || document.body;
        if (!head) {
            requestAnimationFrame(placeStyle);
            return;
        }

        var old = document.getElementById('warhub-inline-style');
        if (old) old.remove();
        head.appendChild(style);
    }

    placeStyle();
})();
        // ============================================================
    // 06. SMALL HELPERS
    // ============================================================

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function nowSec() {
        return Math.floor(Date.now() / 1000);
    }

    function clamp(n, min, max) {
        return Math.max(min, Math.min(max, n));
    }

    function toNum(v, fallback) {
        var n = Number(v);
        return Number.isFinite(n) ? n : (fallback == null ? 0 : fallback);
    }

    function shortCd(seconds, fallback) {
        seconds = Math.max(0, Number(seconds) || 0);
        if (!seconds) return fallback || 'Ready';
        var h = Math.floor(seconds / 3600);
        var m = Math.floor((seconds % 3600) / 60);
        var s = Math.floor(seconds % 60);
        if (h > 0) return h + 'h ' + m + 'm';
        if (m > 0) return m + 'm ' + s + 's';
        return s + 's';
    }

    function fmtNumber(n) {
        n = Number(n || 0);
        try {
            return n.toLocaleString();
        } catch (_) {
            return String(n);
        }
    }

    function normalizeAccessCache(raw) {
        raw = raw && typeof raw === 'object' ? raw : {};
        return {
            active: !!raw.active,
            role: String(raw.role || 'member'),
            faction_id: String(raw.faction_id || ''),
            faction_name: String(raw.faction_name || ''),
            user_id: String(raw.user_id || ''),
            user_name: String(raw.user_name || ''),
            expires_at: Number(raw.expires_at || 0) || 0
        };
    }

    function saveAccessCache(next) {
        accessState = normalizeAccessCache(next);
        GM_setValue(K_ACCESS_CACHE, accessState);
    }

    function isLoggedIn() {
        var session = GM_getValue(K_SESSION, null);
        return !!(session && session.session_id);
    }

    function isLeaderLike() {
        var role = String((accessState && accessState.role) || '').toLowerCase();
        return role === 'leader' || role === 'co-leader' || role === 'coleader' || role === 'admin' || role === 'owner';
    }

    function canSeeAdminTab() {
        return isLeaderLike();
    }

    function canSeeAdmin() {
        return canSeeAdminTab();
    }

    function canManageFaction() {
        return isLeaderLike();
    }

    function canSeeSummary() {
        return isLoggedIn();
    }

    function getVisibleTabs(rows) {
        return rows.filter(function (pair) {
            if (pair[0] === 'admin') return canSeeAdminTab();
            return true;
        });
    }

    function cleanInputValue(v) {
        return String(v == null ? '' : v).trim();
    }

    function getSession() {
        return GM_getValue(K_SESSION, null);
    }

    function setSession(session) {
        GM_setValue(K_SESSION, session || null);
    }

    function clearSession() {
        GM_deleteValue(K_SESSION);
        saveAccessCache(null);
    }

    function getHeaders(extra) {
        var session = getSession();
        var headers = Object.assign({
            'Content-Type': 'application/json'
        }, extra || {});
        if (session && session.session_id) {
            headers['X-Session-Id'] = session.session_id;
        }
        return headers;
    }

    function apiRequest(method, path, body) {
        return new Promise(function (resolve, reject) {
            GM_xmlhttpRequest({
                method: method,
                url: BASE_URL + path,
                headers: getHeaders(),
                data: body == null ? null : JSON.stringify(body),
                timeout: 30000,
                onload: function (resp) {
                    var text = resp && resp.responseText ? resp.responseText : '';
                    var json = null;

                    try {
                        json = text ? JSON.parse(text) : {};
                    } catch (_) {
                        json = null;
                    }

                    if (resp.status >= 200 && resp.status < 300) {
                        resolve(json || {});
                        return;
                    }

                    var err = new Error((json && (json.error || json.message)) || ('HTTP ' + resp.status));
                    err.status = resp.status;
                    err.payload = json;
                    reject(err);
                },
                onerror: function () {
                    reject(new Error('Network request failed'));
                },
                ontimeout: function () {
                    reject(new Error('Request timed out'));
                }
            });
        });
    }

    function authedReq(method, path, body) {
        return apiRequest(method, path, body)
            .then(function (json) {
                return { ok: true, json: json };
            })
            .catch(function (err) {
                return {
                    ok: false,
                    json: err && err.payload ? err.payload : null,
                    error: err
                };
            });
    }

    function adminReq(method, path, body) {
        return authedReq(method, path, body);
    }

    function setStatus(msg, isErr) {
        lastStatusMsg = String(msg || '');
        lastStatusErr = !!isErr;
        renderBody();
    }

    function clearStatus() {
        lastStatusMsg = '';
        lastStatusErr = false;
    }

    function getStateFactionId() {
        var f = (state && state.faction) || {};
        var w = (state && state.war) || {};
        var l = (state && state.license) || {};
        return String(
            f.faction_id ||
            f.id ||
            w.our_faction_id ||
            w.faction_id ||
            l.faction_id ||
            accessState.faction_id ||
            ''
        );
    }

    function getStateFactionName() {
        var f = (state && state.faction) || {};
        var w = (state && state.war) || {};
        var l = (state && state.license) || {};
        return String(
            f.name ||
            w.our_faction_name ||
            w.faction_name ||
            l.faction_name ||
            accessState.faction_name ||
            'Your Faction'
        );
    }

    function getOwnMembers() {
        var members = (state && state.members) || [];
        var ownFactionId = getStateFactionId();
        return (Array.isArray(members) ? members : []).filter(function (m) {
            if (!m || typeof m !== 'object') return false;
            var mf = String(m.faction_id || m.faction || m.factionId || '');
            if (ownFactionId && mf) return mf === ownFactionId;
            return true;
        });
    }

    function getMemberId(member) {
        return String(
            (member && (
                member.user_id ||
                member.id ||
                member.player_id ||
                member.member_id
            )) || ''
        );
    }

    function getMemberName(member) {
        return String(
            (member && (
                member.name ||
                member.player_name ||
                member.username
            )) || 'Unknown'
        );
    }

    function profileUrl(member) {
        var id = getMemberId(member);
        return id ? ('https://www.torn.com/profiles.php?XID=' + encodeURIComponent(id)) : '#';
    }

    function bountyUrl(member) {
        var id = getMemberId(member);
        return id ? ('https://www.torn.com/bounties.php?p=add&userID=' + encodeURIComponent(id) + '&source=warhub') : '#';
    }

    function stateLabel(member) {
        var raw = String(
            (member && (
                member.state ||
                member.status ||
                member.user_state ||
                member.presence
            )) || ''
        ).toLowerCase();

        if (!raw) {
            var until = Number(member && (member.status_until || member.until || 0)) || 0;
            var detail = String((member && (member.status_detail || member.details || '')) || '').toLowerCase();
            if (detail.indexOf('hospital') !== -1) return 'hospital';
            if (detail.indexOf('travel') !== -1 || detail.indexOf('flying') !== -1) return 'travel';
            if (detail.indexOf('jail') !== -1) return 'jail';
            if (until > nowSec()) return 'idle';
            return 'offline';
        }

        if (raw.indexOf('hospital') !== -1) return 'hospital';
        if (raw.indexOf('travel') !== -1 || raw.indexOf('fly') !== -1 || raw.indexOf('abroad') !== -1) return 'travel';
        if (raw.indexOf('jail') !== -1) return 'jail';
        if (raw.indexOf('idle') !== -1 || raw.indexOf('away') !== -1) return 'idle';
        if (raw.indexOf('online') !== -1 || raw.indexOf('active') !== -1) return 'online';
        if (raw.indexOf('offline') !== -1) return 'offline';
        return raw || 'offline';
    }

    function humanStateLabel(st) {
        st = String(st || '').toLowerCase();
        if (st === 'online') return 'Online';
        if (st === 'idle') return 'Idle';
        if (st === 'offline') return 'Offline';
        if (st === 'travel') return 'Travel';
        if (st === 'hospital') return 'Hospital';
        if (st === 'jail') return 'Jail';
        return st ? (st.charAt(0).toUpperCase() + st.slice(1)) : 'Unknown';
    }

    function stateCountdown(member) {
        var until = Number(
            member && (
                member.status_until ||
                member.until ||
                member.state_until ||
                member.travel_until ||
                member.hospital_until ||
                member.jail_until
            )
        ) || 0;
        return Math.max(0, until - nowSec());
    }

    function energyValue(member) {
        var value = member && (
            member.energy_current ||
            member.energy ||
            member.e ||
            member.energy_now
        );
        if (value == null || value === '') return null;
        var n = Number(value);
        return Number.isFinite(n) ? n : null;
    }

    function lifeValue(member) {
        var cur = Number(member && (
            member.life_current ||
            member.life ||
            member.hp ||
            member.life_now
        ));
        var max = Number(member && (
            member.life_max ||
            member.max_life ||
            member.hp_max
        ));
        if (!Number.isFinite(cur) && !Number.isFinite(max)) return '—';
        if (!Number.isFinite(cur)) cur = 0;
        if (!Number.isFinite(max) || max <= 0) return String(cur);
        return cur + '/' + max;
    }

    function medCooldownSeconds(member) {
        var n = Number(member && (
            member.med_cd ||
            member.med_cooldown ||
            member.medical_cooldown
        )) || 0;
        return Math.max(0, n);
    }

    function medCooldownValue(member) {
        var secs = medCooldownSeconds(member);
        return secs > 0 ? shortCd(secs, 'Ready') : 'Ready';
    }

    function travelText(member) {
        var to = String(
            (member && (
                member.travel_to ||
                member.destination ||
                member.travel_destination ||
                member.abroad_in ||
                member.traveling_to
            )) || ''
        ).trim();

        var from = String(
            (member && (
                member.travel_from ||
                member.origin ||
                member.travel_origin ||
                member.traveling_from
            )) || ''
        ).trim();

        if (from && to) return from + ' → ' + to;
        if (to) return 'To ' + to;
        if (from) return 'From ' + from;
        return '';
    }

    function hospitalText(member) {
        var secs = stateCountdown(member);
        if (stateLabel(member) !== 'hospital') return '';
        return secs > 0 ? ('Hospital: ' + shortCd(secs, 'Hospital')) : 'Hospital';
    }

    function lastActionText(member) {
        return String(
            (member && (
                member.last_action ||
                member.lastAction ||
                member.last_action_text
            )) || ''
        ).trim();
    }

    function savePendingBounty(playerId, playerName) {
        GM_setValue(K_PENDING_BOUNTY, {
            playerId: String(playerId || ''),
            playerName: String(playerName || ''),
            amount: 250000,
            createdAt: Date.now()
        });
    }

    function getPendingBounty() {
        var raw = GM_getValue(K_PENDING_BOUNTY, null);
        if (!raw || typeof raw !== 'object') return null;
        if (!raw.createdAt || (Date.now() - Number(raw.createdAt)) > 10 * 60 * 1000) {
            GM_deleteValue(K_PENDING_BOUNTY);
            return null;
        }
        return raw;
    }

    function clearPendingBounty() {
        GM_deleteValue(K_PENDING_BOUNTY);
    }

    function tryAutofillBountyPage() {
        var pending = getPendingBounty();
        if (!pending) return;

        var url = String(location.href || '');
        if (url.indexOf('bounties.php') === -1) return;

        var tries = 0;
        var timer = setInterval(function () {
            tries += 1;

            var amountInput =
                document.querySelector('input[name="price"]') ||
                document.querySelector('input[name="reward"]') ||
                document.querySelector('input[type="number"]') ||
                document.querySelector('input[inputmode="numeric"]');

            if (amountInput) {
                amountInput.focus();
                amountInput.value = String(pending.amount);
                amountInput.dispatchEvent(new Event('input', { bubbles: true }));
                amountInput.dispatchEvent(new Event('change', { bubbles: true }));
                clearInterval(timer);
                clearPendingBounty();
                return;
            }

            if (tries >= 40) {
                clearInterval(timer);
            }
        }, 300);
    }
        // ============================================================
    // 07. HOSPITAL HELPERS
    // ============================================================

    function hospitalEnemyId(item) {
        return String(
            (item && (
                item.enemy_id ||
                item.user_id ||
                item.id ||
                item.player_id
            )) || ''
        ).trim();
    }

    function hospitalEnemyName(item) {
        return String(
            (item && (
                item.enemy_name ||
                item.name ||
                item.player_name
            )) || 'Unknown'
        );
    }

    function hospitalOutSeconds(item) {
        var now = Math.floor(Date.now() / 1000);

        var secs = Number(
            (item && (
                item.hospital_seconds_left ||
                item.hospital_time_left ||
                item.hosp_secs
            )) || 0
        );
        if (Number.isFinite(secs) && secs > 0) return secs;

        var untilTs = Number(
            (item && (
                item.hospital_until_ts ||
                item.hosp_out_ts ||
                item.until
            )) || 0
        );
        if (Number.isFinite(untilTs) && untilTs > now) {
            return Math.max(0, untilTs - now);
        }

        return 0;
    }

    function hospitalOutText(item) {
        var text = String(
            (item && (
                item.hospital_time_left_text ||
                item.hosp_text
            )) || ''
        ).trim();

        if (text) return text;

        var secs = hospitalOutSeconds(item);
        return secs > 0 ? shortCd(secs, '0s') : 'Out';
    }

    function hospitalDibsName(item) {
        return String(
            (item && (
                item.dibbed_by_name ||
                item.dibs_by_name ||
                item.claimed_by_name
            )) || ''
        ).trim();
    }

    function hospitalDibsAvailable(item) {
        if (item && typeof item.dibs_available === 'boolean') {
            return item.dibs_available;
        }
        return !hospitalDibsName(item);
    }

    function hospitalDibsLockSeconds(item) {
        var now = Math.floor(Date.now() / 1000);

        var lockTs = Number(
            (item && (
                item.dibs_locked_until_ts ||
                item.locked_until_ts
            )) || 0
        );
        if (Number.isFinite(lockTs) && lockTs > now) {
            return Math.max(0, lockTs - now);
        }

        return 0;
    }

    function hospitalDibsStatusText(item) {
        var dibber = hospitalDibsName(item);
        if (dibber) return 'Dibs: ' + dibber;

        if (hospitalDibsAvailable(item)) return 'Available';

        var lockSecs = hospitalDibsLockSeconds(item);
        if (lockSecs > 0) return 'Open in ' + shortCd(lockSecs, '0s');

        return 'Unavailable';
    }

    // ============================================================
    // 08. DATA LOADERS
    // ============================================================

    function loadState() {
        return _loadState.apply(this, arguments);
    }

    function _loadState() {
        _loadState = _asyncToGenerator(function* () {
            if (!isLoggedIn()) return null;

            var res = yield authedReq('GET', '/api/state');
            if (!res.ok || !res.json) return state;

            state = res.json;
            updateBadge();
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

            if (!force && factionMembersCache && Array.isArray(factionMembersCache)) {
                return factionMembersCache;
            }

            var res = yield authedReq('GET', '/api/state');
            if (!res.ok || !res.json) return factionMembersCache || [];

            state = res.json;
            factionMembersCache = getOwnMembers();
            currentFactionMembers = factionMembersCache.slice();
            updateBadge();
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
            if (!force && state && state.war) return state.war;

            var res = yield authedReq('GET', '/api/state');
            if (!res.ok || !res.json) return state && state.war ? state.war : null;

            state = res.json;
            updateBadge();
            return state.war || null;
        });

        return _loadWarData.apply(this, arguments);
    }

    function loadEnemies(force) {
        return _loadEnemies.apply(this, arguments);
    }

    function _loadEnemies() {
        _loadEnemies = _asyncToGenerator(function* (force) {
            if (!isLoggedIn()) return [];

            if (!force && warEnemiesCache && warEnemiesCache.length) {
                return warEnemiesCache;
            }

            var res = yield authedReq('GET', '/api/enemies');
            if (res.ok && res.json) {
                warEnemiesCache = Array.isArray(res.json.enemies) ? res.json.enemies : (Array.isArray(res.json) ? res.json : []);
                warEnemiesFactionName = String(res.json.enemy_faction_name || res.json.faction_name || warEnemiesFactionName || '');
                warEnemiesFactionId = String(res.json.enemy_faction_id || res.json.faction_id || warEnemiesFactionId || '');
                warEnemiesLoadedAt = Date.now();
                return warEnemiesCache;
            }

            var war = (state && state.war) || {};
            warEnemiesFactionName = String(war.enemy_faction_name || warEnemiesFactionName || '');
            warEnemiesFactionId = String(war.enemy_faction_id || warEnemiesFactionId || '');
            return warEnemiesCache || [];
        });

        return _loadEnemies.apply(this, arguments);
    }

    function loadHospital(force) {
        return _loadHospital.apply(this, arguments);
    }

    function _loadHospital() {
        _loadHospital = _asyncToGenerator(function* (force) {
            if (!isLoggedIn()) return [];

            if (!force && state && Array.isArray(state.hospital)) {
                return state.hospital;
            }

            var res = yield authedReq('GET', '/api/hospital');
            if (res.ok && res.json) {
                if (!state) state = {};
                state.hospital = Array.isArray(res.json.hospital) ? res.json.hospital : (Array.isArray(res.json) ? res.json : []);
                return state.hospital;
            }

            return (state && state.hospital) || [];
        });

        return _loadHospital.apply(this, arguments);
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
    // 09. TAB / POLLING FLOW
    // ============================================================

    function tabNeedsLivePolling(tab) {
        return tab === 'summary' || tab === 'enemies' || tab === 'hospital' || tab === 'overview' || tab === 'members';
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

                if (currentTab === 'hospital') {
                    yield loadWarData(true);
                    yield loadEnemies(true);
                    yield loadHospital(true);
                    return;
                }

                if (currentTab === 'overview') {
                    yield loadState();
                    return;
                }

                if (currentTab === 'members') {
                    yield loadState();
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
                } else if (currentTab === 'hospital') {
                    yield loadWarData(true);
                    yield loadEnemies(true);
                    yield loadHospital(true);
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
    // 10. OVERLAY MOUNT / DOM
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
        shield.style.position = 'fixed';
        shield.style.zIndex = '2147483647';
        shield.style.width = '42px';
        shield.style.height = '42px';
        shield.style.borderRadius = '12px';
        shield.style.display = 'flex';
        shield.style.alignItems = 'center';
        shield.style.justifyContent = 'center';
        shield.style.fontSize = '21px';
        shield.style.lineHeight = '1';
        shield.style.cursor = 'pointer';
        shield.style.userSelect = 'none';
        shield.style.webkitUserSelect = 'none';
        shield.style.webkitTouchCallout = 'none';
        shield.style.webkitTapHighlightColor = 'transparent';
        shield.style.touchAction = 'none';
        shield.style.boxShadow = '0 8px 24px rgba(0,0,0,.45)';
        shield.style.border = '1px solid rgba(255,255,255,.10)';
        shield.style.background = 'radial-gradient(circle at 30% 20%, rgba(220,75,75,.98), rgba(110,12,12,.98) 55%, rgba(48,6,6,.98))';
        shield.style.color = '#fff';
        shield.style.opacity = '1';
        shield.style.visibility = 'visible';
        shield.style.pointerEvents = 'auto';

        badge = document.createElement('div');
        badge.id = 'warhub-badge';
        badge.style.position = 'fixed';
        badge.style.zIndex = '2147483647';
        badge.style.minWidth = '16px';
        badge.style.height = '16px';
        badge.style.padding = '0 4px';
        badge.style.borderRadius = '999px';
        badge.style.background = '#ffd54a';
        badge.style.color = '#111';
        badge.style.fontSize = '10px';
        badge.style.lineHeight = '16px';
        badge.style.textAlign = 'center';
        badge.style.fontWeight = '800';
        badge.style.boxShadow = '0 3px 12px rgba(0,0,0,.45)';
        badge.style.display = 'none';
        badge.style.pointerEvents = 'none';

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

        var shieldDrag = makeHoldDraggable(shield, shield, K_SHIELD_POS);

        function shieldTapBlocked() {
            return !!(
                shieldDrag &&
                (
                    (shieldDrag.isDragging && shieldDrag.isDragging()) ||
                    (shieldDrag.didMove && shieldDrag.didMove())
                )
            );
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

            var bountyLink = e.target.closest('[data-bounty-player]');
            if (bountyLink) {
                savePendingBounty(
                    bountyLink.getAttribute('data-bounty-player'),
                    bountyLink.getAttribute('data-bounty-name')
                );
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

        overlay.addEventListener('click', function (e) {
            var bountyLink = e.target.closest('[data-bounty-player]');
            if (bountyLink) {
                savePendingBounty(
                    bountyLink.getAttribute('data-bounty-player'),
                    bountyLink.getAttribute('data-bounty-name')
                );
            }
        }, true);

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
            positionBadge();
            renderBody();
        }
    }

    function toggleOverlay() {
        setOverlayOpen(!isOpen);
    }

    // ============================================================
    // 11. GROUP COLLAPSE STATE
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
    // 12. MEMBER RENDERING
    // ============================================================

    function sortMembers(items) {
        return (Array.isArray(items) ? items.slice() : []).sort(function (a, b) {
            var sa = stateLabel(a);
            var sb = stateLabel(b);

            var rank = {
                online: 0,
                idle: 1,
                travel: 2,
                hospital: 3,
                jail: 4,
                offline: 5
            };

            var ra = rank.hasOwnProperty(sa) ? rank[sa] : 9;
            var rb = rank.hasOwnProperty(sb) ? rank[sb] : 9;
            if (ra !== rb) return ra - rb;

            return getMemberName(a).localeCompare(getMemberName(b));
        });
    }

    function renderMemberRow(member) {
        var id = getMemberId(member);
        var name = getMemberName(member);
        var st = stateLabel(member);
        var stateCd = stateCountdown(member);
        var energy = energyValue(member);
        var life = lifeValue(member);
        var med = medCooldownValue(member);
        var medSecs = medCooldownSeconds(member);
        var travel = travelText(member);
        var hosp = hospitalText(member);
        var lastAct = lastActionText(member);

        return [
            '<div class="warhub-member-row" ' +
                'data-medcd-base="' + esc(String(medSecs)) + '" ' +
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
                        '<a class="warhub-btn danger" href="' + esc(bountyUrl(member)) + '" data-bounty-player="' + esc(id) + '" data-bounty-name="' + esc(name) + '" target="_blank" rel="noopener noreferrer">Bounty</a>',
                    '</div>',
                '</div>',

                '<div class="warhub-statline">',
                    '<span>⚡ ' + esc(energy == null ? '—' : String(energy)) + '</span>',
                    '<span>✚ ' + esc(life) + '</span>',
                    '<span>💊 <span data-medcd>' + esc(med) + '</span></span>',
                '</div>',

                travel ? '<div class="warhub-spy-box">✈️ ' + esc(travel) + '</div>' : '',
                hosp ? '<div class="warhub-spy-box">🏥 ' + esc(hosp) + '</div>' : '',
                (lastAct && st !== 'travel' && st !== 'hospital') ? '<div class="warhub-spy-box">🕒 ' + esc(lastAct) + '</div>' : '',

            '</div>'
        ].join('');
    }

    function startMembersCountdown() {
        stopMembersCountdown();

        if (!overlay) return;
        if (currentTab !== 'members') return;

        membersCountdownTimer = setInterval(function () {
            if (!overlay || currentTab !== 'members') return;

            overlay.querySelectorAll('.warhub-member-row').forEach(function (row) {
                var medBase = Number(row.getAttribute('data-medcd-base') || '0') || 0;
                var statusBase = Number(row.getAttribute('data-statuscd-base') || '0') || 0;
                var st = String(row.getAttribute('data-state-name') || '');

                if (medBase > 0) {
                    medBase = Math.max(0, medBase - 1);
                    row.setAttribute('data-medcd-base', String(medBase));
                    var medNode = row.querySelector('[data-medcd]');
                    if (medNode) medNode.textContent = medBase > 0 ? shortCd(medBase, 'Ready') : 'Ready';
                }

                if (statusBase > 0 && (st === 'travel' || st === 'hospital' || st === 'jail')) {
                    statusBase = Math.max(0, statusBase - 1);
                    row.setAttribute('data-statuscd-base', String(statusBase));
                    var statusNode = row.querySelector('[data-statuscd]');
                    if (statusNode) {
                        statusNode.textContent =
                            st === 'hospital' ? (statusBase > 0 ? 'Hospital (' + shortCd(statusBase, 'Hospital') + ')' : 'Hospital') :
                            st === 'jail' ? (statusBase > 0 ? 'Jail (' + shortCd(statusBase, 'Jail') + ')' : 'Jail') :
                            (statusBase > 0 ? 'Travel (' + shortCd(statusBase, 'Travel') + ')' : 'Travel');
                    }
                }
            });
        }, 1000);
    }

    function stopMembersCountdown() {
        if (membersCountdownTimer) {
            clearInterval(membersCountdownTimer);
            membersCountdownTimer = null;
        }
    }

    function membersSummary(items) {
        var counts = {
            online: 0,
            idle: 0,
            travel: 0,
            hospital: 0,
            jail: 0,
            offline: 0
        };

        (Array.isArray(items) ? items : []).forEach(function (m) {
            var st = stateLabel(m);
            if (counts.hasOwnProperty(st)) counts[st] += 1;
            else counts.offline += 1;
        });

        return [
            '<div class="warhub-card">',
                '<div class="warhub-grid">',
                    '<div><div class="warhub-label">Online</div><div class="warhub-value">' + esc(counts.online) + '</div></div>',
                    '<div><div class="warhub-label">Idle</div><div class="warhub-value">' + esc(counts.idle) + '</div></div>',
                    '<div><div class="warhub-label">Travel</div><div class="warhub-value">' + esc(counts.travel) + '</div></div>',
                    '<div><div class="warhub-label">Hospital</div><div class="warhub-value">' + esc(counts.hospital) + '</div></div>',
                    '<div><div class="warhub-label">Jail</div><div class="warhub-value">' + esc(counts.jail) + '</div></div>',
                    '<div><div class="warhub-label">Offline</div><div class="warhub-value">' + esc(counts.offline) + '</div></div>',
                '</div>',
            '</div>'
        ].join('');
    }

    function renderMembersTab() {
        var members = sortMembers(getOwnMembers());

        return [
            '<div class="warhub-card">',
                '<div class="warhub-label">Faction Members</div>',
                '<div class="warhub-value">' + esc(getStateFactionName()) + '</div>',
                '<div class="warhub-note">Live member list from your War Hub state. Energy, life, med cooldown, travel, and hospital timers show when your backend sends those values.</div>',
            '</div>',
            membersSummary(members),
            '<div class="warhub-list">',
                members.length
                    ? members.map(renderMemberRow).join('')
                    : '<div class="warhub-empty">No faction members available.</div>',
            '</div>'
        ].join('');
    }

    // ============================================================
    // 13. OTHER TAB RENDERS
    // ============================================================

    function renderOverviewTab() {
        var war = (state && state.war) || {};
        var ownFaction = (state && state.faction) || {};
        var ownName = String(
            ownFaction.name ||
            war.our_faction_name ||
            war.faction_name ||
            getStateFactionName()
        );

        var enemyName = String(
            war.enemy_faction_name ||
            'No current enemy'
        );

        var scoreUs = Number(war.score_us || war.our_score || 0);
        var scoreThem = Number(war.score_them || war.enemy_score || 0);
        var chainUs = Number(war.chain_us || 0);
        var chainThem = Number(war.chain_them || 0);

        var termsText = String((state && state.terms && state.terms.text) || '');
        var medDealsText = String((state && state.med_deals && state.med_deals.text) || '');
        var dibsText = String((state && state.dibs && state.dibs.text) || '');

        return [
            '<div class="warhub-card">',
                '<div class="warhub-grid">',
                    '<div><div class="warhub-label">Your Faction</div><div class="warhub-value">' + esc(ownName) + '</div></div>',
                    '<div><div class="warhub-label">Enemy</div><div class="warhub-value">' + esc(enemyName) + '</div></div>',
                    '<div><div class="warhub-label">Your Score</div><div class="warhub-value">' + esc(fmtNumber(scoreUs)) + '</div></div>',
                    '<div><div class="warhub-label">Enemy Score</div><div class="warhub-value">' + esc(fmtNumber(scoreThem)) + '</div></div>',
                    '<div><div class="warhub-label">Your Chain</div><div class="warhub-value">' + esc(fmtNumber(chainUs)) + '</div></div>',
                    '<div><div class="warhub-label">Enemy Chain</div><div class="warhub-value">' + esc(fmtNumber(chainThem)) + '</div></div>',
                '</div>',
            '</div>',

            '<div class="warhub-card">',
                '<div class="warhub-label">War Terms</div>',
                termsText
                    ? '<div class="warhub-note" style="white-space:pre-wrap;">' + esc(termsText) + '</div>'
                    : '<div class="warhub-empty">No war terms set.</div>',
            '</div>',

            '<div class="warhub-card">',
                '<div class="warhub-label">Med Deals</div>',
                medDealsText
                    ? '<div class="warhub-note" style="white-space:pre-wrap;">' + esc(medDealsText) + '</div>'
                    : '<div class="warhub-empty">No med deals set.</div>',
            '</div>',

            '<div class="warhub-card">',
                '<div class="warhub-label">Dibs</div>',
                dibsText
                    ? '<div class="warhub-note" style="white-space:pre-wrap;">' + esc(dibsText) + '</div>'
                    : '<div class="warhub-empty">No dibs notes set.</div>',
            '</div>'
        ].join('');
    }

    function renderEnemiesTab() {
        var enemies = Array.isArray(warEnemiesCache) ? warEnemiesCache : [];
        var factionName = warEnemiesFactionName || 'Enemy Faction';

        return [
            '<div class="warhub-card">',
                '<div class="warhub-label">Enemy Faction</div>',
                '<div class="warhub-value">' + esc(factionName) + '</div>',
                '<div class="warhub-note">Enemy members shown from the active war data your backend provides.</div>',
            '</div>',
            '<div class="warhub-list">',
                enemies.length
                    ? enemies.map(function (enemy) {
                        var id = String(enemy.user_id || enemy.id || enemy.player_id || '');
                        var name = String(enemy.name || enemy.player_name || 'Unknown');
                        var status = String(enemy.status || enemy.state || 'Unknown');
                        var level = enemy.level != null ? String(enemy.level) : '—';
                        var life = enemy.life_current != null && enemy.life_max != null
                            ? (String(enemy.life_current) + '/' + String(enemy.life_max))
                            : '—';

                        return [
                            '<div class="warhub-member-row">',
                                '<div class="warhub-member-main">',
                                    '<div class="warhub-row">',
                                        '<a class="warhub-member-name" href="https://www.torn.com/profiles.php?XID=' + esc(id) + '" target="_blank" rel="noopener noreferrer">' + esc(name) + '</a>',
                                        '<span class="warhub-pill offline">' + esc(status) + '</span>',
                                    '</div>',
                                    '<div class="warhub-row">',
                                        '<a class="warhub-btn danger" href="https://www.torn.com/loader.php?sid=attack&user2ID=' + esc(id) + '" target="_blank" rel="noopener noreferrer">Attack</a>',
                                    '</div>',
                                '</div>',
                                '<div class="warhub-statline">',
                                    '<span>Lvl ' + esc(level) + '</span>',
                                    '<span>✚ ' + esc(life) + '</span>',
                                '</div>',
                            '</div>'
                        ].join('');
                    }).join('')
                    : '<div class="warhub-empty">No enemy members available.</div>',
            '</div>'
        ].join('');
    }

    function renderHospitalTab() {
        var items = Array.isArray((state && state.hospital) || []) ? state.hospital : [];

        return [
            '<div class="warhub-card">',
                '<div class="warhub-label">Hospital Targets</div>',
                '<div class="warhub-note">Track hospitalized enemies and dibs status from your backend.</div>',
            '</div>',
            '<div class="warhub-list">',
                items.length
                    ? items.map(function (item) {
                        var id = hospitalEnemyId(item);
                        var name = hospitalEnemyName(item);
                        var outText = hospitalOutText(item);
                        var dibsText = hospitalDibsStatusText(item);

                        return [
                            '<div class="warhub-member-row">',
                                '<div class="warhub-member-main">',
                                    '<div class="warhub-row">',
                                        '<a class="warhub-member-name" href="https://www.torn.com/profiles.php?XID=' + esc(id) + '" target="_blank" rel="noopener noreferrer">' + esc(name) + '</a>',
                                        '<span class="warhub-pill hospital">' + esc(outText) + '</span>',
                                    '</div>',
                                    '<div class="warhub-row">',
                                        '<a class="warhub-btn danger" href="https://www.torn.com/loader.php?sid=attack&user2ID=' + esc(id) + '" target="_blank" rel="noopener noreferrer">Attack</a>',
                                    '</div>',
                                '</div>',
                                '<div class="warhub-spy-box">' + esc(dibsText) + '</div>',
                            '</div>'
                        ].join('');
                    }).join('')
                    : '<div class="warhub-empty">No hospital targets available.</div>',
            '</div>'
        ].join('');
    }

    function renderChainTab() {
        var chain = (state && state.chain) || {};
        return [
            '<div class="warhub-card">',
                '<div class="warhub-grid">',
                    '<div><div class="warhub-label">Current Chain</div><div class="warhub-value">' + esc(fmtNumber(chain.current || 0)) + '</div></div>',
                    '<div><div class="warhub-label">Timeout</div><div class="warhub-value">' + esc(shortCd(chain.timeout || 0, '—')) + '</div></div>',
                    '<div><div class="warhub-label">Best</div><div class="warhub-value">' + esc(fmtNumber(chain.best || 0)) + '</div></div>',
                    '<div><div class="warhub-label">Respect</div><div class="warhub-value">' + esc(fmtNumber(chain.respect || 0)) + '</div></div>',
                '</div>',
            '</div>'
        ].join('');
    }
        function renderTargetsTab() {
        var targets = Array.isArray((state && state.targets) || []) ? state.targets : [];
        return [
            '<div class="warhub-card">',
                '<div class="warhub-label">Targets</div>',
                '<div class="warhub-note">Quick links for targets your backend marks for war.</div>',
            '</div>',
            '<div class="warhub-list">',
                targets.length
                    ? targets.map(function (t) {
                        var id = String(t.user_id || t.id || t.player_id || '');
                        var name = String(t.name || t.player_name || 'Unknown');
                        var note = String(t.note || t.reason || '');

                        return [
                            '<div class="warhub-member-row">',
                                '<div class="warhub-member-main">',
                                    '<div class="warhub-row">',
                                        '<a class="warhub-member-name" href="https://www.torn.com/profiles.php?XID=' + esc(id) + '" target="_blank" rel="noopener noreferrer">' + esc(name) + '</a>',
                                    '</div>',
                                    '<div class="warhub-row">',
                                        '<a class="warhub-btn danger" href="https://www.torn.com/loader.php?sid=attack&user2ID=' + esc(id) + '" target="_blank" rel="noopener noreferrer">Attack</a>',
                                    '</div>',
                                '</div>',
                                (note ? '<div class="warhub-spy-box">' + esc(note) + '</div>' : ''),
                            '</div>'
                        ].join('');
                    }).join('')
                    : '<div class="warhub-empty">No targets available.</div>',
            '</div>'
        ].join('');
    }

    function renderMedDealsTab() {
        var text = String((state && state.med_deals && state.med_deals.text) || '');
        return [
            '<div class="warhub-card">',
                '<div class="warhub-label">Med Deals</div>',
                text
                    ? '<div class="warhub-note" style="white-space:pre-wrap;">' + esc(text) + '</div>'
                    : '<div class="warhub-empty">No med deals set.</div>',
            '</div>'
        ].join('');
    }

    function renderTermsTab() {
        var text = String((state && state.terms && state.terms.text) || '');
        return [
            '<div class="warhub-card">',
                '<div class="warhub-label">War Terms</div>',
                text
                    ? '<div class="warhub-note" style="white-space:pre-wrap;">' + esc(text) + '</div>'
                    : '<div class="warhub-empty">No war terms set.</div>',
            '</div>'
        ].join('');
    }

    function renderSummaryTab() {
        var summary = liveSummaryCache || {};
        var text = String(summary.text || summary.summary || '');
        return [
            '<div class="warhub-card">',
                '<div class="warhub-label">War Summary</div>',
                text
                    ? '<div class="warhub-note" style="white-space:pre-wrap;">' + esc(text) + '</div>'
                    : '<div class="warhub-empty">No live summary available.</div>',
            '</div>'
        ].join('');
    }

    function renderFactionTab() {
        return [
            '<div class="warhub-card">',
                '<div class="warhub-label">Faction</div>',
                '<div class="warhub-value">' + esc(getStateFactionName()) + '</div>',
                '<div class="warhub-note">Use this tab for faction management items from your backend.</div>',
            '</div>'
        ].join('');
    }

    function renderSettingsTab() {
        var session = getSession();
        var apiKey = GM_getValue(K_API_KEY, '');
        var ownerToken = GM_getValue(K_OWNER_TOKEN, '');

        return [
            '<div class="warhub-card">',
                '<div class="warhub-label">Login Status</div>',
                '<div class="warhub-note">' + esc(session && session.session_id ? 'Logged in' : 'Logged out') + '</div>',
                '<div class="warhub-note">User: ' + esc(accessState.user_name || '—') + '</div>',
                '<div class="warhub-note">Access: ' + esc(accessState.active ? 'Active' : 'Inactive') + '</div>',
            '</div>',
            '<div class="warhub-card">',
                '<div class="warhub-label">Torn API Key</div>',
                '<input id="warhub-api-key" class="warhub-input" type="password" value="' + esc(apiKey) + '" placeholder="Enter Torn API key" />',
                '<div class="warhub-note">Your key stays saved locally in the script storage.</div>',
            '</div>',
            '<div class="warhub-card">',
                '<div class="warhub-label">Owner Token</div>',
                '<input id="warhub-owner-token" class="warhub-input" type="password" value="' + esc(ownerToken) + '" placeholder="Owner token" />',
            '</div>',
            '<div class="warhub-actions">',
                '<button class="warhub-btn primary" type="button" data-action="login">Log In</button>',
                '<button class="warhub-btn" type="button" data-action="refresh-state">Refresh</button>',
                '<button class="warhub-btn danger" type="button" data-action="logout">Log Out</button>',
            '</div>'
        ].join('');
    }

    function renderInstructionsTab() {
        return [
            '<div class="warhub-card">',
                '<div class="warhub-label">How to Use</div>',
                '<div class="warhub-note">1. Enter your Torn API key in Settings.</div>',
                '<div class="warhub-note">2. Log in to your War Hub session.</div>',
                '<div class="warhub-note">3. Open Members for live faction member data.</div>',
                '<div class="warhub-note">4. Tap Bounty on a member, then on Torn just press the bounty submit button.</div>',
            '</div>'
        ].join('');
    }

    function renderTop5Tab() {
        var data = adminTopFiveCache || {};
        var groups = Array.isArray(data.groups) ? data.groups : [];

        return [
            '<div class="warhub-card">',
                '<div class="warhub-label">Top 5</div>',
                groups.length
                    ? groups.map(function (group) {
                        var title = String(group.title || 'Category');
                        var items = Array.isArray(group.items) ? group.items : [];
                        return [
                            '<div class="warhub-spy-box">',
                                '<div class="warhub-label">' + esc(title) + '</div>',
                                items.length
                                    ? items.map(function (item, idx) {
                                        return '<div class="warhub-note">' + esc((idx + 1) + '. ' + String(item.name || 'Unknown') + ' — ' + String(item.value || 0)) + '</div>';
                                    }).join('')
                                    : '<div class="warhub-empty">No data</div>',
                            '</div>'
                        ].join('');
                    }).join('')
                    : '<div class="warhub-empty">No top 5 data available.</div>',
            '</div>'
        ].join('');
    }

    function renderAdminTab() {
        var dash = analyticsCache || {};
        return [
            '<div class="warhub-card">',
                '<div class="warhub-label">Admin Dashboard</div>',
                '<div class="warhub-note">Users: ' + esc(fmtNumber(dash.users || 0)) + '</div>',
                '<div class="warhub-note">Active Licenses: ' + esc(fmtNumber(dash.active_licenses || 0)) + '</div>',
                '<div class="warhub-note">Faction Count: ' + esc(fmtNumber(dash.factions || 0)) + '</div>',
            '</div>'
        ].join('');
    }

    function renderLoginView() {
        return [
            '<div class="warhub-card">',
                '<div class="warhub-label">War Hub Login</div>',
                '<div class="warhub-note">Enter your Torn API key in Settings, then tap Log In.</div>',
            '</div>',
            renderSettingsTab()
        ].join('');
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
        if (currentTab === 'summary') return renderSummaryTab();
        if (currentTab === 'faction') return renderFactionTab();
        if (currentTab === 'settings') return renderSettingsTab();
        if (currentTab === 'instructions') return renderInstructionsTab();
        if (currentTab === 'wartop5') return renderTop5Tab();
        if (currentTab === 'admin') return renderAdminTab();

        return renderOverviewTab();
    }

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

    function renderBody() {
        if (!overlay) return;

        renderTabsRow('warhub-tabs-row-1', TAB_ROW_1);
        renderTabsRow('warhub-tabs-row-2', TAB_ROW_2);

        var statusNode = overlay.querySelector('#warhub-status');
        if (statusNode) {
            if (lastStatusMsg) {
                statusNode.style.display = '';
                statusNode.className = lastStatusErr ? 'warhub-status error' : 'warhub-status';
                statusNode.textContent = lastStatusMsg;
            } else {
                statusNode.style.display = 'none';
                statusNode.className = 'warhub-status';
                statusNode.textContent = '';
            }
        }

        var content = overlay.querySelector('#warhub-content');
        if (content) {
            content.innerHTML = renderCurrentTab();
        }

        if (currentTab === 'members') startMembersCountdown();
        else stopMembersCountdown();
    }

    // ============================================================
    // 14. POSITION / DRAG
    // ============================================================

    function viewportSize() {
        var de = document.documentElement;
        return {
            w: Math.max(window.innerWidth || 0, de ? de.clientWidth : 0),
            h: Math.max(window.innerHeight || 0, de ? de.clientHeight : 0)
        };
    }

    function keepBoxOnScreen(left, top, width, height, pad) {
        pad = Number(pad || 8);
        var vp = viewportSize();
        var maxLeft = Math.max(pad, vp.w - width - pad);
        var maxTop = Math.max(pad, vp.h - height - pad);

        return {
            left: clamp(Number(left || 0), pad, maxLeft),
            top: clamp(Number(top || 0), pad, maxTop)
        };
    }

    function defaultShieldPos() {
    var vp = viewportSize();
    return keepBoxOnScreen(
        vp.w - 54,
        Math.round((vp.h / 2) - 21),
        42,
        42,
        8
    );
}

function applyShieldPos() {
    if (!shield) return;

    var pos = GM_getValue(K_SHIELD_POS, null);

    if (!pos || typeof pos.left !== 'number' || typeof pos.top !== 'number') {
        pos = defaultShieldPos();
    }

    var fixed = keepBoxOnScreen(pos.left, pos.top, 42, 42, 8);

    shield.style.left = fixed.left + 'px';
    shield.style.top = fixed.top + 'px';
    shield.style.right = 'auto';
    shield.style.bottom = 'auto';
}

    function defaultOverlayPos() {
        var vp = viewportSize();
        var width = Math.min(520, vp.w - 16);
        var height = vp.h - 16;
        var left = Math.round((vp.w - width) / 2);
        var top = 8;
        return keepBoxOnScreen(left, top, width, height, 8);
    }

    function applyOverlayPos() {
        if (!overlay) return;

        var vp = viewportSize();
        var width = Math.min(520, vp.w - 16);
        var height = vp.h - 16;
        var pos = GM_getValue(K_OVERLAY_POS, null) || defaultOverlayPos();
        var fixed = keepBoxOnScreen(pos.left, pos.top, width, height, 8);

        overlay.style.left = fixed.left + 'px';
        overlay.style.top = fixed.top + 'px';
        overlay.style.right = 'auto';
        overlay.style.bottom = 'auto';
        overlay.style.width = width + 'px';
        overlay.style.maxWidth = width + 'px';
        overlay.style.height = height + 'px';
    }

    function positionBadge() {
        if (!shield || !badge) return;

        var rect = shield.getBoundingClientRect();
        badge.style.left = (rect.right - 8) + 'px';
        badge.style.top = (rect.top - 6) + 'px';
    }

    function updateBadge() {
        if (!badge) return;

        var count = 0;
        var members = Array.isArray((state && state.members) || []) ? state.members : [];
        count = members.filter(function (m) {
            return stateLabel(m) === 'hospital';
        }).length;

        if (count > 0) {
            badge.textContent = String(count);
            badge.style.display = 'block';
        } else {
            badge.style.display = 'none';
            badge.textContent = '';
        }
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
        var pressTimer = null;
        var pressActive = false;
        var startX = 0;
        var startY = 0;
        var startLeft = 0;
        var startTop = 0;
        var HOLD_MS = 260;
        var DRAG_THRESHOLD = 8;

        function clearPressTimer() {
            if (pressTimer) {
                clearTimeout(pressTimer);
                pressTimer = null;
            }
        }

        function pointFromEvent(e) {
            var t = e.touches && e.touches[0] ? e.touches[0] : e.changedTouches && e.changedTouches[0] ? e.changedTouches[0] : e;
            return {
                x: Number(t.clientX || 0),
                y: Number(t.clientY || 0)
            };
        }

        function endDrag() {
            clearPressTimer();
            dragging = false;
            pressActive = false;
            target.classList.remove('dragging');

            setTimeout(function () {
                moved = false;
            }, 60);
        }

        handle.addEventListener('touchstart', function (e) {
            if (!e.touches || !e.touches.length) return;

            moved = false;
            dragging = false;
            pressActive = false;

            var p = pointFromEvent(e);
            startX = p.x;
            startY = p.y;

            var rect = target.getBoundingClientRect();
            startLeft = rect.left;
            startTop = rect.top;

            clearPressTimer();
            pressTimer = setTimeout(function () {
                dragging = true;
                pressActive = true;
                target.classList.add('dragging');
            }, HOLD_MS);
        }, { passive: true });

        handle.addEventListener('touchmove', function (e) {
            if (!e.touches || !e.touches.length) return;

            var p = pointFromEvent(e);
            var dx = p.x - startX;
            var dy = p.y - startY;

            if (!dragging) {
                if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
                    moved = true;
                }
                if (moved) clearPressTimer();
                return;
            }

            if (e.cancelable) e.preventDefault();

            var rect = target.getBoundingClientRect();
            var next = keepBoxOnScreen(startLeft + dx, startTop + dy, rect.width, rect.height, 8);

            target.style.left = next.left + 'px';
            target.style.top = next.top + 'px';
            target.style.right = 'auto';
            target.style.bottom = 'auto';

            GM_setValue(key, { left: next.left, top: next.top });

            if (target === shield) positionBadge();
        }, { passive: false });

        handle.addEventListener('touchend', endDrag, { passive: true });
        handle.addEventListener('touchcancel', endDrag, { passive: true });

        return {
            didMove: function () { return moved; },
            isDragging: function () { return dragging || pressActive; }
        };
    }

    // ============================================================
    // 15. ACTION HANDLERS / POLLING / BOOT
    // ============================================================

    function loginFlow() {
        return _loginFlow.apply(this, arguments);
    }

    function _loginFlow() {
        _loginFlow = _asyncToGenerator(function* () {
            var apiKey = cleanInputValue(GM_getValue(K_API_KEY, ''));
            if (!apiKey) {
                setStatus('Enter your Torn API key first.', true);
                return;
            }

            setStatus('Logging in...', false);

            var res = yield authedReq('POST', '/api/login', {
                api_key: apiKey,
                owner_token: cleanInputValue(GM_getValue(K_OWNER_TOKEN, ''))
            });

            if (!res.ok || !res.json) {
                setStatus((res.json && (res.json.error || res.json.message)) || 'Login failed.', true);
                return;
            }

            setSession({
                session_id: res.json.session_id || res.json.session || ''
            });

            saveAccessCache(res.json.access || res.json.license || {});
            clearStatus();

            yield loadState();
            renderBody();
            restartPollingForCurrentTab();
        });

        return _loginFlow.apply(this, arguments);
    }

    function logoutFlow() {
        return _logoutFlow.apply(this, arguments);
    }

    function _logoutFlow() {
        _logoutFlow = _asyncToGenerator(function* () {
            clearSession();
            state = null;
            analyticsCache = null;
            adminTopFiveCache = null;
            factionMembersCache = null;
            currentFactionMembers = [];
            liveSummaryCache = null;
            warEnemiesCache = [];
            stopMembersCountdown();
            renderBody();
            setStatus('Logged out.', false);
        });

        return _logoutFlow.apply(this, arguments);
    }

    function refreshStateFlow() {
        return _refreshStateFlow.apply(this, arguments);
    }

    function _refreshStateFlow() {
        _refreshStateFlow = _asyncToGenerator(function* () {
            setStatus('Refreshing...', false);

            yield loadState();

            if (currentTab === 'members') {
                yield loadFactionMembers(true);
            } else if (currentTab === 'enemies') {
                yield loadWarData(true);
                yield loadEnemies(true);
            } else if (currentTab === 'hospital') {
                yield loadWarData(true);
                yield loadEnemies(true);
                yield loadHospital(true);
            } else if (currentTab === 'summary') {
                yield loadLiveSummary(true);
            }

            clearStatus();
            renderBody();
        });

        return _refreshStateFlow.apply(this, arguments);
    }

    function handleActionClick(node) {
        var action = node && node.getAttribute('data-action');
        if (!action) return;

        if (action === 'login') {
            loginFlow();
            return;
        }
        if (action === 'logout') {
            logoutFlow();
            return;
        }
        if (action === 'refresh-state') {
            refreshStateFlow();
            return;
        }
    }

    function restartPollingForCurrentTab() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }

        if (!isLoggedIn()) return;
        if (!tabNeedsLivePolling(currentTab)) return;

        pollTimer = setInterval(function () {
            tickCurrentTab().then(function () {
                renderBody();
            }).catch(function (err) {
                console.error('War Hub poll error:', err);
            });
        }, currentTab === 'members' ? 15000 : 20000);
    }

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
                ensureMounted();
                positionBadge();
            } catch (err) {
                console.error('War Hub remount error:', err);
            }
        }, 500);
    }

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

    function boot() {
    if (!document.body) {
        requestAnimationFrame(boot);
        return;
    }

    tryAutofillBountyPage();
    ensureMounted();
    startRemountWatch();

    if (isLoggedIn()) {
        loadState().then(function () {
            renderBody();
            restartPollingForCurrentTab();
        }).catch(function (err) {
            console.error('War Hub initial load error:', err);
            renderBody();
        });
    } else {
        renderBody();
    }
}

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
        boot();
    }
})();
