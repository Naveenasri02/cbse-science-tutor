import io
import re
import config


def _estimate_tokens(text: str) -> int:
    """Rough token count: ~4 chars per token."""
    return max(1, len(text) // 4)


def _recursive_split(text: str, chunk_size: int, chunk_overlap: int) -> list[str]:
    """Split text into chunks at natural boundaries with overlap."""
    separators = ["\n\n", "\n", ". ", "! ", "? ", "; ", ", ", " "]
    chunks = []
    start = 0
    text_len = len(text)
    char_chunk = chunk_size * 4  # convert token estimate to chars
    char_overlap = chunk_overlap * 4

    while start < text_len:
        end = min(start + char_chunk, text_len)

        # If not at the end, find a natural break point
        if end < text_len:
            best_break = -1
            for sep in separators:
                # Search for separator near the end of the chunk
                search_start = max(start + char_chunk // 2, start)
                idx = text.rfind(sep, search_start, end)
                if idx != -1:
                    best_break = idx + len(sep)
                    break
            if best_break > start:
                end = best_break

        chunk = text[start:end].strip()
        if chunk and _estimate_tokens(chunk) >= 10:
            chunks.append(chunk)

        # Move forward with overlap
        start = max(start + 1, end - char_overlap)

    return chunks


def parse_pdf(file_bytes: bytes) -> str:
    """Extract text from PDF bytes using PyMuPDF."""
    import fitz  # PyMuPDF
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    pages = []
    for page in doc:
        pages.append(page.get_text("text"))
    doc.close()
    return "\n\n".join(pages)


def parse_docx(file_bytes: bytes) -> str:
    """Extract text from DOCX bytes using python-docx."""
    from docx import Document
    doc = Document(io.BytesIO(file_bytes))
    paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
    return "\n\n".join(paragraphs)


def parse_document(file_bytes: bytes, filename: str) -> str:
    """Auto-detect format and extract text."""
    lower = filename.lower()
    if lower.endswith(".pdf"):
        return parse_pdf(file_bytes)
    elif lower.endswith((".docx", ".doc")):
        return parse_docx(file_bytes)
    else:
        raise ValueError(f"Unsupported file format: {filename}")


def chunk_text(text: str) -> list[str]:
    """Split document text into overlapping chunks."""
    # Clean up excessive whitespace
    text = re.sub(r'\n{3,}', '\n\n', text)
    text = re.sub(r' {2,}', ' ', text)

    return _recursive_split(text, config.CHUNK_SIZE, config.CHUNK_OVERLAP)


def process_document(file_bytes: bytes, filename: str) -> list[str]:
    """Parse and chunk a document. Returns list of text chunks."""
    text = parse_document(file_bytes, filename)
    if not text.strip():
        raise ValueError("Document appears to be empty or contains no extractable text.")
    return chunk_text(text)
