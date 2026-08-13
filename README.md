# 场域 FIELDLAB

面向高中物理“静电场”章节的交互式教学网站。站点是独立的纯 HTML/CSS/JavaScript 应用，不会修改工作区中其他项目，也不依赖外部图片、字体、CDN 或构建工具。

## 运行

推荐从本目录启动静态服务器：

```powershell
python -m http.server 8765 --bind 127.0.0.1 --directory "F:\cherry work\physics-lab"
```

浏览器打开：

```text
http://127.0.0.1:8765/
```

页面使用经典脚本与相对资源路径，也可直接打开 `index.html`；通过 HTTP 访问更便于浏览器测试与导出验证。

## 功能

- 单正电荷、等量异号、等量同号、自定义双电荷四类构型。
- 拖动源电荷、试探电荷、A/B 测量点和路径控制点。
- 电势热图、电场线、等势线、电场矢量、方向动画与标尺图层。
- 直线、折线、曲线三种路径，实时比较 `∫E·dl` 与 `φA − φB`。
- 可旋转、缩放的三维电势地形；高度使用有明确说明的 `asinh` 显示压缩。
- 实时场强、电势、电势能、电场力功、方向角和距离读数。
- 测量日志、PNG/JSON 导出、四组引导实验、详细推导、误区辨析与即时测验。
- 响应式桌面/手机布局、键盘焦点、减少动态效果、强制色和打印样式。

## 模型约定

模型限定为真空中（空气近似真空）有限个静止的三维理想点电荷，页面显示其 `z = 0` 平面截面。它仍采用三维点电荷的 `1/r²` 场强和 `1/r` 电势规律，不是二维静电学。

内部状态中的位置单位为米，界面坐标显示为厘米，电荷单位为纳库仑。物理核心接收厘米和纳库仑，在计算中显式换算为 SI 单位。固定采用：

```text
E(r) = k Σ Qᵢ Rᵢ / rᵢ³
φ(r) = k Σ Qᵢ / rᵢ
U_AB = φ_A − φ_B
Δφ_A→B = φ_B − φ_A = −U_AB
Wᵉ_A→B = q₀U_AB = −ΔE_p
```

库仑常数使用 `k = 8.9875517923 × 10⁹ N·m²/C²`。点电荷中心是数学奇点；计算核心不会使用软化库仑公式。探针进入显示屏蔽半径时，读数明确显示“未定义”。热图颜色、矢量长度和三维高度的压缩仅影响显示，实时数值始终来自解析模型。

## 验证

物理核心回归：

```powershell
node "F:\cherry work\physics-lab\tests\physics.test.js"
```

语法检查：

```powershell
node --check "F:\cherry work\physics-lab\js\physics.js"
node --check "F:\cherry work\physics-lab\js\field-renderer.js"
node --check "F:\cherry work\physics-lab\js\surface-renderer.js"
node --check "F:\cherry work\physics-lab\js\app.js"
```

浏览器端到端测试需要本地服务器保持运行，并使用临时 Playwright 包与本机 Edge：

```powershell
bun x --package @playwright/test playwright test "physics-lab/tests/browser-smoke.spec.js" --reporter=line --workers=1
```

测试覆盖控制台错误、Canvas 非空像素、关键物理对称性、预设与滑杆、三种路径积分、二维/三维切换、测量、帮助、PNG/JSON 导出、测验和 390px 手机布局。
