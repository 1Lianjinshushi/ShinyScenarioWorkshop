"""Append the r14-r16 maintenance pages to the portable quick guide.

The original illustrated guide has eight pages.  Re-running this script keeps
those pages and replaces the release appendix, so packaging stays reproducible.
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
APPENDIX = ROOT / "tmp" / "pdfs" / "quick-guide-r16-appendix.pdf"
TEMP_OUTPUT = ROOT / "tmp" / "pdfs" / "quick-guide-r16-combined.pdf"
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
    page.save()


def combine() -> None:
    source = PdfReader(str(OUTPUT))
    if len(source.pages) < BASE_PAGE_COUNT:
        raise RuntimeError(f"Quick guide has only {len(source.pages)} pages; expected at least {BASE_PAGE_COUNT}")
    appendix = PdfReader(str(APPENDIX))
    writer = PdfWriter()
    corrections = BytesIO()
    overlay = canvas.Canvas(corrections, pagesize=A4)
    overlay.setFillColor(colors.white)
    overlay.rect(50, 710, 495, 28, fill=1, stroke=0)
    overlay.setFont(FONT_BODY, 10)
    overlay.setFillColor(MUTED)
    overlay.drawString(56, 720, "完整分享版图文说明 · 2026-10-07 r16（旧界面截图仅作位置参考）")
    overlay.showPage()
    y = header(overlay, 4, "资源库、更新日志与页游监听", "完整分享版包含监听脚本；安装需浏览器用户脚本管理器")
    y = section(overlay, y, "首次启用", "自己的浏览器与账号", [
        "先安装并启用 Tampermonkey 或 Violentmonkey。Chrome 如有“允许用户脚本”选项，请一并打开。",
        "在工坊点击“安装／更新监听脚本”，由脚本管理器确认安装，再点击“打开页游并检查”。",
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
    overlay.save()
    replacements = PdfReader(corrections)
    for index, page in enumerate(source.pages[:BASE_PAGE_COUNT]):
        if index == 0:
            page.merge_page(replacements.pages[0])
        if index == 3:
            page = replacements.pages[1]
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
