import { NextResponse } from 'next/server';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

export const dynamic = 'force-dynamic';

// Use Claude 3.5 Haiku (active model on Bedrock)
const EVAL_MODEL = 'au.anthropic.claude-haiku-4-5-20251001-v1:0';

// Bedrock client automatically uses AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_REGION from env
const bedrockClient = new BedrockRuntimeClient({ 
  region: process.env.AWS_REGION || 'ap-southeast-2' 
});

// The three conditions for the user study
const CONDITIONS = [
  { id: 'holistic',          label: 'Holistic' },
  { id: 'informed-holistic', label: 'Informed Holistic' },
  { id: 'informed-rubric',   label: 'Informed Rubric' }
];

// --- Shared LLM call helper ---

async function callLLM(prompt) {
  const payload = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }]
  };

  const command = new InvokeModelCommand({
    modelId: EVAL_MODEL,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify(payload)
  });

  const response = await bedrockClient.send(command);
  const decodedResponseBody = new TextDecoder().decode(response.body);
  const data = JSON.parse(decodedResponseBody);

  let resultText = data.content?.[0]?.text || '';
  // Strip <think> blocks just in case
  resultText = resultText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  return {
    text: resultText,
    tokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0)
  };
}

// --- Shared prompt fragments ---

function groundTruthBlock(keyIdea, blocks, keyElements, contextualElements, coreFocusCaptured) {
  let block = `<ground_truth>\nKey Idea: "${keyIdea}"\n`;
  
  if (blocks && blocks.length > 0) {
    block += `Concept Blocks:\n`;
    blocks.forEach(b => {
      block += `[${b.name}]\n`;
      if (b.description) block += `  Meaning: ${b.description}\n`;
      if (b.is_core_focus && b.refinements && b.refinements.length > 0) {
        block += `  Refinements (extra precision — a stronger answer includes these, but they are NOT required to capture the block):\n`;
        b.refinements.forEach(r => block += `    * ${r}\n`);
      }
      // Only show element-level details when core focus is NOT yet captured
      // (the LLM needs them to guide the student toward the concept).
      // When core IS captured, elements are unnecessary and tempt the LLM to nag.
      if (!coreFocusCaptured) {
        b.elements.forEach(item => block += `  - ${item.element}: ${item.role}\n`);
      }
    });
  } else if (keyElements && keyElements.length > 0) {
    block += `Key Elements in Sketch:\n`;
    keyElements.forEach(item => block += `- ${item.element}: ${item.role}\n`);
    
    if (contextualElements && contextualElements.length > 0) {
      block += `Contextual Elements:\n`;
      contextualElements.forEach(item => block += `- ${item.element}: ${item.role}\n`);
    }
  }
  
  block += `</ground_truth>`;
  return block;
}

function studentBlock(studentDescription) {
  return `<student>
Explanation: "${studentDescription}"
</student>`;
}

const PEDAGOGICAL_CONTEXT = `
<context>
This exercise assesses the student's ability to comprehend technical sketches — to interpret
the meaning being communicated, not to inventory visual elements. You are the evaluator of the student's response, and must provide helpful feedback. If the student captures the prime semantic meaning of the sketch, they have done well — affirm this and stop. Otherwise, affirm what the student has done correctly, and guide them toward the conceptual gap in their understanding.
The ground truth's block names (e.g. "Setup", "Mechanism", "Result") and labels like "core focus" or "refinement" are internal structure for YOUR reference only. Never use these terms or reveal this structure in your feedback — refer to the student's ideas in their own words or in natural language about the sketch itself.
</context>`;

const BASE_OUTPUT_INSTRUCTIONS = `
Output Instructions:
1. Return ONLY the raw feedback text. Do NOT use JSON, markdown formatting, or <think> blocks.
2. Keep feedback concise: at most 70 words, addressing the student directly.
3. Structure your feedback as 1-3 clear points.`;

// ============================================================
// STAGE 1: Structured Extraction (for informed conditions)
// ============================================================

