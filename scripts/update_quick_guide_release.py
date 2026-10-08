"""Refresh the r17 operation pages and append the release maintenance log.

Keep the original maintenance pages 5-8; replace the four operation pages and
the release appendix so old layout screenshots do not mislead new users.
"""

from __future__ import annotations

import os
from io import BytesIO
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "pdf" / "ShinyScenarioWorkshop-Quick-Guide.pdf"
APPENDIX = ROOT / "tmp" / "pdfs" / "quick-guide-r17-appendix.pdf"
TEMP_OUTPUT = ROOT / "tmp" / "pdfs" / "quick-guide-r17-combined.pdf"
BASE_PAGE_COUNT = 8

FONT_BODY_PATH = ROOT / "fonts" / "FZFWQINGYINTIJWB.TTF"
FONT_TITLE_PATH = ROOT / "fonts" / "AlimamaShuHeiTi.ttf"
FONT_BODY = "WorkshopBody"
FONT_TITLE = "WorkshopTitle"

INK = colors.HexColor("#292632")
MUTED = colors.HexColor("#6A6370")
PINK = colors.HexColor("#D14B83")
PINK_PALE = colors.HexColor("#FBEAF2")
LINE = colors.HexColor("#DED7E1")


def register_fonts() -> None:
    pdfmetrics.registerFont(TTFont(FONT_BODY, str(FONT_BODY_PATH)))
    pdfmetrics.registerFont(TTFont(FONT_TITLE, str(FONT_TITLE_PATH)))


def header(page: canvas.Canvas, page_number: int, title: str, subtitle: str) -> float:
    width, height = A4
    page.setFillColor(PINK)
    page.roundRect(42, height - 80, width - 84, 34, 10, fill=1, stroke=0)
    page.setFillColor(colors.white)
    page.setFont(FONT_TITLE, 15)
    page.drawString(58, height - 69, title)
    page.setFillColor(MUTED)
    page.setFont(FONT_BODY, 9.5)
    page.drawString(44, height - 102, subtitle)
    page.setStrokeColor(LINE)
    page.line(44, height - 112, width - 44, height - 112)
    page.setFillColor(MUTED)
    page.setFont(FONT_BODY, 8.5)
    page.drawRightString(width - 44, 28, f"闪耀色彩剧情工坊  |  便携版说明  |  {page_number}")
    return height - 140


def wrapped_lines(text: str, font: str, size: float, width: float) -> list[str]:
    lines: list[str] = []
    current = ""
    for char in text:
        candidate = current + char
        if current and pdfmetrics.stringWidth(candidate, font, size) > width:
            lines.append(current)
            current = char
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines


def section(page: canvas.Canvas, y: float, release: str, date: str, bullets: list[str]) -> float:
    width, _ = A4
    page.setFillColor(PINK_PALE)
    page.roundRect(44, y - 29, width - 88, 30, 8, fill=1, stroke=0)
    page.setFillColor(PINK)
    page.setFont(FONT_TITLE, 12.2)
    page.drawString(57, y - 19, release)
    page.setFillColor(MUTED)
    page.setFont(FONT_BODY, 8.8)
    page.drawRightString(width - 57, y - 18, date)
    y -= 48
    for bullet in bullets:
        lines = wrapped_lines(bullet, FONT_BODY, 9.2, width - 126)
        page.setFillColor(PINK)
        page.circle(58, y + 3, 2.2, fill=1, stroke=0)
        page.setFillColor(INK)
        page.setFont(FONT_BODY, 9.2)
        for line in lines:
            page.drawString(72, y, line)
            y -= 15
        y -= 5
    if y < 60:
        raise RuntimeError(f"Guide section overflows page: {release}")
    return y - 8


