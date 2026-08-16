# Shiny Scenario Workshop

> 本项目是 [`AsaHikari/ShinyScenarioViewer`](https://github.com/AsaHikari/ShinyScenarioViewer)
> 的 AGPLv3 修改版。原项目提供 ADV 播放器核心；本项目在其上增加中文剧情工坊、
> CSV 翻译/编辑、资源缓存、完整资源库与更新日志、便携启动等功能。逐项来源说明见
> [`UPSTREAM-ATTRIBUTION.md`](./UPSTREAM-ATTRIBUTION.md)，原项目 README 备份见
> [`README.upstream.md`](./README.upstream.md)。

## 下载与文档

- Windows 便携版与每版 SHA256：请从
  [GitHub Releases](https://github.com/1Lianjinshushi/ShinyScenarioWorkshop/releases/latest)
  下载。
- 图文说明书：[`docs/Quick-Guide-ZH.pdf`](./docs/Quick-Guide-ZH.pdf)。
- 版本维护记录：[`CHANGELOG.md`](./CHANGELOG.md)。

公开源码仓库不提交字体、剧情资源、用户翻译、缓存、导出文件、个人运行状态或
私有页游监听脚本。便携包内固定运行资源的范围及再分发注意事项见
[`DISTRIBUTION-NOTICE.md`](./DISTRIBUTION-NOTICE.md)。

本工程在 ShinyScenarioViewer 播放器上增加了一个本地剧情整理 App，用来完成以下流程：

1. 输入剧情分类与序列号，抓取并留档日文原版 JSON。
2. 按旧提取器规则检索关联剧情，并批量留档命中的日文 JSON。
3. 对照本地 `speaker/speaker.csv`，列出尚未登记的日文发言人。
4. 填写发言人中文名称并保存为长期档案。
5. 选择 `id,name,text,trans` 翻译 CSV，按 ID 与日文原文双重匹配。
6. 合成、保存并下载汉化 JSON，也可直接打开播放器验证。
7. 按需缓存剧情全部资源，切换到离线播放。
8. 自动检查 Support 卡静态演出图；资源站尚未更新时，可绑定本地页游截图作为替代图。
9. 批量导入关联剧情翻译 CSV，并在汉化播放的 End 续播中继续自动套用对应译文。
10. 为缺失的 Produce 动态卡图绑定本地 MP4。
11. 通过 OBS 浏览器源与硬件编码器后台直出 1080p60 视频；旧浏览器直出保留为兼容模式。
<!-- LOCAL_MONITOR_BEGIN -->
12. 直接监听页游资源清单，在新剧情进入游戏资源时提醒，并逐步补齐“角色－卡名－序列号－剧情名”。
<!-- LOCAL_MONITOR_END -->

## 启动

双击：

```text
start-viewer.cmd
```

启动器会打开：

```text
http://127.0.0.1:8000/app.html
```

按 `Ctrl+C` 或关闭服务器窗口即可停止。若已有本 App 的服务器在运行，再次双击只会打开管理页面。也可以使用单行命令启动：

```cmd
py serve-viewer.py
```

## 关联剧情提取

点击“提取关联剧情”后，App 会以输入编号为种子，扫描当前十位号段和下一个十位号段。每个号段顺序探测末位编号，连续两次未命中就停止该号段并跳到下一号段。

例如输入 `200702001` 时：

- 从 `200702001`、`200702002`、`200702003`……依次探测；
- 连续两次落空后跳到 `200702011`、`200702012`……；
- 每个命中项都会自动写入日文 JSON 留档，并显示该段缺失的发言人名称；
- 点击结果中的“载入此段”，可把该段交给单段缓存、翻译与播放流程。

检索优先使用当前所选分类，并兼容旧提取器使用的 `produce_events`、`special_communications`、`game_event_communications` 三类路径。

## 选择支与 End 续播

播放器原生读取连续的 `select` 轨道，把它们聚合成同一个选择画面。每个选项保留自己的 `nextLabel`；选择后由轨道管理器跳到同名 `label`，各分支也可以再通过 `nextLabel: "end"` 汇合。

`202601301` 已实测为三项选择：

- 第一项跳到标签 `1`；
- 第二项跳到标签 `2`；
- 第三项跳到标签 `3`；
- 三条分支最后都跳到公共标签 `end`。

鼠标或触摸可以直接选择，也可按数字键 `1`～`5`。翻译 CSV 中的选择项与普通台词一样写在 `trans` 列；合成器只替换选项文字，不改动 `nextLabel`。

剧情结束后，如果此前在整理工坊执行过“提取关联剧情”或批量导入过关联 CSV，End 画面会列出该组全部关联剧情（不局限于当前编号之后），每页三项并提供翻页；没有记录时，才按“当前号段 + 下一号段、连续两次落空停止”的规则在线查找。按钮会标明编号、来源和轨道数；可点击或按 `1 / 2 / 3` 继续播放，也可返回剧情整理工坊。

整理工坊的播放按钮会新开独立播放标签。End 返回时优先关闭播放标签并聚焦原工坊；浏览器不允许脚本关闭时，才回退到工坊导航。

若当前播放地址带有 `language=cn`，进入后续剧情时会保留汉化语言。End 按钮会同时标明该后续篇是否已存在翻译 CSV；没有 CSV 时暂时回退显示日文，不会中断播放。

## 批量导入翻译 CSV

工坊现在只有“剧情播放、翻译与编辑”和“剧情资源库与更新日志”两个主板块。直接选择单份汉化 CSV 后，工具会从 `id` 列反推剧情编号、根据本地资源库判断剧情分类，并自动抓取和载入对应日文 JSON；无需先在其他区域手动输入编号。

“保存 CSV 并播放汉化版”会先覆盖留档最新 CSV，再直接在当前标签页播放；这个流程不会下载汉化 JSON。“另存汉化 JSON”只在确实需要导出文件时使用。重新选择同一路径的 CSV 也会重新读取，播放器加载翻译时附带无缓存请求，避免继续使用编辑前的译文。

选择“批量导入关联剧情 CSV 并载入首篇”可一次选择多份文件。工具优先读取每份 CSV 的 `id` 列，所以文件名可以是日文标题；分类会先查询随包资源库，再按编号规则判断。导入完成后自动建立关联剧情列表并载入首篇：

```text
300502501.csv → translations/produce_events/300502501.csv
300502502.csv → translations/produce_events/300502502.csv
```

若 CSV 缺少可推断编号的原始轨道 ID，可继续使用纯数字文件名。若一批文件包含不同剧情分类，可使用 `剧情分类__剧情编号.csv`：

```text
special_communications__123456789.csv
```

批量导入会先验证 `id,name,text,trans` 表头和 CSV 可解析性；当文件名也含有编号时，还会校验它是否与 `id` 列推断结果一致，再逐份留档。播放器在 `language=cn` 模式下会直接读取这些 CSV，不要求提前生成汉化 JSON。

## 文件位置

- 日文 JSON 留档：`exports/japanese/<eventType>/<eventId>.json`
- 汉化 JSON 留档：`exports/translated/<eventType>/<eventId>.json`
- 当前翻译 CSV：`translations/<eventType>/<eventId>.csv`
- 发言人名称档案：`speaker/speaker.csv`
- 离线剧情资源：`assets/`
- OBS／浏览器直出视频：`exports/video/<eventType>/<eventId>.mp4`

便携版的这些目录都以解压后的程序文件夹为根目录，不会沿用制作者电脑上的绝对路径；浏览器主动下载的文件则遵循使用者自己的浏览器下载设置。
<!-- LOCAL_MONITOR_BEGIN -->
- 页游更新观察记录：`monitor/game-update-state.json`
<!-- LOCAL_MONITOR_END -->

<!-- LOCAL_MONITOR_BEGIN -->
## 页游剧情更新提醒

页游本身没有可直接下载的“剧情 CSV”。`biuuu/ShinyColors` 的编辑功能是在页游已经解密并载入剧情 JSON 后，把对白轨道转换成 `id,name,text,trans` CSV。因此，最早提醒监听的是比 CSV 更靠前的剧情 JSON 资源；卡片正式实装阶段则继续检查卡片主数据、单话标题、静态卡图和 Produce 动态卡图。

在“剧情资源库与更新日志”板块点击“安装／更新监听脚本”，交给 Tampermonkey 等用户脚本管理器安装，然后打开页游：

1. 脚本从页游运行时找到 `asset-map.json` 管理模块，读取已解密的资源路径清单；
2. 第一次扫描只建立本机基线，不会把所有旧剧情误报成更新；
3. 以后每 10 分钟比较一次，也可从用户脚本菜单选择“立即检查剧情与卡片实装”；
4. 发现新路径时显示系统通知，并把结果同步到“剧情资源库与更新日志”；
5. `produce_events` 的九位编号可以立即推断 Produce／Support、角色、卡片序号与剧情话数；
6. 卡名和剧情名不能从文件路径反推。页游开放相应卡片主数据后，监听脚本会从官方 `userIdols`／`userSupportIdols` 响应补齐名称；
7. 页游资源清单出现新的静态卡图或 Produce 动态卡图后，监听脚本会用当前页游会话解析资源根地址、加密路径与版本散列，直接下载并传给本地工坊；
8. 工坊同时轮询 `api.shinycolors.moe` 的近期卡片与详情接口，只用于补齐卡名、单话标题与资源身份，不会因为资料补全再次标为未读；
9. 更新日志的日期只由剧情 JSON 首次发现决定。静态卡图、Produce 动态卡图、卡名或单话标题后续实装，仅把原日期下整卡的“页游实装状态”更新为“已实装”，不另建日期或红点。

所以维护前若只提前上传了资源文件，最早一条提醒可能显示为：

```text
铃木羽那 - Produce #010 - 202701011 - 剧情 #11（待主数据）
```

待主数据开放后会自动变为完整卡名与剧情名。存在待实装卡时，脚本会在每天 23:02 增加一次专项检查；若当时浏览器或页游标签已关闭，则在下次打开页游时补查。官方资源直取要求页游标签和本地工坊同时运行，标签不必位于前台，但需要把 `shinycolors.enza.fun` 加入浏览器“永不休眠”名单，避免后台标签被节能模式冻结。浏览器完全退出后，工坊仍能检查 `shinycolors.moe`，却无法代替登录会话读取页游官方资源。
<!-- LOCAL_MONITOR_END -->

旧播放器的 `D:\ShinyColorsDB-EventViewer-main\speaker\speaker.csv` 已作为初始发言人档案复制进本工程；后续编辑只写本工程副本，不会改动旧播放器。

## 字体与音频

- 中文正文与中文发言人：`方正FW轻吟体 简 B`（`FZFWQINGYINTIJWB.TTF`），正文 22 px，发言人 25 px。
- 日文正文与日文发言人：`FOT-Humming Pro B`（`FOT-HummingPro-B.OTF`），正文 22 px，发言人 25 px。
- 播放画布会按窗口大小与系统 DPI 自动提高内部渲染分辨率（最高 2.5 倍），避免在 2K/4K 或 Windows 缩放环境中把 1136×640 画面直接放大造成的额外模糊；背景原图的细节仍以素材自身分辨率为上限。
- BGM、语音、音效使用独立播放实例；切换语音不会停止 BGM，同一 BGM 的重复控制指令也不会重启曲目。
- 动态卡图视频只对电影画面层执行约 0.35 秒淡入和片尾淡出；视频、随片 SE 与原 JSON 轨道时间不变，电影结束后才继续处理下一条剧情轨道。

## OBS 后台视频直出

> 当前状态：暂停研发。工坊界面已隐藏两种直出按钮，本地后端也会拒绝新建录制任务。普通播放、编辑模式、CSV 合成与资源管理不受影响；相关实现暂时保留，待后台音画时序重新验证后再开放。

工坊默认使用 OBS 直出，原来的 MediaRecorder 方案放在“兼容直出（浏览器）”按钮中。OBS 方案不会在 Edge 隐藏标签页中录屏：本地服务会临时创建一个 1920×1080、60 fps 的 OBS 浏览器源，等待剧情 JSON、字体、贴图和播放器图层全部预载完成后再启动录制；剧情 End 后自动停止录制、恢复原场景、原分辨率和原录制目录，并把结果整理到 `exports/video/`。

首次使用只需配置一次 OBS：

1. OBS 31 已内置 WebSocket；在“工具 → WebSocket 服务器设置”启用服务器，默认端口为 `4455`；
2. 在“设置 → 音频 → 全局音频设备”中禁用“桌面音频”和全部“麦克风/Aux”；
3. 在“设置 → 输出 → 录制”中选择 NVIDIA NVENC 编码器；
4. 回到工坊填写 WebSocket 密码并点击“检测 OBS”。密码只保留在当前页面和本地服务的活动连接内，不写入工程文件；
5. 点击“OBS 直出 1080p60”。OBS 只负责 1080p60 画面与 NVENC 编码；播放器把 BGM／语音／SE 的内部混音另存为轻量 Opus 音轨，且不向耳机外放，剧情结束后再自动合并进成片。这样前台使用 Edge 或切换窗口不会经过 OBS 浏览器源那条容易受调度影响的音频转发链路。

直出开始前若检测到 OBS 正在录制、直播，或仍启用了桌面音频／麦克风，工坊会拒绝改动场景。OBS 使用当前配置文件的录制编码器；检测结果会明确标出是否为 NVENC。结束后工坊会等待 OBS 文件完全写稳，再用 FFmpeg 保留原视频码流并把独立音轨编码为 48 kHz／320 kbps AAC；画面不会二次编码。若 OBS 报告渲染或输出跳帧，工坊会在完成提示中明确警告。

## 资源来源与缓存

在线播放会从 `https://service.sc-viewer.top/custom/` 按剧情实际引用加载资源。点击“缓存完整资源”后，App 会把以下内容写入本地 `assets/`：

- 剧情 JSON；
- 背景、前景、立绘 Spine 及其 atlas/贴图；
- BGM、语音、SE、still、movie 与静态卡图；
- 对话框、日志头像与选择框；
- 播放器通用 UI、点击音效及粒子资源。

`produce_events_202101611.zip` 含 53 个剧情资源和 3 个播放器脚本。App 对 `202101611` 推导出的 53 个剧情资源路径与 ZIP 一致；完整缓存另增加 16 个播放器通用资源，共 69 项。

`202701002` 实测完整缓存 73 项，其中包含 `1040270060` 的卡面动画 MP4、静态卡图 JPG 与专用音效 M4A。播放器可正常完成动画、静态卡图承接、白幕淡入淡出、卡图上对白和退场回到背景。

`202601301` 实测完整缓存 85 项，三项选择支均可显示并跳转到正确轨道。

### Support 卡静态图补缺

载入剧情后，App 会单独识别 `stillType: "support_idols"` 的静态卡图引用，依次执行：

1. 检查 `assets/images/content/support_idols/card/<stillId>.jpg` 是否已有本地文件；
2. 本地没有时，先尝试原播放器资源站；
3. 原资源站尚未更新时，按同一卡图 ID 从 `https://cf-static.shinycolors.moe/` 自动补取并缓存；
4. 两个来源都没有时，显示缺失的卡图 ID、目标路径与“选择截图”按钮；
5. 选择 JPG、PNG 或 WebP 后，截图会等比例居中缩放为 1136×640 JPEG，并保存到准确的演出路径；
6. 即使剧情其余资源仍使用在线播放，播放器也会优先采用这张本地 Support 卡图。

例如 `300402702` 引用 `2040040190`，对应路径为：

```text
assets/images/content/support_idols/card/2040040190.jpg
```

这项替代只对 Support 卡静态图生效。`stillType: "idols"` 的 Produce 卡图，以及 MP4 动态卡图不会被自动替换。

### Produce 卡动态视频补缺

剧情包含 `movie: "<卡图ID>"` 时，App 会显示动态卡图面板和准确目标路径：

```text
assets/movies/idols/card/<卡图ID>.mp4
```

可点击面板中的链接打开 `shinycolors.moe` 对应视频，再用“选择 MP4”绑定下载好的文件。在线播放时只把这一项改为本地 MP4，背景、立绘、语音等其余资源仍可从远端读取。单个上传文件上限为 120 MB。

动态卡图常另带同 ID 的 `se` 音效轨道；MP4 替换只负责视频，音效仍按剧情 JSON 中的 `sounds/se/event/<ID>.m4a` 单独加载。

## 直接打开播放器

在线播放：

```text
http://127.0.0.1:8000/?eventType=produce_events&eventId=202701011&language=cn&source=remote
```

资源已缓存后离线播放：

```text
http://127.0.0.1:8000/?eventType=produce_events&eventId=202701011&language=cn&source=local
```

播放器保留 `source=auto`（本地优先）、`source=remote` 和 `source=local` 三种资源模式。

