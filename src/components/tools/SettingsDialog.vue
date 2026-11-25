<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { Monitor, Moon, RotateCcw, ShieldCheck, Sun, Trash2 } from 'lucide-vue-next';
import Dialog from '@/components/ui/Dialog.vue';
import Button from '@/components/ui/Button.vue';
import Input from '@/components/ui/Input.vue';
import Label from '@/components/ui/Label.vue';
import Select from '@/components/ui/Select.vue';
import { useSettingsStore } from '@/stores/settings';
import { useSessionStore } from '@/stores/sessions';
import { formatTimestamp } from '@/lib/utils';
import type { LocaleCode, ThemeMode } from '@/types/ssh';

interface Props {
  open: boolean;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  'update:open': [value: boolean];
}>();

const { t } = useI18n();
const settings = useSettingsStore();
const sessionStore = useSessionStore();

const localeOptions = computed(() => [
  { label: t('language.zhCN'), value: 'zh-CN' },
  { label: t('language.enUS'), value: 'en-US' },
]);

const cursorOptions = [
  { label: 'Bar (|)', value: 'bar' },
  { label: 'Block (█)', value: 'block' },
  { label: 'Underline (_)', value: 'underline' },
];

const themeChoices = computed<{ value: ThemeMode; label: string }[]>(() => [
  { value: 'system', label: t('theme.system') },
  { value: 'light', label: t('theme.light') },
  { value: 'dark', label: t('theme.dark') },
]);

onMounted(() => {
  void sessionStore.loadKnownHosts();
});
</script>

<template>
  <!-- 全局偏好设置与已知主机指纹管理弹窗 -->
  <Dialog
    :open="props.open"
    :title="t('settings.title')"
    max-width-class="max-w-2xl"
    @update:open="(v: boolean) => emit('update:open', v)"
  >
    <div class="space-y-6">
      <!-- 外观与语言 -->
      <section class="space-y-3">
        <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {{ t('settings.appearance') }}
        </h3>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div class="space-y-1.5">
            <Label>{{ t('theme.label') }}</Label>
            <div class="grid grid-cols-3 gap-1.5 rounded-xl bg-muted/70 p-1">
              <button
                v-for="item in themeChoices"
                :key="item.value"
                type="button"
                class="flex items-center justify-center gap-1 rounded-lg py-1.5 text-xs font-medium transition-all cursor-pointer"
                :class="settings.theme === item.value ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'"
                @click="settings.setTheme(item.value)"
              >
                <Monitor v-if="item.value === 'system'" class="h-3.5 w-3.5" />
                <Sun v-else-if="item.value === 'light'" class="h-3.5 w-3.5" />
                <Moon v-else class="h-3.5 w-3.5" />
                <span>{{ item.label }}</span>
              </button>
            </div>
          </div>

          <div class="space-y-1.5">
            <Label>{{ t('language.label') }}</Label>
            <Select
              :model-value="settings.locale"
              :options="localeOptions"
              @update:model-value="(v) => settings.setLocale(v as LocaleCode)"
            />
          </div>
        </div>
      </section>

      <!-- 终端排版设置 -->
      <section class="space-y-3 border-t border-border/70 pt-4">
        <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {{ t('settings.terminalPrefs') }}
        </h3>
        <div class="space-y-1.5">
          <Label>{{ t('settings.fontFamily') }}</Label>
          <Input v-model="settings.fontFamily" class="font-mono text-xs" />
        </div>
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div class="space-y-1.5">
            <Label>{{ t('settings.fontSize') }}</Label>
            <Input
              type="number"
              :min="10"
              :max="26"
              :model-value="String(settings.fontSize)"
              @update:model-value="(v) => (settings.fontSize = Number(v) || 13.5)"
            />
          </div>
          <div class="space-y-1.5">
            <Label>{{ t('settings.lineHeight') }}</Label>
            <Input
              type="number"
              step="0.05"
              :min="1"
              :max="2"
              :model-value="String(settings.lineHeight)"
              @update:model-value="(v) => (settings.lineHeight = Number(v) || 1.35)"
            />
          </div>
          <div class="space-y-1.5">
            <Label>{{ t('settings.scrollback') }}</Label>
            <Input
              type="number"
              :min="500"
              :max="50000"
              :model-value="String(settings.scrollback)"
              @update:model-value="(v) => (settings.scrollback = Number(v) || 5000)"
            />
          </div>
          <div class="space-y-1.5">
            <Label>{{ t('settings.cursorStyle') }}</Label>
            <Select
              :model-value="settings.cursorStyle"
              :options="cursorOptions"
              @update:model-value="(v) => (settings.cursorStyle = v as 'block' | 'underline' | 'bar')"
            />
          </div>
        </div>
      </section>

      <!-- 已知信任主机列表 -->
      <section class="space-y-3 border-t border-border/70 pt-4">
        <div class="flex items-center gap-2">
          <ShieldCheck class="h-4 w-4 text-primary" />
          <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {{ t('knownHosts.title') }}
          </h3>
        </div>
        <div v-if="sessionStore.knownHosts.length === 0" class="rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground">
          {{ t('knownHosts.empty') }}
        </div>
        <div v-else class="max-h-40 overflow-y-auto space-y-1.5">
          <div
            v-for="entry in sessionStore.knownHosts"
            :key="entry.hostPort"
            class="flex items-center justify-between gap-2 rounded-lg border border-border/70 px-3 py-2 text-xs"
          >
            <div class="min-w-0">
              <p class="font-mono font-medium">{{ entry.hostPort }} · {{ entry.algorithm }}</p>
              <p class="truncate font-mono text-[10px] text-muted-foreground">
                {{ entry.fingerprint }} · {{ formatTimestamp(entry.trustedAt) }}
              </p>
            </div>
            <Button
              size="icon"
              variant="ghost"
              class="h-7 w-7 text-destructive"
              :title="t('knownHosts.remove')"
              @click="sessionStore.removeKnownHost(entry.hostPort)"
            >
              <Trash2 class="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </section>
    </div>

    <template #footer>
      <Button variant="outline" @click="settings.resetDefaults()">
        <RotateCcw class="h-3.5 w-3.5" />
        {{ t('settings.resetDefaults') }}
      </Button>
      <div class="flex-1" />
      <Button @click="emit('update:open', false)">{{ t('common.close') }}</Button>
    </template>
  </Dialog>
</template>
