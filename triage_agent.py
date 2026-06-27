"""
MODULE 3 — Triage Agent (agent/triage_agent.py)
================================================
The core LangGraph agent. Handles the full conversation loop:
  - Accepts text messages and optional images
  - Calls the clinical RAG tool to ground responses in real docs
  - Assesses escalation level after each turn
  - Maintains conversation history across turns

Test it standalone (interactive CLI):
    python agent/triage_agent.py

The agent will start a text conversation in your terminal.
Type your symptoms, press Enter. Type 'quit' to exit.
"""

import os
import sys
import base64
from pathlib import Path
from typing import Annotated, TypedDict
import operator

from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from langchain.tools import tool
from langgraph.graph import StateGraph, END
from langgraph.prebuilt import ToolNode

# Add parent directory to path so we can import sibling modules
sys.path.append(str(Path(__file__).parent.parent))

from rag.retriever import query as rag_query
from escalation.escalation import (
    evaluate_escalation,
    format_escalation_for_user,
    EscalationLevel
)

load_dotenv()

# ── LLM setup ────────────────────────────────────────────────
# gpt-4o-mini: good balance of speed, cost, and vision capability
# temperature=0.3: mostly consistent but slightly warm tone
llm = ChatOpenAI(
    model="gpt-4o-mini",
    api_key=os.getenv("OPENAI_API_KEY"),
    temperature=0.3
)

# ── System prompt ─────────────────────────────────────────────
# This is the personality and guardrail layer.
# Adjust the tone here without touching the agent logic.
SYSTEM_PROMPT = """You are a calm, reassuring first-aid triage assistant.
Your role is to help people decide whether they need emergency care or can
safely manage their situation at home with proper first-aid guidance.

TONE RULES (critical):
- Sound like a knowledgeable, caring friend — not a medical textbook
- Never list worst-case scenarios unprompted (no "it could be X, Y, or Z")
- Be direct and actionable: "Ice it for 20 minutes" not "ice application may help"
- If something is clearly minor, say so confidently and reassuringly
- Ask ONE focused follow-up question at a time — don't overwhelm

WHAT YOU DO:
- Give clear, practical first-aid guidance grounded in the retrieved documents
- Ask focused follow-up questions to better understand the situation
- Monitor whether things seem to be improving or worsening
- Recommend escalation when warranted (always checking with the user first,
  except for clear emergencies)

WHAT YOU DO NOT DO:
- Diagnose conditions (say "this could be a sprain" not "you have a Grade II sprain")
- Prescribe medications or specific doses
- Replace professional medical care
- Alarm people unnecessarily

If you receive retrieved clinical context, use it to ground your advice.
If image content is provided, describe what you observe calmly and factor
it into your assessment.

Always end your response with one focused question to continue the assessment,
unless the situation clearly requires immediate escalation."""


# ── Agent state ──────────────────────────────────────────────
class TriageState(TypedDict):
    """
    The state that flows between LangGraph nodes.
    messages accumulates the full conversation history.
    user_input_raw stores the latest raw input for escalation checking.
    """
    messages: Annotated[list, operator.add]
    user_input_raw: str          # Plain text of all user messages so far


# ── Tools ────────────────────────────────────────────────────

@tool
def search_clinical_docs(query: str) -> str:
    """
    Search the clinical first-aid knowledge base for guidance relevant
    to the user's symptoms. Use this whenever the user describes a
    physical symptom, injury, or asks what to do about a health situation.
    """
    results = rag_query(query)
    if not results:
        return "No specific clinical guidance found for this query."

    # Join the top results into a single context block
    context = "\n\n---\n\n".join(results)
    return f"Retrieved clinical guidance:\n\n{context}"


# Bind the tool to the LLM so it can call it
tools = [search_clinical_docs]
llm_with_tools = llm.bind_tools(tools)


# ── Graph nodes ──────────────────────────────────────────────

def call_llm(state: TriageState) -> dict:
    """
    Node: sends the full conversation history to the LLM.
    The system prompt is injected here on every call.
    """
    # Prepend system prompt to the message list
    messages_with_system = [SystemMessage(content=SYSTEM_PROMPT)] + state["messages"]
    response = llm_with_tools.invoke(messages_with_system)
    return {"messages": [response]}