async function extractSegmentation(studentDescription, keyIdea, blocks, keyElements, contextualElements) {
  const useBlocks = blocks && blocks.length > 0;
  
  let structurePrompt = "";
  let jsonFormat = "";
  
  if (useBlocks) {
    // Build block reference with semantic descriptions AND visual elements as LLM context.
    // The visual elements help the LLM recognize what visual cues belong to each block,
    // while the prompt strictly forces independent tracking of element_noticed vs concept_captured.
    let blockRef = blocks.map(b => {
      let entry = `[${b.name}]`;
      if (b.description) entry += ` — Description: ${b.description}`;
      if (b.elements && b.elements.length > 0) {
        const elemStr = b.elements.map(e => `"${e.element}" (${e.role || ''})`).join(', ');
        entry += ` | Visual Cues: ${elemStr}`;
      }
      if (b.refinements && b.refinements.length > 0) {
        entry += ` | Refinements: ${b.refinements.map((r, i) => `(${i + 1}) ${r}`).join(' ')}`;
      }
      entry += `\n`;
      return entry;
    }).join('');

    structurePrompt = `Task: Analyse the student's explanation against each Concept Block of the sketch.

For EACH Concept Block listed below, evaluate THREE separate criteria:
1. "element_noticed": Did the student reference, mention, or describe any of the visual cues for this block (even vaguely, e.g. "arrows", "a shape", "cube")?
   - Set "element_noticed" to true or false.
   - If true, set "element_evidence" to the exact quote or phrase where they mentioned it. Otherwise set to null.
2. "concept_captured": Did the student demonstrate understanding of the CONCEPT behind this block (given in the Description)?
   - "concept_captured" MUST be true ONLY IF the student demonstrates understanding of what is conceptually/geometrically happening.
   - Merely noticing/naming the visual element or vaguely acknowledging "some kind of operation" is NOT enough for concept_captured = true.
   - If concept_captured is true, set "concept_evidence" to the exact quote showing their conceptual understanding. Otherwise set to null.
   - Judge concept_captured against the Description ONLY. Do NOT require the Refinements for concept_captured = true.
3. "refinements_captured": If the block lists Refinements, which of them did the student explicitly express (by number)? e.g. [1]. Use [] if none or if the block has no Refinements. A refinement only counts if the student actually states it (synonyms are fine, e.g. "perpendicular" for "orthogonal").

Concept Blocks for this sketch:
${blockRef}

Also determine:
- "unmatched_student_claims": Any student quotes/claims that do not correspond to any Concept Block.
- "generalisation_present": Whether the student generalised beyond the sketch to broader context or real-world applications (true/false).`;

    jsonFormat = `{
  "blocks": [
    {
      "name": "<Block Name>",
      "element_noticed": true|false,
      "element_evidence": "<student quote or null>",
      "concept_captured": true|false,
      "concept_evidence": "<student quote or null>",
      "refinements_captured": [<refinement numbers>]
    }
  ],
  "unmatched_student_claims": ["<quotes>"],
  "generalisation_present": true|false
}`;
  } else {
    // Legacy fallback for sketches without blocks defined
    const allElements = [
      ...(keyElements || []).map(e => ({ ...e, type: 'key' })),
      ...(contextualElements || []).map(e => ({ ...e, type: 'contextual' }))
    ];
    const elementList = allElements.map(e => 
      `- ${e.element} [${e.type}] (ground-truth role: "${e.role}")`
    ).join('\n');

    structurePrompt = `Your task is to segment the student's explanation and map each segment to the sketch elements it describes.

For each element listed below, determine:
1. Whether the student referenced or described it (even indirectly)
2. If yes, extract the relevant portion of their text
3. Whether their stated mechanism/role MATCHES the ground-truth role:
   - "correct": the student's description aligns with the ground-truth role
   - "incorrect": the student described this element but stated a WRONG role or mechanism
   - "vague": the student mentioned it but was too imprecise to judge correctness
   - Use "correct" only if referenced is true

Also determine:
- Whether the student captured the overall Key Idea (the core concept the sketch illustrates)
- Whether the student generalised beyond the sketch to broader context or applications

Elements to check:
${elementList}`;

    jsonFormat = `{
  "groups": [
    {
      "element": "<element name from ground truth>",
      "type": "key|contextual",
      "referenced": true|false,
      "student_text": "<exact quote from student, or null if not referenced>",
      "mechanism": "correct|incorrect|vague"
    }
  ],
  "key_idea_captured": true|false,
  "key_idea_student_text": "<exact quote capturing the key idea, or null>",
  "generalisation_present": true|false,
  "unmatched_student_claims": ["<any student claims not matching any ground-truth element>"]
}`;
  }

  const prompt = `You are a teaching assistant analysing a student's interpretation of a sketch.

${groundTruthBlock(keyIdea, blocks, keyElements, contextualElements)}

${studentBlock(studentDescription)}

${structurePrompt}

Return ONLY valid JSON in this exact format (no markdown fencing, no explanation, no other text):
${jsonFormat}`;

  const result = await callLLM(prompt);
  
  // Parse the JSON response
  try {
    let jsonText = result.text;
    const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1].trim();
    }
    
    const extraction = JSON.parse(jsonText);
    
    console.log("\n================ EXTRACTION DEBUG ================\n");
    console.log(JSON.stringify(extraction, null, 2));
    console.log("\n==================================================\n");

    return { extraction, tokens: result.tokens };
  } catch (e) {
    console.error("Failed to parse extraction JSON:", e, "\nRaw response:", result.text);
    // Return a fallback that won't crash the classifier
    return {
      extraction: useBlocks ? {
        blocks: (blocks || []).map(b => ({
          name: b.name,
          element_noticed: false,
          element_evidence: null,
          concept_captured: false,
          concept_evidence: null,
          refinements_captured: []
        })),
        generalisation_present: false,
        unmatched_student_claims: []
      } : {
        groups: (keyElements || []).map(el => ({
          element: el.element,
          type: 'key',
          referenced: false,
          student_text: null,
          mechanism: 'vague'
        })),
        key_idea_captured: false,
        key_idea_student_text: null,
        generalisation_present: false,
        unmatched_student_claims: []
      },
      tokens: result.tokens
    };
  }
}

