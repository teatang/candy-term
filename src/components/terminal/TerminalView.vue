<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import {
  ArrowDown,
  ArrowUp,
  Columns2,
  Eraser,
  Maximize2,
  Minimize2,
  Rows2,
  Search,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-vue-next';
import Input from '@/components/ui/Input.vue';
import Button from '@/components/ui/Button.vue';
import { useSettingsStore } from '@/stores/settings';
import { useSessionStore } from '@/stores/sessions';

interface Props {
  sessionId: string;
  visible: boolean;
  focused: boolean;
  isFullscreen?: boolean;
  canCloseSplit?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  isFullscreen: false,
  canCloseSplit: false,
});

const emit = defineEmits<{
  focusPane: [];
  toggleFullscreen: [];
  splitHorizontal: [];
  splitVertical: [];
  closeSplit: [];
}>();

const { t } = useI18n();
const settings = useSettingsStore();
const sessionStore = useSessionStore();

const containerRef = ref<HTMLDivElement | null>(null);
const showSearch = ref(false);
const searchText = ref('');

let terminal: Terminal | null = null;
let fitAddon: FitAddon | null = null;
let searchAddon: SearchAddon | null = null;
let resizeObserver: ResizeObserver | null = null;

const xtermTheme = computed(() =>
  settings.isDark
    ? {
        background: '#10111a',
        foreground: '#ebe9f5',
        cursor: '#f472b6',
        cursorAccent: '#10111a',
        selectionBackground: 'rgba(244, 114, 182, 0.28)',
        black: '#232536',
        red: '#fb7185',
        green: '#34d399',
        yellow: '#fbbf24',
        blue: '#60a5fa',
        magenta: '#e879f9',
        cyan: '#22d3ee',
        white: '#e2e8f0',
        brightBlack: '#64748b',
        brightRed: '#fda4af',
        brightGreen: '#6ee7b7',
        brightYellow: '#fde68a',
        brightBlue: '#93c5fd',
        brightMagenta: '#f5d0fe',
        brightCyan: '#67e8f9',
        brightWhite: '#ffffff',
      }
    : {
        background: '#f8f9fc',
        foreground: '#1e2030',
        cursor: '#db2777',
        cursorAccent: '#f8f9fc',
        selectionBackground: 'rgba(219, 39, 119, 0.16)',
        black: '#1e293b',
        red: '#e11d48',
        green: '#059669',
        yellow: '#d97706',
        blue: '#2563eb',
        magenta: '#c026d3',
        cyan: '#0891b2',
        white: '#475569',
        brightBlack: '#64748b',
        brightRed: '#f43f5e',
        brightGreen: '#10b981',
        brightYellow: '#f59e0b',
        brightBlue: '#3b82f6',
        brightMagenta: '#d946ef',
        brightCyan: '#06b6d4',
        brightWhite: '#0f172a',
      },
);

const toolbarStyle = computed(() => ({
  backgroundColor: settings.isDark ? '#1a1c28' : '#eceef5',
}));

function syncTerminalFit(): void {
  if (!terminal || !fitAddon || !props.visible) return;
  try {
    fitAddon.fit();
    void sessionStore.resizeSession(props.sessionId, terminal.cols, terminal.rows);
  } catch {
    // 忽略隐藏状态下的尺寸计算异常
  }
}

function handleKeydown(event: KeyboardEvent): void {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
    event.preventDefault();
    showSearch.value = !showSearch.value;
  }
}

onMounted(() => {
  if (!containerRef.value) return;

  terminal = new Terminal({
    cursorBlink: true,
    cursorStyle: settings.cursorStyle,
    fontFamily: settings.fontFamily,
    fontSize: settings.fontSize,
    lineHeight: settings.lineHeight,
    scrollback: settings.scrollback,
    theme: xtermTheme.value,
    allowProposedApi: true,
  });

  fitAddon = new FitAddon();
  searchAddon = new SearchAddon();
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(new WebLinksAddon());
  terminal.loadAddon(searchAddon);

  terminal.open(containerRef.value);
  fitAddon.fit();

  if (props.focused) {
    terminal.focus();
  }

  terminal.onData((data) => {
    void sessionStore.sendInput(props.sessionId, data);
  });

  sessionStore.registerOutputSink(props.sessionId, (chunk) => {
    terminal?.write(chunk);
  });

  resizeObserver = new ResizeObserver(() => {
    syncTerminalFit();
  });
  resizeObserver.observe(containerRef.value);
});

watch(
  () => props.visible,
  (isVisible) => {
    if (isVisible) {
      requestAnimationFrame(() => {
        syncTerminalFit();
        if (props.focused) {
          terminal?.focus();
        }
      });
    }
  },
);

watch(
  () => props.focused,
  (isFocused) => {
    if (isFocused && props.visible) {
      requestAnimationFrame(() => {
        terminal?.focus();
      });
    }
  },
);

watch(
  () => props.isFullscreen,
  () => {
    requestAnimationFrame(() => {
      syncTerminalFit();
      if (props.focused) {
        terminal?.focus();
      }
    });
  },
);

