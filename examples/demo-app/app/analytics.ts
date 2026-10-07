import analytics from "@react-native-firebase/analytics";
import { AppEventsLogger } from "react-native-fbsdk-next";

export function track(event: string) {
  analytics().logEvent(event);
  AppEventsLogger.logEvent(event);
}
