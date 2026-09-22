> [!NOTE]
> **Fork 维护版本** | 本仓库是 [FAVKTOXIC/dsh-theme-liquid-glass](https://github.com/FAVKTOXIC/dsh-theme-liquid-glass) 的维护分支。
>
> **与上游差异及定制特性**：
> 1. **闪屏与死循环根治**：将设置页水滴图标重构为纯 CSS Mask 驱动（`mask: url(...)`），JS 仅在首次挂载时打标，彻底杜绝与 `dsh-icon-theme`（图标主题插件）等在打开设置弹窗时的 `MutationObserver` 微任务重绘死循环与闪屏。
> 2. **设置弹窗样式隔离**：精准隔离设置弹窗 `[role="dialog"]` 内部控件，避免 SVG 折射滤镜污染产生圆斑伪影，同时完整保留弹窗内所有插件图标及 Switch 开关的白色滑动钮（Thumb）。
> 3. **侧边栏树节点无边框**：将折射玻璃按钮限制在 Header 头部操作区，彻底清除工作区/会话/任务列表树行内按钮（`...` 更多、`+` 添加等）的多余白边框与玻璃伪元素，保持清爽透明。
> 4. **TabBar 激活标签 75% 透明度**：工作区与侧边栏 TabBar 活动标签（如 `任务管理` 胶囊项）背景调整为 75% 透明度（25% 浓度）+ `backdrop-filter: blur(8px)`，呈现精致通透的液态玻璃质感。
> 5. **中文本地化与交互改进**：命令按钮匹配拓展至 `aria-label="指令"`；附件上传（📎）与底部工具栏按钮统一应用玻璃折射光效；提升默认态与 hover 态的对比度与视觉反馈。
> 6. **依赖与规范升级**：`@deepseek-ai/cordis` 升级至 4.0.2 适配 DSH 客户端包拆分；提供带构建验证的 `sync.sh` 自动同步上游脚本，全面规范中文 Commit 记录。
> 7. **焦点黑边与侧边栏底座优化**：全面重置交互元素与侧边栏底部设置触发区域的 `:focus`/`:focus-visible` 样式，消除 macOS/Chromium 系统默认的高对比度双层黑色光晕与粗黑框，根除设置弹窗停留或焦点切换时主页设置按钮间歇出现的黑边伪影。
> 8. **Switch 开关原生状态完美保真**：彻底移除对 Switch 开关轨道的强制覆盖，完美保留 DSH 原生鲜艳状态（启用中鲜绿轨道、已停用深灰轨道、白色立体滑块与平滑过渡），根除滑块丢失及悬停变白块的渲染异常。
> 9. **Tab 导航与分段控制器精准分离**：常规导航 Tab（如插件配置/插件列表、会话/轨迹等）完全恢复为无背景卡片的通透文本与主色高亮；分段控制器（如胶囊切换器）则赋予高对比度微光卡片与立体阴影，界面纯净自然；同时解耦水滴导航图标与液态玻璃开关的关联，确保在设置中关闭液态玻璃视觉效果时，左侧导航仍稳定展示专属水滴图标。
> 10. **设置面板内容区操作按钮高对比度与微光悬停**：优化暗色主题下全局 hover Token 的微光提亮机制，并为设置弹窗右侧内容区域的所有常规操作按钮（如恢复默认、选择文件、测试连接等）赋予高对比度半透明磨砂卡片、纯白清晰字色、细微光边框与动态悬停阴影反馈，彻底根除默认态文字看不清与悬停时按钮隐形消失的问题。
>
> 详见 [sync.patch](./sync.patch)。

# dsh-theme-liquid-glass

**Genuine Liquid Glass theme for DeepSeek Harness Web UI.**

<p align="center">
  <strong>
    <a href="./README.zh.md">简体中文</a>
  </strong>
</p>

A complete frosted-glass skin: SVG edge refraction, a customizable animated
wallpaper, glass-lens buttons, a redesigned full-screen model selector, and a
dedicated water-drop settings icon.

> **v0.4.2** — Requires **DeepSeek Harness ≥ `0.1.2-rc.1`**. This release adapts
> to the harness client-package split: the store part of the removed
> `@deepseek-ai/dsh-client-runtime` now lives in `@deepseek-ai/dsh-client-store`.
> See [CHANGELOG.md](CHANGELOG.md).

---

## Features

### Liquid Glass UI
- **SVG Edge Refraction** · `feDisplacementMap` refraction on the input card,
  send button, message bubbles, view tabs, queue dock, and sidebar buttons.
  Intensity is adjustable from a slider.
- **Frosted Glass** · Token overrides (`ctx.theme.overrideTokens`) swap the
  `--dsw-alias-*` semantic tokens for translucent glass values. Glass parameters
  are driven by `--dsh-lg-*` custom properties on `body` and apply instantly.
- **Glass-lens Buttons** · Send, view tabs, sidebar actions, and the command
  `(+)` button all use a glass material with edge refraction.
- **Water-drop Settings Icon** · A droplet replaces the default gear in the
  settings nav.
- **Hover Highlights** · Interactive elements get a subtle glow and lift.

### Wallpaper & Background
- **Custom Background Blur & Brightness** · Control wallpaper blur (`bgBlur`)
  and brightness (`brightness`) independently so the background sits perfectly
  under the glass.
- **Built-in Animated Demo Wallpaper** · A color-blob wallpaper that works out
  of the box, tunable via speed, blob count, color cycle, blur, and opacity.
- **Dynamic Wallpaper Sources** · Web URLs (iframe, optional host proxy), local
  HTML, local images, and local videos.

### Model Selector
- **Redesigned Model Selector** · A full-screen frosted picker with provider-group
  grid layout and hover highlights — skip the intermediate root pane and jump
  straight to the model list.

### Settings Page
- Dedicated top-level **"Liquid Glass"** page (`settings.section`, beside
  General / Model / Plugins) with two groups: **Page Background** and
  **Input Card · Frosted Glass**. All changes apply in real time; **Reset to
  defaults** restores everything.
- **One-click Disable** · The master toggle strips every token override,
  removes the wallpaper, and disables all frosted/lens rules at once — every
  visual is gated on the `body.dsh-lg-on` class, so disabling leaves zero
  residue.

### Implementation Notes
- Frost is applied as `filter: blur()` on a dedicated background layer
  (`inset: -48px` for bleed room), **never** `backdrop-filter` on `#root` —
  a non-none backdrop-filter makes `#root` the containing block for every
  `position: fixed` descendant (menus, popups, toasts), re-anchoring them.

---

## Structure

```
src/index.ts          Host half: wallpaper file routes, file upload, web proxy
src/client/index.ts   Browser half: token overrides, background layer, glass params, settings panel
src/shared.ts         Shared constants and settings types (zero runtime dependencies)
build.mjs             SWC build pipeline (lib/index.js + lib/client.js in loader format)
```

---

## Install to a DSH Web Profile

### Via npm (recommended)

```bash
dsh plugin add --profile web dsh-theme-liquid-glass
```

Refresh the browser.

> **Compatibility**: requires DeepSeek Harness **≥ `0.1.2-rc.1`**. Earlier
> harness versions use the removed `dsh-client-runtime` package and are not
> supported by v0.4.0.

### Local Development Link

Link your source directory into the profile's `node_modules` with a **Windows
junction** (a plain `dsh plugin add "<absolute-path>"` can produce a broken
relative symlink and drop the plugin from the profile `bundles` list):

```powershell
# 1) remove any stale entry
dsh plugin remove --profile web dsh-theme-liquid-glass

# 2) junction the source dir into the profile
New-Item -ItemType Junction -Path "$env:USERPROFILE\.dsh\profiles\web\node_modules\dsh-theme-liquid-glass" `
  -Target "<absolute-path-to-theme-source>" -Force

# 3) ensure the theme is listed in the profile bundles
dsh plugin add --profile web dsh-theme-liquid-glass
```

Refresh the browser.

> **After modifying code**: rebuild, then refresh.
> ```bash
> cd <theme-source-dir>
> node build.mjs
> ```
> **Client changes** (settings UI, glass params) take effect after a build +
> browser refresh. **Host changes** (routes, upload endpoint) require a
> `dsh web` restart to reload the host half.

---

## Build

```bash
npm install
npm run build        # one-shot build (lib/index.js + lib/client.js)
npm run watch        # watch mode (works with client-hmr hot-reload)
npm run dev          # build + smoke test
npm test             # run the client smoke test
npm run typecheck    # tsc --noEmit
```

---

## Client Injection

The client bundle exports an `inject` array of **service names**:
`['slots','locale','theme']` (matching the shipped dsh-ui-appearance /
dsh-dream-skin plugins). The client loader builds the fiber injection table
from this array; missing it causes `cannot get property X without inject` and a
hard web-boot failure. The `apply()` function itself is wrapped in try/catch —
runtime errors degrade gracefully without crashing the GUI.

---

## Persistence (Why localStorage)

Settings are stored in `localStorage` (key `dsh-liquid-glass.settings`), **not**
through the settings RPC. The harness settings gateway only exposes hard-coded
product namespaces to browser clients — a third-party namespace stays `loading`
forever even when the host half registered it. The shipped dsh-ui-appearance
and dsh-dream-skin plugins hit the same wall and both chose localStorage.

**Trade-off**: settings are per-browser — switching browsers or clearing site
data loses them.

---

## Settings Reference

| Field | Description |
| --- | --- |
| `enabled` | Master switch |
| `wallpaper.kind` | `none` / `url` / `html` / `image` / `video` / `local` |
| `wallpaper.value` | Web URL or relative path under the wallpapers directory |
| `wallpaper.proxy` | Route web URLs through the host proxy (bypasses X-Frame-Options) |
| `wallpaper.muted` | Mute video wallpapers (default true; unmuting may be blocked by autoplay policy) |
| `demo.speed` | Demo wallpaper animation speed multiplier 0.1–4 (step 0.1) |
| `demo.blobs` | Demo wallpaper blob count 1–6 |
| `demo.colorCycle` | Demo wallpaper color cycle 0–10 (0 = static) |
| `demo.blur` | Demo wallpaper blob blur 10–140px |
| `demo.opacity` | Demo wallpaper blob opacity 0.2–1 |
| `demo.wash` | Demo wallpaper background gradient wash toggle |
| `glass.frosted` | Frost toggle (input card / bubbles / dock backdrop blur) |
| `glass.blur` | Input card frost blur radius 0–60px |
| `glass.bgBlur` | Background wallpaper blur 0–60px (independent of card frost) |
| `glass.refraction` | Edge refraction 0–1 |
| `glass.tint` | Glass color |
| `glass.tintOpacity` | Glass color opacity 0–1 |
| `glass.toolTextColor` | Tool call text color (hex, empty = default) |
| `glass.codeBlockOpacity` | Code block background opacity 0.2–1 (independent of tint opacity) |
| `glass.glassBrightness` | Glass material brightness 0.2–1.6 (tint lightness scaling; >1 brighter, <1 darker) |
| `glass.brightness` | Background brightness 0.2–1.6 |

---

## First Launch

On first enable, the plugin checks whether `demo.html` exists under
`<DSH_HOME>/wallpapers`. If missing, it writes the built-in demo wallpaper
(existing files are never overwritten). The default path is
`$DSH_HOME/wallpapers/demo.html`; the directory can be changed via the
`wallpaperDir` config option.

---

## Screenshots

![Input card with edge refraction](assets/screenshots/screenshot-input.png)
![Chat interface with glass bubbles](assets/screenshots/screenshot-chat.png)
![Settings panel](assets/screenshots/screenshot-settings.png)

---

## License

[MIT](LICENSE)