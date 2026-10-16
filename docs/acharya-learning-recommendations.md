# Acharya learning experience recommendations

Research date: 2026-10-10. Scope: the supplied photosynthesis screenshot, earlier engine screenshots, and the reviewed board implementation. These are recommendations, not implemented changes. Research supports the teaching principles; the proposed product layouts and interaction details require testing with Acharya's learners.

## Evidence and limits

- The [IES practice guide](https://ies.ed.gov/ncee/wwc/PracticeGuide/1) recommends combining diagrams and verbal descriptions, alternating worked examples and problem solving, and spacing learning over time (moderate evidence). It rates quizzing that revisits content and deep explanatory questions as strong evidence. This does not establish an optimal sentence count, caption animation, or UI column ratio.
- [Freeman et al., 2014](https://doi.org/10.1073/pnas.1319030111) analyzed 225 undergraduate STEM studies and found better performance with active learning than traditional lectures. These results do not directly measure an AI tutor or this application.
- [EEF feedback guidance](https://educationendowmentfoundation.org.uk/education-evidence/guidance-reports/feedback) and its [recommendations poster](https://d2tic4wvo1iusb.cloudfront.net/production/eef-guidance-reports/feedback/EEF_Feedback_Recommendations_Poster.pdf) emphasize identifying learning gaps, targeting feedback to the task and subject, and giving pupils an opportunity to use feedback. The guidance concerns teacher-delivered feedback for ages 5–18; application to AI requires evaluation.
- [W3C cognitive accessibility guidance](https://www.w3.org/WAI/WCAG2/supplemental/objectives/o5-user-focus/) recommends reducing distractions and unnecessary content and providing orientation cues. This is supplemental guidance, not a WCAG conformance requirement.
- [W3C accessibility principles](https://www.w3.org/WAI/fundamentals/accessibility-principles/) support text alternatives, captions, adjustable text and audio, keyboard interaction, and using more than color to communicate meaning. [Focus Not Obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html) explains the risk from floating controls covering focused components; the screenshot alone is not a full conformance audit.
- [Kestin et al., 2025](https://www.nature.com/articles/s41598-025-97652-6) studied 194 Harvard physics students in a randomized crossover design spanning two lessons and found improved immediate learning with a deliberately structured AI tutor relative to classroom active learning. Its expert-authored prompts, supplied solutions, and scaffolded interactions support using validated concept materials. The study does not establish results for Acharya, children, Indic languages, or delayed retention.
- [W3C language of parts](https://www.w3.org/WAI/WCAG22/Understanding/language-of-parts.html) supports programmatically identifying language changes in multilingual content, subject to the criterion's exceptions, so assistive technology can interpret passages appropriately.

## Immediate repairs

1. Remove finished-looking empty explanation panels. Render a compact loading state only during genuine preparation; show meaningful explanation content once available. Supporting images share the owning concept's explanation rather than creating another empty teaching step.
2. Fix shared geometry: notes, captions, checks, annotations, and export all use complete measured concept bounds. No overlap or export cropping. Persist utterances with stable concept and transcript segment IDs, scoped to the lesson and board.
3. Reject diagrams with unreadable generated text. Use native SVG/HTML for validated scientific labels and relationships; use generated imagery for illustration when useful. Check labels, arrows, units, and assertions before display. In the supplied screenshot, the generated leaf image contains gibberish and the overview leaves the role of some nodes visually disconnected.
4. Move persistent controls into reserved screen space. The current dock and learning buttons visibly cover the lower image. Put board tools in the header and keep the lesson interaction bar compact, with extra controls in a menu.

## Proposed teaching interaction

Use an active concept view with a visible topic, objective, and step position. Keep completed concepts available through a lesson outline and optional full-board review. Desktop retains diagram-left and explanation-right; mobile stacks them. Reveal relevant nodes progressively, retaining an accessible overview.

For each concept: explain briefly, point to the relevant visual, ask the learner to predict/explain/label something, wait for voice/text/selection/drawing input, give specific feedback, then offer a retry or the next concept. Readiness questions remain available for pacing but do not count as evidence of mastery.

Example: after showing water entering through roots, ask the learner to select the arrow that carries water into leaves and explain their choice. After corrective feedback, ask a related question to check whether the misconception was repaired. Give a hint before revealing a solution, with an explicit option to show the explanation.

Keep voice input interruptible. Expose accurate Listening, Explaining, Waiting for your answer, and Reconnecting states. Provide typed replies and visible mic status, pause, repeat, and pace controls. Do not treat silence as consent to advance. Let learners choose teaching and caption languages, with optional bilingual scientific terms.

Make diagram nodes actionable: explain this part, show an example, ask a question about it. Use prediction controls only where the topic has a meaningful model; a photosynthesis light toggle should illustrate a validated relationship and should not imply unsupported numerical precision.

## Retention, export, and evaluation

Finish with a short recap, an independent application task, and a saved list of concepts to revisit. Schedule optional retrieval practice using responses rather than self-reported confidence alone. Store learner memory transparently with edit/delete controls.

Export a real study deck: one concept per slide, correct visual, concise notes, practice question, and a separate answer section. Preserve selectable accessible text where feasible. Treat missing snapshots as visible failures rather than silently exporting an incomplete deck.

First evaluate with a small formative learner study: can learners orient, interrupt, ask about a node, answer a check, recover from a misconception, and reopen notes? Track overlap/blank-card failures, response latency, transcription corrections, independent answer correctness, and delayed recall. Do not substitute time spent, number of turns, or number of generated diagrams for learning. Pre/post and delayed assessments need comparable tasks; a causal improvement claim needs a suitable comparison design.

## Order

1. Repair empty cards, overlap, speech ownership/persistence, and invalid visual content.
2. Add concept navigation, reserved controls, accurate conversational states, and response alternatives.
3. Add answer-based checks, specific feedback, and targeted hints.
4. Evaluate before expanding to simulations, adaptive review, and richer exports.
