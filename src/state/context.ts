/** The React context carrying the app's services. Set by `AppProvider`; read through `useApp()` in hooks.ts. */
import { createContext } from 'react';

import type { AppServices } from './services';

export const AppContext = createContext<AppServices | null>(null);
AppContext.displayName = 'EvenApp';
