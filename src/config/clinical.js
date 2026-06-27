export const platformPositioning = {
  productName: "Clinical App Studio",
  subtitle: "Health literacy artifacts with patient-specific metrics",
  corePurpose:
    "Help practitioners create patient-facing artifacts that explain care in plain language and collect goal-specific metrics for clinician review."
};

export const libraryFilters = [
  "All",
  "Live",
  "Review",
  "Draft",
  "Public",
  "Assigned patients"
];

export const patientGroups = [
  "Post-discharge follow-up",
  "A1c above goal",
  "Remote monitoring enrolled",
  "Pediatric caregivers",
  "New medication start",
  "Public education",
  "Nutrition tracking"
];

export const specialties = [
  "Primary care",
  "Cardiology",
  "Pulmonology",
  "Endocrinology",
  "Orthopedics",
  "Pediatrics",
  "Behavioral health",
  "Nutrition"
];

export const exampleBrief =
  "Create an asthma literacy artifact for pediatric caregivers that teaches green/yellow/red zones, collects symptom zone and rescue inhaler use, and shows clinicians adherence and red-zone alerts.";

export const defaultCreateForm = {
  brief: "",
  sourceMaterial: "",
  distribution: "assigned",
  patientGroups: [],
  specialty: "Primary care",
  literacy: "6th grade",
  language: "English",
  observabilityGoal:
    "patient-entered metrics, education completion, questions, and clinician review signals",
  voiceEnabled: false
};

const sharedEscalationKeywords = [
  "911",
  "emergency",
  "severe",
  "faint",
  "cannot breathe",
  "trouble breathing",
  "chest pain"
];

