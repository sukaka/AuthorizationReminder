<template>
  <div class="app-shell">
    <header class="topline">
      <RouterLink to="/" class="brand">
        <span class="brand__mark">JX</span>
        <span>
          <strong>统一大屏展示中心</strong>
          <small>可视化运营图谱</small>
        </span>
      </RouterLink>
      <div class="topline__status">
        <span class="status-dot" aria-hidden="true" />
        数据通道待命
      </div>
    </header>
    <RouterView />
  </div>
</template>

<style scoped>
.topline {
  position: sticky;
  top: 0;
  z-index: 20;
  min-height: 68px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 clamp(24px, 4vw, 64px);
  background: rgb(255 255 255 / 94%);
  border-bottom: 1px solid var(--line-strong);
  box-shadow: 0 8px 28px rgb(34 92 129 / 6%);
}

.brand {
  display: flex;
  align-items: center;
  gap: 14px;
  color: var(--ink-strong);
  text-decoration: none;
}

.brand__mark {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  color: #ffffff;
  background: var(--accent-warm);
  font-family: var(--font-display);
  font-weight: 800;
}

.brand strong,
.brand small {
  display: block;
}

.brand strong {
  font-family: var(--font-display);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.04em;
}

.brand small {
  margin-top: 3px;
  color: var(--ink-muted);
  font-size: 8px;
  letter-spacing: 0.16em;
}

.topline__status {
  display: flex;
  align-items: center;
  gap: 9px;
  color: var(--ink-muted);
  font-size: 11px;
}

.status-dot {
  width: 7px;
  height: 7px;
  background: var(--accent-signal);
  border-radius: 50%;
  box-shadow: 0 0 0 4px color-mix(in oklch, var(--accent-signal), transparent 84%);
}
</style>
