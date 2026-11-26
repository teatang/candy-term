<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  ArrowUp,
  Download,
  Eye,
  EyeOff,
  File,
  Folder,
  FolderOpen,
  FolderPlus,
  Home,
  Link2,
  Pencil,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-vue-next';
import Button from '@/components/ui/Button.vue';
import Input from '@/components/ui/Input.vue';
import Badge from '@/components/ui/Badge.vue';
import { formatBytes, formatTimestamp } from '@/lib/utils';
import { isTauriRuntime, tauriApi } from '@/lib/tauri';
import { useSessionStore } from '@/stores/sessions';
import { useSettingsStore } from '@/stores/settings';
import type { SftpEntry } from '@/types/ssh';

const { t } = useI18n();
const sessionStore = useSessionStore();
const settings = useSettingsStore();

const pathInput = ref('.');
const feedback = ref('');
const errorMsg = ref('');
const dragOver = ref(false);

const session = computed(() => sessionStore.activeSession);
const isConnected = computed(() => session.value?.status === 'connected');

const visibleEntries = computed(() => {
  const list = session.value?.sftpEntries ?? [];
  if (settings.showHiddenSftp) return list;
  return list.filter((e) => !e.name.startsWith('.'));
});

watch(
  () => [session.value?.id, session.value?.status, session.value?.sftpActivated, session.value?.sftpPath] as const,
  ([sid, status, activated, remotePath]) => {
    if (remotePath) {
      pathInput.value = remotePath;
    }
    if (sid && status === 'connected' && activated && isTauriRuntime() && session.value?.sftpEntries.length === 0) {
      void navigateTo('.');
    }
  },
  { immediate: true },
);

async function navigateTo(path: string): Promise<void> {
  if (!session.value || !isConnected.value) return;
  errorMsg.value = '';
  try {
    await sessionStore.refreshSftp(session.value.id, path);
    pathInput.value = session.value.sftpPath;
  } catch (err) {
    errorMsg.value = `${t('sftp.operationFailed')}: ${String(err)}`;
  }
}

function goParent(): void {
  const current = session.value?.sftpPath || '/';
  if (current === '/') return;
  const parts = current.split('/').filter(Boolean);
  parts.pop();
  const parent = parts.length === 0 ? '/' : `/${parts.join('/')}`;
  void navigateTo(parent);
}

async function handleUploadPicker(): Promise<void> {
  if (!session.value || !isConnected.value) return;
  if (!isTauriRuntime()) {
    errorMsg.value = t('common.desktopRequired');
    return;
  }
  const files = await tauriApi.pickLocalFiles();
  for (const localPath of files) {
    try {
      await tauriApi.sftpUploadFile(session.value.id, localPath, session.value.sftpPath);
      const name = localPath.split(/[/\\]/).pop() ?? localPath;
      feedback.value = t('sftp.uploadSuccess', { name });
    } catch (err) {
      errorMsg.value = `${t('sftp.operationFailed')}: ${String(err)}`;
    }
  }
  await navigateTo(session.value.sftpPath);
}

async function handleDownload(entry: SftpEntry): Promise<void> {
  if (!session.value || entry.isDir || !isTauriRuntime()) return;
  const savePath = await tauriApi.pickSavePath(entry.name);
  if (!savePath) return;
  try {
    await tauriApi.sftpDownloadFile(session.value.id, entry.path, savePath);
    feedback.value = t('sftp.downloadSuccess', { name: entry.name });
  } catch (err) {
    errorMsg.value = `${t('sftp.operationFailed')}: ${String(err)}`;
  }
}

async function handleNewFolder(): Promise<void> {
  if (!session.value || !isConnected.value || !isTauriRuntime()) return;
  const name = window.prompt(t('sftp.newFolderPrompt'));
  if (!name?.trim()) return;
  const base = session.value.sftpPath.replace(/\/+$/, '');
  const fullPath = `${base}/${name.trim()}`;
  try {
    await tauriApi.sftpCreateDir(session.value.id, fullPath);
    await navigateTo(session.value.sftpPath);
  } catch (err) {
    errorMsg.value = `${t('sftp.operationFailed')}: ${String(err)}`;
  }
}