// ============================================================
// STAGE 2: Deterministic SOLO Classification
// ============================================================

function classifySOLO(extraction, blocks) {
  const { blocks: extractedBlocks, mapped_segments, groups, generalisation_present } = extraction;
  
  let isCoreCaptured = extraction.key_idea_captured || false; 
  let capturedBlocks = new Set();
  let noticedBlocks = new Set();

  if (extractedBlocks && Array.isArray(extractedBlocks)) {
    extractedBlocks.forEach(b => {
      if (b.concept_captured) capturedBlocks.add(b.name);
      if (b.element_noticed) noticedBlocks.add(b.name);
    });

    if (blocks && blocks.length > 0) {
      const hasCoreFocusBlocks = blocks.some(b => b.is_core_focus);
      if (hasCoreFocusBlocks) {
        isCoreCaptured = blocks.some(b => b.is_core_focus && capturedBlocks.has(b.name));
      }
    }
  } else if (mapped_segments) {
    mapped_segments.forEach(seg => {
      if (seg.mapped_blocks) {
        seg.mapped_blocks.forEach(b => capturedBlocks.add(b));
      }
    });

    if (blocks && blocks.length > 0) {
      const hasCoreFocusBlocks = blocks.some(b => b.is_core_focus);
      if (hasCoreFocusBlocks) {
        isCoreCaptured = blocks.some(b => b.is_core_focus && capturedBlocks.has(b.name));
      }
    }
  }

  if (isCoreCaptured && generalisation_present) {
    return 'extended abstract';
  }

  if (isCoreCaptured) {
    return 'relational';
  }

  // Without core concept, fall back to block count or element count
  if (extractedBlocks) {
    if (capturedBlocks.size >= 2) return 'multistructural';
    if (capturedBlocks.size >= 1) return 'unistructural';
    if (noticedBlocks.size >= 1) return 'unistructural';
    return 'prestructural';
  }

  if (mapped_segments) {
    if (capturedBlocks.size >= 2) return 'multistructural';
    if (capturedBlocks.size >= 1) return 'unistructural';
    return 'prestructural';
  }
  
  if (groups) {
    const keyGroups = groups.filter(g => g.type === 'key');
    const correctCount = keyGroups.filter(
      g => g.referenced && (g.mechanism === 'correct' || g.mechanism === 'vague')
    ).length;

    if (correctCount >= 2) return 'multistructural';
    if (correctCount >= 1) return 'unistructural';
    return 'prestructural';
  }

  return 'prestructural';
}

