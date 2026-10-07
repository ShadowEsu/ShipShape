import * as ImagePicker from "expo-image-picker";
import storage from "@react-native-firebase/storage";

export async function uploadHomeworkPhoto(uid: string) {
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"] });
  if (result.canceled) return;
  await storage().ref(`homework/${uid}.jpg`).putFile(result.assets[0].uri);
}
