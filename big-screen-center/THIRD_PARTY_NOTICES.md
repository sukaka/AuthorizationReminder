# Third-Party Notices

This project pins the following runtime dependencies. Repository links identify
the upstream project used to verify package ownership and license metadata.

## Backend Runtime Dependencies

| Package | Version | License | Official repository | Purpose |
| --- | --- | --- | --- | --- |
| `cookie-parser` | `1.4.7` | MIT | https://github.com/expressjs/cookie-parser | Parse authentication and session cookies in the BFF. |
| `cors` | `2.8.6` | MIT | https://github.com/expressjs/cors | Apply explicit cross-origin policy to API responses. |
| `express` | `5.2.1` | MIT | https://github.com/expressjs/express | Provide the HTTP API and middleware runtime. |
| `mysql2` | `3.22.5` | MIT | https://github.com/sidorares/node-mysql2 | Access the dedicated big-screen MySQL database. |
| `zod` | `4.4.3` | MIT | https://github.com/colinhacks/zod | Validate API payloads, configuration, and stored contracts. |

## Frontend Runtime Dependencies

| Package | Version | License | Official repository | Purpose |
| --- | --- | --- | --- | --- |
| `@antv/g6` | `5.1.1` | MIT | https://github.com/antvis/g6 | Render relationship and topology graphs. |
| `@kjgl77/datav-vue3` | `1.7.4` | MIT | https://github.com/vaemusic/datav-vue3 | Supply decorative technical-screen frames through the isolated adapter described below. |
| `@tsparticles/vue3` | `4.1.3` | MIT | https://github.com/tsparticles/tsparticles | Integrate tsParticles with Vue components. |
| `animejs` | `4.4.1` | MIT | https://github.com/juliangarnier/anime | Drive deterministic interface and scene transitions. |
| `echarts` | `6.1.0` | Apache-2.0 | https://github.com/apache/echarts | Render charts, gauges, maps, and dashboards. |
| `echarts-gl` | `2.1.0` | MIT | https://github.com/ecomfe/echarts-gl | Add WebGL series and 3D chart support to ECharts. |
| `gridstack` | `12.6.0` | MIT | https://github.com/gridstack/gridstack.js | Provide constrained dashboard grid layout and editing. |
| `maplibre-gl` | `5.24.0` | BSD-3-Clause | https://github.com/maplibre/maplibre-gl-js | Render offline-capable vector maps. |
| `pinia` | `3.0.4` | MIT | https://github.com/vuejs/pinia | Manage frontend application state. |
| `three` | `0.184.0` | MIT | https://github.com/mrdoob/three.js | Render the flagship 3D visualization scenes. |
| `tsparticles` | `4.1.3` | MIT | https://github.com/tsparticles/tsparticles | Provide the particle rendering engine. |
| `vue` | `3.5.35` | MIT | https://github.com/vuejs/core | Provide the frontend component runtime. |
| `vue-router` | `5.1.0` | MIT | https://github.com/vuejs/router | Route catalog, editor, and player views. |

## DataV Adapter Boundary

`@kjgl77/datav-vue3` may only be imported by the future
`frontend/src/components/widgets/TechFrame.vue` adapter. Other components must
consume that adapter instead of importing DataV directly, keeping replacement
or removal of the dependency isolated to one file.