// ============================================================
// STAGE 3: Feedback Prompt Builders
// ============================================================

// --- Holistic (baseline — no extraction, no level naming) ---

function buildHolisticPrompt(studentDescription, keyIdea, blocks, keyElements, contextualElements) {
  return `You are a teaching assistant evaluating a student's interpretation of a technical sketch.

${PEDAGOGICAL_CONTEXT}

${groundTruthBlock(keyIdea, blocks, keyElements, contextualElements)}

${studentBlock(studentDescription)}

The ground truth is your private reference for understanding the sketch. Use it to assess the student's reasoning, but do NOT simply give answer to the student. The visual elements listed (e.g., arrows, shaded regions) describe the sketch's visual syntax to help YOU understand it — they are not a checklist the student must satisfy. The student's task is to demonstrate understanding of the underlying concept, not to name or inventory specific drawn elements.

If the student has captured the core concept, affirm their reasoning clearly and concisely. If the core concept block lists Refinements that the student did not express, you may add ONE light nudge toward a missing refinement (as a question, without stating it). Otherwise STOP. Do not recommend additional visual elements or suggest further observations.

If the student has not captured the core concept, identify the most important gap in their understanding of the sketch and ask a targeted question or suggest a line of thinking that builds on what they already understand (e.g., "you noticed X — now consider what that implies about Y"). Before correcting a misconception, check if the student's underlying logic is sound but they simply misread a visual element (e.g., they reversed a direction or misread a label). If their logic is internally consistent, affirm their reasoning and only redirect how they read that specific visual element. Do not tell them to list or inventory visual elements. Do not state what they would find — let them reason toward it.

Do NOT name any rubric level or classification scheme.

${BASE_OUTPUT_INSTRUCTIONS}`;
}

// --- Enriched analysis block builder for informed conditions ---

