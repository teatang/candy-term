<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  CheckCircle2,
  FolderKey,
  KeyRound,
  Network,
  Plus,
  Server,
  ShieldCheck,
  Trash2,
  XCircle,
} from 'lucide-vue-next';
import Dialog from '@/components/ui/Dialog.vue';
import Button from '@/components/ui/Button.vue';
import Input from '@/components/ui/Input.vue';
import Label from '@/components/ui/Label.vue';
import Select from '@/components/ui/Select.vue';
import Switch from '@/components/ui/Switch.vue';
import Textarea from '@/components/ui/Textarea.vue';
import { CANDY_COLORS, cloneHostProfile, createEmptyHost, useHostsStore } from '@/stores/hosts';
import { isTauriRuntime, tauriApi } from '@/lib/tauri';
import type { ForwardType, HostProfile, PortForwardRule } from '@/types/ssh';

interface Props {
  open: boolean;
  editingHost: HostProfile | null;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  'update:open': [value: boolean];
  saved: [host: HostProfile, connectNow: boolean];
}>();

const { t } = useI18n();
const hostsStore = useHostsStore();

type FormTab = 'basic' | 'auth' | 'proxy' | 'forwards';
const activeTab = ref<FormTab>('basic');
const form = ref<HostProfile>(createEmptyHost());
const tagsText = ref('');
const testStatus = ref<{ type: 'idle' | 'testing' | 'ok' | 'err'; message: string }>({
  type: 'idle',
  message: '',
});

watch(
  () => [props.open, props.editingHost] as const,
  ([isOpen, editing]) => {
    if (!isOpen) return;
    activeTab.value = 'basic';
    testStatus.value = { type: 'idle', message: '' };
    if (editing) {
      form.value = cloneHostProfile(editing);
      tagsText.value = editing.tags.join(', ');
    } else {
      form.value = createEmptyHost();
      tagsText.value = '';
    }
  },
  { immediate: true },
);

const authType = computed({
  get: () => form.value.auth.type,
  set: (next: 'password' | 'privateKey' | 'agent' | 'keyboardInteractive') => {
    if (next === 'password') {
      form.value.auth = { type: 'password', password: '' };
    } else if (next === 'privateKey') {
      form.value.auth = {
        type: 'privateKey',
        privateKeyPath: '',
        privateKeyContent: '',
        passphrase: '',
      };
    } else if (next === 'agent') {
      form.value.auth = { type: 'agent' };
    } else {
      form.value.auth = { type: 'keyboardInteractive', password: '' };
    }
  },
});

const proxyType = computed({
  get: () => form.value.proxy.type,
  set: (next: 'none' | 'socks5' | 'http' | 'jumpHost') => {
    if (next === 'none') {
      form.value.proxy = { type: 'none' };
    } else if (next === 'socks5') {
      form.value.proxy = { type: 'socks5', host: '127.0.0.1', port: 1080, username: '', password: '' };
    } else if (next === 'http') {
      form.value.proxy = { type: 'http', host: '127.0.0.1', port: 8080, username: '', password: '' };
    } else {
      const firstCandidate = availableJumpHosts.value[0]?.id ?? '';
      form.value.proxy = { type: 'jumpHost', jumpHostId: firstCandidate };
    }
  },
});

const availableJumpHosts = computed(() =>
  hostsStore.hosts.filter((h) => h.id !== form.value.id),
);

const authOptions = computed(() => [
  { label: t('hosts.form.authPassword'), value: 'password' },
  { label: t('hosts.form.authPrivateKey'), value: 'privateKey' },
  { label: t('hosts.form.authAgent'), value: 'agent' },
  { label: t('hosts.form.authKeyboardInteractive'), value: 'keyboardInteractive' },
]);

const proxyOptions = computed(() => [
  { label: t('hosts.form.proxyNone'), value: 'none' },
  { label: t('hosts.form.proxySocks5'), value: 'socks5' },
  { label: t('hosts.form.proxyHttp'), value: 'http' },
  { label: t('hosts.form.proxyJumpHost'), value: 'jumpHost' },
]);

