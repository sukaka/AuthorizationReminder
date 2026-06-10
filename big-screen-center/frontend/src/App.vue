<template>
  <main class="scaffold">
    <p class="eyebrow">JUXIN VISUAL OPERATIONS</p>
    <h1>统一大屏展示中心</h1>
    <p>正在建立模板目录、数据接入与全屏播放能力。</p>
  </main>
</template>

<style scoped>
:global(*) {
  box-sizing: border-box;
}

:global(body) {
  margin: 0;
  color: #e6f7ff;
  background:
    radial-gradient(circle at 50% 20%, rgb(18 76 106 / 55%), transparent 42%),
    #03111e;
  font-family: Inter, "PingFang SC", "Microsoft YaHei", sans-serif;
}

.scaffold {
  min-height: 100vh;
  display: grid;
  align-content: center;
  justify-items: center;
  padding: 48px;
  text-align: center;
}

.eyebrow {
  margin: 0 0 16px;
  color: #5ee7ff;
  font-size: 12px;
  letter-spacing: 0.28em;
}

h1 {
  margin: 0;
  font-size: clamp(42px, 6vw, 88px);
  letter-spacing: 0.08em;
}

.scaffold > p:last-child {
  margin: 24px 0 0;
  color: #9bb9ca;
  font-size: 18px;
}
</style>
