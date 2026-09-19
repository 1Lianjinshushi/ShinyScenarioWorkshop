"""Build the standalone Chinese offline-export guide for the portable release."""

from __future__ import annotations

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import simpleSplit
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    HRFlowable,
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "pdf" / "ShinyScenarioWorkshop-Offline-Export-Guide.pdf"
FONT = ROOT / "fonts" / "FZFWQINGYINTIJWB.TTF"
FONT_TITLE = ROOT / "fonts" / "AlimamaShuHeiTi.ttf"

pdfmetrics.registerFont(TTFont("WorkshopBody", str(FONT)))
pdfmetrics.registerFont(TTFont("WorkshopTitle", str(FONT_TITLE)))
pdfmetrics.registerFontFamily("WorkshopBody", normal="WorkshopBody", bold="WorkshopTitle")

INK = colors.HexColor("#242330")
MUTED = colors.HexColor("#625D6B")
PINK = colors.HexColor("#D14B83")
PINK_PALE = colors.HexColor("#FBEAF2")
LILAC = colors.HexColor("#EEEAF5")
GREEN = colors.HexColor("#D9F0E9")
WHITE = colors.white
LINE = colors.HexColor("#DDD7E2")


def style(name: str, **kwargs) -> ParagraphStyle:
    base = dict(
        fontName="WorkshopBody",
        fontSize=10.2,
        leading=16.4,
        textColor=INK,
        spaceAfter=7,
        alignment=TA_LEFT,
        wordWrap="CJK",
    )
    base.update(kwargs)
    return ParagraphStyle(name, **base)


ST = {
    "eyebrow": style("eyebrow", fontName="WorkshopTitle", fontSize=10, leading=15, textColor=PINK, spaceAfter=8),
    "title": style("title", fontName="WorkshopTitle", fontSize=26, leading=34, spaceAfter=10),
    "sub": style("sub", fontSize=12, leading=19, textColor=MUTED, spaceAfter=17),
    "section": style("section", fontName="WorkshopTitle", fontSize=16, leading=22, spaceBefore=4, spaceAfter=11),
    "smallhead": style("smallhead", fontName="WorkshopTitle", fontSize=11, leading=16, spaceAfter=5),
    "body": style("body"),
    "muted": style("muted", fontSize=9.5, leading=15, textColor=MUTED),
    "tiny": style("tiny", fontSize=8.6, leading=13, textColor=MUTED, spaceAfter=4),
    "step": style("step", fontName="WorkshopTitle", fontSize=10.8, leading=16, textColor=PINK, spaceAfter=4),
    "code": style("code", fontName="Courier", fontSize=8.8, leading=13.8, textColor=INK, spaceAfter=0, wordWrap=None),
    "center": style("center", fontName="WorkshopTitle", fontSize=9.4, leading=15, alignment=TA_CENTER, spaceAfter=0),
}


def p(text: str, kind: str = "body") -> Paragraph:
    return Paragraph(text, ST[kind])


def box(content: list, bg=LILAC, pad=12) -> Table:
    table = Table([[content]], colWidths=[500])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), bg),
                ("BOX", (0, 0), (-1, -1), 0.55, LINE),
                ("LEFTPADDING", (0, 0), (-1, -1), pad),
                ("RIGHTPADDING", (0, 0), (-1, -1), pad),
                ("TOPPADDING", (0, 0), (-1, -1), pad),
                ("BOTTOMPADDING", (0, 0), (-1, -1), pad),
            ]
        )
    )
    return table


def step(n: int, title: str, detail: str) -> list:
    return [
        p(f"{n:02d}  {title}", "step"),
        p(detail),
        Spacer(1, 5),
    ]


def page(canvas, doc):
    canvas.saveState()
    width, height = A4
    canvas.setFillColor(INK)
    canvas.rect(0, height - 34, width, 34, fill=1, stroke=0)
    canvas.setFillColor(WHITE)
    canvas.setFont("WorkshopTitle", 10)
    canvas.drawString(46, height - 23, "闪耀色彩剧情工坊  /  后台直出")
    canvas.setStrokeColor(LINE)
    canvas.line(46, 40, width - 46, 40)
    canvas.setFillColor(MUTED)
    canvas.setFont("WorkshopBody", 8.6)
    canvas.drawString(46, 25, "直出功能使用指南  ·  2026-09-19")
    canvas.drawRightString(width - 46, 25, f"{doc.page}")
    canvas.restoreState()