const forwardTypeOptions = computed(() => [
  { label: t('forwards.local'), value: 'local' },
  { label: t('forwards.remote'), value: 'remote' },
  { label: t('forwards.dynamic'), value: 'dynamic' },
]);

async function browseKeyFile(): Promise<void> {
  const path = await tauriApi.pickSingleFile();
  if (path && form.value.auth.type === 'privateKey') {
    form.value.auth.privateKeyPath = path;
  }
}

function addForwardRule(): void {
  const rule: PortForwardRule = {
    id: crypto.randomUUID(),
    name: `Tunnel ${form.value.forwards.length + 1}`,
    forwardType: 'local',
    localHost: '127.0.0.1',
    localPort: 13306,
    remoteHost: '127.0.0.1',
    remotePort: 3306,
    autoStart: true,
  };
  form.value.forwards.push(rule);
}

function removeForwardRule(id: string): void {
  form.value.forwards = form.value.forwards.filter((r) => r.id !== id);
}

function normalizeForm(): HostProfile {
  const cloned = cloneHostProfile(form.value);
  cloned.port = Number(cloned.port) || 22;
  cloned.keepaliveIntervalSecs = Number(cloned.keepaliveIntervalSecs) || 30;
  cloned.name = cloned.name.trim() || `${cloned.username}@${cloned.host}`;
  cloned.host = cloned.host.trim();
  cloned.username = cloned.username.trim() || 'root';
  cloned.group = cloned.group.trim() || 'Default';
  cloned.tags = tagsText.value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const r of cloned.forwards) {
    r.localPort = Number(r.localPort) || 0;
    r.remotePort = Number(r.remotePort) || 0;
  }
  return cloned;
}

const isValid = computed(() => form.value.host.trim().length > 0 && form.value.username.trim().length > 0);

async function runConnectionTest(): Promise<void> {
  if (!isValid.value) return;
  if (!isTauriRuntime()) {
    testStatus.value = { type: 'err', message: t('common.desktopRequired') };
    return;
  }
  testStatus.value = { type: 'testing', message: t('hosts.testing') };
  try {
    const normalized = normalizeForm();
    const msg = await tauriApi.testConnection(normalized, hostsStore.hosts);
    testStatus.value = { type: 'ok', message: `${t('hosts.testSuccess')} (${msg})` };
  } catch (err) {
    testStatus.value = { type: 'err', message: `${t('hosts.testFailed')}: ${String(err)}` };
  }
}

async function submit(connectNow: boolean): Promise<void> {
  if (!isValid.value) return;
  const saved = await hostsStore.upsertHost(normalizeForm());
  emit('saved', saved, connectNow);
  emit('update:open', false);
}
</script>

