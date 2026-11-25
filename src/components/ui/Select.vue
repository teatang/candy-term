<script setup lang="ts">
import { cn } from '@/lib/utils';

export interface SelectOption {
  label: string;
  value: string;
}

interface Props {
  modelValue: string;
  options: SelectOption[];
  disabled?: boolean;
  class?: string;
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
  class: '',
});

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

function onChange(event: Event): void {
  emit('update:modelValue', (event.target as HTMLSelectElement).value);
}
</script>

<template>
  <!-- shadcn-vue 风格下拉选择组件 -->
  <select
    :value="props.modelValue"
    :disabled="props.disabled"
    @change="onChange"
    :class="
      cn(
        'flex h-9 w-full rounded-lg border border-input bg-background/80 px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-50',
        props.class,
      )
    "
  >
    <option v-for="opt in props.options" :key="opt.value" :value="opt.value">
      {{ opt.label }}
    </option>
  </select>
</template>
