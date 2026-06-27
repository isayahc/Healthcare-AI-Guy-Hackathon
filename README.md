# Clinical Triage Agent — Prototype

A calm, reassuring first-aid triage companion that helps people decide
whether they need emergency care or can safely manage at home.

## Project structure

```
triage_agent/
├── rag/
│   ├── ingest.py          # Load clinical docs into ChromaDB
│   └── retriever.py       # Query the knowledge base
├── agent/
│   └── triage_agent.py    # LangGraph agent (core brain)
├── escalation/
│   └── escalation.py      # Escalation level logic
├── voice/
│   └── voice.py           # ElevenLabs TTS + Whisper STT
├── frontend/
│   └── app.py             # FastAPI server (local + Baseten)
├── data/
│   └── docs/              # Place your clinical PDF/text files here
├── requirements.txt
└── .env.example
```

## Quickstart

### 1. Install dependencies
```bash
pip install -r requirements.txt
```

### 2. Set up environment variables
```bash
cp .env.example .env
# Fill in your API keys in .env
```

### 3. Add clinical documents
Place any first-aid PDFs or text files in `data/docs/`.
Free sources to start with:
- WHO First Aid guidelines (https://www.who.int/publications/i/item/9789240050709)
- American Red Cross first aid PDFs (https://www.redcross.org/take-a-class/first-aid)
- MedlinePlus patient handouts (https://medlineplus.gov)

### 4. Ingest documents into ChromaDB
```bash
python rag/ingest.py
```

### 5. Test the RAG module alone
```bash
python rag/retriever.py
```

### 6. Test the full agent locally
```bash
python agent/triage_agent.py
```

### 7. Run the API server (for Lovable frontend)
```bash
uvicorn frontend.app:app --reload --port 8000
```

### 8. Expose locally for Lovable testing (requires ngrok)
```bash
ngrok http 8000
# Copy the https URL ngrok gives you into your Lovable project
```

## Testing individual modules

| Module         | Test command                    | Also testable at         |
|----------------|---------------------------------|--------------------------|
| RAG ingest     | `python rag/ingest.py`          | Laptop only              |
| RAG retrieval  | `python rag/retriever.py`       | Laptop only              |
| Triage agent   | `python agent/triage_agent.py`  | Laptop / Baseten         |
| Escalation     | `python escalation/escalation.py` | Laptop only            |
| Voice (TTS)    | `python voice/voice.py`         | ElevenLabs playground    |
| Full API       | `uvicorn frontend.app:app`      | Laptop → ngrok → Lovable |

## Deploying to Baseten (for teammates)
1. Create a Baseten account at https://www.baseten.co
2. Install the Baseten client: `pip install baseten`
3. Log in: `baseten login`
4. Deploy: `baseten deploy frontend/app.py`
5. Share the Baseten endpoint URL with teammates — replace the ngrok URL in Lovable with it
