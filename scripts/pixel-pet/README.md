# pixel-pet


## 两套生成器


| 生成器 | 入口 | 什么时候用 |
|---|---|---|
| **图片转换**（当前在用） | `src/from-image.mjs` | 有现成的角色图。抠掉背景、降采样、限色、再套动画 |
| **程序化绘制**（回退） | `src/build.mjs` | 没有源图时要画一只新角色。逐像素用代码画 |

```bash
# 当前角色：assets/scarf-dog.png（戴红围巾的小白狗）
node scripts/pixel-pet/src/from-image.mjs

# 回退角色：src/maltese.mjs 里程序化画的马尔济斯
node scripts/pixel-pet/src/build.mjs

# 生成到指定目录
node scripts/pixel-pet/src/from-image.mjs path/to/output
```



| 文件 | 用途 |
|---|---|
| `spritesheet.png` | 运行时使用，横向排列的全部帧（1408x64 = 22 帧 x 64px） |
| `pet.json` | 帧索引元数据（每段动画的起始帧、帧数、fps、动作描述） |
| `preview.png` | **校验用**。上排 1:1 真实尺寸（以此判定清晰度），下排 4 倍细节 |

## 换源图（图片转换这条路）

1. 把新图放进 `assets/`，改 `from-image.mjs` 顶部的 `SRC`
2. 跑一次，**先看控制台输出的包围盒和调色板，再看 preview.png**
3. 同步改 `src/renderer/components/ai/PixelPet.tsx` 的 `ANIM_LABEL`（读屏文案）

### 这条路上必须知道的三件事




### 版面参数

| 参数 | 作用 |
|---|---|
| `FIT_MAX_W` / `FIT_MAX_H` | 角色在 32x32 格子里的占位上限（当前 23 x 24） |
| `COVERAGE_MIN` | 一格里前景占比低于此值就整格判透明，用来削掉抗锯齿光晕 |
| `PALETTE_MIN_DIST` | 主色间最小 RGB 距离（当前 30） |
| `PALETTE_MAX_COLORS` | 主色数量上限（当前 10） |


## 加一个角色（程序化绘制这条路）

1. 复制一个角色文件（建议以 `src/maltese.mjs` 为模板）
2. 改 `drawXxx(opt)` 里的图元调用，保持 `outline(cv)` 在五官之前
3. 在 `src/build.mjs` 的 `RECIPES` 里配置帧配方
4. 在 `src/pet.mjs` 的 `ANIMATIONS` 里配置帧数与 fps
5. 在 `src/build.mjs` 顶部换 `drawCharacter` 的导入
6. 跑一次，看 `preview.png`

### 帧配方字段（程序化绘制）

| 字段 | 作用 |
|---|---|
| `bobY` | 身体垂直位移，呼吸用 |
| `capePhase` | 披风/围巾垂片相位，0..5（橘猫角色用 `tailPhase`，摆尾巴） |
| `pose` | 姿态，`null` 坐姿 / `'drag'` 悬空拖拽（见 `maltese.mjs` 的 `POSES`） |
| `swayX` | 整体水平位移，拖拽钟摆用；绘制完成后统一平移画布 |
| `blink` | 闭眼 |
| `squint` | 眯眼 |
| `mark` | 叠加浮层（如问号）的相位 |

### 帧配方字段（图片转换）

| 字段 | 作用 |
|---|---|
| `bobY` | 整体垂直位移 |
| `swayX` | 刚体水平位移 |
| `tilt` | 绕垂直中线的剪切强度，拖拽钟摆用 |
| `mark` | 叠加问号浮层的相位 |


## 加一个动画

1. 在 `src/pet.mjs` 的 `ANIMATIONS` 里加一项（帧数与 fps）
2. 在两个生成器的 `RECIPES` 里加对应的帧数组
3. 在 `src/renderer/components/ai/PixelPet.tsx` 的 `ANIM_META` 里加同名的 `start` / `frames` / `fps`


## 改色



## 已知易错点

- **`overlay()` 原地修改并返回目标。** 拿共享的基准帧去 overlay，浮层会永久烧进基准帧，
- `CELL * SCALE` 必须整除实际渲染尺寸。
- 运行时必须设 `image-rendering: pixelated`。
- `drawQuestionMark` 在 `pet.mjs` 而不是角色模块里 —— 它是通用浮层，两套生成器共用同一份形状。
