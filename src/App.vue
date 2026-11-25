<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  Activity,
  ArrowLeftRight,
  FolderOpen,
  Languages,
  Monitor,
  Moon,
  PanelLeft,
  PanelRight,
  Plus,
  RotateCw,
  Settings,
  Sparkles,
  Sun,
  Terminal,
  TerminalSquare,
  X,
} from 'lucide-vue-next';
import Button from '@/components/ui/Button.vue';
import Badge from '@/components/ui/Badge.vue';
import HostSidebar from '@/components/hosts/HostSidebar.vue';
import HostDialog from '@/components/hosts/HostDialog.vue';
import HostKeyDialog from '@/components/terminal/HostKeyDialog.vue';
import TerminalView from '@/components/terminal/TerminalView.vue';
import SftpPanel from '@/components/sftp/SftpPanel.vue';
import PortForwardPanel from '@/components/tools/PortForwardPanel.vue';
import SnippetsPanel from '@/components/tools/SnippetsPanel.vue';
import ServerMonitorPanel from '@/components/tools/ServerMonitorPanel.vue';
import SettingsDialog from '@/components/tools/SettingsDialog.vue';
import { useHostsStore } from '@/stores/hosts';
import { useSessionStore } from '@/stores/sessions';
import { useSettingsStore } from '@/stores/settings';
import { useSnippetStore } from '@/stores/snippets';
import { isTauriRuntime } from '@/lib/tauri';
import type { HostProfile } from '@/types/ssh';

const { t } = useI18n();
const settings = useSettingsStore();
const hostsStore = useHostsStore();
const sessionStore = useSessionStore();
const snippetStore = useSnippetStore();

type RightToolTab = 'sftp' | 'forwards' | 'snippets' | 'monitor';
const rightPanelOpen = ref(true);
const rightTab = ref<RightToolTab>('sftp');

const hostDialogOpen = ref(false);
const editingHost = ref<HostProfile | null>(null);
const settingsOpen = ref(false);

const inDesktop = computed(() => isTauriRuntime());

function openNewHostDialog(): void {
  editingHost.value = null;
  hostDialogOpen.value = true;
}

function openEditHostDialog(host: HostProfile): void {
  editingHost.value = host;
  hostDialogOpen.value = true;
}

async function connectToHost(host: HostProfile): Promise<void> {
  await hostsStore.markConnected(host.id);
  await sessionStore.openSession(host, hostsStore.hosts);
}

function handleHostSaved(host: HostProfile, connectNow: boolean): void {
  if (connectNow) {
    void connectToHost(host);
  }
}

async function reconnectSession(sessionId: string): Promise<void> {
  const existing = sessionStore.sessions.find((s) => s.id === sessionId);
  if (!existing) return;
  const host = hostsStore.hosts.find((h) => h.id === existing.hostId);
  if (!host) return;
  await sessionStore.closeSession(sessionId);
  await connectToHost(host);
}

function selectToolTab(tab: RightToolTab): void {
  if (rightPanelOpen.value && rightTab.value === tab) {
    rightPanelOpen.value = false;
  } else {
    rightTab.value = tab;
    rightPanelOpen.value = true;
  }
}

onMounted(async () => {
  settings.applyThemeAndLocale();
  await Promise.all([
    hostsStore.loadHosts(),
    snippetStore.loadSnippets(),
    sessionStore.initEventListeners(),
  ]);
});
</script>

