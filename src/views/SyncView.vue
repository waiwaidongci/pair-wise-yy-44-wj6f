<script setup lang="ts">
import SyncPanel from '../components/SyncPanel.vue'
</script>

<template>
  <section class="page">
    <div class="page-head">
      <div>
        <p class="eyebrow">SYNC / 离线协同</p>
        <h1>断网终端合并与互锁核对</h1>
        <p class="muted">舞台监督与前场导演在断网终端各自保存入场点、路线和触发时间，联网后按提示编号合并。</p>
      </div>
    </div>
    <SyncPanel />
  </section>
</template>
