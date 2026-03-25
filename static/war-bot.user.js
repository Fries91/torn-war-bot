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
    var hospitalCache = [];
    var hospitalLoadedAt = 0;
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
";

    GM_addStyle(css);

    // ============================================================
    // 06. BASIC UTILITIES
    // ============================================================

    function normalizeAccessCache(raw) {
        var src = raw && typeof raw === 'object' ? raw : {};
        return {
            active: !!src.active,
            is_admin: !!src.is_admin,
            exempt: !!src.exempt,
            faction_id: src.faction_id == null ? '' : String(src.faction_id),
            faction_name: src.faction_name == null ? '' : String(src.faction_name),
            paid_until: src.paid_until || null,
            status: src.status == null ? '' : String(src.status),
            checked_at: src.checked_at || null
        };
    }

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

        if (!overlay) return;
        var box = overlay.querySelector('#warhub-status');
        if (!box) return;

        if (!lastStatusMsg) {
            box.innerHTML = '';
            box.style.display = 'none';
            return;
        }

        box.style.display = 'block';
        box.innerHTML =
            '<div class="warhub-card" style="padding:8px 10px !important; border-color:' +
            (isErr ? 'rgba(220,90,90,.30)' : 'rgba(255,255,255,.08)') +
            ' !important;">' +
            '<div style="font-size:12px !important; font-weight:700 !important; color:' +
            (isErr ? '#ffb3b3' : '#f2f2f2') +
            ' !important;">' + esc(lastStatusMsg) + '</div></div>';
    }

    function updateBadge() {
        if (!badge || !shield) return;

        var count = getLocalNotifications().length;
        if (count > 0) {
            badge.style.display = 'block';
            badge.textContent = count > 99 ? '99+' : String(count);
        } else {
            badge.style.display = 'none';
            badge.textContent = '';
        }

        syncBadgePosition();
    }

    function clearNotifications() {
        setLocalNotifications([]);
        updateBadge();
    }

    // ============================================================
    // 08. REQUEST HELPERS
    // ============================================================

    function getSessionToken() {
        return String(GM_getValue(K_SESSION, '') || '').trim();
    }

    function setSessionToken(token) {
        GM_setValue(K_SESSION, String(token || '').trim());
    }

    function clearSessionToken() {
        GM_deleteValue(K_SESSION);
    }

    function request(method, path, data, authRequired) {
        return new Promise(function (resolve, reject) {
            var headers = { 'Content-Type': 'application/json' };
            var token = getSessionToken();

            if (authRequired !== false && token) {
                headers['X-WarHub-Session'] = token;
            }

            GM_xmlhttpRequest({
                method: method,
                url: BASE_URL + path,
                headers: headers,
                data: data ? JSON.stringify(data) : null,
                timeout: 30000,
                onload: function (res) {
                    try {
                        var json = {};
                        try {
                            json = JSON.parse(res.responseText || '{}');
                        } catch (_unused) {
                            json = {};
                        }

                        if (res.status >= 200 && res.status < 300) {
                            resolve(json);
                            return;
                        }

                        reject(new Error(json.error || ('HTTP ' + res.status)));
                    } catch (err) {
                        reject(err);
                    }
                },
                ontimeout: function () {
                    reject(new Error('Request timeout'));
                },
                onerror: function () {
                    reject(new Error('Network error'));
                }
            });
        });
    }

    function apiGet(path, authRequired) {
        return request('GET', path, null, authRequired);
    }

    function apiPost(path, data, authRequired) {
        return request('POST', path, data || {}, authRequired);
    }

    function apiDelete(path, data, authRequired) {
        return request('DELETE', path, data || {}, authRequired);
    }

    // ============================================================
    // 09. ACCESS / AUTH HELPERS
    // ============================================================

    function isLoggedIn() {
        return !!getSessionToken();
    }

    function isAdmin() {
        return !!(accessState && accessState.is_admin);
    }

    function isActiveUser() {
        return !!(accessState && accessState.active);
    }

    function getRefreshMs() {
        var raw = Number(GM_getValue(K_REFRESH, 15000));
        if (!Number.isFinite(raw)) raw = 15000;
        return Math.min(60000, Math.max(5000, raw));
    }

    async function loginWithApiKey(apiKey) {
        var cleanKey = cleanInputValue(apiKey);
        if (!cleanKey) throw new Error('Enter your Torn API key');

        var res = await apiPost('/api/login', { api_key: cleanKey }, false);

        if (!res || !res.session_token) {
            throw new Error('Login failed');
        }

        setSessionToken(res.session_token);
        GM_setValue(K_API_KEY, cleanKey);

        accessState = normalizeAccessCache(res.license || {});
        GM_setValue(K_ACCESS_CACHE, accessState);

        return res;
    }

    async function logoutNow() {
        try {
            await apiPost('/api/logout', {}, true);
        } catch (_unused) {}

        clearSessionToken();
        accessState = normalizeAccessCache({});
        GM_setValue(K_ACCESS_CACHE, accessState);
        state = null;
        factionMembersCache = null;
        currentFactionMembers = [];
        liveSummaryCache = null;
        warEnemiesCache = [];
        hospitalCache = [];
        adminTopFiveCache = null;

        clearNotifications();
        stopPolling();
        stopMembersCountdownLoop();

        if (overlay) {
            renderBody();
            setStatus('Logged out.', false);
        }
    }

    // ============================================================
    // 10. DATE / TIME / STATE HELPERS
    // ============================================================

    function secondsUntil(isoValue) {
        if (!isoValue) return 0;
        var ts = new Date(isoValue).getTime();
        if (!Number.isFinite(ts)) return 0;
        return Math.max(0, Math.floor((ts - Date.now()) / 1000));
    }

    function getStatusClass(stateName) {
        var s = String(stateName || '').toLowerCase();
        if (s === 'online') return 'online';
        if (s === 'idle') return 'idle';
        if (s === 'traveling' || s === 'travel') return 'travel';
        if (s === 'hospital') return 'hospital';
        if (s === 'jail') return 'jail';
        return 'offline';
    }

    function normalizeStateName(value) {
        var s = String(value || '').toLowerCase();
        if (s === 'travelling') s = 'travel';
        if (s === 'traveling') s = 'travel';
        if (s === 'abroad') s = 'travel';
        if (s === 'okay') s = 'online';
        if (s === 'active') s = 'online';
        return s || 'offline';
    }

    function statusPill(stateName) {
        var s = normalizeStateName(stateName);
        var label = s.charAt(0).toUpperCase() + s.slice(1);
        return '<span class="warhub-pill ' + getStatusClass(s) + '">' + esc(label) + '</span>';
    }

    function playerLinkHtml(playerId, name) {
        var pid = String(playerId || '').trim();
        var nm = esc(name || 'Unknown');
        if (!pid) return '<span class="warhub-member-name">' + nm + '</span>';
        return '<a class="warhub-member-name" href="https://www.torn.com/profiles.php?XID=' + encodeURIComponent(pid) + '" target="_blank" rel="noopener noreferrer">' + nm + '</a>';
    }

    function safeTextBlock(text, fallback) {
        var t = String(text || '').trim();
        if (!t) return '<div class="warhub-muted">' + esc(fallback || 'Nothing yet.') + '</div>';
        return '<div class="warhub-spy-box" style="white-space:pre-wrap !important;">' + esc(t) + '</div>';
    }

    function getOverviewBoxPrefs() {
        var src = GM_getValue(K_OVERVIEW_BOXES, null);
        var base = {
            terms: true,
            meddeals: true,
            dibs: true
        };

        if (!src || typeof src !== 'object') return base;

        return {
            terms: src.terms !== false,
            meddeals: src.meddeals !== false,
            dibs: src.dibs !== false
        };
    }

    function setOverviewBoxPref(key, value) {
        var prefs = getOverviewBoxPrefs();
        prefs[key] = !!value;
        GM_setValue(K_OVERVIEW_BOXES, prefs);
    }

    function getOwnFactionName() {
        var ownFaction = (state && state.faction) || {};
        var war = (state && state.war) || {};
        var license = (state && state.license) || {};

        return String(
            ownFaction.name ||
            war.our_faction_name ||
            war.faction_name ||
            license.faction_name ||
            'Your Faction'
        );
    }

    function getEnemyFactionName() {
        var war = (state && state.war) || {};
        return String(
            war.enemy_faction_name ||
            warEnemiesFactionName ||
            'No current enemy'
        );
    }

    function getEnemyFactionId() {
        var war = (state && state.war) || {};
        return String(
            war.enemy_faction_id ||
            warEnemiesFactionId ||
            ''
        );
    }

    // ============================================================
    // 11. DATA LOADERS
    // ============================================================

    async function loadState(showStatus) {
        var res = await apiGet('/api/state', true);
        state = res || {};

        accessState = normalizeAccessCache((state && state.license) || accessState || {});
        GM_setValue(K_ACCESS_CACHE, accessState);

        if (showStatus) {
            setStatus('Loaded.', false);
        }

        updateBadge();
        return state;
    }

    async function loadFactionMembers(force) {
        if (!force && factionMembersCache && arr(factionMembersCache.members).length) {
            currentFactionMembers = arr(factionMembersCache.members);
            membersLiveStamp = Date.now();
            return factionMembersCache;
        }

        var res = await apiGet('/api/members', true);
        factionMembersCache = res || { members: [] };
        currentFactionMembers = arr(factionMembersCache.members);
        membersLiveStamp = Date.now();
        return factionMembersCache;
    }

    async function loadWarEnemies(force) {
        if (!force && warEnemiesCache.length && (Date.now() - warEnemiesLoadedAt) < 15000) {
            return {
                enemies: warEnemiesCache,
                enemy_faction_name: warEnemiesFactionName,
                enemy_faction_id: warEnemiesFactionId
            };
        }

        var res = await apiGet('/api/enemies', true);
        warEnemiesCache = arr(res && res.enemies);
        warEnemiesFactionName = String((res && res.enemy_faction_name) || '');
        warEnemiesFactionId = String((res && res.enemy_faction_id) || '');
        warEnemiesLoadedAt = Date.now();
        return res || {};
    }

    async function loadHospital(force) {
        if (!force && hospitalCache.length && (Date.now() - hospitalLoadedAt) < 5000) {
            return { items: hospitalCache };
        }

        var src = (state && state.hospital && arr(state.hospital.items).length) ? arr(state.hospital.items) : [];
        if (!force && src.length) {
            hospitalCache = src;
            hospitalLoadedAt = Date.now();
            return { items: hospitalCache };
        }

        var res = await apiGet('/api/state', true);
        state = res || state || {};
        hospitalCache = arr(state && state.hospital && state.hospital.items);
        hospitalLoadedAt = Date.now();
        return { items: hospitalCache };
    }

    async function claimDibs(enemyId) {
        return await apiPost('/api/hospital/dibs', { enemy_id: String(enemyId || '') }, true);
    }

    async function loadLiveSummary(force) {
        if (!force && liveSummaryCache && (Date.now() - liveSummaryLastAt) < 10000) {
            return liveSummaryCache;
        }

        liveSummaryLoading = true;
        liveSummaryError = '';

        try {
            var res = await apiGet('/api/summary/live', true);
            liveSummaryCache = res || {};
            liveSummaryLastAt = Date.now();
            return liveSummaryCache;
        } catch (err) {
            liveSummaryError = err && err.message ? err.message : 'Failed to load summary';
            throw err;
        } finally {
            liveSummaryLoading = false;
        }
    }

    async function loadAdminTopFive(force) {
        if (!force && adminTopFiveCache && (Date.now() - Number(adminTopFiveCache._loaded_at || 0)) < 30000) {
            return adminTopFiveCache;
        }

        var res = await apiGet('/api/admin/top5', true);
        adminTopFiveCache = Object.assign({}, res || {}, { _loaded_at: Date.now() });
        return adminTopFiveCache;
    }

    // ============================================================
    // 12. MEMBER / ENEMY NORMALIZERS
    // ============================================================

    function normalizeMember(item) {
        var src = item && typeof item === 'object' ? item : {};
        var stateName = normalizeStateName(
            src.online_state ||
            src.status ||
            src.state ||
            src.status_state
        );

        return {
            id: src.user_id || src.player_id || src.id || '',
            name: src.name || src.user_name || 'Unknown',
            level: Number(src.level || 0),
            position: src.position || '',
            life_current: Number(src.life_current || src.current_life || 0),
            life_max: Number(src.life_max || src.max_life || 0),
            energy: Number(src.energy || 0),
            med_cd: Number(src.med_cd || src.medical_cooldown || 0),
            online_state: stateName,
            status_cd: Number(src.status_cd || src.hospital_time_left || src.jail_time_left || src.travel_time_left || 0),
            last_action: src.last_action || '',
            xanax: Number(src.xanax || 0),
            boosters: Number(src.boosters || 0),
            revives: Number(src.revives || 0)
        };
    }

    function normalizeEnemy(item) {
        var src = item && typeof item === 'object' ? item : {};
        var stateName = normalizeStateName(
            src.online_state ||
            src.status ||
            src.state ||
            src.status_state
        );

        return {
            id: src.user_id || src.player_id || src.id || '',
            name: src.name || src.user_name || 'Unknown',
            level: Number(src.level || 0),
            faction_position: src.faction_position || src.position || '',
            online_state: stateName,
            life_current: Number(src.life_current || src.current_life || 0),
            life_max: Number(src.life_max || src.max_life || 0),
            hosp_out_ts: src.hospital_until_ts || src.hosp_out_ts || '',
            hosp_text: src.hospital_time_left_text || src.hosp_text || '',
            hosp_secs: Number(src.hospital_time_left || src.hosp_secs || 0),
            dibs_by_name: src.dibs_by_name || '',
            dibs_available: !!src.dibs_available,
            dibs_locked_until_ts: src.dibs_locked_until_ts || '',
            dibs_visible_until_ts: src.dibs_visible_until_ts || ''
        };
    }

    function groupMembersByState(items) {
        var groups = {
            online: [],
            idle: [],
            travel: [],
            hospital: [],
            jail: [],
            offline: []
        };

        arr(items).forEach(function (raw) {
            var item = normalizeMember(raw);
            var key = item.online_state;
            if (!groups[key]) key = 'offline';
            groups[key].push(item);
        });

        return groups;
    }
        // ============================================================
    // 13. HOSPITAL / DIBS HELPERS
    // ============================================================

    function getHospitalItems() {
        var src = arr(state && state.hospital && state.hospital.items);
        if (src.length) return src.map(normalizeEnemy);

        return arr(warEnemiesCache)
            .map(normalizeEnemy)
            .filter(function (item) {
                return item.online_state === 'hospital' || item.hosp_secs > 0;
            });
    }

    function getActiveDibsText() {
        var dibs = (state && state.dibs) || {};
        var items = arr(dibs.items);

        if (String(dibs.text || '').trim()) {
            return String(dibs.text || '').trim();
        }

        if (!items.length) return '';

        return items.map(function (item) {
            var enemyName = String(item.enemy_name || item.name || 'Unknown');
            var dibber = String(item.dibbed_by_name || item.dibs_by_name || 'Unknown');
            return enemyName + ' — ' + dibber;
        }).join('\n');
    }

    function findHospitalItemById(enemyId) {
        var id = String(enemyId || '').trim();
        if (!id) return null;

        var items = getHospitalItems();
        for (var i = 0; i < items.length; i += 1) {
            if (String(items[i].id) === id) return items[i];
        }
        return null;
    }

    function dibsLabelForItem(item) {
        if (!item) return '';

        if (item.dibs_by_name) {
            return 'Dibs: ' + String(item.dibs_by_name);
        }

        if (item.dibs_available) {
            return 'Available';
        }

        var secs = secondsUntil(item.dibs_locked_until_ts);
        if (secs > 0) {
            return 'Locked ' + formatCountdown(secs);
        }

        return 'Unavailable';
    }

    function dibsButtonHtml(item) {
        var enemyId = String(item && item.id || '').trim();
        if (!enemyId) {
            return '<span class="warhub-pill neutral">No ID</span>';
        }

        if (item.dibs_by_name) {
            return '<span class="warhub-pill bad">' + esc(String(item.dibs_by_name)) + '</span>';
        }

        if (item.dibs_available) {
            return '<button class="warhub-btn" type="button" data-dibs-id="' + esc(enemyId) + '">Dibs</button>';
        }

        var secs = secondsUntil(item.dibs_locked_until_ts);
        if (secs > 0) {
            return '<span class="warhub-pill neutral">Open in ' + esc(formatCountdown(secs)) + '</span>';
        }

        return '<span class="warhub-pill neutral">Unavailable</span>';
    }

    async function handleDibsClick(enemyId) {
        var targetId = String(enemyId || '').trim();
        if (!targetId) return;

        try {
            setStatus('Claiming dibs...', false);
            await claimDibs(targetId);
            await loadState(false);
            await loadHospital(true);
            hospitalLoadedAt = 0;
            setStatus('Dibs claimed.', false);
            renderBody();
        } catch (err) {
            setStatus(err && err.message ? err.message : 'Failed to claim dibs', true);
        }
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
                '<div class="warhub-status-wrap"><div id="warhub-status" style="display:none !important;"></div></div>',
                '<div id="warhub-body-inner"></div>',
            '</div>'
        ].join('');

        document.body.appendChild(shield);
        document.body.appendChild(badge);
        document.body.appendChild(overlay);

        bindStaticEvents();
        renderTabs();
        restoreShieldPosition();
        restoreOverlayPosition();
        setOpen(isOpen, false);
        updateBadge();

        mounted = true;
        setStatus(lastStatusMsg, lastStatusErr);
    }

    function bindStaticEvents() {
        if (!shield || !overlay) return;

        shield.addEventListener('click', function () {
            if (dragMoved) {
                dragMoved = false;
                return;
            }
            setOpen(!isOpen, true);
        });

        var closeBtn = overlay.querySelector('#warhub-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', function () {
                setOpen(false, true);
            });
        }

        var dragShield = makeHoldDraggable(shield, shield, K_SHIELD_POS, {
            onMove: function () {
                syncBadgePosition();
            },
            onEnd: function (moved) {
                dragMoved = !!moved;
                syncBadgePosition();
            }
        });

        makeHoldDraggable(
            overlay.querySelector('#warhub-head'),
            overlay,
            K_OVERLAY_POS,
            {
                boundsInset: 4
            }
        );

        overlay.addEventListener('click', function (ev) {
            var dibsBtn = ev.target && ev.target.closest ? ev.target.closest('[data-dibs-id]') : null;
            if (dibsBtn) {
                ev.preventDefault();
                ev.stopPropagation();
                handleDibsClick(dibsBtn.getAttribute('data-dibs-id'));
                return;
            }

            var tabBtn = ev.target && ev.target.closest ? ev.target.closest('[data-warhub-tab]') : null;
            if (tabBtn) {
                ev.preventDefault();
                switchTab(tabBtn.getAttribute('data-warhub-tab'));
                return;
            }

            var groupHead = ev.target && ev.target.closest ? ev.target.closest('[data-group-toggle]') : null;
            if (groupHead) {
                ev.preventDefault();
                var box = groupHead.parentElement;
                if (!box) return;
                var body = box.querySelector('.warhub-member-list');
                if (!body) return;
                var isHidden = body.style.display === 'none';
                body.style.display = isHidden ? 'flex' : 'none';
                return;
            }
        });

        overlay.addEventListener('change', function (ev) {
            var pref = ev.target && ev.target.closest ? ev.target.closest('[data-overview-pref]') : null;
            if (!pref) return;

            setOverviewBoxPref(pref.getAttribute('data-overview-pref'), !!pref.checked);
            renderBody();
        });

        var body = overlay.querySelector('#warhub-body');
        if (body) {
            body.addEventListener('scroll', function () {
                GM_setValue(K_OVERLAY_SCROLL, body.scrollTop || 0);
            }, { passive: true });
        }
    }

    function renderTabs() {
        if (!overlay) return;

        var row1 = overlay.querySelector('#warhub-tabs-row-1');
        var row2 = overlay.querySelector('#warhub-tabs-row-2');

        if (row1) {
            row1.innerHTML = TAB_ROW_1.map(function (pair) {
                var key = pair[0];
                var label = pair[1];
                var active = currentTab === key ? ' active' : '';
                return '<button class="warhub-tab' + active + '" type="button" data-warhub-tab="' + esc(key) + '">' + esc(label) + '</button>';
            }).join('');
        }

        if (row2) {
            row2.innerHTML = TAB_ROW_2
                .filter(function (pair) {
                    if (pair[0] === 'admin' && !isAdmin()) return false;
                    return true;
                })
                .map(function (pair) {
                    var key = pair[0];
                    var label = pair[1];
                    var active = currentTab === key ? ' active' : '';
                    return '<button class="warhub-tab' + active + '" type="button" data-warhub-tab="' + esc(key) + '">' + esc(label) + '</button>';
                }).join('');
        }
    }

    function setOpen(open, persist) {
        isOpen = !!open;
        if (persist !== false) {
            GM_setValue(K_OPEN, isOpen);
        }

        if (!overlay) return;

        if (isOpen) {
            overlay.classList.add('open');
            restoreOverlayScroll();
            restartPollingForCurrentTab();
        } else {
            overlay.classList.remove('open');
            stopPolling();
        }
    }

    function switchTab(tab) {
        var next = String(tab || '').trim() || 'overview';
        if (currentTab === next) return;

        currentTab = next;
        GM_setValue(K_TAB, currentTab);
        renderTabs();
        renderBody();
        restartPollingForCurrentTab();
    }

    function restoreOverlayScroll() {
        if (!overlay) return;
        var body = overlay.querySelector('#warhub-body');
        if (!body) return;
        var top = Number(GM_getValue(K_OVERLAY_SCROLL, 0) || 0);
        if (Number.isFinite(top) && top > 0) {
            body.scrollTop = top;
        }
    }

    function syncBadgePosition() {
        if (!shield || !badge) return;

        var rect = shield.getBoundingClientRect();
        badge.style.left = Math.round(rect.right - 8) + 'px';
        badge.style.top = Math.round(rect.top - 6) + 'px';
    }

    function restoreShieldPosition() {
        if (!shield) return;

        var saved = GM_getValue(K_SHIELD_POS, null);
        var pos = normalizeStoredPos(saved, {
            left: Math.max(8, window.innerWidth - 58),
            top: Math.max(88, Math.min(window.innerHeight - 88, 160))
        });

        applyPosition(shield, pos.left, pos.top);
        syncBadgePosition();
    }

    function restoreOverlayPosition() {
        if (!overlay) return;

        var saved = GM_getValue(K_OVERLAY_POS, null);
        if (!saved || typeof saved !== 'object') return;

        var pos = normalizeStoredPos(saved, null);
        if (!pos) return;

        overlay.style.left = pos.left + 'px';
        overlay.style.top = pos.top + 'px';
        overlay.style.right = 'auto';
        overlay.style.bottom = 'auto';
        overlay.style.margin = '0';
        overlay.style.maxWidth = Math.max(320, Math.min(window.innerWidth - 12, 520)) + 'px';
        overlay.style.width = Math.min(window.innerWidth - 12, Math.max(320, overlay.offsetWidth || 420)) + 'px';
        overlay.style.height = Math.min(window.innerHeight - 12, Math.max(300, overlay.offsetHeight || (window.innerHeight - 16))) + 'px';
    }

    function applyPosition(target, left, top) {
        if (!target) return;

        target.style.left = Math.round(left) + 'px';
        target.style.top = Math.round(top) + 'px';
        target.style.right = 'auto';
        target.style.bottom = 'auto';
        target.style.margin = '0';
    }

    function normalizeStoredPos(raw, fallback) {
        if (!raw || typeof raw !== 'object') return fallback;
        var left = Number(raw.left);
        var top = Number(raw.top);
        if (!Number.isFinite(left) || !Number.isFinite(top)) return fallback;
        return { left: left, top: top };
    }

    function makeHoldDraggable(handle, target, key, options) {
        if (!handle || !target) {
            return {
                didMove: function () { return false; },
                isDragging: function () { return false; }
            };
        }

        options = options || {};

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

        function getPoint(ev) {
            var t = ev.touches && ev.touches[0] ? ev.touches[0] : ev;
            return { x: Number(t.clientX || 0), y: Number(t.clientY || 0) };
        }

        function begin(ev) {
            if (!target || !document.body) return;

            moved = false;
            pressActive = false;

            var p = getPoint(ev);
            startX = p.x;
            startY = p.y;

            var rect = target.getBoundingClientRect();
            startLeft = rect.left;
            startTop = rect.top;

            clearPressTimer();
            pressTimer = setTimeout(function () {
                pressActive = true;
                dragging = true;
                target.classList.add('dragging');
            }, HOLD_MS);
        }

        function move(ev) {
            var p = getPoint(ev);
            var dx = p.x - startX;
            var dy = p.y - startY;
            var dist = Math.sqrt((dx * dx) + (dy * dy));

            if (!pressActive && dist > DRAG_THRESHOLD) {
                clearPressTimer();
            }

            if (!dragging) return;

            ev.preventDefault();

            var nextLeft = startLeft + dx;
            var nextTop = startTop + dy;
            var inset = Number(options.boundsInset || 0);

            var maxLeft = Math.max(inset, window.innerWidth - target.offsetWidth - inset);
            var maxTop = Math.max(inset, window.innerHeight - target.offsetHeight - inset);

            nextLeft = Math.max(inset, Math.min(maxLeft, nextLeft));
            nextTop = Math.max(inset, Math.min(maxTop, nextTop));

            applyPosition(target, nextLeft, nextTop);
            GM_setValue(key, { left: nextLeft, top: nextTop });

            moved = true;

            if (typeof options.onMove === 'function') {
                options.onMove(nextLeft, nextTop);
            }
        }

        function end() {
            clearPressTimer();

            if (dragging) {
                dragging = false;
                target.classList.remove('dragging');
            }

            if (typeof options.onEnd === 'function') {
                options.onEnd(moved);
            }

            setTimeout(function () {
                moved = false;
                pressActive = false;
            }, 0);
        }

        handle.addEventListener('touchstart', begin, { passive: true });
        window.addEventListener('touchmove', move, { passive: false });
        window.addEventListener('touchend', end, { passive: true });

        handle.addEventListener('mousedown', begin);
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', end);

        return {
            didMove: function () { return moved; },
            isDragging: function () { return dragging; }
        };
    }

    // ============================================================
    // 15. RENDER HELPERS
    // ============================================================

    function setBodyHtml(html) {
        if (!overlay) return;
        var body = overlay.querySelector('#warhub-body-inner');
        if (!body) return;
        body.innerHTML = html;
        setStatus(lastStatusMsg, lastStatusErr);
    }

    function renderLoadingCard(label) {
        return '<div class="warhub-card"><div class="warhub-muted">' + esc(label || 'Loading...') + '</div></div>';
    }

    function renderEmptyCard(label) {
        return '<div class="warhub-card"><div class="warhub-muted">' + esc(label || 'Nothing to show.') + '</div></div>';
    }
        function renderOverviewTab() {
        var war = (state && state.war) || {};
        var ownFaction = (state && state.faction) || {};
        var ownName = String(
            ownFaction.name ||
            war.our_faction_name ||
            war.faction_name ||
            (accessState && accessState.faction_name) ||
            'Your Faction'
        );
        var enemyName = getEnemyFactionName();

        var scoreUs = Number(war.score_us || war.our_score || 0);
        var scoreThem = Number(war.score_them || war.enemy_score || 0);
        var chainUs = Number(war.chain_us || 0);
        var chainThem = Number(war.chain_them || 0);

        var termsText = String((state && state.terms && state.terms.text) || '');
        var medDealsText = String((state && state.med_deals && state.med_deals.text) || '');
        var dibsText = getActiveDibsText();

        var prefs = getOverviewBoxPrefs();

        return [
            '<div class="warhub-grid">',
                '<div class="warhub-hero-card warhub-overview-hero">',
                    '<div class="warhub-war-head">',
                        '<div class="warhub-war-side">',
                            '<div class="warhub-war-side-label">Our faction</div>',
                            '<div class="warhub-war-side-name">' + esc(ownName) + '</div>',
                        '</div>',
                        '<div class="warhub-war-vs">VS</div>',
                        '<div class="warhub-war-side right">',
                            '<div class="warhub-war-side-label">Enemy faction</div>',
                            '<div class="warhub-war-side-name">' + esc(enemyName) + '</div>',
                        '</div>',
                    '</div>',
                    '<div class="warhub-overview-stats">',
                        '<div class="warhub-stat-card ' + (scoreUs >= scoreThem ? 'good' : 'bad') + '">',
                            '<div class="warhub-stat-label">Our score</div>',
                            '<div class="warhub-stat-value">' + fmtNum(scoreUs) + '</div>',
                        '</div>',
                        '<div class="warhub-stat-card ' + (scoreThem > scoreUs ? 'bad' : 'good') + '">',
                            '<div class="warhub-stat-label">Enemy score</div>',
                            '<div class="warhub-stat-value">' + fmtNum(scoreThem) + '</div>',
                        '</div>',
                        '<div class="warhub-stat-card ' + (chainUs >= chainThem ? 'good' : 'bad') + '">',
                            '<div class="warhub-stat-label">Our chain</div>',
                            '<div class="warhub-stat-value">' + fmtNum(chainUs) + '</div>',
                        '</div>',
                        '<div class="warhub-stat-card ' + (chainThem > chainUs ? 'bad' : 'good') + '">',
                            '<div class="warhub-stat-label">Enemy chain</div>',
                            '<div class="warhub-stat-value">' + fmtNum(chainThem) + '</div>',
                        '</div>',
                    '</div>',
                '</div>',

                '<div class="warhub-card">',
                    '<div class="warhub-row" style="justify-content:space-between !important;">',
                        '<h3 style="margin:0 !important;">Overview boxes</h3>',
                        '<div class="warhub-row">',
                            '<label class="warhub-row"><input type="checkbox" data-overview-pref="terms" ' + (prefs.terms ? 'checked' : '') + '> <span class="warhub-label">Terms</span></label>',
                            '<label class="warhub-row"><input type="checkbox" data-overview-pref="meddeals" ' + (prefs.meddeals ? 'checked' : '') + '> <span class="warhub-label">Med Deals</span></label>',
                            '<label class="warhub-row"><input type="checkbox" data-overview-pref="dibs" ' + (prefs.dibs ? 'checked' : '') + '> <span class="warhub-label">Dibs</span></label>',
                        '</div>',
                    '</div>',
                '</div>',

                '<div class="warhub-mini-grid">',
                    (prefs.terms ? [
                        '<div class="warhub-card warhub-overview-link-card terms">',
                            '<h3>War Terms</h3>',
                            safeTextBlock(termsText, 'No war terms set.'),
                        '</div>'
                    ].join('') : ''),
                    (prefs.meddeals ? [
                        '<div class="warhub-card warhub-overview-link-card meddeals">',
                            '<h3>Med Deals</h3>',
                            safeTextBlock(medDealsText, 'No med deals posted.'),
                        '</div>'
                    ].join('') : ''),
                    (prefs.dibs ? [
                        '<div class="warhub-card warhub-overview-link-card dibs">',
                            '<h3>Dibs</h3>',
                            safeTextBlock(dibsText, 'No active dibs.'),
                        '</div>'
                    ].join('') : ''),
                '</div>',
            '</div>'
        ].join('');
    }

    function renderMembersTab() {
        var members = arr(currentFactionMembers).map(normalizeMember);
        if (!members.length) return renderEmptyCard('No faction members found.');

        var groups = groupMembersByState(members);
        var order = [
            ['online', 'Online'],
            ['idle', 'Idle'],
            ['travel', 'Travel'],
            ['hospital', 'Hospital'],
            ['jail', 'Jail'],
            ['offline', 'Offline']
        ];

        return [
            '<div class="warhub-grid">',
                order.map(function (pair) {
                    var key = pair[0];
                    var label = pair[1];
                    var items = arr(groups[key]);

                    return [
                        '<div class="warhub-member-group">',
                            '<div class="warhub-member-group-head" data-group-toggle="' + esc(key) + '">',
                                '<div class="warhub-row">',
                                    '<strong>' + esc(label) + '</strong>',
                                    '<span class="warhub-pill ' + esc(getStatusClass(key)) + '">' + fmtNum(items.length) + '</span>',
                                '</div>',
                                '<div class="warhub-muted">Tap to open</div>',
                            '</div>',
                            '<div class="warhub-member-list" style="' + (items.length ? '' : 'display:none !important;') + '">',
                                items.map(function (item) {
                                    var lifeText = item.life_max > 0 ? (fmtNum(item.life_current) + '/' + fmtNum(item.life_max)) : '—';
                                    return [
                                        '<div class="warhub-member-row" data-state-name="' + esc(item.online_state) + '" data-medcd-base="' + esc(item.med_cd) + '" data-statuscd-base="' + esc(item.status_cd) + '">',
                                            '<div class="warhub-member-main">',
                                                '<div class="warhub-col">',
                                                    '<div class="warhub-row">',
                                                        playerLinkHtml(item.id, item.name),
                                                        statusPill(item.online_state),
                                                    '</div>',
                                                    '<div class="warhub-statline">',
                                                        '<span>Life: <strong>' + esc(lifeText) + '</strong></span>',
                                                        '<span>Energy: <strong>' + fmtNum(item.energy) + '</strong></span>',
                                                        '<span>Med CD: <strong data-medcd>' + (item.med_cd > 0 ? esc(formatCountdown(item.med_cd)) : 'Ready') + '</strong></span>',
                                                        '<span>Status: <strong data-statuscd>' + esc(item.online_state.charAt(0).toUpperCase() + item.online_state.slice(1)) + '</strong></span>',
                                                    '</div>',
                                                '</div>',
                                            '</div>',
                                        '</div>'
                                    ].join('');
                                }).join(''),
                            '</div>',
                        '</div>'
                    ].join('');
                }).join(''),
            '</div>'
        ].join('');
    }

    function renderEnemiesTab() {
        var enemies = arr(warEnemiesCache).map(normalizeEnemy);
        if (!enemies.length) return renderEmptyCard('No enemies loaded.');

        return [
            '<div class="warhub-grid">',
                '<div class="warhub-card">',
                    '<h3>Enemy Members</h3>',
                    '<div class="warhub-muted">' + esc(getEnemyFactionName()) + '</div>',
                '</div>',
                '<div class="warhub-card warhub-section-scroll">',
                    enemies.map(function (item) {
                        var lifeText = item.life_max > 0 ? (fmtNum(item.life_current) + '/' + fmtNum(item.life_max)) : '—';
                        return [
                            '<div class="warhub-kv">',
                                '<div class="warhub-col">',
                                    '<div class="warhub-row">',
                                        playerLinkHtml(item.id, item.name),
                                        statusPill(item.online_state),
                                    '</div>',
                                    '<div class="warhub-statline">',
                                        '<span>Life: <strong>' + esc(lifeText) + '</strong></span>',
                                        (item.hosp_secs > 0 ? '<span>Hosp: <strong>' + esc(fmtHosp(item.hosp_secs, item.hosp_text)) + '</strong></span>' : ''),
                                    '</div>',
                                '</div>',
                                '<div>' + (item.dibs_by_name ? '<span class="warhub-pill bad">' + esc(item.dibs_by_name) + '</span>' : '') + '</div>',
                            '</div>'
                        ].join('');
                    }).join(''),
                '</div>',
            '</div>'
        ].join('');
    }

    function renderHospitalTab() {
        var items = getHospitalItems();
        if (!items.length) return renderEmptyCard('No enemy members in hospital.');

        items.sort(function (a, b) {
            return Number(b.hosp_secs || 0) - Number(a.hosp_secs || 0);
        });

        return [
            '<div class="warhub-grid">',
                '<div class="warhub-card">',
                    '<h3>Hospital Targets</h3>',
                    '<div class="warhub-muted">Tap dibs to claim a hospital target. Dibs comes back 30 seconds after they are out. Overview keeps the dibs visible a little longer.</div>',
                '</div>',
                '<div class="warhub-card warhub-section-scroll">',
                    items.map(function (item) {
                        return [
                            '<div class="warhub-kv">',
                                '<div class="warhub-col">',
                                    '<div class="warhub-row">',
                                        playerLinkHtml(item.id, item.name),
                                        '<span class="warhub-pill hospital">Hospital</span>',
                                    '</div>',
                                    '<div class="warhub-statline">',
                                        '<span>Out in: <strong>' + esc(fmtHosp(item.hosp_secs, item.hosp_text)) + '</strong></span>',
                                        '<span>' + esc(dibsLabelForItem(item)) + '</span>',
                                    '</div>',
                                '</div>',
                                '<div>' + dibsButtonHtml(item) + '</div>',
                            '</div>'
                        ].join('');
                    }).join(''),
                '</div>',
            '</div>'
        ].join('');
    }

    function renderTermsTab() {
        var text = String((state && state.terms && state.terms.text) || '');
        return [
            '<div class="warhub-grid">',
                '<div class="warhub-card">',
                    '<h3>War Terms</h3>',
                    safeTextBlock(text, 'No war terms saved.'),
                '</div>',
            '</div>'
        ].join('');
    }

    function renderMedDealsTab() {
        var text = String((state && state.med_deals && state.med_deals.text) || '');
        return [
            '<div class="warhub-grid">',
                '<div class="warhub-card">',
                    '<h3>Med Deals</h3>',
                    safeTextBlock(text, 'No med deals saved.'),
                '</div>',
            '</div>'
        ].join('');
    }

    function renderSummaryTab() {
        var text = String((state && state.summary && state.summary.text) || '');
        return [
            '<div class="warhub-grid">',
                '<div class="warhub-card">',
                    '<h3>War Summary</h3>',
                    safeTextBlock(text, liveSummaryError || 'No summary yet.'),
                '</div>',
            '</div>'
        ].join('');
    }

    function renderFactionTab() {
        var faction = (state && state.faction) || {};
        return [
            '<div class="warhub-grid">',
                '<div class="warhub-card">',
                    '<h3>Faction</h3>',
                    '<div class="warhub-kv"><div>Name</div><div>' + esc(faction.name || getOwnFactionName()) + '</div></div>',
                    '<div class="warhub-kv"><div>Faction ID</div><div>' + esc(faction.id || accessState.faction_id || '—') + '</div></div>',
                    '<div class="warhub-kv"><div>Access</div><div>' + (isActiveUser() ? '<span class="warhub-pill good">Active</span>' : '<span class="warhub-pill bad">Inactive</span>') + '</div></div>',
                '</div>',
            '</div>'
        ].join('');
    }

    function renderSettingsTab() {
        var maskedKey = String(GM_getValue(K_API_KEY, '') || '');
        var showKey = maskedKey ? ('•'.repeat(Math.max(8, Math.min(maskedKey.length, 24)))) : 'Not saved';

        return [
            '<div class="warhub-grid">',
                '<div class="warhub-card">',
                    '<h3>Settings</h3>',
                    '<div class="warhub-kv"><div>User</div><div>' + esc((state && state.user && state.user.name) || 'Logged out') + '</div></div>',
                    '<div class="warhub-kv"><div>Access</div><div>' + (isActiveUser() ? '<span class="warhub-pill good">Active</span>' : '<span class="warhub-pill bad">Inactive</span>') + '</div></div>',
                    '<div class="warhub-kv"><div>Saved API Key</div><div>' + esc(showKey) + '</div></div>',
                    '<div class="warhub-row" style="margin-top:10px !important;">',
                        '<button class="warhub-btn gray" id="warhub-logout-btn" type="button">Log Out</button>',
                    '</div>',
                '</div>',
            '</div>'
        ].join('');
    }

    function renderInstructionsTab() {
        return [
            '<div class="warhub-grid">',
                '<div class="warhub-card">',
                    '<h3>Help</h3>',
                    '<div class="warhub-spy-box" style="white-space:pre-wrap !important;">',
                        esc(
                            '• Drag the shield with a short hold.\n' +
                            '• Hospital tab shows enemy hospital targets.\n' +
                            '• Tap Dibs to claim a target.\n' +
                            '• Overview shows current dibs for everyone.\n' +
                            '• Members tab shows life, energy, and med cooldown.\n' +
                            '• Tabs are mobile and PDA friendly.'
                        ),
                    '</div>',
                '</div>',
            '</div>'
        ].join('');
    }

    function renderTop5Tab() {
        return [
            '<div class="warhub-grid">',
                '<div class="warhub-card">',
                    '<h3>Top 5</h3>',
                    '<div class="warhub-muted">Top 5 data can stay on your backend/admin flow.</div>',
                '</div>',
            '</div>'
        ].join('');
    }

    function renderAdminTab() {
        return [
            '<div class="warhub-grid">',
                '<div class="warhub-card">',
                    '<h3>Admin</h3>',
                    '<div class="warhub-muted">Admin controls stay tied to your backend. This cleaned script keeps the tab and layout light for mobile.</div>',
                '</div>',
            '</div>'
        ].join('');
    }

    function renderBody() {
        if (!overlay) return;

        var html = '';
        if (!isLoggedIn()) {
            html = [
                '<div class="warhub-grid">',
                    '<div class="warhub-card">',
                        '<h3>Login</h3>',
                        '<div class="warhub-col">',
                            '<label class="warhub-label" for="warhub-api-input">Torn API Key</label>',
                            '<input id="warhub-api-input" class="warhub-input" type="password" placeholder="Paste your Torn API key">',
                            '<div class="warhub-row">',
                                '<button class="warhub-btn" id="warhub-login-btn" type="button">Log In</button>',
                            '</div>',
                        '</div>',
                    '</div>',
                '</div>'
            ].join('');
            setBodyHtml(html);
            bindBodyEvents();
            return;
        }

        switch (currentTab) {
            case 'overview':
                html = renderOverviewTab();
                break;
            case 'members':
                html = renderMembersTab();
                break;
            case 'enemies':
                html = renderEnemiesTab();
                break;
            case 'hospital':
                html = renderHospitalTab();
                break;
            case 'meddeals':
                html = renderMedDealsTab();
                break;
            case 'terms':
                html = renderTermsTab();
                break;
            case 'summary':
                html = renderSummaryTab();
                break;
            case 'faction':
                html = renderFactionTab();
                break;
            case 'settings':
                html = renderSettingsTab();
                break;
            case 'instructions':
                html = renderInstructionsTab();
                break;
            case 'wartop5':
                html = renderTop5Tab();
                break;
            case 'admin':
                html = renderAdminTab();
                break;
            default:
                html = renderOverviewTab();
                break;
        }

        setBodyHtml(html);
        bindBodyEvents();

        if (currentTab === 'members') {
            startMembersCountdownLoop();
            tickMembersCountdowns();
        } else {
            stopMembersCountdownLoop();
        }
    }

    function bindBodyEvents() {
        if (!overlay) return;

        var loginBtn = overlay.querySelector('#warhub-login-btn');
        if (loginBtn) {
            loginBtn.onclick = async function () {
                var input = overlay.querySelector('#warhub-api-input');
                try {
                    setStatus('Logging in...', false);
                    await loginWithApiKey(input ? input.value : '');
                    await loadState(false);
                    await loadFactionMembers(true);
                    await loadWarEnemies(true);
                    renderTabs();
                    renderBody();
                    restartPollingForCurrentTab();
                    setStatus('Logged in.', false);
                } catch (err) {
                    setStatus(err && err.message ? err.message : 'Login failed', true);
                }
            };
        }

        var logoutBtn = overlay.querySelector('#warhub-logout-btn');
        if (logoutBtn) {
            logoutBtn.onclick = function () {
                logoutNow();
            };
        }
    }
        // ============================================================
    // 16. POLLING / TAB LOADS
    // ============================================================

    function stopPolling() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    }

    function tabNeedsLivePolling(tab) {
        return [
            'overview',
            'members',
            'enemies',
            'hospital',
            'summary'
        ].indexOf(String(tab || '')) >= 0;
    }

    async function tickCurrentTab() {
        if (loadInFlight) return;
        if (!isLoggedIn()) return;
        if (!tabNeedsLivePolling(currentTab)) return;

        loadInFlight = true;
        try {
            if (currentTab === 'summary') {
                await loadLiveSummary(false);
                renderBody();
                return;
            }

            if (currentTab === 'members') {
                await loadFactionMembers(true);
                renderBody();
                return;
            }

            if (currentTab === 'enemies') {
                await loadWarEnemies(true);
                renderBody();
                return;
            }

            if (currentTab === 'hospital') {
                await loadState(false);
                await loadHospital(true);
                renderBody();
                return;
            }

            await loadState(false);
            renderBody();
        } catch (_unused) {
            // keep quiet during polling
        } finally {
            loadInFlight = false;
        }
    }

    async function restartPollingForCurrentTab() {
        stopPolling();

        if (!isLoggedIn()) return;

        try {
            loadInFlight = true;

            if (currentTab === 'members') {
                await loadFactionMembers(true);
            } else if (currentTab === 'enemies') {
                await loadWarEnemies(true);
            } else if (currentTab === 'hospital') {
                await loadState(false);
                await loadHospital(true);
            } else if (currentTab === 'summary') {
                await loadLiveSummary(true);
            } else {
                await loadState(false);
            }

            renderBody();
        } catch (err) {
            setStatus(err && err.message ? err.message : 'Load failed', true);
        } finally {
            loadInFlight = false;
        }

        if (!tabNeedsLivePolling(currentTab)) return;

        pollTimer = setInterval(function () {
            tickCurrentTab();
        }, getRefreshMs());
    }

    // ============================================================
    // 17. REMOUNT / BOOT
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
            renderTabs();
            renderBody();
        }
    }

    function startRemountWatch() {
        if (remountTimer) {
            clearInterval(remountTimer);
            remountTimer = null;
        }

        remountTimer = setInterval(function () {
            try {
                ensureMounted();
                syncBadgePosition();
            } catch (_unused) {}
        }, 2500);
    }

    async function initialLoad() {
        mount();
        renderTabs();
        renderBody();

        if (!isLoggedIn()) return;

        try {
            setStatus('Loading...', false);
            await loadState(false);

            if (currentTab === 'members') {
                await loadFactionMembers(true);
            } else if (currentTab === 'enemies') {
                await loadWarEnemies(true);
            } else if (currentTab === 'hospital') {
                await loadHospital(true);
            } else if (currentTab === 'summary') {
                await loadLiveSummary(true);
            }

            renderTabs();
            renderBody();
            restartPollingForCurrentTab();
            setStatus('', false);
        } catch (err) {
            setStatus(err && err.message ? err.message : 'Initial load failed', true);
        }
    }

    function whenReady(fn) {
        if (document.readyState === 'complete' || document.readyState === 'interactive') {
            setTimeout(fn, 0);
            return;
        }
        document.addEventListener('DOMContentLoaded', fn, { once: true });
    }

    whenReady(function () {
        initialLoad();
        startRemountWatch();

        window.addEventListener('resize', function () {
            try {
                syncBadgePosition();
            } catch (_unused) {}
        }, { passive: true });
    });

})();