function buildEnrichedAnalysis(extraction, classification, blocks) {
  let block = `<analysis>\n`;
  
  // Determine which block names are core focus
  const coreFocusBlocks = new Set();
  if (blocks && blocks.length > 0) {
    blocks.forEach(b => {
      if (b.is_core_focus) coreFocusBlocks.add(b.name);
    });
  }

  // Determine if core focus was captured
  let coreFocusCaptured = false;
  let coreFocusPartial = false; // captured, but some refinements missing
  const capturedBlocks = new Set();
  const noticedBlocks = new Set();
  const blockDefs = new Map((blocks || []).map(b => [b.name, b]));

  // Returns the refinement strings for a block that the student did NOT express
  const missingRefinementsFor = (b) => {
    const def = blockDefs.get(b.name);
    const refs = (def && def.refinements) || [];
    const got = new Set((b.refinements_captured || []).map(Number));
    return refs.filter((_, i) => !got.has(i + 1));
  };

  if (extraction.blocks && Array.isArray(extraction.blocks)) {
    block += `Student Analysis of Concept Blocks:\n`;
    
    extraction.blocks.forEach(b => {
      if (b.concept_captured) capturedBlocks.add(b.name);
      if (b.element_noticed) noticedBlocks.add(b.name);
    });

    coreFocusCaptured = [...coreFocusBlocks].some(name => capturedBlocks.has(name));

    for (const b of extraction.blocks) {
      const isCore = coreFocusBlocks.has(b.name);
      const focusTag = isCore ? ' (CORE FOCUS)' : '';

      if (b.concept_captured) {
        const missing = missingRefinementsFor(b);
        if (isCore && missing.length > 0) {
          coreFocusPartial = true;
          block += `\n[${b.name}]${focusTag}: CONCEPT CAPTURED (PARTIAL — essential idea present, refinement missing)\n`;
        } else {
          block += `\n[${b.name}]${focusTag}: CONCEPT CAPTURED (FULL)\n`;
        }
        if (b.concept_evidence) {
          block += `  - Student said: "${b.concept_evidence}"\n`;
        } else if (b.element_evidence) {
          block += `  - Student said: "${b.element_evidence}"\n`;
        }
        if (isCore && missing.length > 0) {
          missing.forEach(r => block += `  - Missing refinement: ${r}\n`);
        }
      } else if (b.element_noticed) {
        if (isCore || !coreFocusCaptured) {
          block += `\n[${b.name}]${focusTag}: CONCEPT MISSED — but student noticed visual element\n`;
          if (b.element_evidence) {
            block += `  - Student noticed: "${b.element_evidence}"\n`;
          }
        }
      } else {
        if (isCore) {
          block += `\n[${b.name}]${focusTag}: CONCEPT MISSED — element not noticed\n`;
        }
      }
    }
  } else if (extraction.mapped_segments) {
    block += `Student Mapping to Concept Blocks:\n`;
    extraction.mapped_segments.forEach(seg => {
      if (seg.mapped_blocks) {
        seg.mapped_blocks.forEach(b => capturedBlocks.add(b));
      }
    });

    coreFocusCaptured = [...coreFocusBlocks].some(name => capturedBlocks.has(name));

    for (const b of capturedBlocks) {
      const focusTag = coreFocusBlocks.has(b) ? ' (CORE FOCUS)' : '';
      block += `\n[${b}]${focusTag}: CAPTURED\n`;
      const segments = extraction.mapped_segments.filter(seg => seg.mapped_blocks && seg.mapped_blocks.includes(b));
      for (const seg of segments) {
        block += `  - Student said: "${seg.student_text}"\n`;
      }
    }
    
    if (blocks && blocks.length > 0) {
      const allBlockNames = blocks.map(b => b.name);
      const missedBlocks = allBlockNames.filter(name => !capturedBlocks.has(name));
      for (const name of missedBlocks) {
        if (!coreFocusBlocks.has(name)) {
          continue;
        }
        const focusTag = coreFocusBlocks.has(name) ? ' (CORE FOCUS)' : '';
        block += `\n[${name}]${focusTag}: MISSED\n`;
      }
    } else {
      block += `\nNote: Any concept blocks from the ground truth not listed as CAPTURED above were entirely MISSED by the student.\n`;
    }
  } else {
    // Legacy fallback
    const keyGroups = extraction.groups ? extraction.groups.filter(g => g.type === 'key') : [];
    const contextualGroups = extraction.groups ? extraction.groups.filter(g => g.type === 'contextual') : [];

    block += `Element coverage (key elements):`;

    for (const g of keyGroups) {
      if (g.referenced) {
        block += `\n- ${g.element}: referenced (mechanism: ${g.mechanism})`;
        if (g.student_text) {
          block += `\n  Student said: "${g.student_text}"`;
        }
      } else {
        block += `\n- ${g.element}: not referenced`;
      }
    }

    if (contextualGroups.length > 0) {
      block += `\n\nContextual elements:`;
      for (const g of contextualGroups) {
        block += `\n- ${g.element}: ${g.referenced ? 'referenced' : 'not referenced'}`;
      }
    }
  }

  if (extraction.unmatched_student_claims && extraction.unmatched_student_claims.length > 0) {
    block += `\n\nUnmatched student claims (not in ground truth):`;
    for (const claim of extraction.unmatched_student_claims) {
      block += `\n- "${claim}"`;
    }
  }

  block += `\nOverall classification: ${classification}`;
  block += `\n</analysis>`;

  return { text: block, coreFocusCaptured, coreFocusPartial, capturedBlocks };
}

