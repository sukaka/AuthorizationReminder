import { createRouter, createWebHistory } from 'vue-router'

import CatalogView from './views/CatalogView.vue'
import EditorView from './views/EditorView.vue'
import PlaylistView from './views/PlaylistView.vue'
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
    {
      path: '/edit/:templateId',
      name: 'editor',
      component: EditorView,
      props: true,
    },
    {
      path: '/playlists/:playlistId',
      name: 'playlist',
      component: PlaylistView,
      props: true,
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})
