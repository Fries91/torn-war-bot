  function renderWarTab() {
    const me = state?.me || {};
    const war = state?.war || {};

    const factionName = war.faction_name || "-";
    const enemyName = war.enemy_faction_name || "-";
    const statusText = war.status_text || (war.active ? "Faction loaded" : "No faction found");

    return `
      <div class="warhub-card">
        <h3>War Overview</h3>

        <div class="warhub-score-grid">
          <div class="warhub-score-box us">
            <div class="warhub-score-label">Our Score</div>
            <div class="warhub-score-value">${esc(war.score_us || 0)}</div>
            <div class="warhub-score-sub">${esc(factionName)}</div>
          </div>

          <div class="warhub-score-box them">
            <div class="warhub-score-label">Their Score</div>
            <div class="warhub-score-value">${esc(war.score_them || 0)}</div>
            <div class="warhub-score-sub">${esc(enemyName)}</div>
          </div>

          <div class="warhub-score-box lead">
            <div class="warhub-score-label">Lead</div>
            <div class="warhub-score-value">${esc(war.lead || 0)}</div>
            <div class="warhub-score-sub">${esc(statusText)}</div>
          </div>
        </div>

        <div class="warhub-overview-grid" style="margin-top:10px;">
          ${statCard("You", me.name || "-")}
          ${statCard("Enemy ID", war.enemy_faction_id || "-")}
          ${statCard("Members", war.member_count || 0)}
          ${statCard("Enemies", war.enemy_member_count || 0)}
          ${statCard("Available", war.available_count || 0)}
          ${statCard("Chain Sitters", war.chain_sitter_count || 0)}
          ${statCard("Linked Users", war.linked_user_count || 0)}
        </div>
      </div>

      <div class="warhub-card">
        <h3>My Status</h3>
        <div style="margin-bottom:8px;">
          <span class="pill ${Number(me.available) ? "green" : "red"}">${Number(me.available) ? "Available" : "Unavailable"}</span>
          <span class="pill ${Number(me.chain_sitter) ? "gold" : "gray"}">${Number(me.chain_sitter) ? "Chain Sit In" : "Chain Sit Out"}</span>
        </div>
      </div>
    `;
  }