def should_continue(state: TriageState) -> str:
    """
    Routing function: after the LLM responds, check whether it
    wants to call a tool or is ready to give a final answer.
    """
    last_message = state["messages"][-1]
    if hasattr(last_message, "tool_calls") and last_message.tool_calls:
        return "tools"   # Route to tool execution
    return END           # Route to final output


# ── Build the graph ──────────────────────────────────────────

tool_node = ToolNode(tools)

graph = StateGraph(TriageState)
graph.add_node("llm", call_llm)
graph.add_node("tools", tool_node)

graph.set_entry_point("llm")
graph.add_conditional_edges("llm", should_continue)
graph.add_edge("tools", "llm")   # Always loop back after tool use

triage_app = graph.compile()


# ── Public interface ─────────────────────────────────────────

def encode_image(image_path: str) -> str:
    """
    Encodes an image file to base64 for inclusion in the LLM message.
    Supports JPEG, PNG, WEBP, GIF.
    """
    with open(image_path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


def run_triage_turn(
    user_text: str,
    conversation_history: list,
    image_path: str | None = None
) -> tuple[str, list]:
    """
    Run one turn of the triage conversation.

    Args:
        user_text:            What the user typed or said
        conversation_history: List of previous LangChain messages
        image_path:           Optional path to an uploaded image

    Returns:
        (agent_response_text, updated_conversation_history)
    """

    # Build the user message — with or without an image
    if image_path:
        image_data = encode_image(image_path)
        # Detect format from extension
        ext = Path(image_path).suffix.lower().lstrip(".")
        mime = {"jpg": "image/jpeg", "jpeg": "image/jpeg",
                "png": "image/png", "webp": "image/webp"}.get(ext, "image/jpeg")

        user_message = HumanMessage(content=[
            {"type": "text",  "text": user_text},
            {"type": "image_url", "image_url": {
                "url": f"data:{mime};base64,{image_data}"
            }}
        ])
    else:
        user_message = HumanMessage(content=user_text)

    # Accumulate all user text for escalation evaluation
    all_user_text = " ".join(
        msg.content if isinstance(msg.content, str) else user_text
        for msg in conversation_history
        if isinstance(msg, HumanMessage)
    ) + " " + user_text

    # Add the new message to history and run the graph
    updated_history = conversation_history + [user_message]
    result = triage_app.invoke({
        "messages": updated_history,
        "user_input_raw": all_user_text
    })

    # Extract the agent's final text response
    agent_message = result["messages"][-1]
    agent_text = agent_message.content

    # Run escalation check based on the full conversation so far
    escalation = evaluate_escalation(all_user_text, agent_text)
    escalation_msg = format_escalation_for_user(escalation)

    # Append escalation notice to the response if warranted
    if escalation_msg:
        agent_text = agent_text + escalation_msg

    # Update history with the agent's response (without escalation suffix,
    # which is UI-only and shouldn't re-enter the model context)
    new_history = result["messages"]

    return agent_text, new_history


# ── Standalone CLI test ──────────────────────────────────────
if __name__ == "__main__":
    print("\n── Clinical Triage Agent ──")
    print("Describe your symptoms and I'll help you figure out what to do.")
    print("You can also type the path to an image file to share it.")
    print("Type 'quit' to exit.\n")

    history = []

    while True:
        user_input = input("You: ").strip()
        if user_input.lower() in ("quit", "exit", "q"):
            print("Take care!")
            break
        if not user_input:
            continue

        # Allow the user to optionally type an image path after their message
        # Format: "message | /path/to/image.jpg"
        image = None
        if "|" in user_input:
            parts = user_input.split("|", 1)
            user_input = parts[0].strip()
            image_candidate = parts[1].strip()
            if Path(image_candidate).exists():
                image = image_candidate
                print(f"(Image loaded: {image_candidate})")
            else:
                print(f"(Image not found: {image_candidate} — continuing without it)")

        response, history = run_triage_turn(user_input, history, image)
        print(f"\nAgent: {response}\n")
