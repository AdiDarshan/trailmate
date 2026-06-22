"""PDF export tool — renders text as a PDF file using ReportLab."""

from __future__ import annotations

from xml.sax.saxutils import escape as xml_escape

from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer


def export_pdf(args: dict) -> dict:
    """Render ``content`` as a PDF at ``filename`` using ReportLab.

    Splits input on blank lines into paragraphs; single newlines are
    preserved as soft line breaks within a paragraph. All text is
    XML-escaped before being handed to ReportLab's ``Paragraph`` so
    content containing ``<``, ``>``, or ``&`` doesn't crash the build.

    Returns ``{"status": "success", "path": filename}`` on success, or
    ``{"status": "error", "message": str(e)}`` on any failure so a tool
    failure surfaces back to the LLM as data rather than an exception.
    """
    try:
        filename = args["filename"]
        content = args["content"]

        doc = SimpleDocTemplate(filename)
        body_style = getSampleStyleSheet()["BodyText"]

        story = []
        for paragraph in content.split("\n\n"):
            paragraph = paragraph.strip()
            if not paragraph:
                continue
            story.append(Paragraph(xml_escape(paragraph), body_style))
            story.append(Spacer(1, 12))

        doc.build(story)
        return {"status": "success", "path": filename}
    except Exception as e:
        return {"status": "error", "message": str(e)}