export const conditionProfiles = [
  {
    key: "heart-failure",
    label: "Heart failure",
    aliases: ["heart failure", "hf", "cardiac", "heart", "fluid", "swelling"],
    specialty: "Cardiology",
    patientGroups: ["Post-discharge follow-up", "Remote monitoring enrolled"],
    observabilityGoal: "weight change, breathing symptoms, swelling, medication confidence, and teach-back completion",
    metrics: ["Weight change", "Breathing difficulty", "Swelling", "Medication confidence"],
    alerts: ["Weight up 3 lb in 24 hours", "Breathing worse two days", "New or worsening swelling"],
    cadence: "Daily for 30 days after discharge, then clinician-adjusted",
    clinicianView: "Risk-ranked trend table with weight, dyspnea, swelling, adherence, and latest patient note.",
    lessons: ["Daily weight routine", "Salt and fluid basics", "When to call the care team"],
    quiz: ["Which weight change should be reported today?", "Which symptom means you should contact the care team?"],
    escalationKeywords: [...sharedEscalationKeywords, "blue lips", "cannot lie flat"],
    preview: {
      primaryMetric: "Weight change",
      primaryMetricValue: "Not submitted",
      nextAction: "Send heart failure check-in"
    }
  },
  {
    key: "asthma",
    label: "Asthma",
    aliases: ["asthma", "wheeze", "wheezing", "inhaler", "rescue inhaler", "peak flow"],
    specialty: "Pulmonology",
    patientGroups: ["Pediatric caregivers", "Remote monitoring enrolled"],
    observabilityGoal: "symptom zone, rescue inhaler use, nighttime symptoms, trigger exposure, and teach-back completion",
    metrics: ["Symptom zone", "Rescue inhaler use", "Night symptoms", "Trigger exposure"],
    alerts: ["Red zone selected", "Rescue inhaler use increasing", "Night symptoms repeated"],
    cadence: "Daily during flares, then weekly until stable",
    clinicianView: "Zone timeline with rescue medication use, triggers, adherence, and caregiver questions.",
    lessons: ["Know the zones", "Using a spacer", "Trigger reduction", "When to get urgent help"],
    quiz: ["Which zone means get help now?", "When should the rescue inhaler be used?"],
    escalationKeywords: [...sharedEscalationKeywords, "blue", "lips", "retractions"],
    preview: {
      primaryMetric: "Symptom zone",
      primaryMetricValue: "Not submitted",
      nextAction: "Send asthma check-in"
    }
  },
  {
    key: "diabetes",
    label: "Diabetes",
    aliases: ["diabetes", "glucose", "blood sugar", "a1c", "insulin", "hypoglycemia", "gestational diabetes"],
    specialty: "Endocrinology",
    patientGroups: ["A1c above goal", "New medication start", "Remote monitoring enrolled"],
    observabilityGoal: "glucose trend, medication confidence, meal barriers, hypoglycemia symptoms, and teach-back completion",
    metrics: ["Glucose reading", "Medication confidence", "Meal barrier", "Low-sugar symptoms"],
    alerts: ["Repeated high glucose values", "Low-sugar symptoms selected", "No glucose logs in 72 hours"],
    cadence: "Per care plan, commonly fasting and post-meal logs",
    clinicianView: "Glucose trend grid with symptoms, barriers, missed logs, and patient questions.",
    lessons: ["Why glucose timing matters", "Low-sugar warning signs", "Meal planning basics", "Visit prep"],
    quiz: ["When should you log a glucose reading?", "Which symptom can mean low blood sugar?"],
    escalationKeywords: [...sharedEscalationKeywords, "confused", "passed out", "very low"],
    preview: {
      primaryMetric: "Glucose reading",
      primaryMetricValue: "Not submitted",
      nextAction: "Log glucose check-in"
    }
  },
  {
    key: "hypertension",
    label: "Hypertension",
    aliases: ["hypertension", "blood pressure", "bp", "high blood pressure"],
    specialty: "Primary care",
    patientGroups: ["Remote monitoring enrolled", "New medication start"],
    observabilityGoal: "blood pressure trend, medication adherence, side effects, symptoms, and teach-back completion",
    metrics: ["Blood pressure", "Medication adherence", "Dizziness", "Headache"],
    alerts: ["Very high blood pressure reported", "Missed medication pattern", "New severe symptom selected"],
    cadence: "Home blood pressure log per clinician plan",
    clinicianView: "Blood pressure trend with adherence, symptoms, side effects, and unresolved questions.",
    lessons: ["How to take blood pressure", "Medication routine", "Symptoms to report", "Lifestyle basics"],
    quiz: ["How should you sit before taking blood pressure?", "Which symptom should be reported promptly?"],
    escalationKeywords: [...sharedEscalationKeywords, "worst headache", "weakness", "vision loss"],
    preview: {
      primaryMetric: "Blood pressure",
      primaryMetricValue: "Not submitted",
      nextAction: "Send blood pressure check-in"
    }
  },
  {
    key: "post-op-recovery",
    label: "Post-op recovery",
    aliases: ["post op", "post-op", "surgery", "knee", "hip", "recovery", "wound", "incision"],
    specialty: "Orthopedics",
    patientGroups: ["Post-discharge follow-up", "Remote monitoring enrolled"],
    observabilityGoal: "pain trend, mobility, wound concern, medication confidence, and education completion",
    metrics: ["Pain score", "Walking minutes", "Wound concern", "Medication confidence"],
    alerts: ["Pain worsening over 48 hours", "Wound concern selected", "No mobility update in 48 hours"],
    cadence: "Daily for 21 days after procedure",
    clinicianView: "Recovery timeline with pain, mobility, wound signals, adherence, and latest patient note.",
    lessons: ["Pain scale basics", "Wound watch", "Safe movement", "When to contact the care team"],
    quiz: ["Which wound change should be reported?", "What should you track before the next visit?"],
    escalationKeywords: [...sharedEscalationKeywords, "heavy bleeding", "fever", "red streaks"],
    preview: {
      primaryMetric: "Pain score",
      primaryMetricValue: "Not submitted",
      nextAction: "Send recovery check-in"
    }
  },
  {
    key: "nutrition-tracking",
    label: "Nutrition tracking",
    aliases: [
      "food",
      "meal",
      "meals",
      "nutrition",
      "diet",
      "calorie",
      "calories",
      "macro",
      "macros",
      "plate",
      "picture of their food",
      "photo of their food",
      "food tracking"
    ],
    specialty: "Nutrition",
    patientGroups: ["Nutrition tracking", "Remote monitoring enrolled"],
    observabilityGoal: "meal photo capture, food notes, portion awareness, patient questions, and logging completion",
    metrics: ["Meal photo", "Food items", "Portion estimate", "Meal notes"],
    alerts: ["No meal logs in 72 hours", "Patient question needs review", "Repeated skipped meal note"],
    cadence: "Per care plan, commonly each meal or daily recap",
    clinicianView: "Meal photo timeline with food notes, completion rate, patient questions, and review flags.",
    lessons: ["How to photograph a meal", "Portion awareness", "Balanced plate basics", "Questions for your care team"],
    quiz: ["What makes a useful meal photo?", "What detail should you add with a meal log?"],
    escalationKeywords: sharedEscalationKeywords,
    preview: {
      primaryMetric: "Meal photo",
      primaryMetricValue: "Not submitted",
      nextAction: "Log meal photo"
    }
  },
  {
    key: "general",
    label: "General health tracking",
    aliases: [],
    specialty: "Primary care",
    patientGroups: ["Assigned patients"],
    observabilityGoal: "patient-entered observations, education completion, patient questions, and clinician review signals",
    metrics: ["Patient observation", "Education completion", "Patient question", "Follow-up need"],
    alerts: ["Patient question needs review", "No activity in 72 hours", "Urgent concern selected"],
    cadence: "Clinician-defined cadence",
    clinicianView: "Review queue with activity, education completion, questions, and follow-up flags.",
    lessons: ["What to track", "How to use this artifact", "Questions for your care team"],
    quiz: ["What is one thing you should track?", "What question should you bring to your care team?"],
    escalationKeywords: sharedEscalationKeywords,
    preview: {
      primaryMetric: "Patient observation",
      primaryMetricValue: "Not submitted",
      nextAction: "Send check-in"
    }
  }
];

