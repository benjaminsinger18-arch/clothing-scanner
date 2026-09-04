import { useCallback } from "react";
import { View } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as SplashScreen from "expo-splash-screen";
import { useFonts } from "expo-font";
// Deep per-weight imports, not the package's index — @expo-google-fonts/inter's
// index.js unconditionally require()s every weight of the family (18 weights), so
// importing anything from it bundles every weight regardless of which ones are
// actually used. Importing each file directly (confirmed no package "exports" map
// blocks this) keeps the app to only the 4 weights it needs instead of several MB
// of dead font-file weight.
import Inter_400Regular from "@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf";
import Inter_500Medium from "@expo-google-fonts/inter/500Medium/Inter_500Medium.ttf";
import Inter_600SemiBold from "@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf";
import Inter_700Bold from "@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf";
import type { RootStackParamList } from "./navigation/types";
import { CaptureScreen } from "./screens/CaptureScreen";
import { PreviewScreen } from "./screens/PreviewScreen";
import { BarcodeScanScreen } from "./screens/BarcodeScanScreen";
import { ResultsScreen } from "./screens/ResultsScreen";
import { CorrectionScreen } from "./screens/CorrectionScreen";
import { ClosetScreen } from "./screens/ClosetScreen";
import { ClosetDetailScreen } from "./screens/ClosetDetailScreen";
import { theme } from "./theme";

// Held open until fonts finish loading (or fail) so the very first screen's Inter
// title never flashes in the system font first — see theme.ts's comment on why
// that specific moment matters more than a generic loading gate.
SplashScreen.preventAutoHideAsync();

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  // Fail open on a font-load error rather than hang on the splash screen forever.
  const ready = fontsLoaded || fontError;

  const onLayoutRootView = useCallback(async () => {
    if (ready) {
      await SplashScreen.hideAsync();
    }
  }, [ready]);

  if (!ready) {
    return null;
  }

  return (
    <View style={{ flex: 1 }} onLayout={onLayoutRootView}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <NavigationContainer>
          <Stack.Navigator
            screenOptions={{
              headerStyle: { backgroundColor: theme.colors.background },
              headerTintColor: theme.colors.textPrimary,
              headerTitleStyle: { fontFamily: theme.fonts.body.semiBold },
              contentStyle: { backgroundColor: theme.colors.background },
            }}
          >
            <Stack.Screen name="Capture" component={CaptureScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Preview" component={PreviewScreen} options={{ title: "Confirm Photo" }} />
            <Stack.Screen name="BarcodeScan" component={BarcodeScanScreen} options={{ title: "Scan Barcode" }} />
            <Stack.Screen name="Results" component={ResultsScreen} options={{ title: "Results" }} />
            <Stack.Screen name="Correction" component={CorrectionScreen} options={{ title: "Correct This" }} />
            <Stack.Screen name="Closet" component={ClosetScreen} options={{ title: "My Closet" }} />
            <Stack.Screen name="ClosetDetail" component={ClosetDetailScreen} options={{ title: "Saved Item" }} />
          </Stack.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>
    </View>
  );
}
