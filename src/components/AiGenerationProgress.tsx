import {
  aiProgressLabels,
  type AiProgressStage,
} from '../lib/ai-stream-client';
import './ai-generation.css';

/** Announces one server-reported AI generation stage without model text or percentages. */
export default function AiGenerationProgress({
  stage,
}: {
  stage: AiProgressStage;
}) {
  return (
    <div
      className="ai-generation-progress"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span className="ai-progress-pulse" aria-hidden="true" />
      <span>{aiProgressLabels[stage]}</span>
    </div>
  );
}
