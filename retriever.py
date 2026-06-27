"""
MODULE 4b — RAG Retriever (rag/retriever.py)
=============================================
Queries the ChromaDB vector store built by ingest.py.
Used by the triage agent to ground its answers in real clinical docs.

Test it standalone (AFTER running ingest.py):
    python rag/retriever.py

You should see relevant first-aid passages returned for the test queries.
"""

import os
from dotenv import load_dotenv

from langchain_openai import OpenAIEmbeddings
from langchain_chroma import Chroma

load_dotenv()

# ── Configuration ────────────────────────────────────────────
CHROMA_PATH = os.getenv("CHROMA_DB_PATH", "./data/chroma_db")
COLLECTION  = os.getenv("CHROMA_COLLECTION", "clinical_triage")
OPENAI_KEY  = os.getenv("OPENAI_API_KEY")

# Number of chunks to retrieve per query.
# 4 is a good balance: enough context, not too noisy.
TOP_K = 4


def get_retriever():
    """
    Builds and returns a LangChain retriever backed by the ChromaDB store.
    The triage agent calls this to fetch clinical context before responding.
    """
    embeddings = OpenAIEmbeddings(
        model="text-embedding-3-small",
        api_key=OPENAI_KEY
    )

    vectorstore = Chroma(
        persist_directory=CHROMA_PATH,
        embedding_function=embeddings,
        collection_name=COLLECTION
    )

    # as_retriever() wraps the vector store in LangChain's retriever interface,
    # which the agent's RAG tool can call directly.
    return vectorstore.as_retriever(search_kwargs={"k": TOP_K})


def query(question: str) -> list[str]:
    """
    Convenience function: takes a plain text question,
    returns a list of relevant text chunks from the clinical docs.

    Used for standalone testing and by the agent tool.
    """
    retriever = get_retriever()
    docs = retriever.invoke(question)
    return [doc.page_content for doc in docs]


# ── Standalone test ──────────────────────────────────────────
if __name__ == "__main__":
    test_queries = [
        "How do I treat a twisted ankle at home?",
        "What are signs that a sprained ankle needs an X-ray?",
        "First aid for minor constipation in adults",
        "When should belly pain require emergency care?",
    ]

    print("\n── RAG Retriever: standalone test ──\n")
    for q in test_queries:
        print(f"QUERY: {q}")
        results = query(q)
        if results:
            # Print just the first result for readability
            print(f"TOP RESULT:\n{results[0][:400]}...\n")
        else:
            print("No results — make sure you've run rag/ingest.py first.\n")