<template>
  <!-- candy-term / 糖果终端 主工作台布局（自适应桌面端与窄屏设备） -->
  <div class="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
    <!-- 顶部极简导航栏 -->
    <header
      class="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border/75 bg-card/80 px-3 backdrop-blur-md"
    >
      <div class="flex items-center gap-2.5 min-w-0">
        <Button
          variant="ghost"
          size="icon"
          class="h-8 w-8"
          :title="t('nav.hosts')"
          @click="settings.sidebarCollapsed = !settings.sidebarCollapsed"
        >
          <PanelLeft class="h-4 w-4" />
        </Button>

        <div class="flex items-center gap-2">
          <div
            class="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-pink-500 via-fuchsia-500 to-violet-600 text-white shadow-sm"
          >
            <Terminal class="h-4 w-4" />
          </div>
          <div class="leading-tight">
            <div class="flex items-center gap-1.5">
              <span class="text-sm font-bold tracking-tight">candy-term</span>
              <span class="hidden sm:inline text-xs text-muted-foreground">· {{ t('app.name') }}</span>
            </div>
          </div>
        </div>

        <Badge v-if="!inDesktop" variant="warning" class="hidden md:inline-flex text-[10px]">
          Preview Mode
        </Badge>
      </div>

      <!-- 右侧快捷工具开关、语言切换、日夜模式切换与设置 -->
      <div class="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          class="h-8 px-2 text-xs"
          :class="rightPanelOpen && rightTab === 'sftp' ? 'bg-accent text-accent-foreground' : ''"
          @click="selectToolTab('sftp')"
        >
          <FolderOpen class="h-3.5 w-3.5" />
          <span class="hidden lg:inline">{{ t('nav.sftp') }}</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          class="h-8 px-2 text-xs"
          :class="rightPanelOpen && rightTab === 'forwards' ? 'bg-accent text-accent-foreground' : ''"
          @click="selectToolTab('forwards')"
        >
          <ArrowLeftRight class="h-3.5 w-3.5" />
          <span class="hidden lg:inline">{{ t('nav.forwards') }}</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          class="h-8 px-2 text-xs"
          :class="rightPanelOpen && rightTab === 'snippets' ? 'bg-accent text-accent-foreground' : ''"
          @click="selectToolTab('snippets')"
        >
          <TerminalSquare class="h-3.5 w-3.5" />
          <span class="hidden lg:inline">{{ t('nav.snippets') }}</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          class="h-8 px-2 text-xs"
          :class="rightPanelOpen && rightTab === 'monitor' ? 'bg-accent text-accent-foreground' : ''"
          @click="selectToolTab('monitor')"
        >
          <Activity class="h-3.5 w-3.5" />
          <span class="hidden lg:inline">{{ t('nav.monitor') }}</span>
        </Button>

        <div class="mx-1 h-4 w-px bg-border" />

        <Button
          variant="ghost"
          size="sm"
          class="h-8 px-2 text-xs font-medium"
          :title="t('language.label')"
          @click="settings.toggleLocale()"
        >
          <Languages class="h-3.5 w-3.5" />
          <span>{{ settings.locale === 'zh-CN' ? '中' : 'EN' }}</span>
        </Button>

        <Button
          variant="ghost"
          size="icon"
          class="h-8 w-8"
          :title="`${t('theme.label')}: ${t(`theme.${settings.theme}`)}`"
          @click="settings.cycleTheme()"
        >
          <Monitor v-if="settings.theme === 'system'" class="h-4 w-4" />
          <Sun v-else-if="settings.theme === 'light'" class="h-4 w-4 text-amber-500" />
          <Moon v-else class="h-4 w-4 text-violet-400" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          class="h-8 w-8"
          :title="t('nav.settings')"
          @click="settingsOpen = true"
        >
          <Settings class="h-4 w-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          class="h-8 w-8"
          @click="rightPanelOpen = !rightPanelOpen"
        >
          <PanelRight class="h-4 w-4" />
        </Button>
      </div>
    </header>

    <!-- 主体三栏弹性工作区 -->
    <div class="relative flex flex-1 min-h-0 overflow-hidden">
      <!-- 左侧主机侧边栏（小屏下以浮层呈现，桌面端停靠） -->
      <div
        v-if="!settings.sidebarCollapsed"
        class="absolute inset-y-0 left-0 z-30 w-72 border-r border-border/75 bg-background shadow-xl md:static md:z-auto md:shadow-none shrink-0"
      >
        <HostSidebar
          @new-host="openNewHostDialog"
          @edit-host="openEditHostDialog"
          @connect-host="connectToHost"
        />
      </div>

      <!-- 中央终端标签与会话区 -->
      <main class="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
        <!-- 终端会话多标签条 -->
        <div
          v-if="sessionStore.sessions.length > 0"
          class="flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b border-border/70 bg-muted/35 px-2"
        >
          <div
            v-for="session in sessionStore.sessions"
            :key="session.id"
            class="group flex h-7 max-w-[220px] shrink-0 items-center gap-2 rounded-lg border px-2.5 text-xs transition-all cursor-pointer"
            :class="
              sessionStore.activeSessionId === session.id
                ? 'border-primary/40 bg-background text-foreground shadow-xs'
                : 'border-transparent text-muted-foreground hover:bg-background/60 hover:text-foreground'
            "
            @click="sessionStore.activeSessionId = session.id"
          >
            <span
              class="h-2 w-2 shrink-0 rounded-full"
              :class="{
                'bg-amber-400 animate-pulse': session.status === 'connecting',
                'bg-emerald-500': session.status === 'connected',
                'bg-zinc-400': session.status === 'disconnected',
                'bg-destructive': session.status === 'error',
              }"
            />
            <span class="truncate font-medium">{{ session.title }}</span>
            <button
              v-if="session.status === 'disconnected' || session.status === 'error'"
              type="button"
              class="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              :title="t('terminal.reconnect')"
              @click.stop="reconnectSession(session.id)"
            >
              <RotateCw class="h-3 w-3" />
            </button>
            <button
              type="button"
              class="rounded p-0.5 text-muted-foreground opacity-60 hover:bg-accent hover:text-foreground group-hover:opacity-100"
              :title="t('terminal.closeTab')"
              @click.stop="sessionStore.closeSession(session.id)"
            >
              <X class="h-3 w-3" />
            </button>
          </div>

          <Button variant="ghost" size="icon" class="h-7 w-7 shrink-0" @click="openNewHostDialog">
            <Plus class="h-3.5 w-3.5" />
          </Button>
        </div>

        <!-- 欢迎空状态视图 -->
        <div
          v-if="sessionStore.sessions.length === 0"
          class="relative flex flex-1 flex-col items-center justify-center overflow-y-auto p-6 text-center"
        >
          <div
            class="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,oklch(0.75_0.16_330/0.12),transparent_58%)]"
          />
          <div class="relative max-w-md space-y-5">
            <div
              class="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-pink-500 via-fuchsia-500 to-violet-600 text-white shadow-lg shadow-pink-500/20"
            >
              <Sparkles class="h-8 w-8" />
            </div>
            <div class="space-y-2">
              <h1 class="text-xl font-bold tracking-tight">{{ t('terminal.welcomeTitle') }}</h1>
              <p class="text-xs leading-relaxed text-muted-foreground">
                {{ t('terminal.welcomeDesc') }}
              </p>
              <p class="text-[11px] font-medium text-primary/90">
                {{ t('app.tagline') }}
              </p>
            </div>
            <div class="flex flex-wrap items-center justify-center gap-2">
              <Button @click="openNewHostDialog">
                <Plus class="h-4 w-4" />
                {{ t('terminal.newSession') }}
              </Button>
              <Button variant="outline" @click="settingsOpen = true">
                <Settings class="h-4 w-4" />
                {{ t('nav.settings') }}
              </Button>
            </div>
          </div>
        </div>

        <!-- 终端渲染区（保留后台会话实例状态） -->
        <div v-else class="relative flex-1 min-h-0 overflow-hidden">
          <div
            v-for="session in sessionStore.sessions"
            :key="session.id"
            v-show="sessionStore.activeSessionId === session.id"
            class="h-full w-full flex flex-col"
          >
            <div
              v-if="session.status === 'error' && session.errorMessage"
              class="flex items-center justify-between border-b border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive"
            >
              <span class="truncate">{{ session.errorMessage }}</span>
              <Button size="sm" variant="outline" class="h-6 text-[11px]" @click="reconnectSession(session.id)">
                {{ t('terminal.reconnect') }}
              </Button>
            </div>
            <TerminalView
              :session-id="session.id"
              :active="sessionStore.activeSessionId === session.id"
              class="flex-1 min-h-0"
            />
          </div>
        </div>
      </main>

      <!-- 右侧可折叠功能抽屉（小屏浮层、桌面端停靠） -->
      <aside
        v-if="rightPanelOpen"
        class="absolute inset-y-0 right-0 z-30 flex w-80 lg:w-96 shrink-0 flex-col border-l border-border/75 bg-background/95 shadow-xl backdrop-blur-md md:static md:z-auto md:bg-card/50 md:shadow-none"
      >
        <div class="grid grid-cols-4 border-b border-border/70 bg-muted/40 p-1 text-[11px]">
          <button
            type="button"
            class="rounded-md py-1.5 font-medium transition-colors cursor-pointer"
            :class="rightTab === 'sftp' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'"
            @click="rightTab = 'sftp'"
          >
            {{ t('nav.sftp') }}
          </button>
          <button
            type="button"
            class="rounded-md py-1.5 font-medium transition-colors cursor-pointer"
            :class="rightTab === 'forwards' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'"
            @click="rightTab = 'forwards'"
          >
            {{ t('nav.forwards') }}
          </button>
          <button
            type="button"
            class="rounded-md py-1.5 font-medium transition-colors cursor-pointer"
            :class="rightTab === 'snippets' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'"
            @click="rightTab = 'snippets'"
          >
            {{ t('nav.snippets') }}
          </button>
          <button
            type="button"
            class="rounded-md py-1.5 font-medium transition-colors cursor-pointer"
            :class="rightTab === 'monitor' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'"
            @click="rightTab = 'monitor'"
          >
            {{ t('nav.monitor') }}
          </button>
        </div>

        <div class="flex-1 min-h-0 overflow-hidden">
          <SftpPanel v-if="rightTab === 'sftp'" />
          <PortForwardPanel v-else-if="rightTab === 'forwards'" />
          <SnippetsPanel v-else-if="rightTab === 'snippets'" />
          <ServerMonitorPanel v-else />
        </div>
      </aside>
    </div>

    <!-- 弹窗组件 -->
    <HostDialog
      v-model:open="hostDialogOpen"
      :editing-host="editingHost"
      @saved="handleHostSaved"
    />
    <SettingsDialog v-model:open="settingsOpen" />
    <HostKeyDialog />
  </div>
</template>
