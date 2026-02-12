import { useCallback } from 'react';
import { useSubmitMessage } from '~/hooks';
import { useEmbeddedSuggestedQuestionsShow } from '../EmbeddedSuggestedQuestionsContext';
import { cn } from '~/utils';

const EMBEDDED_SUGGESTED_QUESTIONS = [
  'Tell me more about this project',
  'Summarize the key details',
  'Show me prior year tax returns',
  'Tell me what else you can do',
] as const;

/**
 * Renders suggested question buttons inline right after the greeting message (embedded mode only).
 * Alexa+ style: pill-shaped, light blue tint, stacked/grid, same size as chat text.
 */
export default function SuggestedQuestionsInline() {
  const show = useEmbeddedSuggestedQuestionsShow();
  const { submitMessage } = useSubmitMessage();

  const sendSuggestion = useCallback(
    (text: string) => {
      submitMessage({ text });
    },
    [submitMessage],
  );

  if (!show) return null;

  return (
    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
      {EMBEDDED_SUGGESTED_QUESTIONS.map((question) => (
        <button
          key={question}
          type="button"
          onClick={() => sendSuggestion(question)}
          className={cn(
            'rounded-2xl border border-sky-500/30 bg-sky-500/10 px-4 py-2.5 text-left text-base',
            'text-sky-200/95 transition-colors hover:bg-sky-500/20 hover:border-sky-400/40',
          )}
        >
          {question}
        </button>
      ))}
    </div>
  );
}
