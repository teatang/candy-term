<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  Copy,
  Download,
  KeyRound,
  Pencil,
  Play,
  Plus,
  Search,
  Server,
  Shield,
  Star,
  Trash2,
  Upload,
} from 'lucide-vue-next';
import Button from '@/components/ui/Button.vue';
import Input from '@/components/ui/Input.vue';
import Badge from '@/components/ui/Badge.vue';
import { useHostsStore } from '@/stores/hosts';
import type { HostProfile } from '@/types/ssh';

const emit = defineEmits<{
  newHost: [];
  editHost: [host: HostProfile];
  connectHost: [host: HostProfile];
}>();

const { t } = useI18n();
const hostsStore = useHostsStore();
const importInputRef = ref<HTMLInputElement | null>(null);
const importFeedback = ref<string>('');

const authLabelKey = (host: HostProfile): string => {
  switch (host.auth.type) {
    case 'password':
      return t('hosts.form.authPassword');
    case 'privateKey':
      return t('hosts.form.authPrivateKey');
    case 'agent':
      return t('hosts.form.authAgent');
    case 'keyboardInteractive':
      return t('hosts.form.authKeyboardInteractive');
  }
};

const groupOptions = computed(() => ['__ALL__', ...hostsStore.groups]);

function handleExport(): void {
  const json = hostsStore.exportHostsJson();
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'candy-term-hosts.json';
  a.click();
  URL.revokeObjectURL(url);
}

function triggerImport(): void {
  importInputRef.value?.click();
}

async function handleImportFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const count = await hostsStore.importHostsJson(text);
    importFeedback.value = `+${count}`;
    setTimeout(() => {
      importFeedback.value = '';
    }, 2500);
  } finally {
    input.value = '';
  }
}
</script>