<template>
  <!-- 新建/编辑 SSH 主机连接模态弹窗 -->
  <Dialog
    :open="props.open"
    :title="props.editingHost ? t('hosts.editHost') : t('hosts.newHost')"
    max-width-class="max-w-2xl"
    @update:open="(v: boolean) => emit('update:open', v)"
  >
    <!-- 顶部页签切换 -->
    <div class="mb-4 grid grid-cols-4 gap-1.5 rounded-xl bg-muted/70 p-1">
      <button
        type="button"
        class="flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition-all cursor-pointer"
        :class="activeTab === 'basic' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'"
        @click="activeTab = 'basic'"
      >
        <Server class="h-3.5 w-3.5" />
        {{ t('hosts.form.tabBasic') }}
      </button>
      <button
        type="button"
        class="flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition-all cursor-pointer"
        :class="activeTab === 'auth' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'"
        @click="activeTab = 'auth'"
      >
        <KeyRound class="h-3.5 w-3.5" />
        {{ t('hosts.form.tabAuth') }}
      </button>
      <button
        type="button"
        class="flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition-all cursor-pointer"
        :class="activeTab === 'proxy' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'"
        @click="activeTab = 'proxy'"
      >
        <ShieldCheck class="h-3.5 w-3.5" />
        {{ t('hosts.form.tabProxy') }}
      </button>
      <button
        type="button"
        class="flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition-all cursor-pointer"
        :class="activeTab === 'forwards' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'"
        @click="activeTab = 'forwards'"
      >
        <Network class="h-3.5 w-3.5" />
        {{ t('hosts.form.tabForwards') }}
      </button>
    </div>

    <!-- 基础信息 -->
    <div v-if="activeTab === 'basic'" class="space-y-4">
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div class="space-y-1.5">
          <Label>{{ t('hosts.form.name') }}</Label>
          <Input v-model="form.name" :placeholder="t('hosts.form.namePlaceholder')" />
        </div>
        <div class="space-y-1.5">
          <Label>{{ t('hosts.form.group') }}</Label>
          <Input v-model="form.group" :placeholder="t('hosts.form.groupPlaceholder')" />
        </div>
      </div>

      <div class="grid grid-cols-1 gap-3 sm:grid-cols-12">
        <div class="space-y-1.5 sm:col-span-6">
          <Label>{{ t('hosts.form.host') }}</Label>
          <Input v-model="form.host" :placeholder="t('hosts.form.hostPlaceholder')" />
        </div>
        <div class="space-y-1.5 sm:col-span-2">
          <Label>{{ t('hosts.form.port') }}</Label>
          <Input
            type="number"
            :min="1"
            :max="65535"
            :model-value="String(form.port)"
            @update:model-value="(v) => (form.port = Number(v) || 22)"
          />
        </div>
        <div class="space-y-1.5 sm:col-span-4">
          <Label>{{ t('hosts.form.username') }}</Label>
          <Input v-model="form.username" :placeholder="t('hosts.form.usernamePlaceholder')" />
        </div>
      </div>

      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div class="space-y-1.5">
          <Label>{{ t('hosts.form.tags') }}</Label>
          <Input v-model="tagsText" :placeholder="t('hosts.form.tagsPlaceholder')" />
        </div>
        <div class="space-y-1.5">
          <Label>{{ t('hosts.form.keepalive') }}</Label>
          <Input
            type="number"
            :min="0"
            :max="300"
            :model-value="String(form.keepaliveIntervalSecs)"
            @update:model-value="(v) => (form.keepaliveIntervalSecs = Number(v) || 0)"
          />
        </div>
      </div>

      <div class="space-y-1.5">
        <Label>{{ t('hosts.form.color') }}</Label>
        <div class="flex items-center gap-2 pt-1">
          <button
            v-for="c in CANDY_COLORS"
            :key="c"
            type="button"
            class="h-6 w-6 rounded-full transition-transform hover:scale-110 cursor-pointer"
            :class="form.color === c ? 'ring-2 ring-offset-2 ring-foreground scale-110' : ''"
            :style="{ backgroundColor: c }"
            @click="form.color = c"
          />
        </div>
      </div>

      <div class="space-y-1.5">
        <Label>{{ t('hosts.form.notes') }}</Label>
        <Textarea v-model="form.notes" :placeholder="t('hosts.form.notesPlaceholder')" :rows="2" />
      </div>
    </div>

    <!-- 认证方式 -->
    <div v-if="activeTab === 'auth'" class="space-y-4">
      <div class="space-y-1.5">
        <Label>{{ t('hosts.form.authType') }}</Label>
        <Select v-model="authType" :options="authOptions" />
      </div>

      <div v-if="form.auth.type === 'password'" class="space-y-1.5">
        <Label>{{ t('hosts.form.password') }}</Label>
        <Input v-model="form.auth.password" type="password" placeholder="••••••••" />
      </div>

      <div v-if="form.auth.type === 'privateKey'" class="space-y-3">
        <div class="space-y-1.5">
          <Label>{{ t('hosts.form.privateKeyPath') }}</Label>
          <div class="flex gap-2">
            <Input
              :model-value="form.auth.privateKeyPath ?? ''"
              :placeholder="t('hosts.form.privateKeyPlaceholder')"
              @update:model-value="(v) => form.auth.type === 'privateKey' && (form.auth.privateKeyPath = v)"
            />
            <Button variant="outline" @click="browseKeyFile">
              <FolderKey class="h-4 w-4" />
              {{ t('hosts.form.browseKey') }}
            </Button>
          </div>
        </div>

        <div class="space-y-1.5">
          <Label>{{ t('hosts.form.privateKeyContent') }}</Label>
          <Textarea
            :model-value="form.auth.privateKeyContent ?? ''"
            placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
            :rows="4"
            class="font-mono text-xs"
            @update:model-value="(v) => form.auth.type === 'privateKey' && (form.auth.privateKeyContent = v)"
          />
        </div>

        <div class="space-y-1.5">
          <Label>{{ t('hosts.form.passphrase') }}</Label>
          <Input
            type="password"
            :model-value="form.auth.passphrase ?? ''"
            placeholder="••••••••"
            @update:model-value="(v) => form.auth.type === 'privateKey' && (form.auth.passphrase = v)"
          />
        </div>
      </div>

      <div
        v-if="form.auth.type === 'agent'"
        class="rounded-xl border border-border bg-muted/40 p-3 text-xs text-muted-foreground"
      >
        SSH Agent (`SSH_AUTH_SOCK`)
      </div>

      <div v-if="form.auth.type === 'keyboardInteractive'" class="space-y-1.5">
        <Label>{{ t('hosts.form.password') }}</Label>
        <Input
          type="password"
          :model-value="form.auth.password ?? ''"
          placeholder="••••••••"
          @update:model-value="(v) => form.auth.type === 'keyboardInteractive' && (form.auth.password = v)"
        />
      </div>
    </div>

    <!-- 代理与跳板机 -->
    <div v-if="activeTab === 'proxy'" class="space-y-4">
      <div class="space-y-1.5">
        <Label>{{ t('hosts.form.proxyType') }}</Label>
        <Select v-model="proxyType" :options="proxyOptions" />
      </div>

      <div
        v-if="form.proxy.type === 'socks5' || form.proxy.type === 'http'"
        class="grid grid-cols-1 gap-3 sm:grid-cols-2"
      >
        <div class="space-y-1.5">
          <Label>{{ t('hosts.form.proxyHost') }}</Label>
          <Input v-model="form.proxy.host" placeholder="127.0.0.1" />
        </div>
        <div class="space-y-1.5">
          <Label>{{ t('hosts.form.proxyPort') }}</Label>
          <Input
            type="number"
            :model-value="String(form.proxy.port)"
            @update:model-value="(v) => (form.proxy.type === 'socks5' || form.proxy.type === 'http') && (form.proxy.port = Number(v) || 1080)"
          />
        </div>
        <div class="space-y-1.5">
          <Label>{{ t('hosts.form.proxyUsername') }}</Label>
          <Input
            :model-value="form.proxy.username ?? ''"
            @update:model-value="(v) => (form.proxy.type === 'socks5' || form.proxy.type === 'http') && (form.proxy.username = v)"
          />
        </div>
        <div class="space-y-1.5">
          <Label>{{ t('hosts.form.proxyPassword') }}</Label>
          <Input
            type="password"
            :model-value="form.proxy.password ?? ''"
            @update:model-value="(v) => (form.proxy.type === 'socks5' || form.proxy.type === 'http') && (form.proxy.password = v)"
          />
        </div>
      </div>

      <div v-if="form.proxy.type === 'jumpHost'" class="space-y-1.5">
        <Label>{{ t('hosts.form.jumpHostSelect') }}</Label>
        <Select
          v-if="availableJumpHosts.length > 0"
          v-model="form.proxy.jumpHostId"
          :options="availableJumpHosts.map((h) => ({ label: `${h.name} (${h.username}@${h.host})`, value: h.id }))"
        />
        <p v-else class="text-xs text-muted-foreground">{{ t('hosts.form.noJumpHosts') }}</p>
      </div>
    </div>

    <!-- 端口转发预设规则 -->
    <div v-if="activeTab === 'forwards'" class="space-y-3">
      <div class="flex items-center justify-between">
        <span class="text-xs text-muted-foreground">{{ t('forwards.title') }}</span>
        <Button size="sm" variant="outline" @click="addForwardRule">
          <Plus class="h-3.5 w-3.5" />
          {{ t('forwards.addRule') }}
        </Button>
      </div>

      <div v-if="form.forwards.length === 0" class="rounded-xl border border-dashed p-6 text-center text-xs text-muted-foreground">
        {{ t('forwards.emptyRules') }}
      </div>

      <div
        v-for="rule in form.forwards"
        :key="rule.id"
        class="space-y-2.5 rounded-xl border border-border/80 bg-muted/25 p-3"
      >
        <div class="flex items-center gap-2">
          <Input v-model="rule.name" :placeholder="t('forwards.ruleNamePlaceholder')" class="h-8 text-xs" />
          <Select
            :model-value="rule.forwardType"
            :options="forwardTypeOptions"
            class="h-8 w-44 text-xs"
            @update:model-value="(v) => (rule.forwardType = v as ForwardType)"
          />
          <Button size="icon" variant="ghost" class="h-8 w-8 text-destructive" @click="removeForwardRule(rule.id)">
            <Trash2 class="h-3.5 w-3.5" />
          </Button>
        </div>

        <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div class="space-y-1">
            <Label class="text-[11px]">{{ t('forwards.localHost') }}</Label>
            <Input v-model="rule.localHost" class="h-8 text-xs" />
          </div>
          <div class="space-y-1">
            <Label class="text-[11px]">{{ t('forwards.localPort') }}</Label>
            <Input
              type="number"
              :model-value="String(rule.localPort)"
              class="h-8 text-xs"
              @update:model-value="(v) => (rule.localPort = Number(v) || 0)"
            />
          </div>
          <div v-if="rule.forwardType !== 'dynamic'" class="space-y-1">
            <Label class="text-[11px]">{{ t('forwards.remoteHost') }}</Label>
            <Input v-model="rule.remoteHost" class="h-8 text-xs" />
          </div>
          <div v-if="rule.forwardType !== 'dynamic'" class="space-y-1">
            <Label class="text-[11px]">{{ t('forwards.remotePort') }}</Label>
            <Input
              type="number"
              :model-value="String(rule.remotePort)"
              class="h-8 text-xs"
              @update:model-value="(v) => (rule.remotePort = Number(v) || 0)"
            />
          </div>
        </div>

        <div class="flex items-center justify-between pt-1">
          <span class="text-xs text-muted-foreground">{{ t('forwards.autoStart') }}</span>
          <Switch v-model="rule.autoStart" />
        </div>
      </div>
    </div>

    <!-- 连通性测试结果提示 -->
    <div
      v-if="testStatus.type !== 'idle'"
      class="mt-4 flex items-center gap-2 rounded-xl border px-3 py-2 text-xs"
      :class="{
        'border-border bg-muted/50 text-muted-foreground': testStatus.type === 'testing',
        'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400': testStatus.type === 'ok',
        'border-destructive/30 bg-destructive/10 text-destructive': testStatus.type === 'err',
      }"
    >
      <CheckCircle2 v-if="testStatus.type === 'ok'" class="h-4 w-4 shrink-0" />
      <XCircle v-else-if="testStatus.type === 'err'" class="h-4 w-4 shrink-0" />
      <span class="break-all">{{ testStatus.message }}</span>
    </div>

    <template #footer>
      <Button variant="outline" :disabled="!isValid || testStatus.type === 'testing'" @click="runConnectionTest">
        {{ testStatus.type === 'testing' ? t('hosts.testing') : t('hosts.testConnection') }}
      </Button>
      <div class="flex-1" />
      <Button variant="ghost" @click="emit('update:open', false)">
        {{ t('hosts.form.cancel') }}
      </Button>
      <Button variant="secondary" :disabled="!isValid" @click="submit(false)">
        {{ t('hosts.form.save') }}
      </Button>
      <Button :disabled="!isValid" @click="submit(true)">
        {{ t('hosts.form.saveAndConnect') }}
      </Button>
    </template>
  </Dialog>
</template>