def build_appendix() -> None:
    APPENDIX.parent.mkdir(parents=True, exist_ok=True)
    page = canvas.Canvas(str(APPENDIX), pagesize=A4, pageCompression=1)

    y = header(page, 9, "维护日志（续）", "Shiny Scenario Workshop Portable Edition")
    y = section(page, y, "20260919-r14", "2026-09-19", [
        "后台直出区增加 FFmpeg 图文安装入口，并明确 FFmpeg 与 FFprobe 需同时可用。",
        "新增独立的后台直出 PDF 教程，覆盖安装、队列、进度、内存暂停与故障排查。",
    ])
    section(page, y, "20260929-r15（未单独发布）", "2026-09-29", [
        "完整分享版恢复页游监听脚本和安装入口，同时清除发布者的个人监听状态。",
        "便携包内置 Node.js、Playwright、字体与播放器启动必需资源；FFmpeg／FFprobe 仍由使用者配置。",
    ])
    page.showPage()

    y = header(page, 10, "20261007-r16 更新", "完整分享版：监听安全、卡资源匹配与单选项直出")
    y = section(page, y, "页游监听器 0.9.2", "安全修复", [
        "不再主动调用页游认证卡片接口，不再改写 Array.prototype.push，不再包装会话更新请求。",
        "监听脚本以 UTF-8 JavaScript 提供。Chrome 如只显示源码，说明脚本管理器未接管。",
        "请安装并启用 Tampermonkey／Violentmonkey，再检查“允许用户脚本”。",
    ])
    y = section(page, y, "资源库与后台直出", "功能更新", [
        "新资源可按页游实际卡 ID 精确关联卡名、子剧情标题、静态卡图与 Produce 动态卡图。",
        "资源库可打开匹配原文件，并将用户选择的 Produce MP4 载入本地缓存。",
        "含一个选项的剧情现可直出：选项停留 3 秒后自动选择，不播放返回选择节点的绿幕转场。",
        "可选日志装饰帧缺失不再阻断从未打开日志的剧情；实际可见对话框仍严格校验。",
    ])
    page.setFillColor(PINK_PALE)
    page.roundRect(44, y - 54, A4[0] - 88, 52, 8, fill=1, stroke=0)
    page.setFillColor(INK)
    page.setFont(FONT_BODY, 9.1)
    page.drawString(58, y - 21, "分享版仍不内置 FFmpeg／FFprobe，但包含 Node.js、Playwright、字体、通用 UI 与日志头像。")
    page.drawString(58, y - 39, "后台直出的完整配置步骤请查看 Offline-Export-Guide-ZH.pdf。")
    page.showPage()
    y = header(page, 11, "20261009-r17 更新", "四个操作入口、双线高速直出与自动成片检查")
    y = section(page, y, "操作界面分层", "布局", [
        "剧情资源库、翻译工作台、后台直出、维护与帮助分开显示；资源库另分更新日志和完整目录。",
        "切换入口保留剧情、CSV、目录展开及任务状态。运行／暂停任务置顶，待导出列表单独显示。",
        "批量 CSV 继续复用同一导入流程；加入或勾选不自动开始，不再弹出进度小窗。",
    ])
    y = section(page, y, "速度与稳定性", "直出", [
        "可选低负载／高速及单线／双线，最多两篇并行。高速使用有界编码流水线，仍保留内存安全暂停。",
        "跨任务复用经校验的已解码素材，磁盘缓存最多 2 GiB；Windows 内存采样复用隐藏进程。",
        "修复一篇封装／检查长期占用共享分配锁、让另一篇音频处理一直等待的问题。",
        "音频固定以独立 48 kHz 上下文解码，不受系统播放设备采样率影响。",
    ])
    section(page, y, "自动检查与完整分享", "交付", [
        "正常任务快速检查；生成／混音／封装中内存暂停才升级完整解码。保留仅快速与始终完整。",
        "不降低成片分辨率、帧率，不改变剧情节奏；检查不能替代人工演出与音画同步验收。",
        "两份 PDF 与分享说明同步新版入口；通用资源、字体、Node.js、Playwright 随包，FFmpeg／FFprobe 自行配置。",
    ])
    page.save()


