<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Activity, Cpu, HardDrive, MemoryStick, RefreshCw } from 'lucide-vue-next';
import Button from '@/components/ui/Button.vue';
import Switch from '@/components/ui/Switch.vue';
import Card from '@/components/ui/Card.vue';
import { formatBytes, formatUptime } from '@/lib/utils';
import { isTauriRuntime } from '@/lib/tauri';
import { useSessionStore } from '@/stores/sessions';

const { t } = useI18n();
const sessionStore = useSessionStore();

const autoRefresh = ref(false);
const loading = ref(false);
const errorMsg = ref('');
let timer: ReturnType<typeof setInterval> | null = null;

const session = computed(() => sessionStore.activeSession);
const metrics = computed(() => session.value?.metrics ?? null);

const memPercent = computed(() => {
  if (!metrics.value || metrics.value.memoryTotalBytes === 0) return 0;
  return Math.round((metrics.value.memoryUsedBytes / metrics.value.memoryTotalBytes) * 100);
});

const diskPercent = computed(() => {
  if (!metrics.value || metrics.value.diskTotalBytes === 0) return 0;
  return Math.round((metrics.value.diskUsedBytes / metrics.value.diskTotalBytes) * 100);
});

async function refreshNow(): Promise<void> {
  if (!session.value || session.value.status !== 'connected') return;
  if (!isTauriRuntime()) {
    errorMsg.value = t('common.desktopRequired');
    return;
  }
  loading.value = true;
  errorMsg.value = '';
  try {
    await sessionStore.refreshMetrics(session.value.id);
  } catch (err) {
    errorMsg.value = String(err);
  } finally {
    loading.value = false;
  }
}

watch(autoRefresh, (enabled) => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (enabled) {
    void refreshNow();
    timer = setInterval(() => {
      void refreshNow();
    }, 5000);
  }
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <!-- 远程服务器系统状态监控面板 -->
  <div class="flex h-full flex-col bg-card/40">
    <div class="flex items-center justify-between border-b border-border/70 px-3.5 py-2.5">
      <div class="flex items-center gap-2">
        <Activity class="h-4 w-4 text-primary" />
        <span class="text-xs font-semibold">{{ t('monitor.title') }}</span>
      </div>
      <div v-if="session?.status === 'connected'" class="flex items-center gap-2">
        <span class="text-[11px] text-muted-foreground">{{ t('monitor.autoRefresh') }}</span>
        <Switch v-model="autoRefresh" />
        <Button size="icon" variant="outline" class="h-7 w-7" :title="t('monitor.refresh')" @click="refreshNow">
          <RefreshCw class="h-3.5 w-3.5" :class="loading ? 'animate-spin' : ''" />
        </Button>
      </div>
    </div>

    <div v-if="!session || session.status !== 'connected'" class="flex flex-1 items-center justify-center p-6 text-center">
      <p class="text-xs text-muted-foreground">{{ t('monitor.needSession') }}</p>
    </div>

    <div v-else class="flex-1 overflow-y-auto p-3 space-y-3">
      <p v-if="errorMsg" class="text-xs text-destructive">{{ errorMsg }}</p>

      <div v-if="!metrics" class="rounded-xl border border-dashed p-6 text-center space-y-3">
        <p class="text-xs text-muted-foreground">{{ t('monitor.refresh') }}</p>
        <Button size="sm" @click="refreshNow">
          <RefreshCw class="h-3.5 w-3.5" />
          {{ t('monitor.refresh') }}
        </Button>
      </div>

      <template v-else>
        <Card class="p-3 space-y-2 text-xs">
          <div class="flex justify-between">
            <span class="text-muted-foreground">{{ t('monitor.hostname') }}</span>
            <span class="font-mono font-semibold">{{ metrics.hostname }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-muted-foreground">{{ t('monitor.os') }}</span>
            <span class="truncate max-w-[180px] text-right">{{ metrics.osName }} ({{ metrics.kernel }})</span>
          </div>
          <div class="flex justify-between">
            <span class="text-muted-foreground">{{ t('monitor.uptime') }}</span>
            <span class="font-mono">{{ formatUptime(metrics.uptimeSeconds) }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-muted-foreground">{{ t('monitor.loadAvg') }}</span>
            <span class="font-mono">{{ metrics.loadAvg.map((v) => v.toFixed(2)).join(' / ') }}</span>
          </div>
        </Card>

        <!-- CPU -->
        <Card class="p-3 space-y-2">
          <div class="flex items-center justify-between text-xs">
            <span class="flex items-center gap-1.5 font-medium">
              <Cpu class="h-3.5 w-3.5 text-primary" />
              {{ t('monitor.cpu') }}
            </span>
            <span class="font-mono font-semibold">{{ metrics.cpuUsagePercent.toFixed(1) }}%</span>
          </div>
          <div class="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              class="h-full bg-primary transition-all duration-300"
              :style="{ width: `${Math.min(100, metrics.cpuUsagePercent)}%` }"
            />
          </div>
        </Card>

        <!-- Memory -->
        <Card class="p-3 space-y-2">
          <div class="flex items-center justify-between text-xs">
            <span class="flex items-center gap-1.5 font-medium">
              <MemoryStick class="h-3.5 w-3.5 text-violet-500" />
              {{ t('monitor.memory') }}
            </span>
            <span class="font-mono text-[11px]">
              {{ formatBytes(metrics.memoryUsedBytes) }} / {{ formatBytes(metrics.memoryTotalBytes) }} ({{ memPercent }}%)
            </span>
          </div>
          <div class="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              class="h-full bg-violet-500 transition-all duration-300"
              :style="{ width: `${Math.min(100, memPercent)}%` }"
            />
          </div>
        </Card>

        <!-- Disk -->
        <Card class="p-3 space-y-2">
          <div class="flex items-center justify-between text-xs">
            <span class="flex items-center gap-1.5 font-medium">
              <HardDrive class="h-3.5 w-3.5 text-cyan-500" />
              {{ t('monitor.disk') }}
            </span>
            <span class="font-mono text-[11px]">
              {{ formatBytes(metrics.diskUsedBytes) }} / {{ formatBytes(metrics.diskTotalBytes) }} ({{ diskPercent }}%)
            </span>
          </div>
          <div class="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              class="h-full bg-cyan-500 transition-all duration-300"
              :style="{ width: `${Math.min(100, diskPercent)}%` }"
            />
          </div>
        </Card>
      </template>
    </div>
  </div>
</template>
