import { useCallback, useEffect, useRef, useState } from 'react';
import { useRecoilValue } from 'recoil';
import { Lightbulb } from 'lucide-react';
import { useSubmitMessage } from '~/hooks';
import { useEmbeddedSuggestedQuestionsShow } from '../EmbeddedSuggestedQuestionsContext';
import { cn } from '~/utils';
import store from '~/store';

const EMBEDDED_SUGGESTED_QUESTIONS = [
  'Tell me more about this project',
  'Summarize the key details',
  'Show me prior year tax returns',
  'Show me current tax year PBC docs',
  'Tell me what else you can do',
] as const;

/**
 * Renders a floating icon above the message input (embedded mode only).
 * Hover the icon or panel to expand; panel collapses as soon as the mouse leaves both.
 */
export default function SuggestedQuestionsInInput() {
  const show = useEmbeddedSuggestedQuestionsShow();
  const { submitMessage } = useSubmitMessage();
  const maximizeChatSpace = useRecoilValue(store.maximizeChatSpace);
  const [isOpen, setIsOpen] = useState(false);
  const iconRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const sendSuggestion = useCallback(
    (text: string) => {
      submitMessage({ text });
    },
    [submitMessage],
  );

  const isInside = (node: Node | null, target: EventTarget | null): boolean => {
    if (!target || !(target instanceof Node)) return false;
    return node?.contains(target) ?? false;
  };

  const handleIconLeave = useCallback(
    (e: React.MouseEvent) => {
      if (!isInside(panelRef.current, e.relatedTarget)) setIsOpen(false);
    },
    [],
  );
  const handlePanelLeave = useCallback(
    (e: React.MouseEvent) => {
      if (!isInside(iconRef.current, e.relatedTarget)) setIsOpen(false);
    },
    [],
  );
  const handlePanelFocusOut = useCallback(
    (e: FocusEvent) => {
      if (
        !isInside(iconRef.current, e.relatedTarget) &&
        !isInside(panelRef.current, e.relatedTarget)
      )
        setIsOpen(false);
    },
    [],
  );

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    panel.addEventListener('focusout', handlePanelFocusOut);
    return () => panel.removeEventListener('focusout', handlePanelFocusOut);
  }, [handlePanelFocusOut]);

  if (!show) return null;

  return (
    <div
      className={cn(
        'relative mx-auto w-full pb-12 transition-[max-width] duration-300 sm:px-2',
        maximizeChatSpace ? 'max-w-full' : 'md:max-w-3xl xl:max-w-4xl',
      )}
    >
      {/* Floating icon trigger */}
      <button
        ref={iconRef}
        type="button"
        onMouseEnter={() => setIsOpen(true)}
        onMouseLeave={handleIconLeave}
        onFocus={() => setIsOpen(true)}
        onBlur={(e) => {
          if (!isInside(panelRef.current, e.relatedTarget)) setIsOpen(false);
        }}
        className={cn(
          'absolute bottom-2 right-2 z-10 flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center',
          'rounded-full border border-border-light bg-surface-secondary shadow-sm',
          'text-text-secondary transition-colors hover:bg-surface-tertiary hover:text-text-primary',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-border-medium',
        )}
        aria-expanded={isOpen}
        aria-haspopup="true"
        aria-label="Suggested questions"
      >
        <Lightbulb className="h-4 w-4" />
      </button>

      {/* Panel: open only when mouse/focus is on icon or panel; collapses as soon as pointer leaves both */}
      <div
        ref={panelRef}
        onMouseEnter={() => setIsOpen(true)}
        onMouseLeave={handlePanelLeave}
        className={cn(
          'absolute bottom-10 right-2 z-20 grid overflow-hidden transition-all duration-200 ease-out outline-none',
          isOpen ? 'max-h-[280px] opacity-100' : 'max-h-0 opacity-0',
        )}
        style={{ width: '18rem', maxWidth: 'calc(100vw - 2rem)' }}
      >
        <div className="flex flex-wrap gap-1.5 rounded-lg border border-border-light bg-surface-primary p-2 shadow-lg">
          {EMBEDDED_SUGGESTED_QUESTIONS.map((question) => (
            <button
              key={question}
              type="button"
              onClick={() => {
                setIsOpen(false);
                sendSuggestion(question);
              }}
              className={cn(
                'rounded-lg border border-border-light bg-surface-secondary px-3 py-2 text-left text-sm italic',
                'text-text-primary transition-colors hover:bg-surface-tertiary hover:border-border-medium',
              )}
            >
              {question}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
