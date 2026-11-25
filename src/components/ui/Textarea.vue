<script setup lang="ts">
import { cn } from '@/lib/utils';

interface Props {
  modelValue?: string;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  class?: string;
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: '',
  placeholder: '',
  rows: 3,
  disabled: false,
  class: '',
});

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

function onInput(event: Event): void {
  emit('update:modelValue', (event.target as HTMLTextAreaElement).value);
}
</script>

<template>
  <!-- shadcn-vue 多行文本域组件 -->
  <textarea
    :value="props.modelValue"
    :placeholder="props.placeholder"
    :rows="props.rows"
    :disabled="props.disabled"
    @input="onInput"
    :class="
      cn(
        'flex min-h-[76px] w-full rounded-lg border border-input bg-background/80 px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-50',
        props.class,
      )
    "
  />
</template>
