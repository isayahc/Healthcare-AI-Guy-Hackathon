"""
MODULE 5 — Escalation Handler (escalation/escalation.py)
=========================================================
Defines the four escalation levels and the logic for choosing between them.
Kept intentionally separate from the agent so it's easy to audit and adjust
without touching the conversation logic.

The agent calls `evaluate_escalation()` after each turn and includes
the result in its response when the level is anything above MONITOR.

Test it standalone:
    python escalation/escalation.py
"""

from enum import Enum
from dataclasses import dataclass


# ── Escalation levels ────────────────────────────────────────

class EscalationLevel(Enum):
    """
    Four tiers, from least to most urgent.
    The agent never jumps straight to EMERGENCY without checking in with
    the user first — except for the hard-coded red-flag symptoms below.
    """
    MONITOR    = "monitor"      # Handle at home, watch for changes
    CALL_DOC   = "call_doctor"  # Contact primary care within 24h
    URGENT     = "urgent_care"  # Go to urgent care today (not ER)
    EMERGENCY  = "emergency"    # Call 911 or go to ER immediately


@dataclass
class EscalationResult:
    """
    What the agent returns alongside its first-aid guidance.
    """
    level: EscalationLevel
    message: str        # Human-readable recommendation (shown to user)
    action: str         # Specific action (e.g. "Call 911", "Call your doctor")
    ask_user: bool      # Whether to confirm with user before escalating


# ── Red-flag symptoms that always trigger EMERGENCY ──────────
# These bypass the "check with user first" rule.
EMERGENCY_KEYWORDS = [
    "chest pain", "can't breathe", "difficulty breathing", "not breathing",
    "unconscious", "unresponsive", "seizure", "stroke", "facial drooping",
    "arm weakness", "slurred speech", "severe bleeding", "won't stop bleeding",
    "head injury", "loss of consciousness", "overdose", "poisoning",
    "severe allergic reaction", "anaphylaxis", "throat closing",
    "broken bone", "bone through skin", "deep cut",
]

# ── Symptom patterns for lower escalation levels ─────────────
URGENT_CARE_KEYWORDS = [
    "getting worse", "worsening", "more painful", "spreading",
    "can't walk", "can't move", "high fever", "fever over 103",
    "vomiting blood", "blood in urine", "blood in stool",
    "severe pain", "unbearable pain", "dislocated",
]

CALL_DOCTOR_KEYWORDS = [
    "not improving", "no better", "still hurts", "persists",
    "fever", "infection", "pus", "discharge", "numb", "numbness",
    "tingling", "swelling spreading",
]


def evaluate_escalation(
    symptom_text: str,
    agent_assessment: str = ""
) -> EscalationResult:
    """
    Determines the appropriate escalation level based on what
    the user described and what the agent assessed.

    Args:
        symptom_text:     Raw text of what the user said (their messages)
        agent_assessment: Optional summary from the agent's reasoning

    Returns:
        EscalationResult with level, message, action, and ask_user flag
    """

    combined = (symptom_text + " " + agent_assessment).lower()

    # ── Tier 4: Emergency — no user confirmation needed ──────
    for keyword in EMERGENCY_KEYWORDS:
        if keyword in combined:
            return EscalationResult(
                level=EscalationLevel.EMERGENCY,
                message=(
                    "Based on what you've described, this sounds like it "
                    "could be a medical emergency. Please don't wait."
                ),
                action="Call 911 or have someone take you to the ER now.",
                ask_user=False   # Immediate, no confirmation
            )

    # ── Tier 3: Urgent care — confirm with user ───────────────
    for keyword in URGENT_CARE_KEYWORDS:
        if keyword in combined:
            return EscalationResult(
                level=EscalationLevel.URGENT,
                message=(
                    "It sounds like this might need to be looked at today. "
                    "Would you like me to recommend going to urgent care?"
                ),
                action="Visit an urgent care clinic today.",
                ask_user=True   # Check with user first
            )

    # ── Tier 2: Call doctor — confirm with user ───────────────
    for keyword in CALL_DOCTOR_KEYWORDS:
        if keyword in combined:
            return EscalationResult(
                level=EscalationLevel.CALL_DOC,
                message=(
                    "This seems manageable at home for now, but it might "
                    "be worth a call to your doctor if things don't improve. "
                    "Want me to flag that?"
                ),
                action="Call your primary care doctor within 24 hours.",
                ask_user=True
            )

    # ── Tier 1: Monitor at home (default) ────────────────────
    return EscalationResult(
        level=EscalationLevel.MONITOR,
        message="This looks manageable at home with the right care.",
        action="Follow the first-aid steps above and monitor for changes.",
        ask_user=False
    )


def format_escalation_for_user(result: EscalationResult) -> str:
    """
    Formats the escalation result into a clean message for the user.
    Only called when the level is above MONITOR.
    """
    if result.level == EscalationLevel.MONITOR:
        return ""  # No escalation message needed

    # Add a clear visual separator so the user notices
    separator = "\n\n---\n"

    if result.level == EscalationLevel.EMERGENCY:
        return f"{separator}🚨 **Important:** {result.message}\n**{result.action}**"
    elif result.level == EscalationLevel.URGENT:
        return f"{separator}⚠️ {result.message}\n*{result.action}*"
    elif result.level == EscalationLevel.CALL_DOC:
        return f"{separator}ℹ️ {result.message}\n*{result.action}*"

    return ""


# ── Standalone test ──────────────────────────────────────────
if __name__ == "__main__":
    test_cases = [
        ("I twisted my ankle and it hurts a bit",          "mild sprain"),
        ("My ankle is swelling and getting worse",          "possible fracture"),
        ("I have chest pain and can't breathe properly",    "urgent concern"),
        ("The swelling hasn't improved after two days",     "not improving"),
    ]

    print("\n── Escalation Handler: standalone test ──\n")
    for symptoms, assessment in test_cases:
        result = evaluate_escalation(symptoms, assessment)
        print(f"SYMPTOMS:   {symptoms}")
        print(f"ASSESSMENT: {assessment}")
        print(f"LEVEL:      {result.level.value}")
        print(f"ACTION:     {result.action}")
        print(f"ASK USER:   {result.ask_user}")
        msg = format_escalation_for_user(result)
        if msg:
            print(f"USER MSG:   {msg.strip()}")
        print()
