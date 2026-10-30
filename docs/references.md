# Animation references

The five File Muncher themes are original SVG illustrations and CSS animations. No third-party characters, fonts, images, animation assets, or library source code are included in these themes. The projects below informed the research into visual techniques. They are not runtime dependencies.

| Theme | Reference | Technique | License |
| --- | --- | --- | --- |
| Pixel Factory | [NES.css](https://github.com/nostalgic-css/NES.css) | Hard-edged pixel silhouettes and stepped movement | [Code: MIT](https://github.com/nostalgic-css/NES.css/blob/develop/LICENSE) |
| Little Tank | [Anime.js](https://github.com/juliangarnier/anime) | Sequenced anticipation, firing, and recovery | [MIT](https://github.com/juliangarnier/anime/blob/master/LICENSE.md) |
| Munch | [mo.js](https://github.com/mojs/mojs) | Squash and stretch, burst and staggered particles | [MIT](https://github.com/mojs/mojs/blob/main/LICENSE.md) |
| Deep Space | [tsParticles](https://github.com/tsparticles/tsparticles) | Orbiting particles and inward motion | [MIT](https://github.com/tsparticles/tsparticles/blob/main/LICENSE) |
| Paper Storm | [Rough.js](https://github.com/rough-stuff/rough) | Paper-like fills and illustrated mechanical forms | [MIT](https://github.com/rough-stuff/rough/blob/master/LICENSE) |

The repository pages and license links were checked on October 30, 2026. NES.css distinguishes its MIT-licensed code from its Creative Commons documentation, and does not include fonts. Any future use of third-party code or assets must retain the applicable notices and separately verify asset and font licenses.

The animation phases are visual feedback only. The desktop deletion result determines success or failure; an animation ending does not indicate that deletion succeeded. Theme previews do not access the filesystem. Reduced-motion preferences disable animation while preserving static status indicators.

## 桌面宠物交互参考

- [Codex Pets](https://codex-pets.net/) 与其 [Ella Wave 分享页](https://codex-pets.net/share/ella-wave)：参考轻量桌面角色与悬停回应的表达。
- [codex-pets-web / Interactions](https://github.com/FroeMic/codex-pets-web#interactions)：公开说明水平拖动切换 running-left/right，释放时触发短动作；本项目据此设计原创方向动作与 350ms 落地反馈。
- [codex-pet-share](https://github.com/portons/codex-pet-share)：其代码仓库为 MIT，说明基础动作与方向动画布局。社区角色素材的版权不由代码许可覆盖。

仅参考交互与动画状态组织方式，没有复制上述网站的角色、精灵图、代码或其他素材。五款 SVG 与拖动动画继续由本项目自行实现。