// Shared instruction for the partial-success nudge (used by both informed conditions)
const PARTIAL_NUDGE_INSTRUCTION = `The student captured the essential core concept, but the analysis lists a "Missing refinement" for the CORE FOCUS block — a detail that would make their answer more precise.
After affirming, add ONE short question that nudges them toward that refinement. Do NOT state the refinement itself (e.g. do not say the word it hinges on) — let them reason toward it. Frame it as polishing a correct answer, not as a mistake.`;

// --- Informed Holistic (extraction-informed, conversational, no level naming) ---

function buildInformedHolisticPrompt(studentDescription, extraction, classification, blocks, keyIdea, keyElements, contextualElements) {
  const { text: analysisBlock, coreFocusCaptured, coreFocusPartial, capturedBlocks } = buildEnrichedAnalysis(extraction, classification, blocks);

  let visibleBlocks = blocks;
  if (blocks && capturedBlocks) {
    visibleBlocks = blocks.filter(b => b.is_core_focus || capturedBlocks.has(b.name));
  }

  if (coreFocusCaptured && coreFocusPartial) {
    return `You are a teaching assistant evaluating a student's interpretation of a technical sketch.

${PEDAGOGICAL_CONTEXT}

${groundTruthBlock(keyIdea, visibleBlocks, keyElements, contextualElements, coreFocusCaptured)}

${analysisBlock}

${studentBlock(studentDescription)}

Affirm what they got right by specifically referencing the ideas they expressed (in natural language, not block names). Make it feel personalized and conversational.
${PARTIAL_NUDGE_INSTRUCTION}
Do NOT point out missing visual elements or other blocks.

Output Instructions:
1. Return ONLY the raw feedback text. Do NOT use JSON, markdown formatting, or <think> blocks.
2. Keep feedback concise: at most 50 words, addressing the student directly.
3. At the very end of your response, on a new line, append: [DEBUG] Path: SUCCESS_PARTIAL`;
  }

  if (coreFocusCaptured) {
    return `You are a teaching assistant evaluating a student's interpretation of a technical sketch.

${PEDAGOGICAL_CONTEXT}

${groundTruthBlock(keyIdea, visibleBlocks, keyElements, contextualElements, coreFocusCaptured)}

${analysisBlock}

${studentBlock(studentDescription)}

The analysis shows the student has successfully captured the core concept of the sketch.
Your ONLY job is to affirm what they got right by specifically referencing the ideas they expressed (in natural language, not block names).
Make it feel personalized and conversational. Do NOT ask any follow-up questions. Do NOT suggest further observations. Do NOT point out missing elements.

Output Instructions:
1. Return ONLY the raw feedback text. Do NOT use JSON, markdown formatting, or <think> blocks.
2. Keep feedback concise: at most 50 words, addressing the student directly.
3. At the very end of your response, on a new line, append: [DEBUG] Path: SUCCESS`;
  }

  return `You are a teaching assistant writing feedback on a student's interpretation of a technical sketch.

${PEDAGOGICAL_CONTEXT}

${groundTruthBlock(keyIdea, visibleBlocks, keyElements, contextualElements, coreFocusCaptured)}

${analysisBlock}

${studentBlock(studentDescription)}

The ground truth is your private reference — do NOT simply give answer to the student. The visual elements listed in the ground truth describe the sketch's visual syntax to help YOU understand it — they are not a checklist the student must satisfy. The student's task is to demonstrate understanding of the underlying concept, not to name specific drawn elements. The analysis shows which concept blocks the student captured.

Use both the ground truth and the analysis to write targeted feedback that helps the student improve their sketch comprehension skills.

The student missed the block marked (CORE FOCUS). Your feedback MUST target this specific core concept. If the analysis notes "CONCEPT MISSED — but student noticed visual element", use what they already noticed as a starting point to scaffold their understanding toward the CORE FOCUS concept. Ask a targeted question or suggest a line of thinking that guides the student to understand the CORE FOCUS. Before correcting a misconception, check if the student's underlying logic is sound but they simply misread a visual element (e.g., they reversed a direction or misread a label). If their logic is internally consistent, affirm their reasoning and only redirect how they read that specific visual element. Do NOT focus on other missed secondary concepts — direct all your scaffolding toward the CORE FOCUS. Do not tell them to list visual elements. If they have misconceptions (see unmatched claims), address the most significant one.

Do NOT name any rubric level, classification scheme, or analysis structure.

${BASE_OUTPUT_INSTRUCTIONS}
4. At the very end of your response, on a new line, append: [DEBUG] Scaffolding Target: <Name of the block you are scaffolding, e.g. Result> | Path: GAP_FINDING (You are permitted to output the block name for this debug line only)`;
}

