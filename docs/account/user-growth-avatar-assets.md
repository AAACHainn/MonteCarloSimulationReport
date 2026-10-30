# 第五阶段头像资源

> 文档状态：历史记录。适用范围：2026-10-26 的头像资源生成与校验记录；阶段进度、待验收状态、用户授权、命令和测试结果只属于该记录时点，不代表当前状态。
> 当前规范：[用户档案与成长](user-growth-design.md)。

日期：2026-10-26。使用内置 imagegen 工具逐张生成 8 幅独立人物头像，没有使用 API/CLI 回退。生成原图保留在工具默认目录；项目正式资源为 public/avatars/ 下的 512×512 WebP（sharp 0.34.5，quality 88），原始 PNG 和过程文件不纳入 Git。

| 资源 | 名称 | 字节 | SHA-256 |
| --- | --- | ---: | --- |
| [public/avatars/cultivator-1.webp](../../public/avatars/cultivator-1.webp) | 青衫修士 | 38860 | e960b1cf9afd73d7aebc0a13de139c9270031aff77c81307c6d7be94688011db |
| [public/avatars/cultivator-2.webp](../../public/avatars/cultivator-2.webp) | 玉簪修士 | 35756 | c9eabffa60ab8fd032ab0ef8fbd54d65c650de70e90c6d6f877a5583c419bc46 |
| [public/avatars/cultivator-3.webp](../../public/avatars/cultivator-3.webp) | 问道书生 | 40980 | 0dfb404788d0d250a7a0a627b1026b70b2959beb4839df33c911c75a3146002a |
| [public/avatars/cultivator-4.webp](../../public/avatars/cultivator-4.webp) | 素衣行者 | 32836 | 91b9f9f91e9497de068328ec7a7a4177775c9dd2baa45d66027b47ee7c07ea9e |
| [public/avatars/cultivator-5.webp](../../public/avatars/cultivator-5.webp) | 松风长者 | 42038 | f2f06e7682ef8323b8a183b9f8f172f5cd2ace402596d3d761482c3d2e70708a |
| [public/avatars/cultivator-6.webp](../../public/avatars/cultivator-6.webp) | 听云长者 | 41252 | aaf237be97e0b5fb66a96e7ba48ed9eb7dfcf3f546adc4ac945875f2262a3b30 |
| [public/avatars/cultivator-7.webp](../../public/avatars/cultivator-7.webp) | 山间游侠 | 44694 | 9095b971bd84f0d8d43555efffbdc27a7f6369e7dafcfb3297310ca66b7eebd3 |
| [public/avatars/cultivator-8.webp](../../public/avatars/cultivator-8.webp) | 墨衣剑修 | 45616 | e0c8f19a3d62e07e6dfa22693020c06e2125e24dedd1f109321dd154d640c860 |

## 原始提示词集合

每张使用下列同一模板，将 SUBJECT 替换为对应一行主体；无参考图，无透明背景。

```text
Use case: stylized-concept. Asset type: production portrait avatar for a restrained Chinese cultivation-themed personal profile inside a professional trading training workbench. Create ONE SQUARE image, exactly one person: SUBJECT. Unified elegant soft gouache and Chinese ink wash digital painting, simplified readable facial features, subtle paper texture, warm off-white plain background, jade/slate/ivory muted palette, no bright glow. Centered front-facing head and upper shoulders; face large and recognizable at 32px; generous safe margin for circular crop, top hair entirely in frame. Soft diffuse light, natural human proportions. No text, no border, no circle frame, no logos, no weapon, no fantasy effects, no scenery. Save as standalone opaque portrait.
```

1. 青衫修士：`young East Asian male cultivator, tied black hair, calm expression, ivory and muted jade robe`
2. 玉簪修士：`young East Asian female cultivator, tied dark hair with a simple jade hairpin, sage green robe, composed expression`
3. 问道书生：`middle aged East Asian male scholar cultivator, short neat beard, blue gray robe, thoughtful kind expression`
4. 素衣行者：`middle aged East Asian female cultivator, neatly pinned black hair, ivory robe with muted ochre collar, confident expression`
5. 松风长者：`elderly East Asian male cultivator, white tied hair and short white beard, dark teal robe, gentle wise expression`
6. 听云长者：`elderly East Asian female cultivator, silver hair in a plain bun, slate blue robe, serene strong expression`
7. 山间游侠：`androgynous young East Asian wanderer cultivator, short tied dark hair, warm gray travel robe, friendly lively expression`
8. 墨衣剑修：`adult East Asian female sword cultivator, high dark ponytail, muted ink blue robe, steady determined expression`

## 使用与维护

头像与境界无绑定关系。默认旧资料 DEFAULT 仍呈中性人物占位，不替用户选择新人物。32/40/80px 圆形显示，回放共行紧凑入口按已确认的 20px 例外；失败只显示中性占位。用户上传不经过仙侠滤镜，按裁切位置保存，并保留自身色彩。

服务端图片处理参考 [sharp 构造与输入限制](https://sharp.pixelplumbing.com/api-constructor/)和[裁切/缩放](https://sharp.pixelplumbing.com/api-resize/)，实际兼容及检查以锁定版本测试为准。
