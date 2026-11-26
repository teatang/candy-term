/* eslint-disable no-template-curly-in-string */
import type { Config } from 'release-it'

export default {
  git: {
    // 提交消息模板
    commitMessage: 'chore(release): release v${version}',
    // Git Tag模板
    tagName: 'v${version}',
  },
  npm: {
    publish: false,
  },
  hooks: {
    'after:bump': 'tsx scripts/release.ts',
  },
} satisfies Config
