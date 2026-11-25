<script setup lang="ts">
import { cn } from '@/lib/utils';

interface Props {
  forId?: string;
  class?: string;
}

const props = withDefaults(defineProps<Props>(), {
  forId: undefined,
  class: '',
});
</script>

<template>
  <!-- shadcn-vue 表单标签组件 -->
  <label
    :for="props.forId"
    :class="cn('text-xs font-medium leading-none text-foreground/90 select-none', props.class)"
  >
    <slot />
  </label>
</template>
