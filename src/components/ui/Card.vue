<script setup lang="ts">
import { cn } from '@/lib/utils';

interface Props {
  class?: string;
}

const props = withDefaults(defineProps<Props>(), {
  class: '',
});
</script>

<template>
  <!-- shadcn-vue 卡片容器组件 -->
  <div
    :class="
      cn(
        'rounded-xl border border-border/80 bg-card text-card-foreground shadow-xs backdrop-blur-sm',
        props.class,
      )
    "
  >
    <slot />
  </div>
</template>
