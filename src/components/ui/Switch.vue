<script setup lang="ts">
import { SwitchRoot, SwitchThumb } from 'reka-ui';
import { cn } from '@/lib/utils';

interface Props {
  modelValue: boolean;
  disabled?: boolean;
  class?: string;
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
  class: '',
});

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();
</script>

<template>
  <!-- 基于 reka-ui 的 shadcn-vue 开关组件 -->
  <SwitchRoot
    :model-value="props.modelValue"
    :disabled="props.disabled"
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
    :class="
      cn(
        'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input',
        props.class,
      )
    "
  >
    <SwitchThumb
      class="pointer-events-none block h-4 w-4 rounded-full bg-background shadow-sm ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0"
    />
  </SwitchRoot>
</template>