<template>
  <!-- 左侧主机连接列表栏（支持分组、收藏、导入导出与快速搜索） -->
  <aside class="flex h-full flex-col bg-card/60 backdrop-blur-md">
    <div class="flex items-center justify-between gap-2 border-b border-border/70 px-3.5 py-3">
      <div class="flex items-center gap-2">
        <Server class="h-4 w-4 text-primary" />
        <span class="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
          {{ t('hosts.title') }}
        </span>
      </div>
      <div class="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          :title="t('hosts.importJson')"
          @click="triggerImport"
        >
          <Upload class="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          :title="t('hosts.exportJson')"
          @click="handleExport"
        >
          <Download class="h-3.5 w-3.5" />
        </Button>
        <Button size="sm" class="h-7 px-2.5 text-xs" @click="emit('newHost')">
          <Plus class="h-3.5 w-3.5" />
          <span>{{ t('hosts.newHost') }}</span>
        </Button>
      </div>
      <input
        ref="importInputRef"
        type="file"
        accept="application/json"
        class="hidden"
        @change="handleImportFile"
      />
    </div>

    <!-- 搜索与分组过滤 -->
    <div class="space-y-2 border-b border-border/60 p-3">
      <div class="relative">
        <Search class="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          v-model="hostsStore.searchQuery"
          :placeholder="t('hosts.searchPlaceholder')"
          class="h-8 pl-8 text-xs"
        />
      </div>

      <div class="flex items-center gap-1.5 overflow-x-auto pb-0.5">
        <button
          type="button"
          class="inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors cursor-pointer"
          :class="
            hostsStore.favoritesOnly
              ? 'border-amber-500/40 bg-amber-500/15 text-amber-600 dark:text-amber-300'
              : 'border-border/80 text-muted-foreground hover:bg-accent'
          "
          @click="hostsStore.favoritesOnly = !hostsStore.favoritesOnly"
        >
          <Star class="h-3 w-3" />
          {{ t('hosts.favoritesOnly') }}
        </button>

        <button
          v-for="group in groupOptions"
          :key="group"
          type="button"
          class="shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors cursor-pointer"
          :class="
            hostsStore.selectedGroup === group
              ? 'border-primary/40 bg-primary/15 text-primary'
              : 'border-border/80 text-muted-foreground hover:bg-accent'
          "
          @click="hostsStore.selectedGroup = group"
        >
          {{ group === '__ALL__' ? t('hosts.allGroups') : group }}
        </button>

        <Badge v-if="importFeedback" variant="success">{{ importFeedback }}</Badge>
      </div>
    </div>

    <!-- 主机卡片列表 -->
    <div class="flex-1 overflow-y-auto p-2.5 space-y-2">
      <div
        v-if="hostsStore.filteredHosts.length === 0"
        class="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/80 px-4 py-10 text-center"
      >
        <div class="mb-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <KeyRound class="h-5 w-5" />
        </div>
        <p class="text-xs font-medium text-foreground">{{ t('hosts.emptyTitle') }}</p>
        <p class="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          {{ t('hosts.emptyDesc') }}
        </p>
        <Button size="sm" class="mt-4 h-8 text-xs" @click="emit('newHost')">
          <Plus class="h-3.5 w-3.5" />
          {{ t('hosts.newHost') }}
        </Button>
      </div>

      <div
        v-for="host in hostsStore.filteredHosts"
        :key="host.id"
        class="group relative rounded-xl border border-border/75 bg-background/70 p-3 transition-all duration-150 hover:border-primary/45 hover:bg-accent/35 hover:shadow-sm"
        @dblclick="emit('connectHost', host)"
      >
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0 flex items-center gap-2.5">
            <span
              class="h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-background shadow-xs"
              :style="{ backgroundColor: host.color || '#ec4899' }"
            />
            <div class="min-w-0">
              <div class="flex items-center gap-1.5">
                <span class="truncate text-sm font-medium text-foreground">
                  {{ host.name || host.host }}
                </span>
                <button
                  type="button"
                  class="text-muted-foreground transition-colors hover:text-amber-500 cursor-pointer"
                  :title="host.favorite ? t('hosts.unfavorite') : t('hosts.favorite')"
                  @click.stop="hostsStore.toggleFavorite(host.id)"
                >
                  <Star
                    class="h-3.5 w-3.5"
                    :class="host.favorite ? 'fill-amber-400 text-amber-400' : ''"
                  />
                </button>
              </div>
              <p class="truncate font-mono text-[11px] text-muted-foreground">
                {{ host.username }}@{{ host.host }}:{{ host.port }}
              </p>
            </div>
          </div>

          <Button
            size="icon"
            variant="ghost"
            class="h-7 w-7 shrink-0 text-primary hover:bg-primary/15"
            :title="t('hosts.connect')"
            @click.stop="emit('connectHost', host)"
          >
            <Play class="h-3.5 w-3.5 fill-current" />
          </Button>
        </div>

        <div class="mt-2.5 flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary" class="px-2 py-0 text-[10px]">
            {{ authLabelKey(host) }}
          </Badge>
          <Badge v-if="host.proxy.type !== 'none'" variant="default" class="px-2 py-0 text-[10px]">
            <Shield class="h-2.5 w-2.5" />
            {{ host.proxy.type.toUpperCase() }}
          </Badge>
          <Badge
            v-for="tag in host.tags.slice(0, 2)"
            :key="tag"
            variant="outline"
            class="px-1.5 py-0 text-[10px]"
          >
            #{{ tag }}
          </Badge>
        </div>

        <!-- 悬停操作按钮条 -->
        <div
          class="mt-2 flex items-center justify-end gap-1 border-t border-border/50 pt-2 opacity-80 group-hover:opacity-100"
        >
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
            @click.stop="emit('editHost', host)"
          >
            <Pencil class="h-3 w-3" />
            {{ t('common.edit') }}
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
            @click.stop="hostsStore.duplicateHost(host.id)"
          >
            <Copy class="h-3 w-3" />
            {{ t('hosts.duplicate') }}
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-destructive/80 hover:bg-destructive/10 hover:text-destructive cursor-pointer"
            @click.stop="hostsStore.deleteHost(host.id)"
          >
            <Trash2 class="h-3 w-3" />
            {{ t('hosts.delete') }}
          </button>
        </div>
      </div>
    </div>
  </aside>
</template>
