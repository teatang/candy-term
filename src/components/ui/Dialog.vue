<script setup lang="ts">
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui';
import { X } from 'lucide-vue-next';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  title?: string;
  description?: string;
  maxWidthClass?: string;
}

const props = withDefaults(defineProps<Props>(), {
  title: '',
  description: '',
  maxWidthClass: 'max-w-2xl',
});

const emit = defineEmits<{
  'update:open': [value: boolean];
}>();
</script>

<template>
  <!-- 基于 reka-ui 的 shadcn-vue 模态对话框组件 -->
  <DialogRoot :open="props.open" @update:open="(val: boolean) => emit('update:open', val)">
    <DialogPortal>
      <DialogOverlay
        class="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] transition-opacity"
      />
      <DialogContent
        :class="
          cn(
            'fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-2xl outline-none max-h-[90vh] flex flex-col',
            props.maxWidthClass,
          )
        "
      >
        <div class="flex items-start justify-between gap-4 pb-3 border-b border-border/70">
          <div class="space-y-1">
            <DialogTitle v-if="props.title" class="text-base font-semibold tracking-tight">
              {{ props.title }}
            </DialogTitle>
            <DialogDescription v-if="props.description" class="text-xs text-muted-foreground">
              {{ props.description }}
            </DialogDescription>
            <DialogDescription v-else class="sr-only">
              {{ props.title }}
            </DialogDescription>
          </div>
          <DialogClose
            class="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground cursor-pointer"
          >
            <X class="h-4 w-4" />
          </DialogClose>
        </div>

        <div class="flex-1 overflow-y-auto py-4 pr-1">
          <slot />
        </div>

        <div v-if="$slots.footer" class="pt-3 border-t border-border/70 flex items-center justify-end gap-2">
          <slot name="footer" />
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
