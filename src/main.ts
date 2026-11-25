import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { i18n } from './i18n';
import './style.css';

// 创建 Vue 3 应用实例，挂载 Pinia 状态管理与 vue-i18n 多语言支持
const app = createApp(App);
app.use(createPinia());
app.use(i18n);
app.mount('#app');
