import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { RootStackParamList } from "./navigation/types";
import { CaptureScreen } from "./screens/CaptureScreen";
import { PreviewScreen } from "./screens/PreviewScreen";
import { BarcodeScanScreen } from "./screens/BarcodeScanScreen";
import { ResultsScreen } from "./screens/ResultsScreen";

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <NavigationContainer>
        <Stack.Navigator
          screenOptions={{
            headerStyle: { backgroundColor: "#000" },
            headerTintColor: "#fff",
            contentStyle: { backgroundColor: "#000" },
          }}
        >
          <Stack.Screen name="Capture" component={CaptureScreen} options={{ headerShown: false }} />
          <Stack.Screen name="Preview" component={PreviewScreen} options={{ title: "Confirm Photo" }} />
          <Stack.Screen name="BarcodeScan" component={BarcodeScanScreen} options={{ title: "Scan Barcode" }} />
          <Stack.Screen name="Results" component={ResultsScreen} options={{ title: "Results" }} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
