<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import { ArrowDown, ArrowUp, Eraser, Search, X, ZoomIn, ZoomOut } from 'lucide-vue-next';
import Input from '@/components/ui/Input.vue';
import Button from '@/components/ui/Button.vue';
import { useSettingsStore } from '@/stores/settings';
import { useSessionStore } from '@/stores/sessions';

interface Props {
  sessionId: string;
  active: boolean;
}

const props = defineProps<Props>();
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
        background: '#111119',
        foreground: '#eceaf4',
        cursor: '#f472b6',
        cursorAccent: '#111119',
        selectionBackground: 'rgba(244, 114, 182, 0.28)',
        black: '#1f1f2b',
        red: '#f87171',
        green: '#34d399',
        yellow: '#fbbf24',
        blue: '#60a5fa',
        magenta: '#e879f9',
        cyan: '#22d3ee',
        white: '#e2e8f0',
        brightBlack: '#64748b',
        brightRed: '#fca5a5',
        brightGreen: '#6ee7b7',
        brightYellow: '#fde68a',
        brightBlue: '#93c5fd',
        brightMagenta: '#f5d0fe',
        brightCyan: '#67e8f9',
        brightWhite: '#ffffff',
      }
    : {
        background: '#fafafa',
        foreground: '#1e1b2e',
        cursor: '#db2777',
        cursorAccent: '#fafafa',
        selectionBackground: 'rgba(219, 39, 119, 0.18)',
        black: '#1e293b',
        red: '#dc2626',
        green: '#059669',
        yellow: '#d97706',
        blue: '#2563eb',
        magenta: '#c026d3',
        cyan: '#0891b2',
        white: '#f1f5f9',
        brightBlack: '#64748b',
        brightRed: '#ef4444',
        brightGreen: '#10b981',
        brightYellow: '#f59e0b',
        brightBlue: '#3b82f6',
        brightMagenta: '#d946ef',
        brightCyan: '#06b6d4',
        brightWhite: '#ffffff',
      },
);

function syncTerminalFit(): void {
  if (!terminal || !fitAddon || !props.active) return;
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
  () => props.active,
  (isActive) => {
    if (isActive) {
      requestAnimationFrame(() => {
        syncTerminalFit();
        terminal?.focus();
      });
    }
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
  <!-- 基于 xterm.js 的高性能终端视图（支持搜索、自适应尺寸与主题实时切换） -->
  <div class="relative flex h-full w-full flex-col overflow-hidden" @keydown="handleKeydown">
    <!-- 顶部微工具条 -->
    <div class="flex items-center justify-between border-b border-border/60 bg-card/50 px-3 py-1.5 text-xs">
      <div class="flex items-center gap-1.5 text-muted-foreground">
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
        <span class="w-8 text-center font-mono text-[11px]">{{ settings.fontSize }}</span>
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

      <div class="flex items-center gap-1.5">
        <div v-if="showSearch" class="flex items-center gap-1">
          <Input
            v-model="searchText"
            :placeholder="t('terminal.searchPlaceholder')"
            class="h-6 w-44 text-xs"
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
          @click="showSearch = true"
        >
          <Search class="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>

    <!-- xterm 挂载容器 -->
    <div
      ref="containerRef"
      class="candy-terminal-container flex-1 overflow-hidden"
      :style="{ backgroundColor: xtermTheme.background }"
    />
  </div>
</template>