story = []
story += [
    Spacer(1, 12),
    p("便携版专用  ·  Windows 10 / 11", "eyebrow"),
    p("后台直出使用指南", "title"),
    p("从准备 FFmpeg 到排队、查看进度、找到 MP4。直出在独立后台处理，不需要 OBS，也不会录制桌面或系统声音。", "sub"),
    box(
        [
            p("开始前，确认这四项", "smallhead"),
            p("① 已完整解压工坊 ZIP，使用 <font color='#B72F68'>start-viewer.cmd</font> 启动；② 电脑装有 Microsoft Edge 或 Google Chrome；③ 已准备 <font color='#B72F68'>ffmpeg.exe</font> 和 <font color='#B72F68'>ffprobe.exe</font>；④ 剧情资源可获取，磁盘与内存有余量。"),
        ],
        PINK_PALE,
    ),
    Spacer(1, 17),
    p("最短操作路线", "section"),
]
story += step(1, "配置两个工具", "把下载包中的 ffmpeg.exe、ffprobe.exe 放入工坊的 tools 文件夹；第 2 页有逐步说明。")
story += step(2, "载入要出的剧情", "打开工坊，输入剧情编号、从资源库填入，或导入已有汉化 CSV。先确认剧情能正常载入。")
story += step(3, "加入并选择待直出项", "在“后台直出”中加入当前汉化／日文剧情；批量 CSV 导入后检查自动生成的待直出列表。加入队列不会立刻开工。")
story += step(4, "点“开始导出”", "勾选想出的项目再启动。轻量进度窗显示阶段和进度；完成后点“打开保存目录”。")
story += [
    box([p("提醒：普通剧情播放和编辑不需要 FFmpeg；只有后台直出 MP4 才需要这两个工具。便携包已带 Node.js 与 Playwright，不用再单独安装。", "muted")], GREEN),
    PageBreak(),
]

story += [
    p("01 / 环境准备", "eyebrow"),
    p("下载并让工坊找到 FFmpeg", "title"),
    p("推荐按以下本地配置，不改系统环境变量，也不要求管理员权限。", "sub"),
]
story += step(1, "从官方入口进入 Windows 构建页", "打开 <link href='https://ffmpeg.org/download.html' color='#B72F68'>ffmpeg.org/download.html</link>，在 “Windows EXE Files” 下选 gyan.dev。下载其 <font color='#B72F68'>release essentials ZIP</font>，不要下载源码包。这个构建包包含 ffmpeg 和 ffprobe。")
story += step(2, "解压并找到两个文件", "在下载包解压后的 <font color='#B72F68'>bin</font> 文件夹，找到 ffmpeg.exe 与 ffprobe.exe。把这两个文件复制进已解压工坊的 <font color='#B72F68'>tools</font> 文件夹，和 node.exe 放在同一层。无需复制 ffplay.exe。")
story += [
    box([p("目录示意", "smallhead"), p("ShinyScenarioWorkshop / tools / node.exe<br/>ShinyScenarioWorkshop / tools / ffmpeg.exe<br/>ShinyScenarioWorkshop / tools / ffprobe.exe", "code")], LILAC),
    Spacer(1, 10),
]
story += step(3, "重新启动并验证", "先关闭旧的工坊服务窗口，再双击 start-viewer.cmd。在工坊的“后台直出”区确认状态为“可用”或“准备就绪”。也可在工坊根目录打开 PowerShell，运行下面两行，均应显示版本信息：")
story += [
    box([p("&amp; .\\tools\\ffmpeg.exe -version<br/>&amp; .\\tools\\ffprobe.exe -version", "code")], colors.HexColor("#F6F4F8")),
    Spacer(1, 10),
    p("若不想复制进 tools", "smallhead"),
    p("可在启动工坊的<font color='#B72F68'>同一个 PowerShell 窗口</font>先设置两个绝对路径，然后从该窗口运行启动器。例如："),
    box([p("$env:SSV_FFMPEG='D:\\ffmpeg\\bin\\ffmpeg.exe'<br/>$env:SSV_FFPROBE='D:\\ffmpeg\\bin\\ffprobe.exe'<br/>&amp; 'D:\\ShinyScenarioWorkshop\\start-viewer.cmd'", "code")], colors.HexColor("#F6F4F8")),
    Spacer(1, 9),
    box([p("注意：只把 FFmpeg 加入 Windows PATH、使全局 ffmpeg -version 成功，<font color='#B72F68'>不等于工坊一定能找到它</font>。请用上面两种方法之一。不要把自己补入 FFmpeg 的包重新公开分发；当前公开包默认不含它。", "muted")], PINK_PALE),
    PageBreak(),
]