export function inferConditionProfile({ brief = "", specialty = "" } = {}) {
  const text = `${brief} ${specialty}`.toLowerCase();
  const scoredProfiles = conditionProfiles
    .filter((profile) => profile.key !== "general")
    .map((profile) => {
      const aliasScore = profile.aliases.reduce(
        (score, alias) => score + (text.includes(alias.toLowerCase()) ? 2 : 0),
        0
      );
      return { profile, score: aliasScore };
    })
    .sort((first, second) => second.score - first.score);

  return scoredProfiles[0]?.score
    ? scoredProfiles[0].profile
    : conditionProfiles.find((profile) => profile.key === "general");
}

export function isEducationOnlyArtifactRequest(brief = "") {
  const text = String(brief || "").toLowerCase();
  const asksForEducation =
    /\b(infographic|visual guide|guide|education|educational|learn|lesson|teach|explainer|literacy)\b/.test(
      text
    );
  const asksForTracking =
    /\b(track|tracking|tracker|log|logging|check[-\s]?in|collect|monitor|measure|metric|metrics|diary|journal|dashboard|observability|chatbot|chat bot|coach|triage)\b/.test(
      text
    );

  return asksForEducation && !asksForTracking;
}

export function adaptProfileForArtifactIntent(profile, brief = "") {
  if (!profile || !isEducationOnlyArtifactRequest(brief)) {
    return profile;
  }

  const isBloodPressureEducation =
    profile.key === "hypertension" ||
    /\b(blood pressure|bp|hypertension)\b/i.test(brief);

  if (isBloodPressureEducation) {
    return {
      ...profile,
      key: "blood-pressure-education",
      label: "Blood pressure education",
      patientGroups: ["Public education"],
      observabilityGoal:
        "infographic engagement, lifestyle strategy selection, teach-back completion, and patient questions",
      metrics: [
        "Infographic completion",
        "Lifestyle strategy selected",
        "Teach-back completion",
        "Patient question"
      ],
      alerts: [
        "Low-confidence teach-back",
        "Patient question needs review",
        "No education activity in 72 hours"
      ],
      cadence: "Self-paced education artifact",
      clinicianView:
        "Infographic engagement, selected lifestyle strategies, teach-back confidence, and patient questions.",
      lessons: [
        "What blood pressure numbers mean",
        "Salt and food choices",
        "Movement and stress basics",
        "Questions for your care team"
      ],
      quiz: [
        "Which habit can help lower blood pressure?",
        "What is one question for your care team?"
      ],
      preview: {
        primaryMetric: "Infographic completion",
        primaryMetricValue: "Not started",
        nextAction: "Review lowering blood pressure infographic"
      }
    };
  }

  return {
    ...profile,
    key: `${profile.key}-education`,
    label: `${profile.label} education`,
    patientGroups: ["Public education"],
    observabilityGoal:
      "education engagement, teach-back completion, and patient questions",
    metrics: [
      "Education completion",
      "Teach-back completion",
      "Confidence rating",
      "Patient question"
    ],
    alerts: [
      "Low-confidence teach-back",
      "Patient question needs review",
      "No education activity in 72 hours"
    ],
    cadence: "Self-paced education artifact",
    clinicianView:
      "Education engagement, teach-back confidence, and patient questions.",
    preview: {
      primaryMetric: "Education completion",
      primaryMetricValue: "Not started",
      nextAction: "Review education artifact"
    }
  };
}

export function summarizeConditionProfile(profile) {
  return {
    key: profile.key,
    label: profile.label,
    specialty: profile.specialty,
    patientGroups: profile.patientGroups,
    observabilityGoal: profile.observabilityGoal,
    metrics: profile.metrics,
    alerts: profile.alerts,
    cadence: profile.cadence,
    clinicianView: profile.clinicianView,
    lessons: profile.lessons,
    quiz: profile.quiz,
    escalationKeywords: profile.escalationKeywords,
    preview: profile.preview
  };
}
