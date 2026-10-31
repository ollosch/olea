<template>
  <section class="screen" aria-labelledby="page-title">
    <div class="screen-heading">
      <div>
        <p class="eyebrow"><span class="eyebrow-line" /> GAME MASTER</p>
        <h1 id="page-title">Your games</h1>
        <p class="screen-description">Set up a home for your campaign and everything you bring to the table.</p>
      </div>
      <button class="primary-button" type="button" disabled aria-describedby="games-status">
        <span aria-hidden="true">＋</span> Create a game
      </button>
    </div>

    <div class="empty-state" id="games-status">
      <div class="empty-state-icon" aria-hidden="true">◇</div>
      <p class="eyebrow">A NEW ADVENTURE STARTS HERE</p>
      <h2>No games yet</h2>
      <p>Create a game to keep its characters and table notes together. Game setup is coming soon.</p>
      <span class="feature-status"><span aria-hidden="true">✦</span> Game creation is not available yet</span>
    </div>

    <aside class="upcoming-panel" aria-labelledby="upcoming-title">
      <div class="upcoming-icon" aria-hidden="true">✧</div>
      <div>
        <h2 id="upcoming-title">A place for your whole campaign</h2>
        <p>Games will bring characters, encounters, and shared resources together. Nothing is stored here yet.</p>
      </div>
      <span class="coming-soon">COMING SOON</span>
    </aside>
  </section>
</template>