async function handleRename(entry: SftpEntry): Promise<void> {
  if (!session.value || !isTauriRuntime()) return;
  const nextName = window.prompt(t('sftp.renamePrompt'), entry.name);
  if (!nextName?.trim() || nextName.trim() === entry.name) return;
  const parent = entry.path.slice(0, entry.path.lastIndexOf('/')) || '/';
  const nextPath = `${parent === '/' ? '' : parent}/${nextName.trim()}`;
  try {
    await tauriApi.sftpRename(session.value.id, entry.path, nextPath);
    await navigateTo(session.value.sftpPath);
  } catch (err) {
    errorMsg.value = `${t('sftp.operationFailed')}: ${String(err)}`;
  }
}

async function handleDelete(entry: SftpEntry): Promise<void> {
  if (!session.value || !isTauriRuntime()) return;
  if (!window.confirm(t('sftp.deleteConfirm', { name: entry.name }))) return;
  try {
    await tauriApi.sftpRemove(session.value.id, entry.path, entry.isDir);
    await navigateTo(session.value.sftpPath);
  } catch (err) {
    errorMsg.value = `${t('sftp.operationFailed')}: ${String(err)}`;
  }
}

async function handleDrop(event: DragEvent): Promise<void> {
  dragOver.value = false;
  if (!session.value || !isConnected.value || !isTauriRuntime()) return;
  const files = event.dataTransfer?.files;
  if (!files || files.length === 0) return;
  for (const file of Array.from(files)) {
    const fileWithPath = file as File & { path?: string };
    if (fileWithPath.path) {
      await tauriApi.sftpUploadFile(session.value.id, fileWithPath.path, session.value.sftpPath);
    }
  }
  await navigateTo(session.value.sftpPath);
}
</script>

