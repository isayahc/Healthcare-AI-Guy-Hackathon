"""
MODULE 4a — RAG Ingest (rag/ingest.py)
=======================================
Loads clinical first-aid documents from data/docs/ into ChromaDB.
Run this ONCE (or whenever you add new documents).

Test it:
    python rag/ingest.py

What it does:
  1. Reads every PDF and .txt file in data/docs/
  2. Splits them into 500-token chunks with 20% overlap
  3. Embeds each chunk with OpenAI text-embedding-3-small
  4. Stores everything in a local ChromaDB vector store

After running, you should see:
  "Ingested X chunks from Y documents into ChromaDB."
"""

import os
from pathlib import Path
from dotenv import load_dotenv

from langchain_community.document_loaders import PyPDFLoader, TextLoader
from langchain.text_splitter import TokenTextSplitter
from langchain_openai import OpenAIEmbeddings
from langchain_chroma import Chroma

# Load API keys from .env
load_dotenv()

# ── Configuration ────────────────────────────────────────────
DOCS_DIR     = Path("data/docs")          # folder with your clinical PDFs/txts
CHROMA_PATH  = os.getenv("CHROMA_DB_PATH", "./data/chroma_db")
COLLECTION   = os.getenv("CHROMA_COLLECTION", "clinical_triage")
OPENAI_KEY   = os.getenv("OPENAI_API_KEY")

# ── Helpers ──────────────────────────────────────────────────

def load_documents(docs_dir: Path) -> list:
    """
    Walk docs_dir and load every PDF and .txt file.
    Returns a flat list of LangChain Document objects.
    """
    documents = []

    for path in docs_dir.rglob("*"):
        if path.suffix.lower() == ".pdf":
            print(f"  Loading PDF: {path.name}")
            loader = PyPDFLoader(str(path))
            documents.extend(loader.load())

        elif path.suffix.lower() == ".txt":
            print(f"  Loading TXT: {path.name}")
            loader = TextLoader(str(path), encoding="utf-8")
            documents.extend(loader.load())

    return documents


def ingest():
    """
    Main ingest pipeline.
    Loads docs → splits → embeds → stores in ChromaDB.
    """
    print(f"\n── Triage Agent: RAG Ingest ──")
    print(f"Looking for documents in: {DOCS_DIR.resolve()}\n")

    # Safety check: make sure the docs folder exists
    if not DOCS_DIR.exists():
        print(f"ERROR: {DOCS_DIR} does not exist. Create it and add clinical docs.")
        return

    # Step 1: Load all documents
    documents = load_documents(DOCS_DIR)
    if not documents:
        print("No documents found. Add PDF or .txt files to data/docs/ and re-run.")
        return
    print(f"\nLoaded {len(documents)} pages/sections across all documents.")

    # Step 2: Split into 500-token chunks (20% overlap = 100 tokens)
    # We use cl100k_base (same tokenizer as OpenAI embeddings) for accurate sizing.
    splitter = TokenTextSplitter(
        chunk_size=500,
        chunk_overlap=100,
        encoding_name="cl100k_base"
    )
    chunks = splitter.split_documents(documents)
    print(f"Split into {len(chunks)} chunks.")

    # Step 3: Set up OpenAI embeddings
    embeddings = OpenAIEmbeddings(
        model="text-embedding-3-small",
        api_key=OPENAI_KEY
    )

    # Step 4: Store in ChromaDB
    # from_documents() embeds all chunks and persists them to CHROMA_PATH
    print(f"Embedding and storing in ChromaDB at: {CHROMA_PATH} ...")
    vectorstore = Chroma.from_documents(
        documents=chunks,
        embedding=embeddings,
        persist_directory=CHROMA_PATH,
        collection_name=COLLECTION
    )

    print(f"\nDone! Ingested {len(chunks)} chunks from {len(documents)} pages.")
    print(f"ChromaDB collection '{COLLECTION}' is ready for retrieval.\n")


if __name__ == "__main__":
    ingest()
