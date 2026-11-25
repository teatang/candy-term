<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Play, Plus, Radio, Search, TerminalSquare, Trash2 } from 'lucide-vue-next';
import Button from '@/components/ui/Button.vue';
import Input from '@/components/ui/Input.vue';
import Textarea from '@/components/ui/Textarea.vue';
import Badge from '@/components/ui/Badge.vue';
import { useSnippetStore } from '@/stores/snippets';
import { useSessionStore } from '@/stores/sessions';

const { t } = useI18n();
const snippetStore = useSnippetStore();
const sessionStore = useSessionStore();

const showForm = ref(false);
const title = ref('');
const category = ref('System');
const command = ref('');

async function saveNewSnippet(): Promise<void> {
  if (!title.value.trim() || !command.value.trim()) return;
  await snippetStore.addSnippet({
    title: title.value.trim(),
    category: category.value.trim() || 'General',
    command: command.value.trim(),
  });
  title.value = '';
  command.value = '';
  showForm.value = false;
}

async function runActive(cmd: string): Promise<void> {
  const active = sessionStore.activeSession;
  if (!active || active.status !== 'connected') return;
  await sessionStore.sendInput(active.id, `${cmd}\n`);
}
</script>

<template>
  <!-- 快捷命令片段管理与广播发送面板 -->
  <div class="flex h-full flex-col bg-card/40">
    <div class="flex items-center justify-between border-b border-border/70 px-3.5 py-2.5">
      <div class="flex items-center gap-2">
        <TerminalSquare class="h-4 w-4 text-primary" />
        <span class="text-xs font-semibold">{{ t('snippets.title') }}</span>
      </div>
      <Button size="sm" variant="outline" class="h-7 text-xs" @click="showForm = !showForm">
        <Plus class="h-3.5 w-3.5" />
        {{ t('snippets.addSnippet') }}
      </Button>
    </div>

    <div class="border-b border-border/60 p-3 space-y-2">
      <div class="relative">
        <Search class="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
        <Input v-model="snippetStore.searchQuery" :placeholder="t('snippets.searchPlaceholder')" class="h-8 pl-8 text-xs" />
      </div>

      <div v-if="showForm" class="space-y-2 rounded-xl border border-primary/30 bg-background/80 p-3">
        <div class="grid grid-cols-2 gap-2">
          <Input v-model="title" :placeholder="t('snippets.snippetTitle')" class="h-8 text-xs" />
          <Input v-model="category" :placeholder="t('snippets.category')" class="h-8 text-xs" />
        </div>
        <Textarea v-model="command" :placeholder="t('snippets.command')" :rows="2" class="font-mono text-xs" />
        <div class="flex justify-end gap-2">
          <Button size="sm" variant="ghost" class="h-7 text-xs" @click="showForm = false">{{ t('common.cancel') }}</Button>
          <Button size="sm" class="h-7 text-xs" @click="saveNewSnippet">{{ t('snippets.save') }}</Button>
        </div>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto p-3 space-y-2">
      <div
        v-for="item in snippetStore.filteredSnippets"
        :key="item.id"
        class="rounded-xl border border-border/80 bg-background/70 p-3 space-y-2"
      >
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2 min-w-0">
            <span class="truncate text-xs font-semibold">{{ item.title }}</span>
            <Badge variant="secondary" class="text-[10px]">{{ item.category }}</Badge>
          </div>
          <Button
            size="icon"
            variant="ghost"
            class="h-6 w-6 text-muted-foreground hover:text-destructive"
            @click="snippetStore.removeSnippet(item.id)"
          >
            <Trash2 class="h-3 w-3" />
          </Button>
        </div>

        <pre class="overflow-x-auto rounded-lg bg-muted/60 px-2.5 py-1.5 font-mono text-[11px] text-foreground/90">{{ item.command }}</pre>

        <div class="flex items-center justify-end gap-1.5">
          <Button
            size="sm"
            variant="outline"
            class="h-7 text-[11px]"
            :disabled="!sessionStore.activeSession || sessionStore.activeSession.status !== 'connected'"
            @click="runActive(item.command)"
          >
            <Play class="h-3 w-3" />
            {{ t('snippets.runInActive') }}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            class="h-7 text-[11px]"
            :disabled="sessionStore.sessions.filter((s) => s.status === 'connected').length === 0"
            @click="sessionStore.broadcastCommand(item.command)"
          >
            <Radio class="h-3 w-3" />
            {{ t('snippets.broadcastAll') }}
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>