<template>
  <!-- SFTP 远程文件浏览与传输面板 -->
  <div
    class="flex h-full flex-col bg-card/40"
    @dragover.prevent="dragOver = true"
    @dragleave.prevent="dragOver = false"
    @drop.prevent="handleDrop"
  >
    <div v-if="!session || !isConnected" class="flex flex-1 items-center justify-center p-6 text-center">
      <p class="text-xs text-muted-foreground">{{ t('sftp.needConnection') }}</p>
    </div>

    <div
      v-else-if="!session.sftpActivated"
      class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center"
    >
      <div class="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <FolderOpen class="h-5 w-5" />
      </div>
      <div class="space-y-1">
        <p class="text-xs font-medium text-foreground">{{ t('sftp.idleTitle') }}</p>
        <p class="text-[11px] leading-relaxed text-muted-foreground">{{ t('sftp.idleDesc') }}</p>
      </div>
      <Button size="sm" class="h-8 text-xs" @click="sessionStore.activateSftp(session.id)">
        <FolderOpen class="h-3.5 w-3.5" />
        {{ t('sftp.startService') }}
      </Button>
    </div>

    <template v-else>
      <!-- 工具栏与路径栏 -->
      <div class="space-y-2 border-b border-border/70 p-3">
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs font-semibold">{{ t('sftp.title') }}</span>
          <div class="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              class="h-7 w-7"
              :title="t('sftp.showHidden')"
              @click="settings.showHiddenSftp = !settings.showHiddenSftp"
            >
              <Eye v-if="settings.showHiddenSftp" class="h-3.5 w-3.5" />
              <EyeOff v-else class="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" class="h-7 w-7" :title="t('sftp.newFolder')" @click="handleNewFolder">
              <FolderPlus class="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" class="h-7 px-2.5 text-xs" @click="handleUploadPicker">
              <Upload class="h-3.5 w-3.5" />
              {{ t('sftp.upload') }}
            </Button>
          </div>
        </div>

        <div class="flex items-center gap-1">
          <Button variant="outline" size="icon" class="h-8 w-8 shrink-0" :title="t('sftp.homeDir')" @click="navigateTo('.')">
            <Home class="h-3.5 w-3.5" />
          </Button>
          <Button variant="outline" size="icon" class="h-8 w-8 shrink-0" :title="t('sftp.upDir')" @click="goParent">
            <ArrowUp class="h-3.5 w-3.5" />
          </Button>
          <Input
            v-model="pathInput"
            :placeholder="t('sftp.pathPlaceholder')"
            class="h-8 font-mono text-xs"
            @keydown.enter="navigateTo(pathInput)"
          />
          <Button
            variant="outline"
            size="icon"
            class="h-8 w-8 shrink-0"
            :title="t('sftp.refresh')"
            @click="navigateTo(session.sftpPath)"
          >
            <RefreshCw class="h-3.5 w-3.5" :class="session.sftpLoading ? 'animate-spin' : ''" />
          </Button>
        </div>

        <!-- 传输进度条 -->
        <div
          v-if="sessionStore.activeTransfer"
          class="rounded-lg border border-primary/30 bg-primary/8 px-2.5 py-1.5 text-[11px]"
        >
          <div class="flex items-center justify-between font-medium">
            <span class="truncate">{{ sessionStore.activeTransfer.fileName }}</span>
            <span>
              {{
                sessionStore.activeTransfer.total > 0
                  ? Math.round((sessionStore.activeTransfer.transferred / sessionStore.activeTransfer.total) * 100)
                  : 0
              }}%
            </span>
          </div>
          <div class="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              class="h-full bg-primary transition-all"
              :style="{
                width: `${
                  sessionStore.activeTransfer.total > 0
                    ? Math.min(100, (sessionStore.activeTransfer.transferred / sessionStore.activeTransfer.total) * 100)
                    : 0
                }%`,
              }"
            />
          </div>
        </div>

        <p v-if="feedback" class="text-[11px] text-emerald-600 dark:text-emerald-400">{{ feedback }}</p>
        <p v-if="errorMsg" class="text-[11px] text-destructive">{{ errorMsg }}</p>
      </div>

      <!-- 文件列表 -->
      <div
        class="relative flex-1 overflow-y-auto p-2"
        :class="dragOver ? 'ring-2 ring-inset ring-primary bg-primary/5' : ''"
      >
        <div v-if="visibleEntries.length === 0" class="py-10 text-center text-xs text-muted-foreground">
          {{ t('sftp.emptyDir') }}
        </div>

        <div v-else class="space-y-1">
          <div
            v-for="entry in visibleEntries"
            :key="entry.path"
            class="group flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-colors hover:bg-accent/60"
            @dblclick="entry.isDir && navigateTo(entry.path)"
          >
            <div class="min-w-0 flex items-center gap-2">
              <Folder v-if="entry.isDir" class="h-4 w-4 shrink-0 text-amber-500" />
              <Link2 v-else-if="entry.isSymlink" class="h-4 w-4 shrink-0 text-cyan-500" />
              <File v-else class="h-4 w-4 shrink-0 text-muted-foreground" />
              <div class="min-w-0">
                <p
                  class="truncate font-medium"
                  :class="entry.isDir ? 'cursor-pointer hover:text-primary' : ''"
                  @click="entry.isDir && navigateTo(entry.path)"
                >
                  {{ entry.name }}
                </p>
                <div class="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span class="font-mono">{{ entry.permissions }}</span>
                  <span v-if="!entry.isDir">{{ formatBytes(entry.size) }}</span>
                  <span>{{ formatTimestamp(entry.modifiedAt) }}</span>
                </div>
              </div>
            </div>

            <div class="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              <Button
                v-if="!entry.isDir"
                variant="ghost"
                size="icon"
                class="h-6 w-6"
                :title="t('sftp.download')"
                @click="handleDownload(entry)"
              >
                <Download class="h-3 w-3" />
              </Button>
              <Button variant="ghost" size="icon" class="h-6 w-6" :title="t('sftp.rename')" @click="handleRename(entry)">
                <Pencil class="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                class="h-6 w-6 text-destructive"
                :title="t('sftp.delete')"
                @click="handleDelete(entry)"
              >
                <Trash2 class="h-3 w-3" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div class="border-t border-border/60 px-3 py-1.5 text-[10px] text-muted-foreground flex items-center justify-between">
        <span>{{ t('sftp.dropHint') }}</span>
        <Badge variant="outline" class="text-[10px]">{{ visibleEntries.length }}</Badge>
      </div>
    </template>
  </div>
</template>
