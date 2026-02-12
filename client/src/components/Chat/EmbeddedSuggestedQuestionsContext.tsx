import { createContext, useContext, useMemo } from 'react';
import type { TMessage } from 'librechat-data-provider';

export const EmbeddedSuggestedQuestionsContext = createContext<{ show: boolean }>({
  show: false,
});

export function useEmbeddedSuggestedQuestionsShow(): boolean {
  return useContext(EmbeddedSuggestedQuestionsContext).show;
}

/** Compute whether to show embedded suggested questions (embedded mode + first exchange with assistant reply). */
export function useEmbeddedSuggestedQuestionsShowValue(
  messagesTree: (TMessage & { children?: TMessage[] })[] | null | undefined,
): boolean {
  return useMemo(() => {
    if (typeof window === 'undefined') return false;
    const fromUrl = new URLSearchParams(window.location.search).get('embedded') === 'true';
    const fromStorage = sessionStorage.getItem('librechat_embedded') === 'true';
    if (!fromUrl && !fromStorage) return false;
    if (!messagesTree || messagesTree.length !== 1) return false;
    const root = messagesTree[0];
    const children = root?.children ?? [];
    if (children.length < 1) return false;
    const lastReply = children[children.length - 1];
    return !!(lastReply && lastReply.sender !== 'User');
  }, [messagesTree]);
}
