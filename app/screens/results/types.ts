// Shared between ResultsScreen.tsx and every tab component under this
// directory — split out during the ResultsScreen.tsx monolith breakup so each
// tab file can type its `pricing`/`outfits` props without importing from the
// screen file itself (which would risk a circular import once the screen
// imports the tabs back).

export type ErrorInfo = { title: string; detail?: string };

export type LoadState<T> = { data: T | null; loading: boolean; error: ErrorInfo | null };

export const IDLE_STATE: LoadState<never> = { data: null, loading: false, error: null };
