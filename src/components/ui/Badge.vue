<script setup lang="ts">
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary/12 text-primary',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'border-border text-muted-foreground',
        success: 'border-emerald-500/25 bg-emerald-500/12 text-emerald-600 dark:text-emerald-400',
        warning: 'border-amber-500/25 bg-amber-500/12 text-amber-600 dark:text-amber-400',
        destructive: 'border-destructive/25 bg-destructive/12 text-destructive',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

type BadgeVariants = VariantProps<typeof badgeVariants>;

interface Props {
  variant?: BadgeVariants['variant'];
  class?: string;
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'default',
  class: '',
});
</script>

<template>
  <!-- shadcn-vue 徽章标签组件 -->
  <span :class="cn(badgeVariants({ variant: props.variant }), props.class)">
    <slot />
  </span>
</template>