// --- Informed Rubric (extraction-informed, rubric-calibrated) ---

function buildInformedRubricPrompt(studentDescription, extraction, classification, blocks, keyIdea, keyElements, contextualElements) {
  const { text: analysisBlock, coreFocusCaptured, coreFocusPartial, capturedBlocks } = buildEnrichedAnalysis(extraction, classification, blocks);

  let visibleBlocks = blocks;
  if (blocks && capturedBlocks) {
    visibleBlocks = blocks.filter(b => b.is_core_focus || capturedBlocks.has(b.name));
  }

  // Map SOLO classification to numbered level
  const levelMap = {
    'prestructural': 1,
    'unistructural': 2,
    'multistructural': 3,
    'relational': 4,
    'extended abstract': 5
  };
  const levelNumber = levelMap[classification] || 1;

  if (coreFocusCaptured && coreFocusPartial) {
    return `You are a teaching assistant evaluating a student's interpretation of a technical sketch.

${PEDAGOGICAL_CONTEXT}

${groundTruthBlock(keyIdea, visibleBlocks, keyElements, contextualElements, coreFocusCaptured)}

${analysisBlock}

The student has been classified at Level ${levelNumber} of 5.

${studentBlock(studentDescription)}

Affirm their correct reasoning, explicitly naming how their answer connects the parts of the sketch into a coherent interpretation.
${PARTIAL_NUDGE_INSTRUCTION}
Do NOT mention the level number, rubric, or classification. Do NOT point out missing visual elements or other blocks.

Output Instructions:
1. Return ONLY the raw feedback text. Do NOT use JSON, markdown formatting, or <think> blocks.
2. Keep feedback concise: at most 50 words, addressing the student directly.
3. At the very end of your response, on a new line, append: [DEBUG] Path: SUCCESS_PARTIAL`;
  }

  if (coreFocusCaptured) {
    return `You are a teaching assistant evaluating a student's interpretation of a technical sketch.

${PEDAGOGICAL_CONTEXT}

${groundTruthBlock(keyIdea, visibleBlocks, keyElements, contextualElements, coreFocusCaptured)}

${analysisBlock}

The student has been classified at Level ${levelNumber} of 5.

${studentBlock(studentDescription)}

The analysis shows the student has successfully captured the core concept of the sketch.
Your job is to affirm their correct reasoning, and then pose a 'Level 5' stretch question asking them to generalize the concept to a broader context or application.
Do NOT point out missing elements from the sketch itself — your question should strictly push them to generalize beyond the current sketch.

Output Instructions:
1. Return ONLY the raw feedback text. Do NOT use JSON, markdown formatting, or <think> blocks.
2. Keep feedback concise: at most 50 words, addressing the student directly.
3. At the very end of your response, on a new line, append: [DEBUG] Path: SUCCESS`;
  }

  return `You are a teaching assistant writing feedback on a student's interpretation of a technical sketch, using a structured rubric to calibrate your response.

${PEDAGOGICAL_CONTEXT}

<rubric>
- Level 1 of 5: Explanation is off-base or too brief to demonstrate engagement with the sketch.
- Level 2 of 5: Identifies one or two elements in isolation without connecting them.
- Level 3 of 5: Identifies several elements but describes them separately without synthesising their relationships.
- Level 4 of 5: Connects elements into a coherent interpretation with clear reasoning about how they relate.
- Level 5 of 5: Coherent interpretation that also generalises the concept to broader context or applications.
</rubric>

${groundTruthBlock(keyIdea, visibleBlocks, keyElements, contextualElements, coreFocusCaptured)}

${analysisBlock}

The student has been classified at Level ${levelNumber} of 5.

${studentBlock(studentDescription)}

The ground truth is your private reference — do NOT simply give answer to the student. The visual elements listed in the ground truth describe the sketch's visual syntax to help YOU understand it — they are not a checklist the student must satisfy. Use the rubric level, ground truth, and analysis to calibrate the depth and direction of your feedback, but do NOT mention the level number, rubric, or classification to the student.

The student missed the block marked (CORE FOCUS). Your feedback MUST target this specific core concept. Ask a targeted question or suggest a line of thinking that guides the student to understand the CORE FOCUS. Before correcting a misconception, check if the student's underlying logic is sound but they simply misread a visual element (e.g., they reversed a direction or misread a label). If their logic is internally consistent, affirm their reasoning and only redirect how they read that specific visual element. Do NOT focus on other missed secondary concepts — direct all your scaffolding toward the CORE FOCUS. Do not tell them to list visual elements. If they have misconceptions (see unmatched claims), address the most significant one. Do not state what they would find — let them reason toward it.

${BASE_OUTPUT_INSTRUCTIONS}
4. At the very end of your response, on a new line, append: [DEBUG] Scaffolding Target: <Name of the block you are scaffolding, e.g. Result> | Path: GAP_FINDING (You are permitted to output the block name for this debug line only)`;
}

