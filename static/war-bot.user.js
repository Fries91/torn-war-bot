// ==UserScript==
// @name         War Hub ⚔️
// @namespace    fries91-war-hub
// @version      3.4.5
// @description  War Hub by Fries91. Clean split loaders: faction data only from faction routes, enemy data only from enemy routes.
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

    if (window.__WAR_HUB_V330__) return;
    window.__WAR_HUB_V330__ = true;

    var BASE_URL = 'https://torn-war-bot.onrender.com';
    var K_API_KEY = 'warhub_api_key_v3';
    var K_OWNER_TOKEN = 'warhub_owner_token_v3';
    var K_SESSION = 'warhub_session_v3';
    var K_OPEN = 'warhub_open_v3';
    var K_TAB = 'warhub_tab_v3';

    var TAB_ROW_1 = [
        ['overview', 'Overview'],
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
        ['admin', 'Admin']
    ];

    var state = null;
    var tabData = {
        overview: null,
        enemies: null,
        hospital: null,
        targets: null,
        faction: null,
        admin: null,
        summary: null
    };
    var overlay = null;
    var shield = null;
    var statusBox = null;
    var currentTab = String(GM_getValue(K_TAB, 'instructions') || 'instructions');
    var isOpen = !!GM_getValue(K_OPEN, false);
    var pollTimer = null;
    var loading = false;

    GM_addStyle('\
#warhub-shield{position:fixed!important;z-index:2147483647!important;width:30px!important;height:30px!important;border-radius:8px!important;display:flex!important;align-items:center!important;justify-content:center!important;font-size:15px!important;line-height:1!important;cursor:pointer!important;user-select:none!important;-webkit-user-select:none!important;-webkit-touch-callout:none!important;-webkit-tap-highlight-color:transparent!important;touch-action:none!important;box-shadow:0 6px 16px rgba(0,0,0,.38)!important;border:1px solid rgba(255,255,255,.12)!important;background:radial-gradient(circle at 30% 20%, rgba(232,87,87,.98), rgba(133,13,13,.98) 55%, rgba(56,7,7,.99))!important;color:#fff!important;left:auto!important;right:6px!important;top:405px!important;bottom:auto!important;transform:none!important;opacity:1!important;visibility:visible!important;pointer-events:auto!important;}\
#warhub-miniheader,#warhub-miniheader-inner,#warhub-miniheader-button,#warhub-nav-button-wrap,#warhub-nav-button{display:none!important;}\
#warhub-overlay{position:fixed!important;left:8px!important;right:8px!important;top:8px!important;bottom:8px!important;max-width:580px!important;margin:0 auto!important;background:linear-gradient(180deg,#1a0d0d,#120909 18%,#0c0c0c 68%,#090909)!important;color:#f2f2f2!important;border:1px solid rgba(255,255,255,.08)!important;border-radius:16px!important;box-shadow:0 20px 44px rgba(0,0,0,.62)!important;display:none!important;flex-direction:column!important;z-index:2147483646!important;overflow:hidden!important;}\
#warhub-overlay.open{display:flex!important;}\
#warhub-overlay *{box-sizing:border-box!important;font-family:inherit!important;}\
.warhub-head{padding:14px 12px 12px!important;border-bottom:1px solid rgba(255,255,255,.08)!important;background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.02))!important;}\
.warhub-row{display:flex!important;gap:8px!important;align-items:center!important;flex-wrap:wrap!important;}\
.warhub-top{display:flex!important;justify-content:space-between!important;align-items:center!important;gap:10px!important;}\
.warhub-title{font-weight:900!important;font-size:17px!important;color:#fff!important;letter-spacing:.2px!important;}\
.warhub-sub{opacity:.82!important;font-size:11px!important;color:#f3dede!important;line-height:1.35!important;}\
.warhub-close,.warhub-btn,.warhub-tab{appearance:none!important;-webkit-appearance:none!important;border:1px solid rgba(255,255,255,.12)!important;color:#fff!important;border-radius:10px!important;min-height:36px!important;padding:8px 12px!important;font-weight:800!important;background:rgba(255,255,255,.08)!important;}\
.warhub-btn.primary,.warhub-tab.active{background:linear-gradient(180deg, rgba(221,59,59,.98), rgba(132,18,18,.99))!important;border-color:rgba(255,255,255,.16)!important;}\
.warhub-btn.green{background:linear-gradient(180deg, rgba(45,171,98,.98), rgba(20,115,61,.98))!important;}\
.warhub-btn.gray{background:rgba(255,255,255,.10)!important;}\
.warhub-btn.warn{background:linear-gradient(180deg, rgba(230,160,34,.98), rgba(156,99,7,.98))!important;}\
.warhub-tabs{display:flex!important;gap:4px!important;padding:7px 8px!important;overflow-x:auto!important;scrollbar-width:none!important;background:rgba(255,255,255,.02)!important;}\
.warhub-tabs::-webkit-scrollbar{display:none!important;}\
.warhub-body{padding:12px!important;overflow:auto!important;flex:1 1 auto!important;}\
.warhub-card{background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.035))!important;border:1px solid rgba(255,255,255,.08)!important;border-radius:14px!important;padding:11px!important;margin-bottom:10px!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.03)!important;}\
.warhub-hero{background:linear-gradient(180deg,rgba(165,28,28,.24),rgba(255,255,255,.03))!important;border-color:rgba(255,255,255,.10)!important;}\
.warhub-command{background:linear-gradient(180deg,rgba(255,180,80,.10),rgba(255,255,255,.03))!important;border-color:rgba(255,188,96,.16)!important;}\
.warhub-danger{background:linear-gradient(180deg,rgba(220,72,72,.14),rgba(255,255,255,.03))!important;border-color:rgba(220,72,72,.18)!important;}\
.warhub-success{background:linear-gradient(180deg,rgba(60,180,100,.12),rgba(255,255,255,.03))!important;border-color:rgba(60,180,100,.18)!important;}\
.warhub-input,.warhub-select,.warhub-textarea{width:100%!important;padding:10px 11px!important;border-radius:10px!important;border:1px solid rgba(255,255,255,.12)!important;background:rgba(255,255,255,.07)!important;color:#fff!important;font-size:16px!important;}\
.warhub-textarea{min-height:110px!important;resize:vertical!important;}\
.warhub-pill{display:inline-flex!important;align-items:center!important;min-height:24px!important;padding:4px 8px!important;border-radius:999px!important;font-size:12px!important;font-weight:800!important;background:rgba(255,255,255,.08)!important;border:1px solid rgba(255,255,255,.08)!important;color:#fff!important;}\
.warhub-pill.good{background:rgba(36,140,82,.35)!important;}\
.warhub-pill.bad{background:rgba(170,32,32,.35)!important;}\
.warhub-pill.warn{background:rgba(190,128,26,.35)!important;}\
.warhub-pill.online{background:rgba(42,168,95,.35)!important;}\
.warhub-pill.idle{background:rgba(197,142,32,.35)!important;}\
.warhub-pill.travel{background:rgba(66,124,206,.35)!important;}\
.warhub-pill.jail{background:rgba(120,85,160,.35)!important;}\
.warhub-pill.hospital{background:rgba(199,70,70,.35)!important;}\
.warhub-pill.offline{background:rgba(105,105,105,.35)!important;}\
.warhub-grid2{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:8px!important;}\
.warhub-grid3{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:8px!important;}\
.warhub-stat{padding:11px!important;border-radius:13px!important;background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.035))!important;border:1px solid rgba(255,255,255,.08)!important;}\
.warhub-stat.command{background:linear-gradient(180deg,rgba(165,28,28,.18),rgba(255,255,255,.03))!important;}\
.warhub-stat-label{font-size:11px!important;opacity:.76!important;margin-bottom:5px!important;text-transform:uppercase!important;letter-spacing:.35px!important;}\
.warhub-stat-value{font-size:22px!important;line-height:1!important;font-weight:900!important;color:#fff!important;}\
.warhub-list{display:flex!important;flex-direction:column!important;gap:8px!important;}\
.warhub-item{padding:11px!important;border-radius:13px!important;background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.035))!important;border:1px solid rgba(255,255,255,.08)!important;}\
.warhub-item-head{display:flex!important;justify-content:space-between!important;align-items:center!important;gap:8px!important;flex-wrap:wrap!important;}\
.warhub-name{font-weight:800!important;color:#fff!important;text-decoration:none!important;}\
.warhub-meta{font-size:12px!important;opacity:.9!important;line-height:1.4!important;}\
.warhub-kv{display:grid!important;grid-template-columns:1fr auto!important;gap:8px!important;align-items:center!important;padding:8px 0!important;border-bottom:1px solid rgba(255,255,255,.05)!important;}\
.warhub-kv:last-child{border-bottom:0!important;}\
.warhub-empty{opacity:.72!important;}\
.warhub-sep{height:1px!important;background:rgba(255,255,255,.07)!important;margin:10px 0!important;}\
.warhub-board-title{font-size:13px!important;font-weight:900!important;color:#fff!important;margin-bottom:6px!important;letter-spacing:.2px!important;}\
.warhub-small{font-size:11px!important;opacity:.78!important;}\
.warhub-meter{margin-top:12px!important;height:12px!important;border-radius:999px!important;background:rgba(255,255,255,.08)!important;overflow:hidden!important;border:1px solid rgba(255,255,255,.06)!important;}\
.warhub-meter-fill{height:100%!important;background:linear-gradient(90deg,rgba(221,59,59,.98),rgba(255,170,90,.98))!important;}\
@media(max-width:520px){#warhub-shield{width:30px!important;height:30px!important;font-size:15px!important;border-radius:8px!important;right:6px!important;top:405px!important;left:auto!important;transform:none!important;}.warhub-grid2,.warhub-grid3{grid-template-columns:1fr!important;}}\
');

    function esc(v) {
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
    function arr(v) { return Array.isArray(v) ? v : []; }
    function fmtNum(v) {
        var n = Number(v);
        return Number.isFinite(n) ? n.toLocaleString() : '—';
    }
    function fmtTs(v) {
        if (!v) return '—';
        try { return new Date(v).toLocaleString(); } catch (_e) { return String(v); }
    }
    function getApiKey(){ return String(GM_getValue(K_API_KEY, '') || '').trim(); }
    function getOwnerToken(){ return String(GM_getValue(K_OWNER_TOKEN, '') || '').trim(); }
    function getSessionToken(){ return String(GM_getValue(K_SESSION, '') || '').trim(); }
    function isLoggedIn(){ return !!getSessionToken(); }
    function viewer(){ return (state && state.viewer) || {}; }
    function access(){ return (state && state.access) || {}; }
    function canManageFaction(){ return !!(access().can_manage_faction || access().is_faction_leader || access().is_admin); }
    function canSeeAdmin(){ return !!(access().is_admin || getOwnerToken()); }


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

    function applyShieldPos() {
        if (!shield) return;
        shield.style.left = 'auto';
        shield.style.right = '6px';
        shield.style.top = '405px';
        shield.style.bottom = 'auto';
        shield.style.transform = 'none';
    }


    
    
    function bindShieldTouchOpen(handle) {
        if (!handle || handle.__warhubShieldBound) return;
        handle.__warhubShieldBound = true;

        handle.addEventListener('touchstart', function (ev) {
            if (ev.cancelable) ev.preventDefault();
            ev.stopPropagation();
            setOverlayOpen(!isOpen);
        }, { passive: false });

        handle.addEventListener('contextmenu', function (ev) {
            ev.preventDefault();
        });
    }

    function req(method, path, body, extraHeaders) {
        return new Promise(function(resolve){
            var headers = Object.assign({'Content-Type':'application/json'}, extraHeaders || {});
            GM_xmlhttpRequest({
                method: method || 'GET',
                url: BASE_URL + path,
                headers: headers,
                data: body ? JSON.stringify(body) : undefined,
                timeout: 30000,
                onload: function(res){
                    var json = null;
                    try { json = JSON.parse(res.responseText || '{}'); } catch (_e) {}
                    resolve({ok: res.status >= 200 && res.status < 300, status: res.status, json: json});
                },
                onerror: function(){ resolve({ok:false,status:0,json:null}); },
                ontimeout: function(){ resolve({ok:false,status:0,json:null}); }
            });
        });
    }
    function authedReq(method, path, body, extraHeaders) {
        var headers = Object.assign({}, extraHeaders || {});
        if (getSessionToken()) headers['X-Session-Token'] = getSessionToken();
        return req(method, path, body, headers);
    }
    function adminReq(method, path, body) {
        var headers = {};
        if (getOwnerToken()) headers['X-License-Admin'] = getOwnerToken();
        return authedReq(method, path, body, headers);
    }

    function setStatus(msg, bad) {
        if (!statusBox) return;
        statusBox.innerHTML = msg ? ('<span class="warhub-pill ' + (bad ? 'bad' : 'good') + '">' + esc(msg) + '</span>') : '';
    }

    function bindPress(el, handler) {
        if (!el || el.__warhubPressBound) return;
        el.__warhubPressBound = true;

        el.addEventListener('touchstart', function (ev) {
            if (ev.cancelable) ev.preventDefault();
            ev.stopPropagation();
            handler(ev);
        }, { passive: false });
    }

    function delegatePress(root, selector, handler) {
        if (!root) return;
        root.addEventListener('touchstart', function (ev) {
            var target = ev.target && ev.target.closest ? ev.target.closest(selector) : null;
            if (!target || !root.contains(target)) return;
            if (ev.cancelable) ev.preventDefault();
            ev.stopPropagation();
            handler(ev, target);
        }, { passive: false });
    }

    function safeClosest(start, selector) {
        return start && start.closest ? start.closest(selector) : null;
    }

    function ensureMounted() {
        if (!document.body) return false;
        var hasShield = !!document.getElementById('warhub-shield');
        var hasOverlay = !!document.getElementById('warhub-overlay');
        if (!hasShield || !hasOverlay || !shield || !overlay) {
            shield = null;
            overlay = null;
            statusBox = null;
            mount();
        }
        return true;
    }

    function renderTabs() {
        function rowHtml(rows) {
            return rows.filter(function(pair){
                if (pair[0] === 'admin') return canSeeAdmin();
                if (pair[0] === 'faction') return canManageFaction();
                return true;
            }).map(function(pair){
                return '<button type="button" class="warhub-tab' + (currentTab === pair[0] ? ' active' : '') + '" data-tab="' + esc(pair[0]) + '">' + esc(pair[1]) + '</button>';
            }).join('');
        }
        overlay.querySelector('#warhub-tabs-1').innerHTML = rowHtml(TAB_ROW_1);
        overlay.querySelector('#warhub-tabs-2').innerHTML = rowHtml(TAB_ROW_2);
    }

    function mount() {
        shield = document.createElement('div');
        shield.id = 'warhub-shield';
        shield.textContent = '⚔️';
        overlay = document.createElement('div');
        overlay.id = 'warhub-overlay';
        overlay.innerHTML = [
            '<div class="warhub-head">',
                '<div class="warhub-top">',
                    '<div><div class="warhub-title">War Hub ⚔️</div><div class="warhub-sub">War control, chain flow, med deals, targets, faction tools, and admin in one place</div></div>',
                    '<button type="button" class="warhub-close" id="warhub-close">Close</button>',
                '</div>',
            '</div>',
            '<div class="warhub-tabs" id="warhub-tabs-1"></div>',
            '<div class="warhub-tabs" id="warhub-tabs-2"></div>',
            '<div class="warhub-body">',
                '<div id="warhub-status" style="margin-bottom:10px;"></div>',
                '<div id="warhub-content"></div>',
            '</div>'
        ].join('');
        document.body.appendChild(shield);
        document.body.appendChild(overlay);
        statusBox = overlay.querySelector('#warhub-status');
        applyShieldPos();
        bindShieldTouchOpen(shield);
        bindPress(overlay.querySelector('#warhub-close'), function(){ setOverlayOpen(false); });
        delegatePress(overlay, '[data-tab]', async function(_ev, target){
            currentTab = target.getAttribute('data-tab');
            GM_setValue(K_TAB, currentTab);
            await loadCurrentTab(true);
            renderBody();
            restartPolling();
        });
        delegatePress(overlay, '[data-action]', async function(ev){
            await handleClick(ev);
        });
        window.addEventListener('resize', applyShieldPos);
        setOverlayOpen(isOpen);
        applyShieldPos();
        renderTabs();
        renderBody();
    }

    async function loadState() {
        if (!isLoggedIn()) { state = null; return null; }
        var res = await authedReq('GET', '/api/state');
        if (!res.ok || !res.json) {
            if (res.status === 401 || res.status === 403) doLogout();
            return null;
        }
        state = res.json;
        return state;
    }

    async function loadCurrentTab(force) {
        if (!isLoggedIn()) return null;
        if (loading) return null;
        loading = true;
        try {
            if (!state) await loadState();
            if (currentTab === 'overview') {
                var ov = await authedReq('GET', '/api/overview/live');
                if (ov.ok && ov.json) tabData.overview = ov.json.overview || null;
            } else if (currentTab === 'enemies') {
                var en = await authedReq('GET', '/api/enemies');
                if (en.ok && en.json) tabData.enemies = en.json;
            } else if (currentTab === 'hospital') {
                var hs = await authedReq('GET', '/api/hospital');
                if (hs.ok && hs.json) tabData.hospital = hs.json;
            } else if (currentTab === 'targets') {
                var tg = await authedReq('GET', '/api/targets');
                if (tg.ok && tg.json) tabData.targets = tg.json;
                var en2 = await authedReq('GET', '/api/enemies');
                if (en2.ok && en2.json) tabData.enemies = en2.json;
            } else if (currentTab === 'summary') {
                var sm = await authedReq('GET', '/api/live-summary');
                if (sm.ok && sm.json) tabData.summary = sm.json;
            } else if (currentTab === 'faction') {
                var fm = await authedReq('GET', '/api/faction/members');
                if (fm.ok && fm.json) tabData.faction = fm.json;
            } else if (currentTab === 'admin') {
                var ad = await adminReq('GET', '/api/admin/dashboard');
                if (ad.ok && ad.json) tabData.admin = ad.json;
            } else if (currentTab === 'chain') {
                await loadState();
            } else if (currentTab === 'meddeals') {
                var md = await authedReq('GET', '/api/meddeals');
                if (md.ok && md.json) state.med_deals = md.json;
                var en3 = await authedReq('GET', '/api/enemies');
                if (en3.ok && en3.json) tabData.enemies = en3.json;
            } else if (currentTab === 'terms') {
                var tr = await authedReq('GET', '/api/terms-summary');
                if (tr.ok && tr.json) state.terms_summary = tr.json.item || {};
            } else if (currentTab === 'settings' || currentTab === 'instructions') {
                await loadState();
            }
        } finally {
            loading = false;
        }
    }

    function restartPolling() {
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = null;
        if (!isOpen || !isLoggedIn()) return;
        if (['overview','enemies','hospital','chain','summary'].indexOf(currentTab) === -1) return;
        var ms = {overview:12000,enemies:7000,hospital:6000,chain:10000}[currentTab] || 12000;
        pollTimer = setInterval(async function(){
            await loadCurrentTab(true);
            renderBody();
        }, ms);
    }

    function memberName(m){ return String((m && (m.name || m.target_name || m.enemy_name)) || 'Unknown'); }
    function memberId(m){ return String((m && (m.user_id || m.target_user_id || m.enemy_user_id || m.id || m.player_id)) || ''); }
    function profileUrl(id){ return id ? ('https://www.torn.com/profiles.php?XID=' + encodeURIComponent(id)) : '#'; }
    function attackUrl(id){ return id ? ('https://www.torn.com/loader.php?sid=attack&user2ID=' + encodeURIComponent(id)) : '#'; }
    function bountyUrl(id){ return id ? ('https://www.torn.com/bounties.php?p=add&userID=' + encodeURIComponent(id)) : '#'; }

    function renderLogin() {
        return [
            '<div class="warhub-card">',
                '<div class="warhub-title">Login</div>',
                '<div class="warhub-sub">Use your Torn API key to connect to War Hub.</div>',
            '</div>',
            '<div class="warhub-card">',
                '<div class="warhub-row"><input id="warhub-api-key" class="warhub-input" type="password" value="' + esc(getApiKey()) + '" placeholder="Enter API key" /></div>',
                '<div class="warhub-row" style="margin-top:8px;"><input id="warhub-owner-token" class="warhub-input" type="password" value="' + esc(getOwnerToken()) + '" placeholder="Owner/admin token (optional)" /></div>',
                '<div class="warhub-row" style="margin-top:10px;"><button type="button" class="warhub-btn primary" data-action="login">Login</button></div>',
            '</div>'
        ].join('');
    }

    function renderOverview() {
        var ov = tabData.overview || {};
        var terms = (state && state.terms_summary && state.terms_summary.text) || '';
        var med = (state && state.med_deals && state.med_deals.text) || '';
        return [
            '<div class="warhub-card"><div class="warhub-title">Overview</div><div class="warhub-sub">War summary only from /api/overview/live</div></div>',
            '<div class="warhub-grid2">',
                '<div class="warhub-stat"><div class="warhub-stat-label">Our Faction</div><div class="warhub-stat-value">' + esc(ov.our_faction_name || (state && state.faction && state.faction.faction_name) || 'Your Faction') + '</div></div>',
                '<div class="warhub-stat"><div class="warhub-stat-label">Enemy Faction</div><div class="warhub-stat-value">' + esc(ov.enemy_faction_name || '—') + '</div></div>',
                '<div class="warhub-stat"><div class="warhub-stat-label">Our Score</div><div class="warhub-stat-value">' + esc(fmtNum(ov.score_us || 0)) + '</div></div>',
                '<div class="warhub-stat"><div class="warhub-stat-label">Enemy Score</div><div class="warhub-stat-value">' + esc(fmtNum(ov.score_them || 0)) + '</div></div>',
                '<div class="warhub-stat"><div class="warhub-stat-label">Our Chain</div><div class="warhub-stat-value">' + esc(fmtNum(ov.chain_us || 0)) + '</div></div>',
                '<div class="warhub-stat"><div class="warhub-stat-label">Enemy Chain</div><div class="warhub-stat-value">' + esc(fmtNum(ov.chain_them || 0)) + '</div></div>',
            '</div>',
            '<div class="warhub-card"><div class="warhub-title">Terms</div><div class="warhub-meta">' + esc(terms || 'No terms added yet.') + '</div></div>',
            '<div class="warhub-card"><div class="warhub-title">Med Deals</div><div class="warhub-meta">' + esc(med || 'No med deals posted yet.') + '</div></div>'
        ].join('');
    }

    function renderEnemyList(payload, hospitalMode) {
        payload = payload || {};
        var items = arr(payload.items);
        if (hospitalMode) items = items.filter(function(m){ return String(m.online_state || '').toLowerCase() === 'hospital' || m.in_hospital; });
        if (!items.length) return '<div class="warhub-card"><div class="warhub-empty">No ' + (hospitalMode ? 'hospital enemies' : 'enemies') + ' right now.</div></div>';
        return [
            '<div class="warhub-card">',
                '<div class="warhub-title">' + esc((payload.faction_name || (payload.war || {}).enemy_faction_name || 'Enemy Faction')) + '</div>',
                '<div class="warhub-sub">' + esc(hospitalMode ? 'Hospital data only from /api/hospital' : 'Enemy data only from /api/enemies') + '</div>',
            '</div>',
            '<div class="warhub-list">',
                items.map(function(m){
                    var id = memberId(m);
                    var stateName = String(m.online_state || '').toLowerCase() || 'offline';
                    return [
                        '<div class="warhub-item">',
                            '<div class="warhub-item-head">',
                                '<div class="warhub-row">',
                                    '<a class="warhub-name" href="' + esc(profileUrl(id)) + '" target="_blank" rel="noopener noreferrer">' + esc(memberName(m)) + '</a>',
                                    '<span class="warhub-pill ' + esc(stateName) + '">' + esc(stateName || 'offline') + '</span>',
                                    (m.predicted_total_stats_m ? '<span class="warhub-pill">' + esc(String(m.predicted_total_stats_m) + 'm') + '</span>' : ''),
                                '</div>',
                                '<div class="warhub-row">',
                                    '<a class="warhub-btn primary" href="' + esc(attackUrl(id)) + '" target="_blank" rel="noopener noreferrer">Attack</a>',
                                    '<a class="warhub-btn gray" href="' + esc(bountyUrl(id)) + '" target="_blank" rel="noopener noreferrer">Bounty</a>',
                                    (hospitalMode ? '<button type="button" class="warhub-btn warn" data-action="dibs" data-user-id="' + esc(id) + '">Dibs</button>' : ''),
                                '</div>',
                            '</div>',
                            '<div class="warhub-meta" style="margin-top:8px;">' + esc(m.prediction_summary || m.status_detail || m.status || '') + '</div>',
                            (m.dibbed_by_name ? '<div class="warhub-meta" style="margin-top:6px;">Dibbed by ' + esc(m.dibbed_by_name) + '</div>' : ''),
                        '</div>'
                    ].join('');
                }).join(''),
            '</div>'
        ].join('');
    }

    function renderChain() {
        var chain = (state && state.chain) || {};
        var available = arr(chain.available_items).slice().sort(function(a,b){ return String(a.user_name || a.user_id || '').localeCompare(String(b.user_name || b.user_id || '')); });
        var sitters = arr(chain.sitter_items).slice().sort(function(a,b){ return String(a.user_name || a.user_id || '').localeCompare(String(b.user_name || b.user_id || '')); });
        var current = Number(chain.current || 0);
        var cooldown = Number(chain.cooldown || 0);
        var meterPct = Math.max(4, Math.min(100, current > 0 ? Math.round((current % 100) || 100) : 4));
        var availableState = chain.available ? 'Ready for chain' : 'Not marked ready';
        var sitterState = chain.sitter_enabled ? 'Sitter armed' : 'Sitter off';

        function personRow(r, mode) {
            var name = String(r.user_name || r.user_id || 'Member');
            return [
                '<div class="warhub-item">',
                    '<div class="warhub-item-head">',
                        '<div class="warhub-row"><div class="warhub-name">' + esc(name) + '</div></div>',
                        '<div class="warhub-row">' + (mode === 'sitter' ? '<span class="warhub-pill warn">Chain Sitter</span>' : '<span class="warhub-pill good">Available</span>') + '</div>',
                    '</div>',
                    '<div class="warhub-meta" style="margin-top:8px;">' + esc(mode === 'sitter' ? 'Watching the rack and ready to sit missed hits or pressure moments.' : 'Marked ready to hit and keep the chain moving when called.') + '</div>',
                '</div>'
            ].join('');
        }

        return [
            '<div class="warhub-card warhub-hero"><div class="warhub-title">Chain Command</div><div class="warhub-sub">Run the rack harder, see your live chain posture fast, and keep hitters and sitters organized like a war board.</div></div>',
            '<div class="warhub-grid2">',
                '<div class="warhub-stat command"><div class="warhub-stat-label">Current Chain</div><div class="warhub-stat-value">' + esc(fmtNum(current)) + '</div></div>',
                '<div class="warhub-stat"><div class="warhub-stat-label">Cooldown</div><div class="warhub-stat-value">' + esc(fmtNum(cooldown)) + '</div></div>',
                '<div class="warhub-stat"><div class="warhub-stat-label">Available Hitters</div><div class="warhub-stat-value">' + esc(fmtNum(available.length)) + '</div></div>',
                '<div class="warhub-stat"><div class="warhub-stat-label">Chain Sitters</div><div class="warhub-stat-value">' + esc(fmtNum(sitters.length)) + '</div></div>',
            '</div>',
            '<div class="warhub-card warhub-command">',
                '<div class="warhub-board-title">Rack control</div>',
                '<div class="warhub-meta">Use these controls to tell the faction if you are in the chain pool or sitting the chain. The goal is to keep misses lower and response faster.</div>',
                '<div class="warhub-row" style="margin-top:10px;">',
                    '<span class="warhub-pill ' + (chain.available ? 'good' : 'offline') + '">' + esc(availableState) + '</span>',
                    '<span class="warhub-pill ' + (chain.sitter_enabled ? 'warn' : 'offline') + '">' + esc(sitterState) + '</span>',
                '</div>',
                '<div class="warhub-row" style="margin-top:10px;"><button type="button" class="warhub-btn green" data-action="chain-available">Mark available</button><button type="button" class="warhub-btn gray" data-action="chain-unavailable">Mark unavailable</button><button type="button" class="warhub-btn warn" data-action="chain-sitter">Toggle sitter</button></div>',
                '<div class="warhub-meter"><div class="warhub-meter-fill" style="width:' + esc(String(meterPct)) + '%;"></div></div>',
                '<div class="warhub-small" style="margin-top:8px;">Meter gives a quick visual feel for rack pressure and current chain momentum.</div>',
            '</div>',
            '<div class="warhub-card"><div class="warhub-title">Available Hitters</div><div class="warhub-sub">Members who marked themselves ready to hit when the chain needs pressure.</div></div>',
            '<div class="warhub-list">' + (available.map(function(r){ return personRow(r, 'available'); }).join('') || '<div class="warhub-card"><div class="warhub-empty">No members marked available.</div></div>') + '</div>',
            '<div class="warhub-card"><div class="warhub-title">Chain Sitters</div><div class="warhub-sub">Members covering misses, downtime, or thin pressure windows.</div></div>',
            '<div class="warhub-list">' + (sitters.map(function(r){ return personRow(r, 'sitter'); }).join('') || '<div class="warhub-card"><div class="warhub-empty">No chain sitters enabled.</div></div>') + '</div>'
        ].join('');
    }

    function renderTargets() {
        var targets = (tabData.targets && tabData.targets.items) || [];
        var enemies = (tabData.enemies && tabData.enemies.items) || [];
        return [
            '<div class="warhub-card warhub-hero"><div class="warhub-title">Target Board</div><div class="warhub-sub">Build a personal war board from the live enemy roster, track your picks, and keep quick notes for pressure, travel, chain filler, or revenge windows.</div></div>',
            '<div class="warhub-grid2">',
                '<div class="warhub-stat"><div class="warhub-stat-label">Saved Targets</div><div class="warhub-stat-value">' + esc(fmtNum(targets.length)) + '</div></div>',
                '<div class="warhub-stat"><div class="warhub-stat-label">Enemy Pool</div><div class="warhub-stat-value">' + esc(fmtNum(enemies.length)) + '</div></div>',
            '</div>',
            '<div class="warhub-card warhub-command">',
                '<div class="warhub-title">Add target</div>',
                '<div class="warhub-sub">Pull from current war enemies only so your saved board stays tied to the live war pool.</div>',
                '<div class="warhub-row" style="margin-top:8px;"><select id="warhub-target-select" class="warhub-select"><option value="">Select enemy member</option>' + enemies.map(function(m){ return '<option value="' + esc(memberId(m)) + '">' + esc(memberName(m)) + '</option>'; }).join('') + '</select></div>',
                '<div class="warhub-row" style="margin-top:8px;"><textarea id="warhub-target-note" class="warhub-textarea" placeholder="Examples: weak timing, chain filler, watch travel, bounty target, revenge, leave for med deal"></textarea></div>',
                '<div class="warhub-row" style="margin-top:10px;"><button type="button" class="warhub-btn green" data-action="target-save">Save target</button></div>',
            '</div>',
            '<div class="warhub-card"><div class="warhub-title">Saved target board</div><div class="warhub-sub">Quick launch list for your live war picks.</div></div>',
            '<div class="warhub-list">' + (targets.map(function(t){ var id = memberId(t); return '<div class="warhub-item"><div class="warhub-item-head"><div class="warhub-row"><a class="warhub-name" href="' + esc(profileUrl(id)) + '" target="_blank" rel="noopener noreferrer">' + esc(memberName(t)) + '</a><span class="warhub-pill">#' + esc(id) + '</span></div><div class="warhub-row"><a class="warhub-btn primary" href="' + esc(attackUrl(id)) + '" target="_blank" rel="noopener noreferrer">Attack</a><a class="warhub-btn gray" href="' + esc(bountyUrl(id)) + '" target="_blank" rel="noopener noreferrer">Bounty</a><button type="button" class="warhub-btn gray" data-action="target-delete" data-user-id="' + esc(id) + '">Delete</button></div></div>' + (t.note ? '<div class="warhub-meta" style="margin-top:8px;">' + esc(t.note) + '</div>' : '<div class="warhub-meta" style="margin-top:8px;">No note saved yet.</div>') + '</div>'; }).join('')) + (targets.length ? '' : '<div class="warhub-card"><div class="warhub-empty">No saved targets yet.</div></div>') + '</div>'
        ].join('');
    }

    function renderMedDeals() {
        var deals = (state && state.med_deals && state.med_deals.items) || [];
        var enemies = (tabData.enemies && tabData.enemies.items) || [];
        return [
            '<div class="warhub-card warhub-hero"><div class="warhub-title">Med Deals Board</div><div class="warhub-sub">Post your med claim cleanly, avoid overlap, and give the faction one quick place to see who is assigned to who.</div></div>',
            '<div class="warhub-grid2">',
                '<div class="warhub-stat"><div class="warhub-stat-label">Posted Deals</div><div class="warhub-stat-value">' + esc(fmtNum(deals.length)) + '</div></div>',
                '<div class="warhub-stat"><div class="warhub-stat-label">Enemy Pool</div><div class="warhub-stat-value">' + esc(fmtNum(enemies.length)) + '</div></div>',
            '</div>',
            '<div class="warhub-card warhub-command">',
                '<div class="warhub-title">Post your med target</div>',
                '<div class="warhub-sub">Choose from the current live enemy roster. Saving here updates the shared deal board used by your faction.</div>',
                '<div class="warhub-row" style="margin-top:8px;"><select id="warhub-med-enemy" class="warhub-select"><option value="">Select enemy member</option>' + enemies.map(function(m){ return '<option value="' + esc(memberId(m)) + '">' + esc(memberName(m)) + '</option>'; }).join('') + '</select></div>',
                '<div class="warhub-row" style="margin-top:10px;"><button type="button" class="warhub-btn green" data-action="med-save">Save deal</button><button type="button" class="warhub-btn gray" data-action="med-clear">Clear mine</button></div>',
            '</div>',
            '<div class="warhub-card"><div class="warhub-title">Live faction assignments</div><div class="warhub-sub">Use this board to reduce overlap and keep med calls organized during chain and war pressure.</div></div>',
            '<div class="warhub-list">' + (deals.map(function(d){ return '<div class="warhub-item"><div class="warhub-item-head"><div class="warhub-row"><div class="warhub-name">' + esc(String(d.user_name || d.user_id || 'Member')) + '</div><span class="warhub-pill warn">Med deal</span></div><div class="warhub-row"><span class="warhub-pill">' + esc(String(d.enemy_name || d.enemy_user_id || 'Enemy')) + '</span></div></div><div class="warhub-meta" style="margin-top:8px;">' + esc(String(d.user_name || d.user_id || 'Member') + ' is assigned to ' + String(d.enemy_name || d.enemy_user_id || 'Enemy')) + '</div></div>'; }).join('')) + (deals.length ? '' : '<div class="warhub-card"><div class="warhub-empty">No med deals posted yet.</div></div>') + '</div>'
        ].join('');
    }

    function renderTerms() {
        var txt = (state && state.terms_summary && state.terms_summary.text) || '';
        return [
            '<div class="warhub-card"><div class="warhub-title">Terms</div><div class="warhub-sub">Leader shared faction terms only from /api/terms-summary</div></div>',
            '<div class="warhub-card">',
                '<textarea id="warhub-terms-text" class="warhub-textarea" placeholder="Write terms or summary here...">' + esc(txt) + '</textarea>',
                '<div class="warhub-row" style="margin-top:10px;"><button type="button" class="warhub-btn primary" data-action="terms-save">Save</button><button type="button" class="warhub-btn gray" data-action="terms-clear">Delete</button></div>',
            '</div>'
        ].join('');
    }

    function renderFaction() {
        var payload = tabData.faction || {};
        var members = arr(payload.items);
        return [
            '<div class="warhub-card"><div class="warhub-title">Faction</div><div class="warhub-sub">Faction members only from /api/faction/members</div></div>',
            '<div class="warhub-list">' + (members.map(function(m){ var id = memberId(m); var enabled = !!m.enabled; return '<div class="warhub-item"><div class="warhub-item-head"><div class="warhub-row"><span class="warhub-name">' + esc(memberName(m)) + '</span><span class="warhub-pill ' + (enabled ? 'good' : 'bad') + '">' + (enabled ? 'Activated' : 'Inactive') + '</span></div><div class="warhub-row">' + (enabled ? '<button type="button" class="warhub-btn gray" disabled>Activated</button>' : '<button type="button" class="warhub-btn green" data-action="member-activate" data-user-id="' + esc(id) + '">Activate</button>') + '<button type="button" class="warhub-btn gray" data-action="member-remove" data-user-id="' + esc(id) + '">Remove</button></div></div></div>'; }).join('')) + (members.length ? '' : '<div class="warhub-card"><div class="warhub-empty">No faction members found.</div></div>') + '</div>'
        ].join('');
    }



    function renderSummary() {
        var s = tabData.summary || {};
        var cards = arr(s.cards);
        var top = s.top || {};
        var rows = arr(s.rows);
        var alerts = s.alerts || {};
        function badge(cls, txt){ return '<span class="warhub-pill ' + esc(cls || 'neutral') + '">' + esc(String(txt || '—')) + '</span>'; }
        function cardHtml(c){ return '<div class="warhub-card"><div class="warhub-sub">' + esc(String(c.label || 'Metric')) + '</div><div class="warhub-title">' + esc(String(c.value == null ? '—' : c.value)) + '</div></div>'; }
        function listBox(title, items){
            items = arr(items).slice(0,5);
            return '<div class="warhub-card warhub-col"><h3>' + esc(title) + '</h3>' + (items.length ? items.map(function(it){ return '<div class="warhub-kv"><div>' + esc(String(it.name || 'Player')) + '</div><div>' + badge('neutral', it.metric_value != null ? it.metric_value : (it.value != null ? it.value : (it.net_impact != null ? it.net_impact : '—'))) + '</div></div>'; }).join('') : '<div class="warhub-sub">No data yet.</div>') + '</div>';
        }
        return [
            '<div class="warhub-grid">',
                '<div class="warhub-hero-card"><div class="warhub-title">Summary</div><div class="warhub-sub">Leader war snapshot</div></div>',
                cards.length ? '<div class="warhub-mini-grid">' + cards.map(cardHtml).join('') + '</div>' : '<div class="warhub-card">No live summary yet.</div>',
                '<div class="warhub-card warhub-col">',
                    '<h3>Top</h3>',
                    '<div class="warhub-kv"><div>Top Hitter</div><div>' + esc(String(top.top_hitter || '—')) + '</div></div>',
                    '<div class="warhub-kv"><div>Top Respect Gain</div><div>' + esc(String(top.top_respect_gain || '—')) + '</div></div>',
                    '<div class="warhub-kv"><div>Top Respect Lost</div><div>' + esc(String(top.top_respect_lost || '—')) + '</div></div>',
                    '<div class="warhub-kv"><div>Top Hits Taken</div><div>' + esc(String(top.top_hits_taken || '—')) + '</div></div>',
                    '<div class="warhub-kv"><div>Best Efficiency</div><div>' + esc(String(top.best_efficiency || '—')) + '</div></div>',
                '</div>',
                listBox('No Shows', alerts.no_shows),
                listBox('Bleeding', alerts.bleeding),
                listBox('Under Fire', alerts.under_fire),
                '<div class="warhub-card warhub-col"><h3>Member Rows</h3>' + (rows.length ? rows.slice(0,15).map(function(r){ return '<div class="warhub-kv"><div>' + esc(String(r.name || 'Player')) + '</div><div>' + badge((r.net_impact || 0) >= 0 ? 'good' : 'bad', 'Net ' + String(r.net_impact == null ? 0 : r.net_impact)) + '</div></div>'; }).join('') : '<div class="warhub-sub">No rows yet.</div>') + '</div>',
            '</div>'
        ].join('');
    }

    function renderSettings() {
        var v = viewer();
        var stats = v.battle_stats || {};
        return [
            '<div class="warhub-card"><div class="warhub-title">Settings</div><div class="warhub-sub">Account and local script settings</div></div>',
            '<div class="warhub-card"><div class="warhub-kv"><div>User</div><div>' + esc(v.name || 'Logged out') + '</div></div><div class="warhub-kv"><div>User ID</div><div>' + esc(v.user_id || '—') + '</div></div><div class="warhub-kv"><div>Faction</div><div>' + esc(v.faction_name || '—') + '</div></div></div>',
            '<div class="warhub-card"><div class="warhub-title">Battle Stats</div><div class="warhub-kv"><div>Total</div><div>' + esc(fmtNum(v.battle_stats_total || 0)) + '</div></div><div class="warhub-kv"><div>Total (M)</div><div>' + esc(String(v.battle_stats_total_m || 0)) + '</div></div><div class="warhub-kv"><div>Strength</div><div>' + esc(fmtNum(stats.strength || 0)) + '</div></div><div class="warhub-kv"><div>Speed</div><div>' + esc(fmtNum(stats.speed || 0)) + '</div></div><div class="warhub-kv"><div>Defense</div><div>' + esc(fmtNum(stats.defense || 0)) + '</div></div><div class="warhub-kv"><div>Dexterity</div><div>' + esc(fmtNum(stats.dexterity || 0)) + '</div></div></div>',
            '<div class="warhub-card"><div class="warhub-row"><button type="button" class="warhub-btn primary" data-action="login">Re-login</button><button type="button" class="warhub-btn gray" data-action="logout">Logout</button></div></div>'
        ].join('');
    }

    function renderInstructions() {
        return [
            '<div class="warhub-card warhub-hero"><div class="warhub-title">War Hub ⚔️</div><div class="warhub-sub">Turn your faction into a cleaner war machine: faster target choices, tighter med calls, sharper chain coordination, and one command board for the whole push.</div></div>',
            '<div class="warhub-card warhub-command"><div class="warhub-title">Why War Hub hits harder</div><div class="warhub-kv"><div>War speed</div><div>Enemies, hospital, targets, chain, terms, and med deals stay in one overlay</div></div><div class="warhub-kv"><div>Cleaner chaining</div><div>Available hitters and sitters are easier to read during rack pressure</div></div><div class="warhub-kv"><div>Less overlap</div><div>Shared med deals and target notes reduce wasted hits and crossed calls</div></div><div class="warhub-kv"><div>Leader visibility</div><div>Faction control, summary, access, and admin tools stay inside the same hub</div></div></div>',
            '<div class="warhub-card"><div class="warhub-title">How to start</div><div>1. Open Settings or stay here in Help and log in with your Torn API key.</div><div>2. Once logged in, War Hub loads your viewer, faction, access, and war state.</div><div>3. Use Enemies for enemy-only war targets, Hospital for hospital-only enemy tracking, and Faction for your faction member control.</div><div>4. Use Targets to save personal picks, Med Deals to share assignments, and Chain to mark yourself available or as a sitter.</div><div>5. Leaders use Faction and Summary. Owner/admin uses the Admin tab.</div></div>',
            '<div class="warhub-card"><div class="warhub-title">Terms of service</div><div>War Hub is a faction coordination overlay and should be used in line with Torn rules and your faction leadership rules.</div><div>Only use your own API key and only enter it into tools you trust.</div><div>Do not use War Hub to impersonate others, automate forbidden actions, interfere with Torn services, or bypass Torn restrictions.</div><div>Leader and admin tabs should stay with the people meant to control access, payment, and faction settings.</div></div>',
            '<div class="warhub-card"><div class="warhub-title">API key storage and Torn-safe use</div><div>Your API key is stored locally in your userscript storage on your own device/browser so the script can log you in faster.</div><div>When you log in, the key is sent to your War Hub backend to authenticate you and pull your allowed faction and war data.</div><div>After login, the script mainly works through the saved session token and route-based API calls.</div><div>Keep your key private, rotate it if you think it was exposed, and only enable the access level your War Hub functions really need under Torn rules.</div><div>Logging out clears the session token from the script side, but your locally stored key remains until you change or remove it.</div></div>',
            '<div class="warhub-card warhub-success"><div class="warhub-title">Route split now in place</div><div>Faction member data loads only from faction member routes.</div><div>Enemy war data loads only from enemy routes.</div><div>Hospital loads only from the hospital route.</div><div>Overview stays on overview/war data.</div><div>This keeps tabs cleaner and stops faction and enemy data from crossing over.</div></div>'
        ].join('');
    }

    function renderAdmin() {
        var ad = tabData.admin || {};
        var licenses = arr(ad.faction_licenses || ad.licenses);
        return [
            '<div class="warhub-card warhub-hero"><div class="warhub-title">Admin Command</div><div class="warhub-sub">Control exemptions, review faction licenses, and keep the wider War Hub network clean, organized, and paid up.</div></div>',
            '<div class="warhub-grid2"><div class="warhub-stat"><div class="warhub-stat-label">Factions</div><div class="warhub-stat-value">' + esc(fmtNum(ad.total_factions || 0)) + '</div></div><div class="warhub-stat"><div class="warhub-stat-label">Active Licenses</div><div class="warhub-stat-value">' + esc(fmtNum(ad.active_licenses || 0)) + '</div></div><div class="warhub-stat"><div class="warhub-stat-label">Users Using Script</div><div class="warhub-stat-value">' + esc(fmtNum(ad.users_using_script || 0)) + '</div></div><div class="warhub-stat"><div class="warhub-stat-label">User Exemptions</div><div class="warhub-stat-value">' + esc(fmtNum(ad.user_exemptions || 0)) + '</div></div></div>',
            '<div class="warhub-card warhub-command"><div class="warhub-title">Faction exemption control</div><div class="warhub-sub">Grant or remove full faction exemption from payment and renewal checks.</div><div class="warhub-row" style="margin-top:8px;"><input id="admin-faction-id" class="warhub-input" type="text" placeholder="Faction ID" /></div><div class="warhub-row" style="margin-top:8px;"><input id="admin-faction-name" class="warhub-input" type="text" placeholder="Faction name (optional)" /></div><div class="warhub-row" style="margin-top:8px;"><textarea id="admin-faction-note" class="warhub-textarea" placeholder="Reason"></textarea></div><div class="warhub-row" style="margin-top:10px;"><button type="button" class="warhub-btn green" data-action="admin-faction-save">Save</button><button type="button" class="warhub-btn gray" data-action="admin-faction-delete">Delete</button></div></div>',
            '<div class="warhub-card"><div class="warhub-title">Player exemption control</div><div class="warhub-sub">Grant or remove individual player exemption while leaving faction rules intact.</div><div class="warhub-row" style="margin-top:8px;"><input id="admin-user-id" class="warhub-input" type="text" placeholder="Player ID" /></div><div class="warhub-row" style="margin-top:8px;"><input id="admin-user-name" class="warhub-input" type="text" placeholder="Player name (optional)" /></div><div class="warhub-row" style="margin-top:8px;"><input id="admin-user-faction-id" class="warhub-input" type="text" placeholder="Faction ID (optional)" /></div><div class="warhub-row" style="margin-top:8px;"><input id="admin-user-faction-name" class="warhub-input" type="text" placeholder="Faction name (optional)" /></div><div class="warhub-row" style="margin-top:8px;"><textarea id="admin-user-note" class="warhub-textarea" placeholder="Reason"></textarea></div><div class="warhub-row" style="margin-top:10px;"><button type="button" class="warhub-btn green" data-action="admin-user-save">Save</button><button type="button" class="warhub-btn gray" data-action="admin-user-delete">Delete</button></div></div>',
            '<div class="warhub-card"><div class="warhub-title">Faction license watch</div><div class="warhub-sub">Quick scan of enabled members and billing footprint by faction.</div>' + (licenses.map(function(r){ return '<div class="warhub-item"><div class="warhub-item-head"><div class="warhub-row"><div class="warhub-name">' + esc((r.faction_name || 'Faction') + ' #' + (r.faction_id || '')) + '</div></div><div class="warhub-row"><span class="warhub-pill good">' + esc(fmtNum(r.enabled_member_count || 0)) + ' enabled</span></div></div><div class="warhub-meta" style="margin-top:8px;">Billing watch card for this faction license row.</div></div>'; }).join('') || '<div class="warhub-empty">No faction license rows.</div>') + '</div>'
        ].join('');
    }

    function renderBody() {
        renderTabs();
        var content = overlay.querySelector('#warhub-content');
        if (!isLoggedIn()) {
            content.innerHTML = renderLogin();
            return;
        }
        if (currentTab === 'overview') content.innerHTML = renderOverview();
        else if (currentTab === 'enemies') content.innerHTML = renderEnemyList(tabData.enemies, false);
        else if (currentTab === 'hospital') content.innerHTML = renderEnemyList(tabData.hospital, true);
        else if (currentTab === 'chain') content.innerHTML = renderChain();
        else if (currentTab === 'targets') content.innerHTML = renderTargets();
        else if (currentTab === 'meddeals') content.innerHTML = renderMedDeals();
        else if (currentTab === 'terms') content.innerHTML = renderTerms();
        else if (currentTab === 'summary') content.innerHTML = renderSummary();
        else if (currentTab === 'faction') content.innerHTML = renderFaction();
        else if (currentTab === 'settings') content.innerHTML = renderSettings();
        else if (currentTab === 'instructions') content.innerHTML = renderInstructions();
        else if (currentTab === 'admin') content.innerHTML = renderAdmin();
        else content.innerHTML = renderOverview();
    }

    async function handleClick(e) {
        var actionEl = e.target.closest('[data-action]');
        if (!actionEl) return;
        var action = actionEl.getAttribute('data-action');
        try {
            if (action === 'login') return doLogin();
            if (action === 'logout') return doLogout();
            if (action === 'chain-available') {
                var a1 = await authedReq('POST','/api/chain',{available:true});
                if (!a1.ok) return setStatus((a1.json && a1.json.error) || 'Failed to update chain.', true);
                await loadState(); renderBody(); return setStatus('Chain marked available.', false);
            }
            if (action === 'chain-unavailable') {
                var a2 = await authedReq('POST','/api/chain',{available:false});
                if (!a2.ok) return setStatus((a2.json && a2.json.error) || 'Failed to update chain.', true);
                await loadState(); renderBody(); return setStatus('Chain marked unavailable.', false);
            }
            if (action === 'chain-sitter') {
                var cur = !!((state && state.chain && state.chain.sitter_enabled));
                var a3 = await authedReq('POST','/api/chain/sitter',{enabled:!cur});
                if (!a3.ok) return setStatus((a3.json && a3.json.error) || 'Failed to update chain sitter.', true);
                await loadState(); renderBody(); return setStatus('Chain sitter updated.', false);
            }
            if (action === 'target-save') {
                var sel = overlay.querySelector('#warhub-target-select');
                var note = overlay.querySelector('#warhub-target-note');
                var userId = String((sel || {}).value || '').trim();
                var enemy = arr((tabData.enemies && tabData.enemies.items) || []).find(function(m){ return memberId(m) === userId; });
                if (!userId || !enemy) return setStatus('Select an enemy target first.', true);
                var r1 = await authedReq('POST','/api/targets',{user_id:userId,name:memberName(enemy),note:String((note || {}).value || '').trim()});
                if (!r1.ok) return setStatus((r1.json && r1.json.error) || 'Failed to save target.', true);
                await loadCurrentTab(true); renderBody(); return setStatus('Target saved.', false);
            }
            if (action === 'target-delete') {
                var tid = String(actionEl.getAttribute('data-user-id') || '').trim();
                if (!tid) return;
                var r2 = await authedReq('DELETE','/api/targets/' + encodeURIComponent(tid),null);
                if (!r2.ok) r2 = await authedReq('POST','/api/targets/' + encodeURIComponent(tid),{});
                if (!r2.ok) return setStatus((r2.json && r2.json.error) || 'Failed to delete target.', true);
                await loadCurrentTab(true); renderBody(); return setStatus('Target deleted.', false);
            }
            if (action === 'med-save') {
                var msel = overlay.querySelector('#warhub-med-enemy');
                var muid = String((msel || {}).value || '').trim();
                var menemy = arr((tabData.enemies && tabData.enemies.items) || []).find(function(m){ return memberId(m) === muid; });
                if (!muid || !menemy) return setStatus('Select an enemy player first.', true);
                var r3 = await authedReq('POST','/api/meddeals',{user_id:viewer().user_id,user_name:viewer().name,enemy_user_id:muid,enemy_name:memberName(menemy)});
                if (!r3.ok) return setStatus((r3.json && r3.json.error) || 'Failed to save med deal.', true);
                await loadState(); await loadCurrentTab(true); renderBody(); return setStatus('Med deal saved.', false);
            }
            if (action === 'med-clear') {
                var r4 = await authedReq('POST','/api/meddeals',{user_id:viewer().user_id,user_name:viewer().name,enemy_user_id:'',enemy_name:''});
                if (!r4.ok) return setStatus((r4.json && r4.json.error) || 'Failed to clear med deal.', true);
                await loadState(); await loadCurrentTab(true); renderBody(); return setStatus('Med deal cleared.', false);
            }
            if (action === 'terms-save') {
                var txt = String((overlay.querySelector('#warhub-terms-text') || {}).value || '');
                var r5 = await authedReq('POST','/api/terms-summary',{text:txt});
                if (!r5.ok) return setStatus((r5.json && r5.json.error) || 'Failed to save terms.', true);
                await loadState(); renderBody(); return setStatus('Terms saved.', false);
            }
            if (action === 'terms-clear') {
                var r6 = await authedReq('POST','/api/terms-summary',{text:''});
                if (!r6.ok) return setStatus((r6.json && r6.json.error) || 'Failed to clear terms.', true);
                await loadState(); renderBody(); return setStatus('Terms cleared.', false);
            }
            if (action === 'member-activate') {
                var mid = String(actionEl.getAttribute('data-user-id') || '').trim();
                var r7 = await authedReq('POST','/api/faction/members/' + encodeURIComponent(mid) + '/activate',{});
                if (!r7.ok) return setStatus((r7.json && r7.json.error) || 'Failed to activate member.', true);
                await loadCurrentTab(true); renderBody(); return setStatus('Member activated.', false);
            }
            if (action === 'member-remove') {
                var rid = String(actionEl.getAttribute('data-user-id') || '').trim();
                var r8 = await authedReq('POST','/api/faction/members/' + encodeURIComponent(rid) + '/remove',{});
                if (!r8.ok) return setStatus((r8.json && r8.json.error) || 'Failed to remove member.', true);
                await loadCurrentTab(true); renderBody(); return setStatus('Member removed.', false);
            }
            if (action === 'dibs') {
                var did = String(actionEl.getAttribute('data-user-id') || '').trim();
                var r9 = await authedReq('POST','/api/hospital/dibs/' + encodeURIComponent(did),{});
                if (!r9.ok) return setStatus((r9.json && r9.json.error) || 'Failed to claim dibs.', true);
                await loadCurrentTab(true); renderBody(); return setStatus('Dibs claimed.', false);
            }
            if (action === 'admin-faction-save') {
                var fid = String((overlay.querySelector('#admin-faction-id') || {}).value || '').trim();
                if (!fid) return setStatus('Enter a faction ID first.', true);
                var r10 = await adminReq('POST','/api/admin/exemptions/factions',{faction_id:fid,faction_name:String((overlay.querySelector('#admin-faction-name') || {}).value || '').trim(),note:String((overlay.querySelector('#admin-faction-note') || {}).value || '').trim()});
                if (!r10.ok) return setStatus((r10.json && r10.json.error) || 'Failed to save faction exemption.', true);
                await loadCurrentTab(true); renderBody(); return setStatus('Faction exemption saved.', false);
            }
            if (action === 'admin-faction-delete') {
                var fid2 = String((overlay.querySelector('#admin-faction-id') || {}).value || '').trim();
                if (!fid2) return setStatus('Enter a faction ID first.', true);
                var r11 = await adminReq('DELETE','/api/admin/exemptions/factions/' + encodeURIComponent(fid2),null);
                if (!r11.ok) return setStatus((r11.json && r11.json.error) || 'Failed to delete faction exemption.', true);
                await loadCurrentTab(true); renderBody(); return setStatus('Faction exemption deleted.', false);
            }
            if (action === 'admin-user-save') {
                var uid = String((overlay.querySelector('#admin-user-id') || {}).value || '').trim();
                if (!uid) return setStatus('Enter a player ID first.', true);
                var r12 = await adminReq('POST','/api/admin/exemptions/users',{user_id:uid,user_name:String((overlay.querySelector('#admin-user-name') || {}).value || '').trim(),faction_id:String((overlay.querySelector('#admin-user-faction-id') || {}).value || '').trim(),faction_name:String((overlay.querySelector('#admin-user-faction-name') || {}).value || '').trim(),note:String((overlay.querySelector('#admin-user-note') || {}).value || '').trim()});
                if (!r12.ok) return setStatus((r12.json && r12.json.error) || 'Failed to save player exemption.', true);
                await loadCurrentTab(true); renderBody(); return setStatus('Player exemption saved.', false);
            }
            if (action === 'admin-user-delete') {
                var uid2 = String((overlay.querySelector('#admin-user-id') || {}).value || '').trim();
                if (!uid2) return setStatus('Enter a player ID first.', true);
                var r13 = await adminReq('DELETE','/api/admin/exemptions/users/' + encodeURIComponent(uid2),null);
                if (!r13.ok) return setStatus((r13.json && r13.json.error) || 'Failed to delete player exemption.', true);
                await loadCurrentTab(true); renderBody(); return setStatus('Player exemption deleted.', false);
            }
        } catch (err) {
            console.error('War Hub action error:', action, err);
            setStatus('Action failed: ' + action, true);
        }
    }


    var remountTimer = null;

    async 
(function boot() {
    function start() {
        ensureMounted();
        applyShieldPos();
    }

    start();
    setTimeout(start, 250);
    setTimeout(start, 1000);
    setInterval(function () {
        ensureMounted();
        applyShieldPos();
    }, 1500);
})();
