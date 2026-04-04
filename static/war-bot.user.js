// ==UserScript==
// @name         War Hub ⚔️
// @namespace    fries91-war-hub
// @version      3.3.0
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
    var currentTab = String(GM_getValue(K_TAB, 'overview') || 'overview');
    var isOpen = !!GM_getValue(K_OPEN, false);
    var pollTimer = null;
    var loading = false;

    GM_addStyle('\
#warhub-shield{position:fixed!important;right:12px!important;top:50%!important;transform:translateY(-50%)!important;z-index:2147483647!important;width:44px!important;height:44px!important;border-radius:12px!important;display:flex!important;align-items:center!important;justify-content:center!important;background:radial-gradient(circle at 30% 20%, rgba(220,75,75,.98), rgba(110,12,12,.98) 55%, rgba(48,6,6,.98))!important;color:#fff!important;border:1px solid rgba(255,255,255,.12)!important;box-shadow:0 8px 24px rgba(0,0,0,.45)!important;font-size:22px!important;}\
#warhub-overlay{position:fixed!important;left:8px!important;right:8px!important;top:8px!important;bottom:8px!important;max-width:560px!important;margin:0 auto!important;background:linear-gradient(180deg,#171717,#0c0c0c)!important;color:#f2f2f2!important;border:1px solid rgba(255,255,255,.08)!important;border-radius:14px!important;box-shadow:0 16px 38px rgba(0,0,0,.54)!important;display:none!important;flex-direction:column!important;z-index:2147483646!important;overflow:hidden!important;}\
#warhub-overlay.open{display:flex!important;}\
#warhub-overlay *{box-sizing:border-box!important;font-family:inherit!important;}\
.warhub-head{padding:12px!important;border-bottom:1px solid rgba(255,255,255,.08)!important;background:rgba(255,255,255,.03)!important;}\
.warhub-row{display:flex!important;gap:8px!important;align-items:center!important;flex-wrap:wrap!important;}\
.warhub-top{display:flex!important;justify-content:space-between!important;align-items:center!important;gap:8px!important;}\
.warhub-title{font-weight:800!important;font-size:16px!important;color:#fff!important;}\
.warhub-sub{opacity:.75!important;font-size:11px!important;color:#fff!important;}\
.warhub-close,.warhub-btn,.warhub-tab{appearance:none!important;-webkit-appearance:none!important;border:1px solid rgba(255,255,255,.12)!important;color:#fff!important;border-radius:10px!important;min-height:36px!important;padding:8px 12px!important;font-weight:700!important;background:rgba(255,255,255,.08)!important;}\
.warhub-btn.primary,.warhub-tab.active{background:linear-gradient(180deg, rgba(220,50,50,.95), rgba(145,18,18,.98))!important;}\
.warhub-btn.green{background:linear-gradient(180deg, rgba(42,168,95,.98), rgba(21,120,64,.98))!important;}\
.warhub-btn.gray{background:rgba(255,255,255,.10)!important;}\
.warhub-btn.warn{background:linear-gradient(180deg, rgba(226,154,27,.98), rgba(163,102,8,.98))!important;}\
.warhub-tabs{display:flex!important;gap:4px!important;padding:6px 8px!important;overflow-x:auto!important;scrollbar-width:none!important;}\
.warhub-tabs::-webkit-scrollbar{display:none!important;}\
.warhub-body{padding:12px!important;overflow:auto!important;flex:1 1 auto!important;}\
.warhub-card{background:rgba(255,255,255,.04)!important;border:1px solid rgba(255,255,255,.08)!important;border-radius:12px!important;padding:10px!important;margin-bottom:10px!important;}\
.warhub-input,.warhub-select,.warhub-textarea{width:100%!important;padding:10px 11px!important;border-radius:10px!important;border:1px solid rgba(255,255,255,.12)!important;background:rgba(255,255,255,.07)!important;color:#fff!important;font-size:16px!important;}\
.warhub-textarea{min-height:110px!important;resize:vertical!important;}\
.warhub-pill{display:inline-flex!important;align-items:center!important;min-height:24px!important;padding:4px 8px!important;border-radius:999px!important;font-size:12px!important;font-weight:800!important;background:rgba(255,255,255,.08)!important;border:1px solid rgba(255,255,255,.08)!important;color:#fff!important;}\
.warhub-pill.good{background:rgba(36,140,82,.35)!important;}\
.warhub-pill.bad{background:rgba(170,32,32,.35)!important;}\
.warhub-pill.online{background:rgba(42,168,95,.35)!important;}\
.warhub-pill.idle{background:rgba(197,142,32,.35)!important;}\
.warhub-pill.travel{background:rgba(66,124,206,.35)!important;}\
.warhub-pill.jail{background:rgba(120,85,160,.35)!important;}\
.warhub-pill.hospital{background:rgba(199,70,70,.35)!important;}\
.warhub-pill.offline{background:rgba(105,105,105,.35)!important;}\
.warhub-grid2{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:8px!important;}\
.warhub-stat{padding:10px!important;border-radius:12px!important;background:rgba(255,255,255,.05)!important;border:1px solid rgba(255,255,255,.08)!important;}\
.warhub-stat-label{font-size:11px!important;opacity:.74!important;margin-bottom:5px!important;}\
.warhub-stat-value{font-size:22px!important;line-height:1!important;font-weight:900!important;color:#fff!important;}\
.warhub-list{display:flex!important;flex-direction:column!important;gap:8px!important;}\
.warhub-item{padding:10px!important;border-radius:12px!important;background:rgba(255,255,255,.04)!important;border:1px solid rgba(255,255,255,.08)!important;}\
.warhub-item-head{display:flex!important;justify-content:space-between!important;align-items:center!important;gap:8px!important;flex-wrap:wrap!important;}\
.warhub-name{font-weight:800!important;color:#fff!important;text-decoration:none!important;}\
.warhub-meta{font-size:12px!important;opacity:.88!important;}\
.warhub-kv{display:grid!important;grid-template-columns:1fr auto!important;gap:8px!important;align-items:center!important;padding:8px 0!important;border-bottom:1px solid rgba(255,255,255,.05)!important;}\
.warhub-kv:last-child{border-bottom:0!important;}\
.warhub-empty{opacity:.7!important;}\
@media(max-width:520px){.warhub-grid2{grid-template-columns:1fr!important;}}\
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
                    '<div><div class="warhub-title">War Hub ⚔️</div><div class="warhub-sub">Clean split loaders</div></div>',
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
        shield.addEventListener('click', function(){ setOverlayOpen(!isOpen); });
        overlay.querySelector('#warhub-close').addEventListener('click', function(){ setOverlayOpen(false); });
        overlay.addEventListener('click', handleClick);
        setOverlayOpen(isOpen);
        renderTabs();
        renderBody();
    }

    function setOverlayOpen(open) {
        isOpen = !!open;
        GM_setValue(K_OPEN, isOpen);
        overlay.classList.toggle('open', isOpen);
        restartPolling();
        if (isOpen) renderBody();
    }

    async function doLogin() {
        var key = String((overlay.querySelector('#warhub-api-key') || {}).value || '').trim();
        var ownerToken = String((overlay.querySelector('#warhub-owner-token') || {}).value || '').trim();
        if (!key) return setStatus('Enter your Torn API key.', true);
        GM_setValue(K_API_KEY, key);
        if (ownerToken) GM_setValue(K_OWNER_TOKEN, ownerToken);
        setStatus('Logging in...', false);
        var res = await req('POST', '/api/auth', {api_key:key});
        if (!res.ok || !res.json || !res.json.token) return setStatus((res.json && res.json.error) || 'Login failed.', true);
        GM_setValue(K_SESSION, String(res.json.token));
        state = res.json.state || null;
        renderTabs();
        await loadState();
        await loadCurrentTab(true);
        renderBody();
        setStatus('Logged in successfully.', false);
    }

    function doLogout() {
        GM_deleteValue(K_SESSION);
        state = null;
        tabData = {overview:null,enemies:null,hospital:null,targets:null,faction:null,admin:null,summary:null};
        setStatus('Logged out.', false);
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
        return [
            '<div class="warhub-card"><div class="warhub-title">Chain</div><div class="warhub-sub">Chain data only from /api/state and /api/chain routes</div></div>',
            '<div class="warhub-grid2">',
                '<div class="warhub-stat"><div class="warhub-stat-label">Current Chain</div><div class="warhub-stat-value">' + esc(fmtNum(chain.current || 0)) + '</div></div>',
                '<div class="warhub-stat"><div class="warhub-stat-label">Cooldown</div><div class="warhub-stat-value">' + esc(fmtNum(chain.cooldown || 0)) + '</div></div>',
            '</div>',
            '<div class="warhub-card"><div class="warhub-row"><button type="button" class="warhub-btn green" data-action="chain-available">Available</button><button type="button" class="warhub-btn gray" data-action="chain-unavailable">Unavailable</button><button type="button" class="warhub-btn warn" data-action="chain-sitter">Toggle sitter</button></div></div>',
            '<div class="warhub-card"><div class="warhub-title">Available</div>' + (arr(chain.available_items).map(function(r){ return '<div class="warhub-kv"><div>' + esc(r.user_name || r.user_id || '') + '</div><div><span class="warhub-pill good">Ready</span></div></div>'; }).join('') || '<div class="warhub-empty">No members marked available.</div>') + '</div>',
            '<div class="warhub-card"><div class="warhub-title">Sitters</div>' + (arr(chain.sitter_items).map(function(r){ return '<div class="warhub-kv"><div>' + esc(r.user_name || r.user_id || '') + '</div><div><span class="warhub-pill">Sitter</span></div></div>'; }).join('') || '<div class="warhub-empty">No chain sitters enabled.</div>') + '</div>'
        ].join('');
    }

    function renderTargets() {
        var targets = (tabData.targets && tabData.targets.items) || [];
        var enemies = (tabData.enemies && tabData.enemies.items) || [];
        return [
            '<div class="warhub-card"><div class="warhub-title">Targets</div><div class="warhub-sub">Saved targets from /api/targets. Enemy picker from /api/enemies.</div></div>',
            '<div class="warhub-card">',
                '<div class="warhub-row"><select id="warhub-target-select" class="warhub-select"><option value="">Select enemy member</option>' + enemies.map(function(m){ return '<option value="' + esc(memberId(m)) + '">' + esc(memberName(m)) + '</option>'; }).join('') + '</select></div>',
                '<div class="warhub-row" style="margin-top:8px;"><textarea id="warhub-target-note" class="warhub-textarea" placeholder="Optional note"></textarea></div>',
                '<div class="warhub-row" style="margin-top:10px;"><button type="button" class="warhub-btn green" data-action="target-save">Save Target</button></div>',
            '</div>',
            '<div class="warhub-list">' + (targets.map(function(t){ var id = memberId(t); return '<div class="warhub-item"><div class="warhub-item-head"><div class="warhub-row"><a class="warhub-name" href="' + esc(profileUrl(id)) + '" target="_blank" rel="noopener noreferrer">' + esc(memberName(t)) + '</a></div><div class="warhub-row"><a class="warhub-btn primary" href="' + esc(attackUrl(id)) + '" target="_blank" rel="noopener noreferrer">Attack</a><button type="button" class="warhub-btn gray" data-action="target-delete" data-user-id="' + esc(id) + '">Delete</button></div></div>' + (t.note ? '<div class="warhub-meta" style="margin-top:8px;">' + esc(t.note) + '</div>' : '') + '</div>'; }).join('')) + (targets.length ? '' : '<div class="warhub-card"><div class="warhub-empty">No saved targets yet.</div></div>') + '</div>'
        ].join('');
    }

    function renderMedDeals() {
        var deals = (state && state.med_deals && state.med_deals.items) || [];
        var enemies = (tabData.enemies && tabData.enemies.items) || [];
        return [
            '<div class="warhub-card"><div class="warhub-title">Med Deals</div><div class="warhub-sub">Shared faction med deals. Enemy picker only from /api/enemies.</div></div>',
            '<div class="warhub-card">',
                '<div class="warhub-row"><select id="warhub-med-enemy" class="warhub-select"><option value="">Select enemy player</option>' + enemies.map(function(m){ return '<option value="' + esc(memberId(m)) + '">' + esc(memberName(m)) + '</option>'; }).join('') + '</select></div>',
                '<div class="warhub-row" style="margin-top:10px;"><button type="button" class="warhub-btn primary" data-action="med-save">Save</button><button type="button" class="warhub-btn gray" data-action="med-clear">Delete</button></div>',
            '</div>',
            '<div class="warhub-card"><div class="warhub-title">Current Med Deals</div>' + (deals.map(function(d){ return '<div class="warhub-kv"><div>' + esc((d.user_name || d.user_id || '') + ' → ' + (d.enemy_name || d.enemy_user_id || '')) + '</div><div></div></div>'; }).join('') || '<div class="warhub-empty">No med deals posted yet.</div>') + '</div>'
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
            '<div class="warhub-card"><div class="warhub-title">Instructions</div><div class="warhub-sub">How this cleaned split works</div></div>',
            '<div class="warhub-card"><div>1. Login with your Torn API key.</div><div>2. Members/faction data loads only from <b>/api/faction/members</b>.</div><div>3. Enemy data loads only from <b>/api/enemies</b>.</div><div>4. Hospital data loads only from <b>/api/hospital</b>.</div><div>5. Overview uses only <b>/api/overview/live</b>.</div><div>6. No client-side member/enemy crossover locks or fallback mixing.</div></div>'
        ].join('');
    }

    function renderAdmin() {
        var ad = tabData.admin || {};
        var licenses = arr(ad.faction_licenses || ad.licenses);
        return [
            '<div class="warhub-card"><div class="warhub-title">Admin</div><div class="warhub-sub">Owner/admin dashboard</div></div>',
            '<div class="warhub-grid2"><div class="warhub-stat"><div class="warhub-stat-label">Factions</div><div class="warhub-stat-value">' + esc(fmtNum(ad.total_factions || 0)) + '</div></div><div class="warhub-stat"><div class="warhub-stat-label">Active Licenses</div><div class="warhub-stat-value">' + esc(fmtNum(ad.active_licenses || 0)) + '</div></div><div class="warhub-stat"><div class="warhub-stat-label">Users Using Script</div><div class="warhub-stat-value">' + esc(fmtNum(ad.users_using_script || 0)) + '</div></div><div class="warhub-stat"><div class="warhub-stat-label">User Exemptions</div><div class="warhub-stat-value">' + esc(fmtNum(ad.user_exemptions || 0)) + '</div></div></div>',
            '<div class="warhub-card"><div class="warhub-title">Faction Exemption</div><div class="warhub-row"><input id="admin-faction-id" class="warhub-input" type="text" placeholder="Faction ID" /></div><div class="warhub-row" style="margin-top:8px;"><input id="admin-faction-name" class="warhub-input" type="text" placeholder="Faction name (optional)" /></div><div class="warhub-row" style="margin-top:8px;"><textarea id="admin-faction-note" class="warhub-textarea" placeholder="Reason"></textarea></div><div class="warhub-row" style="margin-top:10px;"><button type="button" class="warhub-btn green" data-action="admin-faction-save">Save</button><button type="button" class="warhub-btn gray" data-action="admin-faction-delete">Delete</button></div></div>',
            '<div class="warhub-card"><div class="warhub-title">Player Exemption</div><div class="warhub-row"><input id="admin-user-id" class="warhub-input" type="text" placeholder="Player ID" /></div><div class="warhub-row" style="margin-top:8px;"><input id="admin-user-name" class="warhub-input" type="text" placeholder="Player name (optional)" /></div><div class="warhub-row" style="margin-top:8px;"><input id="admin-user-faction-id" class="warhub-input" type="text" placeholder="Faction ID (optional)" /></div><div class="warhub-row" style="margin-top:8px;"><input id="admin-user-faction-name" class="warhub-input" type="text" placeholder="Faction name (optional)" /></div><div class="warhub-row" style="margin-top:8px;"><textarea id="admin-user-note" class="warhub-textarea" placeholder="Reason"></textarea></div><div class="warhub-row" style="margin-top:10px;"><button type="button" class="warhub-btn green" data-action="admin-user-save">Save</button><button type="button" class="warhub-btn gray" data-action="admin-user-delete">Delete</button></div></div>',
            '<div class="warhub-card"><div class="warhub-title">Faction Licenses</div>' + (licenses.map(function(r){ return '<div class="warhub-kv"><div>' + esc((r.faction_name || 'Faction') + ' #' + (r.faction_id || '')) + '</div><div>' + esc(fmtNum(r.enabled_member_count || 0)) + ' enabled</div></div>'; }).join('') || '<div class="warhub-empty">No faction license rows.</div>') + '</div>'
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
        var tab = e.target.closest('[data-tab]');
        if (tab) {
            currentTab = tab.getAttribute('data-tab');
            GM_setValue(K_TAB, currentTab);
            await loadCurrentTab(true);
            renderBody();
            restartPolling();
            return;
        }
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

    async function boot() {
        mount();
        if (isLoggedIn()) {
            await loadState();
            await loadCurrentTab(true);
            renderBody();
            restartPolling();
        }
    }

    boot();
})();