def combine() -> None:
    source = PdfReader(str(OUTPUT))
    if len(source.pages) < BASE_PAGE_COUNT:
        raise RuntimeError(f"Quick guide has only {len(source.pages)} pages; expected at least {BASE_PAGE_COUNT}")
    appendix = PdfReader(str(APPENDIX))
    writer = PdfWriter()
    corrections = BytesIO()
    overlay = canvas.Canvas(corrections, pagesize=A4)
    y = header(overlay, 1, "闪耀色彩剧情工坊 · 快速开始", "完整分享版 20261009-r17  /  Windows 10、11")
    y = section(overlay, y, "从解压到打开", "首次使用", [
        "从 GitHub Releases 下载 Portable ZIP 和校验文件，不要下载自动生成的 Source code 压缩包。",
        "完整解压到可写目录，再双击 start-viewer.cmd；不要在 ZIP 预览里直接运行。",
        "浏览器打开 http://127.0.0.1:8000/app.html。启动后的服务窗口需保持运行。",
    ])
    y = section(overlay, y, "四个入口，各做一件事", "左侧导航", [
        "剧情资源库：更新日志、完整目录、整组 CSV、卡图与动态资源入口。",
        "翻译工作台：输入剧情编号、导入 CSV、补发言人译名、编辑和播放。",
        "后台直出：待导出列表、运行进度、速度／双线／检查方式及保存目录。",
        "维护与帮助：监听脚本、名称补全、资源维护和 PDF 教程。",
        "切换入口不会清空当前剧情或 CSV；首次进入翻译工作台，之后记住上次位置。",
    ])
    section(overlay, y, "包内有什么", "依赖边界", [
        "内置字体、通用 UI、日志头像、交互音效以及 Node.js／Playwright；无须另装 Python。",
        "普通播放和编辑不需要 FFmpeg。后台直出另需 Edge 或 Chrome，以及 FFmpeg 和 FFprobe。",
        "剧情专属图片、语音、模型、视频按需获取；首次加载仍需联网，缓存可复用。",
    ])
    overlay.showPage()
    y = header(overlay, 2, "翻译工作台 · 导入、编辑与播放", "先载入对应剧情，再合成中文；保留 CSV 与发言人档案")
    y = section(overlay, y, "载入剧情", "三种入口", [
        "在翻译工作台输入剧情编号，或从资源库点击“填入工坊”。本地 JSON 也可载入。",
        "已有汉化时导入单篇 CSV；批量导入会读取各篇编号，获取对应原版并建立关联列表。",
        "全局译者输入项用于导出翻译／校订署名；发言人区只列出尚未留档的名称。",
    ])
    y = section(overlay, y, "编辑与播放", "对照检查", [
        "载入后可播放日文原版、保存 CSV 并播放汉化版，或进入编辑模式边看画面边修订。",
        "编辑中的自动保存副本位于 translations；请另外保存重要定稿，并核对导出的 CSV。",
        "未实装卡图可在编辑模式跳过；正式播放与后台直出仍校验必要资源，不生成缺资源成片。",
        "资源缺口和修复工具放在维护与帮助；卡图／动态卡图可使用对应的手动载入入口。",
    ])
    section(overlay, y, "批量 CSV 与直出联动", "不会自动开工", [
        "批量导入 CSV 后，成功合成的汉化快照会加入待导出列表；原有待导出项保留。",
        "发言人译名未齐会提示但不拦截；必要资源仍无法取得时会阻止导出。",
        "后续改译文不会改变已加入的快照。需要最新译文时，移除旧待导出项再加入。",
    ])
    overlay.showPage()
    y = header(overlay, 3, "剧情资源库与页游监听", "完整分享版包含监听脚本；安装需浏览器用户脚本管理器")
    y = section(overlay, y, "首次启用", "自己的浏览器与账号", [
        "先安装并启用 Tampermonkey 或 Violentmonkey。Chrome 如有“允许用户脚本”选项，请一并打开。",
        "在维护与帮助点击“安装／更新监听脚本”，由脚本管理器确认，再点击“打开页游并检查”。",
        "若看到代码文本而非安装页，是脚本管理器未接管；不是下载损坏，也不能直接把代码页当作已安装。",
    ])
    y = section(overlay, y, "名称补全与资源检查", "保持原更新位置", [
        "资源库支持按角色、卡片、活动与育成篇章查看，并可整组下载 CSV。",
        "卡名和逐话标题按实际卡号与剧情 ID 精确对应；“补全库名称”不会把旧剧情重新列成新更新。",
        "静态卡图与动态卡图单独展示。动态 MP4 可手动下载、导入；卡片资源实装后更新原位置状态。",
    ])
    section(overlay, y, "运行与依赖", "不含个人账号和翻译", [
        "页游监听需工坊服务和页游标签同时运行；不要让浏览器休眠或丢弃页游标签。",
        "包内已有字体、通用 UI、日志头像、交互音效和 Node.js／Playwright；剧情专属资源按需下载。",
        "后台直出仍需自己配置 FFmpeg 和 FFprobe。具体步骤见包内独立的直出 PDF。",
        "脚本不主动调用页游认证卡片接口。若仍遇到 1010，会话错误应先停用监听脚本对照复现，不能只凭报错断定原因。",
    ])
    overlay.showPage()
    y = header(overlay, 4, "后台直出与版本更新", "安装细节见独立的 Offline-Export-Guide-ZH.pdf")
    y = section(overlay, y, "准备、勾选、开始", "1080p60", [
        "把自己下载的 ffmpeg.exe 和 ffprobe.exe 放进 tools，与 node.exe 同层；也可用 SSV_FFMPEG／SSV_FFPROBE 指定路径。仅配置 PATH 不保证可用。",
        "从后台直出加入当前汉化／日文或本地 JSON；批量 CSV 也可同步加入。整理并勾选后才点开始。",
        "默认低负载；空闲时可选择高速和双线。最多两篇并行，不保证每台电脑都能成倍提速。",
        "直接在工坊看进度，不自动弹小窗。关网页不停止任务，但不能退出本地服务或让电脑休眠。",
    ])
    y = section(overlay, y, "暂停、检查与保存", "安全边界", [
        "内存安全预算触发时保留任务并暂停；清理内存后点“继续任务”重新检查。资源缺失等错误仍失败。",
        "默认自动检查：正常任务快速检查；生成／混音／封装中出现内存暂停时升级完整解码。技术检查不能代替人工看成片。",
        "打开保存目录直达 exports/offline-videos；按卡名／篇章建文件夹、按子剧情名保存。同名加序号，不覆盖旧片。",
    ])
    section(overlay, y, "升级与来源", "保留自己的成果", [
        "先等全部任务结束再关闭旧服务。新版解压到新目录；迁移 translations、speaker、exports 和自己的 monitor。",
        "合并 assets 时保留新版已有文件，只补缺少的缓存。不要覆盖新版程序、字体或整个 tools；FFmpeg 两文件可单独迁移。",
        "播放器基础源自あさひかり（AsaHikari）的 ShinyScenarioViewer；本项目按 AGPL-3.0 提供修改源码。详见 UPSTREAM-ATTRIBUTION.md 与 LICENSE。",
    ])
    overlay.save()
    replacements = PdfReader(corrections)
    for index, page in enumerate(source.pages[:BASE_PAGE_COUNT]):
        if index < 4:
            page = replacements.pages[index]
        writer.add_page(page)
    for page in appendix.pages:
        writer.add_page(page)
    with TEMP_OUTPUT.open("wb") as stream:
        writer.write(stream)
    os.replace(TEMP_OUTPUT, OUTPUT)
    mirror = ROOT / "docs" / "Quick-Guide-ZH.pdf"
    mirror.parent.mkdir(parents=True, exist_ok=True)
    mirror.write_bytes(OUTPUT.read_bytes())


if __name__ == "__main__":
    register_fonts()
    build_appendix()
    combine()
    print(OUTPUT)