watch(
  [
    xtermTheme,
    () => settings.fontFamily,
    () => settings.fontSize,
    () => settings.lineHeight,
    () => settings.cursorStyle,
    () => settings.scrollback,
  ],
  () => {
    if (!terminal) return;
    terminal.options.theme = xtermTheme.value;
    terminal.options.fontFamily = settings.fontFamily;
    terminal.options.fontSize = settings.fontSize;
    terminal.options.lineHeight = settings.lineHeight;
    terminal.options.cursorStyle = settings.cursorStyle;
    terminal.options.scrollback = settings.scrollback;
    syncTerminalFit();
  },
);

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  sessionStore.unregisterOutputSink(props.sessionId);
  terminal?.dispose();
  terminal = null;
});
</script>

<template>
  <!-- 基于 xterm.js 的高性能终端视图（工具条与终端画布采用无分割线色阶区分，支持搜索、分屏、全屏与主题实时切换） -->
  <div
    class="relative flex h-full w-full flex-col overflow-hidden"
    :style="{ backgroundColor: xtermTheme.background }"
    @mousedown="emit('focusPane')"
    @keydown="handleKeydown"
  >
    <!-- 顶部微工具条（通过柔和色阶与终端画布自然区分，无分割线） -->
    <div
      class="flex flex-wrap items-center justify-between gap-1 px-2 py-1 text-xs transition-colors"
      :style="toolbarStyle"
      :class="
        settings.isDark
          ? 'text-slate-300/85 [&_button]:hover:bg-white/10 [&_button]:hover:text-white'
          : 'text-slate-600 [&_button]:hover:bg-black/6 [&_button]:hover:text-slate-900'
      "
    >
      <div class="flex items-center gap-1">
        <span
          v-if="canCloseSplit"
          class="mr-1 h-2 w-2 shrink-0 rounded-full transition-colors"
          :class="focused ? 'bg-primary' : 'bg-muted-foreground/30'"
        />
        <Button
          variant="ghost"
          size="icon"
          class="h-6 w-6"
          :title="t('terminal.clearScreen')"
          @click="terminal?.clear()"
        >
          <Eraser class="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          class="h-6 w-6"
          :title="t('terminal.fontSize')"
          @click="settings.fontSize = Math.max(10, settings.fontSize - 1)"
        >
          <ZoomOut class="h-3.5 w-3.5" />
        </Button>
        <span class="w-7 text-center font-mono text-[11px]">{{ settings.fontSize }}</span>
        <Button
          variant="ghost"
          size="icon"
          class="h-6 w-6"
          :title="t('terminal.fontSize')"
          @click="settings.fontSize = Math.min(24, settings.fontSize + 1)"
        >
          <ZoomIn class="h-3.5 w-3.5" />
        </Button>
      </div>

      <div class="flex items-center gap-1">
        <div v-if="showSearch" class="flex items-center gap-1">
          <Input
            v-model="searchText"
            :placeholder="t('terminal.searchPlaceholder')"
            class="h-6 w-36 sm:w-44 text-xs"
            @keydown.enter="searchAddon?.findNext(searchText)"
          />
          <Button
            variant="ghost"
            size="icon"
            class="h-6 w-6"
            :title="t('terminal.findPrev')"
            @click="searchAddon?.findPrevious(searchText)"
          >
            <ArrowUp class="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            class="h-6 w-6"
            :title="t('terminal.findNext')"
            @click="searchAddon?.findNext(searchText)"
          >
            <ArrowDown class="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" class="h-6 w-6" @click="showSearch = false">
            <X class="h-3.5 w-3.5" />
          </Button>
        </div>
        <Button
          v-else
          variant="ghost"
          size="icon"
          class="h-6 w-6"
          :title="t('terminal.searchPlaceholder')"
          @click="showSearch = true"
        >
          <Search class="h-3.5 w-3.5" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          class="h-6 w-6"
          :class="isFullscreen ? 'bg-primary/15 text-primary' : ''"
          :title="isFullscreen ? t('terminal.exitFullscreen') : t('terminal.fullscreen')"
          @click.stop="emit('toggleFullscreen')"
        >
          <Minimize2 v-if="isFullscreen" class="h-3.5 w-3.5" />
          <Maximize2 v-else class="h-3.5 w-3.5" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          class="h-6 w-6"
          :title="t('terminal.splitHorizontal')"
          @click.stop="emit('splitHorizontal')"
        >
          <Columns2 class="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          class="h-6 w-6"
          :title="t('terminal.splitVertical')"
          @click.stop="emit('splitVertical')"
        >
          <Rows2 class="h-3.5 w-3.5" />
        </Button>
        <Button
          v-if="canCloseSplit"
          variant="ghost"
          size="icon"
          class="h-6 w-6 text-muted-foreground hover:text-destructive"
          :title="t('terminal.closeSplit')"
          @click.stop="emit('closeSplit')"
        >
          <X class="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>

    <!-- xterm 挂载容器（由外层包装提供呼吸留白，保证滚动条贴边与 FitAddon 尺寸精确） -->
    <div class="flex-1 min-h-0 overflow-hidden pl-3 pr-1 pt-2 pb-2">
      <div
        ref="containerRef"
        class="candy-terminal-container h-full w-full overflow-hidden"
        :style="{ backgroundColor: xtermTheme.background }"
      />
    </div>
  </div>
</template>
