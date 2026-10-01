import { Stack } from 'expo-router';

import { SHEET_ROUTE_OPTIONS } from '@/features/addExpense/RouteSheet';
import { EnsureAppServices } from '@/features/group/EnsureAppServices';
import { NavigationTheme, ThemeProvider, useTheme } from '@/theme';

/**
 * The group stack: Group, Expense detail, group settings, and the Add expense, Split and Settle sheets. Screens draw
 * their own nav bars (the kit's `Screen`). The sheets are declared here with their presentation (transparent modal, no
 * native animation), which only takes effect from the layout, so the group stays visible behind the scrim. A nested
 * ThemeProvider wraps the group (design.md "Theme tokens": the group's theme, once `group.themed` exists, resolves
 * here), and the group stack's native container takes its canvas from it (`NavigationTheme`).
 */
export default function GroupLayout() {
  return (
    <EnsureAppServices>
      <ThemeProvider>
        <NavigationTheme>
          <GroupStack />
        </NavigationTheme>
      </ThemeProvider>
    </EnsureAppServices>
  );
}

function GroupStack() {
  const { tokens } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: tokens.background },
      }}
    >
      <Stack.Screen name="expense" options={SHEET_ROUTE_OPTIONS} />
      <Stack.Screen name="split" options={SHEET_ROUTE_OPTIONS} />
      <Stack.Screen name="settle" options={SHEET_ROUTE_OPTIONS} />
    </Stack>
  );
}