// ============================================================
// API Handlers
// ============================================================

export async function GET() {
  return NextResponse.json({ conditions: CONDITIONS, model: EVAL_MODEL });
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { studentDescription, conditionId, keyIdea, blocks, keyElements, contextualElements } = body;

    if (!conditionId) {
      return NextResponse.json({ error: "Missing conditionId in request" }, { status: 400 });
    }

    const condition = CONDITIONS.find(c => c.id === conditionId);
    if (!condition) {
      return NextResponse.json({ error: "Invalid conditionId" }, { status: 400 });
    }

    // --- Holistic: single LLM call, no extraction ---
    if (conditionId === 'holistic') {
      const prompt = buildHolisticPrompt(studentDescription, keyIdea, blocks, keyElements, contextualElements);
      const result = await callLLM(prompt);

      return NextResponse.json({
        conditionId: condition.id,
        model: EVAL_MODEL,
        grade: 'N/A',
        feedback: result.text,
        tokens: result.tokens
      });
    }

    // --- Informed conditions: extract first, then classify, then generate feedback ---
    const { extraction, tokens: extractionTokens } = await extractSegmentation(
      studentDescription, keyIdea, blocks, keyElements, contextualElements
    );
    const classification = classifySOLO(extraction, blocks);

    let feedbackPrompt;
    if (conditionId === 'informed-holistic') {
      feedbackPrompt = buildInformedHolisticPrompt(studentDescription, extraction, classification, blocks, keyIdea, keyElements, contextualElements);
    } else if (conditionId === 'informed-rubric') {
      feedbackPrompt = buildInformedRubricPrompt(studentDescription, extraction, classification, blocks, keyIdea, keyElements, contextualElements);
    }

    const feedbackResult = await callLLM(feedbackPrompt);

    return NextResponse.json({
      conditionId: condition.id,
      model: EVAL_MODEL,
      grade: 'N/A',
      feedback: feedbackResult.text,
      classification,
      extraction,
      tokens: extractionTokens + feedbackResult.tokens
    });

  } catch (error) {
    console.error("Error grading:", error);
    return NextResponse.json({ 
      error: "Failed to grade response", 
      details: error.message, 
      stack: error.stack 
    }, { status: 500 });
  }
}
