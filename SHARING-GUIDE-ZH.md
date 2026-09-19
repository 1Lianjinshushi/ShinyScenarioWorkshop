# 便携版分享、首次启动与更新

## 分享者怎么发

推荐只分享 GitHub Releases 中对应版本的两个文件：

- `ShinyScenarioViewer-Portable-<版本号>.zip`
- `ShinyScenarioViewer-Portable-<版本号>.zip.sha256.txt`

不要把自己的 `translations/`、`exports/`、未清理的监听状态或已下载的剧情专属资源重新打进公开包。正式构建脚本只保留经过清理的资源库／更新日志快照，并移除维护者的未读标记、页游监听状态和资源请求队列。便携包包含字体、播放器 UI、日志头像、交互音效和粒子等启动必需内容；20260919-r13 构建还会带上 Node.js、Playwright／playwright-core，但默认不带 FFmpeg／FFprobe，也不带浏览器。只有发布者完成再分发合规核查并显式使用 `-BundleOfflineRuntime`，构建包才会带上 FFmpeg／FFprobe。具体边界与第三方许可见 `DISTRIBUTION-NOTICE.md`、`THIRD-PARTY-NOTICES.md`。

## 收件人第一次使用

1. 在 [GitHub Releases](https://github.com/1Lianjinshushi/ShinyScenarioWorkshop/releases/latest) 下载最新的 Portable ZIP；不要下载 GitHub 自动生成的 `Source code` 压缩包。
2. 把 ZIP **完整解压**到一个可写文件夹，例如 `D:\ShinyScenarioWorkshop`。不要在压缩包预览窗口内直接运行。
3. 双击 `start-viewer.cmd`。Windows 10/11 不需要另装 Python、Node.js、Playwright 或本地服务器。后台直出优先使用本机安装的 Microsoft Edge，缺少时回退 Google Chrome；两者都没有时启动器会提示。若包内没有 FFmpeg／FFprobe，后台直出还需使用者自行提供；普通播放和编辑不受影响。
4. 浏览器会打开 `http://127.0.0.1:8000/app.html`。若没有自动打开，可手动复制这个地址。
5. 输入剧情编号、从资源库点“填入工坊”，或导入本地 CSV。剧情 JSON 载入后，工坊会立即在后台缓存实际引用的资源。
6. 可以直接点“播放日文原版”“保存 CSV 并播放汉化版”或“编辑模式播放”。播放器会优先使用本地缓存，只下载当前仍缺少的文件。
7. 进度显示“本地缓存就绪”后，该段可离线播放；以后其他剧情引用相同背景、BGM、立绘或 UI 时会直接复用。

首次打开一篇从未缓存的剧情仍需要联网。速度取决于该篇新增资源和资源站连接，但下载结果会保留，不会每次重复等待。

后台直出是试验功能。便携包带齐程序依赖不代表已在其他电脑验证通过；使用它还需要本机浏览器支持 H.264 WebCodecs，并有足够内存和磁盘空间。首次使用请先用短篇剧情测试，检查成片画面、声音和字幕。它不录桌面，但会启动独立无界面浏览器进程。版本更新时不要复制旧版 `tools/` 到新版。

## 校验下载是否完整（可选）

在 PowerShell 中进入下载目录后运行：

```powershell
Get-FileHash .\ShinyScenarioViewer-Portable-<版本号>.zip -Algorithm SHA256
```

把输出与 `.sha256.txt` 中的值比较；两者一致再解压。

## 更新到新版本且保留个人数据

最稳妥的方式是把新版解压到新文件夹，首次启动确认正常后，再从旧版复制以下目录到新版同名位置：

- `assets/`：已经下载的剧情资源缓存；
- `translations/`：自动保存和编辑中的 CSV；
- `speaker/`：发言人译名档案；
- `exports/`：导出的 JSON 等个人成果；
- `monitor/`：仅自己的监听状态；收到的公开便携包默认不含私人监听脚本。

复制时先关闭新旧两个服务器窗口。不要用新版空目录反向覆盖旧版数据。确认新版数据完整后，再自行归档或删除旧文件夹。

## 常见问题

- **长时间黑屏／卡在加载百分比**：先确认 ZIP 已完整解压；关闭旧服务器窗口后重新双击 `start-viewer.cmd`。新版会在本地命中已有文件，并对单项下载设置超时，不会无限等待一项资源。
- **第一次播放仍较慢**：这是当前剧情专属背景、语音、BGM、立绘或视频尚未缓存。保持工坊页打开，等待缓存进度完成；同一文件以后不会重复下载。
- **换版本后又重新下载**：通常是没有把旧版 `assets/` 复制到新版，或直接在 ZIP 临时预览目录运行。
- **端口 8000 被占用**：先关闭旧工坊的命令行窗口；如果已有工坊服务器在运行，再次启动只会打开管理页。
- **资源缺失但剧情仍能打开**：混合模式会让其余已缓存文件照常本地读取，并只对缺失项联网。Support 静态卡图和 Produce 动态卡图仍可用工坊内的专用补缺功能处理。
- **后台直出提示缺少浏览器或编码器**：先检查系统 Edge 或 Chrome 是否存在、能否正常启动；如都未安装，请安装其中一个后重启便携启动器。浏览器即使存在，也可能缺少所需 H.264 WebCodecs 编码能力；此时普通播放／编辑仍可使用，直出不能保证成功。
- **后台直出提示 Node 或 Playwright 缺失**：确认 ZIP 已完整解压，并核对 `tools/` 中对应文件；不要只复制 `start-viewer.cmd` 或从 ZIP 预览窗口启动。
- **后台直出提示 FFmpeg 或 FFprobe 缺失**：默认便携包不包含它们。请自行安装兼容版本，在启动前设置 `SSV_FFMPEG`、`SSV_FFPROBE` 为两个可执行文件的绝对路径；若发布者明确提供已完成许可核查的完整包，则确认 `tools/` 中有两者。

## 许可与来源

播放器核心源自 [AsaHikari/ShinyScenarioViewer](https://github.com/AsaHikari/ShinyScenarioViewer)，本项目按 AGPL-3.0 发布修改源码。完整来源映射见 `UPSTREAM-ATTRIBUTION.md`，资源与字体的再分发边界见 `DISTRIBUTION-NOTICE.md` 和 `THIRD-PARTY-NOTICES.md`。
