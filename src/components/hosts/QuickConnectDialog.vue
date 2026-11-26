<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Play, Plus, Search, Server, Star } from 'lucide-vue-next';
import Dialog from '@/components/ui/Dialog.vue';
import Input from '@/components/ui/Input.vue';
import Button from '@/components/ui/Button.vue';
import Badge from '@/components/ui/Badge.vue';
import { useHostsStore } from '@/stores/hosts';
import type { HostProfile } from '@/types/ssh';

interface Props {
  open: boolean;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  'update:open': [value: boolean];
  selectHost: [host: HostProfile];
  newHost: [];
}>();

const { t } = useI18n();
const hostsStore = useHostsStore();
const query = ref('');

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      query.value = '';
    }
  },
);

const matchingHosts = computed<HostProfile[]>(() => {
  const q = query.value.trim().toLowerCase();
  return [...hostsStore.hosts]
    .filter((h) => {
      if (!q) return true;
      const haystack = [h.name, h.host, h.username, h.group, ...h.tags].join(' ').toLowerCase();
      return haystack.includes(q);
    })
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name));
});

function pick(host: HostProfile): void {
  emit('selectHost', host);
  emit('update:open', false);
}

function createNew(): void {
  emit('update:open', false);
  emit('newHost');
}
</script>

<template>
  <!-- 从标签栏 + 按钮快速选择已有连接打开新终端标签 -->
  <Dialog
    :open="props.open"
    :title="t('terminal.pickHostTitle')"
    max-width-class="max-w-md"
    @update:open="(v: boolean) => emit('update:open', v)"
  >
    <div class="space-y-3">
      <div class="relative">
        <Search class="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          v-model="query"
          :placeholder="t('terminal.pickHostSearch')"
          class="h-8 pl-8 text-xs"
        />
      </div>

      <div
        v-if="matchingHosts.length === 0"
        class="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/80 px-4 py-8 text-center"
      >
        <Server class="mb-2 h-6 w-6 text-muted-foreground/70" />
        <p class="text-xs text-muted-foreground">{{ t('terminal.pickHostEmpty') }}</p>
      </div>

      <div v-else class="max-h-72 space-y-1.5 overflow-y-auto pr-0.5">
        <button
          v-for="host in matchingHosts"
          :key="host.id"
          type="button"
          class="flex w-full items-center justify-between gap-2 rounded-xl border border-border/70 bg-background/70 px-3 py-2 text-left transition-colors hover:border-primary/50 hover:bg-accent/40 cursor-pointer"
          @click="pick(host)"
        >
          <div class="flex min-w-0 items-center gap-2.5">
            <span
              class="h-2.5 w-2.5 shrink-0 rounded-full"
              :style="{ backgroundColor: host.color || '#ec4899' }"
            />
            <div class="min-w-0">
              <div class="flex items-center gap-1.5">
                <span class="truncate text-xs font-medium text-foreground">
                  {{ host.name || host.host }}
                </span>
                <Star
                  v-if="host.favorite"
                  class="h-3 w-3 shrink-0 fill-amber-400 text-amber-400"
                />
                <Badge v-if="host.group" variant="outline" class="px-1.5 py-0 text-[10px]">
                  {{ host.group }}
                </Badge>
              </div>
              <p class="truncate font-mono text-[11px] text-muted-foreground">
                {{ host.username }}@{{ host.host }}:{{ host.port }}
              </p>
            </div>
          </div>
          <Play class="h-3.5 w-3.5 shrink-0 text-primary" />
        </button>
      </div>
    </div>

    <template #footer>
      <Button variant="outline" size="sm" @click="createNew">
        <Plus class="h-3.5 w-3.5" />
        {{ t('hosts.newHost') }}
      </Button>
      <div class="flex-1" />
      <Button variant="ghost" size="sm" @click="emit('update:open', false)">
        {{ t('common.close') }}
      </Button>
    </template>
  </Dialog>
</template>
