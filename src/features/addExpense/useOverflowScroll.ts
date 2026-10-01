import { useCallback, useEffect, useState, type RefObject } from 'react';
import type { LayoutChangeEvent, ScrollViewInstance } from 'react-native';

/**
 * The rows above Save (Add expense) or Record payment (Settle) scroll only when they do not fit (`fitShortScreen`), so
 * the sheet's swipe-down works everywhere otherwise. `view` is the scroll view's own height.
 */
export function useOverflowScroll(ref: RefObject<ScrollViewInstance | null>) {
  const [heights, setHeights] = useState({ view: 0, content: 0 });
  const scrollable = heights.content - heights.view > 1;
  useEffect(() => {
    if (scrollable) ref.current?.flashScrollIndicators();
  }, [ref, scrollable]);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const view = e.nativeEvent.layout.height;
    setHeights((h) => (h.view === view ? h : { ...h, view }));
  }, []);
  const onContentSizeChange = useCallback((_: number, content: number) => {
    setHeights((h) => (h.content === content ? h : { ...h, content }));
  }, []);
  return { scrollable, view: heights.view, onLayout, onContentSizeChange };
}
