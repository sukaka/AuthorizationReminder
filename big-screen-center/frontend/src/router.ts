import { createRouter, createWebHistory } from 'vue-router'

import CatalogView from './views/CatalogView.vue'
import PlayerView from './views/PlayerView.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'catalog', component: CatalogView },
    {
      path: '/play/:templateId',
      name: 'player',
      component: PlayerView,
      props: true,
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})
