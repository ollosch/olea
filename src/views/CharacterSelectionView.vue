<template>
  <section class="screen" aria-labelledby="page-title">
    <div class="screen-heading">
      <div>
        <p class="eyebrow"><span class="eyebrow-line" /> PLAYER SPACE</p>
        <h1 id="page-title">Choose your character</h1>
        <p class="screen-description">Pick up where your party left off. Your character's details will be ready on this device.</p>
      </div>
    </div>

    <div class="empty-state" role="status">
      <div class="empty-state-icon" aria-hidden="true">✧</div>
      <p class="eyebrow">READY WHEN YOU ARE</p>
      <h2>No characters to choose from</h2>
      <p>Characters appear here after a Game Master creates a game and adds characters to it.</p>
      <RouterLink class="text-link" to="/games">Go to games <span aria-hidden="true">→</span></RouterLink>
    </div>

    <aside class="upcoming-panel" aria-labelledby="player-tools-title">
      <div class="upcoming-icon" aria-hidden="true">▤</div>
      <div>
        <h2 id="player-tools-title">Your table tools</h2>
        <p>Character sheets, inventories, coins, and spellbooks will be available once a character is selected.</p>
      </div>
      <span class="coming-soon">COMING SOON</span>
    </aside>
  </section>
</template>
