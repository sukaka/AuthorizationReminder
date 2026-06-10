import { createRouter, createWebHistory } from 'vue-router'

import CatalogView from './views/CatalogView.vue'
import PlayerPlaceholder from './views/PlayerPlaceholder.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'catalog', component: CatalogView },
    {
      path: '/play/:templateId',
      name: 'player',
      component: PlayerPlaceholder,
      props: true,
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})
