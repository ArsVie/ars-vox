"""Generate demo reading fixtures: a 2-page PDF and a minimal EPUB3.

Pure stdlib (PDF hand-built, EPUB via zipfile) so no extra deps are needed.
Outputs go to apps/desktop/public/ for the vite demo.
"""
import os
import zipfile

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public")


def _pdf_text_stream(text: str) -> bytes:
    """Wrap text into a PDF content stream with WinAnsi escaping."""
    out = []
    for line in text.split("\n"):
        escaped = "".join("\\" + ch if ch in "\\()" else ch for ch in line)
        out.append(f"({escaped}) Tj".encode("cp1252", errors="replace"))
    body = b"\nT* ".join(out)
    # first line positioned by Td, subsequent lines advance with T*
    stream = b"BT /F1 13 Tf 56 742 Td 14 TL\n" + body + b"\nET"
    return stream


def build_pdf(path: str) -> None:
    # page 1 + page 2 content
    p1_text = (
        "Don Quijote de la Mancha (fragmento) - Capítulo I\n"
        "\n"
        "En un lugar de la Mancha, de cuyo nombre no quiero\n"
        "acordarme, no ha mucho tiempo que vivía un hidalgo de\n"
        "los de lanza en astillero, adarga antigua, rocín flaco y\n"
        "galgo corredor.\n"
        "\n"
        "Una olla de algo más vaca que carnero, salpicón las más\n"
        "noches, duelos y quebrantos los sábados, lantejas los\n"
        "viernes, algún palomino de añadidura los domingos,\n"
        "consumían las tres partes de su hacienda."
    )
    p2_text = (
        "Capítulo I (continuación)\n"
        "\n"
        "El resto della concluían sayo de velarte, calzas de\n"
        "velludo para las fiestas, con sus pantuflos de lo mesmo,\n"
        "y los días de entresemana se honraba con su vellorí de\n"
        "lo más fino.\n"
        "\n"
        "Frisaba la edad de nuestro hidalgo con los cincuenta\n"
        "años; era de complexión recia, seco de carnes, enjuto\n"
        "de rostro, gran madrugador y amigo de la caza."
    )

    def page_obj(num: int, content_id: int, text: bytes, kids: list, offset: int) -> tuple[dict, bytes]:
        content = b"<</Length %d>>\nstream\n" % len(text) + text + b"\nendstream"
        obj = (
            b"%d 0 obj\n<</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            b"/Resources <</Font <</F1 %d 0 R>>>> /Contents %d 0 R>>\nendobj\n"
            % (num, content_id + 1, content_id)
        )
        return {}, obj + b"%d 0 obj\n" % content_id + content + b"\nendobj\n"

    objs = []
    # font object
    objs.append(b"4 0 obj\n<</Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding>>\nendobj\n")
    content1 = _pdf_text_stream(p1_text)
    content2 = _pdf_text_stream(p2_text)
    objs.append(b"5 0 obj\n<</Length %d>>\nstream\n" % len(content1) + content1 + b"\nendstream\nendobj\n")
    objs.append(b"6 0 obj\n<</Length %d>>\nstream\n" % len(content2) + content2 + b"\nendstream\nendobj\n")
    objs.append(b"7 0 obj\n<</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources <</Font <</F1 4 0 R>>>> /Contents 5 0 R>>\nendobj\n")
    objs.append(b"8 0 obj\n<</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources <</Font <</F1 4 0 R>>>> /Contents 6 0 R>>\nendobj\n")
    objs.append(b"2 0 obj\n<</Type /Pages /Kids [7 0 R 8 0 R] /Count 2>>\nendobj\n")
    objs.append(b"3 0 obj\n<</Type /Catalog /Pages 2 0 R>>\nendobj\n")

    body = b"".join(objs)
    xref_pos = 9 + len(body)  # 9 objects: 1,2,3,4,5,6,7,8 (1 is header placeholder)
    # header + object 1 = we start objects at 2; object 1 = unused but keep offset math simple
    header = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"
    objects = body  # objects 2..8
    # xref: offsets computed relative to file start
    offsets = {}
    pos = len(header)
    all_objs = []
    # object numbering: 2,3,4,5,6,7,8 in the order they appear in `objs`
    for i, chunk in enumerate(objs, start=2):
        offsets[i] = pos
        all_objs.append(chunk)
        pos += len(chunk)
    xref_offset = pos
    xref = b"xref\n0 9\n0000000000 65535 f \n"
    for i in range(2, 9):
        xref += b"%010d 00000 n \n" % offsets[i]
    trailer = b"trailer\n<</Size 9 /Root 3 0 R>>\nstartxref\n%d\n%%%%EOF\n" % xref_offset
    with open(path, "wb") as f:
        f.write(header)
        for chunk in all_objs:
            f.write(chunk)
        f.write(xref)
        f.write(trailer)
    print("pdf", os.path.getsize(path), "bytes")


def build_epub(path: str) -> None:
    chapter = """<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Capítulo I</title>
<style>body { font-family: Georgia, serif; line-height: 1.6; margin: 8%; }
h1 { font-size: 1.5em; } p { text-align: justify; }</style></head>
<body><h1>Don Quijote de la Mancha</h1>
<h2>Capítulo I — Que trata de la condición y ejercicio del famoso hidalgo</h2>
<p>En un lugar de la Mancha, de cuyo nombre no quiero acordarme, no ha mucho
tiempo que vivía un hidalgo de los de lanza en astillero, adarga antigua,
rocín flaco y galgo corredor.</p>
<p>Una olla de algo más vaca que carnero, salpicón las más noches, duelos y
quebrantos los sábados, lantejas los viernes, algún palomino de añadidura
los domingos, consumían las tres partes de su hacienda.</p>
<p>Frisaba la edad de nuestro hidalgo con los cincuenta años; era de
complexión recia, seco de carnes, enjuto de rostro, gran madrugador y
amigo de la caza.</p>
<p>Quieren decir que tenía el sobrenombre de Quijada, o Quesada, que en esto
hay alguna diferencia en los autores que deste caso escriben, aunque por
conjeturas verosímiles se deja entender que se llamaba Quejana.</p>
</body></html>"""
    opf = """<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uid" version="3.0">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="uid">demo-don-quijote</dc:identifier>
<dc:title>Don Quijote de la Mancha (fragmento)</dc:title>
<dc:language>es</dc:language>
<dc:creator>Miguel de Cervantes</dc:creator>
<meta property="dcterms:modified">2026-08-07T00:00:00Z</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
</manifest>
<spine><itemref idref="ch1"/></spine>
</package>"""
    nav = """<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Índice</title></head>
<body><nav epub:type="toc"><ol><li><a href="chapter1.xhtml">Capítulo I</a></li></ol></nav></body>
</html>"""
    container = """<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>"""
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        z.writestr("META-INF/container.xml", container, compress_type=zipfile.ZIP_DEFLATED)
        z.writestr("OEBPS/content.opf", opf, compress_type=zipfile.ZIP_DEFLATED)
        z.writestr("OEBPS/nav.xhtml", nav, compress_type=zipfile.ZIP_DEFLATED)
        z.writestr("OEBPS/chapter1.xhtml", chapter, compress_type=zipfile.ZIP_DEFLATED)
    print("epub", os.path.getsize(path), "bytes")


build_pdf(os.path.join(OUT, "demo-doc.pdf"))
build_epub(os.path.join(OUT, "demo-book.epub"))
