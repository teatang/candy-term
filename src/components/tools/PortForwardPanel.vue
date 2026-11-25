<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ArrowLeftRight, Play, Plus, Square } from 'lucide-vue-next';
import Button from '@/components/ui/Button.vue';
import Input from '@/components/ui/Input.vue';
import Label from '@/components/ui/Label.vue';
import Select from '@/components/ui/Select.vue';
import Badge from '@/components/ui/Badge.vue';
import { useHostsStore } from '@/stores/hosts';
import { useSessionStore } from '@/stores/sessions';
import { isTauriRuntime } from '@/lib/tauri';
import type { ForwardType, PortForwardRule } from '@/types/ssh';

const { t } = useI18n();
const hostsStore = useHostsStore();
const sessionStore = useSessionStore();

const showAdd = ref(false);
const errorMsg = ref('');
const draft = ref<PortForwardRule>({
  id: '',
  name: '',
  forwardType: 'local',
  localHost: '127.0.0.1',
  localPort: 18080,
  remoteHost: '127.0.0.1',
  remotePort: 8080,
  autoStart: false,
});

const session = computed(() => sessionStore.activeSession);
const hostProfile = computed(() =>
  session.value ? hostsStore.hosts.find((h) => h.id === session.value?.hostId) ?? null : null,
);

const typeOptions = computed(() => [
  { label: t('forwards.local'), value: 'local' },
  { label: t('forwards.remote'), value: 'remote' },
  { label: t('forwards.dynamic'), value: 'dynamic' },
]);

function isRuleRunning(ruleId: string): boolean {
  return Boolean(session.value?.tunnels.some((tun) => tun.ruleId === ruleId && tun.status === 'running'));
}

async function toggleRule(rule: PortForwardRule): Promise<void> {
  if (!session.value) return;
  if (!isTauriRuntime()) {
    errorMsg.value = t('common.desktopRequired');
    return;
  }
  errorMsg.value = '';
  try {
    if (isRuleRunning(rule.id)) {
      await sessionStore.stopForward(session.value.id, rule.id);
    } else {
      await sessionStore.startForward(session.value.id, rule);
    }
  } catch (err) {
    errorMsg.value = String(err);
  }
}

async function createAndStartRule(): Promise<void> {
  if (!session.value) return;
  const rule: PortForwardRule = {
    ...draft.value,
    id: crypto.randomUUID(),
    name: draft.value.name.trim() || `${draft.value.forwardType.toUpperCase()} :${draft.value.localPort}`,
    localPort: Number(draft.value.localPort) || 1080,
    remotePort: Number(draft.value.remotePort) || 80,
  };
  if (hostProfile.value) {
    hostProfile.value.forwards.push(rule);
    await hostsStore.upsertHost(hostProfile.value);
  }
  showAdd.value = false;
  await toggleRule(rule);
}
</script>

