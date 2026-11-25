<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { AlertTriangle, ShieldCheck } from 'lucide-vue-next';
import Dialog from '@/components/ui/Dialog.vue';
import Button from '@/components/ui/Button.vue';
import Badge from '@/components/ui/Badge.vue';
import { useSessionStore } from '@/stores/sessions';

const { t } = useI18n();
const sessionStore = useSessionStore();
</script>

<template>
  <!-- 未知或变更服务器公钥指纹验证弹窗 -->
  <Dialog
    :open="Boolean(sessionStore.pendingChallenge)"
    :title="t('terminal.hostKeyTitle')"
    :description="t('terminal.hostKeyDesc')"
    max-width-class="max-w-lg"
    @update:open="(v: boolean) => !v && sessionStore.resolveHostKeyChallenge(false)"
  >
    <div v-if="sessionStore.pendingChallenge" class="space-y-3">
      <div class="flex items-center gap-2">
        <AlertTriangle v-if="sessionStore.pendingChallenge.changed" class="h-5 w-5 text-destructive" />
        <ShieldCheck v-else class="h-5 w-5 text-primary" />
        <span class="font-mono text-sm font-semibold">
          {{ sessionStore.pendingChallenge.hostPort }}
        </span>
        <Badge :variant="sessionStore.pendingChallenge.changed ? 'destructive' : 'default'">
          {{ sessionStore.pendingChallenge.algorithm }}
        </Badge>
      </div>

      <div class="rounded-xl border border-border bg-muted/50 p-3 font-mono text-xs break-all select-all">
        {{ sessionStore.pendingChallenge.fingerprint }}
      </div>
    </div>

    <template #footer>
      <Button variant="outline" @click="sessionStore.resolveHostKeyChallenge(false)">
        {{ t('terminal.hostKeyReject') }}
      </Button>
      <Button @click="sessionStore.resolveHostKeyChallenge(true)">
        {{ t('terminal.hostKeyTrust') }}
      </Button>
    </template>
  </Dialog>
</template>