story += [
    p("02 / 工坊操作", "eyebrow"),
    p("从剧情到待直出列表", "title"),
    p("队列以“加入时”的内容做快照；后续编辑不会反向改动已加入的项目。", "sub"),
]
story += step(1, "启动并载入剧情", "双击 start-viewer.cmd，打开本地工坊。输入剧情编号、从资源库选剧情，或导入本地汉化 CSV。想直出汉化版，先确认对应 CSV 已导入且文本无误。")
story += step(2, "查看后台直出状态", "展开“后台直出”。若状态不可用，先检查工具与浏览器；资源未齐的剧情可以入队，但预检会阻止生成缺帧视频。发言人译名未补全只提示，不因此阻止加入。")
story += step(3, "加入多个项目", "点“当前汉化加入队列”或“当前日文加入队列”。批量导入关联 CSV 后，对应内容会自动列入待直出列表；在那里逐项检查剧情、语言和命名。需要时使用全选或单项移除。")
story += [
    box([p("加入队列  →  勾选要出的项目  →  开始导出  →  查看进度窗  →  打开保存目录", "center")], GREEN),
    Spacer(1, 15),
]
story += step(4, "勾选后才开始", "“加入”只保存快照，不会马上渲染。待列表整理好，勾选本次需要的项目，再点“开始导出”。任务按队列顺序逐项处理；本地服务和电脑需保持运行，避免休眠。")
story += step(5, "在轻量窗口看进度", "进度窗显示准备资源、画面生成、音频处理、封装与检查。画面百分比是剧情节点覆盖进度，不是精确剩余时间。关掉进度窗不会停止任务；可回到工坊重新查看。")
story += [
    box([p("选择支剧情：完整导出会按照播放器的分支顺序逐条输出，选项间保留等待与转场；末句结束后额外停留约 2 秒。", "muted")], LILAC),
    PageBreak(),
]

story += [
    p("03 / 结果与排障", "eyebrow"),
    p("找到成片，处理暂停", "title"),
]
story += [
    p("保存位置", "section"),
    p("点直出区或进度窗中的“打开保存目录”，会打开统一的 <font color='#B72F68'>exports/offline-videos</font>。其下按卡名或篇章名建文件夹，再按子剧情标题保存 MP4；日文原版会带【日文】标识。同名再次导出会加 (2)、(3)，不会覆盖旧片。"),
    box([p("exports / offline-videos / 路加S卡・【she sees】 / 子剧情标题.mp4", "body")], LILAC),
    Spacer(1, 13),
    p("出现提示时怎么做", "section"),
]

problems = [
    ("FFmpeg/FFprobe 缺失", "确认 tools 文件夹中两者都在；或者在启动前设置 SSV_FFMPEG、SSV_FFPROBE 绝对路径，然后重启工坊服务。"),
    ("内存不足，已暂停", "关闭占内存的程序或调低直出内存上限，再点进度窗“继续任务”。系统会重新采样与复检；仍不安全就继续暂停，不跳过此项。"),
    ("资源缺失、磁盘不足", "这是失败而非内存暂停。先补齐剧情资源或释放磁盘空间，然后重新加入。不会为了出片而生成缺资源视频。"),
    ("浏览器 / 编码器不可用", "安装或更新 Edge/Chrome，并用一篇短剧情测试。浏览器还需支持 H.264 WebCodecs；不同电脑配置无法仅凭解压包保证。"),
]
for label, detail in problems:
    story += [p(label, "smallhead"), p(detail, "muted"), Spacer(1, 4)]

story += [
    HRFlowable(width="100%", color=LINE, thickness=0.7, spaceBefore=4, spaceAfter=11),
    p("延伸阅读与下载入口", "smallhead"),
    p("FFmpeg 官方下载页：<link href='https://ffmpeg.org/download.html' color='#B72F68'>https://ffmpeg.org/download.html</link><br/>官方页面列出的 gyan.dev Windows 构建：<link href='https://www.gyan.dev/ffmpeg/builds/' color='#B72F68'>https://www.gyan.dev/ffmpeg/builds/</link><br/>B 站 Windows 图文教程：<link href='https://www.bilibili.com/read/cv33507583/' color='#B72F68'>https://www.bilibili.com/read/cv33507583/</link>", "tiny"),
    p("图文教程主要介绍系统 PATH；本工坊请以第 2 页的 tools 双文件方式或两个 SSV_* 路径为准。", "tiny"),
]

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
doc = SimpleDocTemplate(
    str(OUTPUT),
    pagesize=A4,
    rightMargin=47,
    leftMargin=47,
    topMargin=61,
    bottomMargin=55,
    title="闪耀色彩剧情工坊 - 后台直出使用指南",
    author="ShinyScenarioWorkshop",
    subject="FFmpeg/FFprobe 配置、后台直出队列与排障",
)
doc.build(story, onFirstPage=page, onLaterPages=page)
print(OUTPUT)