<template>
  <!-- 实时端口转发与 SOCKS5 动态隧道面板 -->
  <div class="flex h-full flex-col bg-card/40">
    <div class="flex items-center justify-between border-b border-border/70 px-3.5 py-2.5">
      <div class="flex items-center gap-2">
        <ArrowLeftRight class="h-4 w-4 text-primary" />
        <span class="text-xs font-semibold">{{ t('forwards.title') }}</span>
      </div>
      <Button v-if="session?.status === 'connected'" size="sm" variant="outline" class="h-7 text-xs" @click="showAdd = !showAdd">
        <Plus class="h-3.5 w-3.5" />
        {{ t('forwards.addRule') }}
      </Button>
    </div>

    <div v-if="!session || session.status !== 'connected'" class="flex flex-1 items-center justify-center p-6 text-center">
      <p class="text-xs text-muted-foreground">{{ t('forwards.needSession') }}</p>
    </div>

    <div v-else class="flex-1 overflow-y-auto p-3 space-y-3">
      <p v-if="errorMsg" class="rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
        {{ errorMsg }}
      </p>

      <!-- 快速新增表单 -->
      <div v-if="showAdd" class="space-y-2.5 rounded-xl border border-primary/30 bg-background/80 p-3">
        <Input v-model="draft.name" :placeholder="t('forwards.ruleNamePlaceholder')" class="h-8 text-xs" />
        <Select
          :model-value="draft.forwardType"
          :options="typeOptions"
          class="h-8 text-xs"
          @update:model-value="(v) => (draft.forwardType = v as ForwardType)"
        />
        <div class="grid grid-cols-2 gap-2">
          <div class="space-y-1">
            <Label class="text-[11px]">{{ t('forwards.localHost') }}</Label>
            <Input v-model="draft.localHost" class="h-8 text-xs" />
          </div>
          <div class="space-y-1">
            <Label class="text-[11px]">{{ t('forwards.localPort') }}</Label>
            <Input
              type="number"
              :model-value="String(draft.localPort)"
              class="h-8 text-xs"
              @update:model-value="(v) => (draft.localPort = Number(v) || 0)"
            />
          </div>
          <template v-if="draft.forwardType !== 'dynamic'">
            <div class="space-y-1">
              <Label class="text-[11px]">{{ t('forwards.remoteHost') }}</Label>
              <Input v-model="draft.remoteHost" class="h-8 text-xs" />
            </div>
            <div class="space-y-1">
              <Label class="text-[11px]">{{ t('forwards.remotePort') }}</Label>
              <Input
                type="number"
                :model-value="String(draft.remotePort)"
                class="h-8 text-xs"
                @update:model-value="(v) => (draft.remotePort = Number(v) || 0)"
              />
            </div>
          </template>
        </div>
        <div class="flex justify-end gap-2">
          <Button size="sm" variant="ghost" class="h-7 text-xs" @click="showAdd = false">
            {{ t('common.cancel') }}
          </Button>
          <Button size="sm" class="h-7 text-xs" @click="createAndStartRule">
            {{ t('forwards.start') }}
          </Button>
        </div>
      </div>

      <!-- 已配置规则列表 -->
      <div
        v-if="(hostProfile?.forwards.length ?? 0) === 0 && session.tunnels.length === 0"
        class="rounded-xl border border-dashed p-6 text-center text-xs text-muted-foreground"
      >
        {{ t('forwards.emptyRules') }}
      </div>

      <div
        v-for="rule in hostProfile?.forwards ?? []"
        :key="rule.id"
        class="flex items-center justify-between gap-2 rounded-xl border border-border/80 bg-background/70 p-3"
      >
        <div class="min-w-0 space-y-1">
          <div class="flex items-center gap-2">
            <span class="truncate text-xs font-semibold">{{ rule.name }}</span>
            <Badge :variant="isRuleRunning(rule.id) ? 'success' : 'outline'">
              {{ isRuleRunning(rule.id) ? t('forwards.running') : t('forwards.stopped') }}
            </Badge>
          </div>
          <p class="font-mono text-[11px] text-muted-foreground">
            {{ rule.forwardType.toUpperCase() }} · {{ rule.localHost }}:{{ rule.localPort }}
            <span v-if="rule.forwardType !== 'dynamic'">→ {{ rule.remoteHost }}:{{ rule.remotePort }}</span>
          </p>
        </div>

        <Button
          size="icon"
          :variant="isRuleRunning(rule.id) ? 'destructive' : 'default'"
          class="h-8 w-8 shrink-0"
          :title="isRuleRunning(rule.id) ? t('forwards.stop') : t('forwards.start')"
          @click="toggleRule(rule)"
        >
          <Square v-if="isRuleRunning(rule.id)" class="h-3.5 w-3.5 fill-current" />
          <Play v-else class="h-3.5 w-3.5 fill-current" />
        </Button>
      </div>
    </div>
  </div>
</template>
